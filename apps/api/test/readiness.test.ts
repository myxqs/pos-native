import { expect, test, vi } from "vitest";

import { createRuntimeReadiness } from "../src/readiness.ts";

test("reports ready only when database and exact migration state are available", async () => {
  const query = vi.fn(async () => ({ rows: [{ migration_count: 12 }] }));
  const readiness = createRuntimeReadiness({ query }, 12);
  await expect(readiness.check()).resolves.toEqual({
    ready: true,
    schemaVersion: "0011",
  });
  expect(query).toHaveBeenCalledOnce();
});

test("fails closed without leaking database diagnostics", async () => {
  const unavailable = createRuntimeReadiness(
    {
      query: async () => {
        throw new Error("postgresql://secret@host/database");
      },
    },
    12,
  );
  const behind = createRuntimeReadiness(
    { query: async () => ({ rows: [{ migration_count: 11 }] }) },
    12,
  );
  await expect(unavailable.check()).resolves.toEqual({
    ready: false,
    schemaVersion: "unknown",
  });
  await expect(behind.check()).resolves.toEqual({
    ready: false,
    schemaVersion: "incompatible",
  });
  expect(JSON.stringify(await unavailable.check())).not.toContain("secret");
});
