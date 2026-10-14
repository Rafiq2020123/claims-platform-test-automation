import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The payment tests take their expected values from the table in docs/business-rules.md,
// not from a copy of it. If the doc and the tests ever disagree, the tests fail, which is
// the point: the doc is the oracle, and the app has no say in what the right answer is.

export interface WorkedExample {
  row: number;
  plan: 'SILVER' | 'GOLD';
  approvedCents: number;
  paymentCents: number;
  note: string;
}

const RULES_PATH = fileURLToPath(new URL('../../docs/business-rules.md', import.meta.url));
const ROW =
  /^\| (\d+) \| (SILVER|GOLD) \| (\d+) \| [\d.]+ \| \d+ \| \d+ \| \*\*(\d+)\*\* \| (.+?) \|$/;

export function workedExamples(): WorkedExample[] {
  const text = readFileSync(RULES_PATH, 'utf8');
  const section = text.split('### Worked examples')[1]?.split(/\r?\n## /)[0] ?? '';
  const examples = section
    .split(/\r?\n/)
    .map((line) => ROW.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      row: Number(m[1]),
      plan: m[2] as 'SILVER' | 'GOLD',
      approvedCents: Number(m[3]),
      paymentCents: Number(m[4]),
      note: m[5]!,
    }));
  if (examples.length === 0) throw new Error('No worked examples found in business-rules.md');
  return examples;
}

export const PLANS = {
  SILVER: { coverageBp: 8000, copayCents: 2000 },
  GOLD: { coverageBp: 9000, copayCents: 0 },
} as const;
