# ADR 0004: M0 toolchain and development-audit mitigation

## Status

Accepted — 2026-09-14.

## Decision

Use pinned Fastify, Drizzle ORM/Kit, `pg`, Zod, Argon2, Vitest, TypeScript,
ESLint and Prettier versions from `package-lock.json`. The unified verification
command is `npm run verify`.

## Security review

`npm audit` reports four moderate paths through `drizzle-kit@0.31.10` and its
development-only esbuild loader. The affected esbuild advisory concerns a
development server accepting browser requests; POS Native does not expose that
development server. `drizzle-kit@0.31.10` is the current published version and
npm's only automated suggestion is an anomalous major downgrade to `0.18.1`.
Do not force that downgrade. Re-run audit at each checkpoint and reassess when
an upstream supported fix exists.
