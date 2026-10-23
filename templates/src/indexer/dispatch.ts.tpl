/** Route a page of events to handlers, batching consecutive same-type runs. */
import type { Tx } from '../db/client';
import type { Handler } from '../handlers/types';
import type { ChainEvent } from '../sui/client';

/** `0xabc::lease::LeasedEvent<0x2::sui::SUI>` -> `lease::LeasedEvent`. */
export const dispatchKey = (type: string): string => {
  const end = type.indexOf('<');
  const parts = (end === -1 ? type : type.slice(0, end)).split('::');
  return `${parts[1]}::${parts[2]}`;
};

/**
 * Run-length batching keeps ledger order across types (handlers may depend on
 * it) while still giving each handler a multi-row insert in the common case.
 * Returns the keys that had no handler.
 */
export const dispatchPage = async (
  tx: Tx,
  events: ChainEvent[],
  handlers: Record<string, Handler>,
): Promise<string[]> => {
  const unknown: string[] = [];
  const keys = events.map((e) => dispatchKey(e.type));

  for (let start = 0; start < events.length; ) {
    const key = keys[start]!;
    let end = start + 1;
    while (end < events.length && keys[end] === key) end++;

    const handler = handlers[key];
    if (handler) await handler(tx, events.slice(start, end));
    else unknown.push(key);

    start = end;
  }

  return unknown;
};
