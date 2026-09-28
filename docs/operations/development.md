# Development Operations

## Current baseline

Run `npm run verify` for formatting, linting, strict type checking, and all
non-live tests. Dependencies are pinned by `package-lock.json`.

The PostgreSQL repository contract is opt-in so a missing local database cannot
be mistaken for a passing integration test:

```powershell
$env:TEST_DATABASE_URL = "postgresql://pos_native:password@localhost:5432/pos_native_test"
npm test -- packages/database/test/postgres-page-repository.integration.test.ts packages/database/test/postgres-block-document-repository.integration.test.ts packages/database/test/postgres-asset-metadata-repository.integration.test.ts --no-file-parallelism
```

Without `TEST_DATABASE_URL`, PostgreSQL integration tests are skipped. Do not
claim restart persistence or transactional PostgreSQL
verification from the in-memory repository tests.

## Navigation search indexes

Migration 0010 enables the locally hosted `pg_trgm` extension and creates
partial GIN indexes over active page titles and active paragraph text. The
indexes are derived state: canonical `pages` and `blocks` rows remain sufficient
to rebuild them by applying the migration chain to a clean PostgreSQL 18.6
database. The runtime account therefore needs extension-creation permission
during migration, but no external search service or background indexer.

Search queries accept 2-100 Unicode code points and a 1-50 result limit
(default 20). To validate the repository against a disposable database, include
`packages/database/test/postgres-search-repository.integration.test.ts` in the
opt-in command or run the full suite with `TEST_DATABASE_URL` and
`--no-file-parallelism`.

## Page-link persistence

Migration 0011 adds canonical forward page links, partial active-pair
uniqueness, and bounded source/target indexes. Backlinks are derived and require
no second table. Full PostgreSQL dumps already include this table; recovery
acceptance should compare `page_links` alongside the other canonical tables.
Normal list queries exclude archived endpoints, while `history=all` is an
explicit recovery view.
Creation takes the same hierarchy advisory transaction lock as page archive and
then rechecks source and target liveness. The live integration test holds that
lock on a dedicated archive connection, proves the repository connection is
blocked through `pg_blocking_pids()`, commits the archive, and verifies rejection
without link, revision, or audit residue for both source and target races.

## Block-document schema migration preflight

Migration 0005 adds page body-document revisions, archived block state,
same-page parent enforcement, and unique live sibling positions. It contains
fail-closed checks for negative positions, cross-page parents, and duplicate
live sibling positions before it adds the new constraints. No automatic
renumbering, reparenting, deletion, or archival repair is performed.

Before any approved live migration, take a verified backup and run the opt-in
PostgreSQL integration suite. If the preflight stops, preserve the database and
record the exact failing condition; make a separate, reviewable repair plan
rather than bypassing the constraint or modifying canonical data ad hoc. The
generated migration required a reviewed statement-order correction because
PostgreSQL needs the composite unique target before its composite foreign key.
That migration path has passed in the opt-in disposable PostgreSQL suite; an
approved production migration still requires a verified backup and preflight.

Page routes are registered only when both a repository and a server-side
authorizer are supplied. The default `buildApp()` exposes health, manifest, and
static shell routes but does not expose canonical reads or writes. Test-only
authorizers must never be used by a production runtime.

## Docker database after the engine is available

1. Copy `.env.example` to `.env` and replace the placeholder password locally.
2. Run `docker compose config` and inspect the rendered configuration.
3. Run `docker compose up -d postgres`.
4. Verify health with `docker compose ps`.

Do not commit `.env`, generated credentials, database dumps or asset data.

## Browser asset root

Source execution resolves static assets from apps/web. A packaged deployment must
copy those three files and set POS_WEB_ASSET_ROOT to the resulting directory.
The directory must contain exactly the expected index.html, app.js, and
styles.css files; application startup fails with NativePOS web assets are
unavailable when an expected file is missing.

This makes the asset location an explicit runtime boundary. The compiled API
runtime and authenticated synthetic browser flow have passed against disposable
PostgreSQL; production deployment and personal-owner acceptance remain open.

## Compiled API runtime

The production-shaped runtime is fail-closed. It requires DATABASE_URL and
POS_WEB_ASSET_ROOT before it constructs a pool, registers authenticated page
routes, or starts a listener. It uses secure cookies, so run it only behind
HTTPS (for example, a private Tailscale HTTPS reverse proxy), not plain HTTP.

1. Run npm run build.
2. Set DATABASE_URL and POS_WEB_ASSET_ROOT in the local process environment.
3. Run npm run start:api.

POS_LISTEN_HOST defaults to 127.0.0.1. Only set it to 0.0.0.0 or :: as an
explicit private-network deployment choice; this does not authorise public
internet exposure. POS_PORT defaults to 3000.

## One-time local owner bootstrap

After PostgreSQL migrations have been verified live, create the first and only
local owner from an interactive terminal:

```powershell
$env:DATABASE_URL = "postgresql://pos_native:local-password@localhost:5432/pos_native"
npm run bootstrap:owner -- --email "owner@example.test"
```

The command compiles the current sources, prompts twice without echoing the
password, stores only its Argon2id hash, and refuses to insert when any user
already exists. Never put the password in a command argument, environment
variable, .env file, or source-controlled document. Do not execute this step
until the Docker and live-migration gates are available.
