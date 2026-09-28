import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PageLinkRepository } from "../../../packages/database/src/page-link-repository.ts";
import type { PageRepository } from "../../../packages/database/src/page-repository.ts";
import { asNativeId } from "../../../packages/domain/src/ids.ts";
import type { PageAuthorizer } from "./page-routes.ts";

const params = z.object({ pageId: z.string().uuid() }).strict();
const query = z
  .object({ limit: z.coerce.number().int().min(1).max(20).optional() })
  .strict();
const rootPage = z.object({
  id: z.string().uuid(),
  title: z.string().max(500),
  archivedAt: z.string().datetime().nullable(),
});
const link = z.object({
  id: z.string().uuid(),
  sourcePageId: z.string().uuid(),
  targetPageId: z.string().uuid(),
  createdAt: z.string().datetime(),
  archivedAt: z.null(),
  provenance: z.object({
    source: z.string().min(1),
    actorId: z.string().min(1),
  }),
});
const item = z.object({
  link,
  page: z.object({ id: z.string().uuid(), title: z.string().max(500) }),
});
type Item = z.infer<typeof item>;

export function registerPageContextRoutes(
  app: FastifyInstance,
  options: {
    readonly pageRepository: PageRepository;
    readonly pageLinkRepository: PageLinkRepository;
    readonly authorize: PageAuthorizer;
  },
) {
  app.get("/api/v1/pages/:pageId/context", async (request, reply) => {
    const auth = await options.authorize(request, false);
    if (!auth.ok)
      return reply.code(auth.statusCode).send({ error: auth.error });
    const parsedParams = params.safeParse(request.params);
    const parsedQuery = query.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success)
      return reply.code(400).send({ error: "invalid page context query" });
    const pageId = asNativeId(parsedParams.data.pageId);
    const limit = parsedQuery.data.limit ?? 20;
    try {
      const persistedRoot = await options.pageRepository.getById(pageId);
      if (!persistedRoot)
        return reply.code(404).send({ error: "page not found" });
      const root = rootPage.parse(persistedRoot.page);
      if (root.archivedAt)
        return reply.code(409).send({ error: "page is archived" });
      const [rawForward, rawBacklinks] = await Promise.all([
        options.pageLinkRepository.listForward(pageId, {
          scope: "active",
          limit: limit + 1,
        }),
        options.pageLinkRepository.listBacklinks(pageId, {
          scope: "active",
          limit: limit + 1,
        }),
      ]);
      const forward = z
        .array(item)
        .max(limit + 1)
        .parse(rawForward);
      const backlinks = z
        .array(item)
        .max(limit + 1)
        .parse(rawBacklinks);
      validateConnections(pageId, forward, backlinks);
      const selectedForward = sortItems(forward).slice(0, limit);
      const selectedBacklinks = sortItems(backlinks).slice(0, limit);
      const nodes = new Map<string, { id: string; title: string }>([
        [root.id, { id: root.id, title: root.title }],
      ]);
      for (const entry of [...selectedForward, ...selectedBacklinks]) {
        const existing = nodes.get(entry.page.id);
        if (existing && existing.title !== entry.page.title)
          throw new Error("page context neighbour is inconsistent");
        nodes.set(entry.page.id, entry.page);
      }
      return reply.send({
        root: { id: root.id, title: root.title },
        depth: 1,
        nodes: [...nodes.values()].sort(
          (a, b) => compare(a.title, b.title) || compare(a.id, b.id),
        ),
        edges: [
          ...selectedForward.map((entry) => ({
            direction: "forward" as const,
            link: entry.link,
          })),
          ...selectedBacklinks.map((entry) => ({
            direction: "backlink" as const,
            link: entry.link,
          })),
        ],
        truncated: {
          forward: forward.length > limit,
          backlinks: backlinks.length > limit,
        },
      });
    } catch {
      return reply.code(500).send({ error: "page context is unavailable" });
    }
  });
}

function validateConnections(
  rootId: string,
  forward: readonly Item[],
  backlinks: readonly Item[],
) {
  if (
    forward.some(
      (entry) =>
        entry.link.sourcePageId !== rootId ||
        entry.link.targetPageId !== entry.page.id ||
        entry.page.id === rootId,
    ) ||
    backlinks.some(
      (entry) =>
        entry.link.targetPageId !== rootId ||
        entry.link.sourcePageId !== entry.page.id ||
        entry.page.id === rootId,
    )
  )
    throw new Error("page context relationship is invalid");
}

function sortItems(values: readonly Item[]) {
  return [...values].sort(
    (a, b) =>
      compare(a.link.createdAt, b.link.createdAt) ||
      compare(a.link.id, b.link.id),
  );
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
