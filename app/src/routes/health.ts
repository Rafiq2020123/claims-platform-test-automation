import type { FastifyPluginAsync } from 'fastify';
import { todayUtc } from '../domain/claim-validation.js';

// `today` is the date the server uses for the service-date rules. Tests read it from here
// instead of computing their own, so a run that crosses midnight UTC doesn't flake.
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    await app.db.query('SELECT 1');
    return { status: 'ok', today: todayUtc() };
  });

  app.get('/procedure-codes', async () => {
    const { rows } = await app.db.query(
      'SELECT code, description FROM procedure_codes ORDER BY code',
    );
    return rows;
  });
};
