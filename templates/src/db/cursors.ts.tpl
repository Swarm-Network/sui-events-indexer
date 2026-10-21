/** Stream cursor persistence. Written in the same transaction as the page it follows. */
import { eq } from 'drizzle-orm';

import { db, type Tx } from './client';
import { indexerCursors } from './schema';

export const loadCursor = async (id: string): Promise<string | null> => {
  const [row] = await db
    .select({ cursor: indexerCursors.cursor })
    .from(indexerCursors)
    .where(eq(indexerCursors.id, id))
    .limit(1);
  return row?.cursor ?? null;
};

export const saveCursor = (tx: Tx, id: string, cursor: string) =>
  tx
    .insert(indexerCursors)
    .values({ id, cursor })
    .onConflictDoUpdate({
      target: indexerCursors.id,
      set: { cursor, updatedAt: new Date() },
    });
