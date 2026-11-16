import { describe, expect, it } from "vitest";
import { CONFIRM_LINK_LIMITS, CONFIRM_TOKEN, confirmAnswerSchema, confirmLinkToken, confirmViewSchema } from "../src/confirm-link.ts";

// E7a (docs/planos/link-de-confirmacao.md): the shape of the patient's token and of the two bodies.

// A made-up token of the right shape (22 base64url characters).
const TOKEN = `${"Ex".repeat(10)}_9`;

describe("the confirmation token", () => {
  it("is exactly 22 base64url characters: 21 and 23 are refused, and so is any other character", () => {
    expect(TOKEN).toHaveLength(CONFIRM_LINK_LIMITS.tokenLength);
    expect(CONFIRM_TOKEN.test(TOKEN)).toBe(true);
    expect(CONFIRM_TOKEN.test(TOKEN.slice(1))).toBe(false);
    expect(CONFIRM_TOKEN.test(`${TOKEN}a`)).toBe(false);
    expect(CONFIRM_TOKEN.test(`${TOKEN.slice(1)}-`)).toBe(true);
    expect(CONFIRM_TOKEN.test(`${TOKEN.slice(1)}_`)).toBe(true);
    for (const bad of ["+", "/", "=", ".", " ", "%", "é"]) expect(CONFIRM_TOKEN.test(`${TOKEN.slice(1)}${bad}`), bad).toBe(false);
  });

  it("is read only from /c/<token>, with nothing after it", () => {
    expect(confirmLinkToken(`/c/${TOKEN}`)).toBe(TOKEN);
    for (const path of [`/c/${TOKEN}/`, `/c/${TOKEN}/x`, `/c/${TOKEN.slice(1)}`, "/c/", "/c", `/x/${TOKEN}`, `/cc/${TOKEN}`, `/c//${TOKEN}`]) expect(confirmLinkToken(path), path).toBeNull();
  });

  it("takes the token and one of the two actions, and nothing longer than 64 characters", () => {
    expect(confirmViewSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(confirmViewSchema.safeParse({ token: "x".repeat(64) }).success).toBe(true);
    expect(confirmViewSchema.safeParse({ token: "x".repeat(65) }).success).toBe(false);
    expect(confirmViewSchema.safeParse({}).success).toBe(false);
    expect(confirmAnswerSchema.safeParse({ token: TOKEN, action: "confirm" }).success).toBe(true);
    expect(confirmAnswerSchema.safeParse({ token: TOKEN, action: "cancel" }).success).toBe(true);
    expect(confirmAnswerSchema.safeParse({ token: TOKEN, action: "reschedule" }).success).toBe(false);
    expect(confirmAnswerSchema.safeParse({ token: TOKEN }).success).toBe(false);
  });
});
