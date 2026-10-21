/**
 * Dependency versions written into generated projects. Bump here only;
 * `bun test` checks they stay in sync with this repo's own package.json where shared.
 */
export const GENERATED_DEPENDENCIES = {
  '@mysten/sui': '^2.37.0',
  'drizzle-orm': '^0.45.4',
  zod: '^4.6.7',
} as const;

export const GENERATED_DEV_DEPENDENCIES = {
  '@types/bun': '^1.4.3',
  'drizzle-kit': '^0.31.11',
  // drizzle-kit has no Bun.SQL driver; `postgres` serves `db:push` / `db:studio` only.
  postgres: '^3.4.9',
  typescript: '^7.0.2',
} as const;

export const MIN_BUN_VERSION = '1.3.0';
