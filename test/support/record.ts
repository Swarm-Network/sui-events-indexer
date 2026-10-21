#!/usr/bin/env bun
/** Re-record `test/fixtures/swarm_license.testnet.json` from the live testnet GraphQL. */
import { analyzePackage } from '../../src/codegen/project';
import { createGraphqlExecutor } from '../../src/sui/graphql';
import { PackageReader } from '../../src/sui/packageReader';
import { SWARM_LICENSE_TESTNET } from '../fixtures/constants';
import { type Recording, recordingExecutor } from './replay';

const recording: Recording = [];
const reader = new PackageReader(recordingExecutor(createGraphqlExecutor('testnet'), recording));
await analyzePackage(await reader.readPackage(SWARM_LICENSE_TESTNET), reader);

await Bun.write(
  new URL('../fixtures/swarm_license.testnet.json', import.meta.url),
  `${JSON.stringify(recording, null, 1)}\n`,
);
console.log(`recorded ${recording.length} responses`);
