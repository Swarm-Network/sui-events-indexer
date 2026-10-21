#!/usr/bin/env bun
/**
 * Read API on `Bun.serve` routes: no framework, static route table.
 *
 *   GET /health
 *   GET /events                      -> available routes
 *   GET /events/<module>/<event>     ?limit=50&offset=0&sender=0x…
 *
 * Newest first: ordered by checkpoint, then transaction digest and event index.
 */
import { desc, eq } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import { env } from './config/env';
import { closeDb, db, sql } from './db/client';
import { EVENT_ROUTES } from './generated/routes';
import { errorFields, log } from './lib/log';

type EventTable = PgTable & Record<'suiCheckpoint' | 'suiTxDigest' | 'suiEventSeq' | 'suiSender', AnyPgColumn>;

const MAX_LIMIT = 500;

const HEADERS = {
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });

const intParam = (url: URL, name: string, fallback: number) => {
  const raw = url.searchParams.get(name);
  const value = raw === null ? fallback : Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

const listEvents = (table: EventTable) => async (req: Request) => {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(intParam(url, 'limit', 50), 1), MAX_LIMIT);
  const offset = Math.max(intParam(url, 'offset', 0), 0);
  const sender = url.searchParams.get('sender');

  try {
    const rows = await db
      .select()
      .from(table)
      .where(sender ? eq(table.suiSender, sender) : undefined)
      .orderBy(desc(table.suiCheckpoint), desc(table.suiTxDigest), desc(table.suiEventSeq))
      .limit(limit)
      .offset(offset);
    return json({ data: rows, limit, offset });
  } catch (error) {
    log.error('query failed', { path: url.pathname, ...errorFields(error) });
    return json({ error: 'Failed to fetch events' }, 500);
  }
};

const server = Bun.serve({
  port: env.PORT,
  routes: {
    '/health': async () => {
      try {
        await sql`select 1`;
        return json({ ok: true });
      } catch {
        return json({ ok: false }, 503);
      }
    },
    '/events': () => json({ routes: EVENT_ROUTES.map(({ path, type }) => ({ path, type })) }),
    ...Object.fromEntries(
      EVENT_ROUTES.map((route) => [route.path, { GET: listEvents(route.table as EventTable) }]),
    ),
  },
  fetch: () => json({ error: 'Not found' }, 404),
});

log.info('api listening', { url: server.url.href });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop();
    await closeDb();
    process.exit(0);
  });
}
