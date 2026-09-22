import type { AuditEvent, Revision } from "../../domain/src/audit.ts";
import type { NativeId } from "../../domain/src/ids.ts";
import type {
  CreatePageMutation,
  Page,
  PageUpdateMutation,
} from "../../domain/src/page.ts";

export const MAX_PAGE_HIERARCHY_DEPTH = 32;

export type PageListScope = "active" | "archived";

export interface PersistedPage {
  readonly page: Page;
  readonly revisionNumber: number;
}

export interface PageRepository {
  create(mutation: CreatePageMutation): Promise<Page>;
  update(mutation: PageUpdateMutation): Promise<Page>;
  getById(id: NativeId): Promise<PersistedPage | null>;
  list(scope?: PageListScope): Promise<readonly Page[]>;
}

type Mutation = CreatePageMutation | PageUpdateMutation;
type FailurePoint = "before-revision" | "before-audit";

export class PageRevisionConflictError extends Error {
  constructor() {
    super("page revision conflict");
    this.name = "PageRevisionConflictError";
  }
}

export class PageHierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageHierarchyError";
  }
}

export class InMemoryPageRepository implements PageRepository {
  readonly #pages = new Map<NativeId, PersistedPage>();
  readonly #revisions: Revision<Page>[] = [];
  readonly #audits: AuditEvent<Page>[] = [];
  readonly #failAt: FailurePoint | undefined;

  constructor(options: { failAt?: FailurePoint } = {}) {
    this.#failAt = options.failAt;
  }

  async create(mutation: CreatePageMutation): Promise<Page> {
    if (this.#pages.has(mutation.page.id)) {
      throw new Error("page already exists");
    }
    validatePageHierarchy(this.#pageMap(), mutation.page);
    return this.#persist(mutation);
  }

  async update(mutation: PageUpdateMutation): Promise<Page> {
    const current = this.#pages.get(mutation.page.id);
    if (!current) {
      throw new Error("page does not exist");
    }
    if (mutation.revision.revisionNumber !== current.revisionNumber + 1) {
      throw new PageRevisionConflictError();
    }
    validatePageHierarchy(this.#pageMap(), mutation.page);
    return this.#persist(mutation);
  }

  async getById(id: NativeId): Promise<PersistedPage | null> {
    return this.#pages.get(id) ?? null;
  }

  async list(scope: PageListScope = "active"): Promise<readonly Page[]> {
    assertPageListScope(scope);
    return [...this.#pages.values()]
      .map(({ page }) => page)
      .filter((page) =>
        scope === "active"
          ? page.archivedAt === null
          : page.archivedAt !== null,
      )
      .sort(comparePages);
  }

  revisionsFor(id: NativeId): readonly Revision<Page>[] {
    return this.#revisions.filter((revision) => revision.entityId === id);
  }

  auditFor(id: NativeId): readonly AuditEvent<Page>[] {
    return this.#audits.filter((audit) => audit.targetId === id);
  }

  #pageMap(): Map<NativeId, Page> {
    return new Map(
      [...this.#pages.values()].map(({ page }) => [page.id, page] as const),
    );
  }

  #persist(mutation: Mutation): Page {
    const previousPage = this.#pages.get(mutation.page.id);
    const revisionLength = this.#revisions.length;
    const auditLength = this.#audits.length;

    try {
      this.#pages.set(mutation.page.id, {
        page: mutation.page,
        revisionNumber: mutation.revision.revisionNumber,
      });
      this.#injectFailure("before-revision");
      this.#revisions.push(mutation.revision);
      this.#injectFailure("before-audit");
      this.#audits.push(mutation.audit);
      return mutation.page;
    } catch (error) {
      if (previousPage) {
        this.#pages.set(mutation.page.id, previousPage);
      } else {
        this.#pages.delete(mutation.page.id);
      }
      this.#revisions.length = revisionLength;
      this.#audits.length = auditLength;
      throw error;
    }
  }

  #injectFailure(point: FailurePoint): void {
    if (this.#failAt === point) {
      throw new Error(`injected failure ${point.replace("-", " ")}`);
    }
  }
}

export function validatePageHierarchy(
  existingPages: ReadonlyMap<NativeId, Page>,
  candidate: Page,
): void {
  const pages = new Map(existingPages);
  const previous = pages.get(candidate.id) ?? null;
  pages.set(candidate.id, candidate);

  validateParentChain(pages, candidate);

  if (
    previous?.archivedAt === null &&
    candidate.archivedAt !== null &&
    [...pages.values()].some(
      (page) =>
        page.id !== candidate.id &&
        page.parentId === candidate.id &&
        page.archivedAt === null,
    )
  ) {
    throw new PageHierarchyError("page has live children");
  }
}

export function assertPageListScope(scope: PageListScope): void {
  if (scope !== "active" && scope !== "archived") {
    throw new PageHierarchyError("page list scope is invalid");
  }
}

function validateParentChain(
  pages: ReadonlyMap<NativeId, Page>,
  candidate: Page,
): void {
  const visited = new Set<NativeId>();
  let currentId = candidate.id;
  let depth = 0;

  while (true) {
    if (visited.has(currentId)) {
      throw new PageHierarchyError("page hierarchy contains a cycle");
    }
    visited.add(currentId);

    const current = pages.get(currentId);
    if (!current) {
      throw new PageHierarchyError("page hierarchy is incomplete");
    }
    if (current.parentId === null) {
      return;
    }

    depth += 1;
    if (depth > MAX_PAGE_HIERARCHY_DEPTH) {
      throw new PageHierarchyError("page hierarchy exceeds maximum depth");
    }

    const parent = pages.get(current.parentId);
    if (!parent) {
      throw new PageHierarchyError("page parent does not exist");
    }
    if (parent.archivedAt !== null) {
      throw new PageHierarchyError("page parent is archived");
    }
    currentId = parent.id;
  }
}

function comparePages(left: Page, right: Page): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
