import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculatePayment } from '../../app/src/domain/payment.js';
import { PLANS, workedExamples } from './worked-examples.js';

describe('calculatePayment', () => {
  const examples = workedExamples();

  it('has all 13 worked examples from the rules', () => {
    assert.equal(examples.length, 13);
  });

  for (const example of examples) {
    it(`row ${example.row}: ${example.plan} ${example.approvedCents} -> ${example.paymentCents} (${example.note})`, () => {
      assert.equal(
        calculatePayment(example.approvedCents, PLANS[example.plan]),
        example.paymentCents,
      );
    });
  }

  it('truncating instead of rounding half up is 1 cent short on the .5 rows', () => {
    // These are the rows the demo defect is meant to expose. If this test ever passes with
    // half-up, the examples no longer cover the rounding rule.
    const halfCentRows = examples.filter((e) => [3, 4, 9, 10, 11].includes(e.row));
    assert.equal(halfCentRows.length, 5);
    for (const e of halfCentRows) {
      assert.equal(
        calculatePayment(e.approvedCents, PLANS[e.plan], 'truncate'),
        e.paymentCents - 1,
      );
    }
  });

  it('never goes below zero', () => {
    assert.equal(calculatePayment(1, PLANS.SILVER), 0);
    assert.equal(calculatePayment(2499, PLANS.SILVER), 0);
  });

  it('rejects amounts that are not positive integers', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => calculatePayment(bad, PLANS.GOLD), RangeError);
    }
  });

  it('stays exact at the top of the range', () => {
    // 10,000,000 * 9000 overflows a 32-bit int and loses precision as a float in some
    // languages. BigInt keeps it exact.
    assert.equal(calculatePayment(10_000_000, { coverageBp: 9999, copayCents: 0 }), 9_999_000);
  });
});
