import {
  type AgentCallSettings,
  HOME_SUGGESTION_IDS,
  HOME_SUGGESTION_NAME_MAX,
  HOME_SUGGESTIONS_SHOWN,
  type HomeSuggestion,
  type HomeSuggestionId,
  type HomeSuggestions,
  homeSuggestionOrderSchema,
  localDayBounds,
  zonedParts,
} from "@zuri/shared";
import { dataLine, neutralize } from "../agent/data.ts";
import type { Database } from "../db/database.ts";
import type { InternalState } from "../db/internal-state.ts";
import { log } from "../log.ts";
import { runSpecialist, type SpecialistAi } from "../specialists/contract.ts";
import { HOME_ORDER_SPECIALIST } from "../specialists/home-order.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A tap counts once a minute per kind: a double tap never writes twice (rule P4). */
const TAP_GAP_MS = MINUTE;
/** Each 14 days without a tap takes one tap back. */
const FADE_MS = 14 * DAY;
/** Taps that still move a kind up: six taps lift it three places of base priority. */
const USE_CAP = 6;
/** The bill's reminder is half an hour before it is due, and only when that is still ahead. */
const BILL_LEAD_MS = 30 * MINUTE;
/** Tasks due later today read for a bill: a glance, never the whole day. */
const BILL_SCAN = 20;
/** The AI's counts stop here. */
const COUNT_CAP = 20;
/** Most Neurons the daily ordering may take (a short prompt, a few ids back). */
export const HOME_ORDER_NEURONS = 60;
/** The ordering waits this long for the model, then the rules alone go on. */
const ORDER_DEADLINE_MS = 20_000;

/** Lower comes first (plan, section 6). */
const BASE: Record<HomeSuggestionId, number> = { late: 1, bill: 2, review: 2, week: 3, today: 4, rest: 4, tomorrow: 4 };
/** A bill is a task whose title starts with the verb, in either language. */
const BILL = /^\s*(?:pagar|pay)\s+(\S.*)$/iu;

type Uses = Partial<Record<HomeSuggestionId, { n: number; at: number }>>;
interface DailyOrder {
  day: string;
  order: HomeSuggestionId[] | null;
}

export interface HomeSuggestionDeps {
  db: Database;
  state: InternalState;
  timeZone(): string;
  clock?: () => number;
  /** The review waiting for the owner, lowest stars first (null when none or the module is off). */
  review(): { name: string } | null;
  /** The daily ordering, or null when it may not run now (no room in the day's Neurons, lockdown, a paid model). */
  ai(): SpecialistAi | null;
  settings(): AgentCallSettings;
  /** Keeps the object awake while the ordering runs after the answer went out (rule P5). */
  background(work: () => Promise<void>): void;
}

/**
 * The home page's suggestions (PR S22). Fixed rules over the owner's day pick
 * the kinds that fit now; taps and, once a day, the AI only change the order.
 * Nothing here writes a sentence: the interface owns every text.
 */
export class HomeSuggestionService {
  readonly #clock: () => number;

  constructor(private readonly deps: HomeSuggestionDeps) {
    this.#clock = deps.clock ?? Date.now;
  }

  /** Up to three suggestions for now. Two indexed reads and, once a day, the ordering in the background. */
  list(): HomeSuggestions {
    const nowMs = this.#clock();
    const zone = this.deps.timeZone();
    const now = new Date(nowMs);
    const candidates = this.candidates(now, zone);
    const uses = this.uses();
    const daily = this.daily(now, zone, uses);
    const score = (id: HomeSuggestionId) => {
      const use = uses[id];
      const taps = use ? Math.max(0, Math.min(USE_CAP, use.n) - Math.floor((nowMs - use.at) / FADE_MS)) : 0;
      const place = daily ? daily.indexOf(id) : -1;
      // Taps lift up to three places; the AI's first pick half a place, its others less.
      return BASE[id] - taps / 2 - (place < 0 ? 0 : (HOME_SUGGESTION_IDS.length - place) / (2 * HOME_SUGGESTION_IDS.length));
    };
    const ranked = [...candidates].sort((a, b) => score(a.id) - score(b.id) || HOME_SUGGESTION_IDS.indexOf(a.id) - HOME_SUGGESTION_IDS.indexOf(b.id));
    return { suggestions: ranked.slice(0, HOME_SUGGESTIONS_SHOWN) };
  }

  /** A tap on a suggestion: one more for its kind (never its text), at most once a minute per kind. */
  used(id: HomeSuggestionId): void {
    const nowMs = this.#clock();
    const uses = this.uses();
    const last = uses[id];
    if (last && nowMs - last.at < TAP_GAP_MS) return;
    // The fade is paid when the kind is used again, so the count never grows back old taps.
    const kept = last ? Math.max(0, Math.min(USE_CAP, last.n) - Math.floor((nowMs - last.at) / FADE_MS)) : 0;
    uses[id] = { n: Math.min(USE_CAP, kept + 1), at: nowMs };
    this.deps.state.set("home_suggestion_uses", JSON.stringify(uses));
  }

  /** What fits the owner's day now, by fixed rules (plan, section 6). */
  private candidates(now: Date, zone: string): HomeSuggestion[] {
    const nowIso = now.toISOString();
    const { end } = localDayBounds(zone, now);
    const local = zonedParts(now, zone);
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    const out: HomeSuggestion[] = [];
    const late = this.deps.db.one(`SELECT 1 AS found FROM zur_tasks WHERE status != 'done' AND due_at < ? LIMIT 1`, nowIso);
    if (late) out.push({ id: "late" });
    const bill = this.bill(now, end, zone);
    if (bill) out.push(bill);
    const review = this.deps.review();
    if (review) out.push(review.name ? { id: "review", name: cut(review.name) } : { id: "review" });
    // Monday, or Sunday evening: the week ahead.
    if (weekday === 1 || (weekday === 0 && local.hour >= 18)) out.push({ id: "week" });
    out.push({ id: local.hour < 12 ? "today" : local.hour < 18 ? "rest" : "tomorrow" });
    return out;
  }

  /** The first bill due later today with its reminder still ahead: "pagar a luz" at 18:00 asks for 17:30. */
  private bill(now: Date, end: string, zone: string): HomeSuggestion | null {
    const rows = this.deps.db.all<{ title: string; due_at: string }>(
      `SELECT title, due_at FROM zur_tasks WHERE status != 'done' AND due_at >= ? AND due_at < ? ORDER BY due_at LIMIT ?`,
      new Date(now.getTime() + BILL_LEAD_MS).toISOString(),
      end,
      BILL_SCAN,
    );
    for (const row of rows) {
      const what = BILL.exec(row.title)?.[1];
      const at = Date.parse(row.due_at) - BILL_LEAD_MS;
      if (!what || !(at > now.getTime())) continue;
      const name = cut(what);
      if (!name) continue;
      const parts = zonedParts(new Date(at), zone);
      return { id: "bill", name, time: `${pad(parts.hour)}:${pad(parts.minute)}` };
    }
    return null;
  }

  private uses(): Uses {
    const raw = this.deps.state.get<string>("home_suggestion_uses");
    const out: Uses = {};
    if (typeof raw !== "string") return out;
    try {
      const value = JSON.parse(raw) as Record<string, { n?: unknown; at?: unknown }>;
      for (const id of HOME_SUGGESTION_IDS) {
        const entry = value[id];
        if (entry && typeof entry.n === "number" && typeof entry.at === "number" && Number.isFinite(entry.n) && Number.isFinite(entry.at)) out[id] = { n: entry.n, at: entry.at };
      }
    } catch {
      // A broken value counts as no taps: the next tap writes a good one.
    }
    return out;
  }

  /**
   * Today's order from the AI, or null. The first read of a new day marks the
   * day before anything else, so a failed or slow call is never tried again
   * that day (rule P7); the order then lands for the next opening.
   */
  private daily(now: Date, zone: string, uses: Uses): HomeSuggestionId[] | null {
    const day = localDay(now, zone);
    const stored = this.storedOrder();
    if (stored?.day === day) return stored.order;
    const ai = this.deps.ai();
    if (!ai) return null;
    this.deps.state.set("home_suggestion_order", JSON.stringify({ day, order: null } satisfies DailyOrder));
    const content = orderInput(now, zone, uses, this.deps.db);
    const settings = this.deps.settings();
    this.deps.background(async () => {
      try {
        const { value } = await runSpecialist(ai, HOME_ORDER_SPECIALIST, content, { settings, maxNeurons: HOME_ORDER_NEURONS, signal: AbortSignal.timeout(ORDER_DEADLINE_MS) });
        if (value?.order.length) this.deps.state.set("home_suggestion_order", JSON.stringify({ day, order: value.order } satisfies DailyOrder));
      } catch (error) {
        log("warn", "home_order_failed", { error });
      }
    });
    return null;
  }

  private storedOrder(): DailyOrder | null {
    const raw = this.deps.state.get<string>("home_suggestion_order");
    if (typeof raw !== "string") return null;
    try {
      const value = JSON.parse(raw) as { day?: unknown; order?: unknown };
      if (typeof value.day !== "string") return null;
      const parsed = value.order === null ? null : homeSuggestionOrderSchema.safeParse({ order: value.order });
      return { day: value.day, order: parsed?.success ? parsed.data.order : null };
    } catch {
      return null;
    }
  }
}

/** The ordering's input: counts and ids only, as `<data>` lines. No title, name or text of the owner's. */
function orderInput(now: Date, zone: string, uses: Uses, db: Database): string {
  const local = zonedParts(now, zone);
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const { end } = localDayBounds(zone, now);
  // Counted up to a cap: "20 or more" orders the chips as well as the exact number, and a long backlog is never walked (rule P2).
  const counts = db.one<{ late: number; today: number }>(
    `SELECT (SELECT count(*) FROM (SELECT 1 FROM zur_tasks WHERE status != 'done' AND due_at < ? LIMIT ${COUNT_CAP})) AS late,
       (SELECT count(*) FROM (SELECT 1 FROM zur_tasks WHERE status != 'done' AND due_at >= ? AND due_at < ? LIMIT ${COUNT_CAP})) AS today`,
    now.toISOString(),
    now.toISOString(),
    end,
  );
  const taps = HOME_SUGGESTION_IDS.map((id) => `${id}=${uses[id]?.n ?? 0}`).join(" ");
  return [
    dataLine("home", "kinds", HOME_SUGGESTION_IDS.join(" ")),
    dataLine("home", "day", `weekday=${weekday} late_tasks=${counts?.late ?? 0} tasks_due_later_today=${counts?.today ?? 0}`),
    dataLine("home", "taps", taps),
  ].join("\n");
}

/** A name for a blank: inert, on one line, cut whole letters at 20. */
function cut(text: string): string {
  return [...neutralize(text)].slice(0, HOME_SUGGESTION_NAME_MAX).join("").trim();
}

const pad = (value: number) => String(value).padStart(2, "0");

function localDay(now: Date, zone: string): string {
  const p = zonedParts(now, zone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
