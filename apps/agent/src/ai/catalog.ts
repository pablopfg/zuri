import {
  CATALOG_MAX_NEURONS_PER_MILLION,
  CHAT_MODEL_IDS,
  CHAT_MODELS,
  type CatalogModel,
  type CatalogNotice,
  catalogModelName,
  type ChosenFallback,
  type ChosenModel,
  DEFAULT_CHAT_MODEL,
  DEFAULT_FALLBACK_MODEL,
  isCatalogModelId,
  isChatModel,
  isPaidModel,
  type Locale,
  MODEL_CATALOG_LIMITS,
  type ModelCatalog,
  NO_FALLBACK_MODEL,
  neuronsPerMillion,
  type SettingsUpdate,
} from "@zuri/shared";
import { z } from "zod";
import { currentWake } from "../agent/wake-budget.ts";
import type { InternalState } from "../db/internal-state.ts";
import { AppError } from "../http/errors.ts";
import { log } from "../log.ts";
import { type ModelRate, setCatalogRates } from "./catalog-rates.ts";

const L = MODEL_CATALOG_LIMITS;
const FIXED: readonly string[] = CHAT_MODEL_IDS;

/** A model as the last check left it: Neurons per million tokens, the window, and the day it leaves (UTC). */
const entrySchema = z
  .object({
    id: z.string().max(L.idMaxChars),
    context: z.number().int().min(0),
    input: z.number().min(0),
    output: z.number().min(0),
    tools: z.boolean(),
    /** The catalog says it reasons before answering (its own switch, not one Zuri turns off for a new model). */
    reasoning: z.boolean(),
    leavesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    priceAt: z.string().nullable(),
  })
  .strict();
type Entry = z.infer<typeof entrySchema>;

/** The catalog's state: one row of zur_settings ("model_catalog"), never in the backup. */
const stateSchema = z
  .object({
    checkedAt: z.string().nullable(),
    nextAt: z.string().nullable(),
    failed: z.boolean(),
    /** Failed tries in a row: the next one waits 1, 2, 4… hours, never past the daily check. */
    failures: z.number().int().min(0),
    /** Models of the fixed list two complete answers in a row didn't have: gone from the catalog, no longer usable. */
    missing: z.array(z.string().max(L.idMaxChars)).max(L.maxModels),
    /** Models of either list the last complete answer didn't have: one more such answer and they are gone. */
    absent: z.array(z.string().max(L.idMaxChars)).max(L.maxModels * 2),
    checkNowAt: z.number().nullable(),
    /** The UTC day whose leaving models were already replaced. */
    enforcedOn: z.string().nullable(),
    models: z.array(entrySchema).max(L.maxModels),
    listed: z.array(z.string().max(L.idMaxChars)).max(L.maxModels),
    /** "<id>|<day>" of the leaving dates already told to the owner. */
    warned: z.array(z.string().max(200)).max(L.maxModels),
  })
  .strict();
type State = z.infer<typeof stateSchema>;

const INITIAL: State = { checkedAt: null, nextAt: null, failed: false, failures: 0, missing: [], absent: [], checkNowAt: null, enforcedOn: null, models: [], listed: [], warned: [] };

/** One model of the catalog's answer, read leniently: an item that doesn't fit is skipped, never the whole answer. */
const itemSchema = z.object({
  name: z.string().max(200),
  task: z.object({ name: z.string().max(200) }).optional(),
  properties: z.array(z.object({ property_id: z.string().max(100), value: z.unknown() })).max(100),
});
const priceSchema = z.array(z.object({ unit: z.string().max(100), price: z.number(), currency: z.string().max(10) })).max(10);

export type ModelNotice =
  | { kind: "ai.modelLeaving"; model: string; on: string }
  | { kind: "ai.modelSwitched"; from: string; to: string }
  | { kind: "ai.fallbackOff"; from: string };

export interface ModelCatalogDeps {
  state: InternalState;
  /** One page of Cloudflare's list of text models (the AI binding's `models`), or null where there is no binding. */
  source: () => ((page: number) => Promise<unknown>) | null;
  settings: {
    field(name: "aiModel"): ChosenModel;
    field(name: "aiFallbackModel"): ChosenFallback;
    update(patch: SettingsUpdate): unknown;
  };
  notify: (notice: ModelNotice) => void;
  locale: () => Locale;
  clock?: () => number;
  /** The catalog call's deadline; the tests shorten it. */
  timeoutMs?: number;
  /** Sets the shared alarm again after a check outside it, so a leaving day found now is kept. */
  rearm?: () => Promise<void>;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The next 06:00 UTC from `now` on: the hour of the daily check (03:00 in Brasília, a quiet hour). */
export function firstCheck(now: number): string {
  const today = Date.parse(`${day(now)}T06:00:00.000Z`);
  return new Date(today >= now ? today : today + 86_400_000).toISOString();
}

/** The model's name on the screen: the dated table's for the fixed list, the id's last part for the rest. */
export function catalogLabel(id: string): string {
  return isChatModel(id) ? CHAT_MODELS[id].label : catalogModelName(id);
}

/** A whole number from a property's text or number; null for anything else. */
function wholeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** US$ per million tokens of one direction, as Neurons; null when missing, not in dollars or out of range. */
function rate(prices: z.infer<typeof priceSchema>, direction: "input" | "output"): number | null {
  const found = prices.find((p) => p.currency === "USD" && p.unit.toLowerCase() === `per m ${direction} tokens`);
  if (!found || !Number.isFinite(found.price) || found.price <= 0) return null;
  const neurons = neuronsPerMillion(found.price);
  return neurons > 0 && neurons <= CATALOG_MAX_NEURONS_PER_MILLION ? neurons : null;
}

/**
 * The catalog's price, or the dated table's for a fixed model when the catalog
 * has none or asks less than a tenth of it: a price published in the wrong unit
 * would leave the daily cap of Neurons without effect (P7).
 */
function floor(price: number | null, dated: number | undefined): number {
  if (dated === undefined) return price as number;
  return price === null || price < dated / 10 ? dated : price;
}

/**
 * One item of the catalog as an entry, or null when it is not a text model,
 * its id is malformed or, for a model off the fixed list, it has no price (the
 * daily cap can only be checked for a call whose cost can be estimated, P7).
 * The fixed models keep the dated table's numbers for what the catalog leaves out.
 */
export function readItem(raw: unknown): Entry | null {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { name, task, properties } = parsed.data;
  if (!isCatalogModelId(name) || (task && task.name !== "Text Generation")) return null;
  const property = (id: string) => properties.find((p) => p.property_id === id)?.value;
  const prices = priceSchema.safeParse(property("price"));
  const input = prices.success ? rate(prices.data, "input") : null;
  const output = prices.success ? rate(prices.data, "output") : null;
  const leaves = property("planned_deprecation_date");
  const fixed = isChatModel(name) ? CHAT_MODELS[name] : null;
  const context = wholeNumber(property("context_window")) ?? fixed?.context ?? 0;
  if (!fixed && (input === null || output === null)) return null;
  return {
    id: name,
    context,
    input: floor(input, fixed?.input),
    output: floor(output, fixed?.output),
    tools: fixed !== null || property("function_calling") === "true" || property("function_calling") === true,
    reasoning: property("reasoning") === "true" || property("reasoning") === true,
    leavesOn: typeof leaves === "string" && /^\d{4}-\d{2}-\d{2}$/.test(leaves) ? leaves : null,
    priceAt: null,
  };
}

/**
 * A new model fit for the chat: tool calling and a window wide enough for the
 * prompt and the answer. One that reasons before answering is left out: its
 * thinking is billed and fills the window, and the switch to turn it off is
 * known only for the fixed list's models (THINKING_MODELS in workers-ai.ts).
 */
const fit = (entry: Entry) => entry.tools && !entry.reasoning && entry.context >= L.minContext;

/** A price moved by more than 1%: the dated table was rounded on its own, so a smaller gap is no change. */
const moved = (a: number, b: number) => Math.abs(a - b) > Math.max(a, b) * 0.01;

/**
 * Rejects after `ms`: the catalog call never holds the alarm (rule P5). The
 * binding's `models` takes no signal, so the call itself is left to end on its
 * own; the timer is cleared as soon as either side settles.
 */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("model catalog timed out")), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * The catalog of models (PR S21, P24): checked once a day in the shared alarm
 * and on "Conferir agora". A new model is offered and joins the list only when
 * the owner adds it; a model in use that leaves is replaced on its day by the
 * default (never by a paid model, never by one the owner didn't put on the
 * list), with a notice. Prices from the catalog replace the dated table's in
 * the estimates.
 */
export class ModelCatalogService {
  readonly #clock: () => number;

  constructor(private readonly deps: ModelCatalogDeps) {
    this.#clock = deps.clock ?? Date.now;
    this.applyRates(this.read());
  }

  /** False without a catalog to read (no AI binding): nothing is checked or scheduled. */
  available(): boolean {
    return this.deps.source() !== null;
  }

  view(): ModelCatalog {
    const state = this.read();
    const now = this.#clock();
    const today = day(now);
    const inUse = new Set<string>([this.deps.settings.field("aiModel"), this.deps.settings.field("aiFallbackModel")]);
    const model = (entry: Pick<Entry, "id" | "context" | "input" | "output">): CatalogModel => ({
      id: entry.id,
      label: catalogLabel(entry.id),
      context: entry.context,
      input: Math.round(entry.input),
      output: Math.round(entry.output),
      fixed: FIXED.includes(entry.id),
    });
    const onList = (entry: Entry) => FIXED.includes(entry.id) || state.listed.includes(entry.id);
    const notices: CatalogNotice[] = [];
    for (const entry of state.models) {
      const gone = entry.leavesOn !== null && entry.leavesOn <= today;
      if (!onList(entry)) {
        if (fit(entry) && !gone) notices.push({ kind: "new", model: model(entry), on: null, inUse: false });
        continue;
      }
      if (entry.leavesOn !== null && !gone) notices.push({ kind: "leaving", model: model(entry), on: entry.leavesOn, inUse: inUse.has(entry.id) });
      if (entry.priceAt !== null && !gone && now - Date.parse(entry.priceAt) < L.priceNoticeMs) notices.push({ kind: "price", model: model(entry), on: null, inUse: inUse.has(entry.id) });
    }
    return {
      available: this.available(),
      checkedAt: state.checkedAt,
      failed: state.failed,
      listed: [
        // The fixed list, with the catalog's last numbers once it was read; one that left is no longer offered.
        ...CHAT_MODEL_IDS.filter((id) => !state.missing.includes(id))
          .map((id) => state.models.find((entry) => entry.id === id) ?? { id, ...CHAT_MODELS[id], leavesOn: null })
          .filter((entry) => !this.out(entry, today)),
        ...state.models.filter((entry) => state.listed.includes(entry.id) && !this.out(entry, today)),
      ].map(model),
      notices,
    };
  }

  /**
   * Whether the settings may name this model: a paid one (its key is checked
   * elsewhere), one of the fixed list that hasn't left, or one the owner put
   * on the list that is still in the catalog.
   */
  usable(model: string): boolean {
    if (model === NO_FALLBACK_MODEL || isPaidModel(model)) return true;
    const state = this.read();
    const today = day(this.#clock());
    const entry = state.models.find((e) => e.id === model);
    if (entry && this.out(entry, today)) return false;
    if (FIXED.includes(model)) return !state.missing.includes(model);
    return entry !== undefined && state.listed.includes(model);
  }

  /** When the alarm should come back: the next check, or the day a model in use leaves. Null without a catalog. */
  nextDue(): string | null {
    return this.dueOf(this.read());
  }

  private dueOf(state: State): string | null {
    if (!this.available()) return null;
    // The first check at the next 06:00 UTC (03:00 in Brasília), like the daily ones after it: never at install.
    const times = [state.nextAt ?? firstCheck(this.#clock())];
    const inUse: string[] = [this.deps.settings.field("aiModel"), this.deps.settings.field("aiFallbackModel")];
    for (const entry of state.models) {
      if (entry.leavesOn !== null && inUse.includes(entry.id) && (state.enforcedOn === null || entry.leavesOn > state.enforcedOn)) {
        times.push(`${entry.leavesOn}T00:00:00.000Z`);
      }
    }
    return times.sort()[0] ?? null;
  }

  /** The alarm's part: the day's check when due, or the replacement of a model leaving today. True when it ran. */
  async tick(): Promise<boolean> {
    const due = this.nextDue();
    const now = this.#clock();
    if (due === null || Date.parse(due) > now) return false;
    const state = this.read();
    if (Date.parse(state.nextAt ?? firstCheck(now)) > now) {
      this.enforce(state, day(now));
      this.save(state);
      return true;
    }
    // One call of the wake's count; without room it waits for the next wake.
    if (!(currentWake()?.take(1) ?? true)) return false;
    await this.check();
    return true;
  }

  /** "Conferir agora": at most once a minute, like the contacts' "Sincronizar agora". */
  async checkNow(): Promise<ModelCatalog> {
    if (!this.available()) throw new AppError("NOT_CONFIGURED");
    const state = this.read();
    const now = this.#clock();
    if (state.checkNowAt !== null && state.checkNowAt <= now && now - state.checkNowAt < L.checkNowEveryMs) {
      const seconds = Math.max(1, Math.ceil((state.checkNowAt + L.checkNowEveryMs - now) / 1_000));
      throw new AppError("RATE_LIMITED", "error.modelCatalogSoon", { retryAfter: seconds });
    }
    // Saved before the call: a second tap while the catalog answers is already refused.
    state.checkNowAt = now;
    this.save(state);
    const before = this.dueOf(state);
    await this.check();
    // Only when the catalog's next time came earlier (a leaving day found now): the alarm already covers a later one.
    const after = this.nextDue();
    if (after !== null && (before === null || after < before)) await this.deps.rearm?.();
    return this.view();
  }

  /** "Pôr na lista": only a model of the last check that takes tools, has the window and isn't leaving. */
  add(id: string): ModelCatalog {
    const state = this.read();
    const entry = state.models.find((e) => e.id === id);
    if (!entry || FIXED.includes(id)) throw new AppError("NOT_FOUND");
    if (!fit(entry) || this.out(entry, day(this.#clock()))) throw new AppError("VALIDATION_FAILED", "error.modelCatalogUnfit", { fields: ["id"] });
    if (!state.listed.includes(id)) {
      state.listed.push(id);
      this.save(state);
      this.applyRates(state);
    }
    return this.view();
  }

  /** One check at a time: the alarm and "Conferir agora" landing together share the same call. */
  #running: Promise<void> | null = null;

  private check(): Promise<void> {
    this.#running ??= this.fetchAndMerge().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /** The catalog's pages, read page by page up to L.pages: complete only when a page comes back short. */
  private async fetch(): Promise<{ items: unknown[]; complete: boolean; failed: boolean }> {
    const source = this.deps.source() as (page: number) => Promise<unknown>;
    const items: unknown[] = [];
    for (let page = 1; page <= L.pages; page++) {
      // The first page's place was taken by the caller; each further one takes its own.
      if (page > 1 && !(currentWake()?.take(1) ?? true)) break;
      let answer: unknown;
      try {
        answer = await withDeadline(source(page), this.deps.timeoutMs ?? L.timeoutMs);
      } catch (error) {
        log("warn", "model_catalog_failed", { error });
        return { items, complete: false, failed: true };
      }
      if (!Array.isArray(answer)) break;
      items.push(...answer.slice(0, L.perPage));
      if (answer.length < L.perPage) return { items, complete: true, failed: false };
    }
    return { items, complete: false, failed: false };
  }

  private async fetchAndMerge(): Promise<void> {
    const { items, complete, failed } = await this.fetch();
    // Read after the call: an "Pôr na lista" or a settings change that came in while it ran is kept.
    const state = this.read();
    const now = this.#clock();
    const found = new Map<string, Entry>();
    for (const raw of items) {
      const entry = readItem(raw);
      if (entry && !found.has(entry.id)) found.set(entry.id, entry);
    }
    // An answer without any model already known (an error page, a change of shape) is no catalog: nothing is removed.
    if (![...FIXED, ...state.listed].some((id) => found.has(id))) {
      if (!failed) log("warn", "model_catalog_failed", { code: "SERVICE_UNAVAILABLE" });
      state.failed = true;
      state.failures += 1;
      // 1, 2, 4… hours, never past the next daily check.
      const wait = new Date(now + L.retryMs * 2 ** Math.min(state.failures - 1, 5)).toISOString();
      const daily = firstCheck(now + 1);
      state.nextAt = wait < daily ? wait : daily;
      this.save(state);
      return;
    }
    // Only complete answers say a model left, and only two in a row: one model hidden for a day stays.
    const known = [...FIXED, ...state.listed];
    const absent = complete ? known.filter((id) => !found.has(id)) : state.absent.filter((id) => !found.has(id));
    const gone = complete ? absent.filter((id) => state.absent.includes(id)) : [];
    const before = new Map(state.models.map((entry) => [entry.id, entry]));
    const kept: Entry[] = [];
    for (const entry of found.values()) {
      const mine = FIXED.includes(entry.id) || state.listed.includes(entry.id);
      if (!mine && !fit(entry)) continue;
      const old = before.get(entry.id) ?? (isChatModel(entry.id) ? { ...CHAT_MODELS[entry.id], priceAt: null } : null);
      const changed = old !== null && (moved(old.input, entry.input) || moved(old.output, entry.output));
      kept.push({ ...entry, priceAt: changed ? new Date(now).toISOString() : (old?.priceAt ?? null) });
    }
    // A model of the owner's list missing from this answer keeps its last numbers until it is gone.
    for (const id of state.listed) {
      const old = before.get(id);
      if (!found.has(id) && !gone.includes(id) && old) kept.push(old);
    }
    // The fixed list and the owner's list first, so the cap never drops one of theirs.
    const rank = (id: string) => Number(!(FIXED.includes(id) || state.listed.includes(id)));
    kept.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
    state.models = kept.slice(0, L.maxModels);
    state.absent = absent;
    if (complete) state.missing = FIXED.filter((id) => gone.includes(id) || (state.missing.includes(id) && absent.includes(id)));
    state.failures = 0;
    state.checkedAt = new Date(now).toISOString();
    // Tomorrow's, even for a check that ran at 06:00 sharp.
    state.nextAt = firstCheck(now + 1);
    state.failed = false;
    this.enforce(state, day(now), gone);
    state.listed = state.listed.filter((id) => !gone.includes(id) && state.models.some((e) => e.id === id));
    this.save(state);
    this.applyRates(state);
  }

  /**
   * Tells the owner of a leaving date of a model in use (once per date), and
   * on its day replaces it: the chat model by the default, the fallback by the
   * default fallback, or by none.
   */
  private enforce(state: State, today: string, gone: string[] = []): void {
    const isOut = (id: string) => gone.includes(id) || state.missing.includes(id) || state.models.some((e) => e.id === id && this.out(e, today));
    const usable = (id: string) => !isOut(id) && (FIXED.includes(id) || state.listed.includes(id));
    const model = this.deps.settings.field("aiModel");
    const fallback = this.deps.settings.field("aiFallbackModel");
    const patch: SettingsUpdate = {};
    let chat: string = model;
    if (!isPaidModel(model) && isOut(model)) {
      chat = usable(DEFAULT_CHAT_MODEL) ? DEFAULT_CHAT_MODEL : (FIXED.find(usable) ?? DEFAULT_CHAT_MODEL);
      if (chat !== model) patch.aiModel = chat as ChosenModel;
    }
    // A fallback out of the catalog, or one the chat model became (the same model twice is no fallback).
    if (fallback !== NO_FALLBACK_MODEL && !isPaidModel(fallback) && (isOut(fallback) || (patch.aiModel !== undefined && fallback === chat))) {
      patch.aiFallbackModel = usable(DEFAULT_FALLBACK_MODEL) && DEFAULT_FALLBACK_MODEL !== chat ? DEFAULT_FALLBACK_MODEL : NO_FALLBACK_MODEL;
    }
    if (Object.keys(patch).length > 0) {
      this.deps.settings.update(patch);
      log("info", "model_switched");
      if (patch.aiModel) this.deps.notify({ kind: "ai.modelSwitched", from: catalogLabel(model), to: catalogLabel(patch.aiModel) });
      if (patch.aiFallbackModel === NO_FALLBACK_MODEL) this.deps.notify({ kind: "ai.fallbackOff", from: catalogLabel(fallback) });
      else if (patch.aiFallbackModel) this.deps.notify({ kind: "ai.modelSwitched", from: catalogLabel(fallback), to: catalogLabel(patch.aiFallbackModel) });
    }
    state.enforcedOn = today;
    // The leaving dates of what is in use now, each told once.
    const now = new Set<string>([this.deps.settings.field("aiModel"), this.deps.settings.field("aiFallbackModel")]);
    for (const entry of state.models) {
      const key = `${entry.id}|${entry.leavesOn}`;
      if (entry.leavesOn === null || entry.leavesOn <= today || !now.has(entry.id) || state.warned.includes(key)) continue;
      state.warned = [...state.warned, key].slice(-L.maxModels);
      this.deps.notify({ kind: "ai.modelLeaving", model: catalogLabel(entry.id), on: this.date(entry.leavesOn) });
    }
  }

  /** Gone: its leaving day came. */
  private out(entry: Pick<Entry, "leavesOn">, today: string): boolean {
    return entry.leavesOn !== null && entry.leavesOn <= today;
  }

  /** A leaving day as the owner reads it (the catalog's days are UTC). */
  private date(on: string): string {
    return new Intl.DateTimeFormat(this.deps.locale(), { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${on}T12:00:00Z`));
  }

  /** The rates of the models on the list: the estimates use the catalog's last price. */
  private applyRates(state: State): void {
    const rates = new Map<string, ModelRate>();
    for (const entry of state.models) {
      if (FIXED.includes(entry.id) || state.listed.includes(entry.id)) rates.set(entry.id, { input: entry.input, output: entry.output, context: entry.context });
    }
    setCatalogRates(rates);
  }

  /** The stored state, or the first one when there is none or it no longer reads (a hand-edited row). */
  private read(): State {
    const raw = this.deps.state.get<unknown>("model_catalog");
    let value: unknown = null;
    try {
      value = typeof raw === "string" ? JSON.parse(raw) : null;
    } catch {
      value = null;
    }
    const parsed = stateSchema.safeParse(value);
    return parsed.success ? parsed.data : structuredClone(INITIAL);
  }

  /** Written only when something changed (rule P4). */
  private save(state: State): void {
    const text = JSON.stringify(state);
    if (this.deps.state.get<unknown>("model_catalog") === text) return;
    this.deps.state.set("model_catalog", text);
  }
}
