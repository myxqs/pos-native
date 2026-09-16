import { expect, test } from "vitest";

import { hashPassword, verifyPassword } from "../src/password.ts";

test("hashes a password with Argon2id and verifies only the original secret", async () => {
  const digest = await hashPassword("correct horse battery staple");
  expect(digest).toMatch(/^\$argon2id\$/);
  await expect(
    verifyPassword(digest, "correct horse battery staple"),
  ).resolves.toBe(true);
  await expect(verifyPassword(digest, "incorrect secret")).resolves.toBe(false);
});

test("rejects empty passwords before invoking the hashing library", async () => {
  await expect(hashPassword(" ")).rejects.toThrow("password must not be empty");
});

test("rejects passwords beyond the configured input boundary", async () => {
  await expect(hashPassword("a".repeat(1025))).rejects.toThrow(
    "password exceeds maximum length",
  );
});
