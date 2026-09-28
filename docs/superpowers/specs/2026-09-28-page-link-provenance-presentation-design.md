# Page-Link Provenance Presentation Design

## Purpose and boundary

Close the remaining Navigation presentation gap by showing factual canonical
page-link evidence in the existing selected-page workspace. The browser uses
the existing authenticated, bounded forward-link, backlink, and explicit
`history=all` routes. It creates no provenance store, audit endpoint, graph
surface, canonical snapshot, or migration.

## Presentation

Active forward links and backlinks retain their existing safe page-navigation
buttons and additionally show the canonical link UUID, creation timestamp, and
recorded creation source and actor ID. A forward-link history list requests at
most fifty existing relationship records and labels every item `Active` or
`Archived`. Historical items are plain text rather than navigation targets, so
archived endpoint evidence is not offered as normal navigation.

All values are rendered through DOM `textContent`. The browser validates the
bounded response shape and provenance fields before rendering and fails closed
through the existing page-link error path. Repository/API validation remains
the authoritative corrupt-state boundary.

## Acceptance

- Authenticated existing routes provide active and explicit history data.
- Active forward/backlink provenance is visible and deterministic.
- Archived and active forward history are visibly distinct.
- Canonical IDs, timestamps, source, and actor are factual server values.
- Malformed provenance is rejected rather than manufactured or rendered.
- Page switching retains the existing stale-response generation guard.
- No schema, migration, canonical write, or new unbounded query is introduced.
