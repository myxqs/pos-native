# M5 machine-first interface

M5 adds an authenticated machine surface over the existing NativePOS domain
and PostgreSQL repositories. It does not change the canonical schema, import
Notion data, or make NativePOS canonical.

## Discovery and retrieval

`GET /api/v1/machine/capabilities` publishes the contract version and hard
limits. `GET /api/v1/machine/schema` and `GET
/api/v1/machine/schema/:entityTypeId` describe types, typed properties, options,
relation targets, and operations in deterministic order.

`POST /api/v1/machine/query` requires an explicit selector. It accepts a data
source plus IDs, bounded title matching, typed property comparisons, relation
target, archive state, deterministic sorting, a limit of 1-100, and an opaque
cursor. Empty queries fail closed. Retrieval scans at most 10,000 records per
source; this is a safety ceiling, not a large-scale performance claim.

`POST /api/v1/machine/traverse` permits incoming, outgoing, or bidirectional
traversal to depth 1-3 and at most 100 nodes. Visited IDs suppress cycles.
`POST /api/v1/machine/context` independently budgets properties and relations
and reports included, omitted, and continuation operations.

`GET /api/v1/machine/entities/:id` returns compact typed state and provenance.
`GET /api/v1/machine/entities/:id/history?limit=20` returns bounded audit
metadata without revision snapshots or before/after payloads.

## Mutations and concurrency

M5 reuses the established authenticated versioned mutation boundary:

- `PUT /api/v1/records/:id/properties/:definitionId` changes one typed property.
- `POST /api/v1/records/:id/relations/:definitionId` and `DELETE
/api/v1/relations/:id` add or recoverably archive one relation.
- Existing page routes update title and archive/restore page-backed records.

Writes require CSRF authorization and a quoted `If-Match` revision. A stale
revision returns HTTP 409 without overwriting newer state. Successful writes
retain transactional revision and audit evidence plus actor/source provenance.
Unrestricted JSON patching is not exposed.

Property clear and bulk mutation are deferred. The repository port has no
cross-record transaction contract, so implementing bulk above it would
misrepresent atomicity. A future bulk boundary must prevalidate an explicit
bounded target set and execute previewed changes in one repository-owned
transaction.

## Acceptance

`npm run test:m5-benchmark` executes 64 deterministic cases over synthetic
POS-style data. The full opt-in PostgreSQL suite uses `TEST_DATABASE_URL`; the
current-schema recovery rehearsal retains its separate source/target/container
variables. No test uses personal or live provider data.

The HTTP contract is suitable for a later thin MCP adapter. M5 does not add an
MCP server or grant an agent direct database access.
