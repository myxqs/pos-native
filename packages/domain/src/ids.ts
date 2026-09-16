export type NativeId = string & { readonly __brand: "NativeId" };

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function asNativeId(value: string): NativeId {
  if (!UUID_V4_PATTERN.test(value)) {
    throw new ValidationError("native ID must be a UUID v4");
  }

  return value as NativeId;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
