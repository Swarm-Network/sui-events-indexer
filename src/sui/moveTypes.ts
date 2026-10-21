/**
 * Transport-neutral model of Move types and datatypes.
 *
 * Everything downstream (event detection, TS codegen, Drizzle codegen) works on
 * these shapes only, so swapping the transport (GraphQL today) never touches
 * the generators.
 */

/** Primitive Move types as rendered by the GraphQL `OpenMoveTypeSignatureBody`. */
export type MovePrimitive =
  | 'bool'
  | 'u8'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'u128'
  | 'u256'
  | 'address'
  | 'signer';

export type MoveType =
  | { kind: 'primitive'; name: MovePrimitive }
  | { kind: 'vector'; of: MoveType }
  | {
      kind: 'datatype';
      /** Normalized 0x-prefixed, 64-hex address of the DEFINING package. */
      address: string;
      module: string;
      name: string;
      typeArgs: MoveType[];
    }
  | { kind: 'typeParameter'; index: number };

export interface MoveField {
  name: string;
  type: MoveType;
}

export interface MoveVariant {
  name: string;
  fields: MoveField[];
}

export interface MoveDatatype {
  /** Normalized address the datatype was read from (its defining package). */
  address: string;
  module: string;
  name: string;
  abilities: string[];
  typeParameters: { isPhantom: boolean }[];
  kind: 'struct' | 'enum';
  fields: MoveField[];
  variants: MoveVariant[];
}

const PRIMITIVES = new Set<string>([
  'bool',
  'u8',
  'u16',
  'u32',
  'u64',
  'u128',
  'u256',
  'address',
  'signer',
]);

/** Pad an address to the canonical 0x + 64 hex form used across the codebase. */
export const normalizeAddress = (address: string): string => {
  const hex = address.toLowerCase().replace(/^0x/, '');
  return `0x${hex.padStart(64, '0')}`;
};

/** Stable map key for a datatype: `0xaddr::module::Name`. */
export const datatypeKey = (address: string, module: string, name: string) =>
  `${normalizeAddress(address)}::${module}::${name}`;

/**
 * Parse a GraphQL `OpenMoveTypeSignatureBody` JSON value.
 *
 * Shapes seen on the wire:
 *   "u64" | { vector: Body } | { datatype: { package, module, type, typeParameters } }
 *   | { typeParameter: number }
 */
export const parseSignatureBody = (body: unknown): MoveType => {
  if (typeof body === 'string') {
    if (PRIMITIVES.has(body)) return { kind: 'primitive', name: body as MovePrimitive };
    throw new Error(`Unknown primitive Move type: ${body}`);
  }

  if (body && typeof body === 'object') {
    const value = body as Record<string, unknown>;

    if ('vector' in value) return { kind: 'vector', of: parseSignatureBody(value.vector) };

    if ('typeParameter' in value) {
      return { kind: 'typeParameter', index: Number(value.typeParameter) };
    }

    if ('datatype' in value) {
      const dt = value.datatype as {
        package: string;
        module: string;
        type: string;
        typeParameters?: unknown[];
      };
      return {
        kind: 'datatype',
        address: normalizeAddress(dt.package),
        module: dt.module,
        name: dt.type,
        typeArgs: (dt.typeParameters ?? []).map(parseSignatureBody),
      };
    }
  }

  throw new Error(`Unsupported Move type signature: ${JSON.stringify(body)}`);
};

/** Well-known framework addresses (normalized). */
export const MOVE_STDLIB = normalizeAddress('0x1');
export const SUI_FRAMEWORK = normalizeAddress('0x2');

/** True when `type` is `address::module::name` (args ignored). */
export const isDatatype = (
  type: MoveType,
  address: string,
  module: string,
  name: string,
): type is Extract<MoveType, { kind: 'datatype' }> =>
  type.kind === 'datatype' &&
  type.address === address &&
  type.module === module &&
  type.name === name;

/** Human readable Move type, for comments and logs. */
export const formatMoveType = (type: MoveType): string => {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'vector':
      return `vector<${formatMoveType(type.of)}>`;
    case 'typeParameter':
      return `T${type.index}`;
    case 'datatype': {
      const short =
        type.address === MOVE_STDLIB ? '0x1' : type.address === SUI_FRAMEWORK ? '0x2' : type.address;
      const args = type.typeArgs.length ? `<${type.typeArgs.map(formatMoveType).join(', ')}>` : '';
      return `${short}::${type.module}::${type.name}${args}`;
    }
  }
};
