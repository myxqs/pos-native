# Structured Data Vertical Slice Implementation Plan

**Scope:** Repository-local M4 / product-roadmap M3. Build a synthetic-data
path from collection creation through page-backed records, typed values, and
relations; do not touch Notion.

1. Add pure, test-first domain commands for data sources, immutable property
   definitions, page-backed record creation, typed scalar values, and relation
   edges. Extend revision/audit unions only for these native entities.
2. Add in-memory and PostgreSQL repositories plus one additive migration for
   data sources, definitions, memberships, scalar values, and soft-archived
   relation edges. Prove atomic rollback, cross-source rejection, archived-page
   rejection, stale property revisions, and duplicate-edge prevention.
3. Add authenticated, CSRF-protected versioned API routes for collection/schema
   creation, records, values, and relations. Every mutation uses server-derived
   audit context and a revision precondition where a record changes.
4. Add a minimal browser collection table and record inspector that can create
   a collection and field, create a record page, edit a typed value, add/remove
   a relation, and open the record page. Keep advanced views and rich-editor
   work separate.
5. Run focused tests at each step, full verification and migration generation
   before checkpointing, independent review, then push the branch and open a
   protected-branch PR. PostgreSQL/browser acceptance stays explicitly blocked
   until the Docker engine is usable.
