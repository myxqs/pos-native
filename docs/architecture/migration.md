# Migration Architecture

Notion remains canonical. M6 will add a read-only importer framework using
fixtures and staging exports, mapping external identities to native UUIDs and
reporting unsupported items. Migration is deterministic and idempotent.

M9 requires explicit user involvement, source snapshot, reconciliation,
retrieval evaluation and backup/restore rehearsal. M10 cutover requires a
separate explicit approval after all acceptance gates pass.
