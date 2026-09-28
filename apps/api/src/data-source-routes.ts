import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DataSourceRepository } from "../../../packages/database/src/data-source-repository.ts";
import {
  createDataSource,
  createDataSourceItem,
  createPropertyDefinition,
  type DataSourceDependencies,
} from "../../../packages/domain/src/data-source.ts";
import {
  asNativeId,
  ValidationError,
} from "../../../packages/domain/src/ids.ts";
import type { PageAuthorizer } from "./page-routes.ts";

const id = z.string().uuid();
const idParams = z.object({ id });
const definitionParams = z.object({ id, definitionId: id });
const edgeParams = z.object({ id });
const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict();
const sourceBody = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();
const definitionBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum([
      "text",
      "number",
      "checkbox",
      "select",
      "multi-select",
      "status",
      "date",
      "datetime",
      "url",
      "email",
      "phone",
      "relation",
    ]),
    options: z.array(z.string()).optional(),
    targetSourceId: id.optional(),
  })
  .strict();
const itemBody = z
  .object({
    title: z.string().trim().min(1).max(500),
    parentId: id.nullable().optional(),
  })
  .strict();
const valueBody = z.object({ value: z.unknown() }).strict();
const relationBody = z.object({ targetRecordId: id }).strict();

export interface DataSourceRouteOptions {
  readonly repository: DataSourceRepository;
  readonly dependencies: DataSourceDependencies;
  readonly authorize: PageAuthorizer;
}

export function registerDataSourceRoutes(
  app: FastifyInstance,
  options: DataSourceRouteOptions,
): void {
  app.get("/api/v1/data-sources", async (request, reply) => {
    const actor = await authorized(request, reply, options, false);
    if (!actor) return;
    const query = listQuery.safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ error: "invalid data source query" });
    return guarded(reply, async () => ({
      sources: await options.repository.listSources(query.data),
    }));
  });

  app.post("/api/v1/data-sources", async (request, reply) => {
    const actor = await authorized(request, reply, options, true);
    if (!actor) return;
    const body = sourceBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "invalid data source request" });
    return guarded(reply, async () => {
      const mutation = createDataSource(
        { ...body.data, ...actor },
        options.dependencies,
      );
      return reply.code(201).send({
        source: await options.repository.createSource(mutation),
      });
    });
  });

  app.get("/api/v1/data-sources/:id/definitions", async (request, reply) => {
    if (!(await authorized(request, reply, options, false))) return;
    const sourceId = parsedId(request.params);
    if (!sourceId)
      return reply.code(400).send({ error: "invalid data source ID" });
    return guarded(reply, async () => ({
      definitions: await options.repository.listDefinitions(sourceId),
    }));
  });

  app.post("/api/v1/data-sources/:id/definitions", async (request, reply) => {
    const actor = await authorized(request, reply, options, true);
    if (!actor) return;
    const sourceId = parsedId(request.params);
    const body = definitionBody.safeParse(request.body);
    if (!sourceId || !body.success)
      return reply
        .code(400)
        .send({ error: "invalid property definition request" });
    return guarded(reply, async () => {
      const source = await options.repository.getSource(sourceId);
      if (!source)
        return reply.code(404).send({ error: "data source not found" });
      const mutation = createPropertyDefinition(
        source,
        {
          ...body.data,
          targetSourceId: body.data.targetSourceId
            ? asNativeId(body.data.targetSourceId)
            : undefined,
          ...actor,
        },
        options.dependencies,
      );
      return reply.code(201).send({
        definition: await options.repository.createDefinition(
          sourceId,
          mutation,
        ),
      });
    });
  });

  app.get("/api/v1/data-sources/:id/items", async (request, reply) => {
    if (!(await authorized(request, reply, options, false))) return;
    const sourceId = parsedId(request.params);
    const query = listQuery.safeParse(request.query);
    if (!sourceId || !query.success)
      return reply.code(400).send({ error: "invalid record query" });
    return guarded(reply, async () => ({
      records: await options.repository.listItems(sourceId, query.data),
    }));
  });

  app.post("/api/v1/data-sources/:id/items", async (request, reply) => {
    const actor = await authorized(request, reply, options, true);
    if (!actor) return;
    const sourceId = parsedId(request.params);
    const body = itemBody.safeParse(request.body);
    if (!sourceId || !body.success)
      return reply.code(400).send({ error: "invalid record request" });
    return guarded(reply, async () => {
      const source = await options.repository.getSource(sourceId);
      if (!source)
        return reply.code(404).send({ error: "data source not found" });
      const mutation = createDataSourceItem(
        source,
        {
          title: body.data.title,
          ...(body.data.parentId === undefined
            ? {}
            : {
                parentId:
                  body.data.parentId === null
                    ? null
                    : asNativeId(body.data.parentId),
              }),
          ...actor,
        },
        options.dependencies,
      );
      await options.repository.createItem(sourceId, mutation);
      const record = await options.repository.getItem(mutation.item.id);
      return sendRecord(reply.code(201), record!);
    });
  });

  app.get("/api/v1/records/:id", async (request, reply) => {
    if (!(await authorized(request, reply, options, false))) return;
    const recordId = parsedId(request.params);
    if (!recordId) return reply.code(400).send({ error: "invalid record ID" });
    return guarded(reply, async () => {
      const record = await options.repository.getItem(recordId);
      if (!record) return reply.code(404).send({ error: "record not found" });
      return sendRecord(reply, record, {
        outgoing: await options.repository.outgoingRelations(recordId),
        incoming: await options.repository.incomingRelations(recordId),
      });
    });
  });

  app.put(
    "/api/v1/records/:id/properties/:definitionId",
    async (request, reply) => {
      const actor = await authorized(request, reply, options, true);
      if (!actor) return;
      const params = definitionParams.safeParse(request.params);
      const body = valueBody.safeParse(request.body);
      const revision = expectedRevision(request.headers["if-match"]);
      if (!params.success || !body.success || revision === null)
        return reply.code(400).send({ error: "invalid property request" });
      return guarded(reply, async () =>
        sendRecord(
          reply,
          await options.repository.setProperty(
            asNativeId(params.data.id),
            asNativeId(params.data.definitionId),
            {
              value: body.data.value,
              expectedPropertyRevisionNumber: revision,
              ...actor,
            },
            options.dependencies,
          ),
        ),
      );
    },
  );

  app.post(
    "/api/v1/records/:id/relations/:definitionId",
    async (request, reply) => {
      const actor = await authorized(request, reply, options, true);
      if (!actor) return;
      const params = definitionParams.safeParse(request.params);
      const body = relationBody.safeParse(request.body);
      const revision = expectedRevision(request.headers["if-match"]);
      if (!params.success || !body.success || revision === null)
        return reply.code(400).send({ error: "invalid relation request" });
      return guarded(reply, async () => {
        const recordId = asNativeId(params.data.id);
        const edge = await options.repository.addRelation(
          recordId,
          asNativeId(params.data.definitionId),
          asNativeId(body.data.targetRecordId),
          { expectedPropertyRevisionNumber: revision, ...actor },
          options.dependencies,
        );
        return sendRecord(
          reply.code(201),
          (await options.repository.getItem(recordId))!,
          { edge },
        );
      });
    },
  );

  app.delete("/api/v1/relations/:id", async (request, reply) => {
    const actor = await authorized(request, reply, options, true);
    if (!actor) return;
    const params = edgeParams.safeParse(request.params);
    const revision = expectedRevision(request.headers["if-match"]);
    if (!params.success || revision === null)
      return reply.code(400).send({ error: "invalid relation request" });
    return guarded(reply, async () => {
      const edge = await options.repository.removeRelation(
        asNativeId(params.data.id),
        { expectedPropertyRevisionNumber: revision, ...actor },
        options.dependencies,
      );
      return sendRecord(
        reply,
        (await options.repository.getItem(edge.sourceRecordId))!,
        { edge },
      );
    });
  });
}

async function authorized(
  request: FastifyRequest,
  reply: FastifyReply,
  options: DataSourceRouteOptions,
  requireCsrf: boolean,
) {
  const result = await options.authorize(request, requireCsrf);
  if (!result.ok) {
    reply.code(result.statusCode).send({ error: result.error });
    return null;
  }
  return result.actor;
}

function parsedId(value: unknown) {
  const parsed = idParams.safeParse(value);
  return parsed.success ? asNativeId(parsed.data.id) : null;
}

function expectedRevision(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^"([1-9]\d*)"$/u.exec(value);
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : null;
}

function sendRecord(
  reply: FastifyReply,
  record: { readonly propertyRevisionNumber: number },
  extra: Readonly<Record<string, unknown>> = {},
) {
  return reply
    .header("etag", `"${record.propertyRevisionNumber}"`)
    .send({ record, ...extra });
}

async function guarded(reply: FastifyReply, operation: () => Promise<unknown>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ValidationError) {
      if (error.message === "stale property revision")
        return reply.code(409).send({ error: "record revision conflict" });
      if (error.message.includes("already exists"))
        return reply.code(409).send({ error: "structured data conflict" });
      if (error.message.includes("does not exist"))
        return reply
          .code(404)
          .send({ error: "structured data resource not found" });
      return reply.code(400).send({ error: "invalid structured data request" });
    }
    return reply.code(500).send({ error: "structured data operation failed" });
  }
}
