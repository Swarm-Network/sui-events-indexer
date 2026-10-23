/**
 * Event pages over Sui GraphQL via the SDK's `SuiGraphQLClient`.
 *
 * GraphQL, not JSON-RPC (switched off on public fullnodes) nor gRPC
 * `ListEvents` (public fullnodes prune history): GraphQL serves the full event
 * history and filters by type PACKAGE, so one request per tick covers every
 * module of the package.
 */
import { SuiGraphQLClient } from '@mysten/sui/graphql';

import { env } from '../config/env';

export const GRAPHQL_URLS = {
  mainnet: 'https://graphql.mainnet.sui.io/graphql',
  testnet: 'https://graphql.testnet.sui.io/graphql',
  devnet: 'https://graphql.devnet.sui.io/graphql',
} as const;

export const graphql = new SuiGraphQLClient({
  url: env.SUI_GRAPHQL_URL ?? GRAPHQL_URLS[env.SUI_NETWORK],
  network: env.SUI_NETWORK,
});

// Only the fields the indexer stores: smaller responses, less JSON to parse per tick.
const EVENTS_QUERY = `
query Events($type: String!, $first: Int!, $after: String, $afterCheckpoint: UInt53) {
  events(first: $first, after: $after, filter: { type: $type, afterCheckpoint: $afterCheckpoint }) {
    pageInfo { hasNextPage endCursor }
    nodes {
      sequenceNumber
      timestamp
      sender { address }
      transaction { digest effects { checkpoint { sequenceNumber } } }
      contents { type { repr } json }
    }
  }
}`;

type EventsResult = {
  events: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      sequenceNumber: number;
      timestamp: string | null;
      sender: { address: string } | null;
      transaction: { digest: string; effects: { checkpoint: { sequenceNumber: number } | null } | null } | null;
      contents: { type: { repr: string }; json: unknown } | null;
    }[];
  } | null;
};

export interface ChainEvent {
  txDigest: string;
  eventSeq: number;
  checkpoint: number | null;
  timestamp: Date | null;
  sender: string;
  /** Full event type, e.g. `0x…::lease::LeasedEvent`. */
  type: string;
  json: Record<string, unknown>;
}

export interface EventsPage {
  events: ChainEvent[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export class GraphqlError extends Error {
  override name = 'GraphqlError';
}

/** One forward (oldest-first) page of events whose type is defined in `typePackage`. */
export const fetchEventsPage = async (options: {
  typePackage: string;
  after: string | null;
  afterCheckpoint?: number;
  signal?: AbortSignal;
}): Promise<EventsPage> => {
  const timeout = AbortSignal.timeout(env.REQUEST_TIMEOUT_MS);
  const { data, errors } = await graphql.query<EventsResult, Record<string, unknown>>({
    query: EVENTS_QUERY,
    variables: {
      type: options.typePackage,
      first: env.PAGE_SIZE,
      after: options.after,
      afterCheckpoint: options.afterCheckpoint ?? null,
    },
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });

  // Errors arrive on HTTP 200; an unchecked one would look like an empty page.
  if (errors?.length) throw new GraphqlError(errors.map((e) => e.message).join('; '));
  if (!data?.events) throw new GraphqlError('GraphQL response carried no events');

  const events: ChainEvent[] = [];
  for (const node of data.events.nodes) {
    if (!node.transaction || !node.contents || !node.sender) {
      throw new GraphqlError('Event node is missing transaction, contents or sender');
    }
    events.push({
      txDigest: node.transaction.digest,
      eventSeq: node.sequenceNumber,
      checkpoint: node.transaction.effects?.checkpoint?.sequenceNumber ?? null,
      timestamp: node.timestamp ? new Date(node.timestamp) : null,
      sender: node.sender.address,
      type: node.contents.type.repr,
      json: (node.contents.json ?? {}) as Record<string, unknown>,
    });
  }

  return {
    events,
    hasNextPage: data.events.pageInfo.hasNextPage,
    endCursor: data.events.pageInfo.endCursor,
  };
};
