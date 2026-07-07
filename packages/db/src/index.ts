import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

export * from './schema.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    '@repo/db: DATABASE_URL environment variable is not set. ' +
      'Ensure .env is loaded before importing @repo/db.',
  );
}

export const POSTGRES_POOL_MAX = 10;

export function getPostgresOptions(nodeEnv = process.env.NODE_ENV) {
  // Keep the pool size explicit for production capacity math; require TLS in
  // production so Supabase credentials and row data are encrypted in transit.
  return nodeEnv === 'production'
    ? { max: POSTGRES_POOL_MAX, ssl: 'require' as const }
    : { max: POSTGRES_POOL_MAX };
}

const client = postgres(connectionString, getPostgresOptions());

/** Drizzle ORM instance backed by the postgres.js client. */
export const db = drizzle(client);

/** Database connectivity probe — throws on failure. */
export async function ping(): Promise<void> {
  await db.execute(sql`SELECT 1`);
}

/** Close the underlying Postgres pool during server shutdown. */
export async function closeDb(): Promise<void> {
  await client.end();
}
