import { expect, test } from "vitest";

import { asNativeId, type NativeId } from "../../domain/src/ids.ts";
import {
  archivePage,
  createPage,
  movePage,
  restorePage,
  updatePage,
} from "../../domain/src/page.ts";
import {
  InMemoryPageRepository,
  PageHierarchyError,
  PageRevisionConflictError,
} from "../src/page-repository.ts";

function nativeId(seed: number): NativeId {
  return asNativeId(
    `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`,
  );
}

function dependencies(seed: number, pageId = nativeId(seed * 10 + 1)) {
  const generated = [pageId, nativeId(seed * 10 + 2), nativeId(seed * 10 + 3)];
  return {
    newId: () => generated.shift() ?? "",
    now: () => new Date("2026-09-16T10:00:00.000Z"),
  };
}

function pageCreation(
  options: {
    readonly sequence?: number;
    readonly title?: string;
    readonly parentId?: NativeId | null;
    readonly pageId?: NativeId;
  } = {},
) {
  const sequence = options.sequence ?? 1;
  return createPage(
    {
      title: options.title ?? `Page ${sequence}`,
      ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(sequence, options.pageId),
  );
}

test("persists a page with its revision and audit event as one mutation", async () => {
  const repository = new InMemoryPageRepository();
  const mutation = pageCreation();

  await repository.create(mutation);

  await expect(repository.getById(mutation.page.id)).resolves.toEqual({
    page: mutation.page,
    revisionNumber: 1,
  });
  await expect(repository.list()).resolves.toEqual([mutation.page]);
  expect(repository.revisionsFor(mutation.page.id)).toEqual([
    mutation.revision,
  ]);
  expect(repository.auditFor(mutation.page.id)).toEqual([mutation.audit]);
});

test("updates the existing page and appends revision and audit history", async () => {
  const repository = new InMemoryPageRepository();
  const created = pageCreation({ sequence: 1, title: "Domain" });
  await repository.create(created);
  const generated = [
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
  ];
  const updated = updatePage(
    created.page,
    1,
    {
      title: "Projects",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => generated.shift() ?? "",
      now: () => new Date("2026-09-16T11:00:00.000Z"),
    },
  );

  await repository.update(updated);

  await expect(repository.getById(created.page.id)).resolves.toEqual({
    page: updated.page,
    revisionNumber: 2,
  });
  expect(repository.revisionsFor(created.page.id)).toHaveLength(2);
  expect(repository.auditFor(created.page.id)).toHaveLength(2);
});

test("rejects a stale update without changing current page history", async () => {
  const repository = new InMemoryPageRepository();
  const created = pageCreation({ sequence: 1, title: "Domain" });
  await repository.create(created);

  const current = updatePage(
    created.page,
    1,
    {
      title: "Projects",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => "44444444-4444-4444-8444-444444444444",
      now: () => new Date("2026-09-16T11:00:00.000Z"),
    },
  );
  await repository.update(current);

  const stale = updatePage(
    created.page,
    1,
    {
      title: "Stale title",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    {
      newId: () => "55555555-5555-4555-8555-555555555555",
      now: () => new Date("2026-09-16T12:00:00.000Z"),
    },
  );

  await expect(repository.update(stale)).rejects.toThrow(
    "page revision conflict",
  );
  await expect(repository.getById(created.page.id)).resolves.toEqual({
    page: current.page,
    revisionNumber: 2,
  });
  expect(repository.revisionsFor(created.page.id)).toHaveLength(2);
  expect(repository.auditFor(created.page.id)).toHaveLength(2);
});

test("rolls back every write when a create mutation fails after the page write", async () => {
  const repository = new InMemoryPageRepository({
    failAt: "before-revision",
  });
  const mutation = pageCreation();

  await expect(repository.create(mutation)).rejects.toThrow(
    "injected failure before revision",
  );

  await expect(repository.getById(mutation.page.id)).resolves.toBeNull();
  await expect(repository.list()).resolves.toEqual([]);
  expect(repository.revisionsFor(mutation.page.id)).toEqual([]);
  expect(repository.auditFor(mutation.page.id)).toEqual([]);
});

test("persists a child parent edge and scopes active and archived navigation", async () => {
  const repository = new InMemoryPageRepository();
  const root = pageCreation({ sequence: 1, title: "Root" });
  const child = pageCreation({
    sequence: 2,
    title: "Child",
    parentId: root.page.id,
  });
  await repository.create(root);
  await repository.create(child);

  await expect(repository.getById(child.page.id)).resolves.toEqual({
    page: child.page,
    revisionNumber: 1,
  });
  await expect(repository.list()).resolves.toEqual([root.page, child.page]);

  const archivedChild = archivePage(
    child.page,
    1,
    { actorType: "user", actorId: "user-1", source: "human-ui" },
    dependencies(20),
  );
  await repository.update(archivedChild);

  await expect(repository.list()).resolves.toEqual([root.page]);
  await expect(repository.list("archived")).resolves.toEqual([
    archivedChild.page,
  ]);
});

test("rejects a missing or archived parent without persisting a child", async () => {
  const repository = new InMemoryPageRepository();
  const missingParentChild = pageCreation({
    sequence: 1,
    parentId: nativeId(999),
  });

  await expect(repository.create(missingParentChild)).rejects.toBeInstanceOf(
    PageHierarchyError,
  );
  await expect(
    repository.getById(missingParentChild.page.id),
  ).resolves.toBeNull();
  expect(repository.revisionsFor(missingParentChild.page.id)).toEqual([]);
  expect(repository.auditFor(missingParentChild.page.id)).toEqual([]);

  const root = pageCreation({ sequence: 2 });
  await repository.create(root);
  const archivedRoot = archivePage(
    root.page,
    1,
    { actorType: "user", actorId: "user-1", source: "human-ui" },
    dependencies(21),
  );
  await repository.update(archivedRoot);
  const child = pageCreation({
    sequence: 3,
    parentId: root.page.id,
  });

  await expect(repository.create(child)).rejects.toBeInstanceOf(
    PageHierarchyError,
  );
  await expect(repository.getById(child.page.id)).resolves.toBeNull();
});

test("rejects self, direct, and indirect page cycles", async () => {
  const repository = new InMemoryPageRepository();
  const selfId = nativeId(800);
  const self = pageCreation({
    sequence: 80,
    pageId: selfId,
    parentId: selfId,
  });
  await expect(repository.create(self)).rejects.toBeInstanceOf(
    PageHierarchyError,
  );

  const root = pageCreation({ sequence: 1 });
  const child = pageCreation({ sequence: 2, parentId: root.page.id });
  const grandchild = pageCreation({ sequence: 3, parentId: child.page.id });
  await repository.create(root);
  await repository.create(child);
  await repository.create(grandchild);

  const directCycle = movePage(
    root.page,
    1,
    {
      parentId: child.page.id,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(30),
  );
  await expect(repository.update(directCycle)).rejects.toBeInstanceOf(
    PageHierarchyError,
  );

  const indirectCycle = movePage(
    root.page,
    1,
    {
      parentId: grandchild.page.id,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(31),
  );
  await expect(repository.update(indirectCycle)).rejects.toBeInstanceOf(
    PageHierarchyError,
  );
  await expect(repository.getById(root.page.id)).resolves.toEqual({
    page: root.page,
    revisionNumber: 1,
  });
});

test("allows 32 parent edges and rejects a 33-edge hierarchy", async () => {
  const repository = new InMemoryPageRepository();
  let parent = pageCreation({ sequence: 1 });
  await repository.create(parent);

  for (let depth = 1; depth <= 32; depth += 1) {
    const child = pageCreation({
      sequence: depth + 1,
      parentId: parent.page.id,
    });
    await repository.create(child);
    parent = child;
  }

  const overflow = pageCreation({
    sequence: 40,
    parentId: parent.page.id,
  });
  await expect(repository.create(overflow)).rejects.toBeInstanceOf(
    PageHierarchyError,
  );
});

test("rejects moving a subtree when any live or archived descendant would exceed 32 parent edges", async () => {
  const repository = new InMemoryPageRepository();
  let destination = pageCreation({ sequence: 100 });
  await repository.create(destination);

  for (let depth = 1; depth <= 31; depth += 1) {
    const child = pageCreation({
      sequence: 100 + depth,
      parentId: destination.page.id,
    });
    await repository.create(child);
    destination = child;
  }

  const subtreeRoot = pageCreation({ sequence: 200 });
  const subtreeChild = pageCreation({
    sequence: 201,
    parentId: subtreeRoot.page.id,
  });
  await repository.create(subtreeRoot);
  await repository.create(subtreeChild);

  const moveWithLiveDescendant = movePage(
    subtreeRoot.page,
    1,
    {
      parentId: destination.page.id,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(300),
  );
  await expect(
    repository.update(moveWithLiveDescendant),
  ).rejects.toBeInstanceOf(PageHierarchyError);
  await expect(repository.getById(subtreeRoot.page.id)).resolves.toEqual({
    page: subtreeRoot.page,
    revisionNumber: 1,
  });
  await expect(repository.getById(subtreeChild.page.id)).resolves.toEqual({
    page: subtreeChild.page,
    revisionNumber: 1,
  });
  expect(repository.revisionsFor(subtreeRoot.page.id)).toHaveLength(1);
  expect(repository.auditFor(subtreeRoot.page.id)).toHaveLength(1);

  const archivedChild = archivePage(
    subtreeChild.page,
    1,
    {
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(301),
  );
  await repository.update(archivedChild);

  const moveWithArchivedDescendant = movePage(
    subtreeRoot.page,
    1,
    {
      parentId: destination.page.id,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(302),
  );
  await expect(
    repository.update(moveWithArchivedDescendant),
  ).rejects.toBeInstanceOf(PageHierarchyError);
  await expect(repository.getById(subtreeRoot.page.id)).resolves.toEqual({
    page: subtreeRoot.page,
    revisionNumber: 1,
  });
  expect(repository.revisionsFor(subtreeRoot.page.id)).toHaveLength(1);
  expect(repository.auditFor(subtreeRoot.page.id)).toHaveLength(1);
});

test("archives only leaves and restores only to a live parent", async () => {
  const repository = new InMemoryPageRepository();
  const root = pageCreation({ sequence: 1 });
  const child = pageCreation({ sequence: 2, parentId: root.page.id });
  await repository.create(root);
  await repository.create(child);

  const archiveRoot = archivePage(
    root.page,
    1,
    { actorType: "user", actorId: "user-1", source: "human-ui" },
    dependencies(40),
  );
  await expect(repository.update(archiveRoot)).rejects.toBeInstanceOf(
    PageHierarchyError,
  );

  const archivedChild = archivePage(
    child.page,
    1,
    { actorType: "user", actorId: "user-1", source: "human-ui" },
    dependencies(41),
  );
  await repository.update(archivedChild);
  await repository.update(archiveRoot);

  const restoreToArchivedParent = restorePage(
    archivedChild.page,
    2,
    {
      parentId: root.page.id,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(42),
  );
  await expect(
    repository.update(restoreToArchivedParent),
  ).rejects.toBeInstanceOf(PageHierarchyError);

  const restoredRoot = restorePage(
    archiveRoot.page,
    2,
    {
      parentId: null,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(43),
  );
  await repository.update(restoredRoot);
  const restoredChild = restorePage(
    archivedChild.page,
    2,
    {
      parentId: root.page.id,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(44),
  );
  await repository.update(restoredChild);

  expect(repository.revisionsFor(root.page.id)).toHaveLength(3);
  expect(repository.revisionsFor(child.page.id)).toHaveLength(3);
  expect(repository.auditFor(root.page.id).at(-1)?.action).toBe(
    "page.restored",
  );
  expect(repository.auditFor(child.page.id).at(-1)?.action).toBe(
    "page.restored",
  );
});

test("permits one move and rejects a stale competing move without extra history", async () => {
  const repository = new InMemoryPageRepository();
  const firstRoot = pageCreation({ sequence: 1 });
  const secondRoot = pageCreation({ sequence: 2 });
  const child = pageCreation({ sequence: 3, parentId: firstRoot.page.id });
  await repository.create(firstRoot);
  await repository.create(secondRoot);
  await repository.create(child);

  const moved = movePage(
    child.page,
    1,
    {
      parentId: secondRoot.page.id,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(50),
  );
  const stale = movePage(
    child.page,
    1,
    {
      parentId: null,
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    dependencies(51),
  );
  await repository.update(moved);

  await expect(repository.update(stale)).rejects.toBeInstanceOf(
    PageRevisionConflictError,
  );
  await expect(repository.getById(child.page.id)).resolves.toEqual({
    page: moved.page,
    revisionNumber: 2,
  });
  expect(repository.revisionsFor(child.page.id)).toHaveLength(2);
  expect(
    repository.auditFor(child.page.id).map((event) => event.action),
  ).toEqual(["page.created", "page.moved"]);
  expect(repository.revisionsFor(firstRoot.page.id)).toHaveLength(1);
  expect(repository.revisionsFor(secondRoot.page.id)).toHaveLength(1);
});

test("rolls back page and revision state when audit persistence fails", async () => {
  const repository = new InMemoryPageRepository({ failAt: "before-audit" });
  const mutation = pageCreation({ sequence: 1 });

  await expect(repository.create(mutation)).rejects.toThrow(
    "injected failure before audit",
  );
  await expect(repository.getById(mutation.page.id)).resolves.toBeNull();
  expect(repository.revisionsFor(mutation.page.id)).toEqual([]);
  expect(repository.auditFor(mutation.page.id)).toEqual([]);
});
