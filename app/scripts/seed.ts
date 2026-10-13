import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { hashPassword } from '../src/auth.js';

// Reference data plus a few demo accounts. Safe to run more than once.
// Test suites don't rely on the demo members; they create their own through the API.

const password = process.env.SEED_PASSWORD;
if (!password || password.length < 8) {
  throw new Error('SEED_PASSWORD must be set (8+ characters)');
}

const codes: { code: string; description: string }[] = JSON.parse(
  await readFile(new URL('../seed/procedure-codes.json', import.meta.url), 'utf8'),
);

const users = [
  { email: 'adjuster@claimpay.test', name: 'Dana Adjuster', role: 'adjuster', plan: null },
  { email: 'silver.member@claimpay.test', name: 'Sam Silver', role: 'member', plan: 'SILVER' },
  { email: 'gold.member@claimpay.test', name: 'Gina Gold', role: 'member', plan: 'GOLD' },
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO plans (code, coverage_bp, copay_cents)
     VALUES ('SILVER', 8000, 2000), ('GOLD', 9000, 0)
     ON CONFLICT (code) DO UPDATE SET coverage_bp = EXCLUDED.coverage_bp,
                                      copay_cents = EXCLUDED.copay_cents`,
  );
  for (const { code, description } of codes) {
    await client.query(
      `INSERT INTO procedure_codes (code, description) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description`,
      [code, description],
    );
  }
  for (const user of users) {
    await client.query(
      `INSERT INTO users (email, full_name, role, plan_code, password_hash)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (lower(email)) DO NOTHING`,
      [user.email, user.name, user.role, user.plan, await hashPassword(password)],
    );
  }
  await client.query('COMMIT');
  console.log(`seeded ${codes.length} procedure codes and ${users.length} users`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
