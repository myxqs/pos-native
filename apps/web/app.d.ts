export interface BrowserEvent {
  preventDefault(): void;
}

export interface BrowserElement {
  disabled: boolean;
  hidden: boolean;
  textContent: string;
  type: string;
  value: string;
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

export function getSessionRequest(apiFetch: typeof fetch): Promise<boolean>;

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
