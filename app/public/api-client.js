// The UI's only way of talking to the API. The contract tests run this same file
// against a mock provider, so a change to a request here is a change to the contract.

export class ApiError extends Error {
  constructor(status, code, message, fields, correlationId) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields ?? {};
    this.correlationId = correlationId;
  }
}

export class ApiClient {
  constructor(baseUrl = '/api', fetchImpl = globalThis.fetch.bind(globalThis)) {
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
    this.token = null;
  }

  async signIn(email, password) {
    const result = await this.request('POST', '/session', { body: { email, password } });
    this.token = result.token;
    return result.user;
  }

  signOut() {
    this.token = null;
  }

  procedureCodes() {
    return this.request('GET', '/procedure-codes');
  }

  listClaims() {
    return this.request('GET', '/claims');
  }

  submitClaim({ procedureCode, serviceDate, billedCents }) {
    return this.request('POST', '/claims', { body: { procedureCode, serviceDate, billedCents } });
  }

  decideClaim(claimId, decision) {
    return this.request('POST', `/claims/${claimId}/decision`, { body: decision });
  }

  recordPayment(claimId, idempotencyKey) {
    return this.request('POST', `/claims/${claimId}/payment`, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  getPayment(claimId) {
    return this.request('GET', `/claims/${claimId}/payment`);
  }

  async request(method, path, { body, headers = {} } = {}) {
    const response = await this.fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const error = payload?.error ?? {};
      throw new ApiError(
        response.status,
        error.code ?? 'UNKNOWN',
        error.message ?? `Request failed (${response.status})`,
        error.fields,
        payload?.correlationId ?? response.headers.get('x-correlation-id'),
      );
    }
    return payload;
  }
}
