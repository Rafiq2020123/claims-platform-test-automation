-- Money is stored as integer cents and rates as basis points (see docs/business-rules.md §1).

CREATE TABLE plans (
  code         text PRIMARY KEY,
  coverage_bp  integer NOT NULL CHECK (coverage_bp BETWEEN 0 AND 10000),
  copay_cents  integer NOT NULL CHECK (copay_cents >= 0)
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  full_name      text NOT NULL,
  role           text NOT NULL CHECK (role IN ('member', 'adjuster')),
  plan_code      text REFERENCES plans (code),
  active         boolean NOT NULL DEFAULT true,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT members_have_a_plan CHECK (role <> 'member' OR plan_code IS NOT NULL)
);

CREATE TABLE procedure_codes (
  code         text PRIMARY KEY,
  description  text NOT NULL
);

CREATE TABLE claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid NOT NULL REFERENCES users (id),
  procedure_code  text NOT NULL REFERENCES procedure_codes (code),
  service_date    date NOT NULL,
  billed_cents    bigint NOT NULL CHECK (billed_cents BETWEEN 1 AND 10000000),
  status          text NOT NULL DEFAULT 'SUBMITTED'
                  CHECK (status IN ('SUBMITTED', 'PENDED', 'APPROVED', 'DENIED', 'PAID')),
  approved_cents  bigint CHECK (approved_cents > 0 AND approved_cents <= billed_cents),
  denial_reason   text,
  correlation_id  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX claims_member_id_idx ON claims (member_id);

-- One row per status change. Gives an audit trail and makes "how did this claim end up here" answerable.
CREATE TABLE claim_status_history (
  id              bigserial PRIMARY KEY,
  claim_id        uuid NOT NULL REFERENCES claims (id),
  from_status     text,
  to_status       text NOT NULL,
  changed_by      uuid NOT NULL REFERENCES users (id),
  correlation_id  text NOT NULL,
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX claim_status_history_claim_id_idx ON claim_status_history (claim_id);

-- The plan terms are copied onto the payment so a later plan change can't rewrite history.
CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id         uuid NOT NULL UNIQUE REFERENCES claims (id),
  idempotency_key  text NOT NULL UNIQUE,
  amount_cents     bigint NOT NULL CHECK (amount_cents >= 0),
  approved_cents   bigint NOT NULL,
  coverage_bp      integer NOT NULL,
  copay_cents      integer NOT NULL,
  recorded_by      uuid NOT NULL REFERENCES users (id),
  correlation_id   text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
