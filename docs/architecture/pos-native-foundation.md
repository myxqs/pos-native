# POS Native Foundation Architecture

## Purpose

POS Native is a self-hosted, single-user, canonical personal workspace. It
provides pages, blocks, flexible databases, graph relations, assets, search,
audit history, exports, backups, and bounded machine access. It is not a
Notion clone, a multi-tenant SaaS product, or Local Steward.

## Delivery decomposition

1. **Foundation (current):** monorepo, contracts, canonical identifiers,
   validation, common mutation/audit boundary, ADRs and threat model.
2. **Persistence:** PostgreSQL schema/migrations, transactional repositories,
   page/block/revision persistence and filesystem asset abstraction.
3. **Private API:** local account/session authentication, versioned HTTP API,
   page/block mutation endpoints, rate limits and security headers.
4. **Workspace UI:** React PWA shell, page tree, page view, editor adapter and
   accessible desktop/mobile navigation.
5. **Flexible data sources:** property definitions/values, record pages,
   relations, formula subset, rollups and saved table/board/list views.
6. **Navigation:** full-text/trigram search, links, backlinks, graph/context
   bundles and provenance presentation.
7. **Assets and portability:** safe upload/download, export manifests,
   encrypted/offline backup policy, restore drill tooling.
8. **Interoperability:** read-only scoped API tokens and MCP adapter using the
   common API/domain boundary.
9. **Migration/cutover:** read-only Notion importer, external identity mapping,
   dry-runs, integrity/retrieval/backup/restore evidence, explicit user
   approval before canonical cutover.

## Core mutation flow

`human client | importer | API | MCP` -> runtime validation -> domain command
-> transaction/repository -> revision + append-only audit event -> response.

No client, importer, MCP tool, or UI component may write storage directly.
All canonical entities use native UUIDs. `ExternalIdentity` maps provider IDs
to native IDs but never substitutes for them.

## Initial domain boundary

The first vertical slice implements a pure `createPage` command. It validates
input, creates stable native IDs/timestamps, emits a page revision, and emits
an audit event through one result envelope. A database-backed repository will
replace the in-memory composition only in the persistence phase; the command
contract remains stable.

## Security baseline

- No telemetry or analytics by default.
- Passwords will use Argon2id; secrets remain environment/configuration only.
- HTTPS/private Tailscale deployment, secure session cookies, CSRF controls,
  CSP/security headers, input validation and rate limiting are mandatory API
  phase gates.
- Uploaded assets require generated storage keys, filename isolation, MIME and
  size checks, checksums, and path traversal prevention.
- Formulas use a bounded parser/evaluator; no JavaScript eval, shell execution,
  arbitrary code, or untrusted dynamic imports.
- MCP starts read-only and calls the same validated API/domain services.

## Threat model (concise)

Assets include personal records, canonical graph state, credentials/session
material, tokens, backups and audit trails. Primary threats are unauthorised
LAN/tailnet clients, browser cross-site requests, token theft, malformed
imports/uploads, path traversal, dependency compromise, accidental destructive
writes, and over-broad AI retrieval/writes. Mitigations are application
authentication, token scopes, TLS/private networking, CSRF/CSP, runtime
validation, audit/idempotency, generated asset keys, immutable backups, least
privilege and default-deny mutation scopes. Recovery depends on tested restore
procedures, not merely successful backup creation.
