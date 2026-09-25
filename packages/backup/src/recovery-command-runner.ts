import { spawn } from "node:child_process";

import { ValidationError } from "../../domain/src/ids.ts";
import type { RecoveryCommand } from "./docker-postgres-driver.ts";

export function runRecoveryCommand(
  command: RecoveryCommand,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(command.maxOutputBytes) ||
    command.maxOutputBytes <= 0
  ) {
    return Promise.reject(
      new ValidationError(
        "recovery command output limit must be a positive safe integer",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.arguments], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let outputExceeded = false;
    let spawnFailed = false;

    child.stdout.on("data", (chunk: Buffer) => {
      if (outputExceeded) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > command.maxOutputBytes) {
        outputExceeded = true;
        child.kill();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    child.stderr.resume();
    child.once("error", () => {
      spawnFailed = true;
      reject(new Error("recovery command failed"));
    });
    child.once("close", (code) => {
      if (spawnFailed) return;
      if (outputExceeded) {
        reject(
          new ValidationError(
            "recovery command output exceeded the configured limit",
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(new Error("recovery command failed"));
        return;
      }
      resolve(Uint8Array.from(Buffer.concat(chunks, outputBytes)));
    });

    child.stdin.on("error", () => undefined);
    if (command.input === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(Buffer.from(command.input));
    }
  });
}
