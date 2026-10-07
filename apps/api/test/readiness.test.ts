import { expect, test, vi } from "vitest";

import { createRuntimeReadiness } from "../src/readiness.ts";

test("reports ready only when database and exact migration state are available", async () => {
  const query = vi.fn(async () => ({
    rows: [{ created_at: "100" }, { created_at: "200" }],
  }));
  const readiness = createRuntimeReadiness({ query }, [100, 200]);
  await expect(readiness.check()).resolves.toEqual({
    ready: true,
    schemaVersion: "0011",
  });
  expect(query).toHaveBeenCalledOnce();
});

test("fails closed when the migration ledger has the expected count but different migrations", async () => {
  const readiness = createRuntimeReadiness(
    {
      query: async () => ({
        rows: [{ created_at: "100" }, { created_at: "999" }],
      }),
    },
    [100, 200],
  );

  await expect(readiness.check()).resolves.toEqual({
    ready: false,
    schemaVersion: "incompatible",
  });
});

test("fails closed without leaking database diagnostics", async () => {
  const unavailable = createRuntimeReadiness(
    {
      query: async () => {
        throw new Error("postgresql://secret@host/database");
      },
    },
    [100, 200],
  );
  const behind = createRuntimeReadiness(
    { query: async () => ({ rows: [{ created_at: "100" }] }) },
    [100, 200],
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
