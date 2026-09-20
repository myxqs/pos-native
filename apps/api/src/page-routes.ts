import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuditActorType } from "../../../packages/domain/src/audit.ts";
import { asNativeId } from "../../../packages/domain/src/ids.ts";
import {
  createPage,
  type CreatePageDependencies,
  updatePage,
} from "../../../packages/domain/src/page.ts";
import {
  PageRevisionConflictError,
  type PageRepository,
} from "../../../packages/database/src/page-repository.ts";

const pageBody = z
  .object({ title: z.string().trim().min(1).max(500) })
  .strict();
const pageParams = z.object({ id: z.string().uuid() });

export interface PageRouteOptions {
  readonly pageRepository: PageRepository;
  readonly pageDependencies: CreatePageDependencies;
  readonly authorize: PageAuthorizer;
}

type Actor = {
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
};

export type PageAuthorization =
  | { readonly ok: true; readonly actor: Actor }
  | {
      readonly ok: false;
      readonly statusCode: 401 | 403;
      readonly error: string;
    };

export type PageAuthorizer = (
  request: FastifyRequest,
  requireCsrf: boolean,
) => Promise<PageAuthorization>;

export function registerPageRoutes(
  app: FastifyInstance,
  options: PageRouteOptions,
): void {
  app.post("/api/v1/pages", async (request, reply) => {
    const authorization = await options.authorize(request, true);
    if (!authorization.ok) {
      return reply
        .code(authorization.statusCode)
        .send({ error: authorization.error });
    }
    const parsed = pageBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid page request" });
    }
    const mutation = createPage(
      { ...parsed.data, ...authorization.actor },
      options.pageDependencies,
    );
    await options.pageRepository.create(mutation);
    return reply.code(201).send({ page: mutation.page, revisionNumber: 1 });
  });

  app.get("/api/v1/pages", async (request, reply) => {
    const authorization = await options.authorize(request, false);
    if (!authorization.ok) {
      return reply
        .code(authorization.statusCode)
        .send({ error: authorization.error });
    }
    return { pages: await options.pageRepository.list() };
  });

  app.get("/api/v1/pages/:id", async (request, reply) => {
    const authorization = await options.authorize(request, false);
    if (!authorization.ok) {
      return reply
        .code(authorization.statusCode)
        .send({ error: authorization.error });
    }
    const id = parsePageId(request.params);
    if (!id) return reply.code(400).send({ error: "invalid page ID" });
    const page = await options.pageRepository.getById(id);
    if (!page) return reply.code(404).send({ error: "page not found" });
    return page;
  });

  app.patch("/api/v1/pages/:id", async (request, reply) => {
    const authorization = await options.authorize(request, true);
    if (!authorization.ok) {
      return reply
        .code(authorization.statusCode)
        .send({ error: authorization.error });
    }
    const id = parsePageId(request.params);
    if (!id) return reply.code(400).send({ error: "invalid page ID" });
    const expectedRevisionNumber = parseExpectedRevision(
      request.headers["if-match"],
    );
    if (!expectedRevisionNumber) {
      return reply.code(400).send({ error: "invalid page revision" });
    }
    const parsed = pageBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid page request" });
    }
    const current = await options.pageRepository.getById(id);
    if (!current) return reply.code(404).send({ error: "page not found" });
    if (current.revisionNumber !== expectedRevisionNumber) {
      return reply.code(409).send({ error: "page revision conflict" });
    }
    const mutation = updatePage(
      current.page,
      current.revisionNumber,
      { ...parsed.data, ...authorization.actor },
      options.pageDependencies,
    );
    try {
      await options.pageRepository.update(mutation);
    } catch (error) {
      if (error instanceof PageRevisionConflictError) {
        return reply.code(409).send({ error: "page revision conflict" });
      }
      throw error;
    }
    return {
      page: mutation.page,
      revisionNumber: mutation.revision.revisionNumber,
    };
  });
}

function parseExpectedRevision(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const revisionNumber = Number(value);
  return Number.isSafeInteger(revisionNumber) ? revisionNumber : null;
}

function parsePageId(params: unknown) {
  const parsed = pageParams.safeParse(params);
  return parsed.success ? asNativeId(parsed.data.id) : null;
}
