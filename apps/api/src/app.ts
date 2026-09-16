import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";

import type { AuthenticationService } from "../../../packages/auth/src/session.ts";
import type { CreatePageDependencies } from "../../../packages/domain/src/page.ts";
import type { PageRepository } from "../../../packages/database/src/page-repository.ts";
import { registerAuthenticationRoutes } from "./auth-routes.ts";
import { registerPageRoutes, type PageAuthorizer } from "./page-routes.ts";

export interface AppOptions {
  readonly authenticationService?: AuthenticationService;
  readonly secureCookies?: boolean;
  readonly pageRepository?: PageRepository;
  readonly pageDependencies?: CreatePageDependencies;
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

  registerWebShell(app);

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

  return app;
}

function registerWebShell(app: FastifyInstance): void {
  const assets = {
    "/": ["../../web/index.html", "text/html; charset=utf-8"],
    "/app.js": ["../../web/app.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["../../web/styles.css", "text/css; charset=utf-8"],
  } as const;

  for (const [route, [path, contentType]] of Object.entries(assets)) {
    app.get(route, { config: { rateLimit: false } }, (_request, reply) =>
      reply
        .type(contentType)
        .send(readFileSync(new URL(path, import.meta.url), "utf8")),
    );
  }
}
