import { expect, test } from "vitest";

import { asNativeId } from "../src/ids.ts";
import { createPageAssetLink } from "../src/page-asset-link.ts";

test("creates an immutable page asset link with revision and audit evidence", () => {
  const ids = [
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
  ];
  const mutation = createPageAssetLink(
    {
      pageId: asNativeId("11111111-1111-4111-8111-111111111111"),
      assetId: asNativeId("22222222-2222-4222-8222-222222222222"),
      actorType: "user",
      actorId: "owner-1",
      source: "nativepos.browser",
    },
    {
      newId: () => ids.shift() ?? "unexpected",
      now: () => new Date("2026-09-28T12:00:00.000Z"),
    },
  );

  expect(mutation.link).toEqual({
    id: "33333333-3333-4333-8333-333333333333",
    pageId: "11111111-1111-4111-8111-111111111111",
    assetId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-09-28T12:00:00.000Z",
    provenance: { source: "nativepos.browser", actorId: "owner-1" },
  });
  expect(mutation.revision).toMatchObject({
    id: "44444444-4444-4444-8444-444444444444",
    entityType: "page-asset-link",
    entityId: mutation.link.id,
    revisionNumber: 1,
    snapshot: mutation.link,
  });
  expect(mutation.audit).toMatchObject({
    id: "55555555-5555-4555-8555-555555555555",
    action: "page.asset-linked",
    targetType: "page-asset-link",
    targetId: mutation.link.id,
    before: null,
    after: mutation.link,
  });
  expect(Object.isFrozen(mutation.link)).toBe(true);
  expect(Object.isFrozen(mutation.link.provenance)).toBe(true);
});
