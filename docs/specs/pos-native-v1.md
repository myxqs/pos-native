# POS Native V1 Specification Manifest

## Authoritative source

This repository materialises the user-approved document
`POS_Native_Codex_Master_Build_Prompt.md`.

- Local source: `C:\Users\billy\Downloads\POS_Native_Codex_Master_Build_Prompt.md`
- Drive file ID: `1r4krYTKJNPdR-G6XdLKyNUPP3AYoGpnx`
- SHA-256 at intake: `B94482C3580ACC1BE4A682381896CA13F12E0B8FCFE8EDF76B0975206E8C6C52`
- Verified on: 2026-09-14

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
- Notion remains canonical until separately authorised migration acceptance
  gates pass. No live Notion import, deletion or cutover is authorised now.
- AI is a provider-neutral consumer. MCP begins read-only and follows the same
  validation/audit paths as human/API operations.
- Portability requires documented open export, backup/restore tests and a
  deployment path independent of mandatory SaaS providers.

## Milestone control

M0–M10 remain sequential release gates as defined by the source prompt. The
current detailed implementation plan covers M0 and M1 only. Future plans must
not silently weaken the source requirements.
