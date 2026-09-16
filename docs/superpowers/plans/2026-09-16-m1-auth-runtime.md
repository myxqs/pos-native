# M1 Authentication and Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the page API with secure local login, server-side sessions, CSRF validation, and an explicit runtime composition boundary.

**Architecture:** An authentication service verifies the one local account and stores only hashes of random session and CSRF tokens. Fastify resolves the session cookie into an authenticated actor; unsafe routes require the matching CSRF header. In-memory stores prove behaviour without weakening the PostgreSQL production boundary, which remains an opt-in live integration gate.

**Tech Stack:** Node.js crypto, Argon2id, Fastify 5, Zod 4, Drizzle/PostgreSQL, Vitest 5.

**Spec:** `docs/specs/pos-native-v1.md`

## Global Constraints

- No route trusts actor identity supplied by the browser.
- Cookies are HttpOnly, SameSite=Strict, Path=/, and Secure in production.
- Raw session tokens, CSRF tokens, and passwords are never persisted or logged.
- Authentication failures disclose no account-enumeration detail.
- PostgreSQL verification is not claimed without `TEST_DATABASE_URL`.

### Task 1: Session service

**Files:** Create `packages/auth/src/session.ts`; test `packages/auth/test/session.test.ts`.

- [ ] Write failing tests for successful login, generic rejection, hashed-token persistence, expiry, and logout revocation.
- [ ] Implement the minimal account/session store contracts and service using injected randomness and clock.
- [ ] Run focused tests and strict type checking.

### Task 2: Fastify authentication and CSRF boundary

**Files:** Create `apps/api/src/auth-routes.ts`; modify `apps/api/src/app.ts` and `page-routes.ts`; test `apps/api/test/auth-routes.test.ts`.

- [ ] Write failing tests proving login sets a secure session cookie, session lookup returns CSRF state, unauthenticated writes fail, missing CSRF fails, and logout revokes the session.
- [ ] Implement login/session/logout routes and request guards.
- [ ] Derive audit actor identity only from the authenticated session.
- [ ] Run API tests and full verification.

### Task 3: Runtime composition and checkpoint

**Files:** Create `apps/api/src/server.ts`; modify `.env.example`, operations docs, `STATUS.md`, and `CHANGELOG.md`.

- [ ] Write a failing composition test proving page routes are unavailable without auth wiring and available only through the authenticated runtime.
- [ ] Compose the server with explicit stores and fail closed when required production configuration is absent.
- [ ] Run full verification, audit, and diff checks; record skipped live gates and commit.

## Self-review

This plan addresses the immediate security dependency only. Persistent account/session adapters and live PostgreSQL verification remain required before M1 can close; M2 and migration remain out of scope for this checkpoint.
