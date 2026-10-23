/**
 * Runtime configuration, validated once at startup. Bun loads `.env` itself.
 *
 * Defaults come from `src/generated/package.ts` (what the generator saw), so a
 * fresh project runs with only `DATABASE_URL` set; every value can be overridden
 * per deployment (e.g. the same code on testnet and mainnet).
 */
import { z } from 'zod';

import { GENERATED } from '../generated/package';

const csv = z
  .string()
  .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean));

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(4),

  SUI_NETWORK: z.enum(['mainnet', 'testnet', 'devnet']).default(GENERATED.network),
  /** Override the public GraphQL endpoint (dedicated RPC providers, local node). */
  SUI_GRAPHQL_URL: z.url().optional(),
  /** Comma separated defining package ids; one stream each. */
  EVENT_PACKAGE_IDS: csv.optional(),

  /** Delay between polls once caught up. Subsecond values are fine (min 50ms). */
  POLLING_INTERVAL_MS: z.coerce.number().int().min(50).default(GENERATED.pollingIntervalMs),
  /**
   * When > POLLING_INTERVAL_MS, empty polls double the delay up to this cap and
   * the first event snaps it back. Trades worst-case latency for fewer requests
   * on quiet packages. 0 = fixed interval.
   */
  IDLE_BACKOFF_MAX_MS: z.coerce.number().int().min(0).default(0),
  /** Cap of the exponential retry delay after a failed page. */
  ERROR_BACKOFF_MAX_MS: z.coerce.number().int().min(100).default(30_000),
  /** Events per request. Public servers cap this at 50. */
  PAGE_SIZE: z.coerce.number().int().min(1).max(50).default(50),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),
  /** Only used when a stream has no stored cursor yet: skip history up to this checkpoint. */
  START_CHECKPOINT: z.coerce.number().int().min(0).optional(),

  PORT: z.coerce.number().int().min(0).default(3000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
