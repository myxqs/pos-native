import { startProductionRuntime } from "./runtime.ts";

void startProductionRuntime().catch(() => {
  process.stderr.write("NativePOS server failed to start.\n");
  process.exitCode = 1;
});
