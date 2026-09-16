# ADR 0002: Editor and persistence selections are deferred to verified phase gates

## Status

Proposed — 2026-09-14.

## Decision

The block editor will be selected from maintained open-source candidates
(BlockNote and TipTap/ProseMirror are initial candidates) during the workspace
UI phase. The PostgreSQL query/migration layer will be selected during the
persistence phase from Drizzle, Kysely, Prisma or a defensible alternative.

## Guardrails

The editor never owns canonical block IDs or the persistence format. The query
layer must expose reviewable PostgreSQL migrations, support transactions and
complex relation queries, and avoid opaque lock-in. Each final selection needs
a superseding ADR with version, license, evaluation evidence and migration
implications before production code depends on it.
