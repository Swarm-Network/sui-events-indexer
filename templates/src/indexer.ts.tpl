#!/usr/bin/env bun
/**
 * Indexer entrypoint: one stream per defining package id, until SIGINT/SIGTERM.
 *
 *   bun run indexer
 */
import { env } from './config/env';
import { closeDb } from './db/client';
import { GENERATED } from './generated/package';
import { runStream } from './indexer/stream';
import { log } from './lib/log';

const controller = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('shutting down', { signal });
    controller.abort();
  });
}

const streams = env.EVENT_PACKAGE_IDS ?? [...GENERATED.eventPackageIds];

log.info('indexer starting', {
  network: env.SUI_NETWORK,
  streams,
  pollingIntervalMs: env.POLLING_INTERVAL_MS,
});

await Promise.all(streams.map((id) => runStream(id, controller.signal)));
await closeDb();
