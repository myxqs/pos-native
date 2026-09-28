# ADR 0009: Structured data uses page-backed records and relational edges

## Status

Accepted — 2026-09-24.

## Context

NativePOS needs flexible collections without hard-coding the user's current
Domain, Project, or other ontology. A collection record must open as a normal
NativePOS page, while property values and relationships must remain queryable,
auditable, and independent of the page hierarchy.

## Decision

- A `DataSource` is a first-class native entity, not a special page and not an
  application module.
- A record is an existing NativePOS page with exactly one `DataSourceItem`
  membership. Its canonical record identity is its page UUID; `parent_id`
  remains a hierarchy edge and is never repurposed as a relation.
- The page title is the initial title property. Native ID, created time, and
  updated time are derived read-only fields rather than duplicate stored
  property values.
- User-defined `PropertyDefinition` rows are source-scoped and immutable in the
  first slice. Typed scalar values are validated by the domain contract before
  their JSONB representation is persisted. This keeps flexible value shapes out
  of identity/relationship storage while preserving a safe path to typed query
  indexes later.
- Relation definitions name an allowed target source. Live `RelationEdge` rows
  store source record, definition, and target record explicitly. Backward
  navigation queries the same edge table; it does not manufacture a second
  string link or overload page hierarchy. A self-relation is permitted when the
  target source is the source itself.
- Record-property revisions and audits are separate from page metadata and body
  revisions. A record creation transaction includes its page, membership,
  initial record revision, and audit envelopes. A scalar or relation change
  requires the record-property revision precondition and writes an auditable
  revision atomically.

## Consequences

The first vertical slice can create generic collections, define scalar fields,
create page-backed records, set typed values, create/remove safe relations, and
navigate the result through the existing page UI. Rollups, formulas, views,
property-definition editing, and migration adapters remain separate later
work. Notion data is neither connected nor imported.
