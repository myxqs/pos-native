import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull();

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  ownerSlot: integer("owner_slot").notNull().default(1).unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    csrfTokenHash: text("csrf_token_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    label: text("label").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("api_tokens_user_id_idx").on(table.userId)],
);

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  createdAt: createdAt(),
  provenance: jsonb("provenance").$type<Record<string, string>>().notNull(),
});

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey(),
    parentId: uuid("parent_id").references((): AnyPgColumn => pages.id),
    title: text("title").notNull(),
    icon: text("icon"),
    coverAssetId: uuid("cover_asset_id").references(() => assets.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    currentRevisionNumber: integer("current_revision_number")
      .notNull()
      .default(0),
    currentBlockDocumentRevisionNumber: integer(
      "current_block_document_revision_number",
    )
      .notNull()
      .default(0),
    provenance: jsonb("provenance").$type<Record<string, string>>().notNull(),
  },
  (table) => [index("pages_parent_id_idx").on(table.parentId)],
);

export const pageAssetLinks = pgTable(
  "page_asset_links",
  {
    id: uuid("id").primaryKey(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    createdAt: createdAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    provenance: jsonb("provenance").$type<Record<string, string>>().notNull(),
  },
  (table) => [
    uniqueIndex("page_asset_links_live_unique")
      .on(table.pageId, table.assetId)
      .where(sql`"archived_at" is null`),
    index("page_asset_links_page_created_idx").on(
      table.pageId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const propertyDefinitions = pgTable(
  "property_definitions",
  {
    id: uuid("id").primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    kind: text("kind").notNull(),
    options: jsonb("options").$type<string[]>(),
    targetSourceId: uuid("target_source_id").references(() => dataSources.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("property_definitions_source_name_key_unique").on(
      table.sourceId,
      table.nameKey,
    ),
    check(
      "property_definitions_kind_supported",
      sql.raw(
        `"kind" in ('text', 'number', 'checkbox', 'select', 'multi-select', 'status', 'date', 'datetime', 'url', 'email', 'phone', 'relation')`,
      ),
    ),
    check(
      "property_definitions_shape_valid",
      sql.raw(
        `("kind" = 'relation' and "target_source_id" is not null and "options" is null) or ("kind" in ('select', 'multi-select', 'status') and "target_source_id" is null and "options" is not null) or ("kind" in ('text', 'number', 'checkbox', 'date', 'datetime', 'url', 'email', 'phone') and "target_source_id" is null and "options" is null)`,
      ),
    ),
  ],
);

export const dataSourceItems = pgTable(
  "data_source_items",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => pages.id),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id),
    currentPropertyRevisionNumber: integer("current_property_revision_number")
      .notNull()
      .default(1),
    createdAt: createdAt(),
  },
  (table) => [
    index("data_source_items_source_id_idx").on(table.sourceId),
    check(
      "data_source_items_property_revision_positive",
      sql.raw('"current_property_revision_number" >= 1'),
    ),
  ],
);

export const propertyValues = pgTable(
  "property_values",
  {
    recordId: uuid("record_id")
      .notNull()
      .references(() => dataSourceItems.id),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => propertyDefinitions.id),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.recordId, table.definitionId] })],
);

export const relationEdges = pgTable(
  "relation_edges",
  {
    id: uuid("id").primaryKey(),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => dataSourceItems.id),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => propertyDefinitions.id),
    targetRecordId: uuid("target_record_id")
      .notNull()
      .references(() => dataSourceItems.id),
    createdAt: createdAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("relation_edges_target_record_id_idx").on(table.targetRecordId),
    uniqueIndex("relation_edges_live_unique")
      .on(table.sourceRecordId, table.definitionId, table.targetRecordId)
      .where(sql`"archived_at" is null`),
  ],
);

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id),
    parentBlockId: uuid("parent_block_id").references(
      (): AnyPgColumn => blocks.id,
    ),
    blockType: text("block_type").notNull(),
    position: integer("position").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("blocks_page_id_position_idx").on(table.pageId, table.position),
    index("blocks_parent_block_id_idx").on(table.parentBlockId),
    check("blocks_position_nonnegative", sql.raw('"position" >= 0')),
    unique("blocks_id_page_unique").on(table.id, table.pageId),
    foreignKey({
      name: "blocks_parent_block_page_fk",
      columns: [table.parentBlockId, table.pageId],
      foreignColumns: [table.id, table.pageId],
    }),
    uniqueIndex("blocks_live_sibling_position_unique")
      .on(
        table.pageId,
        sql.raw(
          "coalesce(\"parent_block_id\", '00000000-0000-0000-0000-000000000000'::uuid)",
        ),
        table.position,
      )
      .where(sql.raw('"archived_at" is null')),
  ],
);

export const revisions = pgTable(
  "revisions",
  {
    id: uuid("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("revisions_entity_revision_unique").on(
      table.entityType,
      table.entityId,
      table.revisionNumber,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    requestId: uuid("request_id"),
    idempotencyKey: text("idempotency_key"),
    source: text("source").notNull(),
    reason: text("reason"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("audit_events_target_idx").on(table.targetType, table.targetId),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("idempotency_actor_operation_key_unique").on(
      table.actorId,
      table.operation,
      table.idempotencyKey,
    ),
  ],
);

export const externalIdentities = pgTable(
  "external_identities",
  {
    id: uuid("id").primaryKey(),
    nativeEntityId: uuid("native_entity_id").notNull(),
    nativeEntityType: text("native_entity_type").notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("external_identities_provider_external_unique").on(
      table.provider,
      table.externalId,
    ),
  ],
);
