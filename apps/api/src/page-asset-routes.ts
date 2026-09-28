import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AssetMetadataRepository } from "../../../packages/database/src/asset-metadata-repository.ts";
import {
  PageAssetLinkConflictError,
  type PageAssetLinkRepository,
} from "../../../packages/database/src/page-asset-link-repository.ts";
import type { PageRepository } from "../../../packages/database/src/page-repository.ts";
import { asNativeId } from "../../../packages/domain/src/ids.ts";
import {
  createPageAssetLink,
  archivePageAssetLink,
  type PageAssetLinkDependencies,
} from "../../../packages/domain/src/page-asset-link.ts";
import type { PageAuthorizer } from "./page-routes.ts";

export function registerPageAssetRoutes(
  app: FastifyInstance,
  options: {
    readonly pageRepository: PageRepository;
    readonly assetRepository: AssetMetadataRepository;
    readonly pageAssetLinkRepository: PageAssetLinkRepository;
    readonly dependencies: PageAssetLinkDependencies;
    readonly authorize: PageAuthorizer;
  },
): void {
  app.get("/api/v1/pages/:pageId/assets", async (request, reply) => {
    if (!(await authorize(request, reply, options.authorize, false))) return;
    const ids = parseIds(request.params, false);
    if (!ids) return reply.code(400).send({ error: "invalid page ID" });
    const persistedPage = await options.pageRepository.getById(ids.pageId);
    if (!persistedPage)
      return reply.code(404).send({ error: "page not found" });
    try {
      const history = parseHistory(request.query);
      if (history === null)
        return reply.code(400).send({ error: "invalid page asset query" });
      const links = await options.pageAssetLinkRepository.listForPage(
        ids.pageId,
        history,
      );
      const items = await Promise.all(
        links.map(async (link) => {
          const persisted = await options.assetRepository.getById(link.assetId);
          if (!persisted) throw new Error("linked asset is missing");
          const asset = persisted.asset;
          return {
            link,
            asset: {
              id: asset.id,
              originalFilename: asset.originalFilename,
              mimeType: asset.mimeType,
              byteSize: asset.byteSize,
              createdAt: asset.createdAt,
            },
          };
        }),
      );
      return { items };
    } catch {
      return reply.code(500).send({ error: "linked asset listing failed" });
    }
  });

  app.post("/api/v1/pages/:pageId/assets/:assetId", async (request, reply) => {
    const actor = await authorize(request, reply, options.authorize, true);
    if (!actor) return;
    const ids = parseIds(request.params, true);
    if (!ids?.assetId)
      return reply.code(400).send({ error: "invalid page or asset ID" });
    const persistedPage = await options.pageRepository.getById(ids.pageId);
    if (!persistedPage)
      return reply.code(404).send({ error: "page not found" });
    if (persistedPage.page.archivedAt !== null)
      return reply.code(409).send({ error: "page is archived" });
    if (!(await options.assetRepository.getById(ids.assetId)))
      return reply.code(404).send({ error: "asset not found" });
    try {
      const mutation = createPageAssetLink(
        {
          pageId: ids.pageId,
          assetId: ids.assetId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          source: "nativepos.browser",
        },
        options.dependencies,
      );
      const link = await options.pageAssetLinkRepository.create(mutation);
      return reply.code(201).send({ link });
    } catch (error) {
      if (error instanceof PageAssetLinkConflictError)
        return reply.code(409).send({ error: "asset is already linked" });
      return reply.code(500).send({ error: "asset link creation failed" });
    }
  });

  app.delete(
    "/api/v1/pages/:pageId/assets/:assetId",
    async (request, reply) => {
      const actor = await authorize(request, reply, options.authorize, true);
      if (!actor) return;
      const ids = parseIds(request.params, true);
      if (!ids?.assetId)
        return reply.code(400).send({ error: "invalid page or asset ID" });
      const persistedPage = await options.pageRepository.getById(ids.pageId);
      if (!persistedPage)
        return reply.code(404).send({ error: "page not found" });
      if (persistedPage.page.archivedAt !== null)
        return reply.code(409).send({ error: "page is archived" });
      if (!(await options.assetRepository.getById(ids.assetId)))
        return reply.code(404).send({ error: "asset not found" });
      const active = await options.pageAssetLinkRepository.getActive(
        ids.pageId,
        ids.assetId,
      );
      if (!active)
        return reply.code(404).send({ error: "page asset link not found" });
      try {
        const mutation = archivePageAssetLink(
          active.link,
          active.revisionNumber,
          {
            actorType: actor.actorType,
            actorId: actor.actorId,
            source: "nativepos.browser",
          },
          options.dependencies,
        );
        const link = await options.pageAssetLinkRepository.archive(mutation);
        return { link };
      } catch (error) {
        if (error instanceof PageAssetLinkConflictError)
          return reply.code(409).send({ error: "page asset link changed" });
        return reply.code(500).send({ error: "asset unlink failed" });
      }
    },
  );
}

function parseHistory(query: unknown): "active" | "all" | null {
  if (typeof query !== "object" || query === null || Array.isArray(query))
    return null;
  const entries = Object.entries(query);
  if (entries.length === 0) return "active";
  return entries.length === 1 &&
    entries[0]?.[0] === "history" &&
    entries[0][1] === "all"
    ? "all"
    : null;
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  authorizer: PageAuthorizer,
  csrf: boolean,
) {
  const result = await authorizer(request, csrf);
  if (!result.ok) {
    await reply.code(result.statusCode).send({ error: result.error });
    return null;
  }
  return result.actor;
}

function parseIds(
  params: unknown,
  requireAsset: boolean,
): {
  pageId: ReturnType<typeof asNativeId>;
  assetId?: ReturnType<typeof asNativeId>;
} | null {
  if (typeof params !== "object" || params === null) return null;
  const value = params as Record<string, unknown>;
  try {
    if (
      typeof value.pageId !== "string" ||
      (requireAsset && typeof value.assetId !== "string")
    )
      return null;
    const pageId = asNativeId(value.pageId);
    const assetId = requireAsset
      ? asNativeId(value.assetId as string)
      : undefined;
    return { pageId, ...(assetId ? { assetId } : {}) };
  } catch {
    return null;
  }
}
