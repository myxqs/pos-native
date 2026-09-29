import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (name: string) => readFile(`${root}/${name}`, "utf8");

test("production compose is private, durable, supervised and log-bounded", async () => {
  const compose = await read("compose.production.yaml");
  expect(compose).toContain('"127.0.0.1:${POS_PORT:-3000}:3000"');
  expect(compose).toContain("postgres-data:/var/lib/postgresql");
  expect(compose).toContain("asset-data:/var/lib/nativepos/assets");
  expect(compose.match(/restart: unless-stopped/g)).toHaveLength(2);
  expect(compose).toContain('max-size: "10m"');
  expect(compose).toContain('max-file: "5"');
  const postgresBlock = compose.split("  app:")[0]!;
  expect(postgresBlock).not.toContain("ports:");
  expect(compose).not.toContain("0.0.0.0:");
  expect(compose).not.toContain("latest");
});

test("runtime image uses production build and explicit non-destructive migration", async () => {
  const [dockerfile, compose, example, dockerIgnored, gitIgnored] =
    await Promise.all([
      read("Dockerfile"),
      read("compose.production.yaml"),
      read(".env.production.example"),
      read(".dockerignore"),
      read(".gitignore"),
    ]);
  expect(dockerfile).toContain("npm run build");
  expect(dockerfile).toContain("npm ci --omit=dev");
  expect(compose).toContain('profiles: ["tools"]');
  expect(compose).toContain('["node", "dist/apps/api/src/migrate.js"]');
  expect(compose).not.toMatch(/dropdb|truncate|reset/i);
  expect(example).toContain("POS_SERVICE_TOKEN=replace-with-");
  expect(example).not.toMatch(/ghp_|sk-[A-Za-z0-9]{20,}/);
  expect(dockerIgnored).toContain(".env.production");
  expect(gitIgnored).toContain("!.env.production.example");
});
