import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (name: string) => readFile(`${root}/${name}`, "utf8");

test("operator exposes bounded safe lifecycle and full-state recovery commands", async () => {
  const script = await read("scripts/nativepos.ps1");
  for (const action of [
    "Build",
    "Migrate",
    "Start",
    "Stop",
    "Restart",
    "Status",
    "Logs",
    "Backup",
    "Restore",
  ])
    expect(script).toContain(`"${action}"`);
  expect(script).toContain("MaxDockerAttempts = 12");
  expect(script).toContain(
    "Docker did not become ready within the bounded startup window",
  );
  expect(script).toContain("docker cp");
  expect(script).toContain("postgres-recovery.mjs");
  expect(script).toContain("pos_native_recovery_");
  expect(script).toContain("asset-data");
  expect(script).not.toMatch(
    /0\.0\.0\.0:|New-NetFirewallRule|cloudflared|--privileged/,
  );
});

test("Task Scheduler script defaults to definition generation and never hides installation", async () => {
  const script = await read("scripts/nativepos-task.ps1");
  expect(script).toContain('[ValidateSet("Generate", "Install", "Uninstall")]');
  expect(script).toContain('$Mode = "Generate"');
  expect(script).toContain("AtLogOn");
  expect(script).toContain(
    "NativePOS auto-start is prepared but not installed",
  );
  expect(script).not.toContain("RunLevel Highest");
});
