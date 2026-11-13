import { AGENT_INSTANCE_NAME, CHAT_MODELS, type ChosenFallback, type ChosenModel, DEFAULT_CHAT_MODEL, DEFAULT_FALLBACK_MODEL, MODEL_CATALOG_LIMITS, modelCatalogSchema, NO_FALLBACK_MODEL, neuronsPerMillion, type SettingsUpdate } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { contextBudget } from "../src/agent/context.ts";
import { inWake, WakeBudget } from "../src/agent/wake-budget.ts";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { catalogLabel, type ModelNotice, ModelCatalogService, readItem } from "../src/ai/catalog.ts";
import { modelRate, setCatalogRates } from "../src/ai/catalog-rates.ts";
import { developmentCatalog } from "../src/ai/dev-catalog.ts";
import { stepNeurons } from "../src/ai/usage.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { AppError } from "../src/http/errors.ts";
import { testEnv } from "./helpers.ts";

// PR S21 (P24): the catalog of Workers AI models, checked on its own. A new
// model joins the list only with the owner's tap; a model in use that leaves is
// replaced on its day, with a notice; the catalog's prices feed the estimates.

const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));

const GLM = "@cf/zai-org/glm-4.7-flash";
const QWEN = "@cf/qwen/qwen3-30b-a3b-fp8";
const SCOUT = "@cf/meta/llama-4-scout-17b-16e-instruct";
const LLAMA = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const GEMMA = "@cf/google/gemma-3-12b-it";
// 06:00 UTC: the hour of the daily check.
const T0 = Date.parse("2026-11-13T06:00:00Z");
const DAY = 86_400_000;

const usd = (neurons: number) => (neurons * 0.011) / 1_000;
type Extra = { property_id: string; value: unknown }[];
function item(name: string, options: { context?: number; input?: number; output?: number; tools?: boolean; leaves?: string; extra?: Extra } = {}) {
  const fixed = (CHAT_MODELS as Record<string, { context: number; input: number; output: number }>)[name];
  const input = options.input ?? fixed?.input ?? 20_000;
  const output = options.output ?? fixed?.output ?? 60_000;
  return {
    name,
    task: { name: "Text Generation" },
    properties: [
      { property_id: "context_window", value: String(options.context ?? fixed?.context ?? 80_000) },
      ...(options.tools === false ? [] : [{ property_id: "function_calling", value: "true" }]),
      { property_id: "price", value: [{ unit: "per M input tokens", price: usd(input), currency: "USD" }, { unit: "per M output tokens", price: usd(output), currency: "USD" }] },
      ...(options.leaves ? [{ property_id: "planned_deprecation_date", value: options.leaves }] : []),
      ...(options.extra ?? []),
    ],
  };
}
const fixedItems = (leaving: Record<string, string> = {}) => Object.keys(CHAT_MODELS).map((name) => item(name, leaving[name] ? { leaves: leaving[name] } : {}));

interface World {
  catalog: ModelCatalogService;
  state: InternalState;
  settings: { aiModel: ChosenModel; aiFallbackModel: ChosenFallback };
  notices: ModelNotice[];
  answer: { value: unknown; fail?: boolean; pages?: unknown[] };
  clock: { now: number };
  calls: number;
  /** The pages asked for, in order. */
  asked: number[];
  rearms: number;
}

/** A catalog over the object's database, with a clock, settings and an answer the test controls. */
function world(agent: ZuriAgent, options: { source?: boolean; timeoutMs?: number } = {}): World {
  const state = new InternalState(agent.store.db);
  state.delete("model_catalog");
  const w = {
    state,
    settings: { aiModel: DEFAULT_CHAT_MODEL as ChosenModel, aiFallbackModel: DEFAULT_FALLBACK_MODEL as ChosenFallback },
    notices: [] as ModelNotice[],
    answer: { value: [...fixedItems(), item(GEMMA)] as unknown, fail: false },
    clock: { now: T0 },
    calls: 0,
    asked: [] as number[],
    rearms: 0,
  } as World;
  w.catalog = new ModelCatalogService({
    state,
    source: () =>
      options.source === false
        ? null
        : async (page: number) => {
            w.calls++;
            w.asked.push(page);
            if (w.answer.fail) throw new Error("catalog down");
            return w.answer.pages ? w.answer.pages[page - 1] : w.answer.value;
          },
    rearm: async () => {
      w.rearms++;
    },
    settings: {
      field: ((name: "aiModel" | "aiFallbackModel") => w.settings[name]) as never,
      update: (patch: SettingsUpdate) => {
        if (patch.aiModel) w.settings.aiModel = patch.aiModel;
        if (patch.aiFallbackModel) w.settings.aiFallbackModel = patch.aiFallbackModel;
      },
    },
    notify: (notice) => w.notices.push(notice),
    locale: () => "pt-BR",
    clock: () => w.clock.now,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  return w;
}

const stored = (w: World) => JSON.parse(w.state.get<string>("model_catalog") ?? "{}") as { nextAt: string | null; listed: string[]; failed: boolean };

afterEach(() => setCatalogRates(new Map()));

describe("reading one model of the catalog", () => {
  it("takes a text model's window, tools, prices in Neurons and leaving day", () => {
    const entry = readItem(item(GEMMA, { context: 80_000, input: 31_371, output: 50_000, leaves: "2027-01-15" }));
    expect(entry).toMatchObject({ id: GEMMA, context: 80_000, tools: true, leavesOn: "2027-01-15" });
    expect(Math.abs((entry?.input ?? 0) - 31_371)).toBeLessThanOrEqual(1);
    // GLM 4.7 Flash at the catalog's US$ 0.0605 per million is the dated table's 5,500 Neurons.
    expect(neuronsPerMillion(0.0605)).toBe(5_500);
  });

  it("skips what is not a text model, a malformed id and a model off the list without a price", () => {
    expect(readItem({ ...item(GEMMA), task: { name: "Text Embeddings" } })).toBeNull();
    expect(readItem(item("@cf/../../etc"))).toBeNull();
    expect(readItem(item("https://exemplo.com.br/model"))).toBeNull();
    expect(readItem({ name: GEMMA, properties: [] })).toBeNull();
    expect(readItem("not a model")).toBeNull();
    const priced = (price: unknown) => readItem({ name: GEMMA, properties: [{ property_id: "context_window", value: "80000" }, { property_id: "price", value: price }] });
    expect(priced("0.1")).toBeNull();
    expect(priced([{ unit: "per M input tokens", price: 0, currency: "USD" }, { unit: "per M output tokens", price: 1, currency: "USD" }])).toBeNull();
    expect(priced([{ unit: "per M input tokens", price: 1, currency: "EUR" }, { unit: "per M output tokens", price: 1, currency: "EUR" }])).toBeNull();
    // Above US$ 110 per million: malformed, never a price to estimate with.
    expect(priced([{ unit: "per M input tokens", price: 500, currency: "USD" }, { unit: "per M output tokens", price: 1, currency: "USD" }])).toBeNull();
  });

  it("keeps the dated table's numbers for what the catalog leaves out of a fixed model", () => {
    const entry = readItem({ name: LLAMA, properties: [{ property_id: "context_window", value: "not a number" }] });
    expect(entry).toMatchObject({ id: LLAMA, context: CHAT_MODELS[LLAMA].context, input: CHAT_MODELS[LLAMA].input, output: CHAT_MODELS[LLAMA].output, tools: true, leavesOn: null });
    expect(readItem({ name: SCOUT, properties: [{ property_id: "context_window", value: 131_000 }, { property_id: "planned_deprecation_date", value: "soon" }] })?.leavesOn).toBeNull();
    expect(readItem({ name: GEMMA, properties: [...item(GEMMA, { tools: false }).properties, { property_id: "function_calling", value: true }] })?.tools).toBe(true);
  });

  it("names a model by the dated table or by the last part of its id", () => {
    expect(catalogLabel(GLM)).toBe("GLM 4.7 Flash");
    expect(catalogLabel(GEMMA)).toBe("gemma-3-12b-it");
  });

  it("reads the local development's catalog: a new model, one without tools and one leaving", () => {
    const entries = developmentCatalog(T0).map(readItem);
    expect(entries.find((e) => e?.id === GEMMA)?.tools).toBe(true);
    expect(entries.find((e) => e?.id === LLAMA)?.leavesOn).toBe("2027-01-12");
    expect(entries.some((e) => e?.id === "@cf/example/sem-ferramentas")).toBe(false);
  });
});

describe("the daily check", () => {
  it("comes first at the next 06:00 UTC, never at install", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.clock.now = Date.parse("2026-11-13T05:59:59Z");
      expect(w.catalog.nextDue()).toBe("2026-11-13T06:00:00.000Z");
      expect(await w.catalog.tick()).toBe(false);
      w.clock.now = Date.parse("2026-11-13T06:00:01Z");
      expect(w.catalog.nextDue()).toBe("2026-11-14T06:00:00.000Z");
      // Conferir agora runs at once and keeps the hour of the next one.
      await w.catalog.checkNow();
      expect(stored(w).nextAt).toBe("2026-11-14T06:00:00.000Z");
    });
  });

  it("offers a new model fit for the chat and leaves out one without tools or with a short window", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.answer.value = [...fixedItems(), item(GEMMA), item("@cf/x/no-tools", { tools: false }), item("@cf/x/short", { context: 8_192 })];
      expect(await inWake(new WakeBudget(), () => w.catalog.tick())).toBe(true);
      const view = modelCatalogSchema.parse(w.catalog.view());
      expect(view.checkedAt).toBe(new Date(T0).toISOString());
      expect(view.failed).toBe(false);
      expect(view.notices.map((n) => `${n.kind}:${n.model.id}`)).toEqual([`new:${GEMMA}`]);
      expect(view.notices[0]?.model).toMatchObject({ label: "gemma-3-12b-it", context: 80_000, fixed: false });
      expect(view.listed.map((m) => m.id)).toEqual(Object.keys(CHAT_MODELS));
      // The next one in a day; before that, nothing is called.
      expect(stored(w).nextAt).toBe(new Date(T0 + DAY).toISOString());
      w.clock.now += DAY - 1;
      expect(await w.catalog.tick()).toBe(false);
      expect(w.calls).toBe(1);
    });
  });

  it("tells of a price change of a model on the list for a week, and the estimate uses the new price", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.answer.value = [...fixedItems().filter((i) => i.name !== QWEN), item(QWEN, { input: 9_000, output: 40_000 })];
      await w.catalog.tick();
      expect(w.catalog.view().notices.map((n) => `${n.kind}:${n.model.id}:${n.inUse}`)).toEqual([`price:${QWEN}:true`]);
      expect(Math.round(modelRate(QWEN)?.input ?? 0)).toBe(9_000);
      expect(stepNeurons({ model: QWEN, billable: true, input: { reported: 1_000_000, estimated: 0 }, output: { reported: 0, estimated: 0 } })).toBeCloseTo(9_000, -1);
      // The same price the next day is no change; a week after the change the line is gone.
      w.clock.now += DAY;
      await w.catalog.tick();
      expect(w.catalog.view().notices).toHaveLength(1);
      w.clock.now += 7 * DAY;
      await w.catalog.tick();
      expect(w.catalog.view().notices).toHaveLength(0);
    });
  });

  it("keeps the list when the answer fails, has no model of the fixed list or never comes, and tries again in an hour", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      await w.catalog.tick();
      w.answer.fail = true;
      w.clock.now += DAY;
      expect(await w.catalog.tick()).toBe(true);
      expect(w.catalog.view()).toMatchObject({ failed: true, checkedAt: new Date(T0).toISOString() });
      expect(stored(w).nextAt).toBe(new Date(w.clock.now + MODEL_CATALOG_LIMITS.retryMs).toISOString());
      // An answer of another shape removes nothing.
      w.answer = { value: [item(GEMMA)] };
      w.clock.now += MODEL_CATALOG_LIMITS.retryMs;
      await w.catalog.tick();
      expect(w.catalog.view().notices.map((n) => n.model.id)).toEqual([GEMMA]);
      w.answer = { value: { error: "not a list" } };
      w.clock.now += MODEL_CATALOG_LIMITS.retryMs;
      await w.catalog.tick();
      expect(w.catalog.view().failed).toBe(true);
      // Back to normal: the flag goes.
      w.answer = { value: fixedItems() };
      w.clock.now += MODEL_CATALOG_LIMITS.retryMs;
      await w.catalog.tick();
      expect(w.catalog.view().failed).toBe(false);
    });
  });

  it("gives up on an answer that never comes, within the deadline", async () => {
    await inOwner(async (agent) => {
      const w = world(agent, { timeoutMs: 20 });
      w.answer.value = new Promise(() => undefined);
      const started = Date.now();
      expect(await w.catalog.tick()).toBe(true);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(w.catalog.view().failed).toBe(true);
    });
  });

  it("waits for the next wake when this one has no room for the call", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      const full = new WakeBudget(1, 0);
      full.take(1);
      expect(await inWake(full, () => w.catalog.tick())).toBe(false);
      expect(w.calls).toBe(0);
      expect(full.short).toBe(true);
    });
  });

  it("schedules nothing and refuses Conferir agora without a catalog", async () => {
    await inOwner(async (agent) => {
      const w = world(agent, { source: false });
      expect(w.catalog.available()).toBe(false);
      expect(w.catalog.nextDue()).toBeNull();
      expect(await w.catalog.tick()).toBe(false);
      await expect(w.catalog.checkNow()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
      expect(w.catalog.view()).toMatchObject({ available: false, checkedAt: null, notices: [] });
      expect(w.catalog.view().listed).toHaveLength(Object.keys(CHAT_MODELS).length);
    });
  });

  it("checks now at most once a minute", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      await w.catalog.checkNow();
      w.clock.now += 20_000;
      const error = await w.catalog.checkNow().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "RATE_LIMITED", details: { retryAfter: 40 } });
      w.clock.now += 40_000;
      expect((await w.catalog.checkNow()).checkedAt).toBe(new Date(w.clock.now).toISOString());
      expect(w.calls).toBe(2);
    });
  });

  it("reads a stored state it can't use as no check yet, and writes nothing when nothing changed", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.state.set("model_catalog", "{not json");
      expect(w.catalog.view().checkedAt).toBeNull();
      w.state.set("model_catalog", JSON.stringify({ checkedAt: 1 }));
      expect(w.catalog.view().checkedAt).toBeNull();
      await w.catalog.tick();
      const set = w.state.set.bind(w.state);
      let writes = 0;
      w.state.set = ((key: never, value: never) => {
        writes++;
        return set(key, value);
      }) as typeof w.state.set;
      w.catalog.add(GEMMA);
      w.catalog.add(GEMMA);
      expect(stored(w).listed).toEqual([GEMMA]);
      expect(writes).toBe(1);
      // The same answer the next day writes only the check's own times.
      w.clock.now += DAY;
      await w.catalog.tick();
      expect(writes).toBe(2);
    });
  });
});

describe("Pôr na lista", () => {
  it("puts a new model on the list: it is usable and priced by the catalog", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      await w.catalog.tick();
      expect(w.catalog.usable(GEMMA)).toBe(false);
      const view = w.catalog.add(GEMMA);
      expect(view.listed.at(-1)).toMatchObject({ id: GEMMA, fixed: false });
      expect(view.notices).toEqual([]);
      expect(w.catalog.usable(GEMMA)).toBe(true);
      expect(modelRate(GEMMA)?.context).toBe(80_000);
      // The prompt is sized for the model's window.
      expect(contextBudget(GEMMA, 100_000, 1_000, 0)).toBe(80_000 - 1_000 - 1_024);
    });
  });

  it("refuses a model it doesn't know, one of the fixed list, one unfit and one leaving today", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.answer.value = [...fixedItems(), item(GEMMA, { leaves: "2026-11-13" }), item("@cf/x/fit", {})];
      await w.catalog.tick();
      expect(() => w.catalog.add("@cf/x/unknown")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(() => w.catalog.add(GLM)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(() => w.catalog.add(GEMMA)).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
      // A model that left today is not offered either.
      expect(w.catalog.view().notices.map((n) => n.model.id)).toEqual(["@cf/x/fit"]);
    });
  });

  it("says which models the settings may name", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.answer.value = [...fixedItems({ [LLAMA]: "2026-11-01" }), item(GEMMA)];
      await w.catalog.tick();
      expect(w.catalog.usable(NO_FALLBACK_MODEL)).toBe(true);
      expect(w.catalog.usable("anthropic/claude-haiku-5-5")).toBe(true);
      expect(w.catalog.usable(GLM)).toBe(true);
      expect(w.catalog.usable(LLAMA)).toBe(false);
      expect(w.catalog.usable(GEMMA)).toBe(false);
      expect(w.catalog.view().listed.map((m) => m.id)).not.toContain(LLAMA);
    });
  });
});

describe("a model in use that leaves", () => {
  it("warns once of the date, then replaces the fallback on its day with none when the default fallback is the one leaving", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.answer.value = fixedItems({ [QWEN]: "2026-11-20" });
      await w.catalog.tick();
      expect(w.notices).toEqual([{ kind: "ai.modelLeaving", model: "Qwen3 30B A3B", on: "20/11/2026" }]);
      expect(w.catalog.view().notices.map((n) => `${n.kind}:${n.on}:${n.inUse}`)).toEqual(["leaving:2026-11-20:true"]);
      // The next day's check tells nothing again.
      w.clock.now = Date.parse("2026-11-14T14:00:00Z");
      expect(await w.catalog.tick()).toBe(true);
      expect(w.notices).toHaveLength(1);
      expect(w.catalog.nextDue()).toBe("2026-11-15T06:00:00.000Z");
      w.clock.now = Date.parse("2026-11-19T07:00:00Z");
      await w.catalog.tick();
      expect(w.catalog.nextDue()).toBe("2026-11-20T00:00:00.000Z");
      w.clock.now = Date.parse("2026-11-20T00:00:00Z");
      expect(await w.catalog.tick()).toBe(true);
      expect(w.settings.aiFallbackModel).toBe(NO_FALLBACK_MODEL);
      expect(w.notices.at(-1)).toEqual({ kind: "ai.fallbackOff", from: "Qwen3 30B A3B" });
      expect(w.catalog.usable(QWEN)).toBe(false);
      // Done for the day: the alarm waits for the next check.
      expect(w.catalog.nextDue()).toBe(stored(w).nextAt);
    });
  });

  it("replaces the chat model by the default and a fallback by the default fallback", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.settings = { aiModel: LLAMA, aiFallbackModel: SCOUT };
      w.answer.value = fixedItems({ [LLAMA]: "2026-11-13", [SCOUT]: "2026-11-13" });
      await w.catalog.tick();
      expect(w.settings).toEqual({ aiModel: GLM, aiFallbackModel: QWEN });
      expect(w.notices).toEqual([
        { kind: "ai.modelSwitched", from: "Llama 3.3 70B", to: "GLM 4.7 Flash" },
        { kind: "ai.modelSwitched", from: "Llama 4 Scout 17B", to: "Qwen3 30B A3B" },
      ]);
    });
  });

  it("takes the first model of the fixed list still there when the default itself leaves", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.settings = { aiModel: GLM, aiFallbackModel: NO_FALLBACK_MODEL };
      w.answer.value = fixedItems({ [GLM]: "2026-11-01" });
      await w.catalog.tick();
      expect(w.settings.aiModel).toBe(QWEN);
    });
  });

  it("drops a model the owner added that left the catalog, and switches away from it", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      await w.catalog.tick();
      w.catalog.add(GEMMA);
      w.settings.aiModel = GEMMA;
      w.answer.value = fixedItems();
      w.clock.now += DAY;
      // Missing once (a model hidden for a day): it stays, with its last numbers.
      await w.catalog.tick();
      expect(w.settings.aiModel).toBe(GEMMA);
      expect(w.catalog.usable(GEMMA)).toBe(true);
      expect(w.notices).toEqual([]);
      // Missing from the next complete answer too: gone.
      w.clock.now += DAY;
      await w.catalog.tick();
      expect(w.settings.aiModel).toBe(GLM);
      expect(stored(w).listed).toEqual([]);
      expect(w.catalog.usable(GEMMA)).toBe(false);
      expect(w.notices).toEqual([{ kind: "ai.modelSwitched", from: "gemma-3-12b-it", to: "GLM 4.7 Flash" }]);
    });
  });

  it("never touches a paid model", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.settings = { aiModel: "anthropic/claude-haiku-5-5", aiFallbackModel: "openai/gpt-6-luna" };
      w.answer.value = fixedItems({ [GLM]: "2026-11-01", [QWEN]: "2026-11-01" });
      await w.catalog.tick();
      expect(w.settings).toEqual({ aiModel: "anthropic/claude-haiku-5-5", aiFallbackModel: "openai/gpt-6-luna" });
      expect(w.notices).toEqual([]);
    });
  });
});

describe("what the reviews found (PR S21)", () => {
  /** A promise the test lets go of. */
  const held = () => {
    let release: (value: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  it("keeps a model put on the list while a check was waiting for the catalog", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      await w.catalog.tick();
      const late = held();
      w.answer.value = late.promise;
      w.clock.now += DAY;
      const running = w.catalog.tick();
      w.catalog.add(GEMMA);
      late.release([...fixedItems(), item(GEMMA)]);
      await running;
      expect(stored(w).listed).toEqual([GEMMA]);
      expect(w.catalog.usable(GEMMA)).toBe(true);
    });
  });

  it("refuses the second of two Conferir agora at the same time, with one call to the catalog", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      const results = await Promise.allSettled([w.catalog.checkNow(), w.catalog.checkNow()]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
      expect(results[1]).toMatchObject({ reason: { code: "RATE_LIMITED" } });
      expect(w.calls).toBe(1);
      // The alarm and a tap landing together share the same call.
      w.clock.now += DAY;
      await Promise.all([w.catalog.tick(), w.catalog.checkNow()]);
      expect(w.calls).toBe(2);
    });
  });

  it("reads the catalog page by page, and removes nothing when the last page is still full", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      const filler = (from: number) => Array.from({ length: MODEL_CATALOG_LIMITS.perPage }, (_, i) => item(`@cf/exemplo/m-${from + i}`, { tools: false }));
      await w.catalog.tick();
      w.catalog.add(GEMMA);
      w.settings.aiModel = GEMMA;
      // Three full pages, GEMMA on none of them: the answer is cut, so nothing left.
      w.answer.pages = [[...fixedItems(), ...filler(0).slice(4)], filler(100), filler(200), [item(GEMMA)]];
      for (let i = 0; i < 2; i++) {
        w.clock.now += DAY;
        await w.catalog.tick();
      }
      expect(w.asked.slice(1)).toEqual([1, 2, 3, 1, 2, 3]);
      expect(w.settings.aiModel).toBe(GEMMA);
      expect(w.catalog.usable(GEMMA)).toBe(true);
      // A short second page ends the reading: complete, and GEMMA is on it.
      w.answer.pages = [[...fixedItems(), ...filler(0).slice(4)], [item(GEMMA)]];
      w.asked = [];
      w.clock.now += DAY;
      await w.catalog.tick();
      expect(w.asked).toEqual([1, 2]);
      expect(stored(w).listed).toEqual([GEMMA]);
    });
  });

  it("stops at the page the wake has no room for", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.answer.pages = [[...fixedItems(), ...Array.from({ length: MODEL_CATALOG_LIMITS.perPage - 4 }, (_, i) => item(`@cf/exemplo/m-${i}`, { tools: false }))], [item(GEMMA)]];
      expect(await inWake(new WakeBudget(1, 0), () => w.catalog.tick())).toBe(true);
      expect(w.asked).toEqual([1]);
      expect(w.catalog.view().checkedAt).not.toBeNull();
    });
  });

  it("stops offering a model of the fixed list missing from two complete answers, and the settings fall back", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.settings = { aiModel: SCOUT, aiFallbackModel: QWEN };
      w.answer.value = fixedItems().filter((i) => i.name !== SCOUT);
      await w.catalog.tick();
      expect(w.catalog.usable(SCOUT)).toBe(true);
      w.clock.now += DAY;
      await w.catalog.tick();
      expect(w.catalog.usable(SCOUT)).toBe(false);
      expect(w.catalog.view().listed.map((m) => m.id)).not.toContain(SCOUT);
      expect(w.settings.aiModel).toBe(GLM);
      // Back in the catalog: offered again.
      w.answer.value = fixedItems();
      w.clock.now += DAY;
      await w.catalog.tick();
      expect(w.catalog.usable(SCOUT)).toBe(true);
    });
  });

  it("gives the fallback back to the default fallback when the chat model became the same model", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.settings = { aiModel: LLAMA, aiFallbackModel: GLM };
      w.answer.value = fixedItems({ [LLAMA]: "2026-11-13" });
      await w.catalog.tick();
      expect(w.settings).toEqual({ aiModel: GLM, aiFallbackModel: QWEN });
      expect(w.notices.at(-1)).toEqual({ kind: "ai.modelSwitched", from: "GLM 4.7 Flash", to: "Qwen3 30B A3B" });
    });
  });

  it("never offers a model that reasons before answering, and offers one at exactly the minimum window", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      const min = MODEL_CATALOG_LIMITS.minContext;
      w.answer.value = [...fixedItems(), item("@cf/x/thinks", { extra: [{ property_id: "reasoning", value: "true" }] }), item("@cf/x/at-min", { context: min }), item("@cf/x/below", { context: min - 1 })];
      await w.catalog.tick();
      expect(w.catalog.view().notices.map((n) => n.model.id)).toEqual(["@cf/x/at-min"]);
    });
  });

  it("calls a price that moved by 1% or less no change, and keeps the dated price of a fixed model offered at under a tenth", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      const glm = CHAT_MODELS[GLM];
      w.answer.value = [...fixedItems().filter((i) => i.name !== GLM && i.name !== QWEN), item(GLM, { input: glm.input * 1.01 }), item(QWEN, { input: CHAT_MODELS[QWEN].input / 11 })];
      await w.catalog.tick();
      expect(w.catalog.view().notices).toEqual([]);
      expect(modelRate(QWEN)?.input).toBe(CHAT_MODELS[QWEN].input);
    });
  });

  it("takes an answer with a model of the owner's list even when no fixed one is left", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      await w.catalog.tick();
      w.catalog.add(GEMMA);
      w.answer.value = [item(GEMMA)];
      w.clock.now += DAY;
      await w.catalog.tick();
      expect(w.catalog.view().failed).toBe(false);
    });
  });

  it("waits 1, 2 and 4 hours after failures in a row, never past the daily check", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      w.answer.fail = true;
      const waits: number[] = [];
      for (let i = 0; i < 6; i++) {
        await w.catalog.tick();
        const next = Date.parse(stored(w).nextAt ?? "");
        waits.push((next - w.clock.now) / 3_600_000);
        w.clock.now = next;
      }
      expect(waits.slice(0, 4)).toEqual([1, 2, 4, 8]);
      // 16 h after 15 h of tries would pass 06:00 of the next day: the daily check comes first.
      expect(waits[4]).toBe(9);
    });
  });

  it("sets the alarm again when Conferir agora finds a model in use leaving, and only then", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      await w.catalog.checkNow();
      expect(w.rearms).toBe(0);
      // Leaving on a day later than the next check: the alarm already comes back sooner.
      w.answer.value = fixedItems({ [GLM]: "2026-11-20" });
      w.clock.now += MODEL_CATALOG_LIMITS.checkNowEveryMs;
      await w.catalog.checkNow();
      expect(w.rearms).toBe(0);
      // Leaving at 00:00 UTC, before the next 06:00 check: the alarm is set again.
      w.answer.value = fixedItems({ [GLM]: "2026-11-14" });
      w.clock.now += MODEL_CATALOG_LIMITS.checkNowEveryMs;
      await w.catalog.checkNow();
      expect(w.rearms).toBe(1);
    });
  });

  it("refuses Conferir agora 1 ms before the minute and tells a price change until the seventh day ends", async () => {
    await inOwner(async (agent) => {
      const w = world(agent);
      await w.catalog.checkNow();
      w.clock.now += MODEL_CATALOG_LIMITS.checkNowEveryMs - 1;
      await expect(w.catalog.checkNow()).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retryAfter: 1 } });
      w.answer.value = [...fixedItems().filter((i) => i.name !== QWEN), item(QWEN, { input: 9_000 })];
      w.clock.now += 1;
      await w.catalog.checkNow();
      w.clock.now += MODEL_CATALOG_LIMITS.priceNoticeMs - 1;
      expect(w.catalog.view().notices).toHaveLength(1);
      w.clock.now += 1;
      expect(w.catalog.view().notices).toHaveLength(0);
    });
  });
});
