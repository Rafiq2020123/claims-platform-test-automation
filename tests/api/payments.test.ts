import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { workedExamples } from '../unit/worked-examples.js';
import { Harness, type Session } from './harness.js';

// R4 and R5 (rules §6 and §7), end to end: the amount the API returns, and the row it saved,
// against the worked examples. Then the idempotency rules, including the two races.

describe('payment amounts end to end', () => {
  let h: Harness;
  let adjuster: Session;
  let members: Record<'SILVER' | 'GOLD', Session>;
  before(async () => {
    h = await Harness.start();
    adjuster = await h.adjuster();
    members = { SILVER: await h.member('SILVER'), GOLD: await h.member('GOLD') };
  });
  after(() => h.stop());

  for (const example of workedExamples()) {
    it(`row ${example.row}: ${example.plan} ${example.approvedCents} -> ${example.paymentCents}`, async () => {
      const claim = await h.approvedClaim(members[example.plan], adjuster, example.approvedCents);
      const { status, body } = await h.pay(adjuster, claim.id);
      assert.equal(status, 201);
      assert.equal(body.amountCents, example.paymentCents);

      const saved = await h.db.query<{ amount_cents: number; approved_cents: number }>(
        'SELECT amount_cents, approved_cents FROM payments WHERE claim_id = $1',
        [claim.id],
      );
      assert.deepEqual(saved.rows, [
        { amount_cents: example.paymentCents, approved_cents: example.approvedCents },
      ]);
    });
  }

  it('the plan terms are copied onto the payment', async () => {
    const claim = await h.approvedClaim(members.SILVER, adjuster, 10_000);
    await h.pay(adjuster, claim.id);
    const { rows } = await h.db.query(
      'SELECT coverage_bp, copay_cents FROM payments WHERE claim_id = $1',
      [claim.id],
    );
    assert.deepEqual(rows, [{ coverage_bp: 8000, copay_cents: 2000 }]);
  });
});

describe('payment idempotency', () => {
  let h: Harness;
  let adjuster: Session;
  let member: Session;
  before(async () => {
    h = await Harness.start();
    [adjuster, member] = await Promise.all([h.adjuster(), h.member('GOLD')]);
  });
  after(() => h.stop());

  it('no Idempotency-Key is 400', async () => {
    const claim = await h.approvedClaim(member, adjuster, 1000);
    const { status } = await h.request('POST', `/api/claims/${claim.id}/payment`, {
      token: adjuster.token,
    });
    assert.equal(status, 400);
  });

  it('the same key twice returns the same payment, 201 then 200, one row', async () => {
    const claim = await h.approvedClaim(member, adjuster, 1000);
    const key = randomUUID();
    const first = await h.pay(adjuster, claim.id, key);
    const second = await h.pay(adjuster, claim.id, key);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(first.body.id, second.body.id);

    const { rows } = await h.db.query(
      'SELECT count(*)::int AS n FROM payments WHERE claim_id = $1',
      [claim.id],
    );
    assert.deepEqual(rows, [{ n: 1 }]);
  });

  // Five requests fired together from one process. The client can't prove they overlapped
  // inside the server; what this does prove is that whatever the overlap was, one row came
  // out. The advisory lock in the route is what makes that hold, and this is its only check.
  it('five concurrent requests with one key produce one payment', async () => {
    const claim = await h.approvedClaim(member, adjuster, 1000);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => h.pay(adjuster, claim.id, key)),
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 200, 200, 200, 201]);
    assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
  });

  it('a key reused on a different claim is 422, also when the two requests race', async () => {
    const [a, b] = await Promise.all([
      h.approvedClaim(member, adjuster, 1000),
      h.approvedClaim(member, adjuster, 1000),
    ]);
    const key = randomUUID();
    const [ra, rb] = await Promise.all([h.pay(adjuster, a.id, key), h.pay(adjuster, b.id, key)]);
    assert.deepEqual([ra.status, rb.status].sort(), [201, 422]);

    const { rows } = await h.db.query('SELECT claim_id FROM payments WHERE idempotency_key = $1', [
      key,
    ]);
    assert.equal(rows.length, 1);
  });

  it('a paid claim cannot be paid again with a new key', async () => {
    const claim = await h.approvedClaim(member, adjuster, 1000);
    await h.pay(adjuster, claim.id);
    const { status } = await h.pay(adjuster, claim.id, randomUUID());
    assert.equal(status, 409);
  });
});

describe('with DEMO_DEFECT=payment-rounding', () => {
  let h: Harness;
  before(async () => (h = await Harness.start({ DEMO_DEFECT: 'payment-rounding' })));
  after(() => h.stop());

  it('the half-cent rows come out one cent short, and nothing else changes', async () => {
    const adjuster = await h.adjuster();
    const members = { SILVER: await h.member('SILVER'), GOLD: await h.member('GOLD') };
    for (const example of workedExamples()) {
      const claim = await h.approvedClaim(members[example.plan], adjuster, example.approvedCents);
      const { body } = await h.pay(adjuster, claim.id);
      const short = [3, 4, 9, 10, 11].includes(example.row) ? 1 : 0;
      assert.equal(body.amountCents, example.paymentCents - short, `row ${example.row}`);
    }
  });
});
