# Bounded Context Bundle Design

## Purpose and boundary

Add an authenticated, read-only Navigation contract that derives one hop of
active page context from canonical pages and page links. The bundle is derived
response state: it creates no graph rows, cache, semantic index, recursion, or
browser panel.

## Contract

`GET /api/v1/pages/:pageId/context?limit=20` requires authentication and no
CSRF proof. `limit` defaults to 20 and accepts integers 1–20. The root must
exist and be active; missing roots return 404 and archived roots return the
fixed 409 archived-page response.

The response contains the root ID/title, fixed `depth: 1`, deterministically
sorted distinct neighbour nodes, canonical relationship evidence, and separate
forward/backlink truncation flags. Edges retain link ID, source/target IDs,
creation time, provenance, and direction relative to the root. Forward edges
precede backlinks; each direction is ordered by creation time then link UUID.
Nodes are ordered by title then UUID.

## Bounds and integrity

The route reads each direction once at `limit + 1`, concurrently where safe,
then returns at most `limit` forward and `limit` backlink edges: at most 40
edges and 41 nodes including the root. It never expands neighbours. A neighbour
may participate in multiple edges but appears once in `nodes`.

Existing active repository queries exclude archived links and endpoints and
validate link revision history. The API validates every repository result
before exposure. Malformed or corrupt relationship state fails closed with a
fixed context-unavailable server error; it is never silently omitted.

## Recovery

No migration is required. Reapplying migrations rebuilds search indexes;
whole-database backup already includes canonical page links, revisions, and
audit events. Current seventeen-table recovery acceptance remains a separate
evidence refresh, not new backup code.

## Acceptance

- Authentication, UUID and limit validation are enforced.
- Missing and archived roots have deterministic responses.
- Direction, ordering, deduplication, bidirectional relationships, bounds, and
  truncation are proven.
- Archived state is excluded through existing repository semantics.
- Malformed output and corrupt relationship history fail closed.
- The endpoint performs only GET reads and adds no migration.
