import { describe, expect, it } from 'bun:test';

import type { EventDefinition } from '../src/analysis/events';
import { planEventTables } from '../src/codegen/model';
import { kebabCase, snakeCase, tableName, uniqueNamer } from '../src/codegen/naming';
import { assignTypeNames, tsTypeFor } from '../src/codegen/typescript';
import { datatypeKey, type MoveDatatype, type MoveType, normalizeAddress } from '../src/sui/moveTypes';

const PKG = normalizeAddress('0xabc');
const STD = normalizeAddress('0x1');
const SUI = normalizeAddress('0x2');

const dt = (address: string, module: string, name: string, typeArgs: MoveType[] = []): MoveType => ({
  kind: 'datatype',
  address,
  module,
  name,
  typeArgs,
});
const u = (name: 'u8' | 'u32' | 'u64' | 'u128' | 'u256' | 'bool' | 'address'): MoveType => ({ kind: 'primitive', name });
const option = (inner: MoveType) => dt(STD, 'option', 'Option', [inner]);

const datatype = (partial: Partial<MoveDatatype> & Pick<MoveDatatype, 'module' | 'name'>): MoveDatatype => ({
  address: PKG,
  abilities: ['copy', 'drop'],
  typeParameters: [],
  kind: 'struct',
  fields: [],
  variants: [],
  ...partial,
});

const term = datatype({
  module: 'license',
  name: 'LeaseTerm',
  kind: 'enum',
  variants: [{ name: 'SixMonths', fields: [] }, { name: 'TwelveMonths', fields: [] }],
});
const lock = datatype({ module: 'license', name: 'Lock', fields: [{ name: 'end_ms', type: u('u64') }] });
const event = datatype({
  module: 'lease',
  name: 'Everything',
  fields: [
    { name: 'flag', type: u('bool') },
    { name: 'small', type: u('u8') },
    { name: 'mid', type: u('u32') },
    { name: 'amount', type: u('u64') },
    { name: 'huge', type: u('u256') },
    { name: 'who', type: u('address') },
    { name: 'id', type: dt(SUI, 'object', 'ID') },
    { name: 'label', type: dt(STD, 'string', 'String') },
    { name: 'bytes', type: { kind: 'vector', of: u('u8') } },
    { name: 'ids', type: { kind: 'vector', of: dt(SUI, 'object', 'ID') } },
    { name: 'maybe', type: option(u('u64')) },
    { name: 'term', type: dt(PKG, 'license', 'LeaseTerm') },
    { name: 'lock', type: option(dt(PKG, 'license', 'Lock')) },
    { name: 'balance', type: dt(SUI, 'balance', 'Balance', [dt(SUI, 'sui', 'SUI')]) },
    { name: 'sui_sender', type: u('address') },
  ],
});

const all = new Map([term, lock, event].map((d) => [datatypeKey(d.address, d.module, d.name), d]));
const names = assignTypeNames(all.values());
const eventDef: EventDefinition = { module: 'lease', name: 'Everything', definingId: PKG, datatype: event };

describe('naming', () => {
  it('converts cases', () => {
    expect(snakeCase('LeasedEvent')).toBe('leased_event');
    expect(snakeCase('NFTMinted')).toBe('nft_minted');
    expect(kebabCase('MarketPausedEvent')).toBe('market-paused-event');
  });

  it('keeps table names within Postgres limits, stably', () => {
    const long = tableName('a_really_long_module_name', 'AnEvenLongerEventNameThatKeepsGoing');
    expect(long.length).toBeLessThanOrEqual(50);
    expect(tableName('a_really_long_module_name', 'AnEvenLongerEventNameThatKeepsGoing')).toBe(long);
  });

  it('hands out unique names', () => {
    const next = uniqueNamer(['taken']);
    expect([next('taken'), next('x'), next('x')]).toEqual(['taken2', 'x', 'x2']);
  });
});

describe('tsTypeFor (GraphQL MoveValue.json rendering)', () => {
  it('maps primitives, options, vectors and datatypes', () => {
    expect(tsTypeFor(u('u32'), names)).toBe('number');
    expect(tsTypeFor(u('u64'), names)).toBe('string');
    expect(tsTypeFor({ kind: 'vector', of: u('u8') }, names)).toBe('string');
    expect(tsTypeFor(option(u('u64')), names)).toBe('string | null');
    expect(tsTypeFor({ kind: 'vector', of: option(u('bool')) }, names)).toBe('(boolean | null)[]');
    expect(tsTypeFor(dt(PKG, 'license', 'Lock'), names)).toBe('Lock');
    expect(tsTypeFor(dt(PKG, 'other', 'Missing'), names)).toBe('unknown');
  });

  it('prefixes the module on name collisions', () => {
    const a = datatype({ module: 'alpha', name: 'Created' });
    const b = datatype({ module: 'beta', name: 'Created' });
    const collided = assignTypeNames([a, b]);
    expect([...collided.values()]).toEqual(['AlphaCreated', 'BetaCreated']);
  });
});

describe('planEventTables', () => {
  const [plan] = planEventTables([eventDef], all, names);
  const col = (field: string) => plan!.columns.find((c) => c.field === field)!;

  it('picks exact, queryable column types', () => {
    expect(col('flag').builder).toBe("boolean('flag')");
    expect(col('small').builder).toBe("integer('small')");
    expect(col('mid').builder).toBe("bigint('mid', { mode: 'number' })");
    expect(col('amount').builder).toBe("numeric('amount', { precision: 20, scale: 0 })");
    expect(col('huge').builder).toBe("numeric('huge', { precision: 78, scale: 0 })");
    expect(col('id').decoder).toBe('asText');
    expect(col('label').decoder).toBe('asText');
    expect(col('bytes').builder).toBe("text('bytes')");
    expect(col('balance').decoder).toBe('asNumeric');
  });

  it('maps Option<T> to a nullable column of T', () => {
    expect(col('maybe')).toMatchObject({ optional: true, decoder: 'asNumeric' });
    expect(col('lock')).toMatchObject({ optional: true, decoder: 'asJson', jsonType: 'Lock' });
  });

  it('stores fieldless enums as their variant name, everything else as typed jsonb', () => {
    expect(col('term')).toMatchObject({ builder: "text('term')", decoder: 'asVariant' });
    expect(col('ids')).toMatchObject({ builder: "jsonb('ids')", jsonType: 'string[]' });
  });

  it('never lets a Move field collide with the sui_* meta columns', () => {
    expect(col('sui_sender')).toMatchObject({ key: 'suiSender2', column: 'sui_sender2' });
  });

  it('names table, route and dispatch key', () => {
    expect(plan).toMatchObject({
      table: 'lease_everything',
      tableConst: 'leaseEverything',
      route: '/events/lease/everything',
      dispatchKey: 'lease::Everything',
    });
  });
});
