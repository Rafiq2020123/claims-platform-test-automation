import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Harness } from './harness.js';

// R1 (rules §3). The interesting case is the 404 for someone else's claim: it must look exactly
// like a claim that doesn't exist.

describe('access rules', () => {
  let h: Harness;
  before(async () => (h = await Harness.start()));
  after(() => h.stop());

  it("another member's claim is 404, indistinguishable from a missing one", async () => {
    const [alice, bob] = await Promise.all([h.member(), h.member()]);
    const claim = await h.claim(alice, 1000);

    const foreign = await h.request('GET', `/api/claims/${claim.id}`, { token: bob.token });
    const missing = await h.request('GET', '/api/claims/00000000-0000-4000-8000-000000000000', {
      token: bob.token,
    });
    const own = await h.request('GET', `/api/claims/${claim.id}`, { token: alice.token });

    assert.equal(foreign.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(stripIds(foreign.body), stripIds(missing.body));
    assert.equal(own.status, 200);
  });

  it("a member's list contains only their own claims", async () => {
    const [alice, bob] = await Promise.all([h.member(), h.member()]);
    const mine = await h.claim(alice, 1000);
    await h.claim(bob, 2000);

    const { body } = await h.request<{ id: string }[]>('GET', '/api/claims', {
      token: alice.token,
    });
    assert.deepEqual(
      body.map((c) => c.id),
      [mine.id],
    );
  });

  it('a member cannot decide, pay, or enrol', async () => {
    const member = await h.member();
    const claim = await h.claim(member, 1000);

    const decide = await h.decide(member, claim.id, { decision: 'PEND' });
    const pay = await h.pay(member, claim.id);
    const enrol = await h.request('POST', '/api/members', {
      token: member.token,
      body: { email: 'x@claimpay.test', fullName: 'X', planCode: 'GOLD', password: 'password123' },
    });
    assert.deepEqual([decide.status, pay.status, enrol.status], [403, 403, 403]);
  });

  it('no session is 401, even when the body would also have been invalid', async () => {
    const claim = await h.claim(await h.member(), 1000);
    const { status } = await h.request('POST', `/api/claims/${claim.id}/decision`, {
      body: { nonsense: true },
    });
    assert.equal(status, 401);
  });

  it('a tampered token is rejected', async () => {
    const member = await h.member();
    const [body, signature] = member.token.split('.');
    // Swap the last character for one it isn't, so the token is always actually different.
    const last = signature!.at(-1);
    const forged = `${body}.${signature!.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    const { status } = await h.request('GET', '/api/claims', { token: forged });
    assert.equal(status, 401);
  });

  it('wrong password and unknown email get the same answer', async () => {
    const member = await h.member();
    const wrong = await h.request('POST', '/api/session', {
      body: { email: member.email, password: 'nope' },
    });
    const unknown = await h.request('POST', '/api/session', {
      body: { email: 'nobody@claimpay.test', password: 'nope' },
    });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(stripIds(wrong.body), stripIds(unknown.body));
  });
});

function stripIds(body: unknown): unknown {
  const copy = { ...(body as Record<string, unknown>) };
  delete copy.correlationId;
  return copy;
}
