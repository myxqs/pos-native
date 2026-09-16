# Development Operations

## Current baseline

Run `npm test` for the dependency-free domain suite. The current M0 stack is
not yet installable because dependency installation is pending user approval.

## Docker database after Docker is installed

1. Copy `.env.example` to `.env` and replace the placeholder password locally.
2. Run `docker compose config` and inspect the rendered configuration.
3. Run `docker compose up -d postgres`.
4. Verify health with `docker compose ps`.

Do not commit `.env`, generated credentials, database dumps or asset data.
