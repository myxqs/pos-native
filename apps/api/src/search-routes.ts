import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_QUERY_LENGTH,
  SearchQueryValidationError,
  type SearchRepository,
} from "../../../packages/database/src/search-repository.ts";
import type { PageAuthorizer } from "./page-routes.ts";

const searchQuery = z
  .object({
    q: z.string(),
    limit: z.coerce.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
  })
  .strict();

const searchResult = z.object({
  pageId: z.string().uuid(),
  pageTitle: z.string().max(500),
  snippet: z.string().refine((value) => [...value].length <= 240),
  matchSource: z.enum(["title", "paragraph"]),
  rank: z.union([
    z.literal(500),
    z.literal(450),
    z.literal(400),
    z.literal(350),
    z.literal(250),
    z.literal(200),
  ]),
});

export function registerSearchRoutes(
  app: FastifyInstance,
  options: {
    readonly repository: SearchRepository;
    readonly authorize: PageAuthorizer;
  },
): void {
  app.get(
    "/api/v1/search",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const authorization = await options.authorize(request, false);
      if (!authorization.ok) {
        return reply
          .code(authorization.statusCode)
          .send({ error: authorization.error });
      }
      const parsed = searchQuery.safeParse(request.query);
      const queryLength = parsed.success ? [...parsed.data.q.trim()].length : 0;
      if (
        !parsed.success ||
        queryLength < 2 ||
        queryLength > MAX_SEARCH_QUERY_LENGTH
      ) {
        return reply.code(400).send({ error: "invalid search query" });
      }
      try {
        const results = await options.repository.search({
          query: parsed.data.q,
          limit: parsed.data.limit ?? DEFAULT_SEARCH_LIMIT,
        });
        const safeResults = z
          .array(searchResult)
          .max(parsed.data.limit ?? DEFAULT_SEARCH_LIMIT)
          .parse(results);
        return reply.send({
          results: safeResults.map((result) => ({
            pageId: result.pageId,
            pageTitle: result.pageTitle,
            snippet: result.snippet,
            matchSource: result.matchSource,
            rank: result.rank,
          })),
        });
      } catch (error) {
        if (error instanceof SearchQueryValidationError) {
          return reply.code(400).send({ error: "invalid search query" });
        }
        return reply.code(500).send({ error: "search unavailable" });
      }
    },
  );
}
