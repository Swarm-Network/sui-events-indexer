/**
 * Record / replay GraphQL traffic so tests run offline against real responses.
 * Refresh fixtures with `bun test/support/record.ts`.
 */
import type { GraphqlExecutor } from '../../src/sui/graphql';

export type Recording = { key: string; data: unknown }[];

/** Operation name + variables: stable across runs, independent of whitespace. */
const keyOf = (query: string, variables: Record<string, unknown>) =>
  `${/query\s+(\w+)/.exec(query)?.[1] ?? 'anonymous'} ${JSON.stringify(variables)}`;

export const recordingExecutor = (inner: GraphqlExecutor, out: Recording): GraphqlExecutor => ({
  async execute<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const data = await inner.execute<T>(query, variables);
    out.push({ key: keyOf(query, variables), data });
    return data;
  },
});

export const replayExecutor = (recording: Recording): GraphqlExecutor => {
  const byKey = new Map(recording.map((r) => [r.key, r.data]));
  return {
    async execute<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      const key = keyOf(query, variables);
      if (!byKey.has(key)) throw new Error(`No recorded response for ${key}`);
      return byKey.get(key) as T;
    },
  };
};
