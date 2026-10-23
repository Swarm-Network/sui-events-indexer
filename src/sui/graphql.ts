/**
 * Thin wrapper over the SDK's `SuiGraphQLClient`.
 *
 * GraphQL, not JSON-RPC: JSON-RPC is switched off on the public fullnodes, and
 * GraphQL is the only public transport that serves full event history and
 * package disassembly (needed to find `event::emit<T>` call sites).
 */
import { SuiGraphQLClient } from '@mysten/sui/graphql';

export const GRAPHQL_URLS = {
  mainnet: 'https://graphql.mainnet.sui.io/graphql',
  testnet: 'https://graphql.testnet.sui.io/graphql',
  devnet: 'https://graphql.devnet.sui.io/graphql',
} as const;

export type Network = keyof typeof GRAPHQL_URLS;

export const NETWORKS = Object.keys(GRAPHQL_URLS) as Network[];

export const isNetwork = (value: string): value is Network => value in GRAPHQL_URLS;

/** Minimal surface the readers need; lets tests inject a fake. */
export interface GraphqlExecutor {
  execute<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export class GraphqlError extends Error {
  override name = 'GraphqlError';
}

export const createGraphqlExecutor = (network: Network, url?: string): GraphqlExecutor => {
  const client = new SuiGraphQLClient({ url: url ?? GRAPHQL_URLS[network], network });

  return {
    async execute<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      const { data, errors } = await client.query<T, Record<string, unknown>>({
        query,
        variables,
      });

      // GraphQL reports bad input as `errors` on an HTTP 200; check explicitly.
      if (errors?.length) {
        throw new GraphqlError(errors.map((e) => e.message).join('; '));
      }
      if (data === undefined || data === null) {
        throw new GraphqlError('GraphQL response carried no data');
      }
      return data;
    },
  };
};
