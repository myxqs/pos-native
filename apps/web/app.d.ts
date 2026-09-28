export interface BrowserEvent {
  preventDefault(): void;
}

export interface BrowserElement {
  disabled: boolean;
  hidden: boolean;
  textContent: string;
  type: string;
  value: string;
  files?: readonly File[];
  download?: string;
  href?: string;
  click(): void;
  addEventListener(
    type: string,
    listener: (event: BrowserEvent) => void | Promise<void>,
  ): void;
  append(child: BrowserElement): void;
  replaceChildren(...children: BrowserElement[]): void;
}

export interface BrowserDocument {
  cookie: string;
  createElement(tagName: string): BrowserElement;
  querySelector(selector: string): BrowserElement | null;
}

export interface BrowserPage {
  readonly archivedAt: string | null;
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
}

export interface BrowserPageMutation {
  readonly page: BrowserPage;
  readonly revisionNumber: number;
}

export interface BrowserPageTreeNode {
  readonly children: readonly BrowserPageTreeNode[];
  readonly page: BrowserPage;
}

export interface BrowserPageTree {
  readonly breadcrumbs: ReadonlyMap<string, readonly BrowserPage[]>;
  readonly roots: readonly BrowserPageTreeNode[];
}

export function createPageRequest(
  apiFetch: typeof fetch,
  title: string,
  csrfToken: string,
  parentId?: string | null,
): Promise<BrowserPageMutation>;

export function updatePageRequest(
  apiFetch: typeof fetch,
  id: string,
  title: string,
  revisionNumber: number,
  csrfToken: string,
): Promise<BrowserPageMutation>;

export function getPageListRequest(
  apiFetch: typeof fetch,
  scope?: "active" | "archived",
): Promise<readonly BrowserPage[]>;

export function movePageRequest(
  apiFetch: typeof fetch,
  id: string,
  parentId: string | null,
  revisionNumber: number,
  csrfToken: string,
): Promise<BrowserPageMutation>;

export function archivePageRequest(
  apiFetch: typeof fetch,
  id: string,
  revisionNumber: number,
  csrfToken: string,
): Promise<BrowserPageMutation>;

export function restorePageRequest(
  apiFetch: typeof fetch,
  id: string,
  parentId: string | null,
  revisionNumber: number,
  csrfToken: string,
): Promise<BrowserPageMutation>;

export function pageTreeFromPages(
  pages: readonly BrowserPage[],
  scope?: "active" | "archived",
  knownPages?: readonly BrowserPage[],
): BrowserPageTree;

export interface BrowserBlockDraft {
  readonly clientRef: string;
  readonly id?: string;
  readonly parentClientRef?: string;
  readonly blockType: "paragraph";
  readonly content: { readonly text: string };
}

export interface BrowserBlockDocument {
  readonly pageId: string;
  readonly revisionNumber: number;
  readonly blocks: readonly unknown[];
}

export function getBlockDocumentRequest(
  apiFetch: typeof fetch,
  id: string,
): Promise<BrowserBlockDocument>;

export function updateBlockDocumentRequest(
  apiFetch: typeof fetch,
  id: string,
  blocks: readonly BrowserBlockDraft[],
  revisionNumber: number,
  csrfToken: string,
): Promise<BrowserBlockDocument>;

export interface BrowserDataSource {
  readonly id: string;
  readonly name: string;
}

export interface BrowserRecord {
  readonly item: { readonly id: string; readonly sourceId: string };
  readonly page: { readonly id: string; readonly title: string };
  readonly propertyRevisionNumber: number;
  readonly values: Readonly<Record<string, unknown>>;
  readonly outgoing: readonly {
    readonly id: string;
    readonly targetRecordId: string;
  }[];
}

export function getDataSourcesRequest(
  apiFetch: typeof fetch,
): Promise<readonly BrowserDataSource[]>;
export function createDataSourceRequest(
  apiFetch: typeof fetch,
  name: string,
  csrfToken: string,
): Promise<BrowserDataSource>;
export function createRecordRequest(
  apiFetch: typeof fetch,
  sourceId: string,
  title: string,
  csrfToken: string,
): Promise<BrowserRecord>;
export function setRecordPropertyRequest(
  apiFetch: typeof fetch,
  recordId: string,
  definitionId: string,
  value: unknown,
  revisionNumber: number,
  csrfToken: string,
): Promise<BrowserRecord>;
export function addRecordRelationRequest(
  apiFetch: typeof fetch,
  recordId: string,
  definitionId: string,
  targetRecordId: string,
  revisionNumber: number,
  csrfToken: string,
): Promise<BrowserRecord>;
export function removeRecordRelationRequest(
  apiFetch: typeof fetch,
  edgeId: string,
  revisionNumber: number,
  csrfToken: string,
): Promise<BrowserRecord>;

export function getSessionRequest(apiFetch: typeof fetch): Promise<boolean>;

export interface BrowserAsset {
  readonly id: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly createdAt: string;
}

export function getAssetsRequest(
  apiFetch: typeof fetch,
): Promise<readonly BrowserAsset[]>;
export function uploadAssetRequest(
  apiFetch: typeof fetch,
  file: File,
  csrfToken: string,
): Promise<BrowserAsset>;
export function downloadAssetRequest(
  apiFetch: typeof fetch,
  id: string,
): Promise<Blob>;
export interface BrowserPageAsset {
  readonly link: Readonly<Record<string, unknown>>;
  readonly asset: BrowserAsset;
}
export function getPageAssetsRequest(
  apiFetch: typeof fetch,
  pageId: string,
): Promise<readonly BrowserPageAsset[]>;
export function attachPageAssetRequest(
  apiFetch: typeof fetch,
  pageId: string,
  assetId: string,
  csrfToken: string,
): Promise<Readonly<Record<string, unknown>>>;
export function unlinkPageAssetRequest(
  apiFetch: typeof fetch,
  pageId: string,
  assetId: string,
  csrfToken: string,
): Promise<Readonly<Record<string, unknown>>>;

export function loginRequest(
  apiFetch: typeof fetch,
  email: string,
  password: string,
): Promise<void>;

export function logoutRequest(
  apiFetch: typeof fetch,
  csrfToken: string,
): Promise<void>;

export function startBrowserApp(
  documentObject?: BrowserDocument,
  apiFetch?: typeof fetch,
): Promise<void>;
