import { AGENT_INSTANCE_NAME, CHAT_MODELS, DEFAULT_CHAT_MODEL, modelCatalogSchema, settingsSchema } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { setCatalogRates } from "../src/ai/catalog-rates.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, signedCookies, TEST_EMAIL, TEST_PASSWORD, testEnv } from "./helpers.ts";

// PR S21: the catalog's routes as the models card calls them, the settings that
// may name a model of the catalog, and the catalog's place in the shared alarm.

const IP = "192.0.2.221";
const GEMMA = "@cf/google/gemma-3-12b-it";
const QWEN = "@cf/qwen/qwen3-30b-a3b-fp8";
let cookie = "";
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));

const session = (method: string, path: string, body?: unknown) =>
  call(`${ORIGIN}/api${path}`, {
    method,
    headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const usd = (neurons: number) => (neurons * 0.011) / 1_000;
const item = (name: string, m: { context: number; input: number; output: number }, leaves?: string) => ({
  name,
  task: { name: "Text Generation" },
  properties: [
    { property_id: "context_window", value: String(m.context) },
    { property_id: "function_calling", value: "true" },
    { property_id: "price", value: [{ unit: "per M input tokens", price: usd(m.input), currency: "USD" }, { unit: "per M output tokens", price: usd(m.output), currency: "USD" }] },
    ...(leaves ? [{ property_id: "planned_deprecation_date", value: leaves }] : []),
  ],
});
const catalog = (leaving: Record<string, string> = {}) => [...Object.entries(CHAT_MODELS).map(([name, m]) => item(name, m, leaving[name])), item(GEMMA, { context: 80_000, input: 31_371, output: 50_000 })];

/** The binding's catalog, as the test deploy has no AI binding. */
const answer = (value: unknown) =>
  inOwner((agent) => {
    agent.testCatalog = async () => value;
  });

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
});

afterEach(async () => {
  await inOwner((agent) => {
    agent.testCatalog = null;
    new InternalState(agent.store.db).delete("model_catalog");
    agent.store.db.run(`DELETE FROM zur_settings WHERE key IN ('ai_model', 'ai_fallback_model')`);
    agent.store.db.run(`DELETE FROM zur_notices`);
  });
  setCatalogRates(new Map());
});

describe("the catalog's routes", () => {
  it("shows the fixed list before any check", async () => {
    const res = await session("GET", "/ai/catalog");
    expect(res.status).toBe(200);
    const view = modelCatalogSchema.parse(await res.json());
    expect(view).toMatchObject({ checkedAt: null, failed: false, notices: [] });
    expect(view.listed.map((m) => m.id)).toEqual(Object.keys(CHAT_MODELS));
  });

  it("checks now, offers the new model, puts it on the list and lets the settings name it", async () => {
    await answer(catalog());
    // Before it is on the list, the settings refuse it.
    let patch = await session("PATCH", "/settings", { aiModel: GEMMA });
    expect(patch.status).toBe(400);
    expect(await errorBody(patch)).toMatchObject({ code: "VALIDATION_FAILED" });

    const check = await session("POST", "/ai/catalog/check");
    expect(check.status).toBe(200);
    const view = modelCatalogSchema.parse(await check.json());
    expect(view.notices.map((n) => `${n.kind}:${n.model.id}`)).toEqual([`new:${GEMMA}`]);

    // Twice within a minute: refused with the wait.
    const again = await session("POST", "/ai/catalog/check");
    expect(again.status).toBe(429);
    expect(await errorBody(again)).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(0);

    const add = await session("POST", "/ai/catalog/models", { id: GEMMA });
    expect(add.status).toBe(200);
    expect(modelCatalogSchema.parse(await add.json()).listed.at(-1)).toMatchObject({ id: GEMMA, fixed: false });

    patch = await session("PATCH", "/settings", { aiModel: GEMMA, aiFallbackModel: QWEN });
    expect(patch.status).toBe(200);
    expect(settingsSchema.parse(await patch.json())).toMatchObject({ aiModel: GEMMA, aiFallbackModel: QWEN });
    // The next turn goes to that model (here, without a binding, it says "not configured" under its name).
    expect(await inOwner((agent) => agent.ai().model)).toBe(GEMMA);
    expect((await (await session("GET", "/usage")).json()) as { model: string }).toMatchObject({ model: GEMMA });

    // Off the list again (a restored backup has no catalog): the AI goes back to the defaults.
    await session("PATCH", "/settings", { aiFallbackModel: GEMMA, aiModel: QWEN });
    await inOwner((agent) => new InternalState(agent.store.db).delete("model_catalog"));
    expect(await inOwner((agent) => agent.ai().models)).toEqual([QWEN]);
    expect(((await (await session("GET", "/usage")).json()) as { model: string }).model).toBe(QWEN);
  });

  it("refuses a body that isn't a model id, a model the catalog doesn't have and a fixed one", async () => {
    await answer(catalog());
    await session("POST", "/ai/catalog/check");
    for (const body of [{ id: "https://exemplo.com.br/x" }, { id: GEMMA, extra: 1 }, {}]) {
      const res = await session("POST", "/ai/catalog/models", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await errorBody(res)).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect((await session("POST", "/ai/catalog/models", { id: "@cf/x/unknown" })).status).toBe(404);
    expect((await session("POST", "/ai/catalog/models", { id: DEFAULT_CHAT_MODEL })).status).toBe(404);
    // A model id that is not on any list, sent straight to the settings.
    const patch = await session("PATCH", "/settings", { aiFallbackModel: "@cf/x/unknown" });
    expect(patch.status).toBe(400);
    expect(await errorBody(patch)).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["aiFallbackModel"] } });
  });

  it("refuses a model of the fixed list that left the catalog", async () => {
    await answer(catalog({ "@cf/meta/llama-3.3-70b-instruct-fp8-fast": "2026-01-01" }));
    await session("POST", "/ai/catalog/check");
    const patch = await session("PATCH", "/settings", { aiModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" });
    expect(patch.status).toBe(400);
    expect(await errorBody(patch)).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["aiModel"] } });
  });
});

describe("the catalog in the shared alarm", () => {
  it("checks on the alarm's wake and tells the owner, in the notices, of a model in use that will leave", async () => {
    const leaves = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await answer(catalog({ [QWEN]: leaves }));
    await inOwner(async (agent) => {
      // The daily check's hour has come.
      const due = new Date(Date.now() - 1_000).toISOString();
      new InternalState(agent.store.db).set("model_catalog", JSON.stringify({ checkedAt: null, nextAt: due, failed: false, failures: 0, missing: [], absent: [], checkNowAt: null, enforcedOn: null, models: [], listed: [], warned: [] }));
      expect(agent.store.modelCatalog.nextDue()).toBe(due);
      await agent.store.automations.rearm();
      await agent.runAutomations({});
      const notice = agent.store.db.one<{ kind: string; link: string; params: string }>(`SELECT kind, link, params FROM zur_notices WHERE kind LIKE 'ai.%'`);
      expect(notice).toMatchObject({ kind: "ai.modelLeaving", link: "/configuracoes/modelos" });
      expect(JSON.parse(notice?.params ?? "{}")).toMatchObject({ model: "Qwen3 30B A3B" });
      expect(agent.store.modelCatalog.view().checkedAt).not.toBeNull();
    });
  });

  it("logs a catalog that throws on the alarm and goes on with the rest of the wake", async () => {
    await inOwner(async (agent) => {
      agent.testCatalog = async () => {
        throw new Error("down");
      };
      new InternalState(agent.store.db).set("model_catalog", JSON.stringify({ checkedAt: null, nextAt: new Date(Date.now() - 1_000).toISOString(), failed: false, failures: 0, missing: [], absent: [], checkNowAt: null, enforcedOn: null, models: [], listed: [], warned: [] }));
      await agent.runAutomations({});
      expect(agent.store.modelCatalog.view()).toMatchObject({ failed: true, checkedAt: null });
    });
  });
});
