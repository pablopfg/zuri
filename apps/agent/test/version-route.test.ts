import { APP_VERSION, apiErrorSchema, serverVersionSchema } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { call, CSRF, HUMAN_TOKEN, ORIGIN, signedCookies, TEST_EMAIL, TEST_PASSWORD } from "./helpers.ts";

const IP = "192.0.2.230";
const headers = (cookie?: string) => ({
  ...CSRF,
  "content-type": "application/json",
  "cf-connecting-ip": IP,
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36",
  ...(cookie ? { cookie } : {}),
});

async function signIn(): Promise<string> {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  return signedCookies(res);
}

describe("GET /api/version (PR S16)", () => {
  it("answers the signed-in owner with the number the Worker runs, and nothing else", async () => {
    const cookie = await signIn();
    const res = await call(`${ORIGIN}/api/version`, { headers: headers(cookie) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    // Strict: a deployment id or any other field would fail the parse.
    expect(serverVersionSchema.parse(body)).toEqual({ version: APP_VERSION });
    expect(Object.keys(body as object)).toEqual(["version"]);
  });

  it("needs a session and the CSRF header, and takes no other verb", async () => {
    const anonymous = await call(`${ORIGIN}/api/version`, { headers: headers() });
    expect(anonymous.status).toBe(401);
    expect(apiErrorSchema.parse(await anonymous.json()).code).toBe("UNAUTHORIZED");
    const cookie = await signIn();
    // SEC: a read from another site's page (no CSRF header) is refused before the route.
    const forged = await call(`${ORIGIN}/api/version`, { headers: { cookie, "cf-connecting-ip": IP, "user-agent": headers()["user-agent"] } });
    expect(forged.status).toBe(403);
    expect(apiErrorSchema.parse(await forged.json()).code).toBe("CSRF_FAILED");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await call(`${ORIGIN}/api/version`, { method, headers: headers(cookie) });
      expect(res.status, method).toBe(404);
    }
  });
});
