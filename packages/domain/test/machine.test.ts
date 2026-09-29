import { describe, expect, test } from "vitest";

import type { DataSource, PropertyDefinition } from "../src/data-source.ts";
import {
  decodeMachineCursor,
  describeMachineEntityType,
  encodeMachineCursor,
  listMachineEntityTypes,
  MachineContractError,
  validateMachineBounds,
} from "../src/machine.ts";

const source = (id: string, name: string): DataSource => ({
  id: id as never,
  name,
  createdAt: "2026-09-29T00:00:00.000Z",
});

const definition = (
  id: string,
  sourceId: string,
  name: string,
  kind: PropertyDefinition["kind"],
  extra: Partial<PropertyDefinition> = {},
): PropertyDefinition => ({
  id: id as never,
  sourceId: sourceId as never,
  name,
  nameKey: name.toLowerCase(),
  kind,
  options: null,
  targetSourceId: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  ...extra,
});

describe("machine discovery contracts", () => {
  test("lists entity types deterministically with stable capabilities", () => {
    expect(
      listMachineEntityTypes([
        source("00000000-0000-4000-8000-000000000002", "Projects"),
        source("00000000-0000-4000-8000-000000000001", "People"),
      ]),
    ).toEqual([
      expect.objectContaining({ id: "page", kind: "native" }),
      expect.objectContaining({ name: "People", kind: "data-source" }),
      expect.objectContaining({ name: "Projects", kind: "data-source" }),
    ]);
    expect(listMachineEntityTypes([])[0]).toMatchObject({
      id: "page",
      kind: "native",
      capabilities: [
        "schema.describe",
        "entity.update-title",
        "entity.archive",
        "entity.restore",
      ],
    });
  });

  test("describes typed properties, constraints, and relationship targets", () => {
    const people = source("00000000-0000-4000-8000-000000000001", "People");
    const result = describeMachineEntityType(people, [
      definition(
        "00000000-0000-4000-8000-000000000011",
        people.id,
        "Status",
        "status",
        {
          options: ["Active", "Inactive"],
        },
      ),
      definition(
        "00000000-0000-4000-8000-000000000012",
        people.id,
        "Employer",
        "relation",
        {
          targetSourceId: "00000000-0000-4000-8000-000000000002" as never,
        },
      ),
    ]);
    expect(result.properties.map((property) => property.name)).toEqual([
      "title",
      "Employer",
      "Status",
    ]);
    expect(result.properties[1]).toMatchObject({
      kind: "relation",
      targetEntityTypeId: "00000000-0000-4000-8000-000000000002",
      mutable: true,
    });
    expect(result.properties[2]).toMatchObject({
      kind: "status",
      options: ["Active", "Inactive"],
    });
  });

  test("round trips opaque cursors and rejects malformed or unbounded input", () => {
    const cursor = encodeMachineCursor({ sortValue: "Alpha", id: "record-1" });
    expect(cursor).not.toContain("Alpha");
    expect(decodeMachineCursor(cursor)).toEqual({
      sortValue: "Alpha",
      id: "record-1",
    });
    expect(() => decodeMachineCursor("not-a-cursor")).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
    expect(() => validateMachineBounds({ limit: 101 })).toThrow(
      MachineContractError,
    );
    expect(validateMachineBounds({ limit: 25 })).toEqual({ limit: 25 });
  });
});
