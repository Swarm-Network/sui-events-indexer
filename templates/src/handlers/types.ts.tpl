/** Handler contract shared by every generated module handler. */
import type { Tx } from '../db/client';
import type { ChainEvent } from '../sui/client';

/** A chain event whose `json` is typed as the Move struct's GraphQL rendering. */
export type IndexedEvent<T> = Omit<ChainEvent, 'json'> & { json: T };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers narrow `json` themselves.
export type Handler = (tx: Tx, events: IndexedEvent<any>[]) => Promise<void>;

/** Values of the shared `sui_*` columns (see `src/db/columns.ts`). */
export const eventMeta = (e: IndexedEvent<unknown>) => ({
  suiTxDigest: e.txDigest,
  suiEventSeq: e.eventSeq,
  suiCheckpoint: e.checkpoint,
  suiTimestamp: e.timestamp,
  suiSender: e.sender,
});
