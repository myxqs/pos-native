import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import type { AssetService } from "../../../packages/assets/src/asset-service.ts";
import { normaliseAssetMetadata } from "../../../packages/domain/src/asset.ts";
import { ValidationError } from "../../../packages/domain/src/ids.ts";
import type { PageAuthorization, PageAuthorizer } from "./page-routes.ts";

type AssetActor = Extract<PageAuthorization, { readonly ok: true }>["actor"];

export interface AssetRouteOptions {
  readonly assetService: Pick<AssetService, "create">;
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
