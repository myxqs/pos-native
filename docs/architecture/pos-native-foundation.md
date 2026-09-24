# POS Native Foundation Architecture

## Purpose

POS Native is a self-hosted, single-user, canonical personal workspace. It
provides pages, blocks, flexible databases, graph relations, assets, search,
audit history, exports, backups, and bounded machine access. It is not a
Notion clone, a multi-tenant SaaS product, or Local Steward.

## Delivery decomposition

1. **Foundation and persistence (current source):** monorepo, contracts,
   canonical identifiers, validation, common mutation/audit boundary, ADRs,
   threat model, PostgreSQL schema/migrations, transactional repositories,
   page/block/revision persistence, and filesystem asset abstraction.
2. **Live persistence acceptance (pending):** a disposable PostgreSQL run must
   prove migrations and transactional adapters before the source implementation
   is described as live-persistence ready.
3. **Private API (current source):** local account/session authentication,
   versioned HTTP API, page/block mutation endpoints, rate limits and security
   headers. Owner bootstrap and authenticated browser use remain live gates.
4. **Workspace UI:** the current responsive browser shell provides an active
   hierarchy tree, breadcrumbs, child creation, move, archive, and explicit
   archived-page restore. A React PWA shell and the TipTap/ProseMirror adapter
   direction recorded by ADR-0008 remain later product work. Any adapter maps to the native
   block-document API; it never owns canonical IDs or persistence.
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

`human client | (future importer) | API | (future MCP)` -> runtime validation -> domain command
-> transaction/repository -> revision + append-only audit event -> response.

No client, importer, MCP tool, or UI component may write storage directly.
All canonical entities use native UUIDs. `ExternalIdentity` maps provider IDs
to native IDs but never substitutes for them.

Page body documents use a separate optimistic-concurrency revision stream from
page metadata. Replacements are validated and transactionally persisted with
revision and audit records; omitted blocks are soft-archived. The current
browser adapter deliberately declines richer or nested documents until a
capable representation is proven.

Page archive state is enforced again at the body persistence boundary. A page
that becomes archived after the API's initial liveness check cannot receive a
new body revision, block mutation, or body audit event; the archived body stays
readable for recovery.

## Hierarchy policy (current source)

Pages use one nullable `parent_id` edge rather than a second tree store. Roots
are depth zero and every resulting page—including an archived descendant—must
remain at or below thirty-two parent edges, have an extant ancestry, and avoid
cycles. Live pages additionally require live ancestors. Archive is leaf-only;
restore is deliberate and targets a live parent or root. Each move, archive,
and restore follows the existing metadata compare-and-swap, revision, and
append-only audit boundary. Body-document revisions remain independent.

The browser requests the active tree during normal navigation and requests
archived records only after the user opens that recovery surface. It renders a
validated hierarchy with DOM `textContent`, rejects malformed server trees,
keeps archived body editing read-only, and guards late requests/mutations from
replacing a newer selection or draft. A successful late metadata mutation still
reconciles the navigation lists, but it does not replace the newer editor state
or its unsaved title/parent draft.

## Initial domain boundary

The first vertical slice introduced a pure `createPage` command. It validates
input, creates stable native IDs/timestamps, emits a page revision, and emits
an audit event through one result envelope. The current composition supplies
both in-memory and PostgreSQL adapters while retaining that stable command
contract. Live PostgreSQL acceptance remains an explicit environment gate.

## Reference implementation boundary

NativePOS retains the existing TypeScript/PostgreSQL canonical model. External
repositories are capability references, not alternate stores or automatic
dependencies. `docs/architecture/DONOR_MATRIX.md` records the bounded public
review and the exact conditions required before any future source adaptation.
This keeps useful context, provenance, import, recovery, and protocol ideas
available without gluing multiple products together or weakening the common
domain/API/audit boundary.

## Security baseline

- No telemetry or analytics by default.
- Passwords use Argon2id; secrets remain environment/configuration only.
- Secure session cookies, CSRF controls, CSP/security headers, input
  validation, and rate limiting are implemented at the API boundary. HTTPS/
  private-Tailscale deployment and live owner/browser acceptance remain
  deployment gates.
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
