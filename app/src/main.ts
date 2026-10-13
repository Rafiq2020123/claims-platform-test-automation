import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { buildServer } from './server.js';

const config = loadConfig();
const db = createPool(config.databaseUrl);
const app = buildServer(config, db);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
