import process from "node:process";

import { asNativeId } from "../dist/packages/domain/src/ids.js";
import { DockerPostgresBackupDriver } from "../dist/packages/backup/src/docker-postgres-driver.js";
import {
  createPostgresApplicationBackup,
  restorePostgresApplicationBackup,
} from "../dist/packages/backup/src/postgres-recovery.js";
import { FilesystemAssetStore } from "../dist/packages/assets/src/filesystem-asset-store.js";
import { FilesystemAssetRestoreTarget } from "../dist/packages/backup/src/asset-restore-target.js";
import { runRecoveryCommand } from "../dist/packages/backup/src/recovery-command-runner.js";
import { verifyFilesystemBackup } from "../dist/packages/backup/src/filesystem-backup.js";

const VALUE_FLAGS = new Set([
  "--application-version",
  "--asset-root",
  "--backup-id",
  "--backup-root",
  "--container",
  "--database",
  "--max-bytes",
  "--schema-version",
  "--user",
]);

function parseArguments(argumentsList) {
  const [operation, ...tokens] = argumentsList;
  if (!new Set(["backup", "restore", "verify"]).has(operation)) {
    throw new Error("recovery operation must be backup, restore, or verify");
  }
  const values = new Map();
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const value = tokens[index + 1];
    if (
      !VALUE_FLAGS.has(flag) ||
      typeof value !== "string" ||
      value.length === 0 ||
      values.has(flag)
    ) {
      throw new Error("recovery arguments are invalid");
    }
    values.set(flag, value);
  }
  return { operation, values };
}

function requireValue(values, flag) {
  const value = values.get(flag);
  if (value === undefined) throw new Error(`${flag} is required`);
  return value;
}

function requireMaxBytes(values) {
  const value = Number(requireValue(values, "--max-bytes"));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("--max-bytes must be a positive safe integer");
  }
  return value;
}

function requireAllowedFlags(values, allowed) {
  for (const flag of values.keys()) {
    if (!allowed.has(flag)) throw new Error(`${flag} is not valid here`);
  }
}

function createDriver(values, maxDumpBytes) {
  return new DockerPostgresBackupDriver(
    {
      container: requireValue(values, "--container"),
      database: requireValue(values, "--database"),
      user: requireValue(values, "--user"),
      maxDumpBytes,
    },
    { run: runRecoveryCommand },
  );
}

async function main() {
  const { operation, values } = parseArguments(process.argv.slice(2));
  const backupRoot = requireValue(values, "--backup-root");
  const maxArtifactBytes = requireMaxBytes(values);

  if (operation === "verify") {
    requireAllowedFlags(
      values,
      new Set(["--backup-id", "--backup-root", "--max-bytes"]),
    );
    const backupId = asNativeId(requireValue(values, "--backup-id"));
    const manifest = await verifyFilesystemBackup(backupRoot, backupId, {
      maxArtifactBytes,
    });
    process.stdout.write(
      `${JSON.stringify({ operation, backupId, manifestSha256: manifest.manifestSha256 })}\n`,
    );
    return;
  }

  const driver = createDriver(values, maxArtifactBytes);
  if (operation === "backup") {
    requireAllowedFlags(
      values,
      new Set([
        "--application-version",
        "--asset-root",
        "--backup-id",
        "--backup-root",
        "--container",
        "--database",
        "--max-bytes",
        "--schema-version",
        "--user",
      ]),
    );
    const requestedBackupId = values.get("--backup-id");
    const options = {
      maxArtifactBytes,
      ...(requestedBackupId === undefined
        ? {}
        : { backupId: asNativeId(requestedBackupId) }),
    };
    const assetStore = await FilesystemAssetStore.create(
      requireValue(values, "--asset-root"),
      { maxBytes: maxArtifactBytes },
    );
    const created = await createPostgresApplicationBackup(
      backupRoot,
      driver,
      assetStore,
      {
        schemaVersion: requireValue(values, "--schema-version"),
        applicationVersion: requireValue(values, "--application-version"),
        databaseDumpFormat: "postgresql-custom-v1",
        assetStoreFormat: "filesystem-v1",
      },
      options,
    );
    process.stdout.write(
      `${JSON.stringify({ operation, backupId: created.backupId, manifestSha256: created.manifest.manifestSha256 })}\n`,
    );
    return;
  }

  requireAllowedFlags(
    values,
    new Set([
      "--asset-root",
      "--backup-id",
      "--backup-root",
      "--container",
      "--database",
      "--max-bytes",
      "--user",
    ]),
  );
  const backupId = asNativeId(requireValue(values, "--backup-id"));
  const assetTarget = await FilesystemAssetRestoreTarget.create(
    requireValue(values, "--asset-root"),
    maxArtifactBytes,
  );
  const manifest = await restorePostgresApplicationBackup(
    backupRoot,
    backupId,
    driver,
    assetTarget,
    { maxArtifactBytes },
  );
  process.stdout.write(
    `${JSON.stringify({ operation, backupId, manifestSha256: manifest.manifestSha256 })}\n`,
  );
}

void main().catch(() => {
  process.stderr.write("NativePOS PostgreSQL recovery operation failed.\n");
  process.exitCode = 1;
});
