import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Plain browser JS, imported as is. The UI's money handling gets the same scrutiny as the API's.
import { formatCents, parseDollars } from '../../app/public/money.js';

describe('parseDollars', () => {
  const accepted: [string, number][] = [
    ['125', 12_500],
    ['125.5', 12_550],
    ['125.50', 12_550],
    ['0.01', 1],
    ['$1,234.56', 123_456],
    ['1,234,567.89', 123_456_789],
    ['1234567', 123_456_700],
    ['  50  ', 5_000],
  ];
  for (const [text, cents] of accepted) {
    it(`"${text}" -> ${cents}`, () => assert.equal(parseDollars(text), cents));
  }

  const rejected = ['', 'abc', '1,2', '1$2', '12.345', '-5', '1.', '.5', '1,234.5.6', '$'];
  for (const text of rejected) {
    it(`"${text}" is rejected`, () => assert.equal(parseDollars(text), null));
  }
});

describe('formatCents', () => {
  const cases: [number, string][] = [
    [0, '$0.00'],
    [1, '$0.01'],
    [670, '$6.70'],
    [12_550, '$125.50'],
    [123_456_789, '$1,234,567.89'],
    [-2_000, '-$20.00'],
  ];
  for (const [cents, text] of cases) {
    it(`${cents} -> ${text}`, () => assert.equal(formatCents(cents), text));
  }

  it('round-trips through parseDollars', () => {
    for (const cents of [1, 99, 100, 12_550, 10_000_000]) {
      assert.equal(parseDollars(formatCents(cents)), cents);
    }
  });
});
