import { describe, expect, it } from 'vitest';
import { getPostgresOptions, POSTGRES_POOL_MAX } from '@repo/db';
import { getDrizzleDatabaseUrl } from '../../../drizzle.config.js';

describe('Postgres client options', () => {
  it('sets an explicit pool size in every environment and requires SSL in production', () => {
    expect(getPostgresOptions('production')).toEqual({
      max: POSTGRES_POOL_MAX,
      ssl: 'require',
    });
  });

  it('does not force SSL outside production', () => {
    expect(getPostgresOptions('development')).toEqual({ max: POSTGRES_POOL_MAX });
    expect(getPostgresOptions('test')).toEqual({ max: POSTGRES_POOL_MAX });
    expect(getPostgresOptions(undefined)).toEqual({ max: POSTGRES_POOL_MAX });
  });
});

describe('Drizzle migration database URL', () => {
  it('adds sslmode=require in production', () => {
    expect(getDrizzleDatabaseUrl(
      'production',
      'postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
    )).toBe(
      'postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require',
    );
  });

  it('preserves explicit SSL mode in production', () => {
    expect(getDrizzleDatabaseUrl(
      'production',
      'postgresql://user:pass@db.example.com:5432/postgres?sslmode=verify-full',
    )).toBe('postgresql://user:pass@db.example.com:5432/postgres?sslmode=verify-full');
  });

  it('leaves local URLs unchanged outside production', () => {
    const localUrl = 'postgresql://postgres:postgres@127.0.0.1:5150/postgres';
    expect(getDrizzleDatabaseUrl('development', localUrl)).toBe(localUrl);
  });
});
