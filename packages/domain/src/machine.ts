import type {
  DataSource,
  PropertyDefinition,
  PropertyKind,
} from "./data-source.ts";

export type MachineCapability =
  | "schema.describe"
  | "entity.get"
  | "entity.query"
  | "relation.traverse"
  | "context.get"
  | "history.get"
  | "property.set"
  | "relation.add"
  | "relation.remove"
  | "entity.update-title"
  | "entity.archive"
  | "entity.restore";

const nativeCapabilities = Object.freeze([
  "schema.describe",
  "entity.update-title",
  "entity.archive",
  "entity.restore",
] satisfies MachineCapability[]);

const dataSourceCapabilities = Object.freeze([
  ...nativeCapabilities,
  "relation.traverse",
  "property.set",
  "relation.add",
  "relation.remove",
  "entity.update-title",
  "entity.archive",
  "entity.restore",
] satisfies MachineCapability[]);

export interface MachineEntityTypeDescription {
  readonly id: string;
  readonly name: string;
  readonly kind: "native" | "data-source";
  readonly capabilities: readonly MachineCapability[];
  readonly properties: readonly MachinePropertyDescription[];
}

export interface MachinePropertyDescription {
  readonly id: string;
  readonly name: string;
  readonly kind: PropertyKind | "title";
  readonly required: boolean;
  readonly mutable: boolean;
  readonly options: readonly string[] | null;
  readonly targetEntityTypeId: string | null;
}

export class MachineContractError extends Error {
  constructor(
    readonly code:
      | "INVALID_CURSOR"
      | "INVALID_BOUNDS"
      | "INVALID_QUERY"
      | "NOT_FOUND"
      | "REVISION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "MachineContractError";
  }
}

export function listMachineEntityTypes(
  sources: readonly DataSource[],
): readonly MachineEntityTypeDescription[] {
  return [
    nativePageDescription(),
    ...[...sources]
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      )
      .map((source) => describeMachineEntityType(source, [])),
  ];
}

export function describeMachineEntityType(
  source: DataSource,
  definitions: readonly PropertyDefinition[],
): MachineEntityTypeDescription {
  const properties = definitions
    .filter((definition) => definition.sourceId === source.id)
    .map(toProperty)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  return Object.freeze({
    id: source.id,
    name: source.name,
    kind: "data-source" as const,
    capabilities: dataSourceCapabilities,
    properties: Object.freeze([titleProperty(), ...properties]),
  });
}

export interface MachineCursor {
  readonly sortValue: string;
  readonly id: string;
}

export function encodeMachineCursor(cursor: MachineCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeMachineCursor(value: string): MachineCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { sortValue?: unknown }).sortValue !== "string" ||
      typeof (parsed as { id?: unknown }).id !== "string"
    )
      throw new Error("invalid shape");
    return Object.freeze({
      sortValue: (parsed as MachineCursor).sortValue,
      id: (parsed as MachineCursor).id,
    });
  } catch {
    throw new MachineContractError(
      "INVALID_CURSOR",
      "machine cursor is invalid",
    );
  }
}

export function validateMachineBounds(input: { readonly limit: number }): {
  readonly limit: number;
} {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100
  )
    throw new MachineContractError(
      "INVALID_BOUNDS",
      "machine limit must be 1 to 100",
    );
  return Object.freeze({ limit: input.limit });
}

export type MachineComparison = "eq" | "contains" | "gt" | "gte" | "lt" | "lte";

export interface MachinePropertyFilter {
  readonly propertyId: string;
  readonly operator: MachineComparison;
  readonly value: string | boolean;
}

export interface MachineQuery {
  readonly entityTypeId: string;
  readonly ids?: readonly string[];
  readonly title?: string;
  readonly properties?: readonly MachinePropertyFilter[];
  readonly relationTargetId?: string;
  readonly archived?: boolean;
  readonly sort?: "title" | "createdAt";
  readonly direction?: "asc" | "desc";
  readonly limit: number;
  readonly cursor?: string;
}

export interface MachineEntitySummary {
  readonly id: string;
  readonly entityTypeId: string;
  readonly title: string;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly revision: number;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<{ source: string; actorId: string }>;
}

export interface MachineQueryResult {
  readonly items: readonly MachineEntitySummary[];
  readonly nextCursor: string | null;
  readonly truncated: boolean;
}

export interface MachineTraversalRequest {
  readonly rootId: string;
  readonly direction: "outgoing" | "incoming" | "both";
  readonly relationshipId?: string;
  readonly depth: number;
  readonly nodeLimit: number;
}

export interface MachineTraversalResult {
  readonly rootId: string;
  readonly nodes: readonly MachineEntitySummary[];
  readonly edges: readonly {
    id: string;
    definitionId: string;
    sourceId: string;
    targetId: string;
  }[];
  readonly truncated: boolean;
  readonly cyclesSuppressed: number;
}

export interface MachineContextRequest {
  readonly recordId: string;
  readonly maxProperties: number;
  readonly maxRelations: number;
}

export interface MachineContextResult {
  readonly entity: MachineEntitySummary;
  readonly relations: MachineTraversalResult["edges"];
  readonly included: Readonly<{ properties: number; relations: number }>;
  readonly omitted: Readonly<{ properties: number; relations: number }>;
  readonly continuation: readonly string[];
}

function nativePageDescription(): MachineEntityTypeDescription {
  return Object.freeze({
    id: "page",
    name: "Page",
    kind: "native" as const,
    capabilities: nativeCapabilities,
    properties: Object.freeze([titleProperty()]),
  });
}

function titleProperty(): MachinePropertyDescription {
  return Object.freeze({
    id: "title",
    name: "title",
    kind: "title" as const,
    required: true,
    mutable: true,
    options: null,
    targetEntityTypeId: null,
  });
}

function toProperty(
  definition: PropertyDefinition,
): MachinePropertyDescription {
  return Object.freeze({
    id: definition.id,
    name: definition.name,
    kind: definition.kind,
    required: false,
    mutable: true,
    options: definition.options,
    targetEntityTypeId: definition.targetSourceId,
  });
}
