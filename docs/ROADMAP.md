# Roadmap

This roadmap describes direction, not promised release dates.

## v0.1 — runnable storage contract

- [x] SQLite reference store
- [x] stable entity IDs
- [x] evidence/provenance records
- [x] append-only audit events
- [x] CLI and unit tests
- [x] public architecture/privacy boundaries

## v0.2 — retrieval and migrations

- [ ] versioned schema migrations
- [ ] typed relationships between entities
- [ ] source records distinct from extracted evidence
- [ ] query/retrieval API
- [ ] deterministic context-pack projection
- [ ] backup and restore verification

## v0.3 — import and reconciliation

- [ ] generic importer interface
- [ ] dry-run reconciliation proposals
- [ ] authority/conflict rules
- [ ] synthetic Notion-style import fixture
- [ ] migration integrity report

## v0.4 — agent boundary

- [ ] read/propose/write capability model
- [ ] explicit action policy
- [ ] agent-facing API
- [ ] security threat model
- [ ] tamper-evident audit improvements

## Longer term

- connector adapters;
- optional semantic/vector retrieval without making embeddings canonical state;
- encrypted local/remote deployments;
- interoperable context exchange formats;
- evaluation suite for personal-context retrieval quality and safety.
