# Asset Storage Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a safe, filesystem-backed `AssetStore` foundation that stages
local bytes under opaque native keys with validated metadata and verifiable
checksums.

**Architecture:** Add a portable `AssetStore` contract under `packages/assets`,
then implement `FilesystemAssetStore` using a canonicalised configured root and
Node standard-library filesystem/crypto APIs. The store stages bytes and returns
metadata receipts; PostgreSQL metadata, audit/revision mutations, HTTP upload,
and browser controls remain separate later slices.

**Tech Stack:** TypeScript 6 strict mode, Node standard-library `fs`, `path`,
and `crypto`, Vitest 5, Prettier, ESLint.

**Spec:** `docs/superpowers/specs/2026-09-20-asset-storage-foundation-design.md`

## Global Constraints

- Use no new runtime or development dependency and do not run a package install.
- Accept only generated `asset-<native-uuid-v4>` storage keys; never derive a
  path from a filename, MIME value, request path, or provider identity.
- Validate every storage key at runtime before resolving it below the
  canonicalised root.
- Default to a bounded 50 MiB maximum; reject oversized staged bytes before
  opening a temporary file and reject oversized on-disk reads.
- The store is internal-only: no Fastify route, multipart parser, browser UI,
  PostgreSQL metadata mutation, audit/revision event, external provider,
  Notion operation, migration, or cutover in this plan.
- Keep the filesystem/SQL transaction gap explicit: `discard` is only an
  idempotent rollback primitive for a future service, never a user delete API.
- Preserve product-first gates: Notion remains untouched and canonical; live
  PostgreSQL, browser, backup/restore, and migration acceptance stay unclaimed.

## Review Focus

- A filename containing traversal, separators, NUL, or controls is rejected
  before any file exists; Task 1 owns the metadata-validation tests.
- A MIME value with parameters or invalid token characters is rejected and
  normal valid media types are canonicalised; Task 1 owns those tests.
- A byte sequence over the configured limit leaves no target or temporary file;
  Task 2 owns the pre-write-limit test.
- A duplicate or symbolic-link target is refused without overwriting/following
  it; Task 2 owns the destination-containment tests.
- Receipt verification detects altered bytes and reads do not accept an
  unexpectedly oversized on-disk file; Task 2 owns the integrity/bounded-read
  tests.

---

### Task 1: Portable asset-store contract and input validation

**Files:**

- Create: `packages/assets/src/asset-storage.ts`
- Create: `packages/assets/test/asset-storage.test.ts`

**Interfaces:**

- Consumes: `NativeId` and `asNativeId` from
  `packages/domain/src/ids.ts`.
- Produces: `AssetStorageKey`, `AssetStoreReceipt`, `AssetStageInput`,
  `StagedAsset`, `AssetStore`, `storageKeyForAsset`, `asAssetStorageKey`,
  `normaliseAssetMetadata`, `validateAssetByteSize`, and
  `DEFAULT_MAX_ASSET_BYTES` for Task 2.

- [x] **Step 1: Write failing contract and validation tests**

  Create `packages/assets/test/asset-storage.test.ts` with fixed native IDs and
  assertions that pin the exact public boundary:

  ```ts
  import { describe, expect, test } from "vitest";
  import { asNativeId, ValidationError } from "../../domain/src/ids.ts";
  import {
    asAssetStorageKey,
    normaliseAssetMetadata,
    storageKeyForAsset,
    validateAssetByteSize,
  } from "../src/asset-storage.ts";

  const assetId = asNativeId("11111111-1111-4111-8111-111111111111");

  test("derives and validates an opaque asset key from a native ID", () => {
    expect(storageKeyForAsset(assetId)).toBe(
      "asset-11111111-1111-4111-8111-111111111111",
    );
    expect(asAssetStorageKey("../evidence.pdf")).toThrow(ValidationError);
  });

  test("normalises safe metadata without using the filename as a path", () => {
    expect(
      normaliseAssetMetadata({
        originalFilename: "  evidence.pdf  ",
        mimeType: " Text/Plain ",
      }),
    ).toEqual({ originalFilename: "evidence.pdf", mimeType: "text/plain" });
  });

  describe("unsafe asset input", () => {
    test.each(["../evidence.pdf", "folder\\evidence.pdf", "bad\u0000name"])(
      "rejects filename %j",
      (originalFilename) => {
        expect(() =>
          normaliseAssetMetadata({ originalFilename, mimeType: "text/plain" }),
        ).toThrow(ValidationError);
      },
    );

    test.each(["text/plain; charset=utf-8", "text /plain", "text/\u0000plain"])(
      "rejects MIME value %j",
      (mimeType) => {
        expect(() =>
          normaliseAssetMetadata({
            originalFilename: "evidence.txt",
            mimeType,
          }),
        ).toThrow(ValidationError);
      },
    );
  });

  test("requires a non-negative safe byte size within the configured limit", () => {
    expect(() => validateAssetByteSize(-1, 10)).toThrow(ValidationError);
    expect(() => validateAssetByteSize(11, 10)).toThrow(ValidationError);
  });
  ```

- [x] **Step 2: Run the contract test to verify it fails**

  Run:

  ```bash
  npm test -- packages/assets/test/asset-storage.test.ts
  ```

  Expected: FAIL because `packages/assets/src/asset-storage.ts` does not yet
  exist.

- [x] **Step 3: Implement the small portable contract**

  Create `packages/assets/src/asset-storage.ts` with this exact public shape:

  ```ts
  import type { NativeId } from "../../domain/src/ids.ts";
  import { asNativeId, ValidationError } from "../../domain/src/ids.ts";

  export const DEFAULT_MAX_ASSET_BYTES = 50 * 1024 * 1024;
  export type AssetStorageKey = string & {
    readonly __brand: "AssetStorageKey";
  };

  export interface AssetStoreReceipt {
    readonly storageKey: AssetStorageKey;
    readonly byteSize: number;
    readonly sha256: string;
  }

  export interface AssetStageInput {
    readonly id: NativeId;
    readonly originalFilename: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
  }

  export interface StagedAsset extends AssetStoreReceipt {
    readonly id: NativeId;
    readonly originalFilename: string;
    readonly mimeType: string;
  }

  export interface AssetStore {
    stage(input: AssetStageInput): Promise<StagedAsset>;
    read(storageKey: AssetStorageKey): Promise<Uint8Array>;
    verify(receipt: AssetStoreReceipt): Promise<boolean>;
    discard(storageKey: AssetStorageKey): Promise<void>;
  }
  ```

  Implement `storageKeyForAsset(id)` as
  `asAssetStorageKey(\`asset-${asNativeId(id)}\`)`. Make
`asAssetStorageKey`accept only`asset-`followed by a UUID v4 by delegating
the suffix check to`asNativeId`; do not use a looser regex. Implement
`normaliseAssetMetadata`to require string inputs, NFC-normalise and trim the
filename, reject empty/over-255-code-unit names plus`/`, `\\`, NUL, DEL,
and C0 controls, then trim/lowercase the MIME value and accept exactly one
`type/subtype`token with no whitespace or parameter. Implement`validateAssetByteSize(byteSize, maxBytes)`with positive safe-integer`maxBytes`, non-negative safe-integer `byteSize`, and an inclusive maximum.

- [x] **Step 4: Run focused contract tests and strict typecheck**

  Run:

  ```bash
  npm test -- packages/assets/test/asset-storage.test.ts
  npm run typecheck
  ```

  Expected: all focused assertions pass and strict TypeScript reports no error.

- [x] **Step 5: Commit the contract boundary**

  ```bash
  git add packages/assets/src/asset-storage.ts packages/assets/test/asset-storage.test.ts
  git commit -m "feat: add asset storage contract"
  ```

### Task 2: Safe filesystem implementation

**Files:**

- Create: `packages/assets/src/filesystem-asset-store.ts`
- Create: `packages/assets/test/filesystem-asset-store.test.ts`

**Interfaces:**

- Consumes: all types/functions from
  `packages/assets/src/asset-storage.ts`.
- Produces: `FilesystemAssetStore.create(root, options?)`, which implements
  `AssetStore` for the later metadata service.

- [x] **Step 1: Write failing isolated-filesystem tests**

  Create an `afterEach` cleanup registry using `mkdtemp`, `rm`, and
  `tmpdir`. Add tests with `TextEncoder` and fixed native IDs that prove:

  ```ts
  const store = await FilesystemAssetStore.create(root, { maxBytes: 16 });
  const staged = await store.stage({
    id: asNativeId("22222222-2222-4222-8222-222222222222"),
    originalFilename: "evidence.txt",
    mimeType: "text/plain",
    bytes: new TextEncoder().encode("private evidence"),
  });

  expect(staged).toMatchObject({
    storageKey: "asset-22222222-2222-4222-8222-222222222222",
    byteSize: 16,
    sha256: "f7711d1542c029371e0ad7159632c392465700aed13126774e9e8a9575b20078",
  });
  expect(new TextDecoder().decode(await store.read(staged.storageKey))).toBe(
    "private evidence",
  );
  expect(await store.verify(staged)).toBe(true);
  ```

  Add separate tests that:

  1. stage the same ID twice and assert rejection, original bytes remain, and
     no `.pos-native-asset-*.tmp` entry remains;
  2. attempt `maxBytes + 1` bytes and assert the root remains empty;
  3. mutate the stored regular file only inside the isolated root, then assert
     `verify` returns false;
  4. create an unexpected oversized regular file at a valid storage key and
     assert `read` rejects before returning bytes;
  5. create a symbolic-link target for a valid key and assert `read`,
     `verify`, and `discard` reject without reading or deleting the outside
     target. If the host forbids test symlinks with `EPERM`, mark only that test
     skipped with an explicit reason; do not turn it into a passing no-op;
  6. call `discard` twice for a staged regular file and assert both calls
     complete and the root no longer contains the key.

- [x] **Step 2: Run the filesystem tests to verify they fail**

  Run:

  ```bash
  npm test -- packages/assets/test/filesystem-asset-store.test.ts
  ```

  Expected: FAIL because `FilesystemAssetStore` does not exist.

- [x] **Step 3: Implement `FilesystemAssetStore` without filesystem escapes**

  Implement an async `create` factory and private canonical-root operations:

  ```ts
  export class FilesystemAssetStore implements AssetStore {
    static async create(
      configuredRoot: string,
      options: { readonly maxBytes?: number } = {},
    ): Promise<FilesystemAssetStore> {
      const maxBytes = options.maxBytes ?? DEFAULT_MAX_ASSET_BYTES;
      validateAssetByteSize(0, maxBytes);
      const resolvedRoot = resolve(configuredRoot);
      await mkdir(resolvedRoot, { recursive: true });
      return new FilesystemAssetStore(await realpath(resolvedRoot), maxBytes);
    }
  }
  ```

  Resolve a candidate with `resolve(canonicalRoot, asAssetStorageKey(key))` and
  reject it unless `relative(canonicalRoot, candidate)` is a non-empty relative
  filename with no `..` prefix and is not absolute. Use `lstat` for all existing
  candidates; accept only regular non-symbolic-link files.

  For `stage`, call `normaliseAssetMetadata`, validate the input byte length
  before making a temp path, derive `storageKeyForAsset(input.id)`, and reject
  an existing final candidate. Create a same-directory temporary name beginning
  `.pos-native-asset-` with `randomUUID()`, open it with `wx` and mode `0o600`,
  write/sync/close the bytes, then publish it with `link(temporary, final)` and
  `unlink(temporary)`. `link` makes duplicate publication fail with `EEXIST`
  rather than overwriting a concurrent existing key. In `catch`, close any open
  handle and `rm(temporary, { force: true })` before rethrowing. Return the
  normalised metadata plus SHA-256 calculated via `createHash("sha256")` from
  the exact staged bytes.

  Implement `read` with regular-file/symlink checks, `stat.size` limit
  enforcement, and `readFile`. Implement `verify` by calling `read`, checking
  byte size, and comparing a freshly calculated full hex SHA-256 digest.
  Implement `discard` as missing-file success, otherwise regular-file-only
  `unlink`; reject directories and symlinks. Never log bytes, paths outside the
  configured root, filenames, or hashes.

- [x] **Step 4: Run focused filesystem and contract tests**

  Run:

  ```bash
  npm test -- packages/assets/test/asset-storage.test.ts packages/assets/test/filesystem-asset-store.test.ts
  npm run lint
  npm run typecheck
  ```

  Expected: all asset tests pass; any symlink case is either exercised or shown
  as one explicit host-capability skip; lint and strict typecheck pass.

- [x] **Step 5: Commit the filesystem implementation**

  ```bash
  git add packages/assets/src/filesystem-asset-store.ts packages/assets/test/filesystem-asset-store.test.ts
  git commit -m "feat: add filesystem asset store"
  ```

### Task 3: Verification, status, and review checkpoint

**Files:**

- Modify: `STATUS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-09-20-asset-storage-foundation.md`
- Modify: `.superpowers/sdd/asset-storage-foundation/progress.md` (ignored
  execution ledger only)

**Interfaces:**

- Consumes: tested `AssetStore` and `FilesystemAssetStore` from Tasks 1–2.
- Produces: a truthful M1 handover that distinguishes isolated filesystem
  evidence from unrun live PostgreSQL, API, browser, backup/restore, and
  migration acceptance.

- [x] **Step 1: Update status and changelog evidence**

  Record the portable `AssetStore`, opaque keys, canonical root, bounded input
  and reads, atomic no-overwrite write path, SHA-256 verification, and the
  actual test result. State that the store is not yet reachable through a
  public API/browser flow and that PostgreSQL asset metadata, backup/restore,
  and Notion migration remain unverified or out of scope. Set the exact next
  action to the next coherent M1 backup-manifest/restore-proof slice.

- [x] **Step 2: Run full verification and repository checks**

  Run:

  ```bash
  npm run verify
  npm run db:generate
  npm run build -- --listEmittedFiles
  npm audit --omit=dev --json
  git diff --check
  ```

  Expected: formatting, lint, typecheck, tests, schema generation, production
  build, production dependency audit, and whitespace checks pass. Assert that
  the production build emits no test source. The two opt-in PostgreSQL tests
  remain skipped without `TEST_DATABASE_URL`.

- [x] **Step 3: Request independent review and repair any Important finding**

  Give the reviewer the design, this plan, relevant source/tests, and these
  constraints: no external storage/API/migration, no unsafe path handling, and
  no claim beyond isolated filesystem coverage. For each valid Important or
  Critical finding, add the smallest regression test first, observe it fail,
  implement one focused repair, then rerun focused and full verification before
  recording the repair.

- [x] **Step 4: Commit the evidence checkpoint**

  ```bash
  git add STATUS.md CHANGELOG.md docs/superpowers/plans/2026-09-20-asset-storage-foundation.md
  git commit -m "docs: record asset storage verification"
  ```

## Independent review repairs

- [x] Bind file identity, regular-file validation, size validation, and bounded
      reads to one opened handle; deterministic replacement and growth tests
      failed before the repair and pass after it.
- [x] Copy caller-owned bytes before the first asynchronous boundary and use the
      owned snapshot for the write, size, and checksum; the mutation regression
      failed before the repair and passes after it.
- [x] Treat a failed temporary unlink followed by successful fallback cleanup as
      successful publication; the injected cleanup regression failed before the
      repair and passes after it.
- [x] Full post-repair suite: 85 tests passed; the two live PostgreSQL tests
      remained explicitly skipped because `TEST_DATABASE_URL` is absent.

## Plan self-review

- Spec coverage: Tasks 1–2 cover the portable port, opaque native key,
  filename/MIME validation, bounded bytes, checksum receipt, canonical root,
  atomic no-overwrite staging, safe discard, and isolated tests. Task 3 keeps
  the acceptance boundary accurate.
- Placeholder scan: no deferred implementation marker, vague error-handling
  instruction, or implicit test task remains.
- Type consistency: Task 2 consumes the exact contract names defined in Task
  1; no API or database interface is invented.
- Review focus: every listed dangerous input/condition has a named test owner.
- Deliberate gaps: PostgreSQL metadata/audit persistence, API/browser upload,
  external evidence references, S3, backups, restores, and all Notion activity
  are separately scoped and remain blocked/unstarted.

## Execution authorization

The v2 master brief is the approved product direction and explicitly asks for
verified vertical slices. The user has instructed continuous autonomous
execution. Implement this plan natively in the isolated worktree with TDD and
an independent final review; do not wait for routine approval or begin a
Notion-related task.
