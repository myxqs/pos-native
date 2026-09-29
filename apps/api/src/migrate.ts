import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write("NativePOS migration configuration is invalid.\n");
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(
        new URL("../../../../packages/database/drizzle", import.meta.url),
      ),
    });
    process.stdout.write("NativePOS migrations are current.\n");
  } catch {
    process.stderr.write("NativePOS migration failed.\n");
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
