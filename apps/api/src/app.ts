import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";

import { registerPageRoutes, type PageRouteOptions } from "./page-routes.ts";

export function buildApp(options?: PageRouteOptions): FastifyInstance {
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

  if (options) {
    registerPageRoutes(app, options);
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
