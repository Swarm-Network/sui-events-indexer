import { describe, expect, it } from 'bun:test';

import { extractEvents, findEmittedTypeNames } from '../src/analysis/events';
import { parseSignatureBody } from '../src/sui/moveTypes';
import { PackageReader } from '../src/sui/packageReader';
import { SWARM_LICENSE_TESTNET } from './fixtures/constants';
import recording from './fixtures/swarm_license.testnet.json';
import { replayExecutor } from './support/replay';

describe('findEmittedTypeNames', () => {
  it('finds plain, generic and authenticated emits', () => {
    const disassembly = [
      '\t11: Call event::emit<LeaseBookCreatedEvent>(LeaseBookCreatedEvent)',
      '\t12: Call event::emit<Wrapped<T0>>(Wrapped<T0>)',
      '\t13: Call event::emit_authenticated<Signed>(Signed)',
      '\t14: Call other::emitter<NotAnEvent>(NotAnEvent)',
    ].join('\n');
    expect([...findEmittedTypeNames(disassembly)]).toEqual(['LeaseBookCreatedEvent', 'Wrapped', 'Signed']);
  });
});

describe('parseSignatureBody', () => {
  it('parses every GraphQL signature shape', () => {
    expect(parseSignatureBody('u64')).toEqual({ kind: 'primitive', name: 'u64' });
    expect(parseSignatureBody({ typeParameter: 1 })).toEqual({ kind: 'typeParameter', index: 1 });
    expect(
      parseSignatureBody({ vector: { datatype: { package: '0x2', module: 'object', type: 'ID', typeParameters: [] } } }),
    ).toEqual({
      kind: 'vector',
      of: { kind: 'datatype', address: `0x${'2'.padStart(64, '0')}`, module: 'object', name: 'ID', typeArgs: [] },
    });
    expect(() => parseSignatureBody({ nope: 1 })).toThrow();
  });
});

describe('extractEvents (swarm_license, recorded testnet responses)', () => {
  it('finds every event the Move sources emit', async () => {
    const reader = new PackageReader(replayExecutor(recording));
    const pkg = await reader.readPackage(SWARM_LICENSE_TESTNET);
    const events = extractEvents(pkg).map((e) => `${e.module}::${e.name}`);

    expect(events).toEqual([
      'lease::LeaseBookCreatedEvent',
      'lease::LeaseBookUpgradedEvent',
      'lease::LeasedEvent',
      'lease::LeasingPausedEvent',
      'lease::ReleasedEvent',
      'license::MigrateEvent',
      'license::RegistryUpgradedEvent',
      'marketplace::CommissionChangedEvent',
      'marketplace::DelistedEvent',
      'marketplace::ListedEvent',
      'marketplace::MarketPausedEvent',
      'marketplace::MarketplaceCreatedEvent',
      'marketplace::MarketplaceUpgradedEvent',
      'marketplace::SoldEvent',
      'marketplace::TreasuryChangedEvent',
    ]);
    // Non-event datatypes (License, Lock, LeaseTerm, Registry...) are not picked up.
    expect(events).not.toContain('license::Lock');
  });
});
