// See docs/business-rules.md §6. Everything here is integer math on cents and basis points.

export interface PlanTerms {
  coverageBp: number;
  copayCents: number;
}

export type Rounding = 'half-up' | 'truncate';

const BP_PER_WHOLE = 10_000n;

export function calculatePayment(
  approvedCents: number,
  plan: PlanTerms,
  rounding: Rounding = 'half-up',
): number {
  if (!Number.isSafeInteger(approvedCents) || approvedCents <= 0) {
    throw new RangeError(`approvedCents must be a positive integer, got ${approvedCents}`);
  }

  // BigInt keeps the intermediate product exact even at the maximum claim amount.
  const product = BigInt(approvedCents) * BigInt(plan.coverageBp);
  const covered =
    rounding === 'half-up' ? (product + BP_PER_WHOLE / 2n) / BP_PER_WHOLE : product / BP_PER_WHOLE;

  const payment = covered - BigInt(plan.copayCents);
  return payment > 0n ? Number(payment) : 0;
}
