import assert from "node:assert/strict";
import { test } from "vitest";

import {
  type Block,
  type BlockDocument,
  type ReplaceBlockDocumentCommand,
  BlockDocumentRevisionConflictError,
  replaceBlockDocument,
} from "../src/block-document.ts";
import { asNativeId, ValidationError } from "../src/ids.ts";

const pageId = asNativeId("11111111-1111-4111-8111-111111111111");
const otherPageId = asNativeId("22222222-2222-4222-8222-222222222222");
const firstBlockId = asNativeId("33333333-3333-4333-8333-333333333333");
const secondBlockId = asNativeId("44444444-4444-4444-8444-444444444444");
const nestedBlockId = asNativeId("55555555-5555-4555-8555-555555555555");
const timestamp = "2026-09-21T12:00:00.000Z";

function dependencies(ids: string[]) {
  return {
    newId: () => ids.shift() ?? "",
    now: () => new Date(timestamp),
  };
}

function block(
  id: ReturnType<typeof asNativeId>,
  options: Partial<Omit<Block, "id" | "pageId">> = {},
): Block {
  return {
    id,
    pageId,
    parentBlockId: null,
    blockType: "paragraph",
    position: 0,
    content: { text: "Current text" },
    createdAt: "2026-09-20T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
    archivedAt: null,
    ...options,
  };
}

function document(
  blocks: readonly Block[] = [],
  revisionNumber = 0,
): BlockDocument {
  return { pageId, revisionNumber, blocks };
}

function command(
  blocks: readonly unknown[],
  overrides: Record<string, unknown> = {},
): ReplaceBlockDocumentCommand {
  return {
    pageId,
    expectedRevisionNumber: 0,
    blocks,
    actorType: "user" as const,
    actorId: " user-1 ",
    source: " human-ui ",
    ...overrides,
  } as ReplaceBlockDocumentCommand;
}

test("creates root and nested paragraphs with native IDs and server positions", () => {
  const result = replaceBlockDocument(
    document(),
    command([
      {
        clientRef: "root",
        blockType: "paragraph",
        content: { text: "Root" },
      },
      {
        clientRef: "first-child",
        parentClientRef: "root",
        blockType: "paragraph",
        content: { text: "Child one" },
      },
      {
        clientRef: "second-child",
        parentClientRef: "root",
        blockType: "paragraph",
        content: { text: "Child two" },
      },
    ]),
    dependencies([
      firstBlockId,
      secondBlockId,
      nestedBlockId,
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
    ]),
  );

  assert.equal(result.kind, "changed");
  if (result.kind !== "changed") return;

  assert.deepEqual(
    result.mutation.document.blocks.map((item) => ({
      id: item.id,
      parentBlockId: item.parentBlockId,
      position: item.position,
      text: item.content.text,
    })),
    [
      {
        id: firstBlockId,
        parentBlockId: null,
        position: 0,
        text: "Root",
      },
      {
        id: secondBlockId,
        parentBlockId: firstBlockId,
        position: 0,
        text: "Child one",
      },
      {
        id: nestedBlockId,
        parentBlockId: firstBlockId,
        position: 1,
        text: "Child two",
      },
    ],
  );
  assert.equal(result.mutation.revision.entityType, "block-document");
  assert.equal(result.mutation.revision.entityId, pageId);
  assert.equal(result.mutation.revision.revisionNumber, 1);
  assert.equal(result.mutation.audit.action, "block-document.updated");
  assert.equal(result.mutation.audit.targetType, "block-document");
  assert.equal(result.mutation.audit.actorId, "user-1");
  assert.equal(result.mutation.audit.source, "human-ui");
  assert.equal(result.mutation.audit.before?.revisionNumber, 0);
  assert.equal(result.mutation.audit.after.revisionNumber, 1);
  assert.equal(
    JSON.stringify(result.mutation.revision.snapshot).includes("clientRef"),
    false,
  );
  assert.equal(
    JSON.stringify(result.mutation.audit.before).includes("clientRef"),
    false,
  );
  assert.equal(
    JSON.stringify(result.mutation.audit.after).includes("clientRef"),
    false,
  );
  assert.equal(Object.isFrozen(result.mutation.document), true);
  assert.equal(Object.isFrozen(result.mutation.document.blocks), true);
  assert.equal(Object.isFrozen(result.mutation.document.blocks[0]), true);
  assert.equal(
    Object.isFrozen(result.mutation.document.blocks[0]?.content),
    true,
  );
});

test("retains only live same-page block IDs and archives omitted blocks", () => {
  const retained = block(firstBlockId);
  const omitted = block(secondBlockId, {
    position: 1,
    content: { text: "Archive me" },
  });
  const result = replaceBlockDocument(
    document([retained, omitted], 4),
    command(
      [
        {
          clientRef: "retained",
          id: firstBlockId,
          blockType: "paragraph",
          content: { text: "Current text" },
        },
      ],
      { expectedRevisionNumber: 4 },
    ),
    dependencies([
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
    ]),
  );

  assert.equal(result.kind, "changed");
  if (result.kind !== "changed") return;

  assert.deepEqual(result.mutation.archiveIds, [secondBlockId]);
  assert.deepEqual(result.mutation.upserts, []);
  assert.equal(result.mutation.document.blocks[0]?.id, firstBlockId);
  assert.equal(result.mutation.document.revisionNumber, 5);
  assert.equal(result.mutation.audit.before?.blocks.length, 2);
  assert.equal(result.mutation.audit.after.blocks.length, 1);
});

test("returns unchanged without consuming IDs for an identical current document", () => {
  const current = document([block(firstBlockId)], 3);
  let idCalls = 0;
  const result = replaceBlockDocument(
    current,
    command(
      [
        {
          clientRef: "current",
          id: firstBlockId,
          blockType: "paragraph",
          content: { text: "Current text" },
        },
      ],
      { expectedRevisionNumber: 3 },
    ),
    {
      newId: () => {
        idCalls += 1;
        return "66666666-6666-4666-8666-666666666666";
      },
      now: () => new Date(timestamp),
    },
  );

  assert.equal(result.kind, "unchanged");
  assert.equal(idCalls, 0);
  assert.equal(result.document.revisionNumber, 3);
  assert.deepEqual(result.document.blocks, current.blocks);
});

test("does not require a clock value for a semantic no-op", () => {
  const current = document([block(firstBlockId)], 3);

  const result = replaceBlockDocument(
    current,
    command(
      [
        {
          clientRef: "current",
          id: firstBlockId,
          blockType: "paragraph",
          content: { text: "Current text" },
        },
      ],
      { expectedRevisionNumber: 3 },
    ),
    {
      newId: () => {
        throw new Error("a no-op must not generate identifiers");
      },
      now: () => {
        throw new Error("a no-op must not read the clock");
      },
    },
  );

  assert.equal(result.kind, "unchanged");
});

test("fails stale document revisions before it can mutate state", () => {
  assert.throws(
    () =>
      replaceBlockDocument(
        document([block(firstBlockId)], 2),
        command(
          [
            {
              clientRef: "current",
              id: firstBlockId,
              blockType: "paragraph",
              content: { text: "Current text" },
            },
          ],
          { expectedRevisionNumber: 1 },
        ),
        {
          newId: () => {
            throw new Error("a stale write must not generate identifiers");
          },
          now: () => {
            throw new Error("a stale write must not read the clock");
          },
        },
      ),
    BlockDocumentRevisionConflictError,
  );
});

test("rejects invalid content, references, graph shapes, identities, and limits", () => {
  const base = [
    {
      clientRef: "root",
      blockType: "paragraph",
      content: { text: "Valid" },
    },
  ];

  const invalidCommands = [
    command([
      ...base,
      {
        clientRef: "root",
        blockType: "paragraph",
        content: { text: "Duplicate" },
      },
    ]),
    command([
      {
        clientRef: "child",
        parentClientRef: "missing",
        blockType: "paragraph",
        content: { text: "Child" },
      },
    ]),
    command([
      {
        clientRef: "one",
        parentClientRef: "two",
        blockType: "paragraph",
        content: { text: "One" },
      },
      {
        clientRef: "two",
        parentClientRef: "one",
        blockType: "paragraph",
        content: { text: "Two" },
      },
    ]),
    command([
      {
        clientRef: "bad type",
        blockType: "paragraph",
        content: { text: "Bad reference" },
      },
    ]),
    command([
      {
        clientRef: "bad-content",
        blockType: "paragraph",
        content: { text: "Valid", html: "<p>unsafe</p>" },
      },
    ]),
    command([
      {
        clientRef: "wrong-type",
        blockType: "heading",
        content: { text: "Unsupported" },
      },
    ]),
    command([
      {
        clientRef: "long-text",
        blockType: "paragraph",
        content: { text: "x".repeat(20_001) },
      },
    ]),
    command(base, { expectedRevisionNumber: -1 }),
    command([
      {
        clientRef: "unknown-id",
        id: "88888888-8888-4888-8888-888888888888",
        blockType: "paragraph",
        content: { text: "Unknown" },
      },
    ]),
  ];

  for (const invalid of invalidCommands) {
    assert.throws(
      () =>
        replaceBlockDocument(
          document(),
          invalid as never,
          dependencies([
            "66666666-6666-4666-8666-666666666666",
            "77777777-7777-4777-8777-777777777777",
            "88888888-8888-4888-8888-888888888888",
          ]),
        ),
      ValidationError,
    );
  }

  const deepDrafts: unknown[] = [];
  for (let index = 0; index < 33; index += 1) {
    deepDrafts.push({
      clientRef: "depth-" + index,
      ...(index > 0 ? { parentClientRef: "depth-" + (index - 1) } : {}),
      blockType: "paragraph",
      content: { text: "Depth" },
    });
  }
  assert.throws(
    () =>
      replaceBlockDocument(
        document(),
        command(deepDrafts),
        dependencies([
          "66666666-6666-4666-8666-666666666666",
          "77777777-7777-4777-8777-777777777777",
          "88888888-8888-4888-8888-888888888888",
        ]),
      ),
    ValidationError,
  );
});

test("rejects reused IDs that are archived or belong to another page", () => {
  const archived = block(firstBlockId, {
    archivedAt: "2026-09-20T13:00:00.000Z",
  });
  const foreign = {
    ...block(firstBlockId),
    pageId: otherPageId,
  };

  for (const current of [
    document([], 0),
    document([archived], 1),
    { pageId, revisionNumber: 1, blocks: [foreign] },
  ]) {
    assert.throws(
      () =>
        replaceBlockDocument(
          current as BlockDocument,
          command(
            [
              {
                clientRef: "existing",
                id: firstBlockId,
                blockType: "paragraph",
                content: { text: "Current text" },
              },
            ],
            { expectedRevisionNumber: current.revisionNumber },
          ),
          dependencies([
            "66666666-6666-4666-8666-666666666666",
            "77777777-7777-4777-8777-777777777777",
          ]),
        ),
      ValidationError,
    );
  }
});

test("records optional request and reason only through the derived audit context", () => {
  const result = replaceBlockDocument(
    document(),
    command(
      [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "Hello" },
        },
      ],
      {
        requestId: "88888888-8888-4888-8888-888888888888",
        reason: " User update ",
      },
    ),
    dependencies([
      firstBlockId,
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
    ]),
  );

  assert.equal(result.kind, "changed");
  if (result.kind !== "changed") return;
  assert.equal(
    result.mutation.audit.requestId,
    "88888888-8888-4888-8888-888888888888",
  );
  assert.equal(result.mutation.audit.reason, "User update");
});
