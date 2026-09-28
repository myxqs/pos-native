export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MAX_SEARCH_SNIPPET_LENGTH = 240;

export type SearchMatchSource = "title" | "paragraph";

export interface SearchQuery {
  readonly query: string;
  readonly limit: number;
}

export interface SearchResult {
  readonly pageId: string;
  readonly pageTitle: string;
  readonly snippet: string;
  readonly matchSource: SearchMatchSource;
  readonly rank: number;
}

export interface SearchRepository {
  search(query: SearchQuery): Promise<readonly SearchResult[]>;
}

export interface SearchDocumentParagraph {
  readonly id: string;
  readonly position: number;
  readonly text: string;
  readonly archived: boolean;
}

export interface SearchDocument {
  readonly pageId: string;
  readonly pageTitle: string;
  readonly archived: boolean;
  readonly paragraphs: readonly SearchDocumentParagraph[];
}

export class SearchQueryValidationError extends Error {
  constructor() {
    super("search query is invalid");
    this.name = "SearchQueryValidationError";
  }
}

export function validateSearchQuery(input: SearchQuery): SearchQuery {
  if (!input || typeof input.query !== "string") {
    throw new SearchQueryValidationError();
  }
  const query = input.query.trim();
  const length = [...query].length;
  if (length < 2 || length > MAX_SEARCH_QUERY_LENGTH) {
    throw new SearchQueryValidationError();
  }
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_SEARCH_LIMIT
  ) {
    throw new SearchQueryValidationError();
  }
  return Object.freeze({ query, limit: input.limit });
}

export function boundSearchSnippet(value: string): string {
  return [...value].slice(0, MAX_SEARCH_SNIPPET_LENGTH).join("");
}

export class InMemorySearchRepository implements SearchRepository {
  constructor(private readonly documents: () => readonly SearchDocument[]) {}

  async search(input: SearchQuery): Promise<readonly SearchResult[]> {
    const { query, limit } = validateSearchQuery(input);
    const needle = query.toLocaleLowerCase();
    const candidates: Array<
      SearchResult & { score: number; position: number; blockId: string }
    > = [];

    for (const document of this.documents()) {
      if (document.archived) continue;
      const title = document.pageTitle.toLocaleLowerCase();
      const titleRank = rankText(title, needle, true);
      if (titleRank !== null) {
        candidates.push({
          pageId: document.pageId,
          pageTitle: document.pageTitle,
          snippet: boundSearchSnippet(document.pageTitle),
          matchSource: "title",
          rank: titleRank,
          score: similarity(title, needle),
          position: -1,
          blockId: "",
        });
      }
      for (const paragraph of document.paragraphs) {
        if (paragraph.archived) continue;
        const text = paragraph.text.toLocaleLowerCase();
        const paragraphRank = rankText(text, needle, false);
        if (paragraphRank === null) continue;
        candidates.push({
          pageId: document.pageId,
          pageTitle: document.pageTitle,
          snippet: boundSearchSnippet(paragraph.text),
          matchSource: "paragraph",
          rank: paragraphRank,
          score: similarity(text, needle),
          position: paragraph.position,
          blockId: paragraph.id,
        });
      }
    }

    candidates.sort(compareCandidates);
    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const candidate of candidates) {
      if (seen.has(candidate.pageId)) continue;
      seen.add(candidate.pageId);
      results.push({
        pageId: candidate.pageId,
        pageTitle: candidate.pageTitle,
        snippet: candidate.snippet,
        matchSource: candidate.matchSource,
        rank: candidate.rank,
      });
      if (results.length === limit) break;
    }
    return results;
  }
}

function rankText(value: string, query: string, title: boolean): number | null {
  if (title && value === query) return 500;
  if (title && value.startsWith(query)) return 450;
  const tokens = value.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  if (tokens.includes(query) || value.includes(query)) return title ? 400 : 250;
  return trigramSimilarity(value, query) >= 0.3 ? (title ? 350 : 200) : null;
}

function compareCandidates(
  left: SearchResult & { score: number; position: number; blockId: string },
  right: SearchResult & { score: number; position: number; blockId: string },
): number {
  return (
    right.rank - left.rank ||
    right.score - left.score ||
    left.pageTitle.localeCompare(right.pageTitle) ||
    left.pageId.localeCompare(right.pageId) ||
    left.position - right.position ||
    left.blockId.localeCompare(right.blockId)
  );
}

function similarity(value: string, query: string): number {
  return value.includes(query)
    ? query.length / Math.max(value.length, 1)
    : trigramSimilarity(value, query);
}

function trigramSimilarity(left: string, right: string): number {
  const leftSet = trigrams(left);
  const rightSet = trigrams(right);
  let common = 0;
  for (const item of leftSet) if (rightSet.has(item)) common += 1;
  return leftSet.size + rightSet.size === 0
    ? 0
    : (2 * common) / (leftSet.size + rightSet.size);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const result = new Set<string>();
  for (let index = 0; index <= padded.length - 3; index += 1) {
    result.add(padded.slice(index, index + 3));
  }
  return result;
}
