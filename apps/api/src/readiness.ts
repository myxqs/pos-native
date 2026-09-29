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
  expectedMigrationCount: number,
): RuntimeReadiness {
  return {
    async check(): Promise<ReadinessResult> {
      try {
        const result = await client.query(
          "select count(*)::int migration_count from drizzle.__drizzle_migrations",
        );
        const count = (
          result.rows[0] as { migration_count?: unknown } | undefined
        )?.migration_count;
        if (count !== expectedMigrationCount)
          return { ready: false, schemaVersion: "incompatible" };
        return { ready: true, schemaVersion: "0011" };
      } catch {
        return { ready: false, schemaVersion: "unknown" };
      }
    },
  };
}
