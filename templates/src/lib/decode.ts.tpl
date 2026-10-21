/**
 * Strict decoders from Sui GraphQL event JSON (`MoveValue.json`) to column values.
 *
 * They THROW instead of guessing: a renderer change that silently turned values
 * into null/0 would corrupt the index, while a throw rolls back the page and
 * keeps the cursor where it was until the handler is fixed.
 */
export class DecodeError extends Error {
  override name = 'DecodeError';
}

const fail = (field: string, expected: string, value: unknown): never => {
  throw new DecodeError(`Field "${field}": expected ${expected}, got ${JSON.stringify(value)}`);
};

/** address, ID, String, Url, base64 vector<u8>. */
export const asText = (value: unknown, field: string): string =>
  typeof value === 'string' ? value : fail(field, 'string', value);

export const asBool = (value: unknown, field: string): boolean =>
  typeof value === 'boolean' ? value : fail(field, 'boolean', value);

/** u8 / u16 / u32: JSON numbers. */
export const asInt = (value: unknown, field: string): number => {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : fail(field, 'unsigned integer', value);
};

/** u64 / u128 / u256 / Balance: decimal strings, kept as strings (numeric columns). */
export const asNumeric = (value: unknown, field: string): string => {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'bigint' && value >= 0n) return value.toString();
  return fail(field, 'unsigned integer string', value);
};

/** Fieldless enum: `{ "@variant": "Name" }` -> `"Name"`. */
export const asVariant = (value: unknown, field: string): string => {
  if (typeof value === 'string') return value;
  const variant = (value as { '@variant'?: unknown } | null)?.['@variant'];
  return typeof variant === 'string' ? variant : fail(field, 'enum variant', value);
};

/** Structs, enums with data, vectors: stored as jsonb, as rendered. */
export const asJson = <T>(value: unknown, field: string): T =>
  value === undefined ? fail(field, 'a value', value) : (value as T);

/**
 * Option<T>: GraphQL renders none as `null` and some as the bare value; the
 * legacy `{ vec: [] | [x] }` rendering is accepted too.
 */
export const asOption = <T>(
  value: unknown,
  field: string,
  inner: (value: unknown, field: string) => T,
): T | null => {
  if (value === null || value === undefined) return null;
  const vec = (value as { vec?: unknown } | null)?.vec;
  if (Array.isArray(vec) && Object.keys(value as object).length === 1) {
    if (vec.length === 0) return null;
    if (vec.length === 1) return inner(vec[0], field);
    return fail(field, 'option (0 or 1 element)', value);
  }
  return inner(value, field);
};
