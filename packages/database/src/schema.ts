import {
  type AnyPgColumn,
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull();

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
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
    provenance: jsonb("provenance").$type<Record<string, string>>().notNull(),
  },
  (table) => [index("pages_parent_id_idx").on(table.parentId)],
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
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("blocks_page_id_position_idx").on(table.pageId, table.position),
    index("blocks_parent_block_id_idx").on(table.parentBlockId),
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
