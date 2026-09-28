import assert from "node:assert/strict";
import { test } from "vitest";

import {
  addRelationEdge,
  createDataSource,
  createDataSourceItem,
  createPropertyDefinition,
  removeRelationEdge,
  setRecordProperty,
} from "../src/data-source.ts";
import { asNativeId, ValidationError } from "../src/ids.ts";

const actor = { actorType: "user" as const, actorId: "will", source: "ui" };
const at = "2026-09-24T12:00:00.000Z";
const id = (n: number) =>
  asNativeId(`00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`);

function dependencies() {
  let next = 1;
  return { newId: () => id(next++), now: () => new Date(at) };
}

function source() {
  return createDataSource({ name: "Projects", ...actor }, dependencies())
    .dataSource;
}

function definition(
  kind: "text" | "select" | "relation",
  options?: readonly string[],
) {
  return createPropertyDefinition(
    source(),
    {
      name: "Field",
      kind,
      options,
      targetSourceId: kind === "relation" ? source().id : undefined,
      ...actor,
    },
    dependencies(),
  ).definition;
}

function item() {
  return createDataSourceItem(
    source(),
    { title: "Project One", ...actor },
    dependencies(),
  );
}

test("creates a bounded native source with independent revision and audit identities", () => {
  const result = createDataSource(
    { name: "  Projects  ", ...actor },
    dependencies(),
  );
  assert.equal(result.dataSource.name, "Projects");
  assert.equal(result.revision.entityType, "data-source");
  assert.equal(result.revision.entityId, result.dataSource.id);
  assert.equal(result.revision.revisionNumber, 1);
  assert.equal(result.audit.action, "data-source.created");
  assert.equal(result.audit.actorId, "will");
  assert.notEqual(result.dataSource.id, result.revision.id);
  assert.notEqual(result.revision.id, result.audit.id);
  assert.equal(result.dataSource.createdAt, at);
  assert.ok(Object.isFrozen(result.dataSource));
});

test("rejects empty and oversized source names and invalid generated IDs", () => {
  for (const name of [" ", "x".repeat(121)]) {
    assert.throws(
      () => createDataSource({ name, ...actor }, dependencies()),
      ValidationError,
    );
  }
  assert.throws(
    () =>
      createDataSource(
        { name: "Okay", ...actor },
        { newId: () => "client-id", now: () => new Date(at) },
      ),
    ValidationError,
  );
});

test("defines immutable source-scoped scalar and relation fields with native envelopes", () => {
  const dataSource = source();
  const target = createDataSource(
    { name: "People", ...actor },
    { newId: () => id(99), now: () => new Date(at) },
  ).dataSource;
  const scalar = createPropertyDefinition(
    dataSource,
    { name: "Stage", kind: "select", options: ["Open", "Done"], ...actor },
    dependencies(),
  );
  const relation = createPropertyDefinition(
    dataSource,
    { name: "Owner", kind: "relation", targetSourceId: target.id, ...actor },
    dependencies(),
  );
  assert.equal(scalar.definition.sourceId, dataSource.id);
  assert.deepEqual(scalar.definition.options, ["Open", "Done"]);
  assert.ok(Object.isFrozen(scalar.definition.options));
  assert.equal(scalar.revision.entityType, "property-definition");
  assert.equal(scalar.audit.action, "property-definition.created");
  assert.equal(relation.definition.targetSourceId, target.id);
});

test("derives one locale-independent comparison key for equivalent property names", () => {
  const dataSource = source();
  const ascii = createPropertyDefinition(
    dataSource,
    { name: "Status", kind: "text", ...actor },
    dependencies(),
  );
  const compatibilityForm = createPropertyDefinition(
    dataSource,
    { name: "ＳＴＡＴＵＳ", kind: "text", ...actor },
    dependencies(),
  );

  assert.equal(ascii.definition.nameKey, "status");
  assert.equal(compatibilityForm.definition.nameKey, "status");
  assert.equal(
    createPropertyDefinition(
      dataSource,
      { name: "İ", kind: "text", ...actor },
      dependencies(),
    ).definition.nameKey,
    "İ",
  );
});

test("rejects bad definition shapes, reserved derived fields, and unbounded options", () => {
  const dataSource = source();
  for (const command of [
    { name: "Title", kind: "text" },
    { name: "Native ID", kind: "text" },
    { name: "Stage", kind: "select", options: [] },
    { name: "Stage", kind: "select", options: ["Open", "Open"] },
    { name: "Stage", kind: "select", options: ["x".repeat(121)] },
    { name: "Owner", kind: "relation", targetSourceId: "bad-id" },
    { name: "Unknown", kind: "formula" },
  ]) {
    assert.throws(
      () =>
        createPropertyDefinition(
          dataSource,
          { ...command, ...actor } as never,
          dependencies(),
        ),
      ValidationError,
    );
  }
});

test("creates a record through the page command and starts an independent property stream", () => {
  const result = item();
  assert.equal(result.item.id, result.page.id);
  assert.equal(result.item.sourceId, source().id);
  assert.equal(result.page.title, "Project One");
  assert.equal(result.pageRevision.entityType, "page");
  assert.equal(result.pageAudit.action, "page.created");
  assert.equal(result.propertyRevision.entityType, "record-property");
  assert.equal(result.propertyRevision.entityId, result.page.id);
  assert.equal(result.propertyRevision.revisionNumber, 1);
  assert.deepEqual(result.propertyRevision.snapshot.values, {});
  assert.equal(result.propertyAudit.action, "record-property.created");
  assert.equal(result.item.createdAt, result.page.createdAt);
  assert.equal("title" in result.item, false);
});

test("sets typed scalar values with canonical representation and a property revision", () => {
  const record = item();
  const dataSource = source();
  const cases = [
    ["text", "  Hello  ", "Hello"],
    ["number", "001.2300", "1.23"],
    ["checkbox", true, true],
    ["select", "Open", "Open"],
    ["multi-select", ["Done", "Open"], ["Done", "Open"]],
    ["status", "Done", "Done"],
    ["date", "2026-09-24", "2026-09-24"],
    ["datetime", "2026-09-24T13:00:00+01:00", at],
    ["url", "https://example.com/path", "https://example.com/path"],
    ["email", "will@example.com", "will@example.com"],
    ["phone", "+44 7700 900123", "+44 7700 900123"],
  ] as const;
  for (const [kind, input, expected] of cases) {
    const options = ["select", "multi-select", "status"].includes(kind)
      ? ["Open", "Done"]
      : undefined;
    const field = createPropertyDefinition(
      dataSource,
      { name: "Field", kind, options, ...actor } as never,
      dependencies(),
    ).definition;
    const changed = setRecordProperty(
      {
        item: record.item,
        page: record.page,
        values: {},
        existingEdges: [],
        propertyRevisionNumber: 1,
        definition: field,
      },
      { value: input, expectedPropertyRevisionNumber: 1, ...actor },
      dependencies(),
    );
    assert.deepEqual(changed.values[field.id], { kind, value: expected });
    assert.equal(changed.propertyRevision.revisionNumber, 2);
    assert.equal(changed.propertyAudit.action, "record-property.updated");
    assert.equal(
      changed.propertyRevision.snapshot.values[field.id]?.kind,
      kind,
    );
  }
});

test("rejects invalid values, source mismatches, archive state, and stale revision numbers", () => {
  const record = item();
  const field = definition("select", ["Open"]);
  const context = {
    item: record.item,
    page: record.page,
    values: {},
    existingEdges: [],
    propertyRevisionNumber: 1,
    definition: field,
  };
  for (const value of ["Closed", { any: "json" }, "x".repeat(2001)]) {
    assert.throws(
      () =>
        setRecordProperty(
          context,
          { value, expectedPropertyRevisionNumber: 1, ...actor },
          dependencies(),
        ),
      ValidationError,
    );
  }
  assert.throws(
    () =>
      setRecordProperty(
        { ...context, propertyRevisionNumber: 0 },
        { value: "Open", expectedPropertyRevisionNumber: 1, ...actor },
        dependencies(),
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      setRecordProperty(
        { ...context, page: { ...record.page, archivedAt: at } },
        { value: "Open", expectedPropertyRevisionNumber: 1, ...actor },
        dependencies(),
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      setRecordProperty(
        { ...context, definition: { ...field, sourceId: id(999) } },
        { value: "Open", expectedPropertyRevisionNumber: 1, ...actor },
        dependencies(),
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      setRecordProperty(
        context,
        { value: "Open", expectedPropertyRevisionNumber: 2, ...actor },
        dependencies(),
      ),
    /stale property revision/,
  );
});

test("records immutable scalar snapshots when callers provide storage-loaded values", () => {
  const deps = dependencies();
  const dataSource = createDataSource(
    { name: "Projects", ...actor },
    deps,
  ).dataSource;
  const record = createDataSourceItem(
    dataSource,
    { title: "Project One", ...actor },
    deps,
  );
  const labels = createPropertyDefinition(
    dataSource,
    {
      name: "Labels",
      kind: "multi-select",
      options: ["Open", "Done"],
      ...actor,
    },
    deps,
  ).definition;
  const note = createPropertyDefinition(
    dataSource,
    { name: "Note", kind: "text", ...actor },
    deps,
  ).definition;
  const storageLoadedValue = {
    kind: "multi-select" as const,
    value: ["Open"] as string[],
  };
  const changed = setRecordProperty(
    {
      item: record.item,
      page: record.page,
      definition: note,
      values: { [labels.id]: storageLoadedValue },
      existingEdges: [],
      propertyRevisionNumber: 1,
    },
    { value: "Keep this", expectedPropertyRevisionNumber: 1, ...actor },
    deps,
  );

  storageLoadedValue.value.push("Done");

  const expected = { kind: "multi-select", value: ["Open"] };
  assert.deepEqual(changed.propertyAudit.before?.values[labels.id], expected);
  assert.deepEqual(changed.propertyAudit.after.values[labels.id], expected);
  assert.deepEqual(
    changed.propertyRevision.snapshot.values[labels.id],
    expected,
  );
});

test("adds and soft-archives a source-safe relation edge with property and edge history", () => {
  const sourceRecord = item();
  const targetRecord = createDataSourceItem(
    createDataSource(
      { name: "People", ...actor },
      { newId: () => id(99), now: () => new Date(at) },
    ).dataSource,
    { title: "Person", ...actor },
    { newId: () => id(50), now: () => new Date(at) },
  );
  const field = createPropertyDefinition(
    source(),
    {
      name: "Owner",
      kind: "relation",
      targetSourceId: targetRecord.item.sourceId,
      ...actor,
    },
    dependencies(),
  ).definition;
  const context = {
    sourceItem: sourceRecord.item,
    sourcePage: sourceRecord.page,
    targetItem: targetRecord.item,
    targetPage: targetRecord.page,
    definition: field,
    propertyRevisionNumber: 1,
    values: {},
    existingEdges: [],
  };
  const added = addRelationEdge(
    context,
    { expectedPropertyRevisionNumber: 1, ...actor },
    dependencies(),
  );
  assert.equal(added.edge.sourceRecordId, sourceRecord.page.id);
  assert.equal(added.edge.targetRecordId, targetRecord.page.id);
  assert.equal(added.edge.definitionId, field.id);
  assert.equal(added.edge.archivedAt, null);
  assert.equal(added.edgeRevision.entityType, "relation-edge");
  assert.equal(added.edgeAudit.action, "relation-edge.created");
  assert.equal(added.propertyRevision.revisionNumber, 2);
  const removed = removeRelationEdge(
    {
      ...context,
      existingEdges: [added.edge],
      edge: added.edge,
      edgeRevisionNumber: 1,
      propertyRevisionNumber: 2,
    },
    { expectedPropertyRevisionNumber: 2, ...actor },
    dependencies(),
  );
  assert.equal(removed.edge.archivedAt, at);
  assert.equal(removed.edgeRevision.revisionNumber, 2);
  assert.equal(removed.edgeAudit.action, "relation-edge.archived");
  assert.equal(removed.propertyRevision.revisionNumber, 3);
  assert.deepEqual(removed.propertyRevision.snapshot.relationEdgeIds, []);
});

test("removes a live edge after its target is archived but rejects an archived source", () => {
  const sourceRecord = item();
  const targetSource = createDataSource(
    { name: "People", ...actor },
    { newId: () => id(99), now: () => new Date(at) },
  ).dataSource;
  const targetRecord = createDataSourceItem(
    targetSource,
    { title: "Person", ...actor },
    { newId: () => id(50), now: () => new Date(at) },
  );
  const field = createPropertyDefinition(
    source(),
    {
      name: "Owner",
      kind: "relation",
      targetSourceId: targetSource.id,
      ...actor,
    },
    dependencies(),
  ).definition;
  const initial = {
    sourceItem: sourceRecord.item,
    sourcePage: sourceRecord.page,
    targetItem: targetRecord.item,
    targetPage: targetRecord.page,
    definition: field,
    propertyRevisionNumber: 1,
    values: {},
    existingEdges: [],
  };
  const added = addRelationEdge(
    initial,
    { expectedPropertyRevisionNumber: 1, ...actor },
    dependencies(),
  );
  const removal = {
    ...initial,
    targetPage: { ...targetRecord.page, archivedAt: at },
    existingEdges: [added.edge],
    edge: added.edge,
    edgeRevisionNumber: 1,
    propertyRevisionNumber: 2,
  };
  const command = { expectedPropertyRevisionNumber: 2, ...actor };

  const removed = removeRelationEdge(removal, command, dependencies());
  assert.equal(removed.edge.archivedAt, at);
  assert.deepEqual(removed.propertyRevision.snapshot.relationEdgeIds, []);
  assert.throws(
    () =>
      removeRelationEdge(
        { ...removal, sourcePage: { ...sourceRecord.page, archivedAt: at } },
        command,
        dependencies(),
      ),
    /record page is archived/,
  );
  assert.throws(
    () =>
      removeRelationEdge(
        {
          ...removal,
          targetPage: { ...targetRecord.page, id: id(999), archivedAt: at },
        },
        command,
        dependencies(),
      ),
    /record membership must match page identity/,
  );
  assert.throws(
    () =>
      removeRelationEdge(
        { ...removal, definition: { ...field, sourceId: id(999) } },
        command,
        dependencies(),
      ),
    /property definition belongs to another source/,
  );
});

test("rejects cross-source relation targets, duplicates, and archived pages", () => {
  const record = item();
  const field = definition("relation");
  const context = {
    sourceItem: record.item,
    sourcePage: record.page,
    targetItem: record.item,
    targetPage: record.page,
    definition: field,
    propertyRevisionNumber: 1,
    values: {},
    existingEdges: [],
  };
  const command = { expectedPropertyRevisionNumber: 1, ...actor };
  const added = addRelationEdge(context, command, dependencies());
  assert.throws(
    () =>
      addRelationEdge(
        { ...context, existingEdges: [added.edge] },
        command,
        dependencies(),
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      addRelationEdge(
        { ...context, targetItem: { ...record.item, sourceId: id(999) } },
        command,
        dependencies(),
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      addRelationEdge(
        { ...context, sourcePage: { ...record.page, archivedAt: at } },
        command,
        dependencies(),
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      addRelationEdge(
        context,
        { ...command, expectedPropertyRevisionNumber: 2 },
        dependencies(),
      ),
    /stale property revision/,
  );
  assert.throws(
    () =>
      removeRelationEdge(
        {
          ...context,
          edge: { ...added.edge, targetRecordId: id(999) },
          edgeRevisionNumber: 1,
        },
        command,
        dependencies(),
      ),
    ValidationError,
  );
});
