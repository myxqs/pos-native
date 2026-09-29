import { beforeAll, describe, expect, test } from "vitest";

import {
  createDataSource,
  createDataSourceItem,
  createPropertyDefinition,
} from "../../domain/src/data-source.ts";
import { MachineContractError } from "../../domain/src/machine.ts";
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

  test("case 61 rejects an unbounded dataset request", async () => {
    await expect(
      service.query({ entityTypeId: sourceId, limit: 100 }),
    ).rejects.toBeInstanceOf(MachineContractError);
  });

  test("case 62 assembles budgeted context with omission evidence", async () => {
    const result = await service.context({
      recordId: recordIds[0]!,
      maxProperties: 0,
      maxRelations: 0,
    });
    expect(result.included).toEqual({ properties: 0, relations: 0 });
    expect(result.omitted.properties).toBe(1);
  });

  test("case 63 updates one property and rejects a stale retry", async () => {
    const id = recordIds[0]! as never;
    const updated = await repository.setProperty(
      id,
      statusId as never,
      { value: "Done", expectedPropertyRevisionNumber: 2, ...actor },
      dependencies,
    );
    expect(updated.page.title).toBe("Action 00");
    expect(updated.values[statusId]).toMatchObject({ value: "Done" });
    await expect(
      repository.setProperty(
        id,
        statusId as never,
        { value: "Open", expectedPropertyRevisionNumber: 2, ...actor },
        dependencies,
      ),
    ).rejects.toThrow("stale property revision");
  });

  test("case 64 adds, traverses and removes a relation", async () => {
    const source = (await repository.getSource(sourceId as never))!;
    const definition = createPropertyDefinition(
      source,
      {
        name: "Related action",
        kind: "relation",
        targetSourceId: source.id,
        ...actor,
      },
      dependencies,
    );
    await repository.createDefinition(source.id, definition);
    const edge = await repository.addRelation(
      recordIds[1]! as never,
      definition.definition.id,
      recordIds[2]! as never,
      { expectedPropertyRevisionNumber: 2, ...actor },
      dependencies,
    );
    const graph = await service.traverse({
      rootId: recordIds[1]!,
      direction: "outgoing",
      depth: 1,
      nodeLimit: 2,
    });
    expect(graph.nodes.map((node) => node.id)).toEqual([
      recordIds[1],
      recordIds[2],
    ]);
    await repository.removeRelation(
      edge.id,
      { expectedPropertyRevisionNumber: 3, ...actor },
      dependencies,
    );
    expect(
      (
        await service.traverse({
          rootId: recordIds[1]!,
          direction: "outgoing",
          depth: 1,
          nodeLimit: 2,
        })
      ).edges,
    ).toEqual([]);
  });
});
