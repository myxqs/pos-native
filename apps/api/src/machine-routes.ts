import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { MachineKnowledgeService } from "../../../packages/database/src/machine-knowledge-service.ts";
import {
  MachineContractError,
  type MachineQuery,
  type MachineTraversalRequest,
} from "../../../packages/domain/src/machine.ts";
import type { PageAuthorizer } from "./page-routes.ts";

const uuid = z.string().uuid();
const propertyFilter = z
  .object({
    propertyId: uuid,
    operator: z.enum(["eq", "contains", "gt", "gte", "lt", "lte"]),
    value: z.union([z.string(), z.boolean()]),
  })
  .strict();
const query = z
  .object({
    entityTypeId: uuid,
    ids: z.array(uuid).min(1).max(100).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    properties: z.array(propertyFilter).min(1).max(20).optional(),
    relationTargetId: uuid.optional(),
    archived: z.boolean().optional(),
    sort: z.enum(["title", "createdAt"]).optional(),
    direction: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(100),
    cursor: z.string().min(1).max(1000).optional(),
  })
  .strict();
const traversal = z
  .object({
    rootId: uuid,
    direction: z.enum(["outgoing", "incoming", "both"]),
    relationshipId: uuid.optional(),
    depth: z.number().int().min(1).max(3),
    nodeLimit: z.number().int().min(1).max(100),
  })
  .strict();
const context = z
  .object({
    recordId: uuid,
    maxProperties: z.number().int().min(0).max(100),
    maxRelations: z.number().int().min(0).max(100),
  })
  .strict();

export function registerMachineRoutes(
  app: FastifyInstance,
  options: {
    readonly service: MachineKnowledgeService;
    readonly authorize: PageAuthorizer;
  },
): void {
  app.get("/api/v1/machine/capabilities", async (request, reply) => {
    if (!(await authorized(request, reply, options.authorize))) return;
    return {
      apiVersion: "m5-v1",
      provider: "nativepos",
      limits: {
        query: 100,
        traversalDepth: 3,
        traversalNodes: 100,
        contextProperties: 100,
        contextRelations: 100,
      },
      mutationEndpoints: [
        "property.set",
        "relation.add",
        "relation.remove",
        "entity.update-title",
        "entity.archive",
        "entity.restore",
      ],
    };
  });
  app.get("/api/v1/machine/schema", async (request, reply) => {
    if (!(await authorized(request, reply, options.authorize))) return;
    return guarded(reply, async () => ({
      entityTypes: await options.service.listEntityTypes(),
    }));
  });
  app.get("/api/v1/machine/schema/:id", async (request, reply) => {
    if (!(await authorized(request, reply, options.authorize))) return;
    const parsed = z
      .object({ id: z.union([uuid, z.literal("page")]) })
      .safeParse(request.params);
    if (!parsed.success) return invalid(reply);
    return guarded(reply, () =>
      options.service.describeEntityType(parsed.data.id),
    );
  });
  app.get("/api/v1/machine/entities/:id", async (request, reply) => {
    if (!(await authorized(request, reply, options.authorize))) return;
    const parsed = z.object({ id: uuid }).safeParse(request.params);
    if (!parsed.success) return invalid(reply);
    return guarded(reply, () => options.service.get(parsed.data.id));
  });
  app.get("/api/v1/machine/entities/:id/history", async (request, reply) => {
    if (!(await authorized(request, reply, options.authorize))) return;
    const parsed = z.object({ id: uuid }).safeParse(request.params);
    const bounds = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
      .strict()
      .safeParse(request.query);
    if (!parsed.success || !bounds.success) return invalid(reply);
    return guarded(reply, () =>
      options.service.history(parsed.data.id, bounds.data.limit),
    );
  });
  app.post("/api/v1/machine/query", async (request, reply) => {
    if (!(await authorized(request, reply, options.authorize))) return;
    const parsed = query.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    return guarded(reply, () =>
      options.service.query(withoutUndefined(parsed.data) as MachineQuery),
    );
  });
  app.post("/api/v1/machine/traverse", async (request, reply) => {
    if (!(await authorized(request, reply, options.authorize))) return;
    const parsed = traversal.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    return guarded(reply, () =>
      options.service.traverse(
        withoutUndefined(parsed.data) as MachineTraversalRequest,
      ),
    );
  });
  app.post("/api/v1/machine/context", async (request, reply) => {
    if (!(await authorized(request, reply, options.authorize))) return;
    const parsed = context.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    return guarded(reply, () => options.service.context(parsed.data));
  });
}

async function authorized(
  request: FastifyRequest,
  reply: FastifyReply,
  authorize: PageAuthorizer,
) {
  const result = await authorize(request, false);
  if (!result.ok) {
    reply.code(result.statusCode).send({ error: result.error });
    return false;
  }
  return true;
}
function invalid(reply: FastifyReply) {
  return reply
    .code(400)
    .send({ error: "machine request is invalid", code: "INVALID_REQUEST" });
}
async function guarded(reply: FastifyReply, operation: () => Promise<unknown>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MachineContractError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "REVISION_CONFLICT"
            ? 409
            : 400;
      return reply.code(status).send({
        error:
          error.code === "INVALID_QUERY"
            ? "machine query is invalid"
            : error.code === "NOT_FOUND"
              ? "machine resource not found"
              : "machine request is invalid",
        code: error.code,
      });
    }
    return reply
      .code(500)
      .send({ error: "machine operation failed", code: "INTERNAL_ERROR" });
  }
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
