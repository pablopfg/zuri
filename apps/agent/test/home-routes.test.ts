import { AGENT_INSTANCE_NAME, HOME_SUGGESTION_IDS } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { MockAIProvider } from "../src/ai/mock.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, signedCookies, TEST_EMAIL, TEST_PASSWORD, testEnv } from "./helpers.ts";

// PR S22: the home page's suggestions as the page calls them. Reading needs the
// session; a tap counts only a kind of the catalog and never anything else.

const IP = "192.0.2.222";
let cookie = "";
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));
const session = (method: string, path: string, extra: Record<string, string> = {}) =>
  call(`${ORIGIN}/api${path}`, { method, headers: { ...CSRF, "cf-connecting-ip": IP, cookie, ...extra } });
const uses = () => inOwner((agent) => agent.store.db.one<{ value: string }>(`SELECT value FROM zur_settings WHERE key = 'home_suggestion_uses'`)?.value ?? null);

beforeAll(async () => {
  await inOwner((agent) => {
    agent.testProvider = new MockAIProvider();
  });
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
});

afterAll(() =>
  inOwner((agent) => {
    agent.testProvider = null;
  }),
);

describe("the home page's suggestions", () => {
  it("answers up to three kinds of the catalog, with no text of their own", async () => {
    const res = await session("GET", "/home/suggestions");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as { suggestions: { id: string; text?: unknown }[] };
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions.length).toBeLessThanOrEqual(3);
    for (const item of body.suggestions) {
      expect(HOME_SUGGESTION_IDS).toContain(item.id);
      expect(item.text).toBeUndefined();
    }
  });

  it("counts a tap on a kind and nothing for anything else", async () => {
    const res = await session("POST", "/home/suggestions/week/used");
    expect(res.status).toBe(204);
    const stored = JSON.parse(JSON.parse((await uses()) ?? '""')) as Record<string, { n: number }>;
    expect(Object.keys(stored)).toEqual(["week"]);
    for (const id of ["gift", "WEEK", "week%20", "__proto__", "constructor", "<b>", "a".repeat(300)]) {
      const refused = await session("POST", `/home/suggestions/${id}/used`);
      expect(refused.status, id).toBe(404);
      expect((await errorBody(refused)).code).toBe("NOT_FOUND");
    }
    expect(Object.keys(JSON.parse(JSON.parse((await uses()) ?? '""')) as object)).toEqual(["week"]);
  });

  it("needs the session and, for a tap, the request header", async () => {
    const anonymous = await call(`${ORIGIN}/api/home/suggestions`, { headers: { ...CSRF, "cf-connecting-ip": IP } });
    expect(anonymous.status).toBe(401);
    const noCsrf = await call(`${ORIGIN}/api/home/suggestions/week/used`, { method: "POST", headers: { "cf-connecting-ip": IP, cookie } });
    expect(noCsrf.status).toBe(403);
  });
});

describe("the daily ordering inside the object", () => {
  /** Counts the model calls the object makes. */
  class Counting extends MockAIProvider {
    calls = 0;
    override async generate(req: Parameters<MockAIProvider["generate"]>[0]) {
      this.calls++;
      return super.generate(req);
    }
  }

  const fresh = (agent: ZuriAgent) => agent.store.db.run(`DELETE FROM zur_settings WHERE key = 'home_suggestion_order'`);
  const order = (agent: ZuriAgent) => agent.store.db.one(`SELECT value FROM zur_settings WHERE key = 'home_suggestion_order'`);

  it("calls the model once a day on a free model, and never in a lockdown or with a paid model chosen", () =>
    inOwner(async (agent) => {
      const provider = new Counting();
      agent.testProvider = provider;
      try {
        fresh(agent);
        agent.store.auth.lockdown.mark("teste");
        agent.store.home.list();
        expect(order(agent)).toBeNull();
        agent.store.auth.lockdown.clear();

        agent.store.db.run(`INSERT INTO zur_settings (key, value, updated_at) VALUES ('ai_model', '"anthropic/claude-haiku-5-5"', 0)`);
        agent.store.home.list();
        expect(order(agent)).toBeNull();
        agent.store.db.run(`DELETE FROM zur_settings WHERE key = 'ai_model'`);
        expect(provider.calls).toBe(0);

        agent.store.home.list();
        expect(order(agent)).not.toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(provider.calls).toBe(1);
        agent.store.home.list();
        expect(provider.calls).toBe(1);
      } finally {
        agent.store.db.run(`DELETE FROM zur_settings WHERE key IN ('ai_model', 'lockdown_until', 'lockdown_source', 'lockdown_exited_at')`);
        agent.testProvider = new MockAIProvider();
      }
    }));
});
