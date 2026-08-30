import { describe, expect, test } from "vitest";
import { generateToken, hashPassword, hashToken, isValidEmail, verifyPassword } from "../lib/auth";

describe("hashPassword / verifyPassword", () => {
  test("a hashed password verifies against the original plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  test("the wrong password fails verification", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password entirely", hash)).resolves.toBe(false);
  });

  test("hashing the same password twice produces two different hashes (salted)", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(a).not.toBe(b);
  });

  test("the stored hash is never the plaintext password itself", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toBe("hunter2");
    expect(hash.length).toBeGreaterThan(20);
  });
});

describe("generateToken", () => {
  test("produces a long, URL-safe hex string", () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(token.length).toBe(64); // 32 random bytes, hex-encoded
  });

  test("two calls never produce the same token", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
});

describe("hashToken", () => {
  test("is deterministic — the same input always hashes the same way", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  test("never returns the raw token back", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toBe(token);
  });

  test("different tokens hash to different values", () => {
    const a = generateToken();
    const b = generateToken();
    expect(hashToken(a)).not.toBe(hashToken(b));
  });
});

describe("isValidEmail", () => {
  test.each([
    "nick@example.com",
    "first.last@sub.example.co.uk",
    "n+tag@example.com",
  ])("accepts a well-formed address: %s", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  test.each([
    "not-an-email",
    "missing-domain@",
    "@missing-local.com",
    "spaces in@email.com",
    "",
  ])("rejects a malformed address: %s", (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});
