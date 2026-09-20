# Development Operations

## Current baseline

Run `npm run verify` for formatting, linting, strict type checking, and all
non-live tests. Dependencies are pinned by `package-lock.json`.

The PostgreSQL repository contract is opt-in so a missing local database cannot
be mistaken for a passing integration test:

```powershell
$env:TEST_DATABASE_URL = "postgresql://pos_native:password@localhost:5432/pos_native_test"
npm test -- packages/database/test/postgres-page-repository.integration.test.ts
```

Without `TEST_DATABASE_URL`, the live suite reports one skipped test. Do not
claim restart persistence or transactional PostgreSQL verification from the
in-memory repository tests.

Page routes are registered only when both a repository and a server-side
authorizer are supplied. The default `buildApp()` exposes health, manifest, and
static shell routes but does not expose canonical reads or writes. Test-only
authorizers must never be used by a production runtime.

## Docker database after Docker is installed

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

This makes the asset location an explicit runtime boundary. It does not yet
supply a production server composition or prove browser persistence; those
remain M1 acceptance work.

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
