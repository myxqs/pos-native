# POS Native

POS Native is a private, self-hosted Personal Operating System for one user.
It is being built as a TypeScript-first monorepo with PostgreSQL as its future
canonical store. The existing Notion workspace remains the canonical source
until migration, integrity, retrieval, backup, and restore acceptance criteria
have been met.

## Current delivery slice

This repository currently establishes the domain contracts and audited mutation
boundary used by every future human, importer, API, and MCP write. It has no
network service, database connection, external integration, or personal data.

## Development

Requirements: Node.js 24 or later.

```powershell
npm test
```

No third-party package is required for the current core-contract test suite.

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
