# M4 Closure Record

M4 closes the repository-local structured-data and Navigation delivery boundary
using synthetic state only. It does not authorise Notion migration or claim
production/personal-data readiness.

| Criterion                                        | Classification        | Evidence or boundary                                                                                                    |
| ------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Structured data                                  | COMPLETE              | Typed sources, page-backed records, properties, relation edges, API/browser flows, revisions and audit are implemented. |
| Page/block persistence                           | COMPLETE              | PostgreSQL page metadata and bounded paragraph-document persistence pass repository/API acceptance.                     |
| Assets                                           | COMPLETE              | Authenticated synthetic upload/download, integrity, restart and recovery evidence pass.                                 |
| Page-asset relationships                         | COMPLETE              | Attach, active/history reads, recoverable unlink and relink evidence pass.                                              |
| Search                                           | COMPLETE              | Authenticated bounded title/paragraph PostgreSQL search and workspace navigation pass.                                  |
| Page links/backlinks                             | COMPLETE              | Canonical forward links, derived backlinks, active/history reads, unlink and relink pass.                               |
| Archive/relink/history                           | COMPLETE              | Stable archived identities and distinct relink identities survive live persistence and recovery.                        |
| Page-link concurrency                            | COMPLETE              | Shared advisory-lock ordering prevents create-versus-page-archive stale-liveness commits.                               |
| Bounded context bundle                           | COMPLETE              | Authenticated depth-one derived context is deterministically bounded and fail-closed.                                   |
| Provenance presentation                          | COMPLETE              | Existing links panel presents validated canonical IDs, creation evidence and active/archived forward history.           |
| Revisions and audit                              | COMPLETE              | Transactional mutation evidence passes in-memory, live PostgreSQL and recovery acceptance.                              |
| PostgreSQL acceptance                            | COMPLETE              | The full opt-in suite passes against disposable PostgreSQL 18.6.                                                        |
| Recovery acceptance                              | COMPLETE              | Current seventeen-table count/hash, relationship, revision, audit, search and restart evidence passes.                  |
| Migration integrity                              | COMPLETE              | Migrations through 0011 apply; Drizzle reports seventeen tables and no drift.                                           |
| Browser/API acceptance                           | COMPLETE              | Authenticated API and browser-controller acceptance cover the M4 synthetic flows.                                       |
| Security/authentication                          | COMPLETE              | Reads require authentication; mutations retain CSRF, validation and bounded response contracts.                         |
| Current documentation                            | COMPLETE              | Architecture, operations and status describe the implemented boundary and evidence.                                     |
| Human-operated real-browser review               | ACCEPTED DEFERRED GAP | Controller and prior synthetic-browser evidence pass; current usability still requires human review.                    |
| Browser file chooser/download event automation   | ACCEPTED DEFERRED GAP | API byte equality and visible listing pass; extension permissions were not broadened.                                   |
| Linux/deployment/personal-data acceptance        | OUT OF M4 SCOPE       | Production hosting, permissions and personal migration remain later explicit gates.                                     |
| Rich editor, saved views, MCP and Notion cutover | OUT OF M4 SCOPE       | These belong to later milestones and were not started.                                                                  |

The one test skipped during the normal live PostgreSQL run is
`packages/backup/test/current-schema-recovery.integration.test.ts`. It requires
separate source and empty-target database URLs plus the named disposable
container because it performs a destructive clean restore and container
restart. It passes as the separately invoked current recovery acceptance and is
therefore an intentional non-blocking skip, not missing M4 evidence.
