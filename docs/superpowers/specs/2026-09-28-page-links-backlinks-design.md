# Page Links and Backlinks Design

## Scope

Deliver explicit page-to-page links as canonical relationship entities. Links
are independent of collection `relation_edges` and paragraph text. Backlinks
are bounded derived queries over forward links. Inline spans, external URLs,
rich text, and graph traversal remain excluded.

## Canonical contract

`PageLink` contains a stable UUID, source page UUID, target page UUID, creation
and optional archive timestamps, and creation provenance. Create emits revision
1 and `page.linked`; archive preserves identity/provenance, emits revision 2 and
`page.unlinked`, and never mutates either page. Self-links, unknown endpoints,
archived endpoints, and duplicate active pairs are rejected. Relinking after
archive creates a new UUID so old history is not rewritten.

## Persistence and reads

Migration 0011 adds `page_links`, source/target foreign keys, a partial unique
active-pair index, and bounded-list indexes. Repository mutations persist the
link, revision, and audit in one transaction. Active forward and backlink reads
join both page endpoints, require both pages live, validate the latest revision
snapshot, sort by creation time then link UUID, and apply a caller-supplied
limit of 1-100. Explicit `history=all` reads retain archived links and archived
page history without making it normal navigation.

## API and browser

Authenticated routes list forward links and backlinks, create a forward link,
and archive it. Mutations require CSRF. UUIDs, history scope, limits, and all
repository output are validated before exposure. Fixed errors distinguish
missing pages, archived endpoints, self-links, duplicates, and unavailable
canonical state without leaking database details.

The selected-page workspace shows forward links and backlinks. A target picker
uses the existing authenticated search endpoint; selecting a candidate creates
the link. Results and link lists use `textContent`. Generation counters suppress
late search/list responses after page changes or logout. Forward links can be
unlinked; both directions navigate using the existing page-selection flow.

## Recovery and acceptance

The table is canonical PostgreSQL state and is naturally included in the
existing full-database dump/restore path. Acceptance covers domain invariants,
in-memory rollback, live PostgreSQL migration/uniqueness/concurrency/restart,
API security and output validation, browser safety/staleness, and the complete
quality gate.
