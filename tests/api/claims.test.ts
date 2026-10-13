import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { CLAIM_STATUSES, type ClaimStatus } from '../../app/src/domain/claim-status.js';
import { daysFrom, Harness, type Session } from './harness.js';

// R2 (rules §4) at the API boundary, and R3 (rules §5) through the real endpoints. The unit
// tests already cover the pure functions; these check that the routes wire them in and that
// the database ends up in the right state.

describe('claim submission', () => {
  let h: Harness;
  let member: Session;
  let today: string;
  before(async () => {
    h = await Harness.start();
    member = await h.member();
    today = await h.today();
  });
  after(() => h.stop());

  const submit = (body: Record<string, unknown>) =>
    h.request<{ error?: { fields: Record<string, string> } }>('POST', '/api/claims', {
      token: member.token,
      body: { procedureCode: 'PC-1001', serviceDate: today, billedCents: 100, ...body },
    });

  for (const [billedCents, expected] of [
    [0, 400],
    [1, 201],
    [10_000_000, 201],
    [10_000_001, 400],
  ] as const) {
    it(`billed ${billedCents} cents -> ${expected}`, async () => {
      const { status, body } = await submit({ billedCents });
      assert.equal(status, expected);
      if (expected === 400) assert.ok(body.error?.fields.billedCents);
    });
  }

  for (const [label, offset, expected] of [
    ['tomorrow', 1, 400],
    ['today', 0, 201],
    ['365 days ago', -365, 201],
    ['366 days ago', -366, 400],
  ] as const) {
    it(`service date ${label} -> ${expected}`, async () => {
      const { status, body } = await submit({ serviceDate: daysFrom(today, offset) });
      assert.equal(status, expected);
      if (expected === 400) assert.ok(body.error?.fields.serviceDate);
    });
  }

  for (const [label, serviceDate] of [
    ['an impossible date', '2026-02-30'],
    ['not a date at all', 'yesterday'],
    ['a date with time', '2026-10-01T00:00:00Z'],
  ] as const) {
    it(`service date ${label} -> 400`, async () => {
      const { status, body } = await submit({ serviceDate });
      assert.equal(status, 400);
      assert.ok(body.error?.fields.serviceDate);
    });
  }

  for (const [label, billedCents] of [
    ['fractional cents', 12.5],
    ['a string', '100'],
    ['negative', -100],
  ] as const) {
    it(`billed amount ${label} -> 400`, async () => {
      const { status, body } = await submit({ billedCents });
      assert.equal(status, 400);
      assert.ok(body.error?.fields.billedCents);
    });
  }

  it('an unknown procedure code is rejected on that field', async () => {
    const { status, body } = await submit({ procedureCode: 'PC-0000' });
    assert.equal(status, 400);
    assert.ok(body.error?.fields.procedureCode);
  });

  it('an inactive member is told so, on a form-level field', async () => {
    const inactive = await h.member('SILVER', false);
    const { status, body } = await h.request<{ error: { fields: Record<string, string> } }>(
      'POST',
      '/api/claims',
      {
        token: inactive.token,
        body: { procedureCode: 'PC-1001', serviceDate: today, billedCents: 100 },
      },
    );
    assert.equal(status, 400);
    assert.match(body.error.fields.member!, /not active/);
  });

  it('a submitted claim is saved with its correlation ID and a history row', async () => {
    const correlationId = `test-${Date.now()}`;
    const { status, body } = await h.request<{ id: string }>('POST', '/api/claims', {
      token: member.token,
      headers: { 'x-correlation-id': correlationId },
      body: { procedureCode: 'PC-2001', serviceDate: today, billedCents: 4200 },
    });
    assert.equal(status, 201);

    const claim = await h.db.query(
      'SELECT status, billed_cents, correlation_id FROM claims WHERE id = $1',
      [body.id],
    );
    assert.deepEqual(claim.rows[0], {
      status: 'SUBMITTED',
      billed_cents: 4200,
      correlation_id: correlationId,
    });
    const history = await h.db.query(
      'SELECT from_status, to_status FROM claim_status_history WHERE claim_id = $1',
      [body.id],
    );
    assert.deepEqual(history.rows, [{ from_status: null, to_status: 'SUBMITTED' }]);
  });
});

describe('status transitions through the API', () => {
  let h: Harness;
  let member: Session;
  let adjuster: Session;
  before(async () => {
    h = await Harness.start();
    [member, adjuster] = await Promise.all([h.member(), h.adjuster()]);
  });
  after(() => h.stop());

  // Put a fresh claim into the given status using only legal moves.
  async function claimIn(status: ClaimStatus): Promise<string> {
    const { id } = await h.claim(member, 1000);
    type Step = Record<string, unknown> | 'PAY';
    const path: Record<ClaimStatus, Step[]> = {
      SUBMITTED: [],
      PENDED: [{ decision: 'PEND' }],
      APPROVED: [{ decision: 'APPROVE', approvedCents: 1000 }],
      DENIED: [{ decision: 'DENY', reasonCode: 'NOT_COVERED' }],
      PAID: [{ decision: 'APPROVE', approvedCents: 1000 }, 'PAY'],
    };
    for (const step of path[status]) {
      const r = step === 'PAY' ? await h.pay(adjuster, id) : await h.decide(adjuster, id, step);
      assert.ok(r.status < 300, `setup step failed: ${JSON.stringify(step)} -> ${r.status}`);
    }
    return id;
  }

  const DECISIONS: Record<'APPROVED' | 'DENIED' | 'PENDED', Record<string, unknown>> = {
    APPROVED: { decision: 'APPROVE', approvedCents: 1000 },
    DENIED: { decision: 'DENY', reasonCode: 'NOT_COVERED' },
    PENDED: { decision: 'PEND' },
  };
  const LEGAL = new Set([
    'SUBMITTED>APPROVED',
    'SUBMITTED>DENIED',
    'SUBMITTED>PENDED',
    'PENDED>APPROVED',
    'PENDED>DENIED',
    'APPROVED>PAID',
  ]);

  for (const from of CLAIM_STATUSES) {
    for (const to of ['APPROVED', 'DENIED', 'PENDED', 'PAID'] as const) {
      const legal = LEGAL.has(`${from}>${to}`);
      it(`${from} -> ${to} is ${legal ? '200/201' : '409'}`, async () => {
        const id = await claimIn(from);
        const r =
          to === 'PAID' ? await h.pay(adjuster, id) : await h.decide(adjuster, id, DECISIONS[to]);
        if (legal) assert.ok(r.status === 200 || r.status === 201, `got ${r.status}`);
        else assert.equal(r.status, 409);

        const { rows } = await h.db.query<{ status: string }>(
          'SELECT status FROM claims WHERE id = $1',
          [id],
        );
        assert.equal(rows[0]!.status, legal ? to : from);
      });
    }
  }

  // Rule §5: approved amount greater than 0 and not more than billed. Both edges, both sides.
  for (const [approvedCents, expected] of [
    [0, 400],
    [1, 200],
    [1000, 200],
    [1001, 400],
  ] as const) {
    it(`approving ${approvedCents} of 1000 billed -> ${expected}`, async () => {
      const { id } = await h.claim(member, 1000);
      const r = await h.decide(adjuster, id, { decision: 'APPROVE', approvedCents });
      assert.equal(r.status, expected);
    });
  }

  it('approving with a fractional amount is refused', async () => {
    const { id } = await h.claim(member, 1000);
    const r = await h.decide(adjuster, id, { decision: 'APPROVE', approvedCents: 10.5 });
    assert.equal(r.status, 400);
  });

  it('denying without a valid reason is refused', async () => {
    const { id } = await h.claim(member, 1000);
    const r = await h.decide(adjuster, id, { decision: 'DENY', reasonCode: 'BECAUSE' });
    assert.equal(r.status, 400);
  });
});
