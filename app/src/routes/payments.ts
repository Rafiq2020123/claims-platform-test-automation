import type { FastifyPluginAsync } from 'fastify';
import { inTransaction } from '../db.js';
import { calculatePayment } from '../domain/payment.js';
import { ApiError, notFound } from '../errors.js';
import { requireRole } from '../server.js';
import { findVisibleClaim, lockClaim, recordStatusChange } from './claims.js';

const PAYMENT_COLUMNS = `
  id, claim_id AS "claimId", amount_cents AS "amountCents", approved_cents AS "approvedCents",
  coverage_bp AS "coverageBp", copay_cents AS "copayCents", created_at AS "createdAt"`;

interface PaymentRow {
  id: string;
  claimId: string;
}

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  // docs/business-rules.md §7
  app.post<{ Params: { id: string } }>('/claims/:id/payment', async (request, reply) => {
    const session = requireRole(request, 'adjuster');
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0 || key.length > 200) {
      throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required.');
    }

    const result = await inTransaction(app.db, async (client) => {
      // Lock the claim first. Two requests with the same key then run one after the other,
      // and the second one finds the first one's payment below instead of racing it.
      const claim = await lockClaim(client, request.params.id);

      const existing = await client.query<PaymentRow>(
        `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE idempotency_key = $1`,
        [key],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].claimId !== claim.id) {
          throw new ApiError(
            422,
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was already used for a different claim.',
          );
        }
        return { payment: existing.rows[0], replayed: true };
      }

      if (claim.status !== 'APPROVED' || claim.approvedCents === null) {
        throw new ApiError(
          409,
          'INVALID_TRANSITION',
          `Only an APPROVED claim can be paid. This one is ${claim.status}.`,
        );
      }

      const { rows: planRows } = await client.query<{ coverageBp: number; copayCents: number }>(
        `SELECT p.coverage_bp AS "coverageBp", p.copay_cents AS "copayCents"
         FROM users u JOIN plans p ON p.code = u.plan_code WHERE u.id = $1`,
        [claim.memberId],
      );
      const plan = planRows[0];
      if (!plan) throw new Error(`Member ${claim.memberId} has no plan`);

      const rounding = app.config.demoDefect === 'payment-rounding' ? 'truncate' : 'half-up';
      const amountCents = calculatePayment(claim.approvedCents, plan, rounding);

      const { rows } = await client.query<PaymentRow>(
        `INSERT INTO payments (claim_id, idempotency_key, amount_cents, approved_cents,
                               coverage_bp, copay_cents, recorded_by, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${PAYMENT_COLUMNS}`,
        [
          claim.id,
          key,
          amountCents,
          claim.approvedCents,
          plan.coverageBp,
          plan.copayCents,
          session.userId,
          request.id,
        ],
      );
      await client.query(`UPDATE claims SET status = 'PAID', updated_at = now() WHERE id = $1`, [
        claim.id,
      ]);
      await recordStatusChange(client, claim.id, 'APPROVED', 'PAID', session, request.id);
      return { payment: rows[0], replayed: false };
    });

    return reply.status(result.replayed ? 200 : 201).send(result.payment);
  });

  app.get<{ Params: { id: string } }>('/claims/:id/payment', async (request) => {
    const session = requireRole(request, 'member', 'adjuster');
    const claim = await findVisibleClaim(app.db, request.params.id, session);
    const { rows } = await app.db.query(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE claim_id = $1`,
      [claim.id],
    );
    if (!rows[0]) throw notFound('Payment');
    return rows[0];
  });
};
