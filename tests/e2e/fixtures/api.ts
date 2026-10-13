import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';

// Test data goes in through the API, not the UI. Setting up a claim by clicking through the
// form would take seconds and couple every test to the form; one API call takes milliseconds
// and leaves the UI tests to test the UI.

export interface Credentials {
  email: string;
  password: string;
}

export interface TestMember extends Credentials {
  id: string;
  planCode: 'SILVER' | 'GOLD';
  token: string;
}

export interface Claim {
  id: string;
  status: string;
  billedCents: number;
  approvedCents: number | null;
}

export class Api {
  constructor(
    private readonly request: APIRequestContext,
    private readonly adjusterToken: string,
  ) {}

  static async signIn(request: APIRequestContext, creds: Credentials): Promise<string> {
    const response = await request.post('/api/session', { data: creds });
    if (!response.ok()) throw new Error(`sign-in as ${creds.email} failed: ${response.status()}`);
    return ((await response.json()) as { token: string }).token;
  }

  // One member per test, named after the worker so parallel runs never share data.
  async createMember(
    workerIndex: number,
    planCode: 'SILVER' | 'GOLD' = 'SILVER',
    active = true,
  ): Promise<TestMember> {
    const creds = {
      email: `e2e.w${workerIndex}.${randomUUID().slice(0, 8)}@claimpay.test`,
      password: 'e2e-password',
    };
    const response = await this.request.post('/api/members', {
      headers: this.auth(),
      data: { ...creds, fullName: `E2E Member ${workerIndex}`, planCode, active },
    });
    if (!response.ok()) throw new Error(`createMember failed: ${response.status()}`);
    const { id } = (await response.json()) as { id: string };
    const token = await Api.signIn(this.request, creds);
    return { ...creds, id, planCode, token };
  }

  async submitClaim(
    member: TestMember,
    billedCents: number,
    overrides: Partial<{ procedureCode: string; serviceDate: string }> = {},
  ): Promise<Claim> {
    const response = await this.request.post('/api/claims', {
      headers: { Authorization: `Bearer ${member.token}` },
      data: {
        procedureCode: 'PC-1001',
        serviceDate: await this.today(),
        billedCents,
        ...overrides,
      },
    });
    if (!response.ok()) throw new Error(`submitClaim failed: ${response.status()}`);
    return (await response.json()) as Claim;
  }

  async approve(claimId: string, approvedCents: number): Promise<Claim> {
    return this.decide(claimId, { decision: 'APPROVE', approvedCents });
  }

  async deny(claimId: string, reasonCode = 'NOT_COVERED'): Promise<Claim> {
    return this.decide(claimId, { decision: 'DENY', reasonCode });
  }

  async pay(claimId: string): Promise<{ amountCents: number }> {
    const response = await this.request.post(`/api/claims/${claimId}/payment`, {
      headers: { ...this.auth(), 'Idempotency-Key': randomUUID() },
    });
    if (!response.ok()) throw new Error(`pay failed: ${response.status()}`);
    return (await response.json()) as { amountCents: number };
  }

  // The server's idea of today, so the service-date rules hold even if a run crosses midnight.
  async today(): Promise<string> {
    const response = await this.request.get('/api/health');
    return ((await response.json()) as { today: string }).today;
  }

  private async decide(claimId: string, body: Record<string, unknown>): Promise<Claim> {
    const response = await this.request.post(`/api/claims/${claimId}/decision`, {
      headers: this.auth(),
      data: body,
    });
    if (!response.ok()) throw new Error(`decide failed: ${response.status()}`);
    return (await response.json()) as Claim;
  }

  private auth() {
    return { Authorization: `Bearer ${this.adjusterToken}` };
  }
}
