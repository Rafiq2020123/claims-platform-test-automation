import type { FastifyPluginAsync } from 'fastify';
import { hashPassword } from '../auth.js';
import { ApiError } from '../errors.js';
import { requireRole } from '../server.js';

interface NewMember {
  email: string;
  fullName: string;
  planCode: 'SILVER' | 'GOLD';
  password: string;
  active?: boolean;
}

// Enrollment. Adjusters use it in the app; the test suites use it to give each test its own member.
export const memberRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: NewMember }>(
    '/members',
    {
      config: { roles: ['adjuster'] },
      schema: {
        body: {
          type: 'object',
          required: ['email', 'fullName', 'planCode', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 200 },
            fullName: { type: 'string', minLength: 1, maxLength: 200 },
            planCode: { type: 'string', enum: ['SILVER', 'GOLD'] },
            password: { type: 'string', minLength: 8, maxLength: 200 },
            active: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      requireRole(request, 'adjuster');
      const { email, fullName, planCode, password, active = true } = request.body;

      const { rows } = await app.db.query(
        `INSERT INTO users (email, full_name, role, plan_code, active, password_hash)
         VALUES ($1, $2, 'member', $3, $4, $5)
         ON CONFLICT (lower(email)) DO NOTHING
         RETURNING id, email, full_name AS "fullName", plan_code AS "planCode", active`,
        [email.toLowerCase(), fullName, planCode, active, await hashPassword(password)],
      );
      if (!rows[0]) {
        throw new ApiError(409, 'EMAIL_TAKEN', 'A member with that email already exists.');
      }
      return reply.status(201).send(rows[0]);
    },
  );
};
