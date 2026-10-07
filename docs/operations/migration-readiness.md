# Migration rehearsal readiness

## Current boundary

NativePOS M7 is intended for a **synthetic, isolated migration rehearsal and
human review**. The private production-local runtime, canonical PostgreSQL
state, asset bytes, exact migration ledger, backup verification, clean-target
restore, and restart readback have automated or prior synthetic evidence.

No real personal data can be migrated safely today because no approved M10
importer, source mapping, reconciliation report, unsupported-item report, or
real-data handling approval exists. Notion remains canonical. This runbook does
not authorise export, import, dual-write, deletion, or cutover.

## Proven and supported for a synthetic rehearsal

- Start the loopback-only Compose runtime after explicit migrations.
- Create and retrieve synthetic pages, block documents, hierarchy, structured
  records and relations, assets, page-asset links, page links/backlinks, and
  bounded machine-interface reads.
- Create and offline-verify a full PostgreSQL plus asset backup.
- Restore that backup only to a newly named `pos_native_recovery_*` database
  and a distinct recovery asset volume.
- Compare canonical state and exercise authenticated readback after application
  and PostgreSQL restarts.

## Unsupported or consciously deferred

- Real personal-data or Notion migration, reconciliation, dual-write, or cutover.
- Import-format adapters and external-identity mappings (M10).
- Linux deployment permissions and ACL acceptance.
- Encrypted/offline backup-media policy and production credential/session policy.
- Task Scheduler installation and reboot acceptance.
- Human browser/mobile and file-chooser acceptance.
- Public network exposure, cloud authentication, or external integrations.

## Human gates

A human must separately approve an authorised M10 source snapshot, its
personal-data handling and retention, backup encryption/offline and token
policy, importer reconciliation and unsupported-item reports, any shadow trial,
and any later M11 cutover or canonical-source deletion. Lack of a response is
not approval. A synthetic rehearsal satisfies none of these real-data gates.

## Exact pre-rehearsal checks

Run from the clean M7 checkout. Do not reuse a KERNEL or unrelated Compose
project, PostgreSQL container, database, volume, or port.

```powershell
git status --short --branch
git rev-parse HEAD
npm ci
npm run verify
npm run build
npm audit --omit=dev
$tokens=$null; $errors=$null
[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'scripts/nativepos.ps1'), [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { $errors; throw 'NativePOS operator script is invalid' }
```

Confirm `.env.production` is ignored, contains no placeholder, uses a
high-entropy service token, points `POS_BACKUP_ROOT` at approved private local
storage, and selects the intended loopback port. Confirm the Compose project
and its volumes belong only to this checkout. Stop if ownership is ambiguous.

## Mandatory backup

Create a new backup immediately before the rehearsal and retain its JSON result
and backup ID. Pruning is deliberately off by default.

```powershell
.\scripts\nativepos.ps1 -Action Backup
node scripts\postgres-recovery.mjs verify `
  --backup-root <approved-private-backup-root> `
  --backup-id <backup-uuid> `
  --max-bytes 1073741824
```

Do not continue unless both commands succeed and the backup is stored outside
the database and asset volumes it protects. Do not use
`-ConfirmPruneBackups` during rehearsal preparation.

## Synthetic dry run

1. Record the source commit, application version, schema version, backup ID,
   Compose project, source database, source asset volume, and UTC time.
2. Create a bounded synthetic fixture exercising every state type listed above.
   Record stable IDs and expected content hashes/counts.
3. Create and verify the mandatory backup again after the fixture is complete.
4. Choose a fresh database matching `pos_native_recovery_[a-z0-9_]+`. Confirm
   no database, restore directory, or recovery asset volume with those names
   already exists.
5. Restore without changing production state:

   ```powershell
   .\scripts\nativepos.ps1 -Action Restore `
     -BackupId <backup-uuid> `
     -RecoveryDatabase pos_native_recovery_m7_review `
     -ConfirmRestore
   ```

6. Start a separate NativePOS-exclusive application instance against the
   recovery database and returned asset volume. Never repoint production.
7. Run the post-rehearsal checks. Preserve failed targets and logs; retry only
   with new empty targets.

## Post-rehearsal verification

- `/health` returns 200 and `/ready` returns 200 only with the exact twelve-row
  migration sequence through `0011`.
- Authenticated `/api/v1/system/status` reports ready, schema `0011`, and the
  production-local profile without secrets or private paths.
- All 17 canonical table counts and deterministic content hashes match source.
- Stable entity/link/block/asset IDs, hierarchy, archived history, revisions,
  audits, typed values, active relations, forward links, and backlinks match.
- Every manifest asset matches database byte size/SHA-256 and downloaded bytes.
- Bounded machine retrieval and search return the recorded synthetic results.
- Repeat readback after separate application and PostgreSQL restarts, using only
  isolated rehearsal resources.
- Invalid token, missing CSRF, stale revision, oversized request, tampered
  backup, non-empty database, and non-empty asset target checks fail closed.

Record each result as pass, fail, or not run. A skipped check is not a pass.

## Rollback and recovery

The rehearsal never replaces production targets, so rollback is to stop the
isolated recovery application and leave production unchanged. Do not drop
failed databases, remove volumes, delete backups, or overwrite targets during
evidence collection. Retain the pre-rehearsal backup and record the failure.
Cleanup is a later, specifically approved action after review.

A future cutover requires a new pre-cutover verified backup and a restore
rehearsal using the then-current code and schema. If reconciliation, integrity,
recovery, or post-checks fail, the canonical source remains unchanged.

## Human review record

Before accepting a rehearsal, a human reviews source authorisation and absence
of real data, exact commit/schema/manifest/logs, all reconciliation and skipped
items, recovery/restart evidence, security/privacy boundaries, and the explicit
statement that Notion remains canonical and M11 is not authorised.

## 2026-10-07 synthetic rehearsal evidence

The M7 closure rehearsal used only generated NativePOS records in an isolated
PostgreSQL 18.6 container on loopback. The packaged recovery operator created
backup `51878f32-ebff-48ae-847e-153918bf39f7`, independently verified manifest
SHA-256 `f173938f12627049f9f0c2487a33fa0ba95053ee816c88e14a51af2f201c4dbb`,
and restored it into the fresh database
`pos_native_recovery_m7_20261007` with a distinct empty asset target.

Source and recovery counts plus deterministic content hashes matched for all
17 canonical tables. A separate loopback-only recovery application reported
health and readiness, schema `0011`, and the `production-local` profile.
Authenticated bearer search returned the preserved `Alpha Workspace` result;
an invalid bearer failed with 401. The same authenticated result remained
available after separate application and PostgreSQL restarts. The automated
current-schema acceptance also passed its page-link history, revisions, audit,
derived search, and restart comparisons.

The first standalone application probe deliberately lacked the production
restart policy and exited when PostgreSQL restarted. That failure was retained
and diagnosed; the fresh probe using the production `unless-stopped` policy
passed. This evidence does not change any real-data, human-review, source
authorisation, Notion, or cutover gate above.
