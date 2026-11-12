import { AGENT_INSTANCE_NAME, AI_LIMIT_RANGES, apiErrorSchema, DEFAULT_CHAT_MODEL, DEFAULT_FALLBACK_MODEL, settingsSchema, usageHistorySchema, usageHoursSchema, usageMonthsSchema, usageReportSchema } from "@zuri/shared";
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
    // The year is not a longer history: 365 days would read every day's row (PR S13).
    for (const days of ["8", "0", "abc", "7.0x", "365", "366", "91", "-365", "365.0", "%20365", "365&days=7", "7&days=365"]) {
      const res = await call(`${ORIGIN}/api/usage/history?days=${days}`, { headers: headers(ip, cookie) });
      if (days === "7&days=365") {
        // A repeated parameter: the first one counts, and it is one of the three.
        expect(res.status, days).toBe(200);
        expect(usageHistorySchema.parse(await res.json()).days.length, days).toBeLessThanOrEqual(7);
        continue;
      }
      expect(res.status, days).toBe(400);
      expect(apiErrorSchema.parse(await res.json()), days).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["days"] } });
    }
    expect((await call(`${ORIGIN}/api/usage/history`, { headers: headers(ip) })).status).toBe(401);
  });

  it("gives today by the hour and the year by the month, to the owner only, never cached (PR S13)", async () => {
    const ip = "192.0.2.99";
    const cookie = await signIn(ip);
    const day = new Date().toISOString().slice(0, 10);
    const hour = new Date().getUTCHours();
    await runOwner((db) => {
      db.run(`DELETE FROM zur_usage_hourly`);
      db.run(`DELETE FROM zur_usage_monthly`);
      db.run(`INSERT INTO zur_usage_hourly (hour, day, requests, neurons) VALUES (?, ?, 4, 12.5)`, hour, day);
      // The same hour slot of another day is not today's.
      db.run(`INSERT INTO zur_usage_hourly (hour, day, requests) VALUES (?, '2020-01-01', 9)`, (hour + 1) % 24);
      db.run(`INSERT INTO zur_usage_monthly (month, last_day, days, requests, neurons) VALUES (?, ?, 3, 30, 300)`, day.slice(0, 7), "2020-01-01");
    });
    try {
      const hours = await call(`${ORIGIN}/api/usage/hours`, { headers: headers(ip, cookie) });
      expect(hours.status).toBe(200);
      expect(hours.headers.get("cache-control")).toBe("no-store");
      expect(usageHoursSchema.parse(await hours.json())).toEqual({
        day,
        hours: [{ hour, requests: 4, errors: 0, aborted: 0, fallbacks: 0, neurons: 12.5, paidUsd: 0, audioSeconds: 0 }],
      });
      const months = await call(`${ORIGIN}/api/usage/months?days=365&from=1999-01`, { headers: headers(ip, cookie) });
      expect(months.status).toBe(200);
      expect(months.headers.get("cache-control")).toBe("no-store");
      const year = usageMonthsSchema.parse(await months.json());
      expect(year.to).toBe(day.slice(0, 7));
      // What the address says changes nothing: the period is the server's, 12 months ending in this one.
      const first = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 12;
      expect(year.from).toBe(`${Math.floor(first / 12)}-${String((first % 12) + 1).padStart(2, "0")}`);
      // The month already summed and the open days of the same month come as one line.
      const open = await runOwner((db) => db.one<{ n: number }>(`SELECT COALESCE(SUM(ai_requests), 0) AS n FROM zur_usage_daily WHERE day > '2020-01-01' AND substr(day, 1, 7) = ?`, day.slice(0, 7))?.n ?? 0);
      expect(year.months.filter((m) => m.month === day.slice(0, 7)).map((m) => m.requests)).toEqual([30 + open]);
    } finally {
      await runOwner((db) => {
        db.run(`DELETE FROM zur_usage_hourly`);
        db.run(`DELETE FROM zur_usage_monthly`);
      });
    }
    for (const path of ["/usage/hours", "/usage/months"]) {
      expect((await call(`${ORIGIN}/api${path}`, { headers: headers(ip) })).status, path).toBe(401);
      // Read only: no other verb reaches them.
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await call(`${ORIGIN}/api${path}`, { method, headers: headers(ip, cookie) });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
      // SEC: a read from another site's page (no CSRF header) is refused before the route.
      const forged = await call(`${ORIGIN}/api${path}`, { headers: { cookie, "cf-connecting-ip": ip, "user-agent": headers(ip)["user-agent"] } });
      expect(forged.status, path).toBe(403);
      expect(apiErrorSchema.parse(await forged.json()).code, path).toBe("CSRF_FAILED");
    }
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
