import type { AuditEvent, Revision } from "../../domain/src/audit.ts";
import type { NativeId } from "../../domain/src/ids.ts";
import type {
  CreatePageAssetLinkMutation,
  PageAssetLink,
} from "../../domain/src/page-asset-link.ts";

export interface PageAssetLinkRepository {
  create(mutation: CreatePageAssetLinkMutation): Promise<PageAssetLink>;
  listForPage(pageId: NativeId): Promise<readonly PageAssetLink[]>;
}

export class PageAssetLinkConflictError extends Error {
  constructor() {
    super("page asset link already exists");
    this.name = "PageAssetLinkConflictError";
  }
}

type FailurePoint = "before-revision" | "before-audit";

export class InMemoryPageAssetLinkRepository implements PageAssetLinkRepository {
  readonly #links = new Map<NativeId, PageAssetLink>();
  readonly #pairs = new Set<string>();
  readonly #revisions: Revision<PageAssetLink, "page-asset-link">[] = [];
  readonly #audits: AuditEvent<
    PageAssetLink,
    "page-asset-link",
    "page.asset-linked"
  >[] = [];
  #attempt = 0;
  constructor(
    private readonly options: {
      readonly failAt?: FailurePoint;
      readonly failOnAttempt?: number;
    } = {},
  ) {}

  async create(mutation: CreatePageAssetLinkMutation): Promise<PageAssetLink> {
    const pair = `${mutation.link.pageId}:${mutation.link.assetId}`;
    if (this.#pairs.has(pair)) throw new PageAssetLinkConflictError();
    this.#attempt += 1;
    const revisionLength = this.#revisions.length;
    const auditLength = this.#audits.length;
    try {
      this.#links.set(mutation.link.id, mutation.link);
      this.#pairs.add(pair);
      this.#inject("before-revision");
      this.#revisions.push(mutation.revision);
      this.#inject("before-audit");
      this.#audits.push(mutation.audit);
      return mutation.link;
    } catch (error) {
      this.#links.delete(mutation.link.id);
      this.#pairs.delete(pair);
      this.#revisions.length = revisionLength;
      this.#audits.length = auditLength;
      throw error;
    }
  }

  async listForPage(pageId: NativeId): Promise<readonly PageAssetLink[]> {
    return [...this.#links.values()]
      .filter((link) => link.pageId === pageId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }
  revisionsFor(id: NativeId) {
    return this.#revisions.filter((item) => item.entityId === id);
  }
  auditFor(id: NativeId) {
    return this.#audits.filter((item) => item.targetId === id);
  }
  #inject(point: FailurePoint) {
    if (
      this.options.failAt === point &&
      (this.options.failOnAttempt === undefined ||
        this.options.failOnAttempt === this.#attempt)
    )
      throw new Error(`injected failure ${point}`);
  }
}
