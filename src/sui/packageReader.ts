/**
 * Reads a Move package (modules, disassembly, datatypes, type origins) over
 * Sui GraphQL and normalizes it into `moveTypes.ts` shapes.
 */
import type { GraphqlExecutor } from './graphql';
import {
  datatypeKey,
  type MoveDatatype,
  type MoveField,
  normalizeAddress,
  parseSignatureBody,
} from './moveTypes';

export interface ModuleInfo {
  name: string;
  /** Bytecode disassembly; the only place `event::emit<T>` call sites are visible. */
  disassembly: string;
  datatypes: MoveDatatype[];
}

export interface PackageInfo {
  /** Id the user passed in. */
  requestedId: string;
  /** Storage id of the version that was analyzed (latest unless pinned). */
  storageId: string;
  version: number;
  modules: ModuleInfo[];
  /** `module::Name` -> defining package id. Event types carry THIS address on chain. */
  typeOrigins: Map<string, string>;
}

// Disassembly is large; small pages keep every response well under server limits.
const MODULE_PAGE_SIZE = 10;
const DATATYPE_PAGE_SIZE = 50;

const DATATYPE_FIELDS = `
  name
  abilities
  typeParameters { isPhantom }
  asMoveStruct { fields { name type { signature } } }
  asMoveEnum { variants { name fields { name type { signature } } } }
`;

const PACKAGE_QUERY = `
query Package($address: SuiAddress!) {
  package(address: $address) {
    address
    version
    packageVersionsAfter(last: 1) { nodes { address version } }
  }
}`;

const PACKAGE_DETAILS_QUERY = `
query PackageDetails($address: SuiAddress!) {
  package(address: $address) {
    typeOrigins { module struct definingId }
  }
}`;

const MODULES_QUERY = `
query Modules($address: SuiAddress!, $first: Int!, $after: String) {
  package(address: $address) {
    modules(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { name disassembly }
    }
  }
}`;

const DATATYPES_QUERY = `
query Datatypes($address: SuiAddress!, $module: String!, $first: Int!, $after: String) {
  package(address: $address) {
    module(name: $module) {
      datatypes(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${DATATYPE_FIELDS} }
      }
    }
  }
}`;

const DATATYPE_QUERY = `
query Datatype($address: SuiAddress!, $module: String!, $name: String!) {
  package(address: $address) {
    module(name: $module) {
      datatype(name: $name) { ${DATATYPE_FIELDS} }
    }
  }
}`;

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

type RawField = { name: string; type: { signature: { body: unknown } } };

type RawDatatype = {
  name: string;
  abilities: string[] | null;
  typeParameters: { isPhantom: boolean }[] | null;
  asMoveStruct: { fields: RawField[] | null } | null;
  asMoveEnum: { variants: { name: string; fields: RawField[] | null }[] | null } | null;
};

const toFields = (fields: RawField[] | null | undefined): MoveField[] =>
  (fields ?? []).map((f) => ({ name: f.name, type: parseSignatureBody(f.type.signature.body) }));

const toDatatype = (address: string, module: string, raw: RawDatatype): MoveDatatype => ({
  address,
  module,
  name: raw.name,
  abilities: (raw.abilities ?? []).map((a) => a.toLowerCase()),
  typeParameters: raw.typeParameters ?? [],
  kind: raw.asMoveEnum ? 'enum' : 'struct',
  fields: toFields(raw.asMoveStruct?.fields),
  variants: (raw.asMoveEnum?.variants ?? []).map((v) => ({
    name: v.name,
    fields: toFields(v.fields),
  })),
});

export class PackageReader {
  /** Remote datatype cache, keyed by `datatypeKey`. Dependency walks revisit types a lot. */
  private datatypeCache = new Map<string, Promise<MoveDatatype | null>>();

  constructor(private readonly gql: GraphqlExecutor) {}

  /**
   * Load a package. By default the LATEST version is analyzed, so events added
   * by upgrades are picked up even when the original id is passed.
   */
  async readPackage(packageId: string, options: { pinVersion?: boolean } = {}): Promise<PackageInfo> {
    const requestedId = normalizeAddress(packageId);
    const head = await this.gql.execute<{
      package: {
        address: string;
        version: number;
        packageVersionsAfter: { nodes: { address: string; version: number }[] } | null;
      } | null;
    }>(PACKAGE_QUERY, { address: requestedId });

    if (!head.package) throw new Error(`Package ${requestedId} not found on this network`);

    const latest = options.pinVersion ? undefined : head.package.packageVersionsAfter?.nodes.at(-1);
    const storageId = normalizeAddress(latest?.address ?? head.package.address);
    const version = latest?.version ?? head.package.version;

    const [details, modules] = await Promise.all([
      this.gql.execute<{
        package: { typeOrigins: { module: string; struct: string; definingId: string }[] | null } | null;
      }>(PACKAGE_DETAILS_QUERY, { address: storageId }),
      this.readModules(storageId),
    ]);

    const typeOrigins = new Map<string, string>();
    for (const origin of details.package?.typeOrigins ?? []) {
      typeOrigins.set(`${origin.module}::${origin.struct}`, normalizeAddress(origin.definingId));
    }

    // Datatypes are fetched per module in parallel; each is tagged with its DEFINING id.
    const withDatatypes = await Promise.all(
      modules.map(async (m) => ({
        ...m,
        datatypes: await this.readModuleDatatypes(storageId, m.name, typeOrigins),
      })),
    );

    return { requestedId, storageId, version, modules: withDatatypes, typeOrigins };
  }

  private async readModules(address: string): Promise<Omit<ModuleInfo, 'datatypes'>[]> {
    const out: Omit<ModuleInfo, 'datatypes'>[] = [];
    let after: string | null = null;

    for (;;) {
      const data: {
        package: { modules: { pageInfo: PageInfo; nodes: { name: string; disassembly: string | null }[] } | null } | null;
      } = await this.gql.execute(MODULES_QUERY, { address, first: MODULE_PAGE_SIZE, after });

      const page = data.package?.modules;
      if (!page) break;
      out.push(...page.nodes.map((n) => ({ name: n.name, disassembly: n.disassembly ?? '' })));
      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
      after = page.pageInfo.endCursor;
    }

    return out;
  }

  private async readModuleDatatypes(
    storageId: string,
    module: string,
    typeOrigins: Map<string, string>,
  ): Promise<MoveDatatype[]> {
    const out: MoveDatatype[] = [];
    let after: string | null = null;

    for (;;) {
      const data: {
        package: {
          module: { datatypes: { pageInfo: PageInfo; nodes: RawDatatype[] } | null } | null;
        } | null;
      } = await this.gql.execute(DATATYPES_QUERY, {
        address: storageId,
        module,
        first: DATATYPE_PAGE_SIZE,
        after,
      });

      const page = data.package?.module?.datatypes;
      if (!page) break;

      for (const raw of page.nodes) {
        const definingId = typeOrigins.get(`${module}::${raw.name}`) ?? storageId;
        const datatype = toDatatype(definingId, module, raw);
        out.push(datatype);
        // Seed the cache so dependency walks never re-fetch local types.
        this.datatypeCache.set(
          datatypeKey(definingId, module, raw.name),
          Promise.resolve(datatype),
        );
      }

      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
      after = page.pageInfo.endCursor;
    }

    return out;
  }

  /** Fetch one datatype (any package). Cached; null when it does not exist. */
  readDatatype(address: string, module: string, name: string): Promise<MoveDatatype | null> {
    const key = datatypeKey(address, module, name);
    let pending = this.datatypeCache.get(key);

    if (!pending) {
      pending = this.gql
        .execute<{ package: { module: { datatype: RawDatatype | null } | null } | null }>(
          DATATYPE_QUERY,
          { address: normalizeAddress(address), module, name },
        )
        .then((data) => {
          const raw = data.package?.module?.datatype;
          return raw ? toDatatype(normalizeAddress(address), module, raw) : null;
        });
      this.datatypeCache.set(key, pending);
    }

    return pending;
  }
}
