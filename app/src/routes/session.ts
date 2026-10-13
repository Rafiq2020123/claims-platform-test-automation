import type { FastifyPluginAsync } from 'fastify';
import { signToken, verifyPassword, type Role } from '../auth.js';
import { ApiError } from '../errors.js';

interface UserRow {
  id: string;
  full_name: string;
  role: Role;
  password_hash: string;
}

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { email: string; password: string } }>(
    '/session',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: { email: { type: 'string' }, password: { type: 'string' } },
        },
      },
    },
    async (request) => {
      const { rows } = await app.db.query<UserRow>(
        'SELECT id, full_name, role, password_hash FROM users WHERE lower(email) = lower($1)',
        [request.body.email],
      );
      const user = rows[0];

      // Same answer for an unknown email and a wrong password. Inactive members can still sign in
      // to see their history; they just can't submit new claims.
      const ok = user && (await verifyPassword(request.body.password, user.password_hash));
      if (!user || !ok) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }

      const session = { userId: user.id, role: user.role };
      return {
        token: signToken(session, app.config.authSecret, app.config.tokenTtlSeconds),
        user: { id: user.id, fullName: user.full_name, role: user.role },
      };
    },
  );
};
