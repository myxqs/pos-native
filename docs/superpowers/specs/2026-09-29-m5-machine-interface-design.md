# NativePOS M5 Machine Interface Design

## Intent

M5 makes the accepted M4 structured-data model directly operable by machine consumers without changing NativePOS canonical status or importing Notion data. The browser remains an inspection surface; the authenticated versioned HTTP/domain boundary is the product surface and remains suitable for a later thin MCP adapter.

## Architecture

Extend the existing `DataSourceRepository` through focused machine-facing contracts rather than a parallel store. Schema discovery projects sources and immutable definitions; structured query compiles a validated bounded filter AST into repository operations; graph traversal follows explicit relation edges with fixed depth/node limits and cycle suppression; context assembly composes identity, selected typed properties, bounded relations, content, provenance, and recent history with omission metadata.

Mutations continue through existing domain commands and PostgreSQL transactions. Add clear-property and title/archive adapters only where existing page/property revision rules can protect them. Every machine mutation carries server-derived actor identity, source/correlation metadata, and an expected revision. Safe bulk mutation is limited to explicit record IDs, capped at 100, validates the entire batch before execution, supports dry-run, and commits atomically.

## Contracts

- Discovery: list/describe entity types and properties with kinds, options, required state, relation target and supported capabilities.
- Retrieval: get record, bounded structured query, outgoing/incoming relationship inspection, depth-limited traversal, bounded context, and history/provenance.
- Mutation: set/clear scalar property, add/remove relation, title/archive/restore through existing page boundaries, and capped explicit-ID bulk property mutation.
- System: stable error codes, cursor pagination, limits, capability inventory, authentication and existing CSRF requirements.

No raw SQL, generic JSON Patch, unbounded graph walk, unconstrained full-dataset export, OAuth/provider work, Notion access, KERNEL work, or visual redesign is introduced.

## Persistence and safety

Reuse stable page/record/property/relation identifiers and existing revision/audit tables. Add only indexes or metadata needed for deterministic machine querying, via an additive migration that upgrades M4 and applies fresh. Query requests require at least one selector, enforce limit/cursor bounds, and return continuation metadata. Mutations fail with a stable conflict when the expected property or page revision is stale.

## Acceptance

Use synthetic people, organisations, projects, events, actions, areas, and evidence with similar names, relationships, dates, statuses, archived rows, and provenance. A deterministic benchmark targets 50–100 cases across discovery, filters, pagination, graph bounds, context budgets, provenance, atomic mutation, stale writes, relation changes, and bulk preview/commit. Full M4 default/live PostgreSQL, upgrade, fresh migration, recovery, drift, audit, and security gates must remain green.
