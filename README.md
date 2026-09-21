# POS Native

POS Native is an early-stage, local-first Personal Operating System for structured, user-owned context.

The project explores a simple idea: personal AI systems should be able to work with durable context, provenance, relationships and audit history without requiring a proprietary cloud service to remain the permanent system of record.

> Status: **early implementation / v0.1.0 skeleton**. The storage contract and CLI are runnable today; higher-level retrieval, adapters and agent permissions are intentionally still under development.

## Why this exists

Personal AI tools are useful, but their context is often scattered across notes, files, applications and transient conversation history. POS Native aims to provide a reusable local foundation for:

- stable entities and identifiers;
- source-backed evidence and provenance;
- explicit authority and confidence metadata;
- append-only audit events;
- local-first storage and portability;
- controlled future access by AI agents and external connectors.

The core deliberately does **not** require an LLM. AI systems should consume the context layer, not own it.

## Current capabilities

The v0.1.0 skeleton provides:

- a zero-runtime-dependency Python package;
- SQLite-backed local storage;
- stable UUID-backed entities;
- evidence records linked to entities;
- an append-only audit log;
- a small CLI for creating and inspecting a local store;
- tests covering the initial data contract.

## Quick start

Requires Python 3.11+.

```bash
python -m pip install -e .
pos-native init --db ./pos.db
pos-native add-entity --db ./pos.db --type project --name "Example project"
pos-native list-entities --db ./pos.db
pos-native audit --db ./pos.db
```

Run the test suite:

```bash
python -m unittest discover -s tests -v
```

## Design principles

1. **User-owned by default** — the canonical store can run locally and remain portable.
2. **Provenance before synthesis** — source evidence should remain distinguishable from derived state.
3. **Stable identity** — records receive durable identifiers so context can evolve without losing referential integrity.
4. **Auditability** — mutations create append-only audit events.
5. **Explicit uncertainty** — confidence and authority are data, not hidden assumptions.
6. **AI-agnostic core** — models and agents are replaceable consumers of the system.
7. **Safe migration** — no source should become canonical merely because it was imported.

## Repository boundaries

This public repository contains only reusable code, documentation, schemas and synthetic examples. It must not contain personal POS data, credentials, private exports, tokens, production databases or machine-specific secrets.

See [Architecture](docs/ARCHITECTURE.md), [Privacy & data boundaries](docs/PRIVACY.md), and the [Roadmap](docs/ROADMAP.md).

## Project stage

POS Native is being developed in public from its first runnable skeleton. It is not presented as a mature or widely adopted project yet. Contributions, design critique and interoperability discussion are welcome as the storage and retrieval contracts stabilise.

## Licence

MIT. See [LICENSE](LICENSE).
