import { expect, test } from "vitest";

import {
  DockerPostgresBackupDriver,
  type RecoveryCommand,
  type RecoveryCommandRunner,
} from "../src/docker-postgres-driver.ts";

class RecordingRunner implements RecoveryCommandRunner {
  readonly commands: RecoveryCommand[] = [];
  readonly outputs: Uint8Array[] = [];

  async run(command: RecoveryCommand): Promise<Uint8Array> {
    this.commands.push(command);
    return this.outputs.shift() ?? new Uint8Array();
  }
}

test("creates a bounded custom-format dump through docker exec", async () => {
  const runner = new RecordingRunner();
  runner.outputs.push(new Uint8Array([80, 71, 68, 77, 80]));
  const driver = new DockerPostgresBackupDriver(
    {
      container: "pos-native-postgres-1",
      database: "pos_native_source",
      user: "pos_native",
      maxDumpBytes: 4096,
    },
    runner,
  );

  await expect(driver.createDatabaseDump()).resolves.toEqual(
    new Uint8Array([80, 71, 68, 77, 80]),
  );
  expect(runner.commands).toEqual([
    {
      executable: "docker",
      arguments: [
        "exec",
        "pos-native-postgres-1",
        "pg_dump",
        "--username",
        "pos_native",
        "--dbname",
        "pos_native_source",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
      ],
      maxOutputBytes: 4096,
    },
  ]);
});

test("treats only a zero object count as an empty restore target", async () => {
  const emptyRunner = new RecordingRunner();
  emptyRunner.outputs.push(new TextEncoder().encode("0\n"));
  const emptyDriver = new DockerPostgresBackupDriver(
    {
      container: "pos-native-postgres-1",
      database: "pos_native_target",
      user: "pos_native",
      maxDumpBytes: 4096,
    },
    emptyRunner,
  );
  await expect(emptyDriver.isRestoreTargetEmpty()).resolves.toBe(true);

  const occupiedRunner = new RecordingRunner();
  occupiedRunner.outputs.push(new TextEncoder().encode("1\n"));
  const occupiedDriver = new DockerPostgresBackupDriver(
    {
      container: "pos-native-postgres-1",
      database: "pos_native_target",
      user: "pos_native",
      maxDumpBytes: 4096,
    },
    occupiedRunner,
  );
  await expect(occupiedDriver.isRestoreTargetEmpty()).resolves.toBe(false);
});

test("streams verified dump bytes to pg_restore with fail-closed options", async () => {
  const runner = new RecordingRunner();
  const driver = new DockerPostgresBackupDriver(
    {
      container: "pos-native-postgres-1",
      database: "pos_native_target",
      user: "pos_native",
      maxDumpBytes: 4096,
    },
    runner,
  );
  const dump = new Uint8Array([80, 71, 68, 77, 80]);

  await driver.restoreDatabaseDump(dump);

  expect(runner.commands).toEqual([
    {
      executable: "docker",
      arguments: [
        "exec",
        "--interactive",
        "pos-native-postgres-1",
        "pg_restore",
        "--username",
        "pos_native",
        "--dbname",
        "pos_native_target",
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
      ],
      input: dump,
      maxOutputBytes: 1024 * 1024,
    },
  ]);
});

test("parses a fixed bounded PostgreSQL asset receipt projection", async () => {
  const runner = new RecordingRunner();
  runner.outputs.push(
    new TextEncoder().encode(
      "11111111-1111-4111-8111-111111111111\tasset-11111111-1111-4111-8111-111111111111\t5\t" +
        "a".repeat(64) +
        "\n",
    ),
  );
  const driver = new DockerPostgresBackupDriver(
    {
      container: "pos-native-postgres-1",
      database: "pos_native_source",
      user: "pos_native",
      maxDumpBytes: 4096,
    },
    runner,
  );

  await expect(driver.listAssets()).resolves.toEqual([
    {
      assetId: "11111111-1111-4111-8111-111111111111",
      storageKey: "asset-11111111-1111-4111-8111-111111111111",
      byteSize: 5,
      sha256: "a".repeat(64),
    },
  ]);
  expect(runner.commands[0]).toMatchObject({
    executable: "docker",
    maxOutputBytes: 4096,
  });
  expect(runner.commands[0]?.arguments).toContain("--no-align");
  expect(runner.commands[0]?.arguments).toContain("--field-separator");
});

test.each([
  [
    "extra field",
    "11111111-1111-4111-8111-111111111111\tasset-11111111-1111-4111-8111-111111111111\t5\t" +
      "a".repeat(64) +
      "\textra\n",
  ],
  [
    "identity mismatch",
    "11111111-1111-4111-8111-111111111111\tasset-22222222-2222-4222-8222-222222222222\t5\t" +
      "a".repeat(64) +
      "\n",
  ],
  [
    "unsafe size",
    "11111111-1111-4111-8111-111111111111\tasset-11111111-1111-4111-8111-111111111111\t-1\t" +
      "a".repeat(64) +
      "\n",
  ],
  [
    "unsafe checksum",
    "11111111-1111-4111-8111-111111111111\tasset-11111111-1111-4111-8111-111111111111\t5\tBAD\n",
  ],
  [
    "duplicate",
    (
      "11111111-1111-4111-8111-111111111111\tasset-11111111-1111-4111-8111-111111111111\t5\t" +
      "a".repeat(64) +
      "\n"
    ).repeat(2),
  ],
  ["extra output", "NOTICE unexpected output\n"],
] as const)(
  "rejects %s in the asset receipt projection",
  async (_label, output) => {
    const runner = new RecordingRunner();
    runner.outputs.push(new TextEncoder().encode(output));
    const driver = new DockerPostgresBackupDriver(
      {
        container: "pos-native-postgres-1",
        database: "pos_native_source",
        user: "pos_native",
        maxDumpBytes: 4096,
      },
      runner,
    );

    await expect(driver.listAssets()).rejects.toThrow(
      "PostgreSQL asset receipt projection is invalid",
    );
  },
);

test("rejects unsafe or unbounded Docker recovery configuration", () => {
  const runner = new RecordingRunner();

  expect(
    () =>
      new DockerPostgresBackupDriver(
        {
          container: "bad\ncontainer",
          database: "pos_native",
          user: "pos_native",
          maxDumpBytes: 4096,
        },
        runner,
      ),
  ).toThrow("Docker container name is invalid");
  expect(
    () =>
      new DockerPostgresBackupDriver(
        {
          container: "pos-native-postgres-1",
          database: "pos_native",
          user: "pos_native",
          maxDumpBytes: 0,
        },
        runner,
      ),
  ).toThrow("PostgreSQL dump limit must be a positive safe integer");
});
