import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthenticationService } from "../../../packages/auth/src/session.ts";
import type { PageAuthorizer } from "./page-routes.ts";

const loginBody = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(1).max(1024),
  })
  .strict();

export interface AuthenticationRouteOptions {
  readonly authenticationService: AuthenticationService;
  readonly secureCookies: boolean;
}

export function registerAuthenticationRoutes(
  app: FastifyInstance,
  options: AuthenticationRouteOptions,
): PageAuthorizer {
  const cookieOptions = {
    path: "/",
    sameSite: "strict" as const,
    secure: options.secureCookies,
  };

  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(401).send({ error: "invalid credentials" });
      }
      try {
        const login = await options.authenticationService.login(
          parsed.data.email,
          parsed.data.password,
        );
        reply.setCookie("pos_session", login.sessionToken, {
          ...cookieOptions,
          httpOnly: true,
          expires: new Date(login.expiresAt),
        });
        reply.setCookie("pos_csrf", login.csrfToken, {
          ...cookieOptions,
          httpOnly: false,
          expires: new Date(login.expiresAt),
        });
        return { authenticated: true };
      } catch {
        return reply.code(401).send({ error: "invalid credentials" });
      }
    },
  );

  const authorize = createAuthorizer(options.authenticationService);

  app.get("/api/v1/auth/session", async (request, reply) => {
    const authorization = await authorize(request, false);
    if (!authorization.ok) {
      return reply
        .code(authorization.statusCode)
        .send({ authenticated: false });
    }
    return { authenticated: true };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const authorization = await authorize(request, true);
    if (!authorization.ok) {
      return reply
        .code(authorization.statusCode)
        .send({ error: authorization.error });
    }
    await options.authenticationService.logout(
      request.cookies.pos_session ?? "",
    );
    reply.clearCookie("pos_session", cookieOptions);
    reply.clearCookie("pos_csrf", cookieOptions);
    return reply.code(204).send();
  });

  return authorize;
}

function createAuthorizer(
  authenticationService: AuthenticationService,
): PageAuthorizer {
  return async (request: FastifyRequest, requireCsrf: boolean) => {
    const sessionToken = request.cookies.pos_session;
    if (!sessionToken) {
      return { ok: false, statusCode: 401, error: "authentication required" };
    }
    try {
      const session = await authenticationService.authenticate(sessionToken);
      if (requireCsrf) {
        const csrfCookie = request.cookies.pos_csrf;
        const csrfHeader = request.headers["x-pos-csrf"];
        if (
          !csrfCookie ||
          typeof csrfHeader !== "string" ||
          csrfHeader !== csrfCookie
        ) {
          return {
            ok: false,
            statusCode: 403,
            error: "CSRF validation failed",
          };
        }
        await authenticationService.requireCsrf(sessionToken, csrfHeader);
      }
      return {
        ok: true,
        actor: {
          actorType: "user" as const,
          actorId: session.userId,
          source: "human-ui",
        },
      };
    } catch {
      return { ok: false, statusCode: 401, error: "authentication required" };
    }
  };
}
