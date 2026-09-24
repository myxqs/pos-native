import type {
  AuditEvent,
  NativeEntityType,
  Revision,
} from "../../domain/src/audit.ts";
import {
  addRelationEdge,
  removeRelationEdge,
  setRecordProperty,
  type DataSource,
  type DataSourceDependencies,
  type DataSourceItem,
  type PropertyDefinition,
  type RelationEdge,
  type RelationMutationCommand,
  type ScalarPropertyValue,
  type SetRecordPropertyCommand,
} from "../../domain/src/data-source.ts";
import type {
  createDataSource,
  createDataSourceItem,
  createPropertyDefinition,
} from "../../domain/src/data-source.ts";
import { ValidationError, type NativeId } from "../../domain/src/ids.ts";
import type {
  CreatePageMutation,
  Page,
  PageUpdateMutation,
} from "../../domain/src/page.ts";
import {
  assertPageListScope,
  PageRevisionConflictError,
  type PageRepository,
  type PersistedPage,
  validatePageHierarchy,
} from "./page-repository.ts";

export type CreateSourceMutation = ReturnType<typeof createDataSource>;
export type CreateDefinitionMutation = ReturnType<
  typeof createPropertyDefinition
>;
export type CreateItemMutation = ReturnType<typeof createDataSourceItem>;

export interface PersistedDataSourceItem {
  readonly item: DataSourceItem;
  readonly page: Page;
  readonly values: Readonly<Record<string, ScalarPropertyValue>>;
  readonly propertyRevisionNumber: number;
}

export interface DataSourceRepository {
  readonly pages: PageRepository;
  createSource(mutation: CreateSourceMutation): Promise<DataSource>;
  getSource(id: NativeId): Promise<DataSource | null>;
  createDefinition(
    sourceId: NativeId,
    mutation: CreateDefinitionMutation,
  ): Promise<PropertyDefinition>;
  listDefinitions(sourceId: NativeId): Promise<readonly PropertyDefinition[]>;
  createItem(
    sourceId: NativeId,
    mutation: CreateItemMutation,
  ): Promise<DataSourceItem>;
  getItem(recordId: NativeId): Promise<PersistedDataSourceItem | null>;
  setProperty(
    recordId: NativeId,
    definitionId: NativeId,
    command: SetRecordPropertyCommand,
    dependencies: DataSourceDependencies,
  ): Promise<PersistedDataSourceItem>;
  addRelation(
    sourceRecordId: NativeId,
    definitionId: NativeId,
    targetRecordId: NativeId,
    command: RelationMutationCommand,
    dependencies: DataSourceDependencies,
  ): Promise<RelationEdge>;
  removeRelation(
    edgeId: NativeId,
    command: RelationMutationCommand,
    dependencies: DataSourceDependencies,
  ): Promise<RelationEdge>;
  outgoingRelations(recordId: NativeId): Promise<readonly RelationEdge[]>;
  incomingRelations(recordId: NativeId): Promise<readonly RelationEdge[]>;
}

interface ItemState {
  readonly item: DataSourceItem;
  readonly values: Readonly<Record<string, ScalarPropertyValue>>;
  readonly propertyRevisionNumber: number;
}

interface State {
  readonly pages: Map<NativeId, PersistedPage>;
  readonly sources: Map<NativeId, DataSource>;
  readonly definitions: Map<NativeId, PropertyDefinition>;
  readonly items: Map<NativeId, ItemState>;
  readonly edges: Map<NativeId, RelationEdge>;
  readonly revisions: Revision<unknown>[];
  readonly audits: AuditEvent<unknown>[];
}

function emptyState(): State {
  return {
    pages: new Map(),
    sources: new Map(),
    definitions: new Map(),
    items: new Map(),
    edges: new Map(),
    revisions: [],
    audits: [],
  };
}

function copyState(state: State): State {
  return {
    pages: new Map(state.pages),
    sources: new Map(state.sources),
    definitions: new Map(state.definitions),
    items: new Map(state.items),
    edges: new Map(state.edges),
    revisions: [...state.revisions],
    audits: [...state.audits],
  };
}

export class InMemoryDataSourceRepository implements DataSourceRepository {
  #state: State = emptyState();

  readonly pages: PageRepository = {
    create: async (mutation) =>
      this.#transaction((state) => this.#createPage(state, mutation)),
    update: async (mutation) =>
      this.#transaction((state) => this.#updatePage(state, mutation)),
    getById: async (id) => this.#state.pages.get(id) ?? null,
    list: async (scope = "active") => {
      assertPageListScope(scope);
      return [...this.#state.pages.values()]
        .map(({ page }) => page)
        .filter((page) =>
          scope === "active"
            ? page.archivedAt === null
            : page.archivedAt !== null,
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        );
    },
  };

  async createSource(mutation: CreateSourceMutation): Promise<DataSource> {
    return this.#transaction((state) => {
      const source = mutation.dataSource;
      if (state.sources.has(source.id))
        throw new ValidationError("data source already exists");
      state.sources.set(source.id, source);
      state.revisions.push(mutation.revision);
      state.audits.push(mutation.audit);
      return source;
    });
  }

  async getSource(id: NativeId): Promise<DataSource | null> {
    return this.#state.sources.get(id) ?? null;
  }

  async createDefinition(
    sourceId: NativeId,
    mutation: CreateDefinitionMutation,
  ): Promise<PropertyDefinition> {
    return this.#transaction((state) => {
      const definition = mutation.definition;
      this.#requireSource(state, sourceId);
      if (definition.sourceId !== sourceId)
        throw new ValidationError(
          "property definition belongs to another source",
        );
      if (definition.targetSourceId)
        this.#requireSource(state, definition.targetSourceId);
      if (state.definitions.has(definition.id))
        throw new ValidationError("property definition already exists");
      if (
        [...state.definitions.values()].some(
          (existing) =>
            existing.sourceId === sourceId &&
            existing.name.toLocaleLowerCase() ===
              definition.name.toLocaleLowerCase(),
        )
      )
        throw new ValidationError("property name already exists");
      state.definitions.set(definition.id, definition);
      state.revisions.push(mutation.revision);
      state.audits.push(mutation.audit);
      return definition;
    });
  }

  async listDefinitions(
    sourceId: NativeId,
  ): Promise<readonly PropertyDefinition[]> {
    this.#requireSource(this.#state, sourceId);
    return [...this.#state.definitions.values()].filter(
      (definition) => definition.sourceId === sourceId,
    );
  }

  async createItem(
    sourceId: NativeId,
    mutation: CreateItemMutation,
  ): Promise<DataSourceItem> {
    return this.#transaction((state) => {
      this.#requireSource(state, sourceId);
      const { item, page } = mutation;
      if (item.sourceId !== sourceId || item.id !== page.id)
        throw new ValidationError(
          "record membership must match page identity and source",
        );
      if (page.archivedAt !== null)
        throw new ValidationError("record page is archived");
      if (state.items.has(item.id))
        throw new ValidationError("record already exists");
      this.#createPage(state, {
        page,
        revision: mutation.pageRevision,
        audit: mutation.pageAudit,
      });
      state.items.set(item.id, {
        item,
        values: Object.freeze({}),
        propertyRevisionNumber: 1,
      });
      state.revisions.push(mutation.propertyRevision);
      state.audits.push(mutation.propertyAudit);
      return item;
    });
  }

  async getItem(recordId: NativeId): Promise<PersistedDataSourceItem | null> {
    const current = this.#state.items.get(recordId);
    const page = this.#state.pages.get(recordId)?.page;
    if (!current || !page) return null;
    return Object.freeze({
      item: current.item,
      page,
      values: current.values,
      propertyRevisionNumber: current.propertyRevisionNumber,
    });
  }

  async setProperty(
    recordId: NativeId,
    definitionId: NativeId,
    command: SetRecordPropertyCommand,
    dependencies: DataSourceDependencies,
  ): Promise<PersistedDataSourceItem> {
    return this.#transaction((state) => {
      const current = this.#requireItem(state, recordId);
      const definition = this.#requireDefinition(state, definitionId);
      const mutation = setRecordProperty(
        {
          item: current.item,
          page: this.#requirePage(state, recordId),
          definition,
          values: current.values,
          existingEdges: this.#outgoing(state, recordId),
          propertyRevisionNumber: current.propertyRevisionNumber,
        },
        command,
        dependencies,
      );
      state.items.set(recordId, {
        ...current,
        values: mutation.values,
        propertyRevisionNumber: mutation.propertyRevision.revisionNumber,
      });
      state.revisions.push(mutation.propertyRevision);
      state.audits.push(mutation.propertyAudit);
      return this.#persistedItem(state, recordId);
    });
  }

  async addRelation(
    sourceRecordId: NativeId,
    definitionId: NativeId,
    targetRecordId: NativeId,
    command: RelationMutationCommand,
    dependencies: DataSourceDependencies,
  ): Promise<RelationEdge> {
    return this.#transaction((state) => {
      const source = this.#requireItem(state, sourceRecordId);
      const target = this.#requireItem(state, targetRecordId);
      const mutation = addRelationEdge(
        {
          sourceItem: source.item,
          sourcePage: this.#requirePage(state, sourceRecordId),
          targetItem: target.item,
          targetPage: this.#requirePage(state, targetRecordId),
          definition: this.#requireDefinition(state, definitionId),
          values: source.values,
          existingEdges: this.#outgoing(state, sourceRecordId),
          propertyRevisionNumber: source.propertyRevisionNumber,
        },
        command,
        dependencies,
      );
      if (state.edges.has(mutation.edge.id))
        throw new ValidationError("relation edge already exists");
      state.edges.set(mutation.edge.id, mutation.edge);
      state.items.set(sourceRecordId, {
        ...source,
        propertyRevisionNumber: mutation.propertyRevision.revisionNumber,
      });
      state.revisions.push(mutation.edgeRevision, mutation.propertyRevision);
      state.audits.push(mutation.edgeAudit, mutation.propertyAudit);
      return mutation.edge;
    });
  }

  async removeRelation(
    edgeId: NativeId,
    command: RelationMutationCommand,
    dependencies: DataSourceDependencies,
  ): Promise<RelationEdge> {
    return this.#transaction((state) => {
      const edge = state.edges.get(edgeId);
      if (!edge) throw new ValidationError("relation edge does not exist");
      const source = this.#requireItem(state, edge.sourceRecordId);
      const target = this.#requireItem(state, edge.targetRecordId);
      const edgeRevisionNumber = state.revisions.filter(
        (revision) =>
          revision.entityType === "relation-edge" &&
          revision.entityId === edgeId,
      ).length;
      const mutation = removeRelationEdge(
        {
          sourceItem: source.item,
          sourcePage: this.#requirePage(state, source.item.id),
          targetItem: target.item,
          targetPage: this.#requirePage(state, target.item.id),
          definition: this.#requireDefinition(state, edge.definitionId),
          values: source.values,
          existingEdges: this.#outgoing(state, source.item.id),
          propertyRevisionNumber: source.propertyRevisionNumber,
          edge,
          edgeRevisionNumber,
        },
        command,
        dependencies,
      );
      state.edges.set(edgeId, mutation.edge);
      state.items.set(source.item.id, {
        ...source,
        propertyRevisionNumber: mutation.propertyRevision.revisionNumber,
      });
      state.revisions.push(mutation.edgeRevision, mutation.propertyRevision);
      state.audits.push(mutation.edgeAudit, mutation.propertyAudit);
      return mutation.edge;
    });
  }

  async outgoingRelations(
    recordId: NativeId,
  ): Promise<readonly RelationEdge[]> {
    this.#requireItem(this.#state, recordId);
    return this.#outgoing(this.#state, recordId).filter(
      (edge) => edge.archivedAt === null,
    );
  }

  async incomingRelations(
    recordId: NativeId,
  ): Promise<readonly RelationEdge[]> {
    this.#requireItem(this.#state, recordId);
    return [...this.#state.edges.values()].filter(
      (edge) => edge.targetRecordId === recordId && edge.archivedAt === null,
    );
  }

  revisionsFor(
    entityType: NativeEntityType,
    id: NativeId,
  ): readonly Revision<unknown>[] {
    return this.#state.revisions.filter(
      (revision) =>
        revision.entityType === entityType && revision.entityId === id,
    );
  }

  auditFor(
    entityType: NativeEntityType,
    id: NativeId,
  ): readonly AuditEvent<unknown>[] {
    return this.#state.audits.filter(
      (audit) => audit.targetType === entityType && audit.targetId === id,
    );
  }

  #transaction<T>(work: (state: State) => T): T {
    const next = copyState(this.#state);
    const result = work(next);
    this.#state = next;
    return result;
  }

  #createPage(state: State, mutation: CreatePageMutation): Page {
    if (state.pages.has(mutation.page.id))
      throw new Error("page already exists");
    validatePageHierarchy(this.#pageMap(state), mutation.page);
    state.pages.set(mutation.page.id, {
      page: mutation.page,
      revisionNumber: mutation.revision.revisionNumber,
    });
    state.revisions.push(mutation.revision);
    state.audits.push(mutation.audit);
    return mutation.page;
  }

  #updatePage(state: State, mutation: PageUpdateMutation): Page {
    const previous = state.pages.get(mutation.page.id);
    if (!previous) throw new Error("page does not exist");
    if (mutation.revision.revisionNumber !== previous.revisionNumber + 1)
      throw new PageRevisionConflictError();
    validatePageHierarchy(this.#pageMap(state), mutation.page);
    state.pages.set(mutation.page.id, {
      page: mutation.page,
      revisionNumber: mutation.revision.revisionNumber,
    });
    state.revisions.push(mutation.revision);
    state.audits.push(mutation.audit);
    return mutation.page;
  }

  #pageMap(state: State): Map<NativeId, Page> {
    return new Map(
      [...state.pages.values()].map(({ page }) => [page.id, page] as const),
    );
  }

  #requireSource(state: State, id: NativeId): DataSource {
    const source = state.sources.get(id);
    if (!source) throw new ValidationError("data source does not exist");
    return source;
  }

  #requireDefinition(state: State, id: NativeId): PropertyDefinition {
    const definition = state.definitions.get(id);
    if (!definition)
      throw new ValidationError("property definition does not exist");
    return definition;
  }

  #requireItem(state: State, id: NativeId): ItemState {
    const item = state.items.get(id);
    if (!item) throw new ValidationError("record does not exist");
    return item;
  }

  #requirePage(state: State, id: NativeId): Page {
    const page = state.pages.get(id)?.page;
    if (!page) throw new ValidationError("record page does not exist");
    return page;
  }

  #outgoing(state: State, recordId: NativeId): RelationEdge[] {
    return [...state.edges.values()].filter(
      (edge) => edge.sourceRecordId === recordId,
    );
  }

  #persistedItem(state: State, recordId: NativeId): PersistedDataSourceItem {
    const current = this.#requireItem(state, recordId);
    return Object.freeze({
      item: current.item,
      page: this.#requirePage(state, recordId),
      values: current.values,
      propertyRevisionNumber: current.propertyRevisionNumber,
    });
  }
}
