import { createHash } from "node:crypto";
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import type { AssetService } from "../../../packages/assets/src/asset-service.ts";
import type { AssetStore } from "../../../packages/assets/src/asset-storage.ts";
import type { AssetMetadataRepository } from "../../../packages/database/src/asset-metadata-repository.ts";
import { normaliseAssetMetadata } from "../../../packages/domain/src/asset.ts";
import {
  asNativeId,
  ValidationError,
} from "../../../packages/domain/src/ids.ts";
import type { PageAuthorization, PageAuthorizer } from "./page-routes.ts";

type AssetActor = Extract<PageAuthorization, { readonly ok: true }>["actor"];

export interface AssetRouteOptions {
  readonly assetService: Pick<AssetService, "create">;
  readonly assetRepository: AssetMetadataRepository;
  readonly assetStore: AssetStore;
  readonly authorize: PageAuthorizer;
  readonly requestId: () => string;
  readonly maxAssetBytes: number;
}

export function registerAssetRoutes(
  app: FastifyInstance,
  options: AssetRouteOptions,
): void {
  const authorizedActors = new WeakMap<FastifyRequest, AssetActor>();

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: options.maxAssetBytes },
    (_request, body, done) => done(null, body),
  );

  app.post(
    "/api/v1/assets",
    {
      bodyLimit: options.maxAssetBytes,
      async onRequest(request, reply) {
        const authorization = await options.authorize(request, true);
        if (!authorization.ok) {
          await reply
            .code(authorization.statusCode)
            .send({ error: authorization.error });
          return;
        }
        if (request.headers["content-type"] !== "application/octet-stream") {
          await reply
            .code(415)
            .send({ error: "unsupported asset content type" });
          return;
        }
        authorizedActors.set(request, authorization.actor);
      },
      errorHandler(error, _request, reply) {
        return sendAssetParserError(reply, error);
      },
    },
    async (request, reply) => {
      const actor = authorizedActors.get(request);
      if (!actor) {
        return reply.code(401).send({ error: "authentication required" });
      }
      try {
        const metadata = normaliseAssetMetadata({
          originalFilename: decodeFilename(
            request.headers["x-nativepos-filename"],
          ),
          mimeType: requireSingleHeader(
            request.headers["x-nativepos-media-type"],
          ),
        });
        const bytes = request.body;
        if (!Buffer.isBuffer(bytes)) {
          throw new ValidationError("asset bytes are invalid");
        }
        const asset = await options.assetService.create({
          ...metadata,
          bytes: Uint8Array.from(bytes),
          actorType: actor.actorType,
          actorId: actor.actorId,
          source: "nativepos.browser",
          requestId: options.requestId(),
        });
        return reply.code(201).send({ asset });
      } catch (error) {
        if (error instanceof ValidationError) {
          return reply.code(400).send({ error: "invalid asset request" });
        }
        return reply.code(500).send({ error: "asset creation failed" });
      }
    },
  );

  app.get("/api/v1/assets", async (request, reply) => {
    if (!(await authorizeRead(request, reply, options.authorize))) return;
    const limit = parseListLimit(request.query);
    if (limit === null) {
      return reply.code(400).send({ error: "invalid asset query" });
    }
    try {
      return { assets: await options.assetRepository.list(limit) };
    } catch {
      return reply.code(500).send({ error: "asset listing failed" });
    }
  });

  app.get("/api/v1/assets/:id/content", async (request, reply) => {
    if (!(await authorizeRead(request, reply, options.authorize))) return;
    const id = parseAssetId(request.params);
    if (!id) return reply.code(400).send({ error: "invalid asset ID" });

    let persisted;
    try {
      persisted = await options.assetRepository.getById(id);
    } catch {
      return reply.code(500).send({ error: "asset retrieval failed" });
    }
    if (!persisted) return reply.code(404).send({ error: "asset not found" });

    try {
      const bytes = await options.assetStore.read(persisted.asset.storageKey);
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (
        bytes.byteLength !== persisted.asset.byteSize ||
        checksum !== persisted.asset.sha256
      ) {
        throw new ValidationError("asset integrity mismatch");
      }
      const body = Buffer.from(bytes);
      return reply
        .header("content-type", "application/octet-stream")
        .header("x-content-type-options", "nosniff")
        .header(
          "content-disposition",
          `attachment; filename="asset-${persisted.asset.id}"`,
        )
        .header("content-length", String(body.byteLength))
        .send(body);
    } catch {
      return reply.code(409).send({ error: "asset integrity check failed" });
    }
  });
}

async function authorizeRead(
  request: FastifyRequest,
  reply: FastifyReply,
  authorize: PageAuthorizer,
): Promise<boolean> {
  const authorization = await authorize(request, false);
  if (!authorization.ok) {
    await reply
      .code(authorization.statusCode)
      .send({ error: authorization.error });
    return false;
  }
  return true;
}

function parseListLimit(query: unknown): number | null {
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    return null;
  }
  const entries = Object.entries(query);
  if (entries.length === 0) return 50;
  if (entries.length !== 1 || entries[0]?.[0] !== "limit") return null;
  const value = entries[0][1];
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit <= 100 ? limit : null;
}

function parseAssetId(params: unknown) {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return null;
  }
  const id = (params as { readonly id?: unknown }).id;
  if (typeof id !== "string") return null;
  try {
    return asNativeId(id);
  } catch {
    return null;
  }
}

function decodeFilename(value: unknown): string {
  const encoded = requireSingleHeader(value);
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new ValidationError("asset filename encoding is invalid");
  }
}

function requireSingleHeader(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes(",")) {
    throw new ValidationError("asset metadata header is invalid");
  }
  return value;
}

function sendAssetParserError(reply: FastifyReply, error: FastifyError) {
  if (error.statusCode === 413 || error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return reply.code(413).send({ error: "asset exceeds configured limit" });
  }
  if (error.statusCode === 415) {
    return reply.code(415).send({ error: "unsupported asset content type" });
  }
  return reply.code(500).send({ error: "asset creation failed" });
}
