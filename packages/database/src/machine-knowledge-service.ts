import type {
  DataSourceDependencies,
  RelationEdge,
  ScalarPropertyValue,
} from "../../domain/src/data-source.ts";
import { asNativeId, type NativeId } from "../../domain/src/ids.ts";
import {
  decodeMachineCursor,
  describeMachineEntityType,
  encodeMachineCursor,
  listMachineEntityTypes,
  MachineContractError,
  type MachineContextRequest,
  type MachineContextResult,
  type MachineEntitySummary,
  type MachineEntityTypeDescription,
  type MachinePropertyFilter,
  type MachineQuery,
  type MachineQueryResult,
  type MachineTraversalRequest,
  type MachineTraversalResult,
  validateMachineBounds,
} from "../../domain/src/machine.ts";
import type {
  DataSourceRepository,
  PersistedDataSourceItem,
} from "./data-source-repository.ts";

const MAX_SCAN = 10_000;

export class MachineKnowledgeService {
  constructor(
    private readonly repository: DataSourceRepository,
    readonly dependencies: DataSourceDependencies,
  ) {}

  async listEntityTypes(): Promise<readonly MachineEntityTypeDescription[]> {
    const sources = await this.#allSources();
    return listMachineEntityTypes(sources);
  }

  async describeEntityType(
    entityTypeId: string,
  ): Promise<MachineEntityTypeDescription> {
    if (entityTypeId === "page") return listMachineEntityTypes([])[0]!;
    const id = asNativeId(entityTypeId);
    const source = await this.repository.getSource(id);
    if (!source)
      throw new MachineContractError("NOT_FOUND", "entity type does not exist");
    return describeMachineEntityType(
      source,
      await this.repository.listDefinitions(id),
    );
  }

  async get(recordId: string): Promise<MachineEntitySummary> {
    const record = await this.repository.getItem(asNativeId(recordId));
    if (!record)
      throw new MachineContractError("NOT_FOUND", "entity does not exist");
    return toSummary(record);
  }

  async query(input: MachineQuery): Promise<MachineQueryResult> {
    const { limit } = validateMachineBounds(input);
    if (!hasSelector(input))
      throw new MachineContractError(
        "INVALID_QUERY",
        "machine query needs a selector",
      );
    if (input.ids && (input.ids.length < 1 || input.ids.length > 100))
      throw new MachineContractError(
        "INVALID_QUERY",
        "ID selector must contain 1 to 100 IDs",
      );
    if (
      input.title !== undefined &&
      (!input.title.trim() || input.title.length > 200)
    )
      throw new MachineContractError(
        "INVALID_QUERY",
        "title selector is invalid",
      );
    const sourceId = asNativeId(input.entityTypeId);
    if (!(await this.repository.getSource(sourceId)))
      throw new MachineContractError("NOT_FOUND", "entity type does not exist");
    const idSet = input.ids ? new Set(input.ids.map(asNativeId)) : null;
    const candidates = await this.#allItems(sourceId);
    const matches: MachineEntitySummary[] = [];
    for (const candidate of candidates) {
      if (idSet && !idSet.has(candidate.item.id)) continue;
      if ((input.archived ?? false) !== (candidate.page.archivedAt !== null))
        continue;
      if (
        input.title &&
        !candidate.page.title
          .toLocaleLowerCase()
          .includes(input.title.trim().toLocaleLowerCase())
      )
        continue;
      if (
        input.properties?.some(
          (filter) => !matchesProperty(candidate.values, filter),
        )
      )
        continue;
      if (input.relationTargetId) {
        const relations = await this.repository.outgoingRelations(
          candidate.item.id,
        );
        if (
          !relations.some(
            (edge) => edge.targetRecordId === input.relationTargetId,
          )
        )
          continue;
      }
      matches.push(toSummary(candidate));
    }
    const sort = input.sort ?? "title";
    const direction = input.direction ?? "asc";
    matches.sort((left, right) => {
      const leftValue = sort === "title" ? left.title : left.createdAt;
      const rightValue = sort === "title" ? right.title : right.createdAt;
      const order =
        leftValue.localeCompare(rightValue) || left.id.localeCompare(right.id);
      return direction === "asc" ? order : -order;
    });
    let start = 0;
    if (input.cursor) {
      const cursor = decodeMachineCursor(input.cursor);
      const index = matches.findIndex(
        (item) =>
          item.id === cursor.id &&
          (sort === "title" ? item.title : item.createdAt) === cursor.sortValue,
      );
      if (index < 0)
        throw new MachineContractError(
          "INVALID_CURSOR",
          "cursor is outside this result set",
        );
      start = index + 1;
    }
    const page = matches.slice(start, start + limit);
    const truncated = start + limit < matches.length;
    const last = page.at(-1);
    return Object.freeze({
      items: Object.freeze(page),
      nextCursor:
        truncated && last
          ? encodeMachineCursor({
              sortValue: sort === "title" ? last.title : last.createdAt,
              id: last.id,
            })
          : null,
      truncated,
    });
  }

  async traverse(
    input: MachineTraversalRequest,
  ): Promise<MachineTraversalResult> {
    if (
      !Number.isSafeInteger(input.depth) ||
      input.depth < 1 ||
      input.depth > 3
    )
      throw new MachineContractError(
        "INVALID_BOUNDS",
        "traversal depth must be 1 to 3",
      );
    validateMachineBounds({ limit: input.nodeLimit });
    const root = await this.get(input.rootId);
    const nodes = new Map<string, MachineEntitySummary>([[root.id, root]]);
    const edges = new Map<string, MachineTraversalResult["edges"][number]>();
    const queue: Array<{ id: NativeId; depth: number }> = [
      { id: asNativeId(root.id), depth: 0 },
    ];
    let truncated = false;
    let cyclesSuppressed = 0;
    while (queue.length) {
      const current = queue.shift()!;
      if (current.depth >= input.depth) continue;
      const relations = await this.#relations(current.id, input.direction);
      for (const edge of relations) {
        if (input.relationshipId && edge.definitionId !== input.relationshipId)
          continue;
        edges.set(edge.id, edgeView(edge));
        const neighbourId =
          edge.sourceRecordId === current.id
            ? edge.targetRecordId
            : edge.sourceRecordId;
        if (nodes.has(neighbourId)) {
          cyclesSuppressed += 1;
          continue;
        }
        if (nodes.size >= input.nodeLimit) {
          truncated = true;
          continue;
        }
        const neighbour = await this.get(neighbourId);
        nodes.set(neighbour.id, neighbour);
        queue.push({ id: neighbourId, depth: current.depth + 1 });
      }
    }
    return Object.freeze({
      rootId: root.id,
      nodes: Object.freeze([...nodes.values()]),
      edges: Object.freeze(
        [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
      ),
      truncated,
      cyclesSuppressed,
    });
  }

  async context(input: MachineContextRequest): Promise<MachineContextResult> {
    assertBudget(input.maxProperties, "property");
    assertBudget(input.maxRelations, "relation");
    const entity = await this.get(input.recordId);
    const propertyEntries = Object.entries(entity.properties).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    const selectedProperties = Object.fromEntries(
      propertyEntries.slice(0, input.maxProperties),
    );
    const relations = await this.#relations(asNativeId(input.recordId), "both");
    const selectedRelations = relations
      .slice(0, input.maxRelations)
      .map(edgeView);
    const omitted = Object.freeze({
      properties: Math.max(
        0,
        propertyEntries.length - selectedPropertiesCount(selectedProperties),
      ),
      relations: Math.max(0, relations.length - selectedRelations.length),
    });
    const continuation: string[] = [];
    if (omitted.properties) continuation.push("entity.get");
    if (omitted.relations) continuation.push("relation.traverse");
    return Object.freeze({
      entity: Object.freeze({
        ...entity,
        properties: Object.freeze(selectedProperties),
      }),
      relations: Object.freeze(selectedRelations),
      included: Object.freeze({
        properties: selectedPropertiesCount(selectedProperties),
        relations: selectedRelations.length,
      }),
      omitted,
      continuation: Object.freeze(continuation),
    });
  }

  async #allSources() {
    const values = [];
    for (let offset = 0; offset < MAX_SCAN; offset += 200) {
      const page = await this.repository.listSources({ limit: 200, offset });
      values.push(...page);
      if (page.length < 200) break;
    }
    return values;
  }

  async #allItems(sourceId: NativeId): Promise<PersistedDataSourceItem[]> {
    const values: PersistedDataSourceItem[] = [];
    for (let offset = 0; offset < MAX_SCAN; offset += 200) {
      const page = await this.repository.listItems(sourceId, {
        limit: 200,
        offset,
      });
      for (const summary of page) {
        const item = await this.repository.getItem(summary.item.id);
        if (!item) throw new Error("listed machine entity is unavailable");
        values.push(item);
      }
      if (page.length < 200) break;
    }
    return values;
  }

  async #relations(
    id: NativeId,
    direction: MachineTraversalRequest["direction"],
  ): Promise<RelationEdge[]> {
    const values: RelationEdge[] = [];
    if (direction !== "incoming")
      values.push(...(await this.repository.outgoingRelations(id)));
    if (direction !== "outgoing")
      values.push(...(await this.repository.incomingRelations(id)));
    return values.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  }
}

function hasSelector(input: MachineQuery): boolean {
  return Boolean(
    input.ids?.length ||
    input.title?.trim() ||
    input.properties?.length ||
    input.relationTargetId ||
    input.archived !== undefined,
  );
}

function matchesProperty(
  values: Readonly<Record<string, ScalarPropertyValue>>,
  filter: MachinePropertyFilter,
): boolean {
  const current = values[filter.propertyId];
  if (!current) return false;
  const value = current.value;
  if (filter.operator === "contains")
    return Array.isArray(value)
      ? value.includes(String(filter.value))
      : String(value)
          .toLocaleLowerCase()
          .includes(String(filter.value).toLocaleLowerCase());
  if (filter.operator === "eq")
    return Array.isArray(value)
      ? value.includes(String(filter.value))
      : value === filter.value;
  const left = current.kind === "number" ? Number(value) : String(value);
  const right =
    current.kind === "number" ? Number(filter.value) : String(filter.value);
  if (
    typeof left === "number" &&
    (!Number.isFinite(left) || !Number.isFinite(right))
  )
    return false;
  switch (filter.operator) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    default:
      return false;
  }
}

function toSummary(record: PersistedDataSourceItem): MachineEntitySummary {
  return Object.freeze({
    id: record.item.id,
    entityTypeId: record.item.sourceId,
    title: record.page.title,
    archived: record.page.archivedAt !== null,
    createdAt: record.page.createdAt,
    modifiedAt: record.page.modifiedAt,
    revision: record.propertyRevisionNumber,
    properties: Object.freeze({ ...record.values }),
    provenance: record.page.provenance,
  });
}

function edgeView(edge: RelationEdge): MachineTraversalResult["edges"][number] {
  return Object.freeze({
    id: edge.id,
    definitionId: edge.definitionId,
    sourceId: edge.sourceRecordId,
    targetId: edge.targetRecordId,
  });
}

function assertBudget(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100)
    throw new MachineContractError(
      "INVALID_BOUNDS",
      `${label} budget must be 0 to 100`,
    );
}

function selectedPropertiesCount(
  values: Readonly<Record<string, unknown>>,
): number {
  return Object.keys(values).length;
}
