import type { AuditEvent, Revision } from "../../domain/src/audit.ts";
import type { NativeId } from "../../domain/src/ids.ts";
import type {
  CreatePageMutation,
  Page,
  UpdatePageMutation,
} from "../../domain/src/page.ts";

export interface PersistedPage {
  readonly page: Page;
  readonly revisionNumber: number;
}

export interface PageRepository {
  create(mutation: CreatePageMutation): Promise<Page>;
  update(mutation: UpdatePageMutation): Promise<Page>;
  getById(id: NativeId): Promise<PersistedPage | null>;
  list(): Promise<readonly Page[]>;
}

type Mutation = CreatePageMutation | UpdatePageMutation;
type FailurePoint = "before-revision" | "before-audit";

export class PageRevisionConflictError extends Error {
  constructor() {
    super("page revision conflict");
    this.name = "PageRevisionConflictError";
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
    return this.#persist(mutation);
  }

  async update(mutation: UpdatePageMutation): Promise<Page> {
    const current = this.#pages.get(mutation.page.id);
    if (!current) {
      throw new Error("page does not exist");
    }
    if (mutation.revision.revisionNumber !== current.revisionNumber + 1) {
      throw new PageRevisionConflictError();
    }
    return this.#persist(mutation);
  }

  async getById(id: NativeId): Promise<PersistedPage | null> {
    return this.#pages.get(id) ?? null;
  }

  async list(): Promise<readonly Page[]> {
    return [...this.#pages.values()].map(({ page }) => page);
  }

  revisionsFor(id: NativeId): readonly Revision<Page>[] {
    return this.#revisions.filter((revision) => revision.entityId === id);
  }

  auditFor(id: NativeId): readonly AuditEvent<Page>[] {
    return this.#audits.filter((audit) => audit.targetId === id);
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
