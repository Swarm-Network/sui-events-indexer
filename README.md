# Sui Events Indexer

A CLI that reads a Sui Move package and generates a complete, production-ready
event indexer for it:

- finds every event the package emits (`event::emit<T>` call sites in the bytecode disassembly)
- generates TypeScript types for each event's JSON and every nested struct/enum
- generates a **Drizzle** Postgres schema with exact column types (one table per event)
- scaffolds a low-overhead **Bun** indexer that streams events into Postgres
- scaffolds a REST API (`Bun.serve` routes) to query them

Runs on Bun and `@mysten/sui` 2.x over the **Sui GraphQL** transport. JSON-RPC
is switched off on public fullnodes, and gRPC `ListEvents` is pruned there, so
neither serves full history.

## Prerequisites

- [Bun](https://bun.com) >= 1.3 (developed on 1.4)
- Docker (for the generated project's Postgres), or any Postgres 14+

## Usage

```bash
bunx sui-events-indexer inspect -n testnet \
  -p 0x696f43351e04b3e9ba253c04cc23be860b0288d265fcb19a7ba6c65bb4bd2cdd

bunx sui-events-indexer generate -n testnet \
  -p 0x696f43351e04b3e9ba253c04cc23be860b0288d265fcb19a7ba6c65bb4bd2cdd \
  --name swarm-license-indexer -i 250
```

| Option | Description |
|---|---|
| `-p, --package <id>` | Package id. The original id or any version: the **latest** version is analyzed, so events added by upgrades are included. |
| `-n, --network <network>` | `mainnet` (default), `testnet` or `devnet` |
| `--graphql-url <url>` | Use a dedicated GraphQL endpoint instead of the public one |
| `--pin-version` | Analyze exactly the given version instead of the latest |
| `--name <name>` | `generate`: project name (directory and npm name) |
| `-o, --output <dir>` | `generate`: parent directory (default `.`) |
| `-i, --interval <ms>` | `generate`: polling interval once caught up (default 500, min 50) |
| `--force` | `generate`: write into a non-empty directory |

Then:

```bash
cd swarm-license-indexer
bun install
bun run db:up        # Postgres 18 in Docker
bun run db:setup     # drizzle-kit generate + migrate
bun run indexer
bun run api          # GET /events/<module>/<event-name>?limit=&offset=&sender=
```

## The generated indexer

```
src/
  handlers/<module>.ts   per-module handlers: where business logic goes
  db/schema.ts           Drizzle tables (GENERATED)
  types/moveTypes.ts     event JSON types (GENERATED)
  generated/             package facts + route table (GENERATED)
  indexer/stream.ts      polling loop
  sui/client.ts          GraphQL event pages (SuiGraphQLClient)
  server.ts              REST API
  config/env.ts          zod-validated env
```

### Built for subsecond polling

- **One request per tick for the whole package.** GraphQL filters events by the
  package that defines their type, so N modules cost one request, not N. Upgraded
  packages get one stream per defining package id; DeepBook v3 needs 3.
- **No overlap, no pile-up.** The next poll is scheduled only after the previous
  one finishes. Backlogs drain page after page with no delay.
- **Idle polls skip the DB.** An empty page costs one small HTTP request and
  nothing else.
- **One transaction per page.** Rows and the stream cursor commit together.
  Inserts are idempotent on `(sui_tx_digest, sui_event_seq)`, so a crash, a
  restart or a replay can't skip or duplicate events.
- **Backoff.** Failures retry exponentially, capped by `ERROR_BACKOFF_MAX_MS`.
  `IDLE_BACKOFF_MAX_MS` can also stretch the interval on quiet packages.

Measured with Bun 1.4.3 on an Apple Silicon laptop:

| Scenario | Interval | CPU | RSS |
|---|---|---|---|
| swarm_license (testnet), caught up | 250 ms | ~0.1% (≈1 ms CPU per poll) | 70 MB |
| DeepBook v3 (mainnet), live tail, 3 streams, ~77 events/s | 100 ms | ~2% of one core | 100 MB |

### Column mapping

The mapping follows Sui GraphQL's `MoveValue.json` rendering:

| Move | Column | Notes |
|---|---|---|
| `bool` | `boolean` | |
| `u8`, `u16` | `integer` | |
| `u32` | `bigint` | exceeds int4 |
| `u64`, `Balance<T>` / `u128` / `u256` | `numeric(20/39/78, 0)` | exact; read back as strings |
| `address`, `ID`, `String`, `ascii::String`, `Url` | `text` | |
| `vector<u8>` | `text` | base64 |
| `Option<T>` | nullable column of `T` | |
| enum without fields | `text` | the variant name |
| structs, enums with data, other vectors | `jsonb` | typed with `$type<>()` |

Every table also has `sui_tx_digest`, `sui_event_seq`, `sui_checkpoint`,
`sui_timestamp` and `sui_sender`. Generic events also store `sui_event_type`.
Decoders are strict: an unexpected value throws and rolls back the page, so
nothing gets corrupted silently.

### Why Drizzle (not Prisma)

- **No codegen or engine step.** The schema is plain TypeScript that this CLI
  emits directly. Prisma needs `prisma generate` and a generated client before
  the project even typechecks.
- **Native Bun driver.** `drizzle-orm/bun-sql` runs on `Bun.SQL`, which is
  built in, pooled and caches prepared statements. Prisma 7 goes through a
  driver adapter plus its query compiler.
- **Lean hot path.** Multi-row `insert … on conflict do nothing` with
  near-zero per-query overhead. That matters at subsecond intervals.
- **Same stack as `license-sale-mono-2026`.** Its `@swarm/db` package uses
  Drizzle + Postgres.

## Development

```bash
bun install
bun run check                 # tsc (TypeScript 7) + bun test
bun run dev -- inspect -n testnet -p <id>
bun run build                 # dist/index.js (templates are inlined)
bun test/support/record.ts    # refresh the recorded GraphQL fixture
```

Static project files live in `templates/` as `*.tpl` and are imported as text,
so the published bundle is self-contained. Generated files are rendered in
`src/codegen/render.ts` from the plan in `src/codegen/model.ts`.

### Known limits

- Events emitted only through a generic wrapper of your own
  (`fun emit<T>(e: T) { event::emit(e) }`) aren't detected, because the call
  site names `T` and not a concrete type.
- Regenerating overwrites `src/handlers/*`. Commit before you regenerate.
