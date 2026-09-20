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
