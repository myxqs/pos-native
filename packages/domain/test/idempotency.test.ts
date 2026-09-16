import { expect, test } from "vitest";

import { executeIdempotently } from "../src/idempotency.ts";

test("replays a matching completed idempotent request without re-executing it", async () => {
  let executions = 0;
  let claims = 0;
  const store = {
    claim: async () => {
      claims += 1;
      return claims === 1
        ? { state: "claimed" as const }
        : {
            state: "replay" as const,
            record: { requestHash: "hash-a", response: { id: "result-1" } },
          };
    },
    complete: async () => undefined,
  };
  const request = { key: "request-1", requestHash: "hash-a" };

  const first = await executeIdempotently(request, store, async () => {
    executions += 1;
    return { id: "result-1" };
  });
  const replay = await executeIdempotently(request, store, async () => {
    executions += 1;
    return { id: "result-2" };
  });

  expect(first).toEqual({ response: { id: "result-1" }, replayed: false });
  expect(replay).toEqual({ response: { id: "result-1" }, replayed: true });
  expect(executions).toBe(1);
});

test("rejects a reused idempotency key with a different request hash", async () => {
  const store = {
    claim: async () => {
      throw new Error("idempotency key was reused with a different request");
    },
    complete: async () => undefined,
  };

  await expect(
    executeIdempotently(
      { key: "request-1", requestHash: "hash-b" },
      store,
      async () => ({ id: "result-2" }),
    ),
  ).rejects.toThrow("idempotency key was reused with a different request");
});
