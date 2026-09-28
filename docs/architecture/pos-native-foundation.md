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
2. **Live persistence acceptance (current synthetic evidence):** disposable
   PostgreSQL 18.6 runs prove migrations, transactional adapters, restart
   persistence, and bounded recovery behavior. Production deployment and
   personal-data acceptance remain separate gates.
3. **Private API (current source):** local account/session authentication,
   versioned HTTP API, page/block mutation endpoints, rate limits and security
   headers. Synthetic owner bootstrap and authenticated browser flows have live
   disposable acceptance; production owner creation remains a deployment gate.
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

## Navigation search policy (current source)

Authenticated search reads active `pages.title` and active paragraph text
directly from canonical PostgreSQL rows. Migration 0010 installs `pg_trgm` and
partial GIN full-text/trigram expression indexes as rebuildable accelerators;
there is no separate canonical index or asynchronous synchronization path.
Ranking uses fixed tiers: exact title (500), title prefix (450), title full-text
(400), title trigram (350), paragraph full-text (250), and paragraph trigram
(200), followed by stable score/title/identity tie-breakers. Results collapse
to one best match per page, return plain-text snippets bounded to 240 code
points, and exclude archived pages and blocks.

## Page links and backlinks (current source)

Page links are explicit canonical `page_links` rows with stable UUIDs,
provenance, revisions, and audit events. They do not reuse structured-data
`relation_edges` or infer relationships from paragraph text. Unlinking archives
the forward relationship; relinking creates a new identity. Backlinks are
bounded derived queries over forward rows. Normal navigation requires both
endpoints to be live, while explicit history retains archived relationship and
page evidence.

Page-link creation shares the page-hierarchy advisory transaction lock with
archive mutations and rechecks both endpoints only after acquiring it. A
concurrent archive and create therefore have a deterministic serial order;
creation never commits from a stale endpoint-liveness observation.

## Bounded context bundles (current source)

The authenticated page context endpoint derives depth-one active context from
the root page and existing forward/backlink repositories. It persists nothing,
never expands neighbours, and returns at most twenty edges per direction and
forty-one total page identities including the root. Each direction reads one
extra candidate to report truncation. Edges retain canonical link provenance
and are explicitly ordered; neighbour nodes are deduplicated and sorted.
Archived roots are rejected, archived relationships/endpoints are excluded by
the repository, and malformed or corrupt relationship evidence fails closed.

## Page-link provenance presentation (current source)

The existing selected-page links surface presents canonical relationship UUID,
creation timestamp, and recorded source/actor evidence from the bounded page-
link responses. Forward history is an explicit authenticated `history=all`
read capped at fifty entries and labels active and archived evidence distinctly.
Historical items are not normal navigation targets. Browser response validation
and DOM `textContent` rendering fail closed without creating a second
provenance, audit, or history store.

## Initial domain boundary

The first vertical slice introduced a pure `createPage` command. It validates
input, creates stable native IDs/timestamps, emits a page revision, and emits
an audit event through one result envelope. The current composition supplies
both in-memory and PostgreSQL adapters while retaining that stable command
contract. Live PostgreSQL acceptance is opt-in and has passed against disposable
PostgreSQL 18.6; it is not evidence of production deployment readiness.

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
