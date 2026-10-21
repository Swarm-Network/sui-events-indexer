/**
 * Identifier helpers shared by every generator. All pure.
 */

/** `lease_book` / `LeaseBook` -> `leaseBook`. */
export const camelCase = (value: string): string => {
  const parts = value.split(/[_\-\s]+/).filter(Boolean);
  return parts
    .map((part, i) => (i === 0 ? part[0]!.toLowerCase() + part.slice(1) : pascalCase(part)))
    .join('');
};

/** `lease_book` -> `LeaseBook`. */
export const pascalCase = (value: string): string =>
  value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');

/** `LeasedEvent` -> `leased_event`, `NFTMinted` -> `nft_minted`. */
export const snakeCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();

/** `LeasedEvent` -> `leased-event`. */
export const kebabCase = (value: string): string => snakeCase(value).replace(/_/g, '-');

/** Postgres truncates identifiers at 63 bytes; keep room for `_pk`/`_idx` suffixes. */
const MAX_TABLE_NAME = 50;

/** FNV-1a, 32-bit; only used to keep truncated identifiers unique and stable. */
const shortHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
};

export const tableName = (module: string, event: string): string => {
  const full = `${snakeCase(module)}_${snakeCase(event)}`;
  if (full.length <= MAX_TABLE_NAME) return full;
  return `${full.slice(0, MAX_TABLE_NAME - 7)}_${shortHash(full)}`;
};

/**
 * Returns a function handing out unique names: the first `x` stays `x`, later
 * ones become `x2`, `x3`... Names in `reserved` are never handed out.
 */
export const uniqueNamer = (reserved: Iterable<string> = []) => {
  const taken = new Set(reserved);
  return (wanted: string): string => {
    let name = wanted;
    for (let i = 2; taken.has(name); i++) name = `${wanted}${i}`;
    taken.add(name);
    return name;
  };
};

/** Valid npm package / directory name check (lowercase, url-safe). */
export const isValidProjectName = (value: string): boolean =>
  /^[a-z0-9][a-z0-9._-]*$/.test(value) && value.length <= 214;
