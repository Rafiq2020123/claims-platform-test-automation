import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Verifier } from '@pact-foundation/pact';
import { hashPassword, signToken } from '../../app/src/auth.js';
import { loadConfig } from '../../app/src/config.js';
import { createPool, type Db } from '../../app/src/db.js';
import { buildServer } from '../../app/src/server.js';

// Replays the contract written by consumer.test.ts against the real app, started in-process
// on a random port with a real database. Each "given" state is set up here by inserting rows
// with the fixed IDs the contract uses, so the app answers exactly those requests.

const PACT_FILE = fileURLToPath(
  new URL('../../pacts/claimpay-web-claimpay-api.json', import.meta.url),
);
const CLAIM_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEMBER_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const ADJUSTER_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

const config = loadConfig({ ...process.env, DEMO_DEFECT: '', DEMO_LATENCY_MS: '0' });
let db: Db;
let app: ReturnType<typeof buildServer>;
let baseUrl: string;
// The contract carries a placeholder bearer token. The request filter swaps in a real one
// for whichever user the current state signed in.
let bearer: string | null = null;

// Removes everything the contract users own, including claims the previous interaction
// created through the API with IDs we don't know.
async function resetContractRows(): Promise<void> {
  const users = [MEMBER_ID, ADJUSTER_ID];
  await db.query(
    'DELETE FROM payments WHERE claim_id IN (SELECT id FROM claims WHERE member_id = ANY($1))',
    [users],
  );
  await db.query(
    'DELETE FROM claim_status_history WHERE claim_id IN (SELECT id FROM claims WHERE member_id = ANY($1))',
    [users],
  );
  await db.query('DELETE FROM claims WHERE member_id = ANY($1)', [users]);
  await db.query('DELETE FROM users WHERE id = ANY($1)', [users]);
  bearer = null;
}

async function insertMember(email = 'member@contract.test', password = 'contract-pass') {
  await db.query(
    `INSERT INTO users (id, email, full_name, role, plan_code, password_hash)
     VALUES ($1, $2, 'Contract Member', 'member', 'SILVER', $3)`,
    [MEMBER_ID, email, await hashPassword(password)],
  );
}

async function insertAdjuster() {
  await db.query(
    `INSERT INTO users (id, email, full_name, role, password_hash)
     VALUES ($1, 'adjuster@contract.test', 'Contract Adjuster', 'adjuster', $2)`,
    [ADJUSTER_ID, await hashPassword('contract-pass')],
  );
}

async function insertClaim(status: 'SUBMITTED' | 'APPROVED' | 'PAID') {
  const approved = status === 'SUBMITTED' ? null : 12500;
  await db.query(
    `INSERT INTO claims (id, member_id, procedure_code, service_date, billed_cents, status,
                         approved_cents, correlation_id)
     VALUES ($1, $2, 'PC-1001', '2026-10-10', 12500, $3, $4, 'contract-state')`,
    [CLAIM_ID, MEMBER_ID, status, approved],
  );
  if (status === 'PAID') {
    await db.query(
      `INSERT INTO payments (claim_id, idempotency_key, amount_cents, approved_cents, coverage_bp,
                             copay_cents, recorded_by, correlation_id)
       VALUES ($1, 'contract-state-key', 8000, 12500, 8000, 2000, $2, 'contract-state')`,
      [CLAIM_ID, ADJUSTER_ID],
    );
  }
}

const token = (userId: string, role: 'member' | 'adjuster') =>
  signToken({ userId, role }, config.authSecret, 300);

function swapInRealToken(req: IncomingMessage, _res: ServerResponse, next: () => void): void {
  if (bearer && req.headers.authorization) req.headers.authorization = `Bearer ${bearer}`;
  next();
}

describe('claimpay-api honours the claimpay-web contract', () => {
  before(async () => {
    db = createPool(config.databaseUrl);
    app = buildServer({ ...config, logLevel: 'warn' }, db);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  });

  after(async () => {
    await resetContractRows();
    await app.close();
    await db.end();
  });

  it('verifies every interaction', async () => {
    // verifyProvider() rejects on any mismatch; a resolved result means every interaction passed.
    const output = await new Verifier({
      provider: 'claimpay-api',
      providerBaseUrl: baseUrl,
      pactUrls: [PACT_FILE],
      logLevel: 'warn',
      requestFilter: swapInRealToken,
      stateHandlers: {
        'a member exists': async (params) => {
          await resetContractRows();
          const p = params as { email: string; password: string };
          await insertMember(p.email, p.password);
        },
        'a signed-in member': async () => {
          await resetContractRows();
          await insertMember();
          bearer = token(MEMBER_ID, 'member');
        },
        'a signed-in member with one submitted claim': async () => {
          await resetContractRows();
          await insertMember();
          await insertClaim('SUBMITTED');
          bearer = token(MEMBER_ID, 'member');
        },
        'a signed-in adjuster and a submitted claim': async () => {
          await resetContractRows();
          await insertMember();
          await insertAdjuster();
          await insertClaim('SUBMITTED');
          bearer = token(ADJUSTER_ID, 'adjuster');
        },
        'a signed-in adjuster and an approved claim': async () => {
          await resetContractRows();
          await insertMember();
          await insertAdjuster();
          await insertClaim('APPROVED');
          bearer = token(ADJUSTER_ID, 'adjuster');
        },
        'a signed-in member with one paid claim': async () => {
          await resetContractRows();
          await insertMember();
          await insertAdjuster();
          await insertClaim('PAID');
          bearer = token(MEMBER_ID, 'member');
        },
      },
    }).verifyProvider();
    const summary = JSON.parse(output) as { result: boolean; errors: unknown[] };
    assert.equal(summary.result, true);
    assert.deepEqual(summary.errors, []);
  });
});
