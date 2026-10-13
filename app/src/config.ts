export type DemoDefect = 'payment-rounding';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  authSecret: string;
  tokenTtlSeconds: number;
  logLevel: string;
  demoDefect: DemoDefect | null;
  demoLatencyMs: number;
}

const MAX_DEMO_LATENCY_MS = 3000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authSecret = required(env, 'AUTH_SECRET');
  if (authSecret.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters');
  }

  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: required(env, 'DATABASE_URL'),
    authSecret,
    tokenTtlSeconds: Number(env.TOKEN_TTL_SECONDS ?? 3600),
    logLevel: env.LOG_LEVEL ?? 'info',
    demoDefect: parseDemoDefect(env.DEMO_DEFECT),
    demoLatencyMs: parseDemoLatency(env.DEMO_LATENCY_MS),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function parseDemoDefect(value: string | undefined): DemoDefect | null {
  if (!value) return null;
  if (value === 'payment-rounding') return value;
  throw new Error(`Unknown DEMO_DEFECT "${value}"`);
}

function parseDemoLatency(value: string | undefined): number {
  if (!value) return 0;
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_DEMO_LATENCY_MS) {
    throw new Error(`DEMO_LATENCY_MS must be an integer from 0 to ${MAX_DEMO_LATENCY_MS}`);
  }
  return ms;
}
