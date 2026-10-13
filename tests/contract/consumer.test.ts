import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MatchersV3, PactV4 } from '@pact-foundation/pact';
import { ApiClient, ApiError } from '../../app/public/api-client.js';

// The consumer is the web UI, and the code under test is its real API client, not a copy.
// Each interaction says what the UI sends and the least it needs back. The provider side
// (provider.test.ts) replays these against the running app.

const { like, eachLike, uuid, integer, string } = MatchersV3;

const PACT_DIR = fileURLToPath(new URL('../../pacts/', import.meta.url));
const pact = new PactV4({ consumer: 'claimpay-web', provider: 'claimpay-api', dir: PACT_DIR });

const CLAIM_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const TOKEN = 'contract-test-token';

function client(baseUrl: string, token: string | null = TOKEN): ApiClient {
  const c = new ApiClient(`${baseUrl}/api`);
  c.token = token;
  return c;
}

const claimBody = () => ({
  id: uuid(CLAIM_ID),
  memberId: uuid(),
  procedureCode: string('PC-1001'),
  serviceDate: string('2026-10-10'),
  billedCents: integer(12500),
  status: string('SUBMITTED'),
  approvedCents: null,
  denialReason: null,
  createdAt: string('2026-10-13T12:00:00.000Z'),
  updatedAt: string('2026-10-13T12:00:00.000Z'),
});

describe('claimpay-web -> claimpay-api', () => {
  it('signs in and receives a token and the user', async () => {
    await pact
      .addInteraction()
      .given('a member exists', { email: 'member@contract.test', password: 'contract-pass' })
      .uponReceiving('a sign-in with valid credentials')
      .withRequest('POST', '/api/session', (b) =>
        b.jsonBody({ email: 'member@contract.test', password: 'contract-pass' }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          token: like(TOKEN),
          user: { id: uuid(), fullName: like('Member Name'), role: 'member' },
        }),
      )
      .executeTest(async (mock) => {
        const c = client(mock.url, null);
        const user = await c.signIn('member@contract.test', 'contract-pass');
        assert.equal(user.role, 'member');
        assert.ok(c.token);
      });
  });

  it('gets a 401 with a readable message for a wrong password', async () => {
    await pact
      .addInteraction()
      .given('a member exists', { email: 'member@contract.test', password: 'contract-pass' })
      .uponReceiving('a sign-in with the wrong password')
      .withRequest('POST', '/api/session', (b) =>
        b.jsonBody({ email: 'member@contract.test', password: 'wrong' }),
      )
      .willRespondWith(401, (b) =>
        b.jsonBody({
          error: { code: 'INVALID_CREDENTIALS', message: like('Email or password is incorrect.') },
          correlationId: like('abc'),
        }),
      )
      .executeTest(async (mock) => {
        await assert.rejects(
          client(mock.url, null).signIn('member@contract.test', 'wrong'),
          (e) => {
            assert.ok(e instanceof ApiError);
            assert.equal(e.status, 401);
            assert.equal(e.code, 'INVALID_CREDENTIALS');
            return true;
          },
        );
      });
  });

  it('lists the procedure codes', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a request for the procedure codes')
      .withRequest('GET', '/api/procedure-codes')
      .willRespondWith(200, (b) =>
        b.jsonBody(eachLike({ code: string('PC-1001'), description: string('Office visit') })),
      )
      .executeTest(async (mock) => {
        const codes = await client(mock.url, null).procedureCodes();
        assert.ok(codes.length > 0);
        assert.ok(codes[0]?.code);
      });
  });

  it('submits a claim and gets the created claim back', async () => {
    await pact
      .addInteraction()
      .given('a signed-in member')
      .uponReceiving('a valid claim submission')
      .withRequest('POST', '/api/claims', (b) =>
        b.headers({ Authorization: like(`Bearer ${TOKEN}`) }).jsonBody({
          procedureCode: 'PC-1001',
          serviceDate: like('2026-10-10'),
          billedCents: 12500,
        }),
      )
      .willRespondWith(201, (b) => b.jsonBody(claimBody()))
      .executeTest(async (mock) => {
        const claim = await client(mock.url).submitClaim({
          procedureCode: 'PC-1001',
          serviceDate: '2026-10-10',
          billedCents: 12500,
        });
        assert.equal(claim.status, 'SUBMITTED');
        assert.equal(claim.billedCents, 12500);
      });
  });

  it('gets field-level errors for an invalid claim', async () => {
    await pact
      .addInteraction()
      .given('a signed-in member')
      .uponReceiving('a claim with a zero amount')
      .withRequest('POST', '/api/claims', (b) =>
        b
          .headers({ Authorization: like(`Bearer ${TOKEN}`) })
          .jsonBody({ procedureCode: 'PC-1001', serviceDate: like('2026-10-10'), billedCents: 0 }),
      )
      .willRespondWith(400, (b) =>
        b.jsonBody({
          error: {
            code: 'VALIDATION_FAILED',
            message: like('Please fix the highlighted fields.'),
            fields: { billedCents: like('Billed amount must be between $0.01 and $100,000.00.') },
          },
          correlationId: like('abc'),
        }),
      )
      .executeTest(async (mock) => {
        await assert.rejects(
          client(mock.url).submitClaim({
            procedureCode: 'PC-1001',
            serviceDate: '2026-10-10',
            billedCents: 0,
          }),
          (e) => {
            assert.ok(e instanceof ApiError);
            assert.equal(e.code, 'VALIDATION_FAILED');
            // The UI puts this text next to the field, so the key name is part of the contract.
            assert.ok(e.fields.billedCents);
            return true;
          },
        );
      });
  });

  it("lists the member's claims", async () => {
    await pact
      .addInteraction()
      .given('a signed-in member with one submitted claim', { claimId: CLAIM_ID })
      .uponReceiving("a request for the member's claims")
      .withRequest('GET', '/api/claims', (b) =>
        b.headers({ Authorization: like(`Bearer ${TOKEN}`) }),
      )
      .willRespondWith(200, (b) => b.jsonBody(eachLike(claimBody())))
      .executeTest(async (mock) => {
        const claims = await client(mock.url).listClaims();
        assert.equal(claims.length, 1);
        assert.equal(claims[0]?.id, CLAIM_ID);
      });
  });

  it('records a decision', async () => {
    await pact
      .addInteraction()
      .given('a signed-in adjuster and a submitted claim', { claimId: CLAIM_ID })
      .uponReceiving('an approval decision')
      .withRequest('POST', `/api/claims/${CLAIM_ID}/decision`, (b) =>
        b
          .headers({ Authorization: like(`Bearer ${TOKEN}`) })
          .jsonBody({ decision: 'APPROVE', approvedCents: 12500 }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({ ...claimBody(), status: 'APPROVED', approvedCents: integer(12500) }),
      )
      .executeTest(async (mock) => {
        const claim = await client(mock.url).decideClaim(CLAIM_ID, {
          decision: 'APPROVE',
          approvedCents: 12500,
        });
        assert.equal(claim.status, 'APPROVED');
      });
  });

  it('records a payment with an idempotency key', async () => {
    await pact
      .addInteraction()
      .given('a signed-in adjuster and an approved claim', { claimId: CLAIM_ID })
      .uponReceiving('a payment request')
      .withRequest('POST', `/api/claims/${CLAIM_ID}/payment`, (b) =>
        b.headers({ Authorization: like(`Bearer ${TOKEN}`), 'Idempotency-Key': like('key-1') }),
      )
      .willRespondWith(201, (b) =>
        b.jsonBody({
          id: uuid(),
          claimId: uuid(CLAIM_ID),
          amountCents: integer(8000),
          approvedCents: integer(12500),
          coverageBp: integer(8000),
          copayCents: integer(2000),
          createdAt: string('2026-10-13T12:00:00.000Z'),
        }),
      )
      .executeTest(async (mock) => {
        const payment = await client(mock.url).recordPayment(CLAIM_ID, 'key-1');
        assert.equal(typeof payment.amountCents, 'number');
      });
  });

  it('reads the payment for a paid claim', async () => {
    await pact
      .addInteraction()
      .given('a signed-in member with one paid claim', { claimId: CLAIM_ID })
      .uponReceiving("a request for a claim's payment")
      .withRequest('GET', `/api/claims/${CLAIM_ID}/payment`, (b) =>
        b.headers({ Authorization: like(`Bearer ${TOKEN}`) }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({ id: uuid(), claimId: uuid(CLAIM_ID), amountCents: integer(8000) }),
      )
      .executeTest(async (mock) => {
        const payment = await client(mock.url).getPayment(CLAIM_ID);
        assert.equal(payment.claimId, CLAIM_ID);
      });
  });
});
