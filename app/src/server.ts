import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify';
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
    now: () => Date;
  }
  interface FastifyRequest {
    session: Session | null;
  }
  interface FastifyContextConfig {
    // Roles allowed on this route. Checked in onRequest, before the body is parsed or validated,
    // so an unauthenticated caller gets 401 rather than a validation error.
    roles?: readonly Role[];
  }
}

// Anything outside this pattern is replaced, so a caller can't inject junk into the logs.
const CORRELATION_ID = /^[A-Za-z0-9._-]{1,100}$/;

export interface ServerOptions {
  // Where the server gets the time from. Production uses the real clock; tests that depend on
  // the service-date window pass a fixed one, so a run that crosses midnight UTC can't flake and
  // the committed contract stays valid after a year.
  now?: () => Date;
}

export function buildServer(config: Config, db: Db, options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'correlationId' }),
    genReqId: (req) => {
      const given = req.headers['x-correlation-id'];
      return typeof given === 'string' && CORRELATION_ID.test(given) ? given : randomUUID();
    },
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('now', options.now ?? (() => new Date()));
  app.decorateRequest('session', null);

  // Some clients send a bodiless POST as a chunked, empty stream with no content type. That is
  // not a body, so don't answer it with 415. Anything with actual bytes and no known type still is.
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    if (body.length === 0) done(null, undefined);
    else done(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON.'), undefined);
  });

  if (config.demoLatencyMs > 0) {
    app.log.warn({ demoLatencyMs: config.demoLatencyMs }, 'DEMO_LATENCY_MS is on');
    // Registered before the auth hook on purpose. Hooks run in order and a throw stops the
    // chain, so if this came second a 401 or 403 would skip the delay. Being first, every
    // API response is delayed, including the error ones.
    app.addHook('onRequest', async (request) => {
      if (!request.url.startsWith('/api/')) return;
      await new Promise((resolve) => setTimeout(resolve, config.demoLatencyMs));
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-correlation-id', request.id);
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      request.session = verifyToken(auth.slice(7), config.authSecret);
    }
    const roles = request.routeOptions.config.roles;
    if (roles) requireRole(request, ...roles);
  });

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

  app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../public/', import.meta.url)),
    cacheControl: false,
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
