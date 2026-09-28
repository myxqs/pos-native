import type { AuditEvent, Revision } from "../../domain/src/audit.ts";
import type { NativeId } from "../../domain/src/ids.ts";
import type {
  ArchivePageLinkMutation,
  CreatePageLinkMutation,
  PageLink,
} from "../../domain/src/page-link.ts";

export interface LinkedPage {
  readonly id: NativeId;
  readonly title: string;
}
export interface PageLinkItem {
  readonly link: PageLink;
  readonly page: LinkedPage;
}
export interface PageLinkListOptions {
  readonly scope: "active" | "all";
  readonly limit: number;
}
export interface PageLinkRepository {
  create(mutation: CreatePageLinkMutation): Promise<PageLink>;
  archive(mutation: ArchivePageLinkMutation): Promise<PageLink>;
  getActive(
    sourcePageId: NativeId,
    targetPageId: NativeId,
  ): Promise<{
    readonly link: PageLink;
    readonly revisionNumber: number;
  } | null>;
  listForward(
    pageId: NativeId,
    options: PageLinkListOptions,
  ): Promise<readonly PageLinkItem[]>;
  listBacklinks(
    pageId: NativeId,
    options: PageLinkListOptions,
  ): Promise<readonly PageLinkItem[]>;
}
export class PageLinkConflictError extends Error {
  constructor(message = "page link already exists") {
    super(message);
    this.name = "PageLinkConflictError";
  }
}
type PageState = { readonly title: string; readonly archivedAt: string | null };
type FailurePoint = "before-revision" | "before-audit";

export class InMemoryPageLinkRepository implements PageLinkRepository {
  readonly #links = new Map<NativeId, PageLink>();
  readonly #numbers = new Map<NativeId, number>();
  readonly #revisions: Revision<PageLink, "page-link">[] = [];
  readonly #audits: AuditEvent<PageLink>[] = [];
  constructor(
    private readonly page: (id: NativeId) => PageState | null,
    private readonly options: { readonly failAt?: FailurePoint } = {},
  ) {}
  async create(mutation: CreatePageLinkMutation): Promise<PageLink> {
    this.#requireLive(mutation.link.sourcePageId);
    this.#requireLive(mutation.link.targetPageId);
    if (
      [...this.#links.values()].some(
        (link) =>
          link.sourcePageId === mutation.link.sourcePageId &&
          link.targetPageId === mutation.link.targetPageId &&
          link.archivedAt === null,
      )
    )
      throw new PageLinkConflictError();
    const revisions = this.#revisions.length;
    const audits = this.#audits.length;
    try {
      this.#links.set(mutation.link.id, mutation.link);
      this.#numbers.set(mutation.link.id, 1);
      this.#inject("before-revision");
      this.#revisions.push(mutation.revision);
      this.#inject("before-audit");
      this.#audits.push(mutation.audit);
      return mutation.link;
    } catch (error) {
      this.#links.delete(mutation.link.id);
      this.#numbers.delete(mutation.link.id);
      this.#revisions.length = revisions;
      this.#audits.length = audits;
      throw error;
    }
  }
  async archive(mutation: ArchivePageLinkMutation): Promise<PageLink> {
    const current = this.#links.get(mutation.link.id);
    if (
      !current ||
      current.archivedAt !== null ||
      this.#numbers.get(current.id)! + 1 !== mutation.revision.revisionNumber
    )
      throw new PageLinkConflictError("page link revision conflict");
    const revisions = this.#revisions.length;
    const audits = this.#audits.length;
    try {
      this.#links.set(current.id, mutation.link);
      this.#numbers.set(current.id, mutation.revision.revisionNumber);
      this.#inject("before-revision");
      this.#revisions.push(mutation.revision);
      this.#inject("before-audit");
      this.#audits.push(mutation.audit);
      return mutation.link;
    } catch (error) {
      this.#links.set(current.id, current);
      this.#numbers.set(current.id, mutation.revision.revisionNumber - 1);
      this.#revisions.length = revisions;
      this.#audits.length = audits;
      throw error;
    }
  }
  async getActive(sourcePageId: NativeId, targetPageId: NativeId) {
    const link = [...this.#links.values()].find(
      (item) =>
        item.sourcePageId === sourcePageId &&
        item.targetPageId === targetPageId &&
        item.archivedAt === null,
    );
    return link ? { link, revisionNumber: this.#numbers.get(link.id)! } : null;
  }
  listForward(pageId: NativeId, options: PageLinkListOptions) {
    return this.#list(pageId, true, options);
  }
  listBacklinks(pageId: NativeId, options: PageLinkListOptions) {
    return this.#list(pageId, false, options);
  }
  revisionsFor(id: NativeId) {
    return this.#revisions.filter((item) => item.entityId === id);
  }
  auditFor(id: NativeId) {
    return this.#audits.filter((item) => item.targetId === id);
  }
  async #list(
    pageId: NativeId,
    forward: boolean,
    options: PageLinkListOptions,
  ): Promise<readonly PageLinkItem[]> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100
    )
      throw new Error("page link limit is invalid");
    const owner = this.page(pageId);
    if (!owner) throw new Error("page link endpoint is missing");
    return [...this.#links.values()]
      .filter(
        (link) =>
          (forward ? link.sourcePageId : link.targetPageId) === pageId &&
          (options.scope === "all" || link.archivedAt === null),
      )
      .flatMap((link) => {
        const other = this.page(
          forward ? link.targetPageId : link.sourcePageId,
        );
        if (!other) throw new Error("page link endpoint is missing");
        if (
          options.scope === "active" &&
          (owner.archivedAt !== null || other.archivedAt !== null)
        )
          return [];
        return [
          {
            link,
            page: {
              id: forward ? link.targetPageId : link.sourcePageId,
              title: other.title,
            },
          },
        ];
      })
      .sort(
        (a, b) =>
          a.link.createdAt.localeCompare(b.link.createdAt) ||
          a.link.id.localeCompare(b.link.id),
      )
      .slice(0, options.limit);
  }
  #requireLive(id: NativeId) {
    const page = this.page(id);
    if (!page) throw new PageLinkConflictError("page link endpoint is missing");
    if (page.archivedAt !== null)
      throw new PageLinkConflictError("page link endpoint is archived");
  }
  #inject(point: FailurePoint) {
    if (this.options.failAt === point)
      throw new Error(`injected failure ${point}`);
  }
}
