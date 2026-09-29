# NativePOS M6 operational runtime design

## Intent and boundary

M6 makes the completed M5 application a durable private Windows-local service.
It uses the production build without Codex or a development watcher, survives
application and Docker restarts, provides service-token authentication for a
future thin MCP adapter, and has proven local backup and isolated restore.

Notion remains canonical. M6 does not implement MCP, connect ChatGPT, import
personal data, expose a public endpoint, change Windows Firewall, install an
auto-start task, modify KERNEL, or begin migration/cutover.

## Runtime topology

Production-local operation uses a dedicated Docker Compose project with two
services:

- PostgreSQL 18.6, reachable only on the private Compose network, with a named
  production-local data volume, health check, and `unless-stopped` restart.
- A multi-stage-built NativePOS image running the compiled API, depending on
  healthy PostgreSQL, with a named asset volume, `unless-stopped` restart, and
  bounded Docker JSON log rotation.

Only the application is published, at `127.0.0.1:${POS_PORT:-3000}`. The app
binds `0.0.0.0` only inside its isolated container because host loopback port
publishing requires it. PostgreSQL has no host port. Development and acceptance
use separate Compose project names and volumes.

Configuration is explicit and fail-closed. A source-controlled example contains
placeholders only; the real production-local environment file remains ignored.
Migrations are an explicit operator action. Startup checks database reachability
and the expected migration/schema state before accepting traffic; it never
creates, drops, truncates, or resets production data.

## Authentication and authorization

Interactive browser login and CSRF remain unchanged. A separate high-entropy
bearer token authorizes local machine requests. Its plaintext exists only in the
ignored environment file. Runtime configuration validates its minimum strength.
The server compares derived hashes with constant-time equality, never logs the
token, and returns fixed authentication errors.

The service token uses the existing route authorizer and creates an `api-token`
audit actor. It does not bypass M5 type validation, bounds, relation rules,
archive rules, optimistic concurrency, revisions, or audit generation. Missing
or invalid authentication is rejected. Human-session mutations still require
CSRF; service-token mutations require the bearer token instead. Rotation is
replace-token plus controlled service restart.

## Health, readiness and diagnostics

- `/health` is unauthenticated liveness and contains no infrastructure detail.
- `/ready` returns ready only after configuration, database connectivity and
  exact migration compatibility checks pass.
- `/api/v1/system/status` is authenticated and reports only application version,
  runtime profile, uptime, readiness and expected schema version.

Startup, readiness failure and graceful shutdown produce structured local logs
with configured secret fields redacted. Docker limits logs by size and file
count. SIGINT and SIGTERM close Fastify and the PostgreSQL pool before exit.

## Operator and auto-start surface

One PowerShell operator script exposes `build`, `migrate`, `start`, `stop`,
`restart`, `status`, `logs`, `backup`, and isolated `restore` actions. It uses
fixed Compose files/project names and validates paths and required parameters.
Restore refuses the production database and requires an explicit recovery
target. Backup reuses the established manifest/checksum/clean-target recovery
implementation and applies bounded local retention only after a verified backup.

A separate PowerShell script can emit/register or unregister a visible
Task Scheduler task that runs the operator at user logon. M6 validates its
definition generation only. It does not register, enable, or run the task;
installation is a later human-approved action.

## Acceptance

Acceptance uses synthetic, isolated Compose project names and volumes. It
proves fresh and current migrations, production-image startup, machine bearer
authentication, anonymous mutation rejection, readiness, application restart,
PostgreSQL restart, full stack stop/start, data survival, verified backup,
clean-database restore, restored M5 retrieval, and restored readiness. Existing
M5 benchmark and full repository gates remain mandatory.

No Windows reboot occurs. Documentation supplies exact manual reboot acceptance
steps and records the result as `WINDOWS REBOOT ACCEPTANCE: HUMAN REQUIRED`.
