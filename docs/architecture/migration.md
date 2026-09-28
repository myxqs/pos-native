# Migration Architecture

Notion remains canonical. M10 is the final migration-tooling phase and may
start only with explicit user approval after the Usable Product Gate and
product hardening. It provides a read-only importer framework using fixtures
and staging exports, mapping external identities to native UUIDs and reporting
unsupported items. Migration must be deterministic and idempotent.

During M10, explicitly authorised source snapshots, staging imports,
reconciliation, retrieval evaluation, and backup/restore rehearsals establish
the evidence for a possible cutover. M11 cutover requires separate explicit
user approval only after every product, migration, integrity, retrieval,
backup, and restore acceptance gate passes.
