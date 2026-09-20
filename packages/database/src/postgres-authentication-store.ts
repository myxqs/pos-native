import type { Pool } from "pg";

import type {
  AuthenticationStore,
  LocalAccount,
  StoredSession,
} from "../../auth/src/session.ts";

export interface SqlQueryClient {
  query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
}

export class PostgresAuthenticationStore implements AuthenticationStore {
  constructor(private readonly client: SqlQueryClient) {}

  async findAccountByEmail(email: string): Promise<LocalAccount | null> {
    const result = await this.client.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1",
      [email],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: requiredString(row, "id"),
      email: requiredString(row, "email"),
      passwordHash: requiredString(row, "password_hash"),
    };
  }

  async createSession(session: StoredSession): Promise<void> {
    await this.client.query(
      "INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, expires_at, revoked_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.csrfTokenHash,
        session.expiresAt,
        session.revokedAt,
        session.createdAt,
      ],
    );
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null> {
    const result = await this.client.query(
      "SELECT id, user_id, token_hash, csrf_token_hash, created_at, expires_at, revoked_at FROM sessions WHERE token_hash = $1 LIMIT 1",
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: requiredString(row, "id"),
      userId: requiredString(row, "user_id"),
      tokenHash: requiredString(row, "token_hash"),
      csrfTokenHash: requiredString(row, "csrf_token_hash"),
      createdAt: requiredTimestamp(row, "created_at"),
      expiresAt: requiredTimestamp(row, "expires_at"),
      revokedAt: optionalTimestamp(row, "revoked_at"),
    };
  }

  async revokeSession(tokenHash: string, revokedAt: string): Promise<void> {
    await this.client.query(
      "UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL",
      [tokenHash, revokedAt],
    );
  }
}

export function createPostgresAuthenticationStore(
  pool: Pick<Pool, "query">,
): PostgresAuthenticationStore {
  return new PostgresAuthenticationStore(createPostgresSqlQueryClient(pool));
}

export function createPostgresSqlQueryClient(
  pool: Pick<Pool, "query">,
): SqlQueryClient {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      values: readonly unknown[],
    ): Promise<{ readonly rows: readonly Row[] }> {
      const result = await pool.query(text, [...values]);
      return { rows: result.rows as readonly Row[] };
    },
  };
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || !value) {
    throw new Error("invalid PostgreSQL authentication row");
  }
  return value;
}

function requiredTimestamp(
  row: Record<string, unknown>,
  field: string,
): string {
  const value = timestampToIso(row[field]);
  if (!value) throw new Error("invalid PostgreSQL authentication row");
  return value;
}

function optionalTimestamp(
  row: Record<string, unknown>,
  field: string,
): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  const timestamp = timestampToIso(value);
  if (!timestamp) throw new Error("invalid PostgreSQL authentication row");
  return timestamp;
}

function timestampToIso(value: unknown): string | null {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
