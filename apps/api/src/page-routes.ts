import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuditActorType } from "../../../packages/domain/src/audit.ts";
import {
  asNativeId,
  type NativeId,
  ValidationError,
} from "../../../packages/domain/src/ids.ts";
import {
  archivePage,
  createPage,
  movePage,
  PageArchiveStateError,
  restorePage,
  type CreatePageDependencies,
  updatePage,
} from "../../../packages/domain/src/page.ts";
import {
  PageHierarchyError,
  PageRevisionConflictError,
  type PageRepository,
} from "../../../packages/database/src/page-repository.ts";

const nativeIdInput = z.string().uuid().refine(isNativeId);
const pageTitleBody = z
  .object({ title: z.string().trim().min(1).max(500) })
  .strict();
const pageCreateBody = pageTitleBody.extend({
  parentId: nativeIdInput.nullable().optional(),
});
const pageParentBody = z
  .object({ parentId: nativeIdInput.nullable() })
  .strict();
const emptyBody = z.object({}).strict();
const pageParams = z.object({ id: nativeIdInput });
const pageListQuery = z
  .object({ archived: z.literal("only").optional() })
  .strict();

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
    const parsed = pageCreateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid page request" });
    }
    try {
      const parentId =
        parsed.data.parentId === undefined
          ? undefined
          : parseParentId(parsed.data.parentId);
      const mutation = createPage(
        {
          title: parsed.data.title,
          ...(parentId === undefined ? {} : { parentId }),
          ...authorization.actor,
        },
        options.pageDependencies,
      );
      await options.pageRepository.create(mutation);
      return reply.code(201).send({
        page: mutation.page,
        revisionNumber: mutation.revision.revisionNumber,
      });
    } catch (error) {
      return sendPageMutationError(reply, error);
    }
  });

  app.get("/api/v1/pages", async (request, reply) => {
    const authorization = await options.authorize(request, false);
    if (!authorization.ok) {
      return reply
        .code(authorization.statusCode)
        .send({ error: authorization.error });
    }
    const parsed = pageListQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid page query" });
    }
    return {
      pages: await options.pageRepository.list(
        parsed.data.archived === "only" ? "archived" : "active",
      ),
    };
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
    const parsed = pageTitleBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid page request" });
    }
    const current = await options.pageRepository.getById(id);
    if (!current) return reply.code(404).send({ error: "page not found" });
    if (current.revisionNumber !== expectedRevisionNumber) {
      return reply.code(409).send({ error: "page revision conflict" });
    }
    try {
      const mutation = updatePage(
        current.page,
        current.revisionNumber,
        { title: parsed.data.title, ...authorization.actor },
        options.pageDependencies,
      );
      await options.pageRepository.update(mutation);
      return {
        page: mutation.page,
        revisionNumber: mutation.revision.revisionNumber,
      };
    } catch (error) {
      return sendPageMutationError(reply, error);
    }
  });

  app.put("/api/v1/pages/:id/parent", async (request, reply) => {
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
    const parsed = pageParentBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid page request" });
    }
    const current = await options.pageRepository.getById(id);
    if (!current) return reply.code(404).send({ error: "page not found" });
    if (current.revisionNumber !== expectedRevisionNumber) {
      return reply.code(409).send({ error: "page revision conflict" });
    }

    try {
      const mutation = movePage(
        current.page,
        current.revisionNumber,
        {
          parentId: parseParentId(parsed.data.parentId),
          ...authorization.actor,
        },
        options.pageDependencies,
      );
      await options.pageRepository.update(mutation);
      return {
        page: mutation.page,
        revisionNumber: mutation.revision.revisionNumber,
      };
    } catch (error) {
      return sendPageMutationError(reply, error);
    }
  });

  app.post("/api/v1/pages/:id/archive", async (request, reply) => {
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
    if (!emptyBody.safeParse(request.body).success) {
      return reply.code(400).send({ error: "invalid page request" });
    }
    const current = await options.pageRepository.getById(id);
    if (!current) return reply.code(404).send({ error: "page not found" });
    if (current.revisionNumber !== expectedRevisionNumber) {
      return reply.code(409).send({ error: "page revision conflict" });
    }

    try {
      const mutation = archivePage(
        current.page,
        current.revisionNumber,
        authorization.actor,
        options.pageDependencies,
      );
      await options.pageRepository.update(mutation);
      return {
        page: mutation.page,
        revisionNumber: mutation.revision.revisionNumber,
      };
    } catch (error) {
      return sendPageMutationError(reply, error);
    }
  });

  app.put("/api/v1/pages/:id/restore", async (request, reply) => {
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
    const parsed = pageParentBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid page request" });
    }
    const current = await options.pageRepository.getById(id);
    if (!current) return reply.code(404).send({ error: "page not found" });
    if (current.revisionNumber !== expectedRevisionNumber) {
      return reply.code(409).send({ error: "page revision conflict" });
    }

    try {
      const mutation = restorePage(
        current.page,
        current.revisionNumber,
        {
          parentId: parseParentId(parsed.data.parentId),
          ...authorization.actor,
        },
        options.pageDependencies,
      );
      await options.pageRepository.update(mutation);
      return {
        page: mutation.page,
        revisionNumber: mutation.revision.revisionNumber,
      };
    } catch (error) {
      return sendPageMutationError(reply, error);
    }
  });
}

function parseExpectedRevision(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const revisionNumber = Number(value);
  return Number.isSafeInteger(revisionNumber) ? revisionNumber : null;
}

function parsePageId(params: unknown): NativeId | null {
  const parsed = pageParams.safeParse(params);
  if (!parsed.success) return null;
  try {
    return asNativeId(parsed.data.id);
  } catch {
    return null;
  }
}

function parseParentId(parentId: string | null): NativeId | null {
  return parentId === null ? null : asNativeId(parentId);
}

function isNativeId(value: string): boolean {
  try {
    asNativeId(value);
    return true;
  } catch {
    return false;
  }
}

function sendPageMutationError(reply: FastifyReply, error: unknown) {
  if (error instanceof PageRevisionConflictError) {
    return reply.code(409).send({ error: "page revision conflict" });
  }
  if (error instanceof PageHierarchyError) {
    return reply.code(400).send({ error: "invalid page hierarchy" });
  }
  if (error instanceof PageArchiveStateError) {
    return reply.code(409).send({
      error:
        error.message === "page is not archived"
          ? "page is not archived"
          : "page is archived",
    });
  }
  if (error instanceof ValidationError) {
    return reply.code(400).send({ error: "invalid page request" });
  }
  throw error;
}
