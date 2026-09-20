import { expect, test } from "vitest";

import { LocalAccountBootstrap } from "../src/local-account-bootstrap.ts";

class RecordingSqlClient {
  readonly calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }> {
    this.calls.push({ text, values: [...values] });
    return { rows: this.rows as readonly Row[] };
  }
}

test("creates the single local owner through a parameterised lower-cased insert", async () => {
  const client = new RecordingSqlClient([
    { id: "11111111-1111-4111-8111-111111111111" },
  ]);
  const bootstrap = new LocalAccountBootstrap(client);
  const plaintextPassword = "secret that must not be persisted";

  await expect(
    bootstrap.createOwner({
      id: "11111111-1111-4111-8111-111111111111",
      email: " OWNER@example.test ",
      passwordHash: "argon2id-hash",
      createdAt: "2026-09-20T12:00:00.000Z",
    }),
  ).resolves.toEqual("11111111-1111-4111-8111-111111111111");

  expect(client.calls).toEqual([
    {
      text: expect.stringContaining("WHERE NOT EXISTS (SELECT 1 FROM users)"),
      values: [
        "11111111-1111-4111-8111-111111111111",
        "owner@example.test",
        "argon2id-hash",
        "2026-09-20T12:00:00.000Z",
      ],
    },
  ]);
  expect(JSON.stringify(client.calls)).not.toContain(plaintextPassword);
});

test("fails closed without replacing an existing local owner", async () => {
  const bootstrap = new LocalAccountBootstrap(new RecordingSqlClient([]));

  await expect(
    bootstrap.createOwner({
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.test",
      passwordHash: "argon2id-hash",
      createdAt: "2026-09-20T12:00:00.000Z",
    }),
  ).rejects.toThrow("owner account already exists");
});
class UniqueViolationClient {
  async query<Row extends Record<string, unknown>>(): Promise<{
    readonly rows: readonly Row[];
  }> {
    throw Object.assign(new Error("unique constraint"), { code: "23505" });
  }
}

test("maps a concurrent owner-slot conflict to the same fail-closed result", async () => {
  const bootstrap = new LocalAccountBootstrap(new UniqueViolationClient());

  await expect(
    bootstrap.createOwner({
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.test",
      passwordHash: "argon2id-hash",
      createdAt: "2026-09-20T12:00:00.000Z",
    }),
  ).rejects.toThrow("owner account already exists");
});
