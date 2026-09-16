# Canonical Data Model

M1 establishes explicit tables for users, sessions, API tokens, pages, blocks,
assets, revisions, audit events and idempotency records. Later milestones add
data sources, records, property definitions/values, relation edges and saved
views. All tables use POS Native UUID v4 identifiers and explicit foreign keys.

`ExternalIdentity(native_entity_id, provider, external_id, metadata)` maps a
source provider's identifier to a native entity without replacing native
identity. Relations are relational edges, never strings containing links.
