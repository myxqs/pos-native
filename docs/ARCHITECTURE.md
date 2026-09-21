# Architecture

POS Native is organised around a deliberately small canonical core.

## Layer 1 — canonical store

The reference implementation uses SQLite because it is portable, inspectable, transactional and easy to back up. The first schema contains:

- **entities** — durable things such as people, projects, organisations, assets or obligations;
- **evidence** — source-backed assertions linked to an entity;
- **audit_events** — append-only mutation history;
- **meta** — schema and migration metadata.

The storage API is intentionally small while the contract stabilises.

## Layer 2 — retrieval and projections

Future retrieval APIs should produce task-specific context from canonical records rather than dumping an entire personal dossier into a model. Derived summaries and projections should remain rebuildable from canonical state where practical.

## Layer 3 — connectors

Email, files, calendars, finance and other providers belong behind adapters. Connectors provide evidence; they do not silently become canonical truth. Reconciliation should compare source state with existing canonical records and make authority explicit.

## Layer 4 — agent access

Agents are consumers of POS Native. Future permissions should distinguish read, propose, write and external-action capabilities. Sensitive actions should have explicit policy gates and auditable outcomes.

## Data contract principles

### Stable identity

Entity identity is separate from a display name or provider-specific identifier.

### Provenance

Evidence stores its source URI, authority classification, confidence and observation time. A later version will separate raw source capture from normalised assertions more rigorously.

### Audit

Mutations append events. Audit rows are not an undo mechanism; they are a record of what happened. Backup and versioned migrations are separate concerns.

### Migration

Schema changes will be versioned. Importers should never overwrite canonical state simply because newer source material exists; recency is evidence, not automatic authority.
