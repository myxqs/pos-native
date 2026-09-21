import type { AuditEvent, Revision } from "../../domain/src/audit.ts";
import type { Asset, CreateAssetMutation } from "../../domain/src/asset.ts";
import type { NativeId } from "../../domain/src/ids.ts";

export interface PersistedAssetMetadata {
  readonly asset: Asset;
  readonly revisionNumber: number;
}

export interface AssetMetadataRepository {
  /**
   * Persists one canonical asset creation atomically. If this rejects, none of
   * the asset, revision, or audit event from the supplied mutation may be
   * observable afterwards. Implementations must use a local transaction or an
   * equivalent rollback boundary; callers cannot repair a partial metadata
   * commit by compensating filesystem bytes.
   */
  create(mutation: CreateAssetMutation): Promise<Asset>;
  getById(id: NativeId): Promise<PersistedAssetMetadata | null>;
  list(): Promise<readonly Asset[]>;
}

type FailurePoint = "before-revision" | "before-audit";

export class InMemoryAssetMetadataRepository implements AssetMetadataRepository {
  readonly #assets = new Map<NativeId, PersistedAssetMetadata>();
  readonly #storageKeys = new Map<string, NativeId>();
  readonly #revisions: Revision<Asset, "asset">[] = [];
  readonly #audits: AuditEvent<Asset, "asset", "asset.created">[] = [];
  readonly #failAt: FailurePoint | undefined;

  constructor(options: { readonly failAt?: FailurePoint } = {}) {
    this.#failAt = options.failAt;
  }

  async create(mutation: CreateAssetMutation): Promise<Asset> {
    if (this.#assets.has(mutation.asset.id)) {
      throw new Error("asset already exists");
    }
    if (this.#storageKeys.has(mutation.asset.storageKey)) {
      throw new Error("asset storage key already exists");
    }
    return this.#persist(mutation);
  }

  async getById(id: NativeId): Promise<PersistedAssetMetadata | null> {
    return this.#assets.get(id) ?? null;
  }

  async list(): Promise<readonly Asset[]> {
    return [...this.#assets.values()]
      .map(({ asset }) => asset)
      .sort(compareAssets);
  }

  revisionsFor(id: NativeId): readonly Revision<Asset, "asset">[] {
    return this.#revisions.filter((revision) => revision.entityId === id);
  }

  auditFor(
    id: NativeId,
  ): readonly AuditEvent<Asset, "asset", "asset.created">[] {
    return this.#audits.filter((audit) => audit.targetId === id);
  }

  #persist(mutation: CreateAssetMutation): Asset {
    const previousAsset = this.#assets.get(mutation.asset.id);
    const previousStorageKeyOwner = this.#storageKeys.get(
      mutation.asset.storageKey,
    );
    const revisionLength = this.#revisions.length;
    const auditLength = this.#audits.length;

    try {
      this.#assets.set(mutation.asset.id, {
        asset: mutation.asset,
        revisionNumber: mutation.revision.revisionNumber,
      });
      this.#storageKeys.set(mutation.asset.storageKey, mutation.asset.id);
      this.#injectFailure("before-revision");
      this.#revisions.push(mutation.revision);
      this.#injectFailure("before-audit");
      this.#audits.push(mutation.audit);
      return mutation.asset;
    } catch (error) {
      if (previousAsset) {
        this.#assets.set(mutation.asset.id, previousAsset);
      } else {
        this.#assets.delete(mutation.asset.id);
      }
      if (previousStorageKeyOwner) {
        this.#storageKeys.set(
          mutation.asset.storageKey,
          previousStorageKeyOwner,
        );
      } else {
        this.#storageKeys.delete(mutation.asset.storageKey);
      }
      this.#revisions.length = revisionLength;
      this.#audits.length = auditLength;
      throw error;
    }
  }

  #injectFailure(point: FailurePoint): void {
    if (this.#failAt === point) {
      throw new Error(`injected failure ${point.replace("-", " ")}`);
    }
  }
}

function compareAssets(left: Asset, right: Asset): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}
