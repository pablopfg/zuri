import { AGENT_INSTANCE_NAME, AI_LIMIT_RANGES, apiErrorSchema, DEFAULT_CHAT_MODEL, DEFAULT_FALLBACK_MODEL, settingsSchema, usageHistorySchema, usageReportSchema } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { Database } from "../src/db/database.ts";
import { AppError } from "../src/http/errors.ts";
import { call, CSRF, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// The AI settings and the usage report, through the Worker as the interface calls them.

function runOwner<T>(fn: (db: Database, agent: ZuriAgent) => T | Promise<T>): Promise<T> {
  const stub = testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
  return runInDurableObject(stub, (agent: ZuriAgent, state) => fn(new Database(state.storage), agent));
}

afterEach(async () => {
  await runOwner((db) => {
    db.run(`DELETE FROM zur_settings WHERE key LIKE 'ai\\_%' ESCAPE '\\'`);
    db.run(`DELETE FROM zur_usage_daily`);
    db.run(`DELETE FROM zur_model_usage_daily`);
  });
});

const headers = (ip: string, cookie?: string) => ({
  ...CSRF,
  "content-type": "application/json",
  "cf-connecting-ip": ip,
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36",
  ...(cookie ? { cookie } : {}),
});

async function signIn(ip: string): Promise<string> {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: headers(ip),
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  return signedCookies(res);
}

const usage = (ip: string, cookie?: string) => call(`${ORIGIN}/api/usage`, { headers: headers(ip, cookie) });
const patch = (ip: string, cookie: string, body: unknown) =>
  call(`${ORIGIN}/api/settings`, { method: "PATCH", headers: headers(ip, cookie), body: JSON.stringify(body) });

describe("GET /api/usage", () => {
  it("needs a session and the CSRF header, and is never cached", async () => {
    const res = await usage("192.0.2.90");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cookie = await signIn("192.0.2.90");
    const noCsrf = await call(`${ORIGIN}/api/usage`, { headers: { cookie, "cf-connecting-ip": "192.0.2.90" } });
    expect(noCsrf.status).toBe(403);
  });

  it("reports today against the owner's limits, on Workers AI outside local development", async () => {
    const ip = "192.0.2.91";
    const cookie = await signIn(ip);
    const res = await usage(ip, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const report = usageReportSchema.parse(await res.json());
    expect(report.provider).toBe("workers-ai");
    expect(report.model).toBe(DEFAULT_CHAT_MODEL);
    expect(report.limits).toMatchObject({ requestsPerDay: 200, neuronsPerDay: 9_000, maxOutputTokens: 1_024, audioSecondsPerDay: 3_600 });
    expect(report.today).toMatchObject({ requests: 0, neurons: 0, models: [] });

    expect((await patch(ip, cookie, { aiRequestsPerDay: 50, aiModel: "@cf/qwen/qwen3-30b-a3b-fp8" })).status).toBe(200);
    const after = usageReportSchema.parse(await (await usage(ip, cookie)).json());
    expect(after.limits.requestsPerDay).toBe(50);
    expect(after.model).toBe("@cf/qwen/qwen3-30b-a3b-fp8");
  });
});

describe("the AI settings", () => {
  const cases: [string, number, number, number][] = [
    ["aiRequestsPerDay", AI_LIMIT_RANGES.aiRequestsPerDay.min, AI_LIMIT_RANGES.aiRequestsPerDay.max, AI_LIMIT_RANGES.aiRequestsPerDay.default],
    ["aiNeuronsPerDay", AI_LIMIT_RANGES.aiNeuronsPerDay.min, AI_LIMIT_RANGES.aiNeuronsPerDay.max, AI_LIMIT_RANGES.aiNeuronsPerDay.default],
    ["aiMaxOutputTokens", AI_LIMIT_RANGES.aiMaxOutputTokens.min, AI_LIMIT_RANGES.aiMaxOutputTokens.max, AI_LIMIT_RANGES.aiMaxOutputTokens.default],
  ];

  it.each(cases)("%s takes its exact range and nothing outside it (min−1, min, max, max+1)", async (field, min, max) => {
    const ip = "192.0.2.92";
    const cookie = await signIn(ip);
    for (const [value, status] of [
      [min - 1, 400],
      [min, 200],
      [max, 200],
      [max + 1, 400],
      [min + 0.5, 400],
      [String(min), 400],
      [null, 400],
    ] as const) {
      const res = await patch(ip, cookie, { [field]: value });
      expect(res.status, `${field} = ${String(value)}`).toBe(status);
      if (status === 400) expect(apiErrorSchema.parse(await res.json()).details).toEqual({ fields: [field] });
    }
  });

  it("never lets the Neuron cap above 9,000 a day, 1,000 under the Free plan's allocation", () => {
    expect(AI_LIMIT_RANGES.aiNeuronsPerDay.max).toBe(9_000);
    expect(settingsSchema.shape.aiNeuronsPerDay.safeParse(9_001).success).toBe(false);
    expect(settingsSchema.shape.aiNeuronsPerDay.safeParse(10_000).success).toBe(false);
  });

  it("takes only chat models of the list: no mock, no paid provider, no other text", async () => {
    const ip = "192.0.2.93";
    const cookie = await signIn(ip);
    for (const model of ["mock", "anthropic/claude", "@cf/openai/gpt-oss-20b", "@cf/zai-org/glm-4.7-flash ", ""]) {
      expect((await patch(ip, cookie, { aiModel: model })).status, model).toBe(400);
    }
    expect((await patch(ip, cookie, { aiModel: "@cf/meta/llama-4-scout-17b-16e-instruct" })).status).toBe(200);
  });

  it("reads a stored value an older version allowed as the default, and the agent counts with what is stored", async () => {
    await runOwner((db) => {
      db.run(`INSERT INTO zur_settings (key, value, updated_at) VALUES ('ai_model', '"@cf/meta/llama-2-7b-chat-fp16"', 'x')`);
      db.run(`INSERT INTO zur_settings (key, value, updated_at) VALUES ('ai_requests_per_day', '12', 'x')`);
      db.run(`INSERT INTO zur_settings (key, value, updated_at) VALUES ('ai_neurons_per_day', '99999', 'x')`);
    });
    await runOwner((_db, agent) => {
      expect(agent.aiLimits()).toEqual({ requestsPerDay: 12, neuronsPerDay: 9_000, maxOutputTokens: 1_024, usdCentsPerDay: 0 });
      // Outside local development the provider is Workers AI with the stored (here: default) model.
      expect([agent.ai().id, agent.ai().model]).toEqual(["workers-ai", DEFAULT_CHAT_MODEL]);
    });
  });
});

describe("the paid models through the routes (step 21)", () => {
  it("refuses a paid model without its company's key, as not configured, and leaves the setting as it was", async () => {
    const ip = "192.0.2.94";
    const cookie = await signIn(ip);
    for (const field of ["aiModel", "aiFallbackModel"]) {
      const res = await patch(ip, cookie, { [field]: "anthropic/claude-haiku-5-5" });
      expect(res.status, field).toBe(503);
      expect(apiErrorSchema.parse(await res.json()).code).toBe("NOT_CONFIGURED");
    }
    const report = usageReportSchema.parse(await (await usage(ip, cookie)).json());
    expect(report.model).toBe(DEFAULT_CHAT_MODEL);
    expect(report.providers).toEqual([
      { id: "anthropic", configured: false, state: "ok" },
      { id: "openai", configured: false, state: "ok" },
    ]);
  });

  it("keeps the US$ ceiling off by default and takes the owner's value right after the password", async () => {
    const ip = "192.0.2.95";
    const cookie = await signIn(ip);
    expect(usageReportSchema.parse(await (await usage(ip, cookie)).json()).limits.usdCentsPerDay).toBe(0);
    for (const [value, status] of [
      [-1, 400],
      [0, 200],
      [250, 200],
      [AI_LIMIT_RANGES.aiUsdCentsPerDay.max, 200],
      [AI_LIMIT_RANGES.aiUsdCentsPerDay.max + 1, 400],
      [1.5, 400],
    ] as const) {
      expect((await patch(ip, cookie, { aiUsdCentsPerDay: value })).status, String(value)).toBe(status);
    }
    expect(usageReportSchema.parse(await (await usage(ip, cookie)).json()).limits.usdCentsPerDay).toBe(AI_LIMIT_RANGES.aiUsdCentsPerDay.max);
  });

  it("asks for the password again before the US$ ceiling changes, and never for a free model", async () => {
    const ip = "192.0.2.98";
    const cookie = await signIn(ip);
    await runOwner((db) => db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));
    const res = await patch(ip, cookie, { aiUsdCentsPerDay: 500 });
    expect(res.status).toBe(403);
    expect(apiErrorSchema.parse(await res.json()).code).toBe("RECENT_AUTH_REQUIRED");
    expect(usageReportSchema.parse(await (await usage(ip, cookie)).json()).limits.usdCentsPerDay).toBe(0);
    expect((await patch(ip, cookie, { aiModel: DEFAULT_CHAT_MODEL })).status).toBe(200);
  });

  it("asks for the password again before a paid model is picked, as the main or the reserve one, and saves nothing then (n-1, n)", async () => {
    const ip = "192.0.2.95";
    const cookie = await signIn(ip);
    // The company's key is set (a Worker secret in production).
    await runOwner((_db, agent) => {
      vi.spyOn(agent, "paidConfigured").mockReturnValue(true);
    });
    try {
      for (const field of ["aiModel", "aiFallbackModel"] as const) {
        await runOwner((db) => db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 15 * 60_000 - 1_000));
        const refused = await patch(ip, cookie, { [field]: "anthropic/claude-haiku-5-5" });
        expect(refused.status, field).toBe(403);
        expect(apiErrorSchema.parse(await refused.json()).code).toBe("RECENT_AUTH_REQUIRED");
        const settings = await (await call(`${ORIGIN}/api/settings`, { headers: headers(ip, cookie) })).json();
        expect((settings as Record<string, unknown>)[field], field).not.toBe("anthropic/claude-haiku-5-5");
        await runOwner((db) => db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 14 * 60_000));
        expect((await patch(ip, cookie, { [field]: "anthropic/claude-haiku-5-5" })).status, field).toBe(200);
      }
    } finally {
      await runOwner(() => vi.restoreAllMocks());
      await patch(ip, cookie, { aiModel: DEFAULT_CHAT_MODEL, aiFallbackModel: DEFAULT_FALLBACK_MODEL });
    }
  });

  it("gives the usage history for 7, 30 or 90 days only", async () => {
    const ip = "192.0.2.96";
    const cookie = await signIn(ip);
    for (const days of [7, 30, 90]) {
      const res = await call(`${ORIGIN}/api/usage/history?days=${days}`, { headers: headers(ip, cookie) });
      expect(res.status, String(days)).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(usageHistorySchema.parse(await res.json())).toMatchObject({ days: [], models: [], paidByDay: [] });
    }
    for (const days of ["8", "0", "abc", "7.0x"]) {
      const res = await call(`${ORIGIN}/api/usage/history?days=${days}`, { headers: headers(ip, cookie) });
      expect(res.status, days).toBe(400);
    }
    expect((await call(`${ORIGIN}/api/usage/history`, { headers: headers(ip) })).status).toBe(401);
  });

  it("tries a company again on the owner's word, and only the two companies it knows", async () => {
    const ip = "192.0.2.97";
    const cookie = await signIn(ip);
    await runOwner((_db, agent) => agent.breaker().failed({ id: "anthropic", model: "anthropic/claude-haiku-5-5" }, new AppError("SERVICE_UNAVAILABLE", "error.aiNoCredit")));
    await runOwner((_db, agent) => expect(agent.breaker().state("anthropic")).toBe("no_credit"));
    const res = await call(`${ORIGIN}/api/usage/providers/anthropic/retry`, { method: "POST", headers: headers(ip, cookie) });
    expect(res.status).toBe(200);
    expect(usageReportSchema.parse(await res.json()).providers.find((p) => p.id === "anthropic")?.state).toBe("ok");
    expect((await call(`${ORIGIN}/api/usage/providers/google/retry`, { method: "POST", headers: headers(ip, cookie) })).status).toBe(404);
    expect((await call(`${ORIGIN}/api/usage/providers/openai/retry`, { method: "POST", headers: headers(ip) })).status).toBe(401);
  });
});
