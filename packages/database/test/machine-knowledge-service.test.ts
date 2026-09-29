import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test } from "vitest";

import {
  createDataSource,
  createDataSourceItem,
  createPropertyDefinition,
} from "../../domain/src/data-source.ts";
import type { NativeId } from "../../domain/src/ids.ts";
import { MachineContractError } from "../../domain/src/machine.ts";
import { InMemoryDataSourceRepository } from "../src/data-source-repository.ts";
import { MachineKnowledgeService } from "../src/machine-knowledge-service.ts";

const dependencies = {
  newId: randomUUID,
  now: () => new Date("2026-09-29T10:00:00.000Z"),
};
const audit = {
  actorType: "system" as const,
  actorId: "fixture",
  source: "m5-test",
};

describe("machine knowledge service", () => {
  let repository: InMemoryDataSourceRepository;
  let service: MachineKnowledgeService;
  let peopleId: NativeId;
  let organisationId: NativeId;
  let statusId: NativeId;
  let scoreId: NativeId;
  let relationId: NativeId;
  let aliceId: NativeId;
  let aliciaId: NativeId;
  let orgId: NativeId;

  beforeEach(async () => {
    repository = new InMemoryDataSourceRepository();
    service = new MachineKnowledgeService(repository, dependencies);
    const people = createDataSource({ name: "People", ...audit }, dependencies);
    const organisations = createDataSource(
      { name: "Organisations", ...audit },
      dependencies,
    );
    await repository.createSource(people);
    await repository.createSource(organisations);
    peopleId = people.dataSource.id;
    organisationId = organisations.dataSource.id;
    const status = createPropertyDefinition(
      people.dataSource,
      {
        name: "Status",
        kind: "status",
        options: ["Active", "Inactive"],
        ...audit,
      },
      dependencies,
    );
    const score = createPropertyDefinition(
      people.dataSource,
      { name: "Score", kind: "number", ...audit },
      dependencies,
    );
    const employer = createPropertyDefinition(
      people.dataSource,
      {
        name: "Employer",
        kind: "relation",
        targetSourceId: organisationId,
        ...audit,
      },
      dependencies,
    );
    await repository.createDefinition(peopleId, status);
    await repository.createDefinition(peopleId, score);
    await repository.createDefinition(peopleId, employer);
    statusId = status.definition.id;
    scoreId = score.definition.id;
    relationId = employer.definition.id;
    aliceId = await createRecord("Alice Smith", peopleId);
    aliciaId = await createRecord("Alicia Smith", peopleId);
    orgId = await createRecord("Example Org", organisationId);
    await repository.setProperty(
      aliceId,
      statusId,
      { value: "Active", expectedPropertyRevisionNumber: 1, ...audit },
      dependencies,
    );
    await repository.setProperty(
      aliceId,
      scoreId,
      { value: "42.5", expectedPropertyRevisionNumber: 2, ...audit },
      dependencies,
    );
    await repository.setProperty(
      aliciaId,
      statusId,
      { value: "Inactive", expectedPropertyRevisionNumber: 1, ...audit },
      dependencies,
    );
    await repository.addRelation(
      aliceId,
      relationId,
      orgId,
      { expectedPropertyRevisionNumber: 3, ...audit },
      dependencies,
    );
  });

  async function createRecord(
    title: string,
    sourceId: NativeId,
  ): Promise<NativeId> {
    const source = (await repository.getSource(sourceId))!;
    const mutation = createDataSourceItem(
      source,
      { title, ...audit },
      dependencies,
    );
    await repository.createItem(sourceId, mutation);
    return mutation.item.id;
  }

  test("discovers data-source schema without hard-coded property knowledge", async () => {
    const types = await service.listEntityTypes();
    expect(types.map((type) => type.name)).toEqual([
      "Page",
      "Organisations",
      "People",
    ]);
    const people = await service.describeEntityType(peopleId);
    expect(people.properties.map((property) => property.name)).toEqual([
      "title",
      "Employer",
      "Score",
      "Status",
    ]);
  });

  test("rejects an empty structured query", async () => {
    await expect(
      service.query({ entityTypeId: peopleId, limit: 20 }),
    ).rejects.toMatchObject({
      code: "INVALID_QUERY",
    });
  });

  test("filters similar names by exact stable identity", async () => {
    const result = await service.query({
      entityTypeId: peopleId,
      ids: [aliceId],
      limit: 20,
    });
    expect(result.items.map((item) => [item.id, item.title])).toEqual([
      [aliceId, "Alice Smith"],
    ]);
  });

  test("filters by title, status, number, and relation target", async () => {
    const result = await service.query({
      entityTypeId: peopleId,
      title: "Alice",
      properties: [
        { propertyId: statusId, operator: "eq", value: "Active" },
        { propertyId: scoreId, operator: "gte", value: "40" },
      ],
      relationTargetId: orgId,
      limit: 20,
    });
    expect(result.items.map((item) => item.id)).toEqual([aliceId]);
  });

  test("paginates deterministically with an opaque cursor", async () => {
    const first = await service.query({
      entityTypeId: peopleId,
      title: "Smith",
      limit: 1,
    });
    const second = await service.query({
      entityTypeId: peopleId,
      title: "Smith",
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(first.items[0]?.id).toBe(aliceId);
    expect(second.items[0]?.id).toBe(aliciaId);
    expect(second.nextCursor).toBeNull();
  });

  test("traverses relations with deterministic cycle and node bounds", async () => {
    const reverse = createPropertyDefinition(
      (await repository.getSource(organisationId))!,
      { name: "People", kind: "relation", targetSourceId: peopleId, ...audit },
      dependencies,
    );
    await repository.createDefinition(organisationId, reverse);
    await repository.addRelation(
      orgId,
      reverse.definition.id,
      aliceId,
      { expectedPropertyRevisionNumber: 1, ...audit },
      dependencies,
    );
    const graph = await service.traverse({
      rootId: aliceId,
      direction: "both",
      depth: 3,
      nodeLimit: 2,
    });
    expect(graph.nodes.map((node) => node.id)).toEqual([aliceId, orgId]);
    expect(graph.truncated).toBe(false);
    expect(graph.cyclesSuppressed).toBeGreaterThan(0);
  });

  test("assembles a bounded context with omission and continuation metadata", async () => {
    const context = await service.context({
      recordId: aliceId,
      maxProperties: 1,
      maxRelations: 0,
    });
    expect(Object.keys(context.entity.properties)).toHaveLength(1);
    expect(context.omitted).toEqual({ properties: 1, relations: 1 });
    expect(context.continuation).toEqual(
      expect.arrayContaining(["entity.get", "relation.traverse"]),
    );
  });

  test("rejects unsafe traversal and context budgets", async () => {
    await expect(
      service.traverse({
        rootId: aliceId,
        direction: "both",
        depth: 4,
        nodeLimit: 20,
      }),
    ).rejects.toBeInstanceOf(MachineContractError);
    await expect(
      service.context({
        recordId: aliceId,
        maxProperties: 101,
        maxRelations: 1,
      }),
    ).rejects.toBeInstanceOf(MachineContractError);
  });

  test("returns bounded audit history without raw snapshots", async () => {
    const history = await service.history(aliceId, 10);
    expect(history.entries.length).toBeGreaterThan(0);
    expect(history.entries[0]).toMatchObject({
      actorId: "fixture",
      source: "m5-test",
      targetId: aliceId,
    });
    expect(JSON.stringify(history)).not.toContain("before");
    expect(JSON.stringify(history)).not.toContain("after");
    expect(JSON.stringify(history)).not.toContain("snapshot");
  });
});
