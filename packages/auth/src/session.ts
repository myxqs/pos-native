import { createHash, timingSafeEqual } from "node:crypto";

import { verifyPassword } from "./password.ts";

export interface LocalAccount {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
}

export interface StoredSession {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly csrfTokenHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  revokedAt: string | null;
}

export interface AuthenticationStore {
  findAccountByEmail(email: string): Promise<LocalAccount | null>;
  createSession(session: StoredSession): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  revokeSession(tokenHash: string, revokedAt: string): Promise<void>;
}

export interface AuthenticationDependencies {
  readonly now: () => Date;
  readonly randomToken: () => string;
  readonly sessionId: () => string;
}

export class AuthenticationService {
  constructor(
    private readonly store: AuthenticationStore,
    private readonly dependencies: AuthenticationDependencies,
  ) {}

  async login(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const account = await this.store.findAccountByEmail(email);
    if (!account || !(await verifyPassword(account.passwordHash, password))) {
      throw new Error("invalid credentials");
    }

    const sessionToken = this.dependencies.randomToken();
    const csrfToken = this.dependencies.randomToken();
    const createdAt = this.dependencies.now();
    const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    await this.store.createSession({
      id: this.dependencies.sessionId(),
      userId: account.id,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    });
    return {
      sessionToken,
      csrfToken,
      userId: account.id,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async authenticate(sessionToken: string): Promise<{ userId: string }> {
    const session = await this.store.findSessionByTokenHash(
      hashToken(sessionToken),
    );
    if (
      !session ||
      session.revokedAt ||
      new Date(session.expiresAt) <= this.dependencies.now()
    ) {
      throw new Error("invalid session");
    }
    return { userId: session.userId };
  }

  async requireCsrf(sessionToken: string, csrfToken: string): Promise<void> {
    await this.authenticate(sessionToken);
    const session = await this.store.findSessionByTokenHash(
      hashToken(sessionToken),
    );
    if (
      !session ||
      !safeHashEqual(session.csrfTokenHash, hashToken(csrfToken))
    ) {
      throw new Error("invalid CSRF token");
    }
  }

  async logout(sessionToken: string): Promise<void> {
    await this.store.revokeSession(
      hashToken(sessionToken),
      this.dependencies.now().toISOString(),
    );
  }
}

export class InMemoryAuthenticationStore implements AuthenticationStore {
  readonly sessions: StoredSession[] = [];
  readonly #accounts: readonly LocalAccount[];

  constructor(accounts: readonly LocalAccount[]) {
    this.#accounts = accounts;
  }

  async findAccountByEmail(email: string): Promise<LocalAccount | null> {
    return (
      this.#accounts.find((account) => account.email.toLowerCase() === email) ??
      null
    );
  }

  async createSession(session: StoredSession): Promise<void> {
    this.sessions.push({ ...session });
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null> {
    return (
      this.sessions.find((session) => session.tokenHash === tokenHash) ?? null
    );
  }

  async revokeSession(tokenHash: string, revokedAt: string): Promise<void> {
    const session = this.sessions.find(
      (candidate) => candidate.tokenHash === tokenHash,
    );
    if (session) session.revokedAt = revokedAt;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
