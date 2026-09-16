import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AuditActorType } from "../../../packages/domain/src/audit.ts";
import { asNativeId } from "../../../packages/domain/src/ids.ts";
import {
  createPage,
  type CreatePageDependencies,
  updatePage,
} from "../../../packages/domain/src/page.ts";
import type { PageRepository } from "../../../packages/database/src/page-repository.ts";

const pageBody = z
  .object({ title: z.string().trim().min(1).max(500) })
  .strict();
const pageParams = z.object({ id: z.string().uuid() });

export interface PageRouteOptions {
  readonly pageRepository: PageRepository;
  readonly pageDependencies: CreatePageDependencies;
  readonly actor: {
    readonly actorType: AuditActorType;
    readonly actorId: string;
    readonly source: string;
  };
}

export function registerPageRoutes(
  app: FastifyInstance,
  options: PageRouteOptions,
): void {
  app.post("/api/v1/pages", async (request, reply) => {
    const parsed = pageBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid page request" });
    }
    const mutation = createPage(
      { ...parsed.data, ...options.actor },
      options.pageDependencies,
    );
    await options.pageRepository.create(mutation);
    return reply.code(201).send({ page: mutation.page, revisionNumber: 1 });
  });

  app.get("/api/v1/pages", async () => ({
    pages: await options.pageRepository.list(),
  }));

  app.get("/api/v1/pages/:id", async (request, reply) => {
    const id = parsePageId(request.params);
    if (!id) return reply.code(400).send({ error: "invalid page ID" });
    const page = await options.pageRepository.getById(id);
    if (!page) return reply.code(404).send({ error: "page not found" });
    return page;
  });

  app.patch("/api/v1/pages/:id", async (request, reply) => {
    const id = parsePageId(request.params);
    if (!id) return reply.code(400).send({ error: "invalid page ID" });
    const parsed = pageBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid page request" });
    }
    const current = await options.pageRepository.getById(id);
    if (!current) return reply.code(404).send({ error: "page not found" });
    const mutation = updatePage(
      current.page,
      current.revisionNumber,
      { ...parsed.data, ...options.actor },
      options.pageDependencies,
    );
    await options.pageRepository.update(mutation);
    return {
      page: mutation.page,
      revisionNumber: mutation.revision.revisionNumber,
    };
  });
}

function parsePageId(params: unknown) {
  const parsed = pageParams.safeParse(params);
  return parsed.success ? asNativeId(parsed.data.id) : null;
}
