/**
 * Files copied verbatim into every generated project.
 *
 * Imported as text so `bun build` inlines them into the CLI bundle: the
 * published package needs no template directory at runtime.
 */
import drizzleConfig from '../../templates/drizzle.config.ts.tpl' with { type: 'text' };
import gitignore from '../../templates/gitignore.tpl' with { type: 'text' };
import env from '../../templates/src/config/env.ts.tpl' with { type: 'text' };
import dbClient from '../../templates/src/db/client.ts.tpl' with { type: 'text' };
import dbColumns from '../../templates/src/db/columns.ts.tpl' with { type: 'text' };
import dbCursors from '../../templates/src/db/cursors.ts.tpl' with { type: 'text' };
import dbMigrate from '../../templates/src/db/migrate.ts.tpl' with { type: 'text' };
import handlerTypes from '../../templates/src/handlers/types.ts.tpl' with { type: 'text' };
import indexerEntry from '../../templates/src/indexer.ts.tpl' with { type: 'text' };
import dispatch from '../../templates/src/indexer/dispatch.ts.tpl' with { type: 'text' };
import stream from '../../templates/src/indexer/stream.ts.tpl' with { type: 'text' };
import decodeTest from '../../templates/src/lib/decode.test.ts.tpl' with { type: 'text' };
import decode from '../../templates/src/lib/decode.ts.tpl' with { type: 'text' };
import logger from '../../templates/src/lib/log.ts.tpl' with { type: 'text' };
import sleep from '../../templates/src/lib/sleep.ts.tpl' with { type: 'text' };
import server from '../../templates/src/server.ts.tpl' with { type: 'text' };
import suiClient from '../../templates/src/sui/client.ts.tpl' with { type: 'text' };
import tsconfig from '../../templates/tsconfig.json.tpl' with { type: 'text' };

/** Project-relative path -> contents. */
export const STATIC_FILES: Record<string, string> = {
  '.gitignore': gitignore,
  'drizzle.config.ts': drizzleConfig,
  'tsconfig.json': tsconfig,
  'src/config/env.ts': env,
  'src/db/client.ts': dbClient,
  'src/db/columns.ts': dbColumns,
  'src/db/cursors.ts': dbCursors,
  'src/db/migrate.ts': dbMigrate,
  'src/handlers/types.ts': handlerTypes,
  'src/indexer.ts': indexerEntry,
  'src/indexer/dispatch.ts': dispatch,
  'src/indexer/stream.ts': stream,
  'src/lib/decode.ts': decode,
  'src/lib/decode.test.ts': decodeTest,
  'src/lib/log.ts': logger,
  'src/lib/sleep.ts': sleep,
  'src/server.ts': server,
  'src/sui/client.ts': suiClient,
};
