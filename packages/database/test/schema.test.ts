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

  const pageColumns = getTableConfig(schemaModule.pages).columns;
  const currentRevisionNumber = pageColumns.find(
    (column) => column.name === "current_revision_number",
  );
  expect(currentRevisionNumber?.notNull).toBe(true);
  expect(currentRevisionNumber?.hasDefault).toBe(true);

  expect(getTableConfig(schemaModule.pages).foreignKeys).toHaveLength(2);
  expect(getTableConfig(schemaModule.blocks).foreignKeys).toHaveLength(2);
});
