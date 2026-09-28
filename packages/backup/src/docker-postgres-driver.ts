import { ValidationError } from "../../domain/src/ids.ts";
import {
  asAssetStorageKey,
  storageKeyForAsset,
  validateAssetByteSize,
  validateAssetSha256,
} from "../../domain/src/asset.ts";
import { asNativeId } from "../../domain/src/ids.ts";
import type { BackupSourceAsset } from "./backup-manifest.ts";
import type { PostgresBackupDriver } from "./postgres-recovery.ts";

export interface RecoveryCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly input?: Uint8Array;
  readonly maxOutputBytes: number;
}

export interface RecoveryCommandRunner {
  run(command: RecoveryCommand): Promise<Uint8Array>;
}

export interface DockerPostgresBackupConfiguration {
  readonly container: string;
  readonly database: string;
  readonly user: string;
  readonly maxDumpBytes: number;
}

const SAFE_ARGUMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const RESTORE_OUTPUT_LIMIT = 1024 * 1024;
const ASSET_RECEIPT_QUERY = `
SELECT id, storage_key, byte_size, sha256
FROM assets
ORDER BY created_at, id;
`.trim();
const TARGET_OBJECT_COUNT_QUERY = `
WITH user_namespaces AS (
  SELECT oid, nspname
  FROM pg_namespace
  WHERE nspname <> 'information_schema'
    AND nspname NOT LIKE 'pg_%'
), user_objects AS (
  SELECT c.oid
  FROM pg_class c
  JOIN user_namespaces n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  UNION ALL
  SELECT p.oid
  FROM pg_proc p
  JOIN user_namespaces n ON n.oid = p.pronamespace
  UNION ALL
  SELECT t.oid
  FROM pg_type t
  JOIN user_namespaces n ON n.oid = t.typnamespace
  WHERE t.typtype IN ('c', 'd', 'e', 'r', 'm')
  UNION ALL
  SELECT n.oid
  FROM user_namespaces n
  WHERE n.nspname <> 'public'
)
SELECT count(*) FROM user_objects;
`.trim();

function requireSafeArgument(value: string, label: string): string {
  if (typeof value !== "string" || !SAFE_ARGUMENT_PATTERN.test(value)) {
    throw new ValidationError(`${label} is invalid`);
  }
  return value;
}

function requireDumpLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(
      "PostgreSQL dump limit must be a positive safe integer",
    );
  }
  return value;
}

function parseObjectCount(bytes: Uint8Array): number {
  const value = new TextDecoder().decode(bytes).trim();
  if (!/^[0-9]+$/u.test(value)) {
    throw new ValidationError(
      "PostgreSQL restore target inspection returned an invalid result",
    );
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new ValidationError(
      "PostgreSQL restore target inspection returned an invalid result",
    );
  }
  return count;
}

function parseAssetReceipts(bytes: Uint8Array): readonly BackupSourceAsset[] {
  try {
    const output = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (output.length === 0) return [];
    if (
      !output.endsWith("\n") ||
      output.includes("\r") ||
      output.includes("\0")
    ) {
      throw new Error("invalid framing");
    }
    const lines = output.slice(0, -1).split("\n");
    const ids = new Set<string>();
    const keys = new Set<string>();
    return lines.map((line) => {
      const fields = line.split("\t");
      if (fields.length !== 4) throw new Error("invalid field count");
      const [idValue, keyValue, sizeValue, checksumValue] = fields;
      const assetId = asNativeId(idValue ?? "");
      const storageKey = asAssetStorageKey(keyValue ?? "");
      if (storageKey !== storageKeyForAsset(assetId)) {
        throw new Error("identity mismatch");
      }
      if (!/^(0|[1-9]\d*)$/u.test(sizeValue ?? "")) {
        throw new Error("invalid byte size");
      }
      const byteSize = Number(sizeValue);
      validateAssetByteSize(byteSize, Number.MAX_SAFE_INTEGER);
      const sha256 = validateAssetSha256(checksumValue ?? "");
      if (ids.has(assetId) || keys.has(storageKey)) {
        throw new Error("duplicate receipt");
      }
      ids.add(assetId);
      keys.add(storageKey);
      return { assetId, storageKey, byteSize, sha256 };
    });
  } catch {
    throw new ValidationError("PostgreSQL asset receipt projection is invalid");
  }
}

export class DockerPostgresBackupDriver implements PostgresBackupDriver {
  readonly #container: string;
  readonly #database: string;
  readonly #user: string;
  readonly #maxDumpBytes: number;
  readonly #runner: RecoveryCommandRunner;

  constructor(
    configuration: DockerPostgresBackupConfiguration,
    runner: RecoveryCommandRunner,
  ) {
    this.#container = requireSafeArgument(
      configuration.container,
      "Docker container name",
    );
    this.#database = requireSafeArgument(
      configuration.database,
      "PostgreSQL database name",
    );
    this.#user = requireSafeArgument(
      configuration.user,
      "PostgreSQL user name",
    );
    this.#maxDumpBytes = requireDumpLimit(configuration.maxDumpBytes);
    this.#runner = runner;
  }

  async createDatabaseDump(): Promise<Uint8Array> {
    return this.#runner.run({
      executable: "docker",
      arguments: [
        "exec",
        this.#container,
        "pg_dump",
        "--username",
        this.#user,
        "--dbname",
        this.#database,
        "--format=custom",
        "--no-owner",
        "--no-privileges",
      ],
      maxOutputBytes: this.#maxDumpBytes,
    });
  }

  async listAssets(): Promise<readonly BackupSourceAsset[]> {
    const output = await this.#runner.run({
      executable: "docker",
      arguments: [
        "exec",
        this.#container,
        "psql",
        "--username",
        this.#user,
        "--dbname",
        this.#database,
        "--tuples-only",
        "--no-align",
        "--field-separator",
        "\t",
        "--set",
        "ON_ERROR_STOP=1",
        "--command",
        ASSET_RECEIPT_QUERY,
      ],
      maxOutputBytes: this.#maxDumpBytes,
    });
    return parseAssetReceipts(output);
  }

  async isRestoreTargetEmpty(): Promise<boolean> {
    const output = await this.#runner.run({
      executable: "docker",
      arguments: [
        "exec",
        this.#container,
        "psql",
        "--username",
        this.#user,
        "--dbname",
        this.#database,
        "--tuples-only",
        "--no-align",
        "--set",
        "ON_ERROR_STOP=1",
        "--command",
        TARGET_OBJECT_COUNT_QUERY,
      ],
      maxOutputBytes: 1024,
    });
    return parseObjectCount(output) === 0;
  }

  async restoreDatabaseDump(bytes: Uint8Array): Promise<void> {
    await this.#runner.run({
      executable: "docker",
      arguments: [
        "exec",
        "--interactive",
        this.#container,
        "pg_restore",
        "--username",
        this.#user,
        "--dbname",
        this.#database,
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
      ],
      input: Uint8Array.from(bytes),
      maxOutputBytes: RESTORE_OUTPUT_LIMIT,
    });
  }
}
