import { expect, test, vi } from "vitest";

import {
  InMemoryBlockDocumentRepository,
  type BlockDocumentRepository,
} from "../../../packages/database/src/block-document-repository.ts";
import { InMemoryPageRepository } from "../../../packages/database/src/page-repository.ts";
import { archivePage, createPage } from "../../../packages/domain/src/page.ts";
import { buildApp } from "../src/app.ts";
import type { PageAuthorizer } from "../src/page-routes.ts";

const pageId = "11111111-1111-4111-8111-111111111111";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function blockDocumentApp(options?: {
  readonly authorize?: PageAuthorizer;
  readonly beforeReplace?: () => Promise<void>;
}) {
  const pageRepository = new InMemoryPageRepository();
  const blockDocumentRepository = new InMemoryBlockDocumentRepository({
    isPageLive: (id) => pageRepository.isPageLive(id),
  });
  const routeBlockDocumentRepository: BlockDocumentRepository = {
    getByPageId: (id) => blockDocumentRepository.getByPageId(id),
    async replace(mutation) {
      await options?.beforeReplace?.();
      return blockDocumentRepository.replace(mutation);
    },
  };
  const created = createPage(
    {
      title: "Projects",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: (() => {
        const ids = [
          pageId,
          "22222222-2222-4222-8222-222222222222",
          "33333333-3333-4333-8333-333333333333",
        ];
        return () => ids.shift() ?? "";
      })(),
      now: () => new Date("2026-09-21T12:00:00.000Z"),
    },
  );
  await pageRepository.create(created);
  blockDocumentRepository.registerPage(
    created.page.id,
    created.page.modifiedAt,
  );

  const generatedIds = [
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
    "88888888-8888-4888-8888-888888888888",
    "99999999-9999-4999-8999-999999999999",
  ];
  const authorize =
    options?.authorize ??
    vi.fn(async () => ({
      ok: true as const,
      actor: {
        actorType: "user" as const,
        actorId: "user-1",
        source: "human-ui",
      },
    }));
  const app = buildApp({
    pageRepository,
    pageDependencies: {
      newId: () => generatedIds.shift() ?? "",
      now: () => new Date("2026-09-21T13:00:00.000Z"),
    },
    blockDocumentRepository: routeBlockDocumentRepository,
    blockDocumentDependencies: {
      newId: () => generatedIds.shift() ?? "",
      now: () => new Date("2026-09-21T13:00:00.000Z"),
    },
    authorize,
  });

  return {
    app,
    authorize,
    pageRepository,
    page: created.page,
    blockDocumentRepository,
    pageId: created.page.id,
  };
}

test("reads an empty page document then creates and reloads a paragraph body", async () => {
  const {
    app,
    authorize,
    blockDocumentRepository,
    pageId: id,
  } = await blockDocumentApp();

  const empty = await app.inject({
    method: "GET",
    url: "/api/v1/pages/" + id + "/blocks",
  });
  expect(empty.statusCode).toBe(200);
  expect(empty.json()).toEqual({
    document: { pageId: id, revisionNumber: 0, blocks: [] },
  });
  expect(empty.headers.etag).toBe('"0"');

  const saved = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": '"0"' },
    payload: {
      blocks: [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "First body" },
        },
      ],
    },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject({
    document: {
      pageId: id,
      revisionNumber: 1,
      blocks: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          parentBlockId: null,
          position: 0,
          blockType: "paragraph",
          content: { text: "First body" },
        },
      ],
    },
  });
  expect(saved.headers.etag).toBe('"1"');
  expect(blockDocumentRepository.auditFor(id)[0]).toMatchObject({
    actorType: "user",
    actorId: "user-1",
    source: "human-ui",
  });

  const reloaded = await app.inject({
    method: "GET",
    url: "/api/v1/pages/" + id + "/blocks",
  });
  expect(reloaded.statusCode).toBe(200);
  expect(reloaded.json()).toEqual(saved.json());
  expect(reloaded.headers.etag).toBe('"1"');
  expect(authorize).toHaveBeenCalledWith(expect.anything(), false);
  expect(authorize).toHaveBeenCalledWith(expect.anything(), true);
  await app.close();
});

test("keeps an archived page body readable but rejects body writes", async () => {
  const {
    app,
    pageRepository,
    page,
    blockDocumentRepository,
    pageId: id,
  } = await blockDocumentApp();
  const archived = archivePage(
    page,
    1,
    { actorType: "user", actorId: "user-1", source: "human-ui" },
    {
      newId: (() => {
        const ids = [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ];
        return () => ids.shift() ?? "";
      })(),
      now: () => new Date("2026-09-21T13:30:00.000Z"),
    },
  );
  await pageRepository.update(archived);

  const read = await app.inject({
    method: "GET",
    url: "/api/v1/pages/" + id + "/blocks",
  });
  expect(read.statusCode).toBe(200);

  const write = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": '"0"' },
    payload: { blocks: [] },
  });
  expect(write.statusCode).toBe(409);
  expect(write.json()).toEqual({ error: "page is archived" });
  expect(blockDocumentRepository.revisionsFor(id)).toHaveLength(0);
  expect(blockDocumentRepository.auditFor(id)).toHaveLength(0);
  await app.close();
});

test("rejects a body write that becomes archived after route validation", async () => {
  const replacementReleased = createDeferred<void>();
  let replacementRequested!: () => void;
  const replacementStarted = new Promise<void>((resolve) => {
    replacementRequested = resolve;
  });
  const {
    app,
    pageRepository,
    page,
    blockDocumentRepository,
    pageId: id,
  } = await blockDocumentApp({
    beforeReplace: async () => {
      replacementRequested();
      await replacementReleased.promise;
    },
  });

  const write = app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": '"0"' },
    payload: {
      blocks: [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "In-flight body" },
        },
      ],
    },
  });
  await replacementStarted;
  await pageRepository.update(
    archivePage(
      page,
      1,
      { actorType: "user", actorId: "user-1", source: "human-ui" },
      {
        newId: (() => {
          const ids = [
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          ];
          return () => ids.shift() ?? "";
        })(),
        now: () => new Date("2026-09-21T13:30:00.000Z"),
      },
    ),
  );
  replacementReleased.resolve();

  const response = await write;
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: "page is archived" });
  expect(blockDocumentRepository.revisionsFor(id)).toHaveLength(0);
  expect(blockDocumentRepository.auditFor(id)).toHaveLength(0);
  await app.close();
});

test("returns a semantic no-op without another document revision or audit entry", async () => {
  const { app, blockDocumentRepository, pageId: id } = await blockDocumentApp();
  const first = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": '"0"' },
    payload: {
      blocks: [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "First body" },
        },
      ],
    },
  });
  const blockId = first.json().document.blocks[0].id as string;

  const retry = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": '"1"' },
    payload: {
      blocks: [
        {
          clientRef: "current",
          id: blockId,
          blockType: "paragraph",
          content: { text: "First body" },
        },
      ],
    },
  });
  expect(retry.statusCode).toBe(200);
  expect(retry.json()).toEqual(first.json());
  expect(blockDocumentRepository.revisionsFor(id)).toHaveLength(1);
  expect(blockDocumentRepository.auditFor(id)).toHaveLength(1);
  await app.close();
});

test("rejects malformed inputs, untrusted audit fields, and stale body revisions", async () => {
  const { app, pageId: id } = await blockDocumentApp();

  const missingHeader = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    payload: { blocks: [] },
  });
  expect(missingHeader.statusCode).toBe(400);
  expect(missingHeader.json()).toEqual({
    error: "invalid block document revision",
  });

  const unquotedHeader = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": "0" },
    payload: { blocks: [] },
  });
  expect(unquotedHeader.statusCode).toBe(400);

  const untrustedAudit = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": '"0"' },
    payload: {
      actorId: "attacker",
      source: "untrusted",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      blocks: [],
    },
  });
  expect(untrustedAudit.statusCode).toBe(400);
  expect(untrustedAudit.json()).toEqual({ error: "invalid block document" });

  const first = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": '"0"' },
    payload: {
      blocks: [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "Current" },
        },
      ],
    },
  });
  expect(first.statusCode).toBe(200);

  const stale = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": '"0"' },
    payload: { blocks: [] },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: "block document revision conflict" });
  await app.close();
});

test("rejects invalid page identities and document content beyond domain limits", async () => {
  const { app, pageId: id } = await blockDocumentApp();

  const invalidId = await app.inject({
    method: "GET",
    url: "/api/v1/pages/not-a-native-id/blocks",
  });
  expect(invalidId.statusCode).toBe(400);
  expect(invalidId.json()).toEqual({ error: "invalid page ID" });

  const oversizedParagraph = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": '"0"' },
    payload: {
      blocks: [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "x".repeat(20_001) },
        },
      ],
    },
  });
  expect(oversizedParagraph.statusCode).toBe(400);
  expect(oversizedParagraph.json()).toEqual({
    error: "invalid block document",
  });
  await app.close();
});

test("rejects untrusted block identities and invalid nested document structures", async () => {
  const { app, blockDocumentRepository, pageId: id } = await blockDocumentApp();
  const request = async (blocks: unknown[]) =>
    app.inject({
      method: "PUT",
      url: "/api/v1/pages/" + id + "/blocks",
      headers: { "if-match": '"0"' },
      payload: { blocks },
    });

  for (const blocks of [
    [
      {
        clientRef: "unknown-id",
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        blockType: "paragraph",
        content: { text: "A client cannot create a canonical ID" },
      },
    ],
    [
      {
        clientRef: "unsafe-content",
        blockType: "paragraph",
        content: { text: "Plain text", html: "<p>unsafe</p>" },
      },
    ],
    [
      {
        clientRef: "missing-parent",
        parentClientRef: "not-present",
        blockType: "paragraph",
        content: { text: "Missing parent" },
      },
    ],
    [
      {
        clientRef: "cycle-a",
        parentClientRef: "cycle-b",
        blockType: "paragraph",
        content: { text: "A" },
      },
      {
        clientRef: "cycle-b",
        parentClientRef: "cycle-a",
        blockType: "paragraph",
        content: { text: "B" },
      },
    ],
    Array.from({ length: 1_001 }, (_, index) => ({
      clientRef: "over-limit-" + index,
      blockType: "paragraph",
      content: { text: "Over route limit" },
    })),
  ]) {
    const response = await request(blocks);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid block document" });
  }
  expect(blockDocumentRepository.revisionsFor(id)).toHaveLength(0);
  expect(blockDocumentRepository.auditFor(id)).toHaveLength(0);
  await app.close();
});

test("maps one of two concurrent stale body writes to a conflict without extra history", async () => {
  const { app, blockDocumentRepository, pageId: id } = await blockDocumentApp();
  const responses = await Promise.all(
    ["First writer", "Second writer"].map((text) =>
      app.inject({
        method: "PUT",
        url: "/api/v1/pages/" + id + "/blocks",
        headers: { "if-match": '"0"' },
        payload: {
          blocks: [
            {
              clientRef: "root",
              blockType: "paragraph",
              content: { text },
            },
          ],
        },
      }),
    ),
  );

  expect(
    responses.filter((response) => response.statusCode === 200),
  ).toHaveLength(1);
  const conflict = responses.find((response) => response.statusCode === 409);
  expect(conflict?.json()).toEqual({
    error: "block document revision conflict",
  });
  expect(blockDocumentRepository.revisionsFor(id)).toHaveLength(1);
  expect(blockDocumentRepository.auditFor(id)).toHaveLength(1);
  await app.close();
});

test("enforces the shared authorization and CSRF boundary and preserves 404s", async () => {
  const csrfAuthorizer = vi.fn(async (_request, requireCsrf: boolean) => {
    if (requireCsrf) {
      return {
        ok: false as const,
        statusCode: 403 as const,
        error: "CSRF validation failed",
      };
    }
    return {
      ok: true as const,
      actor: {
        actorType: "user" as const,
        actorId: "user-1",
        source: "human-ui",
      },
    };
  });
  const { app, pageId: id } = await blockDocumentApp({
    authorize: csrfAuthorizer,
  });
  const read = await app.inject({
    method: "GET",
    url: "/api/v1/pages/" + id + "/blocks",
  });
  expect(read.statusCode).toBe(200);
  const denied = await app.inject({
    method: "PUT",
    url: "/api/v1/pages/" + id + "/blocks",
    headers: { "if-match": '"0"' },
    payload: { blocks: [] },
  });
  expect(denied.statusCode).toBe(403);
  expect(denied.json()).toEqual({ error: "CSRF validation failed" });
  await app.close();

  const pageRepository = new InMemoryPageRepository();
  const blockDocumentRepository = new InMemoryBlockDocumentRepository();
  const missingApp = buildApp({
    pageRepository,
    pageDependencies: {
      newId: () => pageId,
      now: () => new Date("2026-09-21T12:00:00.000Z"),
    },
    blockDocumentRepository,
    blockDocumentDependencies: {
      newId: () => pageId,
      now: () => new Date("2026-09-21T12:00:00.000Z"),
    },
    authorize: async () => ({
      ok: true,
      actor: {
        actorType: "user",
        actorId: "user-1",
        source: "human-ui",
      },
    }),
  });
  const missing = await missingApp.inject({
    method: "GET",
    url: "/api/v1/pages/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/blocks",
  });
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual({ error: "page not found" });

  const orphanedPage = createPage(
    {
      title: "Orphaned body state",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      now: () => new Date("2026-09-21T12:00:00.000Z"),
    },
  );
  await pageRepository.create(orphanedPage);
  const unavailable = await missingApp.inject({
    method: "GET",
    url: "/api/v1/pages/" + orphanedPage.page.id + "/blocks",
  });
  expect(unavailable.statusCode).toBe(500);
  expect(unavailable.json()).toEqual({
    error: "block document state is unavailable",
  });
  await missingApp.close();
});
