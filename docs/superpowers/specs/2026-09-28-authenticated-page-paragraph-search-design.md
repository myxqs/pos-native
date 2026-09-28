# Authenticated Page and Paragraph Search Design

## Intent and scope

Add the first Navigation vertical slice: authenticated search across active page
titles and active paragraph text, from canonical NativePOS state through the
PostgreSQL runtime and API to a minimal workspace search surface. Search is a
read-only, derived view. It does not add a canonical index, background worker,
external service, semantic model, or new mutation path.

## Canonical sources and recovery

`pages.title` and `blocks.content->>'text'` are the only searchable sources.
Both the page and matching block must have `archived_at IS NULL`. Revisions,
audit events, asset bytes, secrets, sessions, and system metadata are excluded.
Because queries read canonical rows directly, create, update, archive, restore,
and restart behavior requires no index synchronization. Expression indexes are
derived accelerators and can be rebuilt by rerunning migrations against the
canonical database.

## Repository contract and validation

`SearchRepository.search({ query, limit })` returns at most one best match per
page. Shared validation trims the query, accepts 2 through 100 Unicode code
points, and accepts integer limits from 1 through 50. The API default is 20.
Invalid input fails closed; an empty valid result is `[]`.

Each result exposes only `pageId`, `pageTitle`, `snippet`, `matchSource`
(`title` or `paragraph`), and an integer `rank`. The snippet is plain text,
bounded to 240 Unicode code points. Paragraph results use the matching
paragraph text; title results use the title. No internal row IDs, SQL scores,
HTML, or canonical content copies are exposed.

## PostgreSQL mechanism and ranking

Migration 0010 enables the conventional local `pg_trgm` extension and adds
partial GIN expression indexes for active lowercase titles, active lowercase
paragraph text, and their `simple` text-search vectors. The query is bounded by
validated input and limit, obtains index-backed candidates per match family,
unions them, then selects each page's highest-ranked candidate.

Ranking uses deterministic integer tiers:

1. exact case-insensitive title: 500;
2. case-insensitive title prefix: 450;
3. title full-text: 400;
4. title trigram: 350;
5. paragraph full-text: 250;
6. paragraph trigram: 200.

Within a tier, stronger PostgreSQL score sorts first, then page title,
`pageId`, block position, and block ID. Final results sort by rank descending,
score descending, page title, and page ID. Trigram candidates use the indexed
`%` operator and a transaction-local threshold of 0.3; they are fallback
candidates, never an unconstrained similarity scan.

## API and security

`GET /api/v1/search?q=<query>&limit=<optional>` uses the existing read
authorizer and rate limiter. It needs no CSRF token because it does not mutate
state. Zod rejects extra parameters, missing/malformed queries, overlong
queries, and out-of-range limits with a generic `400 invalid search query`.
Unauthenticated requests retain the established `401` response. Repository
failures return a generic `500 search unavailable` without database details.

## Workspace UX

The sidebar gains a compact search form and status-backed results list.
Submitting a valid query fetches the bounded API result set. Results show the
page title, source label, and plain-text snippet. DOM construction uses
`textContent`; no server text is assigned to `innerHTML`. Selecting a result
uses the existing page-selection function, loading the current page/body
context. Later responses are ignored when a newer query or logout supersedes
them. Empty and error states are explicit and do not disturb the current page.

## Failure behavior

Validation errors do not query the repository. Authentication failure exposes
no search data. Database errors do not return partial results or SQL details.
Malformed result data is rejected by the browser adapter and rendered as a
generic search error. Search remains optional in test compositions that do not
supply a repository.

## Acceptance criteria

- Title and paragraph matches are returned with title precedence and stable
  ordering; exact/prefix matches behave intuitively.
- Query and result boundaries are enforced in memory, PostgreSQL, API, and UI.
- Archived pages and archived blocks never appear; updates and restores are
  visible directly from canonical state, including after restart.
- PostgreSQL 18.6 applies the extension/index migration, uses a relevant search
  index for bounded candidates, and preserves deterministic order.
- The authenticated API exposes only the typed navigation contract.
- The browser renders bounded plain text, has empty/error states, ignores stale
  responses, and selects the appropriate existing page context.
- Format, lint, strict typecheck, default tests, live PostgreSQL tests, build,
  migration drift, dependency audit, repository scans, and independent review
  pass before commit.

## Explicit exclusions

Links/backlinks, semantic search, embeddings, archived-search UI, highlighting
markup, rich-editor changes, external services, and Notion migration are not
part of this slice.
