# ADR 0002: Editor and persistence selections are deferred to verified phase gates

## Status

Superseded by ADR-0008 for the editor decision; persistence selection remains
governed by this gate — 2026-09-21.

## Decision

The original editor selection was deferred. ADR-0008 now selects
TipTap/ProseMirror as the future React adapter, while retaining the rule that
the native block-document contract owns identity and persistence. The
PostgreSQL query/migration layer remains selected during the persistence phase
from Drizzle, Kysely, Prisma or a defensible alternative.

## Guardrails

The editor never owns canonical block IDs or the persistence format. The query
layer must expose reviewable PostgreSQL migrations, support transactions and
complex relation queries, and avoid opaque lock-in. Each final selection needs
a superseding ADR with version, license, evaluation evidence and migration
implications before production code depends on it. No TipTap package has been
installed by this decision; installation remains a separate, specifically
authorised and reviewed change.
