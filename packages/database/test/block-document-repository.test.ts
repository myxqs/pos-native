import { expect, test } from "vitest";

import {
  type BlockDocument,
  type ReplaceBlockDocumentMutation,
  replaceBlockDocument,
} from "../../domain/src/block-document.ts";
import { asNativeId } from "../../domain/src/ids.ts";
import {
  BlockDocumentRevisionConflictError,
  InMemoryBlockDocumentRepository,
} from "../src/block-document-repository.ts";

const pageId = asNativeId("11111111-1111-4111-8111-111111111111");
const rootBlockId = asNativeId("22222222-2222-4222-8222-222222222222");
const childBlockId = asNativeId("33333333-3333-4333-8333-333333333333");
const secondBlockId = asNativeId("44444444-4444-4444-8444-444444444444");
const initialTimestamp = "2026-09-21T12:00:00.000Z";

function changedMutation(
  current: BlockDocument,
  blocks: readonly unknown[],
  generatedIds: string[],
  timestamp = initialTimestamp,
): ReplaceBlockDocumentMutation {
  const result = replaceBlockDocument(
    current,
    {
      pageId,
      expectedRevisionNumber: current.revisionNumber,
      blocks,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => generatedIds.shift() ?? "",
      now: () => new Date(timestamp),
    },
  );
  if (result.kind !== "changed") {
    throw new Error("test fixture expected a changed document");
  }
  return result.mutation;
}

test("returns an empty document for a registered page and null for an unknown page", async () => {
  const repository = new InMemoryBlockDocumentRepository();
  repository.registerPage(pageId, "2026-09-20T12:00:00.000Z");

  await expect(repository.getByPageId(pageId)).resolves.toEqual({
    document: { pageId, revisionNumber: 0, blocks: [] },
    revisionNumber: 0,
  });
  await expect(
    repository.getByPageId(asNativeId("99999999-9999-4999-8999-999999999999")),
  ).resolves.toBeNull();
});

test("persists a nested document, revision, audit event, and page document timestamp together", async () => {
  const repository = new InMemoryBlockDocumentRepository();
  repository.registerPage(pageId, "2026-09-20T12:00:00.000Z");
  const empty = (await repository.getByPageId(pageId))?.document;
  if (!empty) throw new Error("registered page is missing");

  const mutation = changedMutation(
    empty,
    [
      {
        clientRef: "root",
        blockType: "paragraph",
        content: { text: "Root" },
      },
      {
        clientRef: "child",
        parentClientRef: "root",
        blockType: "paragraph",
        content: { text: "Child" },
      },
    ],
    [
      rootBlockId,
      childBlockId,
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ],
  );

  await expect(repository.replace(mutation)).resolves.toEqual(
    mutation.document,
  );
  await expect(repository.getByPageId(pageId)).resolves.toEqual({
    document: mutation.document,
    revisionNumber: 1,
  });
  expect(repository.revisionsFor(pageId)).toEqual([mutation.revision]);
  expect(repository.auditFor(pageId)).toEqual([mutation.audit]);
  expect(repository.pageStateFor(pageId)).toEqual({
    revisionNumber: 1,
    modifiedAt: initialTimestamp,
  });
});

test("soft-archives omitted blocks while retaining current live document IDs", async () => {
  const repository = new InMemoryBlockDocumentRepository();
  repository.registerPage(pageId);
  const empty = (await repository.getByPageId(pageId))?.document;
  if (!empty) throw new Error("registered page is missing");
  const first = changedMutation(
    empty,
    [
      {
        clientRef: "first",
        blockType: "paragraph",
        content: { text: "Retain" },
      },
      {
        clientRef: "second",
        blockType: "paragraph",
        content: { text: "Archive" },
      },
    ],
    [
      rootBlockId,
      secondBlockId,
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ],
  );
  await repository.replace(first);

  const second = changedMutation(
    first.document,
    [
      {
        clientRef: "retained",
        id: rootBlockId,
        blockType: "paragraph",
        content: { text: "Retain" },
      },
    ],
    [
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
    ],
    "2026-09-21T13:00:00.000Z",
  );
  await repository.replace(second);

  await expect(repository.getByPageId(pageId)).resolves.toEqual({
    document: second.document,
    revisionNumber: 2,
  });
  expect(repository.archivedBlocksFor(pageId)).toEqual([
    expect.objectContaining({
      id: secondBlockId,
      archivedAt: "2026-09-21T13:00:00.000Z",
      updatedAt: "2026-09-21T13:00:00.000Z",
    }),
  ]);
  expect(repository.revisionsFor(pageId)).toEqual([
    first.revision,
    second.revision,
  ]);
  expect(repository.auditFor(pageId)).toEqual([first.audit, second.audit]);
});

test("rejects stale document mutations without changing current state or history", async () => {
  const repository = new InMemoryBlockDocumentRepository();
  repository.registerPage(pageId);
  const empty = (await repository.getByPageId(pageId))?.document;
  if (!empty) throw new Error("registered page is missing");
  const initial = changedMutation(
    empty,
    [
      {
        clientRef: "root",
        blockType: "paragraph",
        content: { text: "Original" },
      },
    ],
    [
      rootBlockId,
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ],
  );
  await repository.replace(initial);

  const current = changedMutation(
    initial.document,
    [
      {
        clientRef: "root",
        id: rootBlockId,
        blockType: "paragraph",
        content: { text: "Current" },
      },
    ],
    [
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
    ],
  );
  const stale = changedMutation(
    initial.document,
    [
      {
        clientRef: "root",
        id: rootBlockId,
        blockType: "paragraph",
        content: { text: "Stale" },
      },
    ],
    [
      "99999999-9999-4999-8999-999999999999",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ],
  );
  await repository.replace(current);

  await expect(repository.replace(stale)).rejects.toBeInstanceOf(
    BlockDocumentRevisionConflictError,
  );
  await expect(repository.getByPageId(pageId)).resolves.toEqual({
    document: current.document,
    revisionNumber: 2,
  });
  expect(repository.revisionsFor(pageId)).toEqual([
    initial.revision,
    current.revision,
  ]);
  expect(repository.auditFor(pageId)).toEqual([initial.audit, current.audit]);
});

test.each(["before-blocks", "before-revision", "before-audit"] as const)(
  "rolls back page state, rows, revision, and audit when %s fails",
  async (failAt) => {
    const repository = new InMemoryBlockDocumentRepository({ failAt });
    repository.registerPage(pageId, "2026-09-20T12:00:00.000Z");
    const empty = (await repository.getByPageId(pageId))?.document;
    if (!empty) throw new Error("registered page is missing");
    const mutation = changedMutation(
      empty,
      [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "Root" },
        },
      ],
      [
        rootBlockId,
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
      ],
    );

    await expect(repository.replace(mutation)).rejects.toThrow(
      "injected failure",
    );
    await expect(repository.getByPageId(pageId)).resolves.toEqual({
      document: empty,
      revisionNumber: 0,
    });
    expect(repository.pageStateFor(pageId)).toEqual({
      revisionNumber: 0,
      modifiedAt: "2026-09-20T12:00:00.000Z",
    });
    expect(repository.allBlocksFor(pageId)).toEqual([]);
    expect(repository.revisionsFor(pageId)).toEqual([]);
    expect(repository.auditFor(pageId)).toEqual([]);
  },
);
