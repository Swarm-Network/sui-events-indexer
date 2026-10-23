import { describe, expect, it } from 'bun:test';

import { asBool, asInt, asJson, asNumeric, asOption, asText, asVariant, DecodeError } from './decode';

describe('decode', () => {
  it('reads scalars as GraphQL renders them', () => {
    expect(asText('0xabc', 'f')).toBe('0xabc');
    expect(asBool(true, 'f')).toBe(true);
    expect(asInt(7, 'f')).toBe(7);
    expect(asNumeric('18446744073709551615', 'f')).toBe('18446744073709551615');
    expect(asVariant({ '@variant': 'SixMonths' }, 'f')).toBe('SixMonths');
    expect(asJson({ a: 1 }, 'f')).toEqual({ a: 1 });
  });

  it('reads options in both renderings', () => {
    expect(asOption(null, 'f', asNumeric)).toBeNull();
    expect(asOption({ vec: [] }, 'f', asNumeric)).toBeNull();
    expect(asOption('42', 'f', asNumeric)).toBe('42');
    expect(asOption({ vec: ['7'] }, 'f', asNumeric)).toBe('7');
  });

  it('throws instead of guessing', () => {
    expect(() => asText(1, 'f')).toThrow(DecodeError);
    expect(() => asNumeric('1.5', 'f')).toThrow(DecodeError);
    expect(() => asNumeric(-1, 'f')).toThrow(DecodeError);
    expect(() => asInt('x', 'f')).toThrow(DecodeError);
    expect(() => asJson(undefined, 'f')).toThrow(DecodeError);
  });
});
