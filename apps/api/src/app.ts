import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";

export function buildApp(): FastifyInstance {
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

  return app;
}
