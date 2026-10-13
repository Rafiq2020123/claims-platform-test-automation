import type { FastifyPluginAsync } from 'fastify';
import type { Session } from '../auth.js';
import { inTransaction, type DbClient } from '../db.js';
import { canTransition, DENIAL_REASONS, type ClaimStatus } from '../domain/claim-status.js';
import { todayUtc, validateClaim } from '../domain/claim-validation.js';
import { ApiError, notFound } from '../errors.js';
import { requireRole } from '../server.js';

export const CLAIM_COLUMNS = `
  id, member_id AS "memberId", procedure_code AS "procedureCode", service_date AS "serviceDate",
  billed_cents AS "billedCents", status, approved_cents AS "approvedCents",
  denial_reason AS "denialReason", created_at AS "createdAt", updated_at AS "updatedAt"`;

export interface Claim {
  id: string;
  memberId: string;
  status: ClaimStatus;
  billedCents: number;
  approvedCents: number | null;
}

interface NewClaim {
  procedureCode: unknown;
  serviceDate: unknown;
  billedCents: unknown;
}

type Decision =
  | { decision: 'APPROVE'; approvedCents: number }
  | { decision: 'DENY'; reasonCode: string }
  | { decision: 'PEND' };

const DECISION_TO_STATUS = { APPROVE: 'APPROVED', DENY: 'DENIED', PEND: 'PENDED' } as const;

export const claimRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: NewClaim }>(
    '/claims',
    { schema: { body: { type: 'object' } } },
    async (request, reply) => {
      const session = requireRole(request, 'member');

      // Types are checked by validateClaim, not the schema, so a wrong type gets the same
      // readable message as an out-of-range value.
      const [codes, member] = await Promise.all([
        app.db.query<{ code: string }>('SELECT code FROM procedure_codes'),
        app.db.query<{ active: boolean }>('SELECT active FROM users WHERE id = $1', [
          session.userId,
        ]),
      ]);
      const errors = validateClaim(
        request.body,
        todayUtc(),
        new Set(codes.rows.map((row) => row.code)),
      );
      if (!member.rows[0]?.active) {
        errors.member = 'Your coverage is not active, so new claims cannot be submitted.';
      }
      if (Object.keys(errors).length > 0) {
        throw new ApiError(400, 'VALIDATION_FAILED', 'Please fix the highlighted fields.', errors);
      }

      const claim = await inTransaction(app.db, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO claims (member_id, procedure_code, service_date, billed_cents, correlation_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING ${CLAIM_COLUMNS}`,
          [
            session.userId,
            request.body.procedureCode,
            request.body.serviceDate,
            request.body.billedCents,
            request.id,
          ],
        );
        await recordStatusChange(client, rows[0].id, null, 'SUBMITTED', session, request.id);
        return rows[0];
      });

      return reply.status(201).send(claim);
    },
  );

  app.get('/claims', async (request) => {
    const session = requireRole(request, 'member', 'adjuster');
    const { rows } =
      session.role === 'member'
        ? await app.db.query(
            `SELECT ${CLAIM_COLUMNS} FROM claims WHERE member_id = $1 ORDER BY created_at DESC`,
            [session.userId],
          )
        : await app.db.query(`SELECT ${CLAIM_COLUMNS} FROM claims ORDER BY created_at DESC`);
    return rows;
  });

  app.get<{ Params: { id: string } }>('/claims/:id', async (request) => {
    const session = requireRole(request, 'member', 'adjuster');
    return findVisibleClaim(app.db, request.params.id, session);
  });

  app.post<{ Params: { id: string }; Body: Decision }>(
    '/claims/:id/decision',
    {
      schema: {
        body: {
          type: 'object',
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['APPROVE', 'DENY', 'PEND'] },
            approvedCents: { type: 'integer' },
            reasonCode: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const session = requireRole(request, 'adjuster');
      const body = request.body;
      const target = DECISION_TO_STATUS[body.decision];

      return inTransaction(app.db, async (client) => {
        const claim = await lockClaim(client, request.params.id);
        if (!canTransition(claim.status, target)) {
          throw new ApiError(
            409,
            'INVALID_TRANSITION',
            `A ${claim.status} claim cannot be ${target}.`,
          );
        }

        let approvedCents: number | null = null;
        let denialReason: string | null = null;
        if (body.decision === 'APPROVE') {
          if (!(body.approvedCents > 0 && body.approvedCents <= claim.billedCents)) {
            throw new ApiError(400, 'VALIDATION_FAILED', 'Please fix the highlighted fields.', {
              approvedCents:
                'Approved amount must be more than $0 and no more than the billed amount.',
            });
          }
          approvedCents = body.approvedCents;
        }
        if (body.decision === 'DENY') {
          if (!(DENIAL_REASONS as readonly string[]).includes(body.reasonCode)) {
            throw new ApiError(400, 'VALIDATION_FAILED', 'Please fix the highlighted fields.', {
              reasonCode: `Reason must be one of: ${DENIAL_REASONS.join(', ')}.`,
            });
          }
          denialReason = body.reasonCode;
        }

        const { rows } = await client.query(
          `UPDATE claims SET status = $2, approved_cents = $3, denial_reason = $4, updated_at = now()
           WHERE id = $1 RETURNING ${CLAIM_COLUMNS}`,
          [claim.id, target, approvedCents, denialReason],
        );
        await recordStatusChange(client, claim.id, claim.status, target, session, request.id);
        return rows[0];
      });
    },
  );
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Members get 404 for other people's claims, same as for a claim that doesn't exist (rules §3).
export async function findVisibleClaim(
  db: { query: DbClient['query'] },
  id: string,
  session: Session,
): Promise<Claim> {
  if (!UUID.test(id)) throw notFound();
  const { rows } = await db.query(`SELECT ${CLAIM_COLUMNS} FROM claims WHERE id = $1`, [id]);
  const claim = rows[0] as Claim | undefined;
  if (!claim || (session.role === 'member' && claim.memberId !== session.userId)) {
    throw notFound();
  }
  return claim;
}

export async function lockClaim(client: DbClient, id: string): Promise<Claim> {
  if (!UUID.test(id)) throw notFound();
  const { rows } = await client.query(
    `SELECT ${CLAIM_COLUMNS} FROM claims WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw notFound();
  return rows[0] as Claim;
}

export async function recordStatusChange(
  client: DbClient,
  claimId: string,
  from: ClaimStatus | null,
  to: ClaimStatus,
  session: Session,
  correlationId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO claim_status_history (claim_id, from_status, to_status, changed_by, correlation_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [claimId, from, to, session.userId, correlationId],
  );
}
