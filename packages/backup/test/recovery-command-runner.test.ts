import process from "node:process";
import { expect, test } from "vitest";

import { runRecoveryCommand } from "../src/recovery-command-runner.ts";

test("runs a command without a shell and streams bounded input and output", async () => {
  const input = new TextEncoder().encode("synthetic dump bytes");

  const output = await runRecoveryCommand({
    executable: process.execPath,
    arguments: [
      "--input-type=module",
      "--eval",
      "process.stdin.pipe(process.stdout)",
    ],
    input,
    maxOutputBytes: 1024,
  });

  expect(output).toEqual(input);
});

test("terminates a command whose output exceeds the configured limit", async () => {
  await expect(
    runRecoveryCommand({
      executable: process.execPath,
      arguments: ["--eval", "process.stdout.write('x'.repeat(2048))"],
      maxOutputBytes: 1024,
    }),
  ).rejects.toThrow("recovery command output exceeded the configured limit");
});

test("reports command failure without exposing stderr details", async () => {
  const operation = runRecoveryCommand({
    executable: process.execPath,
    arguments: [
      "--eval",
      "process.stderr.write('synthetic-secret'); process.exit(7)",
    ],
    maxOutputBytes: 1024,
  });

  await expect(operation).rejects.toThrow("recovery command failed");
  await expect(operation).rejects.not.toThrow("synthetic-secret");
});
