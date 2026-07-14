# Better Auth 1.6.5 → 1.6.23 upgrade notes

Issue #123. Upgrades `better-auth`, `@better-auth/oauth-provider`, and
`@better-auth/drizzle-adapter` past the token-race advisories
GHSA-7w99-5wm4-3g79 (authorization-code single use) and GHSA-392p-2q2v-4372
(refresh-token rotation), plus GHSA-86j7-9j95-vpqj (stored XSS via
`javascript:` redirect_uri). 1.6.23 — not the 1.6.11 advisory floor — because
the drizzle adapter only reports correct affected-rowcounts for the
postgres-js driver (this repo's driver) as of 1.6.23.

## Deploy caveat: unique constraint on refresh tokens

Migration `0002_condemned_clea.sql` adds `UNIQUE(token)` to
`oauth_refresh_tokens` (upstream's canonical schema gained it in 1.6.11; the
generator does not emit it for existing installs). The migration fails if
duplicate token values exist — possible only as revoked-era artifacts of the
pre-upgrade rotation race. Check before deploying:

```sql
SELECT token FROM oauth_refresh_tokens GROUP BY token HAVING count(*) > 1;
```

If rows come back, delete the duplicates (they are race artifacts; affected
clients simply re-authenticate), then migrate.

## Local patch: `@better-auth/drizzle-adapter` refresh-rotation race

The 1.6.23 rotation fix is a compare-and-set via the adapter's
`incrementOne`, which updates through
`WHERE id IN (SELECT id ... WHERE revoked IS NULL LIMIT 1)`. Under Postgres
READ COMMITTED, a concurrent writer triggers an EvalPlanQual recheck that
re-evaluates only the materialized id list — not `revoked IS NULL` — so two
overlapping rotations of the same refresh token could **both** succeed
(reproduced 198/200 in a two-connection probe; the regression test flaked
~1 in 3 runs). `patches/@better-auth__drizzle-adapter@1.6.23.patch` adds
`FOR UPDATE` to the candidate-row subquery (the MySQL path already locks),
which yields exactly one winner 200/200. Report upstream and drop the patch
once fixed; `apps/server/test/oauth-token-races.test.ts` guards the behavior
either way.

## Residual advisory (accepted)

`GHSA-p2fr-6hmx-4528` (moderate, oauth-provider >=1.4.8 <1.7.0-beta.4) is not
patched on the 1.6.x stable line. It concerns audience validation when
multiple audiences are configured; this deployment passes a single-entry
`validAudiences: [config.mcpCanonicalUrl]` (`apps/server/src/auth.ts`), so
tokens cannot be replayed across audiences. Revisit when 1.7.0 goes stable.

## Behavior changes noticed (nothing in-repo depended on them)

- Token endpoint error code for a replayed/invalid authorization code is now
  `invalid_grant` (was `invalid_verification`); replayed codes return 401,
  exhausted refresh tokens 400.
- `registration_endpoint` is absent from `.well-known` discovery because
  dynamic client registration is disabled (1.6.12 behavior).
- Skipped upstream 1.6.10 generated-schema FK indexes — performance parity
  only, and our schema flow is drizzle-kit migrations, not the generator.
- `apps/web` had an exact `better-auth: 1.6.5` pin (baseline-import artifact);
  normalized to caret (`^1.6.23`) to match the rest of the repo.
