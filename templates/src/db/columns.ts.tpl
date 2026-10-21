/**
 * Columns shared by every event table. `sui_` prefixed so Move field names can
 * never collide with them.
 */
import { bigint, integer, text, timestamp } from 'drizzle-orm/pg-core';

export const eventColumns = () => ({
  suiTxDigest: text('sui_tx_digest').notNull(),
  /** Index of the event within its transaction. */
  suiEventSeq: integer('sui_event_seq').notNull(),
  suiCheckpoint: bigint('sui_checkpoint', { mode: 'number' }),
  suiTimestamp: timestamp('sui_timestamp', { withTimezone: true, mode: 'date' }),
  suiSender: text('sui_sender').notNull(),
});
