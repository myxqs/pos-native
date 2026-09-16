# ADR 0001: TypeScript monorepo and contract-first core

## Status

Accepted — 2026-09-14.

## Context

POS Native must run locally on Windows during development and unchanged on a
Linux home server. It needs a web client, API, MCP adapter, shared validation,
and long-lived explicit domain contracts.

## Decision

Use a TypeScript-first npm-workspaces monorepo. Keep deployable applications
under `apps/` and reusable logic under `packages/`. Define domain commands and
versioned DTOs before transport or storage implementations. Use Node's native
test runner initially so the foundation can be verified before any dependency
installation is approved.

## Consequences

This keeps canonical rules reusable by browser/API/MCP/import paths and avoids
premature framework lock-in. Later phases will add Fastify, React/Next.js,
PostgreSQL and a query layer only after dependency versions and licensing are
reviewed and approved.
