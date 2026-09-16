export function createPageRequest(
  apiFetch: typeof fetch,
  title: string,
): Promise<{ page: { id: string; title: string } }>;

export function updatePageRequest(
  apiFetch: typeof fetch,
  id: string,
  title: string,
): Promise<{ page: { id: string; title: string } }>;
