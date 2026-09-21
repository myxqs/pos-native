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

export function createPageRequest(
  apiFetch: typeof fetch,
  title: string,
  csrfToken: string,
): Promise<{ page: { id: string; title: string }; revisionNumber: number }>;

export function updatePageRequest(
  apiFetch: typeof fetch,
  id: string,
  title: string,
  revisionNumber: number,
  csrfToken: string,
): Promise<{ page: { id: string; title: string }; revisionNumber: number }>;

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
