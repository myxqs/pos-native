import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import {
  type BlockDocument,
  type ReplaceBlockDocumentMutation,
  replaceBlockDocument,
} from "../../domain/src/block-document.ts";
import { archivePage, createPage } from "../../domain/src/page.ts";
import {
  BlockDocumentIdentityConflictError,
  BlockDocumentPageArchivedError,
  BlockDocumentRevisionConflictError,
} from "../src/block-document-repository.ts";
import { PostgresBlockDocumentRepository } from "../src/postgres-block-document-repository.ts";
import { PostgresPageRepository } from "../src/postgres-page-repository.ts";
import * as schema from "../src/schema.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;
let pool: Pool | undefined;
let pageRepository: PostgresPageRepository | undefined;
let blockRepository: PostgresBlockDocumentRepository | undefined;

function changedMutation(
  current: BlockDocument,
  blocks: readonly unknown[],
  timestamp: string,
  newId: () => string = randomUUID,
): ReplaceBlockDocumentMutation {
  const result = replaceBlockDocument(
    current,
    {
      pageId: current.pageId,
      expectedRevisionNumber: current.revisionNumber,
      blocks,
      actorType: "user",
      actorId: "integration-user",
      source: "integration-test",
    },
    {
      newId,
      now: () => new Date(timestamp),
    },
  );
  if (result.kind !== "changed") {
    throw new Error("test fixture expected a changed document");
  }
  return result.mutation;
}

async function createRegisteredPage(): Promise<BlockDocument> {
  if (!pageRepository || !blockRepository) {
    throw new Error("live repositories were not initialised");
  }
  const created = createPage(
    {
      title: "Block integration",
      actorType: "user",
      actorId: "integration-user",
      source: "integration-test",
    },
    {
      newId: randomUUID,
      now: () => new Date("2026-09-21T12:00:00.000Z"),
    },
  );
  await pageRepository.create(created);
  const document = await blockRepository.getByPageId(created.page.id);
  if (!document) throw new Error("created page document is missing");
  return document.document;
}

beforeAll(async () => {
  if (!databaseUrl) return;
  pool = new Pool({ connectionString: databaseUrl });
  const database = drizzle(pool, { schema });
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  pageRepository = new PostgresPageRepository(database);
  blockRepository = new PostgresBlockDocumentRepository(database);
});

beforeEach(async () => {
  if (!pool) return;
  await pool.query("TRUNCATE audit_events, revisions, blocks, pages CASCADE");
});

afterAll(async () => {
  await pool?.end();
});

liveTest(
  "persists and reloads nested block documents with document history",
  async () => {
    if (!blockRepository || !pool) {
      throw new Error("live repository was not initialised");
    }
    const empty = await createRegisteredPage();
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
      "2026-09-21T13:00:00.000Z",
    );

    await expect(blockRepository.replace(mutation)).resolves.toEqual(
      mutation.document,
    );
    await expect(
      blockRepository.getByPageId(mutation.document.pageId),
    ).resolves.toEqual({
      document: mutation.document,
      revisionNumber: 1,
    });
    await expect(
      pool.query(
        "SELECT current_block_document_revision_number FROM pages WHERE id = $1",
        [mutation.document.pageId],
      ),
    ).resolves.toMatchObject({
      rows: [{ current_block_document_revision_number: 1 }],
    });
  },
);

liveTest(
  "rejects a body write after its page is archived without adding body history",
  async () => {
    if (!blockRepository || !pageRepository || !pool) {
      throw new Error("live repository was not initialised");
    }
    const empty = await createRegisteredPage();
    const persistedPage = await pageRepository.getById(empty.pageId);
    if (!persistedPage) throw new Error("registered page is missing");
    await pageRepository.update(
      archivePage(
        persistedPage.page,
        persistedPage.revisionNumber,
        {
          actorType: "user",
          actorId: "integration-user",
          source: "integration-test",
        },
        {
          newId: randomUUID,
          now: () => new Date("2026-09-21T12:30:00.000Z"),
        },
      ),
    );
    const mutation = changedMutation(
      empty,
      [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "Archived body" },
        },
      ],
      "2026-09-21T13:00:00.000Z",
    );

    await expect(blockRepository.replace(mutation)).rejects.toBeInstanceOf(
      BlockDocumentPageArchivedError,
    );
    await expect(blockRepository.getByPageId(empty.pageId)).resolves.toEqual({
      document: empty,
      revisionNumber: 0,
    });
    await expect(
      pool.query(
        "SELECT revision_number FROM revisions WHERE entity_type = $1 AND entity_id = $2",
        ["block-document", empty.pageId],
      ),
    ).resolves.toMatchObject({ rows: [] });
  },
);

liveTest(
  "enforces live sibling uniqueness and same-page parent relationships",
  async () => {
    if (!blockRepository || !pool) {
      throw new Error("live repository was not initialised");
    }
    const firstPage = await createRegisteredPage();
    const rootMutation = changedMutation(
      firstPage,
      [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "Root" },
        },
      ],
      "2026-09-21T13:00:00.000Z",
    );
    await blockRepository.replace(rootMutation);
    const root = rootMutation.document.blocks[0];
    if (!root) throw new Error("root block is missing");
    const secondPage = await createRegisteredPage();

    await expect(
      pool.query(
        "INSERT INTO blocks (id, page_id, parent_block_id, block_type, position, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)",
        [
          randomUUID(),
          firstPage.pageId,
          null,
          "paragraph",
          0,
          JSON.stringify({ text: "Duplicate root position" }),
          new Date("2026-09-21T13:00:00.000Z"),
          new Date("2026-09-21T13:00:00.000Z"),
        ],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        "INSERT INTO blocks (id, page_id, parent_block_id, block_type, position, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)",
        [
          randomUUID(),
          secondPage.pageId,
          root.id,
          "paragraph",
          0,
          JSON.stringify({ text: "Cross-page child" }),
          new Date("2026-09-21T13:00:00.000Z"),
          new Date("2026-09-21T13:00:00.000Z"),
        ],
      ),
    ).rejects.toThrow();
  },
);

liveTest(
  "rejects stale writes and rolls back a late revision failure",
  async () => {
    if (!blockRepository) {
      throw new Error("live repository was not initialised");
    }
    const empty = await createRegisteredPage();
    const initial = changedMutation(
      empty,
      [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "Initial" },
        },
      ],
      "2026-09-21T13:00:00.000Z",
    );
    await blockRepository.replace(initial);
    const root = initial.document.blocks[0];
    if (!root) throw new Error("root block is missing");

    const current = changedMutation(
      initial.document,
      [
        {
          clientRef: "root",
          id: root.id,
          blockType: "paragraph",
          content: { text: "Current" },
        },
      ],
      "2026-09-21T14:00:00.000Z",
    );
    const stale = changedMutation(
      initial.document,
      [
        {
          clientRef: "root",
          id: root.id,
          blockType: "paragraph",
          content: { text: "Stale" },
        },
      ],
      "2026-09-21T14:00:00.000Z",
    );
    await blockRepository.replace(current);

    await expect(blockRepository.replace(stale)).rejects.toBeInstanceOf(
      BlockDocumentRevisionConflictError,
    );
    await expect(
      blockRepository.getByPageId(initial.document.pageId),
    ).resolves.toEqual({
      document: current.document,
      revisionNumber: 2,
    });

    const next = changedMutation(
      current.document,
      [
        {
          clientRef: "root",
          id: root.id,
          blockType: "paragraph",
          content: { text: "Late failure" },
        },
      ],
      "2026-09-21T15:00:00.000Z",
    );
    const lateFailure = {
      ...next,
      revision: {
        ...next.revision,
        id: initial.revision.id,
      },
    };

    await expect(blockRepository.replace(lateFailure)).rejects.toThrow();
    await expect(
      blockRepository.getByPageId(initial.document.pageId),
    ).resolves.toEqual({
      document: current.document,
      revisionNumber: 2,
    });
  },
);

liveTest(
  "updates archived timestamps and refuses to reactivate an archived block identity",
  async () => {
    if (!blockRepository || !pool) {
      throw new Error("live repository was not initialised");
    }
    const empty = await createRegisteredPage();
    const first = changedMutation(
      empty,
      [
        {
          clientRef: "root",
          blockType: "paragraph",
          content: { text: "Archived identity" },
        },
      ],
      "2026-09-21T13:00:00.000Z",
    );
    await blockRepository.replace(first);
    const archivedId = first.document.blocks[0]?.id;
    if (!archivedId) throw new Error("initial block is missing");

    const archivedAt = "2026-09-21T14:00:00.000Z";
    const archive = changedMutation(first.document, [], archivedAt);
    await blockRepository.replace(archive);
    const archiveRow = await pool.query(
      "SELECT archived_at, updated_at FROM blocks WHERE id = $1",
      [archivedId],
    );
    expect(archiveRow.rows[0]?.archived_at.toISOString()).toBe(archivedAt);
    expect(archiveRow.rows[0]?.updated_at.toISOString()).toBe(archivedAt);

    let useArchivedId = true;
    const collision = changedMutation(
      archive.document,
      [
        {
          clientRef: "replacement",
          blockType: "paragraph",
          content: { text: "Must not reactivate history" },
        },
      ],
      "2026-09-21T15:00:00.000Z",
      () =>
        useArchivedId ? ((useArchivedId = false), archivedId) : randomUUID(),
    );

    await expect(blockRepository.replace(collision)).rejects.toBeInstanceOf(
      BlockDocumentIdentityConflictError,
    );
    await expect(
      blockRepository.getByPageId(archive.document.pageId),
    ).resolves.toEqual({
      document: archive.document,
      revisionNumber: 2,
    });
    const rowAfterCollision = await pool.query(
      "SELECT archived_at, updated_at FROM blocks WHERE id = $1",
      [archivedId],
    );
    expect(rowAfterCollision.rows[0]?.archived_at.toISOString()).toBe(
      archivedAt,
    );
    expect(rowAfterCollision.rows[0]?.updated_at.toISOString()).toBe(
      archivedAt,
    );
  },
);
