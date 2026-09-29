# Production-local operations

NativePOS M6 runs as a private Docker Compose stack: a compiled Node.js API and PostgreSQL 18.6. The API is published only on `127.0.0.1`; PostgreSQL has no host port. The `postgres-data` and `asset-data` named volumes are durable. Test databases and acceptance volumes must use a different Compose project name.

## First-time setup

Requirements are Docker Desktop with Compose and PowerShell 5.1 or later. Copy `.env.production.example` to the ignored `.env.production`, replace every placeholder with local values, and keep that file out of Git. Then run:

```powershell
.\scripts\nativepos.ps1 -Action Build
.\scripts\nativepos.ps1 -Action Migrate
.\scripts\nativepos.ps1 -Action Start
```

Migration is explicit and non-destructive. Startup never drops or recreates a database. The application refuses readiness unless all 12 migrations through schema version `0011` are present.

## Operator commands

```powershell
.\scripts\nativepos.ps1 -Action Start
.\scripts\nativepos.ps1 -Action Stop
.\scripts\nativepos.ps1 -Action Restart
.\scripts\nativepos.ps1 -Action Status
.\scripts\nativepos.ps1 -Action Logs
.\scripts\nativepos.ps1 -Action Migrate
.\scripts\nativepos.ps1 -Action Backup
```

`Stop` and `Restart` preserve named volumes. Logs are capped by Docker's `json-file` rotation at five 10 MB files per service. Docker readiness is tried at most 12 times, five seconds apart; failure is visible and finite.

`GET /health` is process liveness. `GET /ready` is 200 only when PostgreSQL is reachable and the migration count is compatible. Authenticated `GET /api/v1/system/status` reports only the application version, local profile, uptime, readiness, and schema version.

## Machine authentication

Machine clients send `Authorization: Bearer <POS_SERVICE_TOKEN>`. Missing or invalid tokens receive 401, and all machine mutations still pass the existing typed validation, revision, provenance, audit, and bounded-query boundaries. Browser session and CSRF authentication remains available. Rotate the token by putting a new high-entropy value and identifier in `.env.production`, then run `Restart`; the old token is invalid after the replacement container starts. Tokens and database passwords must not be passed on command lines or committed.

## Backup and isolated restore

`Backup` writes a timestamped, checksummed full-state backup below `POS_BACKUP_ROOT`. It includes the PostgreSQL custom dump, every canonical asset byte from `asset-data`, and a non-secret version manifest. Retention defaults to 14 and must be between 1 and 365.

Restore is deliberately limited to a new recovery database and distinct asset volume:

```powershell
.\scripts\nativepos.ps1 -Action Restore `
  -BackupId <uuid> `
  -RecoveryDatabase pos_native_recovery_review `
  -ConfirmRestore
```

The command refuses the configured production database and requires explicit confirmation. See `backup-restore.md` for the manifest and clean-target rules.

## Windows auto-start

Preview the non-elevated logon task without registering it:

```powershell
.\scripts\nativepos-task.ps1 -Mode Generate
```

Registration is a separate human-approved action. Only after approval, run `-Mode Install`; disable it with `-Mode Uninstall` and confirm the prompt. The task starts the same operator path and inherits its bounded Docker readiness check. It does not launch Docker Desktop, elevate, open firewall ports, or loop indefinitely.

Manual reboot acceptance procedure:

1. Human-register the task and confirm its command points at the intended repo and `.env.production`.
2. Reboot Windows manually; do not use an automated reboot command.
3. Log on and allow Docker Desktop to become ready for up to 60 seconds.
4. Run `nativepos.ps1 -Action Status` and request `http://127.0.0.1:3000/ready`.
5. Authenticate with the current service token and retrieve a previously recorded synthetic entity and asset.
6. If Docker was not ready inside the bounded window, inspect Task Scheduler history and run `nativepos.ps1 -Action Start` after Docker becomes ready.

M6 creates no public route, firewall rule, tunnel, DNS record, OAuth client, MCP server, or external-provider connection. Notion remains canonical.
