import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { AuditEvent, Revision } from "../../domain/src/audit.ts";
import {
  addRelationEdge,
  propertyNameKey,
  removeRelationEdge,
  setRecordProperty,
  type DataSource,
  type DataSourceDependencies,
  type DataSourceItem,
  type PropertyDefinition,
  type PropertyKind,
  type RelationEdge,
  type RelationMutationCommand,
  type ScalarPropertyValue,
  type SetRecordPropertyCommand,
} from "../../domain/src/data-source.ts";
import {
  asNativeId,
  ValidationError,
  type NativeId,
} from "../../domain/src/ids.ts";
import type { Page } from "../../domain/src/page.ts";
import type {
  CreateDefinitionMutation,
  CreateItemMutation,
  CreateSourceMutation,
  DataSourceRepository,
  PersistedDataSourceItem,
} from "./data-source-repository.ts";
import { PostgresPageRepository } from "./postgres-page-repository.ts";
import { validatePageHierarchy } from "./page-repository.ts";
import {
  auditEvents,
  dataSourceItems,
  dataSources,
  pages,
  propertyDefinitions,
  propertyValues,
  relationEdges,
  revisions,
} from "./schema.ts";
import type * as schema from "./schema.ts";

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const HIERARCHY_ADVISORY_LOCK_KEY = 1_652_046_113;

export class PostgresDataSourceRepository implements DataSourceRepository {
  readonly pages: PostgresPageRepository;

  constructor(private readonly database: Database) {
    this.pages = new PostgresPageRepository(database);
  }

  async createSource(mutation: CreateSourceMutation): Promise<DataSource> {
    return this.database.transaction(async (tx) => {
      const source = mutation.dataSource;
      await tx.insert(dataSources).values({
        id: source.id,
        name: source.name,
        createdAt: new Date(source.createdAt),
      });
      await writeHistory(tx, mutation.revision, mutation.audit);
      return source;
    });
  }

  async getSource(id: NativeId): Promise<DataSource | null> {
    const row = (
      await this.database
        .select()
        .from(dataSources)
        .where(eq(dataSources.id, id))
        .limit(1)
    )[0];
    return row ? sourceFromRow(row) : null;
  }

  async createDefinition(
    sourceId: NativeId,
    mutation: CreateDefinitionMutation,
  ): Promise<PropertyDefinition> {
    try {
      return await this.database.transaction(async (tx) => {
        const definition = mutation.definition;
        if (definition.sourceId !== sourceId)
          throw new ValidationError(
            "property definition belongs to another source",
          );
        await requireSource(tx, sourceId);
        if (definition.targetSourceId)
          await requireSource(tx, definition.targetSourceId);
        const duplicate = await tx
          .select({ id: propertyDefinitions.id })
          .from(propertyDefinitions)
          .where(
            and(
              eq(propertyDefinitions.sourceId, sourceId),
              eq(propertyDefinitions.nameKey, definition.nameKey),
            ),
          )
          .limit(1);
        if (duplicate.length)
          throw new ValidationError("property name already exists");
        await tx.insert(propertyDefinitions).values({
          id: definition.id,
          sourceId,
          name: definition.name,
          nameKey: definition.nameKey,
          kind: definition.kind,
          options: definition.options ? [...definition.options] : null,
          targetSourceId: definition.targetSourceId,
          createdAt: new Date(definition.createdAt),
        });
        await writeHistory(tx, mutation.revision, mutation.audit);
        return definition;
      });
    } catch (error) {
      if (isPropertyDefinitionNameConflict(error))
        throw new ValidationError("property name already exists");
      throw error;
    }
  }

  async listDefinitions(
    sourceId: NativeId,
  ): Promise<readonly PropertyDefinition[]> {
    const source = await this.getSource(sourceId);
    if (!source) throw new ValidationError("data source does not exist");
    const rows = await this.database
      .select()
      .from(propertyDefinitions)
      .where(eq(propertyDefinitions.sourceId, sourceId))
      .orderBy(asc(propertyDefinitions.createdAt), asc(propertyDefinitions.id));
    return rows.map(definitionFromRow);
  }

  async createItem(
    sourceId: NativeId,
    mutation: CreateItemMutation,
  ): Promise<DataSourceItem> {
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${HIERARCHY_ADVISORY_LOCK_KEY})`,
      );
      await requireSource(tx, sourceId);
      const { item, page } = mutation;
      if (item.id !== page.id || item.sourceId !== sourceId)
        throw new ValidationError(
          "record membership must match page identity and source",
        );
      if (page.archivedAt !== null)
        throw new ValidationError("record page is archived");
      const pageRows = await tx.select().from(pages);
      const existing = new Map(
        pageRows.map((row) => {
          const current = pageFromRow(row);
          return [current.id, current] as const;
        }),
      );
      if (existing.has(page.id))
        throw new ValidationError("page already exists");
      validatePageHierarchy(existing, page);
      await tx.insert(pages).values({
        id: page.id,
        parentId: page.parentId,
        title: page.title,
        archivedAt: null,
        createdAt: new Date(page.createdAt),
        updatedAt: new Date(page.modifiedAt),
        currentRevisionNumber: mutation.pageRevision.revisionNumber,
        provenance: page.provenance,
      });
      await tx.insert(dataSourceItems).values({
        id: item.id,
        sourceId: item.sourceId,
        currentPropertyRevisionNumber: 1,
        createdAt: new Date(item.createdAt),
      });
      await writeHistory(tx, mutation.pageRevision, mutation.pageAudit);
      await writeHistory(tx, mutation.propertyRevision, mutation.propertyAudit);
      return item;
    });
  }

  async getItem(recordId: NativeId): Promise<PersistedDataSourceItem | null> {
    return this.database.transaction(
      async (tx) => {
        const row = (
          await tx
            .select()
            .from(dataSourceItems)
            .where(eq(dataSourceItems.id, recordId))
            .limit(1)
        )[0];
        if (!row) return null;
        const pageRow = (
          await tx.select().from(pages).where(eq(pages.id, recordId)).limit(1)
        )[0];
        if (!pageRow) throw new Error("record membership has no page");
        if (pageRow.currentRevisionNumber < 1)
          throw new Error("page has no revision history");
        const values = await readValues(tx, recordId);
        return persistedItem(
          itemFromRow(row),
          pageFromRow(pageRow),
          values,
          row.currentPropertyRevisionNumber,
        );
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  async setProperty(
    recordId: NativeId,
    definitionId: NativeId,
    command: SetRecordPropertyCommand,
    dependencies: DataSourceDependencies,
  ): Promise<PersistedDataSourceItem> {
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${HIERARCHY_ADVISORY_LOCK_KEY})`,
      );
      const current = await requireItem(tx, recordId);
      const definition = await requireDefinition(tx, definitionId);
      const page = await requirePage(tx, recordId);
      const values = await readValues(tx, recordId);
      const edges = await readOutgoing(tx, recordId);
      const mutation = setRecordProperty(
        {
          item: current.item,
          page,
          definition,
          values,
          existingEdges: edges,
          propertyRevisionNumber: current.revisionNumber,
        },
        command,
        dependencies,
      );
      await tx
        .insert(propertyValues)
        .values({
          recordId,
          definitionId,
          value: jsonObject(mutation.values[definitionId]!),
        })
        .onConflictDoUpdate({
          target: [propertyValues.recordId, propertyValues.definitionId],
          set: { value: jsonObject(mutation.values[definitionId]!) },
        });
      await updatePropertyRevision(
        tx,
        recordId,
        current.revisionNumber,
        mutation.propertyRevision.revisionNumber,
      );
      await writeHistory(tx, mutation.propertyRevision, mutation.propertyAudit);
      return persistedItem(
        current.item,
        page,
        mutation.values,
        mutation.propertyRevision.revisionNumber,
      );
    });
  }

  async addRelation(
    sourceRecordId: NativeId,
    definitionId: NativeId,
    targetRecordId: NativeId,
    command: RelationMutationCommand,
    dependencies: DataSourceDependencies,
  ): Promise<RelationEdge> {
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${HIERARCHY_ADVISORY_LOCK_KEY})`,
      );
      const source = await requireItem(tx, sourceRecordId);
      const target = await requireItem(tx, targetRecordId);
      const definition = await requireDefinition(tx, definitionId);
      const values = await readValues(tx, sourceRecordId);
      const mutation = addRelationEdge(
        {
          sourceItem: source.item,
          sourcePage: await requirePage(tx, sourceRecordId),
          targetItem: target.item,
          targetPage: await requirePage(tx, targetRecordId),
          definition,
          values,
          existingEdges: await readOutgoing(tx, sourceRecordId),
          propertyRevisionNumber: source.revisionNumber,
        },
        command,
        dependencies,
      );
      await tx.insert(relationEdges).values({
        id: mutation.edge.id,
        sourceRecordId,
        definitionId,
        targetRecordId,
        createdAt: new Date(mutation.edge.createdAt),
        archivedAt: null,
      });
      await updatePropertyRevision(
        tx,
        sourceRecordId,
        source.revisionNumber,
        mutation.propertyRevision.revisionNumber,
      );
      await writeHistory(tx, mutation.edgeRevision, mutation.edgeAudit);
      await writeHistory(tx, mutation.propertyRevision, mutation.propertyAudit);
      return mutation.edge;
    });
  }

  async removeRelation(
    edgeId: NativeId,
    command: RelationMutationCommand,
    dependencies: DataSourceDependencies,
  ): Promise<RelationEdge> {
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${HIERARCHY_ADVISORY_LOCK_KEY})`,
      );
      const row = (
        await tx
          .select()
          .from(relationEdges)
          .where(eq(relationEdges.id, edgeId))
          .limit(1)
      )[0];
      if (!row) throw new ValidationError("relation edge does not exist");
      const edge = edgeFromRow(row);
      const source = await requireItem(tx, edge.sourceRecordId);
      const target = await requireItem(tx, edge.targetRecordId);
      const edgeRevisions = await tx
        .select({ revisionNumber: revisions.revisionNumber })
        .from(revisions)
        .where(
          and(
            eq(revisions.entityType, "relation-edge"),
            eq(revisions.entityId, edgeId),
          ),
        )
        .orderBy(asc(revisions.revisionNumber));
      const mutation = removeRelationEdge(
        {
          sourceItem: source.item,
          sourcePage: await requirePage(tx, source.item.id),
          targetItem: target.item,
          targetPage: await requirePage(tx, target.item.id),
          definition: await requireDefinition(tx, edge.definitionId),
          values: await readValues(tx, source.item.id),
          existingEdges: await readOutgoing(tx, source.item.id),
          propertyRevisionNumber: source.revisionNumber,
          edge,
          edgeRevisionNumber: edgeRevisions.at(-1)?.revisionNumber ?? 0,
        },
        command,
        dependencies,
      );
      await tx
        .update(relationEdges)
        .set({ archivedAt: new Date(mutation.edge.archivedAt!) })
        .where(eq(relationEdges.id, edgeId));
      await updatePropertyRevision(
        tx,
        source.item.id,
        source.revisionNumber,
        mutation.propertyRevision.revisionNumber,
      );
      await writeHistory(tx, mutation.edgeRevision, mutation.edgeAudit);
      await writeHistory(tx, mutation.propertyRevision, mutation.propertyAudit);
      return mutation.edge;
    });
  }

  async outgoingRelations(
    recordId: NativeId,
  ): Promise<readonly RelationEdge[]> {
    await requireItem(this.database, recordId);
    return (
      await this.database
        .select()
        .from(relationEdges)
        .where(
          and(
            eq(relationEdges.sourceRecordId, recordId),
            isNull(relationEdges.archivedAt),
          ),
        )
    ).map(edgeFromRow);
  }

  async incomingRelations(
    recordId: NativeId,
  ): Promise<readonly RelationEdge[]> {
    await requireItem(this.database, recordId);
    return (
      await this.database
        .select()
        .from(relationEdges)
        .where(
          and(
            eq(relationEdges.targetRecordId, recordId),
            isNull(relationEdges.archivedAt),
          ),
        )
    ).map(edgeFromRow);
  }
}

async function requireSource(
  db: Database | Transaction,
  id: NativeId,
): Promise<DataSource> {
  const row = (
    await db.select().from(dataSources).where(eq(dataSources.id, id)).limit(1)
  )[0];
  if (!row) throw new ValidationError("data source does not exist");
  return sourceFromRow(row);
}

async function requireDefinition(
  db: Database | Transaction,
  id: NativeId,
): Promise<PropertyDefinition> {
  const row = (
    await db
      .select()
      .from(propertyDefinitions)
      .where(eq(propertyDefinitions.id, id))
      .limit(1)
  )[0];
  if (!row) throw new ValidationError("property definition does not exist");
  return definitionFromRow(row);
}

async function requireItem(
  db: Database | Transaction,
  id: NativeId,
): Promise<{ item: DataSourceItem; revisionNumber: number }> {
  const row = (
    await db
      .select()
      .from(dataSourceItems)
      .where(eq(dataSourceItems.id, id))
      .for("update")
      .limit(1)
  )[0];
  if (!row) throw new ValidationError("record does not exist");
  return {
    item: itemFromRow(row),
    revisionNumber: row.currentPropertyRevisionNumber,
  };
}

async function requirePage(
  db: Database | Transaction,
  id: NativeId,
): Promise<Page> {
  const row = (
    await db.select().from(pages).where(eq(pages.id, id)).limit(1)
  )[0];
  if (!row) throw new ValidationError("record page does not exist");
  return pageFromRow(row);
}

async function readValues(
  db: Database | Transaction,
  id: NativeId,
): Promise<Readonly<Record<string, ScalarPropertyValue>>> {
  const rows = await db
    .select()
    .from(propertyValues)
    .where(eq(propertyValues.recordId, id));
  const values: Record<string, ScalarPropertyValue> = {};
  for (const row of rows) values[row.definitionId] = scalarFromJson(row.value);
  return Object.freeze(values);
}

async function readOutgoing(
  db: Database | Transaction,
  id: NativeId,
): Promise<RelationEdge[]> {
  return (
    await db
      .select()
      .from(relationEdges)
      .where(
        and(
          eq(relationEdges.sourceRecordId, id),
          isNull(relationEdges.archivedAt),
        ),
      )
  ).map(edgeFromRow);
}

async function updatePropertyRevision(
  tx: Transaction,
  id: NativeId,
  previous: number,
  next: number,
): Promise<void> {
  const changed = await tx
    .update(dataSourceItems)
    .set({ currentPropertyRevisionNumber: next })
    .where(
      and(
        eq(dataSourceItems.id, id),
        eq(dataSourceItems.currentPropertyRevisionNumber, previous),
      ),
    )
    .returning({ id: dataSourceItems.id });
  if (changed.length !== 1)
    throw new ValidationError("stale property revision");
}

async function writeHistory(
  tx: Transaction,
  revision: Revision<unknown>,
  audit: AuditEvent<unknown>,
): Promise<void> {
  await tx.insert(revisions).values({
    id: revision.id,
    entityType: revision.entityType,
    entityId: revision.entityId,
    revisionNumber: revision.revisionNumber,
    snapshot: jsonObject(revision.snapshot),
    createdAt: new Date(revision.createdAt),
  });
  await tx.insert(auditEvents).values({
    id: audit.id,
    occurredAt: new Date(audit.timestamp),
    actorType: audit.actorType,
    actorId: audit.actorId,
    action: audit.action,
    targetType: audit.targetType,
    targetId: audit.targetId,
    requestId: audit.requestId ?? null,
    idempotencyKey: audit.idempotencyKey ?? null,
    source: audit.source,
    reason: audit.reason ?? null,
    before: audit.before === null ? null : jsonObject(audit.before),
    after: jsonObject(audit.after),
    metadata: audit.metadata ? jsonObject(audit.metadata) : null,
  });
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError("history snapshot must be an object");
  return { ...value };
}

function scalarFromJson(value: Record<string, unknown>): ScalarPropertyValue {
  if (value.kind === "checkbox" && typeof value.value === "boolean")
    return Object.freeze({ kind: "checkbox", value: value.value });
  if (
    value.kind === "multi-select" &&
    Array.isArray(value.value) &&
    value.value.every((entry) => typeof entry === "string")
  )
    return Object.freeze({
      kind: "multi-select",
      value: Object.freeze([...value.value]),
    });
  if (
    typeof value.kind === "string" &&
    typeof value.value === "string" &&
    [
      "text",
      "number",
      "select",
      "status",
      "date",
      "datetime",
      "url",
      "email",
      "phone",
    ].includes(value.kind)
  )
    return Object.freeze({
      kind: value.kind as Exclude<
        PropertyKind,
        "relation" | "checkbox" | "multi-select"
      >,
      value: value.value,
    });
  throw new ValidationError("stored scalar property value is invalid");
}

function sourceFromRow(row: typeof dataSources.$inferSelect): DataSource {
  return Object.freeze({
    id: asNativeId(row.id),
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  });
}

function definitionFromRow(
  row: typeof propertyDefinitions.$inferSelect,
): PropertyDefinition {
  const kind = propertyKindFromStorage(row.kind);
  const options = propertyOptionsFromStorage(kind, row.options);
  const targetSourceId = row.targetSourceId
    ? asNativeId(row.targetSourceId)
    : null;
  if ((kind === "relation") !== (targetSourceId !== null))
    throw new ValidationError("stored property definition is invalid");
  if (row.nameKey !== propertyNameKey(row.name))
    throw new ValidationError("stored property definition is invalid");
  return Object.freeze({
    id: asNativeId(row.id),
    sourceId: asNativeId(row.sourceId),
    name: row.name,
    nameKey: row.nameKey,
    kind,
    options,
    targetSourceId,
    createdAt: row.createdAt.toISOString(),
  });
}

function propertyKindFromStorage(value: string): PropertyKind {
  if (
    [
      "text",
      "number",
      "checkbox",
      "select",
      "multi-select",
      "status",
      "date",
      "datetime",
      "url",
      "email",
      "phone",
      "relation",
    ].includes(value)
  )
    return value as PropertyKind;
  throw new ValidationError("stored property definition is invalid");
}

function propertyOptionsFromStorage(
  kind: PropertyKind,
  value: unknown,
): readonly string[] | null {
  const optionKind =
    kind === "select" || kind === "multi-select" || kind === "status";
  if (!optionKind) {
    if (value !== null)
      throw new ValidationError("stored property definition is invalid");
    return null;
  }
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 100 ||
    !value.every((option) => typeof option === "string")
  )
    throw new ValidationError("stored property definition is invalid");
  return Object.freeze([...value]);
}

function isPropertyDefinitionNameConflict(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "property_definitions_source_name_key_unique"
  )
    return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    isPropertyDefinitionNameConflict(error.cause)
  );
}

function itemFromRow(row: typeof dataSourceItems.$inferSelect): DataSourceItem {
  return Object.freeze({
    id: asNativeId(row.id),
    sourceId: asNativeId(row.sourceId),
    createdAt: row.createdAt.toISOString(),
  });
}

function edgeFromRow(row: typeof relationEdges.$inferSelect): RelationEdge {
  return Object.freeze({
    id: asNativeId(row.id),
    sourceRecordId: asNativeId(row.sourceRecordId),
    definitionId: asNativeId(row.definitionId),
    targetRecordId: asNativeId(row.targetRecordId),
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  });
}

function pageFromRow(row: typeof pages.$inferSelect): Page {
  const source = row.provenance.source;
  const actorId = row.provenance.actorId;
  if (!source || !actorId) throw new Error("page provenance is incomplete");
  return Object.freeze({
    id: asNativeId(row.id),
    parentId: row.parentId ? asNativeId(row.parentId) : null,
    title: row.title,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    modifiedAt: row.updatedAt.toISOString(),
    provenance: Object.freeze({ source, actorId }),
  });
}

function persistedItem(
  item: DataSourceItem,
  page: Page,
  values: Readonly<Record<string, ScalarPropertyValue>>,
  propertyRevisionNumber: number,
): PersistedDataSourceItem {
  return Object.freeze({ item, page, values, propertyRevisionNumber });
}
