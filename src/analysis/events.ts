/**
 * Event discovery and dependency resolution.
 *
 * Events are found from `event::emit<T>` call sites in the disassembly, not
 * guessed from abilities: a `copy, drop` struct is not necessarily an event,
 * and only emitted types ever reach the chain.
 */
import type { ModuleInfo, PackageInfo, PackageReader } from '../sui/packageReader';
import {
  datatypeKey,
  type MoveDatatype,
  type MoveType,
  MOVE_STDLIB,
  SUI_FRAMEWORK,
} from '../sui/moveTypes';

export interface EventDefinition {
  module: string;
  name: string;
  /** Defining package id: the address in the on-chain event type. */
  definingId: string;
  datatype: MoveDatatype;
}

/**
 * `Call event::emit<Foo>(...)`, `event::emit<Foo<T>>`, and the newer
 * `event::emit_authenticated<Foo>`. Sui's verifier only allows emitting types
 * defined in the calling module, so the captured name is always local.
 */
const EMIT_RE = /\bevent::emit(?:_authenticated)?<(\w+)/g;

export const findEmittedTypeNames = (disassembly: string): Set<string> => {
  const names = new Set<string>();
  for (const match of disassembly.matchAll(EMIT_RE)) names.add(match[1]!);
  return names;
};

/** Every event type emitted by the package, ordered by module then name. */
export const extractEvents = (pkg: PackageInfo): EventDefinition[] => {
  const events: EventDefinition[] = [];

  for (const module of pkg.modules) {
    const local = new Map(module.datatypes.map((d) => [d.name, d]));

    for (const name of findEmittedTypeNames(module.disassembly)) {
      // A generic wrapper (`fun emit<T>(e: T) { event::emit<T>(e) }`) yields a
      // type parameter name here, which is not a local datatype; skip it.
      const datatype = local.get(name);
      if (!datatype || datatype.kind !== 'struct') continue;

      events.push({
        module: module.name,
        name,
        definingId: pkg.typeOrigins.get(`${module.name}::${name}`) ?? pkg.storageId,
        datatype,
      });
    }
  }

  return events.sort((a, b) =>
    a.module === b.module ? a.name.localeCompare(b.name) : a.module.localeCompare(b.module),
  );
};

/**
 * Types rendered as scalars by GraphQL JSON (see `MoveValue.json`), so they need
 * neither an interface nor a recursive fetch.
 */
export const isScalarDatatype = (type: Extract<MoveType, { kind: 'datatype' }>): boolean => {
  if (type.address === MOVE_STDLIB) {
    return type.module === 'string' || type.module === 'ascii';
  }
  if (type.address === SUI_FRAMEWORK) {
    return (
      (type.module === 'object' && (type.name === 'ID' || type.name === 'UID')) ||
      (type.module === 'balance' && type.name === 'Balance') ||
      (type.module === 'url' && type.name === 'Url')
    );
  }
  return false;
};

/** Plain boolean (not a type guard): a guard would narrow the false branch to `never`. */
export const isOptionType = (type: MoveType): boolean =>
  type.kind === 'datatype' &&
  type.address === MOVE_STDLIB &&
  type.module === 'option' &&
  type.name === 'Option';

/**
 * Walk every event's fields and load each nested datatype (local or from
 * another package), so the generated TS interfaces are complete.
 * Returns datatypes keyed by `datatypeKey`, events included.
 */
export const collectDatatypes = async (
  events: EventDefinition[],
  modules: ModuleInfo[],
  reader: PackageReader,
): Promise<Map<string, MoveDatatype>> => {
  const result = new Map<string, MoveDatatype>();
  const local = new Map<string, MoveDatatype>();
  for (const m of modules) {
    for (const d of m.datatypes) local.set(datatypeKey(d.address, d.module, d.name), d);
  }

  const visitType = async (type: MoveType): Promise<void> => {
    if (type.kind === 'vector') return visitType(type.of);
    if (type.kind !== 'datatype') return;

    await Promise.all(type.typeArgs.map(visitType));
    if (isOptionType(type) || isScalarDatatype(type)) return;

    const key = datatypeKey(type.address, type.module, type.name);
    if (result.has(key)) return;

    const datatype =
      local.get(key) ?? (await reader.readDatatype(type.address, type.module, type.name));
    if (!datatype || result.has(key)) return;

    await visitDatatype(datatype);
  };

  const visitDatatype = async (datatype: MoveDatatype): Promise<void> => {
    const key = datatypeKey(datatype.address, datatype.module, datatype.name);
    if (result.has(key)) return;
    result.set(key, datatype);

    const fields = [...datatype.fields, ...datatype.variants.flatMap((v) => v.fields)];
    await Promise.all(fields.map((f) => visitType(f.type)));
  };

  for (const event of events) await visitDatatype(event.datatype);
  return result;
};
