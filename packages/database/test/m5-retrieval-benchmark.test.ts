import { beforeAll, describe, expect, test } from "vitest";

import {
  createDataSource,
  createDataSourceItem,
  createPropertyDefinition,
} from "../../domain/src/data-source.ts";
import { InMemoryDataSourceRepository } from "../src/data-source-repository.ts";
import { MachineKnowledgeService } from "../src/machine-knowledge-service.ts";

describe("M5 deterministic synthetic retrieval benchmark", () => {
  const repository = new InMemoryDataSourceRepository();
  let sequence = 1;
  const dependencies = {
    newId: () =>
      `10000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    now: () => new Date("2026-09-29T12:00:00.000Z"),
  };
  const actor = {
    actorType: "importer" as const,
    actorId: "synthetic-benchmark",
    source: "m5-fixture",
  };
  const service = new MachineKnowledgeService(repository, dependencies);
  const recordIds: string[] = [];
  let sourceId = "";
  let statusId = "";

  beforeAll(async () => {
    const sourceMutation = createDataSource(
      { name: "Synthetic Actions", ...actor },
      dependencies,
    );
    await repository.createSource(sourceMutation);
    sourceId = sourceMutation.dataSource.id;
    const definition = createPropertyDefinition(
      sourceMutation.dataSource,
      { name: "Status", kind: "status", options: ["Open", "Done"], ...actor },
      dependencies,
    );
    await repository.createDefinition(sourceMutation.dataSource.id, definition);
    statusId = definition.definition.id;
    for (let index = 0; index < 40; index += 1) {
      const mutation = createDataSourceItem(
        sourceMutation.dataSource,
        { title: `Action ${String(index).padStart(2, "0")}`, ...actor },
        dependencies,
      );
      await repository.createItem(sourceMutation.dataSource.id, mutation);
      recordIds.push(mutation.item.id);
      await repository.setProperty(
        mutation.item.id,
        statusId as never,
        {
          value: index % 2 ? "Done" : "Open",
          expectedPropertyRevisionNumber: 1,
          ...actor,
        },
        dependencies,
      );
    }
  });

  test.each(Array.from({ length: 40 }, (_, index) => index))(
    "case exact-id-%i",
    async (index) => {
      const result = await service.query({
        entityTypeId: sourceId,
        ids: [recordIds[index]!],
        limit: 1,
      });
      expect(result.items.map((item) => item.id)).toEqual([recordIds[index]]);
    },
  );

  test.each(Array.from({ length: 10 }, (_, index) => index))(
    "case exact-title-%i",
    async (index) => {
      const result = await service.query({
        entityTypeId: sourceId,
        title: `Action ${String(index).padStart(2, "0")}`,
        limit: 2,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.title).toBe(
        `Action ${String(index).padStart(2, "0")}`,
      );
    },
  );

  test.each(Array.from({ length: 10 }, (_, index) => index))(
    "case bounded-status-page-%i",
    async (index) => {
      const first = await service.query({
        entityTypeId: sourceId,
        properties: [
          {
            propertyId: statusId,
            operator: "eq",
            value: index % 2 ? "Done" : "Open",
          },
        ],
        limit: 7,
      });
      expect(first.items).toHaveLength(7);
      expect(first.truncated).toBe(true);
      expect(first.nextCursor).toEqual(expect.any(String));
    },
  );
});
