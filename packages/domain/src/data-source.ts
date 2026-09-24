import type {
  AuditActorType,
  AuditAction,
  AuditEvent,
  NativeEntityType,
  Revision,
} from "./audit.ts";
import { asNativeId, type NativeId, ValidationError } from "./ids.ts";
import { createPage, type CreatePageDependencies, type Page } from "./page.ts";

export interface DataSourceAuditContext {
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
}

export type DataSourceDependencies = CreatePageDependencies;

export interface DataSource {
  readonly id: NativeId;
  readonly name: string;
  readonly createdAt: string;
}

export type ScalarPropertyKind =
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "multi-select"
  | "status"
  | "date"
  | "datetime"
  | "url"
  | "email"
  | "phone";
export type PropertyKind = ScalarPropertyKind | "relation";

export interface PropertyDefinition {
  readonly id: NativeId;
  readonly sourceId: NativeId;
  readonly name: string;
  readonly nameKey: string;
  readonly kind: PropertyKind;
  readonly options: readonly string[] | null;
  readonly targetSourceId: NativeId | null;
  readonly createdAt: string;
}

export function propertyNameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase();
}

export interface DataSourceItem {
  readonly id: NativeId;
  readonly sourceId: NativeId;
  readonly createdAt: string;
}

export type ScalarPropertyValue =
  | Readonly<{ kind: "checkbox"; value: boolean }>
  | Readonly<{ kind: "multi-select"; value: readonly string[] }>
  | Readonly<{
      kind: Exclude<ScalarPropertyKind, "checkbox" | "multi-select">;
      value: string;
    }>;

export interface RecordPropertySnapshot {
  readonly recordId: NativeId;
  readonly sourceId: NativeId;
  readonly values: Readonly<Record<string, ScalarPropertyValue>>;
  readonly relationEdgeIds: readonly NativeId[];
}

export interface RelationEdge {
  readonly id: NativeId;
  readonly sourceRecordId: NativeId;
  readonly definitionId: NativeId;
  readonly targetRecordId: NativeId;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface CreateDataSourceCommand extends DataSourceAuditContext {
  readonly name: string;
}

export interface CreatePropertyDefinitionCommand extends DataSourceAuditContext {
  readonly name: string;
  readonly kind: PropertyKind;
  readonly options?: readonly string[] | undefined;
  readonly targetSourceId?: NativeId | undefined;
}

export interface CreateDataSourceItemCommand extends DataSourceAuditContext {
  readonly title: string;
  readonly parentId?: NativeId | null;
}

export interface SetRecordPropertyContext {
  readonly item: DataSourceItem;
  readonly page: Page;
  readonly definition: PropertyDefinition;
  readonly values: Readonly<Record<string, ScalarPropertyValue>>;
  readonly existingEdges: readonly RelationEdge[];
  readonly propertyRevisionNumber: number;
}

export interface SetRecordPropertyCommand extends DataSourceAuditContext {
  readonly value: unknown;
  readonly expectedPropertyRevisionNumber: number;
}

export interface RelationMutationCommand extends DataSourceAuditContext {
  readonly expectedPropertyRevisionNumber: number;
}

export interface RelationContext {
  readonly sourceItem: DataSourceItem;
  readonly sourcePage: Page;
  readonly targetItem: DataSourceItem;
  readonly targetPage: Page;
  readonly definition: PropertyDefinition;
  readonly values: Readonly<Record<string, ScalarPropertyValue>>;
  readonly existingEdges: readonly RelationEdge[];
  readonly propertyRevisionNumber: number;
}

export interface RemoveRelationContext extends RelationContext {
  readonly edge: RelationEdge;
  readonly edgeRevisionNumber: number;
}

export function createDataSource(
  command: CreateDataSourceCommand,
  dependencies: DataSourceDependencies,
) {
  const context = validateAuditContext(command);
  const name = boundedString(command.name, "data source name", 120);
  const id = asNativeId(dependencies.newId());
  const timestamp = dependencies.now().toISOString();
  const dataSource: DataSource = Object.freeze({
    id,
    name,
    createdAt: timestamp,
  });
  return Object.freeze({
    dataSource,
    revision: makeRevision(
      dataSource,
      "data-source",
      id,
      1,
      timestamp,
      dependencies,
    ),
    audit: makeAudit(
      null,
      dataSource,
      "data-source",
      id,
      "data-source.created",
      context,
      timestamp,
      dependencies,
    ),
  });
}

export function createPropertyDefinition(
  source: DataSource,
  command: CreatePropertyDefinitionCommand,
  dependencies: DataSourceDependencies,
) {
  const context = validateAuditContext(command);
  asNativeId(source.id);
  const name = boundedString(command.name, "property name", 120);
  const nameKey = propertyNameKey(name);
  if (
    [
      "title",
      "native id",
      "id",
      "created",
      "created time",
      "updated",
      "updated time",
    ].includes(nameKey.replace(/\s+/g, " "))
  ) {
    throw new ValidationError(
      "derived page fields cannot be property definitions",
    );
  }
  const kind = validateKind(command.kind);
  const optionKind =
    kind === "select" || kind === "multi-select" || kind === "status";
  let options: readonly string[] | null = null;
  if (optionKind) {
    if (
      !Array.isArray(command.options) ||
      command.options.length < 1 ||
      command.options.length > 100
    ) {
      throw new ValidationError(
        "select and status properties need 1 to 100 options",
      );
    }
    const normalized = command.options.map((option) =>
      boundedString(option, "option", 120),
    );
    if (
      new Set(normalized.map((option) => option.toLowerCase())).size !==
      normalized.length
    ) {
      throw new ValidationError("property options must be unique");
    }
    options = Object.freeze(normalized);
  } else if (command.options !== undefined) {
    throw new ValidationError(
      "options are only supported for select and status properties",
    );
  }
  let targetSourceId: NativeId | null = null;
  if (kind === "relation") {
    if (!command.targetSourceId)
      throw new ValidationError("relation target source is required");
    targetSourceId = asNativeId(command.targetSourceId);
  } else if (command.targetSourceId !== undefined) {
    throw new ValidationError("target source is only supported for relations");
  }
  const id = asNativeId(dependencies.newId());
  const timestamp = dependencies.now().toISOString();
  const definition: PropertyDefinition = Object.freeze({
    id,
    sourceId: source.id,
    name,
    nameKey,
    kind,
    options,
    targetSourceId,
    createdAt: timestamp,
  });
  return Object.freeze({
    definition,
    revision: makeRevision(
      definition,
      "property-definition",
      id,
      1,
      timestamp,
      dependencies,
    ),
    audit: makeAudit(
      null,
      definition,
      "property-definition",
      id,
      "property-definition.created",
      context,
      timestamp,
      dependencies,
    ),
  });
}

export function createDataSourceItem(
  source: DataSource,
  command: CreateDataSourceItemCommand,
  dependencies: DataSourceDependencies,
) {
  const context = validateAuditContext(command);
  asNativeId(source.id);
  const title = boundedString(command.title, "record title", 200);
  const pageMutation = createPage(
    {
      title,
      ...(command.parentId === undefined ? {} : { parentId: command.parentId }),
      ...context,
    },
    dependencies,
  );
  const item: DataSourceItem = Object.freeze({
    id: pageMutation.page.id,
    sourceId: source.id,
    createdAt: pageMutation.page.createdAt,
  });
  const snapshot = makeSnapshot(item, {}, []);
  return Object.freeze({
    page: pageMutation.page,
    pageRevision: pageMutation.revision,
    pageAudit: pageMutation.audit,
    item,
    propertyRevision: makeRevision(
      snapshot,
      "record-property",
      item.id,
      1,
      item.createdAt,
      dependencies,
    ),
    propertyAudit: makeAudit(
      null,
      snapshot,
      "record-property",
      item.id,
      "record-property.created",
      context,
      item.createdAt,
      dependencies,
    ),
  });
}

export function setRecordProperty(
  current: SetRecordPropertyContext,
  command: SetRecordPropertyCommand,
  dependencies: DataSourceDependencies,
) {
  const context = validateAuditContext(command);
  validateRecord(current.item, current.page);
  validateDefinitionOwner(current.definition, current.item);
  validateRevision(current.propertyRevisionNumber);
  assertExpectedRevision(
    current.propertyRevisionNumber,
    command.expectedPropertyRevisionNumber,
  );
  if (current.definition.kind === "relation")
    throw new ValidationError("relation values use relation edges");
  const value = normalizeScalarValue(current.definition, command.value);
  const before = makeSnapshot(
    current.item,
    current.values,
    current.existingEdges,
  );
  const values = Object.freeze({
    ...before.values,
    [current.definition.id]: value,
  });
  const after = makeSnapshot(current.item, values, current.existingEdges);
  const timestamp = dependencies.now().toISOString();
  return Object.freeze({
    values,
    propertyRevision: makeRevision(
      after,
      "record-property",
      current.item.id,
      current.propertyRevisionNumber + 1,
      timestamp,
      dependencies,
    ),
    propertyAudit: makeAudit(
      before,
      after,
      "record-property",
      current.item.id,
      "record-property.updated",
      context,
      timestamp,
      dependencies,
    ),
  });
}

export function addRelationEdge(
  current: RelationContext,
  command: RelationMutationCommand,
  dependencies: DataSourceDependencies,
) {
  const context = validateAuditContext(command);
  validateRelationContext(current);
  assertExpectedRevision(
    current.propertyRevisionNumber,
    command.expectedPropertyRevisionNumber,
  );
  const duplicate = current.existingEdges.some(
    (edge) =>
      edge.archivedAt === null &&
      edge.sourceRecordId === current.sourceItem.id &&
      edge.definitionId === current.definition.id &&
      edge.targetRecordId === current.targetItem.id,
  );
  if (duplicate) throw new ValidationError("relation edge already exists");
  const before = makeSnapshot(
    current.sourceItem,
    current.values,
    current.existingEdges,
  );
  const timestamp = dependencies.now().toISOString();
  const edge: RelationEdge = Object.freeze({
    id: asNativeId(dependencies.newId()),
    sourceRecordId: current.sourceItem.id,
    definitionId: current.definition.id,
    targetRecordId: current.targetItem.id,
    createdAt: timestamp,
    archivedAt: null,
  });
  const after = makeSnapshot(current.sourceItem, current.values, [
    ...current.existingEdges,
    edge,
  ]);
  return Object.freeze({
    edge,
    edgeRevision: makeRevision(
      edge,
      "relation-edge",
      edge.id,
      1,
      timestamp,
      dependencies,
    ),
    edgeAudit: makeAudit(
      null,
      edge,
      "relation-edge",
      edge.id,
      "relation-edge.created",
      context,
      timestamp,
      dependencies,
    ),
    propertyRevision: makeRevision(
      after,
      "record-property",
      current.sourceItem.id,
      current.propertyRevisionNumber + 1,
      timestamp,
      dependencies,
    ),
    propertyAudit: makeAudit(
      before,
      after,
      "record-property",
      current.sourceItem.id,
      "record-property.updated",
      context,
      timestamp,
      dependencies,
    ),
  });
}

export function removeRelationEdge(
  current: RemoveRelationContext,
  command: RelationMutationCommand,
  dependencies: DataSourceDependencies,
) {
  const context = validateAuditContext(command);
  validateRelationContext(current, true);
  assertExpectedRevision(
    current.propertyRevisionNumber,
    command.expectedPropertyRevisionNumber,
  );
  validateRevision(current.edgeRevisionNumber);
  const edge = current.edge;
  if (
    edge.archivedAt !== null ||
    edge.sourceRecordId !== current.sourceItem.id ||
    edge.definitionId !== current.definition.id ||
    edge.targetRecordId !== current.targetItem.id
  ) {
    throw new ValidationError("relation edge does not match the live relation");
  }
  if (
    !current.existingEdges.some(
      (candidate) => candidate.id === edge.id && candidate.archivedAt === null,
    )
  ) {
    throw new ValidationError("relation edge is not in the current record");
  }
  const before = makeSnapshot(
    current.sourceItem,
    current.values,
    current.existingEdges,
  );
  const timestamp = dependencies.now().toISOString();
  const archived: RelationEdge = Object.freeze({
    ...edge,
    archivedAt: timestamp,
  });
  const after = makeSnapshot(
    current.sourceItem,
    current.values,
    current.existingEdges.map((candidate) =>
      candidate.id === edge.id ? archived : candidate,
    ),
  );
  return Object.freeze({
    edge: archived,
    edgeRevision: makeRevision(
      archived,
      "relation-edge",
      edge.id,
      current.edgeRevisionNumber + 1,
      timestamp,
      dependencies,
    ),
    edgeAudit: makeAudit(
      edge,
      archived,
      "relation-edge",
      edge.id,
      "relation-edge.archived",
      context,
      timestamp,
      dependencies,
    ),
    propertyRevision: makeRevision(
      after,
      "record-property",
      current.sourceItem.id,
      current.propertyRevisionNumber + 1,
      timestamp,
      dependencies,
    ),
    propertyAudit: makeAudit(
      before,
      after,
      "record-property",
      current.sourceItem.id,
      "record-property.updated",
      context,
      timestamp,
      dependencies,
    ),
  });
}

function validateAuditContext(
  context: DataSourceAuditContext,
): DataSourceAuditContext {
  if (!["user", "api-token", "importer", "system"].includes(context.actorType))
    throw new ValidationError("actor type is not supported");
  return {
    actorType: context.actorType,
    actorId: boundedString(context.actorId, "actor ID", 200),
    source: boundedString(context.source, "source", 200),
  };
}

function boundedString(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string")
    throw new ValidationError(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > limit)
    throw new ValidationError(`${label} must have 1 to ${limit} characters`);
  return normalized;
}

function validateKind(value: unknown): PropertyKind {
  if (
    typeof value !== "string" ||
    ![
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
  ) {
    throw new ValidationError("property kind is not supported");
  }
  return value as PropertyKind;
}

function validateRecord(item: DataSourceItem, page: Page): void {
  validateRecordIdentity(item, page);
  if (page.archivedAt !== null)
    throw new ValidationError("record page is archived");
}

function validateRecordIdentity(item: DataSourceItem, page: Page): void {
  asNativeId(item.id);
  asNativeId(item.sourceId);
  asNativeId(page.id);
  if (item.id !== page.id)
    throw new ValidationError("record membership must match page identity");
}

function validateDefinitionOwner(
  definition: PropertyDefinition,
  item: DataSourceItem,
): void {
  asNativeId(definition.id);
  asNativeId(definition.sourceId);
  if (definition.sourceId !== item.sourceId)
    throw new ValidationError("property definition belongs to another source");
}

function validateRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ValidationError(
      "current revision number must be a positive integer",
    );
}

function assertExpectedRevision(current: number, expected: number): void {
  validateRevision(expected);
  if (current !== expected)
    throw new ValidationError("stale property revision");
}

function validateRelationContext(
  current: RelationContext,
  allowArchivedTarget = false,
): void {
  validateRecord(current.sourceItem, current.sourcePage);
  if (allowArchivedTarget) {
    validateRecordIdentity(current.targetItem, current.targetPage);
  } else {
    validateRecord(current.targetItem, current.targetPage);
  }
  validateDefinitionOwner(current.definition, current.sourceItem);
  validateRevision(current.propertyRevisionNumber);
  if (
    current.definition.kind !== "relation" ||
    current.definition.targetSourceId !== current.targetItem.sourceId
  ) {
    throw new ValidationError(
      "relation target source does not match definition",
    );
  }
}

function normalizeScalarValue(
  definition: PropertyDefinition,
  input: unknown,
): ScalarPropertyValue {
  const kind = definition.kind;
  if (kind === "checkbox") {
    if (typeof input !== "boolean")
      throw new ValidationError("checkbox value must be boolean");
    return Object.freeze({ kind, value: input });
  }
  if (kind === "multi-select") {
    if (
      !Array.isArray(input) ||
      input.length > 100 ||
      input.some(
        (value) =>
          typeof value !== "string" || !definition.options?.includes(value),
      )
    ) {
      throw new ValidationError(
        "multi-select values must belong to the property options",
      );
    }
    if (new Set(input).size !== input.length)
      throw new ValidationError("multi-select values must be unique");
    return Object.freeze({ kind, value: Object.freeze([...input]) });
  }
  if (kind === "relation")
    throw new ValidationError("relation values use relation edges");
  const value = boundedString(
    input,
    `${kind} value`,
    kind === "email"
      ? 254
      : kind === "phone"
        ? 80
        : kind === "url"
          ? 2048
          : 2000,
  );
  if (
    (kind === "select" || kind === "status") &&
    !definition.options?.includes(value)
  )
    throw new ValidationError("value must belong to the property options");
  if (kind === "number") {
    const match = /^([+-]?)(\d{1,18})(?:\.(\d{1,12}))?$/.exec(value);
    if (!match)
      throw new ValidationError("number must be a finite decimal string");
    const whole = match[2]!.replace(/^0+(?=\d)/, "");
    const fraction = (match[3] ?? "").replace(/0+$/, "");
    const decimal = `${whole}${fraction ? `.${fraction}` : ""}`;
    return Object.freeze({
      kind,
      value: decimal === "0" ? "0" : `${match[1] === "-" ? "-" : ""}${decimal}`,
    });
  }
  if (kind === "date" && !validDate(value))
    throw new ValidationError("date must be a real ISO calendar date");
  if (kind === "datetime") {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) ||
      !validDate(value.slice(0, 10))
    ) {
      throw new ValidationError(
        "datetime must include a valid date and timezone",
      );
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationError("datetime is invalid");
    return Object.freeze({ kind, value: date.toISOString() });
  }
  if (kind === "url") {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ValidationError("URL is invalid");
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new ValidationError("URL must use HTTP(S) without credentials");
  }
  if (kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new ValidationError("email is invalid");
  if (
    kind === "phone" &&
    (!/^\+?[0-9 ()-]+$/.test(value) ||
      (value.match(/\d/g) ?? []).length < 3 ||
      (value.match(/\d/g) ?? []).length > 20)
  ) {
    throw new ValidationError("phone is invalid");
  }
  return Object.freeze({ kind, value });
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().startsWith(`${value}T`)
  );
}

function makeSnapshot(
  item: DataSourceItem,
  values: Readonly<Record<string, ScalarPropertyValue>>,
  edges: readonly RelationEdge[],
): RecordPropertySnapshot {
  const copied: Record<string, ScalarPropertyValue> = {};
  for (const [key, value] of Object.entries(values)) {
    asNativeId(key);
    copied[key] = copyScalarPropertyValue(value);
  }
  const relationEdgeIds = edges
    .filter(
      (edge) => edge.sourceRecordId === item.id && edge.archivedAt === null,
    )
    .map((edge) => asNativeId(edge.id));
  return Object.freeze({
    recordId: item.id,
    sourceId: item.sourceId,
    values: Object.freeze(copied),
    relationEdgeIds: Object.freeze([...new Set(relationEdgeIds)].sort()),
  });
}

function copyScalarPropertyValue(
  value: ScalarPropertyValue,
): ScalarPropertyValue {
  if (value.kind === "checkbox") {
    return Object.freeze({ kind: value.kind, value: value.value });
  }
  if (value.kind === "multi-select") {
    return Object.freeze({
      kind: value.kind,
      value: Object.freeze([...value.value]),
    });
  }
  return Object.freeze({ kind: value.kind, value: value.value });
}

function makeRevision<T, E extends NativeEntityType>(
  snapshot: T,
  entityType: E,
  entityId: NativeId,
  revisionNumber: number,
  timestamp: string,
  dependencies: DataSourceDependencies,
): Revision<T, E> {
  return Object.freeze({
    id: asNativeId(dependencies.newId()),
    entityType,
    entityId,
    revisionNumber,
    createdAt: timestamp,
    snapshot,
  });
}

function makeAudit<T, E extends NativeEntityType, A extends AuditAction>(
  before: T | null,
  after: T,
  targetType: E,
  targetId: NativeId,
  action: A,
  context: DataSourceAuditContext,
  timestamp: string,
  dependencies: DataSourceDependencies,
): AuditEvent<T, E, A> {
  return Object.freeze({
    id: asNativeId(dependencies.newId()),
    timestamp,
    actorType: context.actorType,
    actorId: context.actorId,
    action,
    targetType,
    targetId,
    source: context.source,
    before,
    after,
  });
}
