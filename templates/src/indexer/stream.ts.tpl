/**
 * One event stream: every event whose type is defined in `typePackage`.
 *
 * Built for tight (subsecond) polling at near-zero idle cost:
 * - a single in-flight request per stream; the next poll is scheduled only
 *   after the previous one finished, so slow responses never pile up;
 * - while a backlog exists (`hasNextPage`) pages are fetched back-to-back;
 * - an empty poll touches nothing but the network: no DB round trip;
 * - a non-empty page is written in ONE transaction together with its cursor,
 *   so a crash can never skip or half-apply a page;
 * - failures back off exponentially (capped) instead of hammering the endpoint.
 */
import { env } from '../config/env';
import { db } from '../db/client';
import { loadCursor, saveCursor } from '../db/cursors';
import { HANDLERS } from '../handlers';
import { errorFields, log } from '../lib/log';
import { sleep } from '../lib/sleep';
import { fetchEventsPage } from '../sui/client';
import { dispatchPage } from './dispatch';

export const runStream = async (typePackage: string, signal: AbortSignal): Promise<void> => {
  const id = typePackage;
  let cursor = await loadCursor(id);
  let idleDelay = env.POLLING_INTERVAL_MS;
  let failures = 0;
  const warnedUnknown = new Set<string>();

  log.info('stream started', { stream: id, resumed: cursor !== null });

  while (!signal.aborted) {
    try {
      const page = await fetchEventsPage({
        typePackage,
        after: cursor,
        // Only meaningful for a brand-new stream; a stored cursor already encodes position.
        afterCheckpoint: cursor === null ? env.START_CHECKPOINT : undefined,
        signal,
      });
      failures = 0;
      // Guards the back-to-back drain below against a server repeating a cursor.
      const progressed = page.endCursor !== null && page.endCursor !== cursor;

      if (page.events.length > 0) {
        const nextCursor = page.endCursor;
        const unknown = await db.transaction(async (tx) => {
          const missing = await dispatchPage(tx, page.events, HANDLERS);
          if (nextCursor) await saveCursor(tx, id, nextCursor);
          return missing;
        });
        cursor = nextCursor ?? cursor;
        idleDelay = env.POLLING_INTERVAL_MS;

        for (const key of unknown) {
          if (warnedUnknown.has(key)) continue;
          warnedUnknown.add(key);
          log.warn('no handler for event type; skipped (regenerate to add it)', { stream: id, type: key });
        }

        const last = page.events.at(-1)!;
        log.debug('page indexed', { stream: id, events: page.events.length, checkpoint: last.checkpoint });
      } else if (progressed && page.hasNextPage) {
        // A scan-limited empty page can still advance; follow it without writing.
        cursor = page.endCursor;
      }

      if (page.hasNextPage && progressed) continue;

      await sleep(idleDelay, signal);
      if (page.events.length === 0 && env.IDLE_BACKOFF_MAX_MS > env.POLLING_INTERVAL_MS) {
        idleDelay = Math.min(idleDelay * 2, env.IDLE_BACKOFF_MAX_MS);
      }
    } catch (error) {
      if (signal.aborted) break;
      failures++;
      const delay = Math.min(env.POLLING_INTERVAL_MS * 2 ** failures, env.ERROR_BACKOFF_MAX_MS);
      log.error('stream page failed; retrying', { stream: id, failures, retryInMs: delay, ...errorFields(error) });
      await sleep(delay, signal);
    }
  }

  log.info('stream stopped', { stream: id });
};
