import { CRM_AUTOMATION_IDS, CRM_AUTOMATION_LIMITS, crmAutomationConfigSchema, crmAutomationDaySchema, crmAutomationModeSchema } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { Database } from "../src/db/database.ts";
import { MIGRATIONS, migrate } from "../src/db/migrations.ts";
import { EXAMPLE_AUTOMATION } from "../src/crm/automations/example.ts";
import { FlowStepError } from "../src/flows/connections.ts";
import { type AutomationContext, type AutomationModule, MAX_CALLS_PER_RUN, type Manifest, manifestSchema, optionsFor } from "../src/crm/automations/manifest.ts";
import { buildCatalog } from "../src/crm/automations/registry.ts";
import { type AutomationNotice, CrmAutomations } from "../src/crm/automations/service.ts";
import { addConnection, type FlowWorld, withFlowWorld } from "./flow-world.ts";
import { runInDurableObject } from "cloudflare:test";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { testEnv } from "./helpers.ts";

// PR S18: the CRM's automations: manifest, states, the rehearsal checked by the owner, the runtime.

const HOST = "chat.exemplo.com.br";
const DAY = 86_400_000;

function manifest(id: string, patch: Partial<Manifest> = {}): Manifest {
  return {
    id,
    version: 1,
    effectsVersion: 1,
    trigger: { kind: "every", minutes: 60, workingDays: false },
    connection: "chatwoot",
    writesToContacts: true,
    calls: [
      { name: "inboxes", method: "GET", path: "/api/v1/accounts/{account}/inboxes" },
      { name: "send", method: "POST", path: "/api/v1/accounts/{account}/conversations/{conversation}/messages" },
    ],
    options: [
      { key: "perDay", kind: "number", min: 1, max: 20, default: 2 },
      { key: "from", kind: "time", min: "08:00", max: "12:00", default: "09:00" },
    ],
    effects: ["message"],
    caps: { runsPerDay: 24, callsPerRun: 10, effectsPerDay: 20, neuronsPerRun: 0 },
    ...patch,
  };
}

/** A module that reads the inboxes, then sends `perDay` messages, or does what `body` says. */
function fake(id: string, body?: (ctx: AutomationContext) => Promise<void>, patch: Partial<Manifest> = {}): AutomationModule {
  return {
    manifest: manifest(id, patch),
    run:
      body ??
      (async (ctx) => {
        await ctx.read("inboxes");
        for (let n = 0; n < Number(ctx.options.perDay); n++) {
          await ctx.effect({ effect: "message", key: `${ctx.day}:${n}`, label: `Pessoa ${n + 1} · consulta em 30/10`, call: "send", params: { conversation: 10 + n }, body: { content: "oi" } });
        }
      }),
  };
}

interface World extends FlowWorld {
  automations: CrmAutomations;
  told: AutomationNotice[];
  chatwoot: string;
  /** A new service on the same tables, as after a deploy. */
  restart(modules?: AutomationModule[]): CrmAutomations;
}

function withWorld<T>(modules: AutomationModule[], fn: (world: World) => T | Promise<T>): Promise<T> {
  return withFlowWorld(async (base) => {
    base.network.handlers.set(HOST, (request) => {
      if (request.method === "GET") return Response.json({ payload: [{ id: 7, name: "WhatsApp", channel_type: "Channel::Api" }] });
      return Response.json({ id: 1 });
    });
    const chatwoot = await base.connections.create({ kind: "chatwoot", name: "Chatwoot do consultório", origin: `https://${HOST}`, accountId: 3, credential: "chave-do-agente-zuri-4f2a" }, { development: false });
    const told: AutomationNotice[] = [];
    const make = (list: AutomationModule[]) =>
      new CrmAutomations({
        db: base.db,
        connections: base.connections,
        callDeps: (calls) => base.flows.automationCallDeps(calls),
        timeZone: () => "America/Sao_Paulo",
        lockdown: () => base.lockdown.active,
        notify: (notice) => told.push(notice),
        catalog: buildCatalog(list),
        clock: () => base.clock.now,
      });
    const world: World = { ...base, automations: make(modules), told, chatwoot, restart: (list = modules) => (world.automations = make(list)) };
    base.flows.automationUsers = (id) => world.automations.users(id);
    return fn(world);
  });
}

const posts = (world: World) => world.network.requests.filter((request) => request.method !== "GET");
const effects = (world: World) => world.db.all<{ key: string; mode: string; status: string; label: string }>(`SELECT key, mode, status, label FROM zur_crm_automation_effects ORDER BY key`);
const row = (world: World, id: string) => world.db.one<Record<string, unknown>>(`SELECT * FROM zur_crm_automations WHERE id = ?`, id);
const view = (world: World, id: string) => world.automations.list().automations.find((item) => item.id === id);

/** A rehearsal run on each of those days (09:00 in São Paulo): only a day it ran on can be checked. */
function ranOn(world: World, ...days: string[]) {
  for (const day of days) world.db.run(`INSERT INTO zur_crm_automation_runs (automation_id, started_at, mode, outcome) VALUES ('fake', ?, 'rehearsal', 'ok')`, `${day}T12:00:00.000Z`);
}

async function rehearse(world: World, id = "fake") {
  world.automations.configure(id, { connectionId: world.chatwoot, options: {} });
  world.automations.setMode(id, "rehearsal");
}

describe("manifest", () => {
  it("accepts the example and a full manifest; refuses one that asks for more than it may", () => {
    expect(manifestSchema.safeParse(EXAMPLE_AUTOMATION.manifest).success).toBe(true);
    expect(manifestSchema.safeParse(manifest("fake")).success).toBe(true);
    const bad: Partial<Manifest>[] = [
      { connection: null },
      { calls: [{ name: "x", method: "GET", path: "/a/../b" }] },
      { calls: [{ name: "x", method: "GET", path: "https://outro.exemplo.com.br/a" }] },
      { calls: [{ name: "x", method: "GET", path: "/a?b=1" }] },
      { calls: [{ name: "x", method: "GET", path: "/a" }, { name: "x", method: "POST", path: "/b" }] },
      // One call more than a wake's share holds, with the 2 DNS lookups (n+1).
      { caps: { runsPerDay: 1, callsPerRun: MAX_CALLS_PER_RUN + 1, effectsPerDay: 1, neuronsPerRun: 0 } },
      { caps: { runsPerDay: 1, callsPerRun: 1, effectsPerDay: 1, neuronsPerRun: 1 } },
      { trigger: { kind: "every", minutes: 14, workingDays: true } },
      { options: [{ key: "a", kind: "number", min: 2, max: 3, default: 1 }] },
      { options: [{ key: "a", kind: "number", min: 1, max: 3, default: 1 }, { key: "a", kind: "number", min: 1, max: 3, default: 1 }] },
    ];
    for (const patch of bad) expect(manifestSchema.safeParse(manifest("fake", patch)).success, JSON.stringify(patch)).toBe(false);
    expect(manifestSchema.safeParse({ ...manifest("fake"), extra: 1 }).success).toBe(false);
    // The share of a wake (n): 44 less the notices' 10 less 2 DNS lookups.
    expect(MAX_CALLS_PER_RUN).toBe(32);
    expect(manifestSchema.safeParse(manifest("fake", { caps: { runsPerDay: 1, callsPerRun: MAX_CALLS_PER_RUN, effectsPerDay: 1, neuronsPerRun: 0 } })).success).toBe(true);
  });

  it("the catalog is the prototype's order, nothing with code yet, and refuses a module under another id", () => {
    const catalog = buildCatalog();
    expect(catalog.map((entry) => entry.id)).toEqual([...CRM_AUTOMATION_IDS]);
    expect(catalog.every((entry) => entry.module === null)).toBe(true);
    // Only the tests and local development add modules; a known id takes its place, a new one goes last.
    const withOne = buildCatalog([fake("review-request"), fake("extra")]);
    expect(withOne[0]?.module).not.toBeNull();
    expect(withOne.at(-1)?.id).toBe("extra");
    const wrong = { ...fake("review-request"), manifest: { ...manifest("review-request"), caps: { runsPerDay: 1, callsPerRun: 99, effectsPerDay: 1, neuronsPerRun: 0 } } };
    expect(() => buildCatalog([wrong])).toThrow();
  });

  it("checks options against their ranges (n-1, n, n+1) and fills the defaults", () => {
    const defs = manifest("fake").options;
    expect(optionsFor(defs, {})).toEqual({ perDay: 2, from: "09:00" });
    expect(optionsFor(defs, { perDay: 20, from: "12:00" })).toEqual({ perDay: 20, from: "12:00" });
    expect(optionsFor(defs, { perDay: 21 })).toEqual({ invalid: "perDay" });
    expect(optionsFor(defs, { perDay: 0 })).toEqual({ invalid: "perDay" });
    expect(optionsFor(defs, { perDay: 1.5 })).toEqual({ invalid: "perDay" });
    expect(optionsFor(defs, { from: "07:59" })).toEqual({ invalid: "from" });
    expect(optionsFor(defs, { from: "12:01" })).toEqual({ invalid: "from" });
    expect(optionsFor(defs, { perDay: "3" })).toEqual({ invalid: "perDay" });
    expect(optionsFor(defs, { other: 1 })).toEqual({ invalid: "other" });
  });

  it("the routes' schemas", () => {
    expect(crmAutomationModeSchema.safeParse({ mode: "live", acceptRisk: true }).success).toBe(true);
    expect(crmAutomationModeSchema.safeParse({ mode: "paused" }).success).toBe(false);
    expect(crmAutomationDaySchema.safeParse({ verdict: "match" }).success).toBe(true);
    expect(crmAutomationDaySchema.safeParse({ verdict: "differs" }).success).toBe(false);
    expect(crmAutomationDaySchema.safeParse({ verdict: "differs", note: "   " }).success).toBe(false);
    expect(crmAutomationDaySchema.safeParse({ verdict: "differs", note: "x".repeat(CRM_AUTOMATION_LIMITS.note) }).success).toBe(true);
    expect(crmAutomationDaySchema.safeParse({ verdict: "differs", note: "x".repeat(CRM_AUTOMATION_LIMITS.note + 1) }).success).toBe(false);
    expect(crmAutomationConfigSchema.safeParse({ connectionId: null, options: { a: "25:00" } }).success).toBe(false);
    expect(crmAutomationConfigSchema.safeParse({ connectionId: "x", options: {} }).success).toBe(false);
  });
});

describe("states", () => {
  it("everything starts off; the first without code is 'next', the rest 'development'", async () => {
    await withWorld([], (world) => {
      const list = world.automations.list();
      expect(list.automations.map((item) => [item.position, item.availability, item.state])).toEqual(CRM_AUTOMATION_IDS.map((_, index) => [index + 1, index === 0 ? "next" : "development", "off"]));
      expect(list.automations[0]).toMatchObject({ id: "review-request", writesToContacts: true, connectionKind: "chatwoot", connectionId: null, watch: false });
      expect(list.base).toEqual({ calendar: "ready", queue: "coming", identity: "coming" });
      // Nothing to run, nothing due: the alarm reads one row and stops.
      expect(world.automations.nextDue()).toBeNull();
    });
  });

  it("a module with code shows up ready and off; configure checks the kind, the credential and the ranges", async () => {
    await withWorld([fake("review-request")], async (world) => {
      expect(view(world, "review-request")).toMatchObject({ availability: "ready", state: "off" });
      expect(view(world, "review-link")).toMatchObject({ availability: "next" });
      const http = await addConnection(world);
      expect(() => world.automations.configure("review-request", { connectionId: http, options: {} })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED", details: { fields: ["connectionId"] } }));
      expect(() => world.automations.configure("review-request", { connectionId: null, options: {} })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
      expect(() => world.automations.configure("review-request", { connectionId: "00000000-0000-4000-8000-000000000000", options: {} })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
      expect(() => world.automations.configure("review-request", { connectionId: world.chatwoot, options: { perDay: 21 } })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED", details: { fields: ["options.perDay"] } }));
      expect(() => world.automations.configure("review-link", { connectionId: null, options: {} })).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
      expect(() => world.automations.configure("nope", { connectionId: null, options: {} })).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
      world.automations.configure("review-request", { connectionId: world.chatwoot, options: { perDay: 5 } });
      // Saving the settings starts nothing.
      expect(view(world, "review-request")).toMatchObject({ state: "off", connectionId: world.chatwoot, options: { perDay: 5, from: "09:00" } });
      expect(world.automations.nextDue()).toBeNull();
    });
  });

  it("starts in rehearsal only after it is set up; going live needs the days or the risk; off clears it", async () => {
    await withWorld([fake("fake")], async (world) => {
      expect(() => world.automations.setMode("fake", "rehearsal")).toThrowError(expect.objectContaining({ code: "CONFLICT", messageKey: "error.crmAutomationNotConfigured" }));
      world.automations.configure("fake", { connectionId: world.chatwoot, options: {} });
      expect(() => world.automations.setMode("fake", "live")).toThrowError(expect.objectContaining({ code: "CONFLICT", messageKey: "error.crmAutomationRehearsalFirst" }));
      world.automations.setMode("fake", "rehearsal");
      expect(view(world, "fake")).toMatchObject({ state: "rehearsal", rehearsalSince: new Date(world.clock.now).toISOString(), rehearsal: { matched: 0, required: 3, ready: false } });
      expect(world.automations.nextDue()).toBe(new Date(world.clock.now).toISOString());
      expect(() => world.automations.setMode("fake", "live")).toThrowError(expect.objectContaining({ code: "CONFLICT", messageKey: "error.crmAutomationRehearsalDays" }));
      world.automations.setMode("fake", "live", true);
      expect(view(world, "fake")).toMatchObject({ state: "live", liveSince: new Date(world.clock.now).toISOString() });
      expect(world.db.one<{ detail: string }>(`SELECT detail FROM zur_activity WHERE kind = 'crm.automation_mode' ORDER BY id DESC LIMIT 1`)?.detail).toContain('"risk":true');
      world.automations.setMode("fake", "off");
      expect(view(world, "fake")).toMatchObject({ state: "off", rehearsalSince: null, liveSince: null });
      expect(world.automations.nextDue()).toBeNull();
      // Off again is nothing; an unknown one is not found.
      world.automations.setMode("fake", "off");
      expect(() => world.automations.setMode("nope", "off")).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
    });
  });

  it("holds at most 10 on at a time (10 and 11)", async () => {
    const modules = Array.from({ length: CRM_AUTOMATION_LIMITS.active + 1 }, (_, n) => fake(`fake-${n}`));
    await withWorld(modules, async (world) => {
      for (let n = 0; n < CRM_AUTOMATION_LIMITS.active; n++) await rehearse(world, `fake-${n}`);
      world.automations.configure(`fake-${CRM_AUTOMATION_LIMITS.active}`, { connectionId: world.chatwoot, options: {} });
      expect(() => world.automations.setMode(`fake-${CRM_AUTOMATION_LIMITS.active}`, "rehearsal")).toThrowError(expect.objectContaining({ code: "CONFLICT", messageKey: "error.crmAutomationActiveLimit" }));
      // One already on moves between modes freely.
      world.automations.setMode("fake-0", "live", true);
      world.automations.setMode("fake-0", "off");
      world.automations.setMode(`fake-${CRM_AUTOMATION_LIMITS.active}`, "rehearsal");
    });
  });

  it("a credential of an automation that is on can't be removed and shows who uses it; one off doesn't hold it", async () => {
    await withWorld([fake("fake")], async (world) => {
      world.automations.configure("fake", { connectionId: world.chatwoot, options: {} });
      expect(world.flows.list().connections.find((item) => item.id === world.chatwoot)?.usedBy).toEqual([]);
      world.automations.setMode("fake", "rehearsal");
      expect(world.flows.list().connections.find((item) => item.id === world.chatwoot)?.usedBy).toEqual(["fake"]);
      expect(() => world.flows.removeConnection(world.chatwoot)).toThrowError(expect.objectContaining({ code: "CONFLICT", details: { flows: ["fake"] } }));
      world.automations.setMode("fake", "off");
      world.flows.removeConnection(world.chatwoot);
      // Started again, the pick that's gone is refused.
      expect(() => world.automations.setMode("fake", "rehearsal")).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED", details: { fields: ["connectionId"] } }));
    });
  });
});

describe("the rehearsal checked by the owner", () => {
  // 2026-11-03 is a Tuesday; 2026-11-02 (Finados) a holiday; the 7th and 8th a weekend; the 20th a holiday.
  it("counts working days in a row marked right; today may stay open; a wrong one breaks the row", async () => {
    await withWorld([fake("fake")], async (world) => {
      await rehearse(world);
      world.clock.now += 2 * DAY; // Thursday the 5th
      // Today hasn't run yet: it can't be called right before it happened.
      ranOn(world, "2026-11-03", "2026-11-04");
      expect(() => world.automations.checkDay("fake", "2026-11-05", { verdict: "match" })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
      expect(world.automations.activity("fake").days[0]).toEqual({ day: "2026-11-05", would: 0, ran: false, today: true, verdict: null, note: null });
      ranOn(world, "2026-11-05");
      // Ran, but today isn't over: still refused.
      expect(() => world.automations.checkDay("fake", "2026-11-05", { verdict: "match" })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
      world.clock.now += DAY; // Friday the 6th
      world.automations.checkDay("fake", "2026-11-05", { verdict: "match" });
      world.automations.checkDay("fake", "2026-11-04", { verdict: "match" });
      // Two days (n-1): not enough to go live without the risk.
      expect(view(world, "fake")?.rehearsal).toEqual({ matched: 2, required: 3, ready: false });
      expect(() => world.automations.setMode("fake", "live")).toThrowError(expect.objectContaining({ messageKey: "error.crmAutomationRehearsalDays" }));
      world.automations.checkDay("fake", "2026-11-03", { verdict: "match" });
      expect(view(world, "fake")?.rehearsal).toEqual({ matched: 3, required: 3, ready: true });
      // A wrong day breaks the row; marking it right again mends it.
      world.automations.checkDay("fake", "2026-11-04", { verdict: "differs", note: "Faltou uma pessoa" });
      expect(view(world, "fake")?.rehearsal.matched).toBe(1);
      expect(world.automations.activity("fake").days).toEqual([
        { day: "2026-11-06", would: 0, ran: false, today: true, verdict: null, note: null },
        { day: "2026-11-05", would: 0, ran: true, today: false, verdict: "match", note: null },
        { day: "2026-11-04", would: 0, ran: true, today: false, verdict: "differs", note: "Faltou uma pessoa" },
        { day: "2026-11-03", would: 0, ran: true, today: false, verdict: "match", note: null },
      ]);
      world.automations.checkDay("fake", "2026-11-04", { verdict: "match" });
      world.automations.setMode("fake", "live");
      expect(view(world, "fake")?.state).toBe("live");
      // Once live there is nothing to check.
      expect(() => world.automations.checkDay("fake", "2026-11-05", { verdict: "match" })).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    });
  });

  it("skips weekends and holidays and refuses a day out of the rehearsal", async () => {
    await withWorld([fake("fake")], async (world) => {
      world.clock.now = Date.parse("2026-11-05T12:00:00Z"); // Thursday
      await rehearse(world);
      world.clock.now = Date.parse("2026-11-10T12:00:00Z"); // next Tuesday
      ranOn(world, "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-09");
      for (const day of ["2026-11-05", "2026-11-06", "2026-11-09"]) world.automations.checkDay("fake", day, { verdict: "match" });
      // The weekend between them doesn't break the row; today (the 10th) is still open.
      expect(view(world, "fake")?.rehearsal.matched).toBe(3);
      for (const day of ["2026-11-07", "2026-11-04", "2026-11-11", "2026-02-30"]) {
        expect(() => world.automations.checkDay("fake", day, { verdict: "match" })).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
      }
      // Only today may stay open: a past day left unchecked breaks the row on any weekday (Saturday and Monday alike).
      world.db.run(`DELETE FROM zur_crm_automation_days WHERE day = '2026-11-09'`);
      world.clock.now = Date.parse("2026-11-14T12:00:00Z"); // Saturday
      expect(view(world, "fake")?.rehearsal.matched).toBe(0);
      world.clock.now = Date.parse("2026-11-16T12:00:00Z"); // Monday
      expect(view(world, "fake")?.rehearsal.matched).toBe(0);
      expect(CrmAutomations.workingDay("2026-11-20")).toBe(false);
      expect(CrmAutomations.workingDay("2026-11-02")).toBe(false);
      expect(CrmAutomations.workingDay("2026-11-19")).toBe(true);
    });
  });

  it("back from a pause the rehearsal's days still count; started again from off, they don't", async () => {
    await withWorld([fake("fake")], async (world) => {
      await rehearse(world);
      world.clock.now += DAY;
      ranOn(world, "2026-11-03");
      world.automations.checkDay("fake", "2026-11-03", { verdict: "match" });
      world.db.run(`UPDATE zur_crm_automations SET state = 'paused', paused_reason = 'failures', next_run_at = NULL`);
      expect(view(world, "fake")).toMatchObject({ state: "paused", pausedReason: "failures" });
      world.automations.setMode("fake", "rehearsal");
      expect(view(world, "fake")?.rehearsal.matched).toBe(1);
      world.automations.setMode("fake", "off");
      world.automations.setMode("fake", "rehearsal");
      expect(view(world, "fake")?.rehearsal.matched).toBe(0);
    });
  });
});

describe("runtime", () => {
  it("in rehearsal reads for real and never makes an effect's call; a key is noted once", async () => {
    await withWorld([fake("fake")], async (world) => {
      await rehearse(world);
      expect(await world.automations.tick()).toBe(true);
      expect(world.network.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual(["GET /api/v1/accounts/3/inboxes"]);
      expect(world.network.requests[0]?.headers.get("api_access_token")).toBe("chave-do-agente-zuri-4f2a");
      expect(posts(world)).toEqual([]);
      expect(effects(world)).toEqual([
        { key: "2026-11-03:0", mode: "rehearsal", status: "would", label: "Pessoa 1 · consulta em 30/10" },
        { key: "2026-11-03:1", mode: "rehearsal", status: "would", label: "Pessoa 2 · consulta em 30/10" },
      ]);
      // The next run an hour later notes nothing new: the same keys.
      expect(await world.automations.tick()).toBe(false);
      world.clock.now += 60 * 60_000;
      await world.automations.tick();
      expect(effects(world)).toHaveLength(2);
      expect(posts(world)).toEqual([]);
      const activity = world.automations.activity("fake");
      expect(activity.runs.map((run) => [run.mode, run.outcome, run.effects])).toEqual([
        ["rehearsal", "ok", 0],
        ["rehearsal", "ok", 2],
      ]);
      expect(activity.days[0]).toMatchObject({ day: "2026-11-03", would: 2, verdict: null });
    });
  });

  it("live, each key goes out once, and a rehearsal's note never blocks the live send", async () => {
    await withWorld([fake("fake")], async (world) => {
      await rehearse(world);
      await world.automations.tick();
      world.automations.setMode("fake", "live", true);
      await world.automations.tick();
      expect(posts(world).map((request) => new URL(request.url).pathname)).toEqual(["/api/v1/accounts/3/conversations/10/messages", "/api/v1/accounts/3/conversations/11/messages"]);
      expect(await posts(world)[0]?.json()).toEqual({ content: "oi" });
      world.clock.now += 60 * 60_000;
      await world.automations.tick();
      expect(posts(world)).toHaveLength(2);
      expect(effects(world).filter((effect) => effect.mode === "live").map((effect) => effect.status)).toEqual(["done", "done"]);
    });
  });

  it("refuses a call outside the manifest before anything goes out", async () => {
    const cases: [string, (ctx: AutomationContext) => Promise<void>][] = [
      ["unknown call", async (ctx) => void (await ctx.read("other"))],
      ["a POST as a read", async (ctx) => void (await ctx.read("send"))],
      ["a GET as an effect", async (ctx) => void (await ctx.effect({ effect: "message", key: "a", label: "x", call: "inboxes" }))],
      ["unknown effect", async (ctx) => void (await ctx.effect({ effect: "delete", key: "a", label: "x", call: "send", params: { conversation: 1 } }))],
      ["a param that leaves the path", async (ctx) => void (await ctx.read("inboxes", { account: "../../x" }))],
      ["a missing param", async (ctx) => void (await ctx.effect({ effect: "message", key: "a", label: "x", call: "send" }))],
      ["an empty key", async (ctx) => void (await ctx.effect({ effect: "message", key: "", label: "x", call: "send", params: { conversation: 1 } }))],
    ];
    for (const [name, body] of cases) {
      await withWorld([fake("fake", body)], async (world) => {
        await rehearse(world);
        world.automations.setMode("fake", "live", true);
        await world.automations.tick();
        expect(world.network.requests, name).toEqual([]);
        expect(world.automations.activity("fake").runs[0]?.outcome, name).toBe("failed");
      });
    }
  });

  it("pauses after 2 failures in a row, at once on a refused key, and tells the owner", async () => {
    await withWorld([fake("fake")], async (world) => {
      world.network.handlers.set(HOST, () => new Response("fora", { status: 500 }));
      await rehearse(world);
      await world.automations.tick();
      expect(view(world, "fake")?.state).toBe("rehearsal");
      expect(row(world, "fake")?.failures).toBe(1);
      world.clock.now += 60 * 60_000;
      await world.automations.tick();
      expect(view(world, "fake")).toMatchObject({ state: "paused", pausedReason: "failures" });
      expect(world.told).toEqual([{ kind: "paused", id: "fake", reason: "failures" }]);
      expect(world.automations.nextDue()).toBeNull();
      world.network.handlers.set(HOST, () => Response.json({ error: "unauthorized" }, { status: 401 }));
      world.automations.setMode("fake", "rehearsal");
      await world.automations.tick();
      expect(view(world, "fake")).toMatchObject({ state: "paused", pausedReason: "credential" });
    });
  });

  it("a success clears the failures; a credential removed under it pauses it", async () => {
    await withWorld([fake("fake")], async (world) => {
      let fail = true;
      world.network.handlers.set(HOST, () => (fail ? new Response("fora", { status: 500 }) : Response.json({ payload: [] })));
      await rehearse(world);
      await world.automations.tick();
      fail = false;
      world.clock.now += 60 * 60_000;
      await world.automations.tick();
      expect(row(world, "fake")?.failures).toBe(0);
      world.db.run(`DELETE FROM zur_flow_connections`);
      world.clock.now += 60 * 60_000;
      await world.automations.tick();
      expect(view(world, "fake")).toMatchObject({ state: "paused", pausedReason: "credential" });
    });
  });

  it("keeps the day's ceilings: effects per day and runs per day", async () => {
    await withWorld([fake("fake", undefined, { caps: { runsPerDay: 2, callsPerRun: 10, effectsPerDay: 3, neuronsPerRun: 0 } })], async (world) => {
      world.automations.configure("fake", { connectionId: world.chatwoot, options: { perDay: 5 } });
      world.automations.setMode("fake", "rehearsal");
      await world.automations.tick();
      expect(effects(world)).toHaveLength(3);
      expect(world.automations.activity("fake").runs[0]?.outcome).toBe("cap");
      world.clock.now += 60 * 60_000;
      await world.automations.tick();
      world.clock.now += 60 * 60_000;
      await world.automations.tick();
      // The third run of the day waits for tomorrow, just after the owner's midnight.
      expect(world.automations.activity("fake").runs).toHaveLength(2);
      expect(world.automations.nextDue()).toBe("2026-11-04T03:01:00.000Z");
    });
  });

  it("stops at its calls per run, inside the wake's count", async () => {
    const many = fake("fake", async (ctx) => {
      for (let n = 0; n < 5; n++) await ctx.read("inboxes");
    }, { caps: { runsPerDay: 24, callsPerRun: 2, effectsPerDay: 1, neuronsPerRun: 0 } });
    await withWorld([many], async (world) => {
      await rehearse(world);
      await world.automations.tick();
      expect(world.network.requests).toHaveLength(2);
      expect(world.automations.activity("fake").runs[0]).toMatchObject({ outcome: "cap", calls: 2 });
      // A cap is not a failure.
      expect(row(world, "fake")?.failures).toBe(0);
    });
  });

  it("runs nothing during a lockdown, moving what was due to its next time; a working-days one sleeps through the weekend", async () => {
    await withWorld([fake("fake", undefined, { trigger: { kind: "every", minutes: 60, workingDays: true } })], async (world) => {
      await rehearse(world);
      world.lockdown.active = true;
      // Moved on an hour, not left in the past (that would wake the object every minute of the lockdown).
      expect(await world.automations.tick()).toBe(true);
      expect(world.automations.nextDue()).toBe(new Date(world.clock.now + 60 * 60_000).toISOString());
      expect(await world.automations.tick()).toBe(false);
      world.clock.now += 3 * 60 * 60_000;
      await world.automations.tick();
      expect(Date.parse(world.automations.nextDue() ?? "")).toBeGreaterThan(world.clock.now + 59 * 60_000);
      expect(world.network.requests).toEqual([]);
      expect(world.automations.activity("fake").runs).toEqual([]);
      world.lockdown.active = false;
      world.clock.now = Date.parse("2026-11-07T12:00:00Z"); // Saturday
      world.db.run(`UPDATE zur_crm_automations SET next_run_at = ?`, new Date(world.clock.now).toISOString());
      await world.automations.tick();
      expect(world.network.requests).toEqual([]);
      expect(world.automations.activity("fake").runs).toEqual([]);
      // Straight to Monday at 00:01 in São Paulo, not a wake an hour to skip.
      expect(world.automations.nextDue()).toBe("2026-11-09T03:01:00.000Z");
    });
  });

  it("a newer version of its effects in rehearsal starts the rehearsal over: the days checked were of the old effects", async () => {
    await withWorld([fake("fake")], async (world) => {
      await rehearse(world);
      world.clock.now += 4 * DAY; // Saturday the 7th
      ranOn(world, "2026-11-03", "2026-11-04", "2026-11-05");
      for (const day of ["2026-11-03", "2026-11-04", "2026-11-05"]) world.automations.checkDay("fake", day, { verdict: "match" });
      // Friday the 6th left open breaks the row; checked, the three before it count.
      ranOn(world, "2026-11-06");
      world.automations.checkDay("fake", "2026-11-06", { verdict: "match" });
      expect(view(world, "fake")?.rehearsal.ready).toBe(true);
      world.restart([fake("fake", undefined, { effectsVersion: 2 })]);
      await world.automations.tick();
      expect(view(world, "fake")).toMatchObject({ state: "rehearsal", rehearsal: { matched: 0, ready: false } });
      expect(world.told).toEqual([{ kind: "rehearsal", id: "fake" }]);
    });
  });

  it("a newer version of its effects sends a live one back to rehearsal and tells the owner", async () => {
    await withWorld([fake("fake")], async (world) => {
      await rehearse(world);
      world.automations.setMode("fake", "live", true);
      world.restart([fake("fake", undefined, { effectsVersion: 2 })]);
      await world.automations.tick();
      expect(view(world, "fake")).toMatchObject({ state: "rehearsal", liveSince: null });
      expect(world.told).toEqual([{ kind: "rehearsal", id: "fake" }]);
      expect(posts(world)).toEqual([]);
      // Told once.
      await world.automations.tick();
      expect(world.told).toHaveLength(1);
    });
  });

  it("a code that left stops running and turns off, so it holds no credential", async () => {
    await withWorld([fake("fake")], async (world) => {
      await rehearse(world);
      expect(world.automations.users(world.chatwoot)).toEqual(["fake"]);
      world.restart([]);
      await world.automations.tick();
      expect(world.automations.nextDue()).toBeNull();
      expect(world.network.requests).toEqual([]);
      expect(row(world, "fake")?.state).toBe("off");
      expect(world.automations.users(world.chatwoot)).toEqual([]);
    });
  });
});

// The audit of S18 (docs/qa/auditorias): each test carries the finding's id.
describe("audit S18", () => {
  it("S18-QA10: the credential and the limits change only while it is off", async () => {
    await withWorld([fake("fake")], async (world) => {
      await rehearse(world);
      expect(() => world.automations.configure("fake", { connectionId: world.chatwoot, options: { perDay: 5 } })).toThrowError(
        expect.objectContaining({ code: "CONFLICT", messageKey: "error.crmAutomationTurnOffFirst" }),
      );
      world.automations.setMode("fake", "off");
      world.automations.configure("fake", { connectionId: world.chatwoot, options: { perDay: 5 } });
      expect(view(world, "fake")?.options.perDay).toBe(5);
    });
  });

  it("S18-QA CA9: an answer out of shape pauses it at once, and a refused key tells the owner why", async () => {
    // The module checks what it read and finds it out of shape.
    const strict = fake("fake", async (ctx) => {
      const answer = await ctx.read("inboxes");
      if (!Array.isArray(answer)) throw new FlowStepError("bad_answer");
    });
    await withWorld([strict], async (world) => {
      await rehearse(world);
      await world.automations.tick();
      expect(view(world, "fake")).toMatchObject({ state: "paused", pausedReason: "bad_answer" });
      world.network.handlers.set(HOST, () => Response.json({ error: "unauthorized" }, { status: 401 }));
      world.automations.setMode("fake", "rehearsal");
      await world.automations.tick();
      expect(world.told).toEqual([
        { kind: "paused", id: "fake", reason: "bad_answer" },
        { kind: "paused", id: "fake", reason: "credential" },
      ]);
    });
  });

  it("S18-A1: turning it off mid-run stops the effects still to go, and the owner's off stays as it was left", async () => {
    let world!: World;
    await withWorld([fake("fake")], async (w) => {
      world = w;
      await rehearse(world);
      world.automations.setMode("fake", "live", true);
      world.network.handlers.set(HOST, (request) => {
        // The owner presses "Desligar" while the first message is on its way.
        if (request.method !== "GET") world.automations.setMode("fake", "off");
        return Response.json({ id: 1 });
      });
      await world.automations.tick();
      expect(posts(world)).toHaveLength(1);
      expect(row(world, "fake")).toMatchObject({ state: "off", next_run_at: null });
      expect(world.automations.activity("fake").runs[0]?.outcome).toBe("skipped");
      expect(world.told).toEqual([]);
      // The second message was never noted, so nothing waits as sent.
      expect(effects(world).filter((effect) => effect.mode === "live")).toEqual([{ key: "2026-11-03:0", mode: "live", status: "done", label: "Pessoa 1 · consulta em 30/10" }]);
    });
  });

  it("S18-A1: a lockdown mid-run stops what's left; a failure after the owner's off doesn't pause it over the off", async () => {
    let world!: World;
    const failing = fake("fake", async () => {
      world.automations.setMode("fake", "off");
      throw new Error("fora");
    });
    await withWorld([fake("fake")], async (w) => {
      world = w;
      await rehearse(world);
      world.automations.setMode("fake", "live", true);
      world.network.handlers.set(HOST, (request) => {
        if (request.method !== "GET") world.lockdown.active = true;
        return Response.json({ id: 1 });
      });
      await world.automations.tick();
      expect(posts(world)).toHaveLength(1);
      expect(row(world, "fake")?.state).toBe("live");
      world.lockdown.active = false;
      world.restart([failing]);
      world.db.run(`UPDATE zur_crm_automations SET failures = 1, next_run_at = ?`, new Date(world.clock.now).toISOString());
      await world.automations.tick();
      expect(row(world, "fake")).toMatchObject({ state: "off", paused_reason: null });
      expect(world.told).toEqual([]);
    });
  });

  it("S18-A3: the wake's calls spent by the flows are a cap, not a failure, and the live effect is free to go later", async () => {
    const one = fake("fake", async (ctx) => {
      await ctx.effect({ effect: "message", key: "k1", label: "Pessoa 1", call: "send", params: { conversation: 10 } });
    });
    await withWorld([one], async (world) => {
      await rehearse(world);
      world.automations.setMode("fake", "live", true);
      const original = world.flows.automationCallDeps.bind(world.flows);
      world.flows.automationCallDeps = (calls) => ({ ...original(calls), meter: { room: () => false, take: () => { throw new Error("budget"); } } });
      for (let n = 0; n < 2; n++) {
        await world.automations.tick();
        world.clock.now += 60 * 60_000;
      }
      expect(row(world, "fake")).toMatchObject({ state: "live", failures: 0 });
      // Nothing left: the runs count no call and no effect (QA 8).
      expect(world.automations.activity("fake").runs.map((run) => [run.outcome, run.calls, run.effects])).toEqual([
        ["cap", 0, 0],
        ["cap", 0, 0],
      ]);
      expect(effects(world).filter((effect) => effect.mode === "live")).toEqual([]);
      world.flows.automationCallDeps = original;
      await world.automations.tick();
      expect(posts(world)).toHaveLength(1);
      expect(effects(world).filter((effect) => effect.mode === "live").map((effect) => effect.status)).toEqual(["done"]);
    });
  });

  it("S18-A5: a module never points a Chatwoot call at another account", async () => {
    const other = fake("fake", async (ctx) => {
      await ctx.read("inboxes", { account: 9 });
    });
    await withWorld([other], async (world) => {
      await rehearse(world);
      await world.automations.tick();
      expect(world.network.requests).toEqual([]);
      expect(world.automations.activity("fake").runs[0]?.outcome).toBe("failed");
    });
  });

  it("S18-B2: a live effect left pending by an object that stopped mid-call is marked failed on the next start, never sent", async () => {
    await withWorld([fake("fake")], async (world) => {
      await rehearse(world);
      world.automations.setMode("fake", "live", true);
      world.db.run(`INSERT INTO zur_crm_automation_effects (automation_id, key, mode, day, status, label, created_at, updated_at) VALUES ('fake', '2026-11-03:0', 'live', '2026-11-03', 'pending', 'Pessoa 1', 'x', 'x')`);
      world.restart();
      await world.automations.tick();
      expect(effects(world).find((effect) => effect.key === "2026-11-03:0" && effect.mode === "live")?.status).toBe("failed");
      // Its key keeps it from going twice: only the second message went out.
      expect(posts(world).map((request) => new URL(request.url).pathname)).toEqual(["/api/v1/accounts/3/conversations/11/messages"]);
    });
  });
});

describe("Avisar quando chegar", () => {
  it("only for one on its way; told once when its code arrives", async () => {
    await withWorld([], async (world) => {
      world.automations.watch("review-request", true);
      expect(view(world, "review-request")?.watch).toBe(true);
      await world.automations.tick();
      expect(world.told).toEqual([]);
      world.restart([fake("review-request")]);
      await world.automations.tick();
      expect(world.told).toEqual([{ kind: "arrived", id: "review-request" }]);
      world.restart([fake("review-request")]);
      await world.automations.tick();
      expect(world.told).toHaveLength(1);
      expect(() => world.automations.watch("review-request", true)).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
      expect(() => world.automations.watch("nope", true)).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
      // Turning it off on one on its way.
      world.automations.watch("review-link", true);
      world.automations.watch("review-link", false);
      expect(view(world, "review-link")?.watch).toBe(false);
    });
  });
});

describe("upkeep", () => {
  it("removes runs after 90 days and effects and checked days after 180", async () => {
    await withWorld([fake("fake")], async (world) => {
      const old = (days: number) => new Date(world.clock.now - days * DAY).toISOString();
      world.db.run(`INSERT INTO zur_crm_automation_runs (automation_id, started_at, mode, outcome) VALUES ('fake', ?, 'rehearsal', 'ok'), ('fake', ?, 'rehearsal', 'ok')`, old(91), old(89));
      world.db.run(`INSERT INTO zur_crm_automation_effects (automation_id, key, mode, day, status, label, created_at, updated_at) VALUES ('fake', 'a', 'live', '2026-01-01', 'done', 'x', ?, ?), ('fake', 'b', 'live', '2026-01-01', 'done', 'x', ?, ?)`, old(181), old(181), old(179), old(179));
      const oldDay = (days: number) => old(days).slice(0, 10);
      world.automations.configure("fake", { connectionId: world.chatwoot, options: {} });
      world.db.run(`INSERT INTO zur_crm_automation_days (automation_id, day, verdict, decided_at) VALUES ('fake', ?, 'match', 'x'), ('fake', ?, 'match', 'x')`, oldDay(181), oldDay(179));
      await world.automations.tick();
      expect(world.db.all(`SELECT 1 FROM zur_crm_automation_runs`)).toHaveLength(1);
      expect(world.db.all(`SELECT key FROM zur_crm_automation_effects`)).toEqual([{ key: "b" }]);
      expect(world.db.all(`SELECT day FROM zur_crm_automation_days`)).toEqual([{ day: oldDay(179) }]);
    });
  });

  it("migration 39 applies on a database at version 38 and moves the CRM's number", async () => {
    const stub = testEnv.AGENT.get(testEnv.AGENT.idFromName("crm-automations-migration"));
    await runInDurableObject(stub, async (_agent: ZuriAgent, state) => {
      const db = new Database(state.storage);
      migrate(db, MIGRATIONS.filter((migration) => migration.version <= 38));
      expect(migrate(db)).toBe(39);
      const before = db.one<{ crm: number }>(`SELECT crm FROM zur_area_versions WHERE id = 1`)?.crm ?? 0;
      db.run(`INSERT INTO zur_crm_automations (id, updated_at) VALUES ('fake', '2026-11-03T12:00:00.000Z')`);
      db.run(`UPDATE zur_crm_automations SET next_run_at = '2026-11-03T13:00:00.000Z', failures = 1`);
      expect(db.one<{ crm: number }>(`SELECT crm FROM zur_area_versions WHERE id = 1`)?.crm).toBe(before + 1);
      expect(() => db.run(`INSERT INTO zur_crm_automations (id, state, updated_at) VALUES ('x', 'on', 'x')`)).toThrow();
    });
  });
});
