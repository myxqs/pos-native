# POS Native Foundation Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a tested, auditable canonical page-creation command that all future mutation paths can share.

**Architecture:** A framework-free TypeScript domain package exposes branded native IDs, validated page commands, revision/audit contracts, and a deterministic mutation result. Tests use Node's native runner and inject clock/ID dependencies, keeping the command pure and ready for a transactional PostgreSQL repository in the next phase.

**Tech Stack:** Node.js 24, TypeScript syntax executed by Node's native type stripping, npm workspaces, `node:test`.

**Spec:** `docs/architecture/pos-native-foundation.md`

## Global Constraints

- Canonical IDs are POS Native UUIDs; external IDs are mappings only.
- Every mutation emits a revision and append-oriented audit event.
- No external integration, personal data, telemetry, dynamic execution or direct storage mutation.
- Production dependencies require a separate explicit approval.
- The existing Notion POS must remain untouched.

---

## File Structure

- `packages/domain/src/ids.ts` — opaque native identity helpers.
- `packages/domain/src/page.ts` — page command validation and mutation result.
- `packages/domain/src/audit.ts` — immutable audit/revision value contracts.
- `packages/domain/src/index.ts` — public package surface.
- `packages/domain/test/page.test.ts` — real command behaviour tests.
- `package.json` — workspace scripts only.

### Task 1: Canonical page creation command

**Files:**

- Create: `package.json`
- Create: `packages/domain/src/ids.ts`
- Create: `packages/domain/src/audit.ts`
- Create: `packages/domain/src/page.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/test/page.test.ts`

**Interfaces:**

- Consumes: `CreatePageCommand`, `CreatePageDependencies`.
- Produces: `createPage(command, dependencies): CreatePageMutation`.

- [ ] **Step 1: Write the failing test**

```ts
test("creates a native page with revision and audit event", () => {
  const mutation = createPage(
    {
      title: "Control Centre",
      actorType: "user",
      actorId: "user-1",
      source: "human-ui",
    },
    deps,
  );
  assert.equal(mutation.page.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(mutation.revision.entityId, mutation.page.id);
  assert.equal(mutation.audit.action, "page.created");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because `createPage` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
export function createPage(
  command: CreatePageCommand,
  deps: CreatePageDependencies,
): CreatePageMutation {
  const title = command.title.trim();
  if (!title) throw new ValidationError("title must not be empty");
  const id = asNativeId(deps.newId());
  const timestamp = deps.now().toISOString();
  // Return immutable page, revision, and audit values using the same ID/time.
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`

Expected: PASS with zero failures.

- [ ] **Step 5: Add validation/audit coverage and rerun**

```ts
test("rejects a whitespace-only title", () => {
  assert.throws(
    () =>
      createPage(
        {
          title: "  ",
          actorType: "user",
          actorId: "user-1",
          source: "human-ui",
        },
        deps,
      ),
    /title must not be empty/,
  );
});
```

Run: `npm test`

Expected: PASS with zero failures.

## Self-review

The plan intentionally covers only the foundation delivery slice. PostgreSQL,
authentication, UI, flexible data sources, search, assets, migration and MCP
remain separate independently testable phases documented in the foundation
architecture, avoiding an unreviewable mega-implementation.
