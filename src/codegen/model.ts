/**
 * The generation model: one `EventTablePlan` per event, holding every name and
 * column decision. Schema, handler and route renderers only read this, so all
 * naming / mapping rules live in one place.
 */
import { type EventDefinition, isOptionType, isScalarDatatype } from '../analysis/events';
import {
  datatypeKey,
  formatMoveType,
  type MoveDatatype,
  type MoveType,
} from '../sui/moveTypes';
import { camelCase, kebabCase, pascalCase, tableName, uniqueNamer } from './naming';
import { isFieldlessEnum, type TypeNames, tsTypeFor } from './typescript';

/** Decoder helpers exported by the generated `src/lib/decode.ts`. */
export type Decoder = 'asText' | 'asBool' | 'asInt' | 'asNumeric' | 'asVariant' | 'asJson';

export interface ColumnPlan {
  /** Move field name; also the key in event JSON. */
  field: string;
  /** Property name on the Drizzle table / insert object. */
  key: string;
  /** SQL column name. */
  column: string;
  /** Drizzle builder expression, e.g. `numeric('price', { precision: 20, scale: 0 })`. */
  builder: string;
  decoder: Decoder;
  optional: boolean;
  /** TS type for `$type<>()` on jsonb columns. */
  jsonType?: string;
  moveType: string;
}

export interface EventTablePlan {
  event: EventDefinition;
  /** `module::Name`: the dispatch key (address-agnostic). */
  dispatchKey: string;
  /** TS interface name for the event JSON. */
  typeName: string;
  /** Exported Drizzle table constant. */
  tableConst: string;
  /** SQL table name. */
  table: string;
  /** REST path. */
  route: string;
  /** Generic events keep the full type string (type args) in `sui_event_type`. */
  generic: boolean;
  columns: ColumnPlan[];
}

/** Columns every event table carries; Move fields can never take these names. */
export const META_KEYS = ['suiTxDigest', 'suiEventSeq', 'suiCheckpoint', 'suiTimestamp', 'suiSender', 'suiEventType'];
const META_COLUMNS = META_KEYS.map((k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));

const numeric = (column: string, precision: number) =>
  `numeric('${column}', { precision: ${precision}, scale: 0 })`;

/** Scalar (non-JSON) column for a Move type, or undefined when it must be jsonb. */
const scalarColumn = (
  type: MoveType,
  column: string,
  datatypes: Map<string, MoveDatatype>,
): { builder: string; decoder: Decoder } | undefined => {
  if (type.kind === 'primitive') {
    switch (type.name) {
      case 'bool':
        return { builder: `boolean('${column}')`, decoder: 'asBool' };
      case 'u8':
      case 'u16':
        return { builder: `integer('${column}')`, decoder: 'asInt' };
      case 'u32':
        // u32 max exceeds int4; bigint in number mode is exact for it.
        return { builder: `bigint('${column}', { mode: 'number' })`, decoder: 'asInt' };
      case 'u64':
        return { builder: numeric(column, 20), decoder: 'asNumeric' };
      case 'u128':
        return { builder: numeric(column, 39), decoder: 'asNumeric' };
      case 'u256':
        return { builder: numeric(column, 78), decoder: 'asNumeric' };
      case 'address':
      case 'signer':
        return { builder: `text('${column}')`, decoder: 'asText' };
    }
  }

  // vector<u8> is rendered as a base64 string.
  if (type.kind === 'vector' && type.of.kind === 'primitive' && type.of.name === 'u8') {
    return { builder: `text('${column}')`, decoder: 'asText' };
  }

  if (type.kind === 'datatype') {
    if (type.module === 'balance' && isScalarDatatype(type)) {
      return { builder: numeric(column, 20), decoder: 'asNumeric' };
    }
    if (isScalarDatatype(type)) return { builder: `text('${column}')`, decoder: 'asText' };

    // Fieldless enums store just the variant name: queryable and compact.
    const datatype = datatypes.get(datatypeKey(type.address, type.module, type.name));
    if (isFieldlessEnum(datatype)) return { builder: `text('${column}')`, decoder: 'asVariant' };
  }

  return undefined;
};

const planColumn = (
  field: { name: string; type: MoveType },
  key: string,
  column: string,
  datatypes: Map<string, MoveDatatype>,
  names: TypeNames,
): ColumnPlan => {
  const optional = isOptionType(field.type);
  // Option<T> becomes a nullable column of T's mapping.
  const inner = optional ? (field.type as Extract<MoveType, { kind: 'datatype' }>).typeArgs[0]! : field.type;
  const scalar = scalarColumn(inner, column, datatypes);
  const base = { field: field.name, key, column, optional, moveType: formatMoveType(field.type) };

  if (scalar) return { ...base, ...scalar };

  const jsonType = tsTypeFor(inner, names);
  return { ...base, builder: `jsonb('${column}')`, decoder: 'asJson', jsonType };
};

export const planEventTables = (
  events: EventDefinition[],
  datatypes: Map<string, MoveDatatype>,
  names: TypeNames,
): EventTablePlan[] => {
  const tableConsts = uniqueNamer(['indexerCursors']);
  const tables = uniqueNamer(['indexer_cursors']);

  return events.map((event) => {
    const keys = uniqueNamer(META_KEYS);
    const columns = uniqueNamer(META_COLUMNS);
    const typeName = names.get(datatypeKey(event.definingId, event.module, event.name))!;

    return {
      event,
      dispatchKey: `${event.module}::${event.name}`,
      typeName,
      tableConst: tableConsts(camelCase(event.module) + pascalCase(event.name)),
      table: tables(tableName(event.module, event.name)),
      route: `/events/${kebabCase(event.module)}/${kebabCase(event.name)}`,
      generic: event.datatype.typeParameters.length > 0,
      columns: event.datatype.fields.map((f) =>
        planColumn(f, keys(camelCase(f.name)), columns(f.name.toLowerCase()), datatypes, names),
      ),
    };
  });
};
