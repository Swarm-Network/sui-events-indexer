/**
 * drizzle-kit: `db:generate` diffs `src/db/schema.ts` into `drizzle/` SQL
 * migrations; `db:push` / `db:studio` connect with the `postgres` dev driver.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
