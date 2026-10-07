export interface ReadinessResult {
  readonly ready: boolean;
  readonly schemaVersion: "0011" | "incompatible" | "unknown";
}

export interface RuntimeReadiness {
  check(): Promise<ReadinessResult>;
}

interface QueryClient {
  query(statement: string): Promise<{ readonly rows: readonly unknown[] }>;
}

export function createRuntimeReadiness(
  client: QueryClient,
  expectedMigrationTimestamps: readonly number[],
): RuntimeReadiness {
  return {
    async check(): Promise<ReadinessResult> {
      try {
        const result = await client.query(
          "select created_at::text created_at from drizzle.__drizzle_migrations order by created_at asc",
        );
        const actual = result.rows.map(
          (row) => (row as { created_at?: unknown }).created_at,
        );
        if (
          actual.length !== expectedMigrationTimestamps.length ||
          actual.some(
            (createdAt, index) =>
              createdAt !== String(expectedMigrationTimestamps[index]),
          )
        )
          return { ready: false, schemaVersion: "incompatible" };
        return { ready: true, schemaVersion: "0011" };
      } catch {
        return { ready: false, schemaVersion: "unknown" };
      }
    },
  };
}
