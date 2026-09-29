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
authenticated API covers sessions, pages, page hierarchy/archive operations,
canonical block documents, structured data, the bounded M5 machine knowledge
interface, the private M6 production-local Docker runtime, and bounded local
asset upload/list/download. Pages can retain audited links to uploaded assets through
an audited, recoverably archived PostgreSQL relationship, and the browser shell exercises these
product boundaries.

Disposable PostgreSQL integration, synthetic owner bootstrap, restart
persistence, and full-state PostgreSQL plus asset backup/restore have passed.
M6 proves loopback-only continuous local operation, explicit machine-token
authentication, durable named-volume restart, and isolated full-state recovery.
Windows reboot acceptance remains a manual human gate. This is not a public
deployment: human browser file-chooser/download, mobile, rich editor, PWA/offline, and
external-provider acceptance remain separate gates. No personal data or Notion
content has been imported.

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

Production-local setup and PowerShell operator commands are documented in
`docs/operations/deployment.md`.

The lockfile pins the project dependencies. Standard verification does not
need a running PostgreSQL service; its live PostgreSQL integration tests are
explicitly opt-in through `TEST_DATABASE_URL` and remain skipped when it is
unset.

## Repository map

- `apps/` — deployable web and API applications; the dedicated MCP adapter is
  planned, not yet implemented.
- `packages/domain/` — canonical IDs, validation, mutation and audit contracts.
- `packages/contracts/` — versioned public API DTOs.
- `docs/architecture/` — system boundaries and threat model.
- `docs/adr/` — durable architectural decisions.
- `docs/superpowers/plans/` — test-first delivery plans.

## Safety boundary

The M5 machine interface is documented in
`docs/architecture/m5-machine-interface.md`. A dedicated thin MCP adapter is
deferred; agents do not receive direct database access.

POS Native must never use external identities as canonical IDs, execute
untrusted code, or mutate data outside its validated, auditable domain layer.
