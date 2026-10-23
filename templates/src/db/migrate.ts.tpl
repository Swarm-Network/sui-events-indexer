#!/usr/bin/env bun
/**
 * Apply `drizzle/` migrations with the runtime driver (no drizzle-kit driver
 * needed). `bun run db:generate` creates them from `src/db/schema.ts`.
 */
import { migrate } from 'drizzle-orm/bun-sql/migrator';

import { log } from '../lib/log';
import { closeDb, db } from './client';

await migrate(db, { migrationsFolder: './drizzle' });
log.info('migrations applied');
await closeDb();
