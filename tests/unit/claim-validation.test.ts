import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_BILLED_CENTS,
  MAX_SERVICE_AGE_DAYS,
  validateClaim,
} from '../../app/src/domain/claim-validation.js';

const TODAY = '2026-10-13';
const CODES = new Set(['PC-1001', 'PC-2001']);

function daysAgo(n: number): string {
  const ms = Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

const valid = { procedureCode: 'PC-1001', serviceDate: daysAgo(1), billedCents: 12_500 };

describe('validateClaim', () => {
  it('accepts a valid claim with no errors', () => {
    assert.deepEqual(validateClaim(valid, TODAY, CODES), {});
  });

  describe('billed amount (§4)', () => {
    const cases: [unknown, boolean][] = [
      [0, false],
      [1, true],
      [MAX_BILLED_CENTS, true],
      [MAX_BILLED_CENTS + 1, false],
      [12.5, false],
      ['100', false],
      [-100, false],
      [null, false],
    ];
    for (const [billedCents, ok] of cases) {
      it(`${JSON.stringify(billedCents)} is ${ok ? 'accepted' : 'rejected'}`, () => {
        const errors = validateClaim({ ...valid, billedCents }, TODAY, CODES);
        assert.equal('billedCents' in errors, !ok);
      });
    }
  });

  describe('service date (§4)', () => {
    const cases: [string, unknown, boolean][] = [
      ['today', daysAgo(0), true],
      ['tomorrow', daysAgo(-1), false],
      [`${MAX_SERVICE_AGE_DAYS} days ago`, daysAgo(MAX_SERVICE_AGE_DAYS), true],
      [`${MAX_SERVICE_AGE_DAYS + 1} days ago`, daysAgo(MAX_SERVICE_AGE_DAYS + 1), false],
      ['not a date', 'yesterday', false],
      ['impossible date', '2026-02-30', false],
      ['wrong format', '10/12/2026', false],
      ['missing', undefined, false],
    ];
    for (const [label, serviceDate, ok] of cases) {
      it(`${label} is ${ok ? 'accepted' : 'rejected'}`, () => {
        const errors = validateClaim({ ...valid, serviceDate }, TODAY, CODES);
        assert.equal('serviceDate' in errors, !ok);
      });
    }
  });

  describe('procedure code (§4)', () => {
    it('must be in the published list', () => {
      assert.ok(validateClaim({ ...valid, procedureCode: 'PC-9999' }, TODAY, CODES).procedureCode);
      assert.ok(validateClaim({ ...valid, procedureCode: '' }, TODAY, CODES).procedureCode);
      assert.ok(validateClaim({ ...valid, procedureCode: 42 }, TODAY, CODES).procedureCode);
    });
  });

  it('reports every problem at once', () => {
    const errors = validateClaim(
      { procedureCode: 'nope', serviceDate: daysAgo(-5), billedCents: 0 },
      TODAY,
      CODES,
    );
    assert.deepEqual(Object.keys(errors).sort(), ['billedCents', 'procedureCode', 'serviceDate']);
  });

  it('messages are written for a member, not a developer', () => {
    const errors = validateClaim({ ...valid, billedCents: 0 }, TODAY, CODES);
    assert.match(errors.billedCents!, /\$0\.01 and \$100,000\.00/);
  });
});
