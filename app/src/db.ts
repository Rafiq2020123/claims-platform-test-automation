import pg from 'pg';

// bigint columns come back as strings by default. Every amount here fits well inside
// Number.MAX_SAFE_INTEGER (the claim maximum is 10,000,000 cents), so parse them as numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
// Keep DATE columns as plain YYYY-MM-DD strings instead of local-time Date objects.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}

export async function inTransaction<T>(db: Db, work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
