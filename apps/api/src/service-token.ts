import { createHash, timingSafeEqual } from "node:crypto";

import type { AuditActorType } from "../../../packages/domain/src/audit.ts";

export interface ServiceActor {
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
}

export class ServiceTokenAuthenticator {
  readonly #tokenHash: Buffer;

  constructor(
    token: string,
    readonly actorId: string,
  ) {
    this.#tokenHash = digest(token);
  }

  authenticate(header: string | undefined): ServiceActor | null {
    if (!header?.startsWith("Bearer ")) return null;
    const candidate = header.slice("Bearer ".length);
    if (!candidate || candidate.includes(" ")) return null;
    const candidateHash = digest(candidate);
    if (!timingSafeEqual(this.#tokenHash, candidateHash)) return null;
    return Object.freeze({
      actorType: "api-token" as const,
      actorId: this.actorId,
      source: "machine-api",
    });
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
