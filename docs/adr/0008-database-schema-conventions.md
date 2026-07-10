# ADR-0008 — Database schema conventions

- **Date:** 2026-07-09 (retroactive; conventions inherited from the parent codebase, reviewed and affirmed/annotated here)
- **Status:** Accepted

Four conventions run through `packages/db/src/schema.ts`. Their provenance
differs, so each is labeled honestly.

## 1. Text primary keys, generated in application code (inherited, not deliberated)

Every table uses `text('id').primaryKey()` with `crypto.randomUUID()`
supplied at insert — no native `uuid` type, no DB defaults. Half forced:
better-auth emits text ids and everything references `users.id`. The
app-generated half has a real benefit (ids exist before insert; related
rows build in one round trip). Known cost: 36-char strings index worse
than native uuids, and v4 randomness fragments indexes.

**Improvement path**: because generation lives in app code and the columns
are plain text, switching to UUIDv7 (time-ordered, index-friendly) is a
one-line generator change with no schema migration. Do that before
chasing any index-locality problem harder ways.

## 2. CHECK constraints instead of pg enums (endorsed)

Roles and statuses are `text` + `check(... IN (...))`, not `pgEnum`.
Postgres enums are hard to evolve (values can't be removed or reordered);
a CHECK changes in one ordinary migration. Keep this.

## 3. Hard deletes only (deliberate — chosen for simplicity)

No `deleted_at` anywhere; deletes are real. Soft delete is a per-app
product decision that infects every query with tombstone filtering — apps
that need it should add it consciously, not inherit it.

## 4. `onDelete: 'restrict'` on all user references (safe default with a known wall)

Workspace→children relations cascade; every `user_id` /
`created_by_user_id` reference restricts. Consequence: **a user who has
created or joined anything cannot be deleted.** There is no delete-account
feature today, so nothing is broken — and this is intentional guardrail
posture: restrict fails loudly instead of destroying data behind an
undesigned feature.

When a delete-account feature (or a GDPR erasure obligation) arrives, the
deletion semantics must be designed first — reassign vs anonymize vs
block-until-transfer, per relation. The FK changes themselves are cheap
`ALTER TABLE` migrations with no backfill; decided 2026-07-09 that
changing them preemptively saves nothing and forecloses those choices.
