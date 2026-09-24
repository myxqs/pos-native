import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import { expect, test } from "vitest";

import * as schemaModule from "../src/schema.ts";

test("defines the M1 canonical entity tables with durable identity constraints", () => {
  expect(schemaModule.users).toBeDefined();
  expect(schemaModule.sessions).toBeDefined();
  expect(schemaModule.apiTokens).toBeDefined();
  expect(schemaModule.pages).toBeDefined();
  expect(schemaModule.blocks).toBeDefined();
  expect(schemaModule.assets).toBeDefined();
  expect(schemaModule.revisions).toBeDefined();
  expect(schemaModule.auditEvents).toBeDefined();
  expect(schemaModule.idempotencyRecords).toBeDefined();

  const userColumns = getTableConfig(schemaModule.users).columns;
  const email = userColumns.find((column) => column.name === "email");
  expect(email?.notNull).toBe(true);
  expect(email?.isUnique).toBe(true);

  const ownerSlot = userColumns.find((column) => column.name === "owner_slot");
  expect(ownerSlot?.notNull).toBe(true);
  expect(ownerSlot?.hasDefault).toBe(true);
  expect(ownerSlot?.isUnique).toBe(true);

  const pageColumns = getTableConfig(schemaModule.pages).columns;
  const currentRevisionNumber = pageColumns.find(
    (column) => column.name === "current_revision_number",
  );
  expect(currentRevisionNumber?.notNull).toBe(true);
  expect(currentRevisionNumber?.hasDefault).toBe(true);

  const sessionColumns = getTableConfig(schemaModule.sessions).columns;
  const csrfTokenHash = sessionColumns.find(
    (column) => column.name === "csrf_token_hash",
  );
  expect(csrfTokenHash?.notNull).toBe(true);

  expect(getTableConfig(schemaModule.pages).foreignKeys).toHaveLength(2);
  const blockForeignKeys = getTableConfig(schemaModule.blocks).foreignKeys;
  expect(blockForeignKeys).toHaveLength(3);
  expect(
    blockForeignKeys.some((foreignKey) => {
      const reference = foreignKey.reference();
      return (
        reference.columns.map((column) => column.name).join(",") ===
          "parent_block_id,page_id" &&
        reference.foreignColumns.map((column) => column.name).join(",") ===
          "id,page_id"
      );
    }),
  ).toBe(true);
});

test("fails migration rather than creating pages without revision history", () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL("../drizzle/0002_black_shinko_yamashiro.sql", import.meta.url),
    ),
    "utf8",
  );
  expect(migration).toContain("RAISE EXCEPTION");
});
test("revokes legacy sessions before requiring a CSRF token hash", () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL("../drizzle/0003_right_vertigo.sql", import.meta.url),
    ),
    "utf8",
  );
  expect(migration).toContain('UPDATE "sessions"');
  expect(migration).toContain('"revoked_at"');
  expect(migration).toContain("SET NOT NULL");
});

test("constrains structured-data definitions and positive record revisions", () => {
  const definitionConfig = getTableConfig(schemaModule.propertyDefinitions);
  const nameKey = definitionConfig.columns.find(
    (column) => column.name === "name_key",
  );
  expect(nameKey?.notNull).toBe(true);
  expect(
    definitionConfig.indexes.some(
      (index) =>
        index.config.name === "property_definitions_source_name_key_unique",
    ),
  ).toBe(true);
  expect(definitionConfig.checks.map((constraint) => constraint.name)).toEqual(
    expect.arrayContaining([
      "property_definitions_kind_supported",
      "property_definitions_shape_valid",
    ]),
  );
  expect(
    getTableConfig(schemaModule.dataSourceItems).checks.map(
      (constraint) => constraint.name,
    ),
  ).toContain("data_source_items_property_revision_positive");
});

test("backfills canonical property-name keys before enforcing the new constraint", () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL("../drizzle/0007_pale_micromacro.sql", import.meta.url),
    ),
    "utf8",
  );
  const addNullable = migration.indexOf('ADD COLUMN "name_key" text;');
  const backfill = migration.indexOf(
    'SET "name_key" = lower(normalize("name", NFKC))',
  );
  const makeRequired = migration.indexOf(
    'ALTER COLUMN "name_key" SET NOT NULL',
  );
  expect(addNullable).toBeGreaterThanOrEqual(0);
  expect(backfill).toBeGreaterThan(addNullable);
  expect(makeRequired).toBeGreaterThan(backfill);
});
