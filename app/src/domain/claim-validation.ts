// docs/business-rules.md §4. Returns every problem at once so the form can show them together.

export const MIN_BILLED_CENTS = 1;
export const MAX_BILLED_CENTS = 10_000_000;
export const MAX_SERVICE_AGE_DAYS = 365;

export interface ClaimInput {
  procedureCode: unknown;
  serviceDate: unknown;
  billedCents: unknown;
}

export type FieldErrors = Partial<Record<keyof ClaimInput | 'member', string>>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function validateClaim(
  input: ClaimInput,
  today: string,
  knownProcedureCodes: ReadonlySet<string>,
): FieldErrors {
  const errors: FieldErrors = {};

  if (
    typeof input.billedCents !== 'number' ||
    !Number.isInteger(input.billedCents) ||
    input.billedCents < MIN_BILLED_CENTS ||
    input.billedCents > MAX_BILLED_CENTS
  ) {
    errors.billedCents = 'Billed amount must be between $0.01 and $100,000.00.';
  }

  const serviceDate = parseIsoDate(input.serviceDate);
  if (serviceDate === null) {
    errors.serviceDate = 'Service date must be a valid date (YYYY-MM-DD).';
  } else {
    const ageDays = (parseIsoDate(today)! - serviceDate) / MS_PER_DAY;
    if (ageDays < 0) {
      errors.serviceDate = 'Service date cannot be in the future.';
    } else if (ageDays > MAX_SERVICE_AGE_DAYS) {
      errors.serviceDate = `Service date cannot be more than ${MAX_SERVICE_AGE_DAYS} days ago.`;
    }
  }

  if (typeof input.procedureCode !== 'string' || !knownProcedureCodes.has(input.procedureCode)) {
    errors.procedureCode = 'Choose a procedure code from the list.';
  }

  return errors;
}

// Returns UTC midnight in ms, or null. Rejects dates like 2026-02-30 that Date would roll over.
function parseIsoDate(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms;
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
