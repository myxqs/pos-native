export interface StoredIdempotencyRecord<TResponse> {
  readonly requestHash: string;
  readonly response: TResponse;
}

export interface IdempotencyStore<TResponse> {
  claim(request: IdempotencyRequest): Promise<IdempotencyClaim<TResponse>>;
  complete(key: string, response: TResponse): Promise<void>;
}

export interface IdempotencyRequest {
  readonly key: string;
  readonly requestHash: string;
}

export interface IdempotencyResult<TResponse> {
  readonly response: TResponse;
  readonly replayed: boolean;
}

export type IdempotencyClaim<TResponse> =
  | { readonly state: "claimed" }
  | {
      readonly state: "replay";
      readonly record: StoredIdempotencyRecord<TResponse>;
    };

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key was reused with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export async function executeIdempotently<TResponse>(
  request: IdempotencyRequest,
  store: IdempotencyStore<TResponse>,
  execute: () => Promise<TResponse>,
): Promise<IdempotencyResult<TResponse>> {
  const claim = await store.claim(request);
  if (claim.state === "replay") {
    return { response: claim.record.response, replayed: true };
  }

  const response = await execute();
  await store.complete(request.key, response);
  return { response, replayed: false };
}
