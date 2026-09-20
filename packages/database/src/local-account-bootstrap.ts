import type { SqlQueryClient } from "./postgres-authentication-store.ts";

export interface LocalOwnerAccount {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly createdAt: string;
}

export class LocalAccountBootstrap {
  constructor(private readonly client: SqlQueryClient) {}

  async createOwner(account: LocalOwnerAccount): Promise<string> {
    try {
      const result = await this.client.query(
        "INSERT INTO users (id, email, password_hash, created_at, updated_at) SELECT $1, $2, $3, $4, $4 WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id",
        [
          account.id,
          account.email.trim().toLowerCase(),
          account.passwordHash,
          account.createdAt,
        ],
      );
      const id = result.rows[0]?.id;
      if (typeof id !== "string" || !id) {
        throw new Error("owner account already exists");
      }
      return id;
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw new Error("owner account already exists", { cause: error });
      }
      throw error;
    }
  }
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
