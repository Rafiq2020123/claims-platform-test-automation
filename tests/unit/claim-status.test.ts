import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLAIM_STATUSES,
  canTransition,
  type ClaimStatus,
} from '../../app/src/domain/claim-status.js';

// docs/business-rules.md §5, written out as the full matrix so every pair is checked,
// including the ones nobody would think to try by hand.
const ALLOWED: ReadonlySet<string> = new Set([
  'SUBMITTED>APPROVED',
  'SUBMITTED>DENIED',
  'SUBMITTED>PENDED',
  'PENDED>APPROVED',
  'PENDED>DENIED',
  'APPROVED>PAID',
]);

describe('claim status transitions', () => {
  for (const from of CLAIM_STATUSES) {
    for (const to of CLAIM_STATUSES) {
      const expected = ALLOWED.has(`${from}>${to}`);
      it(`${from} -> ${to} is ${expected ? 'allowed' : 'rejected'}`, () => {
        assert.equal(canTransition(from, to), expected);
      });
    }
  }

  it('DENIED and PAID are final', () => {
    for (const final of ['DENIED', 'PAID'] as ClaimStatus[]) {
      for (const to of CLAIM_STATUSES) assert.equal(canTransition(final, to), false);
    }
  });

  it('PAID is only reachable from APPROVED', () => {
    const sources = CLAIM_STATUSES.filter((from) => canTransition(from, 'PAID'));
    assert.deepEqual(sources, ['APPROVED']);
  });
});
