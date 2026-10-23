/**
 * Drizzle on Bun's native Postgres driver (`Bun.SQL`): no extra driver
 * dependency, pooled connections, prepared statements cached per connection.
 */
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';

import { env } from '../config/env';
import * as schema from './schema';

export const sql = new SQL({ url: env.DATABASE_URL, max: env.DB_POOL_MAX });

export const db = drizzle({ client: sql, schema });

export type Db = typeof db;
/** The transaction handle handlers receive. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const closeDb = () => sql.close();
