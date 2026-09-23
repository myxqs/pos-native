import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  BlockDocumentRevisionConflictError,
  replaceBlockDocument,
  type BlockDocumentDependencies,
} from "../../../packages/domain/src/block-document.ts";
import {
  asNativeId,
  ValidationError,
} from "../../../packages/domain/src/ids.ts";
import {
  BlockDocumentPageArchivedError,
  type BlockDocumentRepository,
} from "../../../packages/database/src/block-document-repository.ts";
import type { PageRepository } from "../../../packages/database/src/page-repository.ts";
import type { PageAuthorizer } from "./page-routes.ts";

const pageParams = z.object({ id: z.string().uuid() });
const blockDocumentBody = z
  .object({
    blocks: z
      .array(
        z
          .object({
            clientRef: z.string().min(1).max(128),
            id: z.string().uuid().optional(),
            parentClientRef: z.string().min(1).max(128).optional(),
            blockType: z.literal("paragraph"),
            content: z.object({ text: z.string() }).strict(),
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict();

export interface BlockDocumentRouteOptions {
  readonly pageRepository: PageRepository;
  readonly blockDocumentRepository: BlockDocumentRepository;
  readonly blockDocumentDependencies: BlockDocumentDependencies;
  readonly authorize: PageAuthorizer;
}

export function registerBlockDocumentRoutes(
  app: FastifyInstance,
  options: BlockDocumentRouteOptions,
): void {
  app.get("/api/v1/pages/:id/blocks", async (request, reply) => {
    const authorization = await options.authorize(request, false);
    if (!authorization.ok) {
      return reply
        .code(authorization.statusCode)
        .send({ error: authorization.error });
    }
    const pageId = parsePageId(request.params);
    if (!pageId) return reply.code(400).send({ error: "invalid page ID" });

    const page = await options.pageRepository.getById(pageId);
    if (!page) return reply.code(404).send({ error: "page not found" });

    const persisted = await options.blockDocumentRepository.getByPageId(pageId);
    if (!persisted) {
      return unavailableBlockDocumentState(reply);
    }
    return sendDocument(reply, persisted.document);
  });

  app.put("/api/v1/pages/:id/blocks", async (request, reply) => {
    const authorization = await options.authorize(request, true);
    if (!authorization.ok) {
      return reply
        .code(authorization.statusCode)
        .send({ error: authorization.error });
    }
    const pageId = parsePageId(request.params);
    if (!pageId) return reply.code(400).send({ error: "invalid page ID" });

    const expectedRevisionNumber = parseExpectedRevision(
      request.headers["if-match"],
    );
    if (expectedRevisionNumber === null) {
      return reply.code(400).send({ error: "invalid block document revision" });
    }
    const parsed = blockDocumentBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid block document" });
    }

    const page = await options.pageRepository.getById(pageId);
    if (!page) return reply.code(404).send({ error: "page not found" });
    if (page.page.archivedAt !== null) {
      return reply.code(409).send({ error: "page is archived" });
    }
    const persisted = await options.blockDocumentRepository.getByPageId(pageId);
    if (!persisted) {
      return unavailableBlockDocumentState(reply);
    }

    try {
      const result = replaceBlockDocument(
        persisted.document,
        {
          pageId,
          expectedRevisionNumber,
          blocks: parsed.data.blocks,
          ...authorization.actor,
        },
        options.blockDocumentDependencies,
      );
      if (result.kind === "unchanged") {
        return sendDocument(reply, result.document);
      }
      return sendDocument(
        reply,
        await options.blockDocumentRepository.replace(result.mutation),
      );
    } catch (error) {
      if (error instanceof BlockDocumentPageArchivedError) {
        return reply.code(409).send({ error: "page is archived" });
      }
      if (error instanceof BlockDocumentRevisionConflictError) {
        return reply
          .code(409)
          .send({ error: "block document revision conflict" });
      }
      if (error instanceof ValidationError) {
        return reply.code(400).send({ error: "invalid block document" });
      }
      throw error;
    }
  });
}

function parseExpectedRevision(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const matched = /^"(\d+)"$/u.exec(value);
  if (!matched) return null;
  const revisionNumber = Number(matched[1]);
  return Number.isSafeInteger(revisionNumber) ? revisionNumber : null;
}

function parsePageId(params: unknown) {
  const parsed = pageParams.safeParse(params);
  if (!parsed.success) return null;
  try {
    return asNativeId(parsed.data.id);
  } catch {
    return null;
  }
}

function sendDocument(
  reply: FastifyReply,
  document: { readonly revisionNumber: number },
) {
  return reply
    .header("etag", quoteRevision(document.revisionNumber))
    .send({ document });
}

function unavailableBlockDocumentState(reply: FastifyReply) {
  return reply.code(500).send({ error: "block document state is unavailable" });
}

function quoteRevision(revisionNumber: number): string {
  return '"' + String(revisionNumber) + '"';
}
