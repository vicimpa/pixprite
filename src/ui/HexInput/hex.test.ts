import { describe, expect, test } from 'bun:test';
import { cleanHexInput, parseHex } from '~/ui/HexInput/hex';

describe('parseHex', () => {
  test('parses short 3 and 4 digit forms', () => {
    expect(parseHex('abc')?.rgba).toEqual([170, 187, 204, 1]);
    expect(parseHex('#abcd')?.rgba).toEqual([170, 187, 204, 221 / 255]);
  });

  test('parses full 6 and 8 digit forms', () => {
    expect(parseHex('112233')?.rgba).toEqual([17, 34, 51, 1]);
    expect(parseHex('#11223344')?.rgba).toEqual([17, 34, 51, 68 / 255]);
  });

  test('accepts an optional # and surrounding whitespace', () => {
    expect(parseHex('  #112233  ')?.rgba).toEqual([17, 34, 51, 1]);
    expect(parseHex('# 112233')?.rgba).toEqual([17, 34, 51, 1]);
    expect(parseHex('11223344')?.rgba).toEqual([17, 34, 51, 68 / 255]);
  });

  test('is case insensitive', () => {
    expect(parseHex('#A1b2C3')?.toHexString()).toBe('#a1b2c3');
    expect(parseHex('ABCDEF')?.toHexString()).toBe('#abcdef');
  });

  test('rejects incomplete or invalid values', () => {
    for (const value of ['', '#', '12', '#12345', '1234567', '#1122334455', 'gggggg', '12g456', '#-12345'])
      expect(parseHex(value)).toBeNull();
  });
});

describe('cleanHexInput', () => {
  test('drops the prefix, spaces and non-hex characters', () => {
    expect(cleanHexInput(' #AB CD 12 ')).toBe('abcd12');
    expect(cleanHexInput('not 12 34')).toBe('1234');
    expect(cleanHexInput('ghij')).toBe('');
  });

  test('lowercases and limits the result to 8 digits', () => {
    expect(cleanHexInput('A1B2C3')).toBe('a1b2c3');
    expect(cleanHexInput('#11223344ff')).toBe('11223344');
  });
});
