import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { verifyToken, type Role, type Session } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { ApiError, forbidden, unauthorized } from './errors.js';
import { claimRoutes } from './routes/claims.js';
import { healthRoutes } from './routes/health.js';
import { memberRoutes } from './routes/members.js';
import { paymentRoutes } from './routes/payments.js';
import { sessionRoutes } from './routes/session.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
  }
  interface FastifyRequest {
    session: Session | null;
  }
}

// Anything outside this pattern is replaced, so a caller can't inject junk into the logs.
const CORRELATION_ID = /^[A-Za-z0-9._-]{1,100}$/;

export function buildServer(config: Config, db: Db): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
    requestIdHeader: false,
    requestIdLogLabel: 'correlationId',
    genReqId: (req) => {
      const given = req.headers['x-correlation-id'];
      return typeof given === 'string' && CORRELATION_ID.test(given) ? given : randomUUID();
    },
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-correlation-id', request.id);
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      request.session = verifyToken(auth.slice(7), config.authSecret);
    }
  });

  if (config.demoLatencyMs > 0) {
    app.log.warn({ demoLatencyMs: config.demoLatencyMs }, 'DEMO_LATENCY_MS is on');
    app.addHook('preHandler', async () => {
      await new Promise((resolve) => setTimeout(resolve, config.demoLatencyMs));
    });
  }
  if (config.demoDefect) {
    app.log.warn({ demoDefect: config.demoDefect }, 'DEMO_DEFECT is on');
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, fields: error.fields },
        correlationId: request.id,
      });
    }
    // Fastify's own client errors: schema validation, malformed or empty JSON, and so on.
    if (isClientError(error)) {
      return reply.status(error.statusCode).send({
        error: { code: 'BAD_REQUEST', message: error.message },
        correlationId: request.id,
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Something went wrong.' },
      correlationId: request.id,
    });
  });

  app.register(healthRoutes, { prefix: '/api' });
  app.register(sessionRoutes, { prefix: '/api' });
  app.register(memberRoutes, { prefix: '/api' });
  app.register(claimRoutes, { prefix: '/api' });
  app.register(paymentRoutes, { prefix: '/api' });

  return app;
}

export function requireRole(request: FastifyRequest, ...roles: Role[]): Session {
  if (!request.session) throw unauthorized();
  if (!roles.includes(request.session.role)) throw forbidden();
  return request.session;
}

function isClientError(error: unknown): error is Error & { statusCode: number } {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}
