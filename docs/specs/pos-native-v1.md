# POS Native V1 Specification Manifest

## Authoritative source

This repository materialises the user-approved document
`POS_Native_Codex_Master_Build_Prompt_v2_Product_First.md`.

- Canonical source: Google Drive
- Drive file ID: `16G3GN1fLvRg8d5n4BizdDj7ECp_saWMR`
- Drive MIME type: `text/markdown`
- Drive size at intake: `40,567` bytes
- Drive modified timestamp: `2026-09-16T13:44:08.058Z`
- Fully read and reconciled on: 2026-09-16

The source document is the complete product specification. This file is an
implementation manifest, not a replacement or reduced interpretation of it.

## Non-negotiable constraints

- POS Native is a self-hosted, single-user canonical personal data system.
- PostgreSQL and user-controlled files are canonical stores; the UI, API, MCP,
  importers and AI clients never bypass validated domain boundaries.
- Every canonical entity uses a native UUID; external identifiers are mappings,
  not canonical identities.
- Important mutations are attributable, auditable and recoverable through
  revisions; no arbitrary code or shell execution is accepted from data/input.
- Product-first staging is mandatory. Notion remains canonical throughout M0-M9
  and the Usable Product Gate requires explicit user approval. No live Notion
  import, dual-write, deletion, migration rehearsal, or cutover is authorised.
- AI is a provider-neutral consumer. MCP begins read-only and follows the same
  validation/audit paths as human/API operations.
- Portability requires documented open export, backup/restore tests and a
  deployment path independent of mandatory SaaS providers.

## Milestone control

M0-M11 remain sequential release gates as defined by v2. Product work proceeds
through M0-M6, synthetic-data hardening in M7, API/MCP in M8, and production
host readiness in M9. M10 migration tooling and M11 cutover are explicit human
gates and must never start automatically. Detailed plans cover only the next
coherent delivery slice and must not silently weaken the source requirements.
