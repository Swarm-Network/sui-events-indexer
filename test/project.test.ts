import { describe, expect, it } from 'bun:test';

import { analyzePackage, buildProjectFiles } from '../src/codegen/project';
import { PackageReader } from '../src/sui/packageReader';
import { SWARM_LICENSE_TESTNET } from './fixtures/constants';
import recording from './fixtures/swarm_license.testnet.json';
import { replayExecutor } from './support/replay';

const generate = async () => {
  const reader = new PackageReader(replayExecutor(recording));
  const analysis = await analyzePackage(await reader.readPackage(SWARM_LICENSE_TESTNET), reader);
  return buildProjectFiles(analysis, {
    projectName: 'swarm-license-indexer',
    network: 'testnet',
    pollingIntervalMs: 250,
    generatorVersion: '0.0.0-test',
  });
};

describe('buildProjectFiles (swarm_license)', () => {
  it('emits one handler file per module and every static file', async () => {
    const files = await generate();
    for (const path of [
      'package.json',
      'src/db/schema.ts',
      'src/handlers/index.ts',
      'src/handlers/lease.ts',
      'src/handlers/license.ts',
      'src/handlers/marketplace.ts',
      'src/indexer/stream.ts',
      'src/server.ts',
      'src/types/moveTypes.ts',
      'src/generated/package.ts',
    ]) {
      expect(files.has(path)).toBe(true);
    }
  });

  it('streams the defining package once for all modules', async () => {
    const meta = (await generate()).get('src/generated/package.ts')!;
    expect(meta).toContain(`eventPackageIds: ['${SWARM_LICENSE_TESTNET}']`);
  });

  it('generates stable schema and handlers', async () => {
    const files = await generate();
    expect(files.get('src/db/schema.ts')).toMatchSnapshot();
    expect(files.get('src/handlers/lease.ts')).toMatchSnapshot();
    expect(files.get('src/types/moveTypes.ts')).toMatchSnapshot();
  });
});
