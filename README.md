# POS Native

POS Native is a private, self-hosted Personal Operating System for one user.
It is being built as a TypeScript-first monorepo with PostgreSQL as its future
canonical store. The existing Notion workspace remains the canonical source
until migration, integrity, retrieval, backup, and restore acceptance criteria
have been met.

## Current delivery slice

The active implementation is the TypeScript/PostgreSQL architecture in this
repository. It includes PostgreSQL schema migrations and persistence adapters,
a compiled Fastify API runtime, and a restrained responsive browser shell. The
current authenticated API covers sessions, pages, page hierarchy/archive
operations, and canonical block documents; the browser shell exercises the
same page and block boundary.

This is not yet a proven live deployment: PostgreSQL integration is opt-in,
and real owner bootstrap, browser/mobile end-to-end, backup/restore, rich
editor, PWA/offline, and external-provider acceptance remain separate gates.
No personal data or Notion content has been imported.

The existing Notion workspace remains canonical until the approved migration,
integrity, retrieval, backup, and restore gates pass. The public Python/SQLite
v0.1 history is preserved as a legacy/reference implementation only; it is not
an active NativePOS runtime or feature-development track. Open-Self and other
public projects are reference donors only, with no donor code, dependency, or
store integrated into NativePOS.

## Development

Requirements: Node.js 24 or later.

```powershell
npm ci
npm run verify
npm run build
```

The lockfile pins the project dependencies. Standard verification does not
need a running PostgreSQL service; its live PostgreSQL integration tests are
explicitly opt-in through `TEST_DATABASE_URL` and remain skipped when it is
unset.

## Repository map

- `apps/` — deployable web, API, and MCP applications.
- `packages/domain/` — canonical IDs, validation, mutation and audit contracts.
- `packages/contracts/` — versioned public API DTOs.
- `docs/architecture/` — system boundaries and threat model.
- `docs/adr/` — durable architectural decisions.
- `docs/superpowers/plans/` — test-first delivery plans.

## Safety boundary

POS Native must never use external identities as canonical IDs, execute
untrusted code, or mutate data outside its validated, auditable domain layer.
