import { expect, test } from "vitest";

import {
  InMemorySearchRepository,
  SearchQueryValidationError,
  type SearchDocument,
} from "../src/search-repository.ts";

const alpha = "11111111-1111-4111-8111-111111111111";
const beta = "22222222-2222-4222-8222-222222222222";

test("ranks exact and prefix titles before paragraph matches deterministically", async () => {
  const repository = new InMemorySearchRepository(() => [
    document(beta, "Alpha notes", ["Alpha appears in a paragraph"]),
    document(alpha, "Alpha", ["Other text"]),
    document("33333333-3333-4333-8333-333333333333", "Zebra", ["alpha"]),
  ]);

  await expect(
    repository.search({ query: "alpha", limit: 20 }),
  ).resolves.toEqual([
    result(alpha, "Alpha", "Alpha", "title", 500),
    result(beta, "Alpha notes", "Alpha notes", "title", 450),
    result(
      "33333333-3333-4333-8333-333333333333",
      "Zebra",
      "alpha",
      "paragraph",
      250,
    ),
  ]);
});

test("returns one best bounded result per page and stable page tie breakers", async () => {
  const repository = new InMemorySearchRepository(() => [
    document(beta, "Second", ["needle twice", "needle again"]),
    document(alpha, "First", ["needle once"]),
  ]);

  const results = await repository.search({ query: "needle", limit: 1 });
  expect(results).toEqual([
    result(alpha, "First", "needle once", "paragraph", 250),
  ]);
});

test("excludes archived pages and blocks and reflects provider mutations", async () => {
  let documents: readonly SearchDocument[] = [
    document(alpha, "Current", ["visible", { text: "hidden", archived: true }]),
    { ...document(beta, "Archived", ["visible"]), archived: true },
  ];
  const repository = new InMemorySearchRepository(() => documents);

  await expect(
    repository.search({ query: "hidden", limit: 20 }),
  ).resolves.toEqual([]);
  await expect(
    repository.search({ query: "archived", limit: 20 }),
  ).resolves.toEqual([]);
  documents = [document(alpha, "Unrelated", ["restored words"])];
  await expect(
    repository.search({ query: "restored", limit: 20 }),
  ).resolves.toEqual([
    result(alpha, "Unrelated", "restored words", "paragraph", 250),
  ]);
});

test("validates Unicode query and limit boundaries and safely returns no results", async () => {
  const repository = new InMemorySearchRepository(() => []);
  await expect(
    repository.search({ query: "none", limit: 20 }),
  ).resolves.toEqual([]);
  for (const query of ["", " ", "a", "x".repeat(101)]) {
    await expect(
      repository.search({ query, limit: 20 }),
    ).rejects.toBeInstanceOf(SearchQueryValidationError);
  }
  await expect(repository.search({ query: "😀😀", limit: 1 })).resolves.toEqual(
    [],
  );
  for (const limit of [0, 51, 1.5, Number.NaN]) {
    await expect(
      repository.search({ query: "ok", limit }),
    ).rejects.toBeInstanceOf(SearchQueryValidationError);
  }
});

test("bounds snippets by Unicode code points", async () => {
  const repository = new InMemorySearchRepository(() => [
    document(alpha, "Notes", [`needle ${"😀".repeat(300)}`]),
  ]);
  const [match] = await repository.search({ query: "needle", limit: 20 });
  expect([...match!.snippet]).toHaveLength(240);
});

function document(
  pageId: string,
  pageTitle: string,
  paragraphs: readonly (
    string | { readonly text: string; readonly archived: boolean }
  )[],
): SearchDocument {
  return {
    pageId,
    pageTitle,
    archived: false,
    paragraphs: paragraphs.map((paragraph, position) => ({
      id: `${pageId.slice(0, 24)}${String(position + 1).padStart(12, "0")}`,
      position,
      text: typeof paragraph === "string" ? paragraph : paragraph.text,
      archived: typeof paragraph === "string" ? false : paragraph.archived,
    })),
  };
}

function result(
  pageId: string,
  pageTitle: string,
  snippet: string,
  matchSource: "title" | "paragraph",
  rank: number,
) {
  return { pageId, pageTitle, snippet, matchSource, rank };
}
