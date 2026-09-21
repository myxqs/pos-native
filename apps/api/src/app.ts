import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { AuthenticationService } from "../../../packages/auth/src/session.ts";
import type { BlockDocumentRepository } from "../../../packages/database/src/block-document-repository.ts";
import type { CreatePageDependencies } from "../../../packages/domain/src/page.ts";
import type { BlockDocumentDependencies } from "../../../packages/domain/src/block-document.ts";
import type { PageRepository } from "../../../packages/database/src/page-repository.ts";
import { registerAuthenticationRoutes } from "./auth-routes.ts";
import { registerBlockDocumentRoutes } from "./block-document-routes.ts";
import { registerPageRoutes, type PageAuthorizer } from "./page-routes.ts";
import {
  readWebAsset,
  resolveWebAssetRoot,
  type WebAssetName,
} from "./web-assets.ts";

export interface AppOptions {
  readonly authenticationService?: AuthenticationService;
  readonly secureCookies?: boolean;
  readonly webAssetRoot?: string;
  readonly pageRepository?: PageRepository;
  readonly pageDependencies?: CreatePageDependencies;
  readonly blockDocumentRepository?: BlockDocumentRepository;
  readonly blockDocumentDependencies?: BlockDocumentDependencies;
  readonly authorize?: PageAuthorizer;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  void app.register(cookie);
  void app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  });
  void app.register(rateLimit, { global: false });

  app.get("/health", { config: { rateLimit: false } }, () => ({
    status: "ok",
    service: "pos-native-api",
  }));

  app.get("/api/v1/system/manifest", { config: { rateLimit: false } }, () => ({
    apiVersion: "v1",
    service: "pos-native-api",
    mutationAccess: "not-enabled",
  }));

  registerWebShell(
    app,
    resolveWebAssetRoot(options.webAssetRoot ?? process.env.POS_WEB_ASSET_ROOT),
  );

  const authorize = options.authenticationService
    ? registerAuthenticationRoutes(app, {
        authenticationService: options.authenticationService,
        secureCookies: options.secureCookies ?? false,
      })
    : options.authorize;

  if (options.pageRepository && options.pageDependencies && authorize) {
    registerPageRoutes(app, {
      pageRepository: options.pageRepository,
      pageDependencies: options.pageDependencies,
      authorize,
    });
  }
  if (
    options.pageRepository &&
    options.blockDocumentRepository &&
    options.blockDocumentDependencies &&
    authorize
  ) {
    registerBlockDocumentRoutes(app, {
      pageRepository: options.pageRepository,
      blockDocumentRepository: options.blockDocumentRepository,
      blockDocumentDependencies: options.blockDocumentDependencies,
      authorize,
    });
  }

  return app;
}

function registerWebShell(app: FastifyInstance, webAssetRoot: string): void {
  const assets: Readonly<Record<string, readonly [WebAssetName, string]>> = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  };

  for (const [route, [assetName, contentType]] of Object.entries(assets)) {
    app.get(route, { config: { rateLimit: false } }, (_request, reply) =>
      reply.type(contentType).send(readWebAsset(webAssetRoot, assetName)),
    );
  }
}
