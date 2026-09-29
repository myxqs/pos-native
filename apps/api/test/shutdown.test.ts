import { expect, test, vi } from "vitest";

import { createShutdown } from "../src/shutdown.ts";

test("closes runtime exactly once across repeated termination signals", async () => {
  const close = vi.fn(async () => undefined);
  const write = vi.fn();
  const shutdown = createShutdown({ close }, write);
  await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
  expect(close).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledWith("NativePOS server stopped (SIGTERM).\n");
});

test("reports a fixed safe message when shutdown fails", async () => {
  const write = vi.fn();
  const shutdown = createShutdown(
    {
      close: async () => {
        throw new Error("secret database path");
      },
    },
    write,
  );
  await shutdown("SIGTERM");
  expect(write).toHaveBeenCalledWith("NativePOS server shutdown failed.\n");
  expect(JSON.stringify(write.mock.calls)).not.toContain(
    "secret database path",
  );
});
