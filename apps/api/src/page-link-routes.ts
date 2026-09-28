import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PageLinkRepository } from "../../../packages/database/src/page-link-repository.ts";
import { PageLinkConflictError } from "../../../packages/database/src/page-link-repository.ts";
import type { PageRepository } from "../../../packages/database/src/page-repository.ts";
import { asNativeId } from "../../../packages/domain/src/ids.ts";
import {
  archivePageLink,
  createPageLink,
  type PageLinkDependencies,
} from "../../../packages/domain/src/page-link.ts";
import type { PageAuthorizer } from "./page-routes.ts";

const params = z
  .object({ pageId: z.string().uuid(), targetId: z.string().uuid() })
  .strict();
const pageParams = z.object({ pageId: z.string().uuid() }).strict();
const query = z
  .object({
    history: z.literal("all").optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
const link = z.object({
  id: z.string().uuid(),
  sourcePageId: z.string().uuid(),
  targetPageId: z.string().uuid(),
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  provenance: z.object({
    source: z.string().min(1),
    actorId: z.string().min(1),
  }),
});
const item = z.object({
  link,
  page: z.object({ id: z.string().uuid(), title: z.string().max(500) }),
});

export function registerPageLinkRoutes(
  app: FastifyInstance,
  options: {
    readonly pageRepository: PageRepository;
    readonly repository: PageLinkRepository;
    readonly dependencies: PageLinkDependencies;
    readonly authorize: PageAuthorizer;
  },
) {
  for (const direction of ["links", "backlinks"] as const)
    app.get(`/api/v1/pages/:pageId/${direction}`, async (request, reply) => {
      const auth = await options.authorize(request, false);
      if (!auth.ok)
        return reply.code(auth.statusCode).send({ error: auth.error });
      const p = pageParams.safeParse(request.params),
        q = query.safeParse(request.query);
      if (!p.success || !q.success)
        return reply.code(400).send({ error: "invalid page link query" });
      const pageId = asNativeId(p.data.pageId);
      if (!(await options.pageRepository.getById(pageId)))
        return reply.code(404).send({ error: "page not found" });
      try {
        const items = await (direction === "links"
          ? options.repository.listForward(pageId, {
              scope: q.data.history ?? "active",
              limit: q.data.limit ?? 50,
            })
          : options.repository.listBacklinks(pageId, {
              scope: q.data.history ?? "active",
              limit: q.data.limit ?? 50,
            }));
        return reply.send({
          items: z
            .array(item)
            .max(q.data.limit ?? 50)
            .parse(items),
        });
      } catch {
        return reply.code(500).send({ error: "page link listing failed" });
      }
    });
  app.post("/api/v1/pages/:pageId/links/:targetId", async (request, reply) => {
    const auth = await options.authorize(request, true);
    if (!auth.ok)
      return reply.code(auth.statusCode).send({ error: auth.error });
    const parsed = params.safeParse(request.params);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid page link ID" });
    const sourcePageId = asNativeId(parsed.data.pageId),
      targetPageId = asNativeId(parsed.data.targetId);
    if (sourcePageId === targetPageId)
      return reply.code(400).send({ error: "page cannot link to itself" });
    const source = await options.pageRepository.getById(sourcePageId),
      target = await options.pageRepository.getById(targetPageId);
    if (!source || !target)
      return reply.code(404).send({ error: "page not found" });
    if (source.page.archivedAt || target.page.archivedAt)
      return reply.code(409).send({ error: "page is archived" });
    try {
      const mutation = createPageLink(
        {
          sourcePageId,
          targetPageId,
          actorType: auth.actor.actorType,
          actorId: auth.actor.actorId,
          source: "nativepos.browser",
        },
        options.dependencies,
      );
      return reply.code(201).send({
        link: link.parse(await options.repository.create(mutation)),
      });
    } catch (error) {
      if (error instanceof PageLinkConflictError)
        return reply.code(409).send({ error: "page is already linked" });
      return reply.code(500).send({ error: "page link creation failed" });
    }
  });
  app.delete(
    "/api/v1/pages/:pageId/links/:targetId",
    async (request, reply) => {
      const auth = await options.authorize(request, true);
      if (!auth.ok)
        return reply.code(auth.statusCode).send({ error: auth.error });
      const parsed = params.safeParse(request.params);
      if (!parsed.success)
        return reply.code(400).send({ error: "invalid page link ID" });
      const sourcePageId = asNativeId(parsed.data.pageId),
        targetPageId = asNativeId(parsed.data.targetId);
      const current = await options.repository.getActive(
        sourcePageId,
        targetPageId,
      );
      if (!current)
        return reply.code(404).send({ error: "page link not found" });
      try {
        const mutation = archivePageLink(
          current.link,
          current.revisionNumber,
          {
            actorType: auth.actor.actorType,
            actorId: auth.actor.actorId,
            source: "nativepos.browser",
          },
          options.dependencies,
        );
        return reply.send({
          link: link.parse(await options.repository.archive(mutation)),
        });
      } catch (error) {
        if (error instanceof PageLinkConflictError)
          return reply.code(409).send({ error: "page link revision conflict" });
        return reply.code(500).send({ error: "page unlink failed" });
      }
    },
  );
}
