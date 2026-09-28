import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { AuthenticationService } from "../../../packages/auth/src/session.ts";
import type { AssetService } from "../../../packages/assets/src/asset-service.ts";
import type { AssetStore } from "../../../packages/assets/src/asset-storage.ts";
import type { AssetMetadataRepository } from "../../../packages/database/src/asset-metadata-repository.ts";
import type { PageAssetLinkRepository } from "../../../packages/database/src/page-asset-link-repository.ts";
import type { BlockDocumentRepository } from "../../../packages/database/src/block-document-repository.ts";
import type { DataSourceRepository } from "../../../packages/database/src/data-source-repository.ts";
import type { DataSourceDependencies } from "../../../packages/domain/src/data-source.ts";
import type { CreatePageDependencies } from "../../../packages/domain/src/page.ts";
import type { PageAssetLinkDependencies } from "../../../packages/domain/src/page-asset-link.ts";
import type { BlockDocumentDependencies } from "../../../packages/domain/src/block-document.ts";
import type { PageRepository } from "../../../packages/database/src/page-repository.ts";
import type { SearchRepository } from "../../../packages/database/src/search-repository.ts";
import type { PageLinkRepository } from "../../../packages/database/src/page-link-repository.ts";
import type { PageLinkDependencies } from "../../../packages/domain/src/page-link.ts";
import { registerAuthenticationRoutes } from "./auth-routes.ts";
import { registerAssetRoutes } from "./asset-routes.ts";
import { registerBlockDocumentRoutes } from "./block-document-routes.ts";
import { registerDataSourceRoutes } from "./data-source-routes.ts";
import { registerPageRoutes, type PageAuthorizer } from "./page-routes.ts";
import { registerPageAssetRoutes } from "./page-asset-routes.ts";
import { registerSearchRoutes } from "./search-routes.ts";
import { registerPageLinkRoutes } from "./page-link-routes.ts";
import { registerPageContextRoutes } from "./page-context-routes.ts";
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
  readonly dataSourceRepository?: DataSourceRepository;
  readonly dataSourceDependencies?: DataSourceDependencies;
  readonly assetService?: Pick<AssetService, "create">;
  readonly assetRepository?: AssetMetadataRepository;
  readonly assetStore?: AssetStore;
  readonly assetRequestId?: () => string;
  readonly pageAssetLinkRepository?: PageAssetLinkRepository;
  readonly pageAssetLinkDependencies?: PageAssetLinkDependencies;
  readonly maxAssetBytes?: number;
  readonly searchRepository?: SearchRepository;
  readonly pageLinkRepository?: PageLinkRepository;
  readonly pageLinkDependencies?: PageLinkDependencies;
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
  if (options.searchRepository && authorize) {
    registerSearchRoutes(app, {
      repository: options.searchRepository,
      authorize,
    });
  }
  if (
    options.pageRepository &&
    options.pageLinkRepository &&
    options.pageLinkDependencies &&
    authorize
  )
    registerPageLinkRoutes(app, {
      pageRepository: options.pageRepository,
      repository: options.pageLinkRepository,
      dependencies: options.pageLinkDependencies,
      authorize,
    });
  if (options.pageRepository && options.pageLinkRepository && authorize)
    registerPageContextRoutes(app, {
      pageRepository: options.pageRepository,
      pageLinkRepository: options.pageLinkRepository,
      authorize,
    });
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
  if (
    options.pageRepository &&
    options.assetRepository &&
    options.pageAssetLinkRepository &&
    options.pageAssetLinkDependencies &&
    authorize
  ) {
    registerPageAssetRoutes(app, {
      pageRepository: options.pageRepository,
      assetRepository: options.assetRepository,
      pageAssetLinkRepository: options.pageAssetLinkRepository,
      dependencies: options.pageAssetLinkDependencies,
      authorize,
    });
  }
  if (
    options.dataSourceRepository &&
    options.dataSourceDependencies &&
    authorize
  ) {
    registerDataSourceRoutes(app, {
      repository: options.dataSourceRepository,
      dependencies: options.dataSourceDependencies,
      authorize,
    });
  }
  if (
    options.assetService &&
    options.assetRepository &&
    options.assetStore &&
    options.assetRequestId &&
    options.maxAssetBytes &&
    authorize
  ) {
    registerAssetRoutes(app, {
      assetService: options.assetService,
      assetRepository: options.assetRepository,
      assetStore: options.assetStore,
      requestId: options.assetRequestId,
      maxAssetBytes: options.maxAssetBytes,
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
