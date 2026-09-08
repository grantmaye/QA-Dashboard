import { migrate } from './schema';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface Sql {
  query<T>(text: string, params?: unknown[]): Promise<T[]>;
}
export interface Database extends Sql {
  transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  mode: string;
}

// Both adapters execute the same PostgreSQL statements and migrations.
export async function createDatabase(url?: string, directory?: string): Promise<Database> {
  if (url) {
    const pool = new Pool({ connectionString: url, max: 8 });
    return {
      mode: 'PostgreSQL',
      query: async <T>(text: string, params?: unknown[]) =>
        (await pool.query(text, params)).rows as T[],
      transaction: async <T>(work: (tx: Sql) => Promise<T>) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work({
            query: async <R>(text: string, params?: unknown[]) =>
              (await client.query(text, params)).rows as R[],
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (directory) await mkdir(resolve(directory), { recursive: true });
  const pg = new PGlite(directory);
  await pg.waitReady;
  return {
    mode: 'Embedded PostgreSQL',
    query: async <T>(text: string, params?: unknown[]) => (await pg.query<T>(text, params)).rows,
    transaction: <T>(work: (tx: Sql) => Promise<T>) =>
      pg.transaction(async (tx) =>
        work({
          query: async <R>(text: string, params?: unknown[]) =>
            (await tx.query<R>(text, params)).rows,
        }),
      ),
    close: () => pg.close(),
  };
}

const globalDb = globalThis as unknown as { qaDb?: Promise<Database> };
export function getDatabase() {
  globalDb.qaDb ??= (async () => {
    const db = await createDatabase(
      process.env.DATABASE_URL,
      process.env.PGLITE_DATA_DIR || './.data/qa',
    );
    await migrate(db);
    return db;
  })();
  return globalDb.qaDb;
}
