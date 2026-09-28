import type { AuditEvent, Revision } from "../../domain/src/audit.ts";
import type { NativeId } from "../../domain/src/ids.ts";
import type {
  CreatePageAssetLinkMutation,
  ArchivePageAssetLinkMutation,
  PageAssetLink,
} from "../../domain/src/page-asset-link.ts";

export interface PageAssetLinkRepository {
  create(mutation: CreatePageAssetLinkMutation): Promise<PageAssetLink>;
  archive(mutation: ArchivePageAssetLinkMutation): Promise<PageAssetLink>;
  getActive(
    pageId: NativeId,
    assetId: NativeId,
  ): Promise<{
    readonly link: PageAssetLink;
    readonly revisionNumber: number;
  } | null>;
  listForPage(
    pageId: NativeId,
    scope?: "active" | "all",
  ): Promise<readonly PageAssetLink[]>;
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
  readonly #revisionNumbers = new Map<NativeId, number>();
  readonly #pairs = new Set<string>();
  readonly #revisions: Revision<PageAssetLink, "page-asset-link">[] = [];
  readonly #audits: AuditEvent<
    PageAssetLink,
    "page-asset-link",
    "page.asset-linked" | "page.asset-unlinked"
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
      this.#revisionNumbers.set(mutation.link.id, 1);
      this.#pairs.add(pair);
      this.#inject("before-revision");
      this.#revisions.push(mutation.revision);
      this.#inject("before-audit");
      this.#audits.push(mutation.audit);
      return mutation.link;
    } catch (error) {
      this.#links.delete(mutation.link.id);
      this.#revisionNumbers.delete(mutation.link.id);
      this.#pairs.delete(pair);
      this.#revisions.length = revisionLength;
      this.#audits.length = auditLength;
      throw error;
    }
  }

  async archive(
    mutation: ArchivePageAssetLinkMutation,
  ): Promise<PageAssetLink> {
    const current = this.#links.get(mutation.link.id);
    if (!current || current.archivedAt !== null)
      throw new PageAssetLinkConflictError();
    this.#attempt += 1;
    const pair = `${current.pageId}:${current.assetId}`;
    const revisionLength = this.#revisions.length;
    const auditLength = this.#audits.length;
    try {
      this.#links.set(mutation.link.id, mutation.link);
      this.#pairs.delete(pair);
      this.#revisionNumbers.set(
        mutation.link.id,
        mutation.revision.revisionNumber,
      );
      this.#revisions.push(mutation.revision);
      this.#inject("before-audit");
      this.#audits.push(mutation.audit);
      return mutation.link;
    } catch (error) {
      this.#links.set(current.id, current);
      this.#pairs.add(pair);
      this.#revisionNumbers.set(
        current.id,
        mutation.revision.revisionNumber - 1,
      );
      this.#revisions.length = revisionLength;
      this.#audits.length = auditLength;
      throw error;
    }
  }

  async getActive(pageId: NativeId, assetId: NativeId) {
    const link = [...this.#links.values()].find(
      (item) =>
        item.pageId === pageId &&
        item.assetId === assetId &&
        item.archivedAt === null,
    );
    return link
      ? { link, revisionNumber: this.#revisionNumbers.get(link.id)! }
      : null;
  }

  async listForPage(
    pageId: NativeId,
    scope: "active" | "all" = "active",
  ): Promise<readonly PageAssetLink[]> {
    return [...this.#links.values()]
      .filter(
        (link) =>
          link.pageId === pageId &&
          (scope === "all" || link.archivedAt === null),
      )
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
