import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config();

export function getDrizzleDatabaseUrl(
  nodeEnv = process.env.NODE_ENV,
  databaseUrl = process.env.DATABASE_URL,
) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required for Drizzle');
  }

  if (nodeEnv !== 'production') {
    return databaseUrl;
  }

  // Render predeploy migrations connect to Supabase over the public internet;
  // encode sslmode in the URL because Drizzle Kit's URL credentials path uses
  // pg's connectionString directly.
  const url = new URL(databaseUrl);
  if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
  }
  return url.toString();
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/db/src/schema.ts',
  out: './packages/db/drizzle',
  dbCredentials: {
    url: getDrizzleDatabaseUrl(),
  },
});
