# GitHub Reconciliation Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the existing TypeScript/PostgreSQL NativePOS history as the protected canonical GitHub implementation while preserving the unrelated Python/SQLite history as an accessible legacy reference.

**Architecture:** The two histories remain independent Git graphs. The TypeScript candidate receives only truthful documentation and a secret-free verification workflow; it is then protected, made default, and renamed to `main` without merging, rebasing, forcing, deleting, or rewriting either history. The Python baseline is retained by its immutable annotated tag and by renaming its old `main` branch to `legacy/python-sqlite-v0.1`.

**Tech Stack:** Git, GitHub Rulesets and Actions, Node.js 24, npm lockfile v3, TypeScript, Vitest.

**Spec:** `docs/specs/pos-native-v1.md`; user-approved GitHub reconciliation directive dated 2026-09-23.

## Verified Preconditions

- Local recovery tag `pre-github-reconciliation-2026-09-23` targets `12dd0a6d6820d7e12f1e62f9b7644fa1f619c7d4`; the complete all-ref bundle has already been verified outside the repository.
- Remote `DefaultGod/pos-native` was verified public and MIT, with default Python `main` at `f0ed930095dd7013ff98148ce05651b3c0140c9f`, the secondary `docs/github-foundations-setup` branch, no pre-existing tags, and a `main`-only four-rule protection requiring Python checks.
- The annotated remote `legacy-python-sqlite-v0.1` tag already targets the verified Python baseline, and the unmodified TypeScript candidate `canonical/typescript-postgres` already targets `12dd0a6d6820d7e12f1e62f9b7644fa1f619c7d4`.

## Global Constraints

- Preserve the verified Python/SQLite baseline `f0ed930095dd7013ff98148ce05651b3c0140c9f` as a legacy/reference history.
- Keep canonical TypeScript/PostgreSQL history separate; never use `git merge --allow-unrelated-histories`, pull, rebase, reset, force push, or delete a remote branch/tag.
- Notion remains canonical until the approved migration, integrity, retrieval, backup, and restore gates pass.
- Do not start M4 or import/migrate live Notion data during this reconciliation.
- Candidate CI must use only public dependencies, read-only GitHub permissions, and no secrets, Docker, or live PostgreSQL service.
- The required canonical status check is `verify`; the old Python `test (3.11)` and `test (3.12)` contexts must not remain required on TypeScript `main`.

## Review Focus

- A public README must not imply that the unproven live PostgreSQL or browser/mobile acceptance gates have passed.
- Security documentation must name the actual authenticated mutation boundary without claiming inactive API-token behaviour.
- The TypeScript workflow must fail a protected branch on format, lint, type, unit-test, or production-build regressions while honestly retaining opt-in PostgreSQL skips.
- Candidate and final `main` protection must require `verify` and preserve pull-request, deletion, and force-push safeguards.
- The legacy Python branch/tag and the secondary `docs/github-foundations-setup` branch must remain reachable after cutover.

---

### Task 1: Truthful public surface and TypeScript verification workflow

**Files:**

- Create: `.github/workflows/verify.yml`
- Create: `docs/superpowers/plans/2026-09-23-github-reconciliation.md`
- Modify: `README.md`
- Modify: `STATUS.md`
- Modify: `docs/architecture/security.md`
- Modify: `docs/architecture/DONOR_MATRIX.md`

**Interfaces:**

- Consumes: the current TypeScript scripts `npm run verify` and `npm run build` from `package.json`.
- Produces: GitHub Actions job status `verify`, truthful public implementation boundaries, and an auditable reconciliation handover.

- [ ] **Step 1: Prove the stale documentation contract fails before editing**

Run:

```powershell
rg -U -q "no\s+network service|current API has no\s+mutation routes|remaining M3 work is a clean local commit" README.md STATUS.md docs/architecture/security.md
if ($LASTEXITCODE -eq 0) { exit 1 }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
exit 0
```

Expected: exit `1`, because the stale claims are still present.

- [ ] **Step 2: Prove the workflow contract fails before creation**

Run:

```powershell
node --input-type=module -e "import { existsSync } from 'node:fs'; if (existsSync('.github/workflows/verify.yml')) process.exit(1);"
```

Expected: exit `0`, proving the required workflow is absent.

- [ ] **Step 3: Make the minimal documentation and workflow changes**

Create `.github/workflows/verify.yml`:

```yaml
name: TypeScript verification

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    name: verify
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run verify
      - run: npm run build
```

Update the listed documents so they state: TypeScript/PostgreSQL is the active implementation; Fastify plus the responsive browser shell already exist; live PostgreSQL and real browser/mobile acceptance remain unproven; mutations pass cookie-session, CSRF, validation, revision/audit boundaries; M3 is landed at `12dd0a6`; M4 is paused; Notion remains canonical; Python/SQLite is legacy/reference only; Open-Self is reference/deferred only.

- [ ] **Step 4: Verify the static public-surface and workflow contracts**

Run:

```powershell
rg -U -q "no\s+network service|current API has no\s+mutation routes|remaining M3 work is a clean local commit" README.md STATUS.md docs/architecture/security.md
if ($LASTEXITCODE -eq 0) { exit 1 }
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
node --input-type=module -e "import { readFileSync } from 'node:fs'; const text=readFileSync('.github/workflows/verify.yml','utf8'); for (const fragment of ['name: TypeScript verification','name: verify','node-version: 24','npm ci','npm run verify','npm run build','contents: read']) if (!text.includes(fragment)) throw new Error('Missing '+fragment);"
```

Expected: exit `0` for both commands.

- [ ] **Step 5: Run the complete local TypeScript verification**

Run:

```powershell
npm run verify
npm run build
```

Expected: formatting, lint, strict typecheck, and all non-opt-in tests pass; the PostgreSQL integration suite remains explicitly skipped without `TEST_DATABASE_URL`; build exits `0`.

- [ ] **Step 6: Commit the candidate-only reconciliation content**

```bash
git add README.md STATUS.md docs/architecture/security.md docs/architecture/DONOR_MATRIX.md docs/superpowers/plans/2026-09-23-github-reconciliation.md .github/workflows/verify.yml
git commit -m "ci: verify canonical TypeScript candidate"
```

### Task 2: Publish and prove the candidate branch

**Files:**

- Modify: no additional source files expected.

**Interfaces:**

- Consumes: the committed `verify` workflow from Task 1.
- Produces: a remote candidate head equal to the local candidate and a successful GitHub Actions `verify` run.

- [ ] **Step 1: Push only a fast-forward candidate update**

```bash
git push origin canonical/typescript-postgres
git ls-remote --heads origin refs/heads/canonical/typescript-postgres
```

Expected: remote candidate SHA equals `git rev-parse canonical/typescript-postgres`; no other remote ref changes.

- [ ] **Step 2: Verify the candidate tree and history**

```bash
git diff --check 12dd0a6d6820d7e12f1e62f9b7644fa1f619c7d4..canonical/typescript-postgres
git log --oneline --decorate 12dd0a6d6820d7e12f1e62f9b7644fa1f619c7d4..canonical/typescript-postgres
git ls-files | rg '(^|/)(\.env|.*\.pem|.*\.key|.*\.sqlite|.*\.db)$' && exit 1 || exit 0
```

Expected: whitespace check succeeds, history contains only reconciliation documentation/CI, and no tracked secret/database artifacts are reported.

- [ ] **Step 3: Observe a successful GitHub Actions run**

Open the candidate Actions page and confirm the `TypeScript verification / verify` job succeeds on the pushed candidate SHA.

Expected: one successful `verify` status; no Python test context is treated as proof for the candidate.

### Task 3: Protect, cut over, and verify without joining histories

**Files:**

- Modify: GitHub repository metadata and existing ruleset only; no source files expected.

**Interfaces:**

- Consumes: the successful candidate `verify` status and existing `Protect main` four-rule ruleset.
- Produces: protected TypeScript `main`, preserved Python legacy branch/tag, and separately reachable histories.

- [ ] **Step 1: Extend equivalent protection to the candidate before default-branch change**

In GitHub Rulesets, update the existing four-rule protection to apply to both `main` and `canonical/typescript-postgres`, retain pull-request/deletion/force-push restrictions, and replace Python-required contexts with the successful TypeScript `verify` context.

Expected: the candidate page reports the active ruleset and `verify` as the only required application check.

- [ ] **Step 2: Change the default branch only after the candidate is protected**

Set the repository default branch from Python `main` to `canonical/typescript-postgres`.

Expected: the old Python `main` branch remains intact and the repository default is the protected candidate.

- [ ] **Step 3: Rename branches without deletion or overwrite**

Rename the old Python `main` branch to `legacy/python-sqlite-v0.1`, then rename `canonical/typescript-postgres` to `main`.

Expected: the old commit remains accessible through both `legacy/python-sqlite-v0.1` and annotated tag `legacy-python-sqlite-v0.1`; the new default `main` resolves to the TypeScript candidate; no merge or force push occurred.

- [ ] **Step 4: Perform post-cutover verification**

Confirm in GitHub that `main` is the default, `legacy/python-sqlite-v0.1` and `docs/github-foundations-setup` remain listed, the legacy tag resolves to `f0ed930095dd7013ff98148ce05651b3c0140c9f`, and the active `main` ruleset requires `verify` rather than Python contexts.

Expected: all preservation and protection conditions hold; M4 remains paused.
