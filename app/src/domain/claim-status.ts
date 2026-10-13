export const CLAIM_STATUSES = ['SUBMITTED', 'PENDED', 'APPROVED', 'DENIED', 'PAID'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// docs/business-rules.md §5. PAID is reachable only by recording a payment, never by a decision.
const ALLOWED: Record<ClaimStatus, readonly ClaimStatus[]> = {
  SUBMITTED: ['APPROVED', 'DENIED', 'PENDED'],
  PENDED: ['APPROVED', 'DENIED'],
  APPROVED: ['PAID'],
  DENIED: [],
  PAID: [],
};

export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return ALLOWED[from].includes(to);
}

export const DENIAL_REASONS = [
  'NOT_COVERED',
  'MISSING_INFORMATION',
  'DUPLICATE_CLAIM',
  'OUT_OF_NETWORK',
] as const;
export type DenialReason = (typeof DENIAL_REASONS)[number];
