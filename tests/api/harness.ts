import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../app/src/auth.js';
import { loadConfig, type Config } from '../../app/src/config.js';
import { createPool, type Db } from '../../app/src/db.js';
import { buildServer } from '../../app/src/server.js';

// Starts the real app in-process on a random port against the real database, and gives tests
// a small client plus direct database access for checking what was actually saved.

export interface Session {
  id: string;
  email: string;
  token: string;
}

export interface Response<T = unknown> {
  status: number;
  body: T;
  correlationId: string | null;
}

export class Harness {
  private constructor(
    readonly config: Config,
    readonly db: Db,
    private readonly app: ReturnType<typeof buildServer>,
    readonly baseUrl: string,
  ) {}

  static async start(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<Harness> {
    const config = loadConfig({
      ...process.env,
      DEMO_DEFECT: '',
      DEMO_LATENCY_MS: '0',
      ...overrides,
    });
    const db = createPool(config.databaseUrl);
    const app = buildServer({ ...config, logLevel: 'warn' }, db);
    const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    return new Harness(config, db, app, baseUrl);
  }

  async stop(): Promise<void> {
    await this.app.close();
    await this.db.end();
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response<T>> {
    const response = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    return {
      status: response.status,
      body: (text ? JSON.parse(text) : null) as T,
      correlationId: response.headers.get('x-correlation-id'),
    };
  }

  // Users are inserted directly: the API's enrollment route is itself under test elsewhere,
  // and a test should not depend on the thing it is testing to set itself up.
  async member(plan: 'SILVER' | 'GOLD' = 'SILVER', active = true): Promise<Session> {
    const email = `api.${randomUUID().slice(0, 8)}@claimpay.test`;
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, plan_code, active, password_hash)
       VALUES ($1, 'API Test Member', 'member', $2, $3, $4) RETURNING id`,
      [email, plan, active, await hashPassword('api-password')],
    );
    return { id: rows[0]!.id, email, token: await this.signIn(email) };
  }

  async adjuster(): Promise<Session> {
    const email = `api.adj.${randomUUID().slice(0, 8)}@claimpay.test`;
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash)
       VALUES ($1, 'API Test Adjuster', 'adjuster', $2) RETURNING id`,
      [email, await hashPassword('api-password')],
    );
    return { id: rows[0]!.id, email, token: await this.signIn(email) };
  }

  async signIn(email: string, password = 'api-password'): Promise<string> {
    const { status, body } = await this.request<{ token: string }>('POST', '/api/session', {
      body: { email, password },
    });
    if (status !== 200) throw new Error(`sign-in failed for ${email}: ${status}`);
    return body.token;
  }

  async today(): Promise<string> {
    const { body } = await this.request<{ today: string }>('GET', '/api/health');
    return body.today;
  }

  async claim(
    member: Session,
    billedCents: number,
    overrides: Partial<{ procedureCode: string; serviceDate: string }> = {},
  ): Promise<{ id: string; status: string }> {
    const { status, body } = await this.request<{ id: string; status: string }>(
      'POST',
      '/api/claims',
      {
        token: member.token,
        body: {
          procedureCode: 'PC-1001',
          serviceDate: await this.today(),
          billedCents,
          ...overrides,
        },
      },
    );
    if (status !== 201) throw new Error(`claim setup failed: ${status} ${JSON.stringify(body)}`);
    return body;
  }

  decide(adjuster: Session, claimId: string, decision: Record<string, unknown>) {
    return this.request<{ status: string }>('POST', `/api/claims/${claimId}/decision`, {
      token: adjuster.token,
      body: decision,
    });
  }

  pay(adjuster: Session, claimId: string, key: string = randomUUID()) {
    return this.request<{ id: string; amountCents: number }>(
      'POST',
      `/api/claims/${claimId}/payment`,
      { token: adjuster.token, headers: { 'idempotency-key': key } },
    );
  }

  async approvedClaim(
    member: Session,
    adjuster: Session,
    approvedCents: number,
    billedCents = approvedCents,
  ) {
    const claim = await this.claim(member, billedCents);
    const { status } = await this.decide(adjuster, claim.id, {
      decision: 'APPROVE',
      approvedCents,
    });
    if (status !== 200) throw new Error(`approve setup failed: ${status}`);
    return claim;
  }
}

export function daysFrom(today: string, days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
