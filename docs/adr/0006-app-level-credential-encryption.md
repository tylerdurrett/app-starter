# ADR-0006 — Integration credentials: app-level AES-256-GCM envelopes under a single env-var key

- **Date:** 2026-07-09 (retroactive; decision inherited from the parent codebase's integrations framework, 2026-04-18)
- **Status:** Accepted

## Context

The integrations framework stores third-party credentials (per-connector
`credentialFields`, e.g. Slack `botToken`/`signingSecret`) in the
`integrations.config` jsonb column. They must be unreadable to anyone with
database access alone.

## Decision

Secret fields are encrypted field-by-field in application code
(`apps/server/src/integrations/crypto.ts`) with AES-256-GCM into versioned
envelopes `{v: 1, iv, tag, ct}`, keyed by a single 32-byte
`CREDENTIAL_ENCRYPTION_KEY` env var. The server refuses to start on a
missing/malformed key. Two invariants ride along:

- **Plaintext credentials never flow to HTTP responses** — the service
  layer masks on read at one boundary, so no route can leak by accident.
- **Key loss degrades, never 500s**: rows whose credentials can't be
  decrypted return `credentialsReadable: false` with ciphertext stripped,
  so the UI offers delete-and-reconnect. (Born as a real bug fix in the
  parent repo: the dev setup script regenerates the key when `.env` lacks
  one, which orphans existing ciphertext.)

## Honest provenance

The mechanism was deliberate and specified before code (authenticated
encryption; tamper-evident tag; fail-fast key validation), but
**alternatives were never evaluated** — KMS/Vault/pgcrypto appear nowhere
in the parent repo's planning docs. The parent spec knowingly accepted the
env-var key as the weak point: leaking it decrypts every stored credential.
This is a pragmatic self-contained default calibrated to chat-bot tokens;
an app handling more sensitive credentials should revisit key custody
(KMS/HSM) rather than cite this ADR.

## Rotation is an accepted non-goal, not a solved problem

The `v: 1` version field is cheap insurance, not a rotation feature.
Rotating the key requires a decrypt-old/re-encrypt-new migration over
`integrations.config`, and no tooling for that exists. The parent repo's
deployment checklist carried this as an unchecked item ("plan a
maintenance script before you need it"); the same applies here. Until
tooling exists, a key change means every integration must be reconnected
(the graceful-degradation path makes that survivable, not painless).
