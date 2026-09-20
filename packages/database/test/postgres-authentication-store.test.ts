import { createHash } from "node:crypto";

import { expect, test } from "vitest";

import { hashPassword } from "../../auth/src/password.ts";
import {
  AuthenticationService,
  type StoredSession,
} from "../../auth/src/session.ts";
import { PostgresAuthenticationStore } from "../src/postgres-authentication-store.ts";

class RecordingSqlClient {
  readonly calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];

  constructor(
    private readonly responses: {
      readonly rows: readonly Record<string, unknown>[];
    }[],
  ) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }> {
    this.calls.push({ text, values: [...values] });
    const response = this.responses.shift();
    if (!response) throw new Error("unexpected SQL query");
    return { rows: response.rows as readonly Row[] };
  }
}

test("looks up the lower-cased local account through a parameterised query", async () => {
  const client = new RecordingSqlClient([
    {
      rows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          email: "owner@example.test",
          password_hash: "argon-digest",
        },
      ],
    },
  ]);
  const store = new PostgresAuthenticationStore(client);

  await expect(store.findAccountByEmail("owner@example.test")).resolves.toEqual(
    {
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.test",
      passwordHash: "argon-digest",
    },
  );
  expect(client.calls).toEqual([
    {
      text: expect.stringContaining("WHERE email = $1"),
      values: ["owner@example.test"],
    },
  ]);
});

test("persists only hashes created by the authentication service", async () => {
  const password = "correct horse battery staple";
  const rawSessionToken = "session-token-never-persisted";
  const rawCsrfToken = "csrf-token-never-persisted";
  const client = new RecordingSqlClient([
    {
      rows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          email: "owner@example.test",
          password_hash: await hashPassword(password),
        },
      ],
    },
    { rows: [] },
  ]);
  const store = new PostgresAuthenticationStore(client);
  const tokens = [rawSessionToken, rawCsrfToken];
  const service = new AuthenticationService(store, {
    now: () => new Date("2026-09-20T12:00:00.000Z"),
    randomToken: () => tokens.shift() ?? "",
    sessionId: () => "22222222-2222-4222-8222-222222222222",
  });

  await expect(
    service.login("owner@example.test", password),
  ).resolves.toMatchObject({
    sessionToken: rawSessionToken,
    csrfToken: rawCsrfToken,
  });

  const persisted = client.calls[1];
  expect(persisted?.text).toContain("INSERT INTO sessions");
  expect(persisted?.values).toContain(
    createHash("sha256").update(rawSessionToken).digest("hex"),
  );
  expect(persisted?.values).toContain(
    createHash("sha256").update(rawCsrfToken).digest("hex"),
  );
  expect(JSON.stringify(client.calls)).not.toContain(rawSessionToken);
  expect(JSON.stringify(client.calls)).not.toContain(rawCsrfToken);
});

test("maps sessions with normalised timestamps and revokes only a live match", async () => {
  const client = new RecordingSqlClient([
    {
      rows: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          user_id: "11111111-1111-4111-8111-111111111111",
          token_hash: "session-hash",
          csrf_token_hash: "csrf-hash",
          created_at: new Date("2026-09-20T12:00:00.000Z"),
          expires_at: new Date("2026-09-27T12:00:00.000Z"),
          revoked_at: null,
        },
      ],
    },
    { rows: [] },
  ]);
  const store = new PostgresAuthenticationStore(client);

  await expect(
    store.findSessionByTokenHash("session-hash"),
  ).resolves.toEqual<StoredSession>({
    id: "22222222-2222-4222-8222-222222222222",
    userId: "11111111-1111-4111-8111-111111111111",
    tokenHash: "session-hash",
    csrfTokenHash: "csrf-hash",
    createdAt: "2026-09-20T12:00:00.000Z",
    expiresAt: "2026-09-27T12:00:00.000Z",
    revokedAt: null,
  });
  await store.revokeSession("session-hash", "2026-09-20T13:00:00.000Z");

  expect(client.calls[1]).toEqual({
    text: expect.stringContaining("AND revoked_at IS NULL"),
    values: ["session-hash", "2026-09-20T13:00:00.000Z"],
  });
});
