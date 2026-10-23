/**
 * Minimal structured logger: one JSON line per entry, no dependencies.
 * Reads LOG_LEVEL directly so it works before (and if) env validation fails.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

type Level = keyof typeof LEVELS;
type Fields = Record<string, unknown>;

const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

const write = (level: Level, msg: string, fields?: Fields) => {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
};

export const log = {
  debug: (msg: string, fields?: Fields) => write('debug', msg, fields),
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};

/** Errors do not JSON.stringify; flatten them. */
export const errorFields = (error: unknown): Fields =>
  error instanceof Error ? { err: error.message, stack: error.stack } : { err: String(error) };
