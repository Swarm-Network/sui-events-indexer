#!/usr/bin/env bun
/**
 * sui-events-indexer CLI.
 *
 *   sui-events-indexer inspect  -p <package> [-n network]
 *   sui-events-indexer generate -p <package> --name <project> [-o dir] [-n network] [-i ms] [--force]
 */
import { Command, InvalidArgumentError } from 'commander';

import pkg from '../package.json' with { type: 'json' };
import { analyzePackage, buildProjectFiles, writeProject } from './codegen/project';
import { isValidProjectName } from './codegen/naming';
import { createGraphqlExecutor, isNetwork, type Network, NETWORKS } from './sui/graphql';
import { formatMoveType } from './sui/moveTypes';
import { PackageReader } from './sui/packageReader';

const parseNetwork = (value: string): Network => {
  const network = value.toLowerCase();
  if (!isNetwork(network)) throw new InvalidArgumentError(`must be one of ${NETWORKS.join(', ')}`);
  return network;
};

const parseInterval = (value: string): number => {
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < 50) throw new InvalidArgumentError('must be an integer >= 50');
  return ms;
};

const parseProjectName = (value: string): string => {
  if (!isValidProjectName(value)) {
    throw new InvalidArgumentError('use lowercase letters, digits, ".", "_" or "-"');
  }
  return value;
};

interface CommonOptions {
  package: string;
  network: Network;
  graphqlUrl?: string;
  pinVersion?: boolean;
}

const analyze = async (options: CommonOptions) => {
  const reader = new PackageReader(createGraphqlExecutor(options.network, options.graphqlUrl));
  const info = await reader.readPackage(options.package, { pinVersion: options.pinVersion });
  return analyzePackage(info, reader);
};

const program = new Command()
  .name('sui-events-indexer')
  .description('Generate a Bun + Drizzle event indexer for a Sui Move package')
  .version(pkg.version);

const withPackageOptions = (command: Command) =>
  command
    .requiredOption('-p, --package <id>', 'package id (original or any version)')
    .option('-n, --network <network>', `one of ${NETWORKS.join(', ')}`, parseNetwork, 'mainnet' as Network)
    .option('--graphql-url <url>', 'override the public Sui GraphQL endpoint')
    .option('--pin-version', 'analyze exactly the given package version instead of the latest');

withPackageOptions(
  program.command('inspect').description('List the events a package emits, without generating anything'),
).action(async (options: CommonOptions) => {
  const analysis = await analyze(options);
  console.log(`Package ${analysis.pkg.requestedId} (analyzed v${analysis.pkg.version}: ${analysis.pkg.storageId})`);
  console.log(`Streams: ${analysis.eventPackageIds.join(', ') || '(none)'}\n`);
  for (const plan of analysis.plans) {
    console.log(`${plan.dispatchKey} -> ${plan.table}`);
    for (const c of plan.columns) console.log(`  ${c.field}: ${c.moveType}`);
  }
  if (analysis.plans.length === 0) console.log('No event::emit call sites found.');
});

withPackageOptions(
  program.command('generate').description('Generate a new event indexer project'),
)
  .requiredOption('--name <name>', 'project name (directory and npm name)', parseProjectName)
  .option('-o, --output <dir>', 'parent directory', '.')
  .option('-i, --interval <ms>', 'polling interval once caught up (ms, >= 50)', parseInterval, 500)
  .option('--force', 'write into a non-empty directory, overwriting generated files')
  .action(
    async (
      options: CommonOptions & { name: string; output: string; interval: number; force?: boolean },
    ) => {
      const analysis = await analyze(options);
      if (analysis.plans.length === 0) {
        throw new Error(`No events found in package ${options.package} on ${options.network}`);
      }

      const files = buildProjectFiles(analysis, {
        projectName: options.name,
        network: options.network,
        pollingIntervalMs: options.interval,
        generatorVersion: pkg.version,
        graphqlUrl: options.graphqlUrl,
      });
      const dir = await writeProject(options.output, options.name, files, options.force);

      console.log(`Generated ${analysis.plans.length} event tables for ${options.package} in ${dir}

Next:
  cd ${dir}
  bun install
  bun run db:up
  bun run db:setup
  bun run indexer      # and, separately: bun run api
`);
    },
  );

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
