import { randomUUID } from "node:crypto";
import process from "node:process";
import { URL } from "node:url";

import { Pool } from "pg";
import { z } from "zod";

import { hashPassword } from "../dist/packages/auth/src/password.js";
import { LocalAccountBootstrap } from "../dist/packages/database/src/local-account-bootstrap.js";
import { createPostgresSqlQueryClient } from "../dist/packages/database/src/postgres-authentication-store.js";

const emailSchema = z.string().trim().email().max(320);

async function main() {
  const email = readEmail(process.argv.slice(2));
  const password = await readHiddenLine("Create NativePOS owner password: ");
  const confirmation = await readHiddenLine(
    "Confirm NativePOS owner password: ",
  );
  if (password !== confirmation) {
    throw new Error("owner password confirmation did not match");
  }

  const passwordHash = await hashPassword(password);
  const pool = new Pool({ connectionString: requireDatabaseUrl(process.env) });
  try {
    const bootstrap = new LocalAccountBootstrap(
      createPostgresSqlQueryClient(pool),
    );
    await bootstrap.createOwner({
      id: randomUUID(),
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
    });
  } finally {
    await pool.end();
  }

  process.stdout.write("NativePOS owner account created.\n");
}

function readEmail(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== "--email") {
    throw new Error("owner email is required");
  }
  const parsed = emailSchema.safeParse(argumentsList[1]);
  if (!parsed.success) throw new Error("owner email is invalid");
  return parsed.data.toLowerCase();
}

function requireDatabaseUrl(environment) {
  const value = environment.DATABASE_URL;
  if (typeof value !== "string")
    throw new Error("database configuration missing");
  const protocol = new URL(value).protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new Error("database configuration invalid");
  }
  return value;
}

function readHiddenLine(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("an interactive terminal is required");
  }
  const setRawMode = process.stdin.setRawMode;
  if (typeof setRawMode !== "function") {
    throw new Error("an interactive terminal is required");
  }

  const wasRaw = process.stdin.isRaw;
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;

    const cleanUp = () => {
      process.stdin.off("data", onData);
      process.stdin.off("error", onError);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
    };
    const resolveValue = () => {
      if (settled) return;
      settled = true;
      process.stdout.write("\n");
      cleanUp();
      resolve(value);
    };
    const rejectValue = (error) => {
      if (settled) return;
      settled = true;
      process.stdout.write("\n");
      cleanUp();
      reject(error);
    };
    const onError = (error) => rejectValue(error);
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          resolveValue();
          return;
        }
        if (character === "\u0003") {
          rejectValue(new Error("owner password entry cancelled"));
          return;
        }
        if (character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        if (character.codePointAt(0) >= 32) value += character;
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.on("data", onData);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });
}

void main().catch(() => {
  process.stderr.write("NativePOS owner bootstrap did not complete.\n");
  process.exitCode = 1;
});
