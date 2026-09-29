import { startProductionRuntime } from "./runtime.ts";
import { createShutdown } from "./shutdown.ts";

void startProductionRuntime()
  .then((runtime) => {
    process.stdout.write("NativePOS server started.\n");
    const shutdown = createShutdown(runtime, (message) =>
      process.stdout.write(message),
    );
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  })
  .catch(() => {
    process.stderr.write("NativePOS server failed to start.\n");
    process.exitCode = 1;
  });
