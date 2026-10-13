export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  correlationId: string | null;
}

export interface Claim {
  id: string;
  memberId: string;
  procedureCode: string;
  serviceDate: string;
  billedCents: number;
  status: string;
  approvedCents: number | null;
  denialReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  claimId: string;
  amountCents: number;
}

export class ApiClient {
  constructor(baseUrl?: string, fetchImpl?: typeof fetch);
  token: string | null;
  signIn(email: string, password: string): Promise<{ id: string; fullName: string; role: string }>;
  signOut(): void;
  procedureCodes(): Promise<{ code: string; description: string }[]>;
  listClaims(): Promise<Claim[]>;
  submitClaim(input: {
    procedureCode: string;
    serviceDate: string;
    billedCents: number;
  }): Promise<Claim>;
  decideClaim(claimId: string, decision: Record<string, unknown>): Promise<Claim>;
  recordPayment(claimId: string, idempotencyKey: string): Promise<Payment>;
  getPayment(claimId: string): Promise<Payment>;
}
