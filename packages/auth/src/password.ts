import argon2 from "argon2";

const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
const MAX_PASSWORD_LENGTH = 1024;

export async function hashPassword(password: string): Promise<string> {
  requirePassword(password);
  return argon2.hash(password, ARGON2ID_OPTIONS);
}

export async function verifyPassword(
  digest: string,
  password: string,
): Promise<boolean> {
  requirePassword(password);
  return argon2.verify(digest, password);
}

function requirePassword(password: string): void {
  if (!password.trim()) {
    throw new Error("password must not be empty");
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error("password exceeds maximum length");
  }
}
