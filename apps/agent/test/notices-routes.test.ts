import { AGENT_INSTANCE_NAME, apiErrorSchema, type DiagnosticsReport, type Notice, type NoticePage, sessionStateSchema } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { call, CSRF, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// The notice center, Settings > Notices and the Diagnóstico tab through the Worker,
// as the interface calls them, and the object's own wiring (access alerts, failures).

const IP = "192.0.2.171";
let cookie = "";
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));

const headers = (withCookie = true) => ({
  ...CSRF,
  "content-type": "application/json",
  "cf-connecting-ip": IP,
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36",
  ...(withCookie ? { cookie } : {}),
});

function api(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  return call(`${ORIGIN}/api${path}`, {
    method,
    headers: { ...headers(), ...extra },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

const refusal = async (res: Response, status: number) => apiErrorSchema.parse(await json(res, status));

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: headers(false),
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
});

const MISSING = "0b8f8a52-5b2c-4c55-9a4c-2f1f3e1f4a10";

describe("the notice routes", () => {
  const routes = [
    ["GET", "/notices"],
    ["POST", "/notices/read"],
    ["POST", "/notices/seen"],
    ["POST", `/notices/${MISSING}/mute`],
    ["DELETE", `/notices/${MISSING}`],
    ["GET", "/alerts"],
    ["DELETE", "/alerts/learning/digest.daily"],
    ["GET", "/diagnostics"],
    ["POST", "/diagnostics/client"],
    ["POST", "/diagnostics/resolve"],
  ] as const;

  it("need a session and the CSRF header", async () => {
    for (const [method, path] of routes) {
      const anonymous = await call(`${ORIGIN}/api${path}`, { method, headers: headers(false), body: method === "GET" ? null : "{}" });
      expect(anonymous.status, `${method} ${path}`).toBe(401);
      const noCsrf = await call(`${ORIGIN}/api${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: method === "GET" ? null : "{}" });
      expect(noCsrf.status, `${method} ${path}`).toBe(403);
    }
  });

  it("list, count, read, mute and delete", async () => {
    const ids = await inOwner((agent) => {
      const a = agent.store.alerts.raise({ kind: "automation.result", category: "reminders", priority: "normal", params: { name: "Água" }, body: "Beber água" });
      const b = agent.store.alerts.raise({ kind: "watch.aiBudget80", category: "system", priority: "normal", link: "/configuracoes/ia" });
      return [a?.id ?? "", b?.id ?? ""] as const;
    });
    const page = await json<NoticePage>(await api("GET", "/notices"), 200);
    expect(page.unread).toBeGreaterThanOrEqual(2);
    const water = page.notices.find((n) => n.id === ids[0]);
    expect(water).toMatchObject({ title: "Água", body: "Beber água", category: "reminders" });

    // The bell's number (the unseen ones, E12b) rides on the session check and the heartbeat.
    expect(page.unseen).toBeGreaterThanOrEqual(2);
    const session = sessionStateSchema.parse(await json(await api("GET", "/auth/session"), 200));
    expect(session.unseenNotices).toBe(page.unseen);
    const beat = sessionStateSchema.parse(await json(await api("POST", "/auth/heartbeat", { active: false }), 200));
    expect(beat.unseenNotices).toBe(page.unseen);

    expect((await json<{ unread: number }>(await api("POST", "/notices/read", { id: ids[0] }), 200)).unread).toBe(page.unread - 1);
    expect((await json<Notice>(await api("POST", `/notices/${ids[1]}/mute`), 200)).id).toBe(ids[1]);
    expect((await api("DELETE", `/notices/${ids[1]}`)).status).toBe(204);
    expect((await refusal(await api("DELETE", `/notices/${ids[1]}`), 404)).code).toBe("NOT_FOUND");
    expect((await refusal(await api("POST", "/notices/not-an-id/mute"), 404)).code).toBe("NOT_FOUND");
    expect((await json<{ unread: number }>(await api("POST", "/notices/read", {}), 200)).unread).toBe(0);
  });

  it("refuse malformed bodies and cursors, naming only the field", async () => {
    expect((await refusal(await api("POST", "/notices/read", { id: "1; DROP TABLE" }), 400)).details).toEqual({ fields: ["id"] });
    expect((await refusal(await api("POST", "/notices/read", { id: MISSING, extra: 1 }), 400)).code).toBe("VALIDATION_FAILED");
    expect((await refusal(await api("GET", "/notices?before=abc"), 400)).details).toEqual({ fields: ["before"] });
    expect((await refusal(await api("GET", "/notices?before=a&before=b"), 400)).details).toEqual({ fields: ["before"] });
    expect((await refusal(await api("POST", "/diagnostics/client", { name: "TypeError", route: "/x", message: "dono@exemplo.com.br" }), 400)).code).toBe("VALIDATION_FAILED");
    expect((await refusal(await api("POST", "/diagnostics/client", { name: "Type Error: x", route: "/x" }), 400)).details).toEqual({ fields: ["name"] });
    expect((await refusal(await api("POST", "/diagnostics/client", "x".repeat(2048)), 400)).code).toBe("VALIDATION_FAILED");
  });

  it("delete a security alert only with the password typed recently", async () => {
    const id = await inOwner((agent) => agent.store.alerts.raise({ kind: "security", category: "security", priority: "critical", params: { event: "passkey_added" } })?.id ?? "");
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 15 * 60_000));
    expect((await refusal(await api("DELETE", `/notices/${id}`), 403)).code).toBe("RECENT_AUTH_REQUIRED");
    expect((await api("POST", "/auth/confirm", { password: TEST_PASSWORD })).status).toBe(204);
    expect((await api("DELETE", `/notices/${id}`)).status).toBe(204);
  });

  it("show the delivery history and each channel's state", async () => {
    const overview = await json<{ channels: Record<string, string>; deliveries: unknown[] }>(await api("GET", "/alerts"), 200);
    // Push has its keys in the tests but no device yet; e-mail and Telegram come later.
    // The bot is set up in the tests but no account is linked (step 13: Telegram is a channel).
    expect(overview.channels).toEqual({ push: "no_target", telegram: "no_target", email: "not_configured" });
  });
});

describe("the notices seen in the open panel (E12b)", () => {
  const raise = (n: number) =>
    inOwner((agent) => Array.from({ length: n }, (_, i) => agent.store.alerts.raise({ kind: "automation.result", category: "reminders", priority: "normal", params: { name: `Aviso ${i}` } })?.id ?? ""));
  const unseen = async () => (await json<NoticePage>(await api("GET", "/notices"), 200)).unseen;

  it("counts down only for notices still unseen, never twice, and leaves them unread", async () => {
    await api("POST", "/notices/read", {});
    const [a, b] = await raise(2);
    const before = await unseen();
    expect(before).toBe(2);
    const page = await json<NoticePage>(await api("GET", "/notices"), 200);
    expect(page.notices.find((n) => n.id === a)).toMatchObject({ seen: false, readAt: null });
    expect(await json(await api("POST", "/notices/seen", { ids: [a] }), 200)).toEqual({ unseen: 1 });
    // The same id again, and one that isn't a notice: nothing more changes.
    expect(await json(await api("POST", "/notices/seen", { ids: [a, MISSING] }), 200)).toEqual({ unseen: 1 });
    const after = await json<NoticePage>(await api("GET", "/notices"), 200);
    expect(after.notices.find((n) => n.id === a)).toMatchObject({ seen: true, readAt: null });
    expect(after.unread).toBe(page.unread);
    expect(sessionStateSchema.parse(await json(await api("POST", "/auth/heartbeat", { active: false }), 200)).unseenNotices).toBe(1);
    // Deleting an unseen notice takes it off the bell.
    expect((await api("DELETE", `/notices/${b}`)).status).toBe(204);
    expect(await unseen()).toBe(0);
  });

  it("marks as seen what is read in the app, one notice or all of them", async () => {
    await api("POST", "/notices/read", {});
    const [a] = await raise(3);
    expect(await json(await api("POST", "/notices/read", { id: a }), 200)).toMatchObject({ unseen: 2 });
    expect(await json(await api("POST", "/notices/read", {}), 200)).toEqual({ unread: 0, unseen: 0 });
  });

  it("does not count a notice read outside the app (Telegram) as seen, until the panel shows it or it is read here", async () => {
    await api("POST", "/notices/read", {});
    const [a] = await raise(1);
    expect(await inOwner((agent) => agent.store.alerts.respondOutOfBand(a ?? "", "done"))).toBe("done");
    expect(await unseen()).toBe(1);
    expect(await json(await api("POST", "/notices/read", {}), 200)).toEqual({ unread: 0, unseen: 0 });
  });

  it("seen never stops an alert that insists: its escalation and next attempt stay as they were", async () => {
    await api("POST", "/notices/read", {});
    const id = crypto.randomUUID();
    const next = new Date(Date.now() + 5 * 60_000).toISOString();
    const row = () =>
      inOwner((agent) => agent.store.db.one<{ escalation: string; next_attempt_at: string; read_at: string | null }>(`SELECT escalation, next_attempt_at, read_at FROM zur_notices WHERE id = ?`, id));
    await inOwner((agent) =>
      agent.store.db.run(
        `INSERT INTO zur_notices (id, kind, category, priority, params, created_at, escalation, next_attempt_at) VALUES (?, 'security', 'security', 'critical', '{"event":"passkey_added"}', ?, 'active', ?)`,
        id,
        new Date().toISOString(),
        next,
      ),
    );
    expect(await json(await api("POST", "/notices/seen", { ids: [id] }), 200)).toEqual({ unseen: 0 });
    expect(await row()).toEqual({ escalation: "active", next_attempt_at: next, read_at: null });
    // Out again, so no later test meets an alert still insisting.
    await inOwner((agent) => agent.store.db.run(`DELETE FROM zur_notices WHERE id = ?`, id));
  });

  it("two batches at once with ids in common count each notice once", async () => {
    await api("POST", "/notices/read", {});
    const ids = await raise(4);
    const [first, second] = await Promise.all([api("POST", "/notices/seen", { ids: ids.slice(0, 3) }), api("POST", "/notices/seen", { ids: ids.slice(1, 4) })]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await unseen()).toBe(0);
    expect(await inOwner((agent) => agent.store.alerts.unseenCount())).toBe(0);
    // The counter never went below zero: one more notice makes it exactly 1.
    await raise(1);
    expect(await unseen()).toBe(1);
    await api("POST", "/notices/read", {});
  });

  it("takes 1 to 50 distinct notice ids and nothing else, naming only the field", async () => {
    const ids = (n: number) => Array.from({ length: n }, () => crypto.randomUUID());
    expect((await api("POST", "/notices/seen", { ids: ids(50) })).status).toBe(200);
    for (const body of [{ ids: ids(51) }, { ids: [] }, { ids: [MISSING, MISSING] }, { ids: ["1; DROP TABLE zur_notices"] }, { ids: [MISSING], extra: 1 }, {}]) {
      const res = await refusal(await api("POST", "/notices/seen", body), 400);
      expect(res.code, JSON.stringify(body).slice(0, 60)).toBe("VALIDATION_FAILED");
      expect(JSON.stringify(res)).not.toContain("DROP");
    }
    expect((await refusal(await api("POST", "/notices/seen", "x".repeat(5000)), 400)).code).toBe("VALIDATION_FAILED");
  });
});

describe("the priority that learns, in Settings > Notices", () => {
  it("lists what changed and undoes it, refusing a malformed or unchanged source", async () => {
    const key = "watch.taskStalled";
    await inOwner((agent) =>
      agent.store.db.run(`INSERT INTO zur_alert_learning (key, shift, label, changed_at) VALUES (?, -1, 'Tarefas paradas', ?)`, key, new Date().toISOString()),
    );
    const overview = await json<{ learned: { key: string; shift: number }[] }>(await api("GET", "/alerts"), 200);
    expect(overview.learned).toEqual([expect.objectContaining({ key, label: "Tarefas paradas", shift: -1 })]);
    expect((await api("DELETE", `/alerts/learning/${key}`)).status).toBe(204);
    expect((await refusal(await api("DELETE", `/alerts/learning/${key}`), 404)).code).toBe("NOT_FOUND");
    expect((await refusal(await api("DELETE", `/alerts/learning/${encodeURIComponent("Bad Key!")}`), 404)).code).toBe("NOT_FOUND");
    expect((await refusal(await api("DELETE", `/alerts/learning/automation:${MISSING}`), 404)).code).toBe("NOT_FOUND");
    expect((await json<{ learned: unknown[] }>(await api("GET", "/alerts"), 200)).learned).toEqual([]);
  });
});

describe("the object's wiring", () => {
  it("turns an access event marked for an alert into a notice right after the request", async () => {
    // A sign-in from a new browser and network is worth an alert.
    const res = await call(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { ...headers(false), "cf-connecting-ip": "198.51.100.77", "user-agent": "Mozilla/5.0 (Macintosh) Firefox/140.0" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
    });
    expect(res.status).toBe(200);
    const page = await json<NoticePage>(await api("GET", "/notices"), 200);
    expect(page.notices.find((n) => n.kind === "security")).toMatchObject({ title: "Novo acesso à sua conta", priority: "critical" });
  });

  it("logs interface errors and unexpected failures in the Diagnóstico tab", async () => {
    expect((await api("POST", "/diagnostics/client", { name: "TypeError", route: "/tarefas" })).status).toBe(204);
    // A failure the API did not expect: its name reaches the log, never its message.
    await inOwner((agent) => {
      agent.store.alerts.overview = () => {
        throw new RangeError("dono@exemplo.com.br");
      };
    });
    expect((await refusal(await api("GET", "/alerts", undefined, { "cf-ray": "8f3a2b1c4d5e6f70-GRU" }), 500)).code).toBe("INTERNAL_ERROR");
    await inOwner((agent) => {
      // Back to the class's own method.
      const notices = agent.store.alerts as unknown as { overview: unknown };
      delete notices.overview;
    });
    const report = await json<DiagnosticsReport>(await api("GET", "/diagnostics"), 200);
    expect(report.entries.map((e) => [e.source, e.code, e.errorName, e.route]).sort()).toEqual([
      ["api", "INTERNAL_ERROR", "RangeError", "GET /api/alerts"],
      ["interface", "CLIENT_ERROR", "TypeError", "/tarefas"],
    ]);
    expect(report.entries.find((e) => e.source === "api")?.lastRef).toBe("8f3a2b1c4d5e6f70-GRU");
    expect(JSON.stringify(report)).not.toContain("exemplo");
    const id = report.entries[0]?.id ?? "";
    expect((await api("POST", "/diagnostics/resolve", { id })).status).toBe(204);
    expect((await refusal(await api("POST", "/diagnostics/resolve", { id: "0000000000000000" }), 404)).code).toBe("NOT_FOUND");
  });

  it("shares the one alarm: the watchers' next round is the object's alarm when no automation is due", async () => {
    const { stored, watch } = await inOwner(async (agent) => {
      await agent.store.automations.rearm({ verify: true });
      return {
        stored: agent.store.db.one<{ value: string }>(`SELECT value FROM zur_settings WHERE key = 'automation_alarm'`)?.value ?? "",
        watch: agent.store.watchers.nextDue(),
      };
    });
    expect(JSON.parse(stored).startsWith(watch)).toBe(true);
  });

  it("never sets the alarm at once again when a step keeps failing: the next try waits a minute", async () => {
    const { at, ranAutomations } = await inOwner(async (agent) => {
      const watchers = agent.store.watchers as unknown as { tick: () => boolean };
      const alerts = agent.store.alerts as unknown as { sweep: () => void };
      watchers.tick = () => {
        throw new Error("disk full");
      };
      alerts.sweep = () => {
        throw new Error("disk full");
      };
      // A round already past due that the failing step can't move forward.
      agent.store.db.run(`UPDATE zur_settings SET value = ? WHERE key = 'alert_watch_at'`, JSON.stringify(new Date(Date.now() - 60_000).toISOString()));
      let ran = false;
      const wake = agent.store.automations.wake.bind(agent.store.automations);
      agent.store.automations.wake = async (...args) => {
        ran = true;
        return wake(...args);
      };
      try {
        await agent.runAutomations({}, undefined);
      } finally {
        delete (watchers as Partial<typeof watchers>).tick;
        delete (alerts as Partial<typeof alerts>).sweep;
        delete (agent.store.automations as Partial<typeof agent.store.automations>).wake;
      }
      const stored = agent.store.db.one<{ value: string }>(`SELECT value FROM zur_settings WHERE key = 'automation_alarm'`)?.value ?? '""';
      return { at: Date.parse((JSON.parse(stored) as string).split("|")[0] ?? ""), ranAutomations: ran };
    });
    // The automations still ran, and the alarm comes back no sooner than a minute later.
    expect(ranAutomations).toBe(true);
    expect(at - Date.now()).toBeGreaterThan(50_000);
    await inOwner((agent) => agent.store.db.run(`DELETE FROM zur_settings WHERE key = 'alert_watch_at'`));
  });

  it("runs the watchers and the tries on the alarm, and sets the next round", async () => {
    const next = await inOwner(async (agent) => {
      agent.store.db.run(`DELETE FROM zur_settings WHERE key = 'alert_watch_at'`);
      await agent.runAutomations({}, undefined);
      return agent.store.watchers.nextDue();
    });
    expect(Date.parse(next) - Date.now()).toBeGreaterThan(14 * 60_000);
  });
});
