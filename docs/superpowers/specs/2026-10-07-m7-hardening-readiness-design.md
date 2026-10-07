# M7 Hardening and Migration-Readiness Design

## Intent

Move the completed M6 private production-local runtime to a human-review-ready
migration rehearsal boundary without migrating personal data, connecting an
external provider, or widening network exposure. Preserve M0-M6 behavior and
add only hardening justified by repository evidence.

## Evidence-led gap classification

### Blocker

- Runtime readiness currently accepts any twelve rows in
  `drizzle.__drizzle_migrations`. It must require the exact ordered migration
  timestamps through `0011`, so a substituted, missing, duplicated, or extra
  ledger row fails closed.

### Hardening

- The Windows restore wrapper creates a recovery database and asset directory
  before a standalone backup verification. It must verify the selected backup
  before creating either target.
- Backup retention currently permanently removes old backup directories during
  every backup. It must preserve them by default and prune only when the
  operator supplies a specific confirmation switch.

### Already proven

- Pages, hierarchy, block documents, structured data, page links, backlinks,
  page-asset links, revisions, and audit records use transactional or
  rollback-shaped persistence with optimistic concurrency coverage.
- Asset upload and retrieval enforce bounded bytes, opaque storage keys, and
  receipt verification.
- Service-token authentication is exact, fail-closed, and does not serialize
  token material. Browser mutations retain session and CSRF boundaries.
- M6 demonstrated a checksummed 17-table full-state restore, exact asset-byte
  recovery, application and PostgreSQL restart persistence, bounded shutdown,
  and loopback-only publication.

### Deferred

- Real personal-data or Notion migration/cutover, external integrations, public
  exposure, Linux ACL acceptance, encrypted/offline backup policy, scheduler
  installation/reboot acceptance, and human browser usability acceptance.

## Design

Readiness will query ordered migration timestamps and compare the complete
sequence with the journal-derived constants for migrations `0000` through
`0011`. It will continue returning only `ready`, `incompatible`, or `unknown`
and will not expose database diagnostics.

The PowerShell operator will run the existing offline `verify` operation before
`createdb` or asset-target creation. Backup retention will identify excess
canonical backup directories but only remove them when `-ConfirmPruneBackups`
is present; otherwise it will emit a fixed warning to stderr and retain them.
No command will target the production database for restore.

The migration-readiness runbook will state the safe synthetic rehearsal scope,
exact preflight, backup, restore, rollback, verification, and human gates. It
will explicitly keep real cutover unsupported.

## Validation

Use test-first focused unit/source-contract tests, then format, lint, typecheck,
build, default and M5 regression suites, dependency audit, schema drift checks,
secret/private-path scan, and diff review. Run live PostgreSQL/Compose/recovery
only if NativePOS-exclusive resources can be used without interfering with the
parallel KERNEL work.
