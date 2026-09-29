export function createShutdown(
  runtime: { close(): Promise<void> },
  write: (message: string) => void,
) {
  let pending: Promise<void> | undefined;
  return (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
    pending ??= runtime
      .close()
      .then(() => write(`NativePOS server stopped (${signal}).\n`))
      .catch(() => write("NativePOS server shutdown failed.\n"));
    return pending;
  };
}
