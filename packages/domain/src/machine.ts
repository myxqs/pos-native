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
  | "property.clear"
  | "relation.add"
  | "relation.remove"
  | "entity.update-title"
  | "entity.archive"
  | "entity.restore"
  | "property.bulk";

const nativeCapabilities = Object.freeze([
  "schema.describe",
  "entity.get",
  "entity.query",
  "context.get",
  "history.get",
] satisfies MachineCapability[]);

const dataSourceCapabilities = Object.freeze([
  ...nativeCapabilities,
  "relation.traverse",
  "property.set",
  "property.clear",
  "relation.add",
  "relation.remove",
  "entity.update-title",
  "entity.archive",
  "entity.restore",
  "property.bulk",
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
