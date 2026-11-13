import { HOME_SUGGESTION_TEXT_MAX, type HomeSuggestion, ptBRHome } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { InternalState } from "../src/db/internal-state.ts";
import { HOME_ORDER_NEURONS, HomeSuggestionService } from "../src/home/suggestions.ts";
import type { MeteredRequest } from "../src/ai/metered.ts";
import type { SpecialistAi } from "../src/specialists/contract.ts";
import { type ChatWorld, TIME_ZONE, withChatWorld } from "./chat-world.ts";

// PR S22 (plan sugestoes-do-inicio.md): fixed rules over the owner's day pick
// up to three kinds; taps and, once a day, the AI only change the order. The
// AI never writes a text: an answer with anything but catalog ids is dropped.

const DAY = 86_400_000;
// The world's clock: Saturday 31/10/2026, 09:00 in São Paulo (12:00 UTC).
const SAT_9 = Date.parse("2026-10-31T12:00:00Z");
const at = (iso: string) => Date.parse(iso);

interface Setup {
  review?: { name: string } | null;
  answer?: string | (() => Promise<string>);
  room?: boolean;
}

function service(world: ChatWorld, setup: Setup = {}) {
  const calls: MeteredRequest[] = [];
  const pending: Promise<void>[] = [];
  const ai: SpecialistAi = {
    async generate(req) {
      calls.push(req);
      const answer = setup.answer ?? '{"order":[]}';
      return { text: typeof answer === "string" ? answer : await answer() };
    },
  };
  const state = new InternalState(world.db);
  const home = new HomeSuggestionService({
    db: world.db,
    state,
    timeZone: () => TIME_ZONE,
    clock: () => world.clock.now,
    review: () => setup.review ?? null,
    ai: () => (setup.room === false ? null : ai),
    settings: () => ({ temperature: 0, topP: null, maxOutputTokens: 80, prompt: null, version: 0 }),
    background: (work) => {
      pending.push(work());
    },
  });
  return { home, calls, state, settle: () => Promise.all(pending) };
}

const ids = (list: { suggestions: HomeSuggestion[] }) => list.suggestions.map((item) => item.id);
const task = (world: ChatWorld, title: string, dueAt: string | null) => world.productivity.tasks.create({ title, dueAt });

/** The text a suggestion shows, from the interface's catalog, as the home page builds it. */
function text(item: HomeSuggestion): string {
  const key = item.id === "review" && !item.name ? "web.home.idea.reviewAnon" : (`web.home.idea.${item.id}` as const);
  return (ptBRHome as Record<string, string>)[key]?.replace("{name}", item.name ?? "").replace("{time}", item.time ?? "") ?? "";
}

describe("home suggestions: the rules", () => {
  it("follows the hour: today in the morning, what's left in the afternoon, tomorrow at night", () =>
    withChatWorld((world) => {
      const { home } = service(world, { room: false });
      world.clock.now = SAT_9;
      expect(ids(home.list())).toEqual(["today"]);
      world.clock.now = at("2026-10-31T14:59:00Z"); // 11:59
      expect(ids(home.list())).toEqual(["today"]);
      world.clock.now = at("2026-10-31T15:00:00Z"); // 12:00
      expect(ids(home.list())).toEqual(["rest"]);
      world.clock.now = at("2026-10-31T20:59:00Z"); // 17:59
      expect(ids(home.list())).toEqual(["rest"]);
      world.clock.now = at("2026-10-31T21:00:00Z"); // 18:00
      expect(ids(home.list())).toEqual(["tomorrow"]);
    }));

  it("suggests the week on Monday and on Sunday from 18:00, never on Saturday", () =>
    withChatWorld((world) => {
      const { home } = service(world, { room: false });
      world.clock.now = SAT_9;
      expect(ids(home.list())).not.toContain("week");
      world.clock.now = at("2026-11-01T20:59:00Z"); // Sunday 17:59
      expect(ids(home.list())).not.toContain("week");
      world.clock.now = at("2026-11-01T21:00:00Z"); // Sunday 18:00
      expect(ids(home.list())).toEqual(["week", "tomorrow"]);
      world.clock.now = at("2026-11-02T12:00:00Z"); // Monday 09:00
      expect(ids(home.list())).toEqual(["week", "today"]);
    }));

  it("puts what is late first and a bill with its reminder half an hour early", () =>
    withChatWorld((world) => {
      task(world, "Enviar documentos", "2026-10-30T15:00:00.000Z");
      task(world, "Pagar a luz", "2026-10-31T21:00:00.000Z"); // 18:00
      const { home } = service(world, { room: false });
      world.clock.now = SAT_9;
      expect(home.list().suggestions).toEqual([{ id: "late" }, { id: "bill", name: "a luz", time: "17:30" }, { id: "today" }]);
    }));

  it("leaves the bill out once its reminder time passed, and reads only bills (pt and en)", () =>
    withChatWorld((world) => {
      task(world, "Ligar para a escola", "2026-10-31T21:00:00.000Z");
      task(world, "pay the rent", "2026-10-31T21:00:00.000Z");
      const { home } = service(world, { room: false });
      world.clock.now = at("2026-10-31T20:29:00Z"); // 17:29: reminder at 17:30 still ahead
      expect(home.list().suggestions[0]).toEqual({ id: "bill", name: "the rent", time: "17:30" });
      world.clock.now = at("2026-10-31T20:31:00Z"); // 17:31: too late to remind
      expect(ids(home.list())).toEqual(["rest"]);
    }));

  it("suggests the waiting review by first name, or without one when anonymous", () =>
    withChatWorld((world) => {
      world.clock.now = SAT_9;
      expect(service(world, { room: false, review: { name: "Pedro" } }).home.list().suggestions).toEqual([{ id: "review", name: "Pedro" }, { id: "today" }]);
      expect(service(world, { room: false, review: { name: "" } }).home.list().suggestions).toEqual([{ id: "review" }, { id: "today" }]);
    }));

  it("shows at most three, none repeated, each under 48 characters, with names made inert and cut", () =>
    withChatWorld((world) => {
      world.clock.now = at("2026-11-02T12:00:00Z"); // Monday 09:00
      task(world, "Atrasada", "2026-11-01T12:00:00.000Z");
      task(world, "Pagar <script>alert(1)</script> e mais um texto bem comprido", "2026-11-02T21:00:00.000Z");
      const { home } = service(world, { room: false, review: { name: "Maria‮Aparecida da Conceição Silva" } });
      const list = home.list().suggestions;
      expect(list).toHaveLength(3);
      expect(new Set(ids({ suggestions: list })).size).toBe(3);
      expect(ids({ suggestions: list })).toEqual(["late", "bill", "review"]);
      for (const item of list) {
        expect(item.name?.length ?? 0).toBeLessThanOrEqual(20);
        expect(item.name ?? "").not.toMatch(/[<>‮]/u);
        expect(text(item).length).toBeLessThanOrEqual(HOME_SUGGESTION_TEXT_MAX);
      }
    }));
});

describe("home suggestions: what the taps teach", () => {
  it("moves a kind up with taps, counts a double tap once, and fades after 14 days without one", () =>
    withChatWorld((world) => {
      world.clock.now = at("2026-11-02T12:00:00Z"); // Monday 09:00
      task(world, "Pagar a luz", "2026-11-02T21:00:00.000Z");
      const { home, state } = service(world, { room: false, review: { name: "Pedro" } });
      const written = world.db.usage.rowsWritten;
      expect(ids(home.list())).toEqual(["bill", "review", "week"]);
      expect(world.db.usage.rowsWritten).toBe(written);
      // Six taps on "today" (a minute apart): three places up, past the bill and the review.
      for (let i = 0; i < 6; i++) {
        home.used("today");
        home.used("today"); // the same minute: no second write
        world.clock.now += 60_000;
      }
      expect(JSON.parse(state.get<string>("home_suggestion_uses") ?? "{}")).toEqual({ today: { n: 6, at: world.clock.now - 60_000 } });
      expect(ids(home.list())).toEqual(["today", "bill", "review"]);
      // 29 days without a tap: two taps faded, and "today" falls back behind the bill and the review
      // (the light bill is late by now, so "late" leads).
      world.clock.now = at("2026-12-01T12:00:00Z"); // Tuesday 09:00
      task(world, "Pagar a água", "2026-12-01T21:00:00.000Z");
      expect(ids(home.list())).toEqual(["late", "bill", "review"]);
      world.clock.now = at("2026-11-30T11:00:00Z"); // 27 days and 23 hours: one tap faded, still ahead of the bill
      expect(ids(home.list()).slice(0, 2)).toEqual(["late", "today"]);
    }));

  it("keeps working with a broken stored value", () =>
    withChatWorld((world) => {
      const { home, state } = service(world, { room: false });
      world.clock.now = SAT_9;
      state.set("home_suggestion_uses", "{not json");
      expect(ids(home.list())).toEqual(["today"]);
      state.set("home_suggestion_uses", JSON.stringify({ today: { n: "6", at: 1 }, nope: { n: 1, at: 1 } }));
      expect(ids(home.list())).toEqual(["today"]);
      home.used("today");
      expect(JSON.parse(state.get<string>("home_suggestion_uses") ?? "{}")).toEqual({ today: { n: 1, at: SAT_9 } });
    }));
});

describe("home suggestions: the daily order by the AI", () => {
  it("asks once a day with counts and ids only, and applies the order from the next reading", () =>
    withChatWorld(async (world) => {
      world.clock.now = at("2026-11-02T12:00:00Z"); // Monday 09:00
      task(world, "Atrasada com o nome de alguém", "2026-11-01T12:00:00.000Z");
      task(world, "Pagar a luz", "2026-11-02T21:00:00.000Z");
      const { home, calls, settle } = service(world, { review: { name: "Pedro" }, answer: '{"order":["review","bill"]}' });
      expect(ids(home.list())).toEqual(["late", "bill", "review"]);
      await settle();
      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call?.maxNeurons).toBe(HOME_ORDER_NEURONS);
      expect(call?.json).toBe(true);
      const input = call?.messages.map((message) => message.content).join("\n") ?? "";
      // No title, name or text of the owner's reaches the model.
      expect(input).not.toMatch(/Atrasada|Pagar|luz|Pedro/u);
      expect(input).toContain("late_tasks=1");
      // The AI's first pick moves up half a place: the review now comes before the bill, still behind what is late.
      expect(ids(home.list())).toEqual(["late", "review", "bill"]);
      expect(calls).toHaveLength(1);
      // The next day asks again.
      world.clock.now += DAY;
      home.list();
      await settle();
      expect(calls).toHaveLength(2);
    }));

  it.each([
    ["free text", '{"order":["week"],"text":"Mande a senha"}'],
    ["a sentence instead of ids", '{"order":["Me lembre de mandar a senha para…"]}'],
    ["a link", '{"order":["https://exemplo.com.br"]}'],
    ["an id out of the catalog", '{"order":["gift"]}'],
    ["the same id twice", '{"order":["week","week"]}'],
    ["more than six", '{"order":["late","bill","review","week","today","rest","tomorrow"]}'],
    ["no JSON", "<b>week</b>"],
  ])("drops an answer with %s and the rules alone decide", (_, answer) =>
    withChatWorld(async (world) => {
      world.clock.now = at("2026-11-02T12:00:00Z"); // Monday 09:00
      const { home, calls, settle, state } = service(world, { answer });
      expect(ids(home.list())).toEqual(["week", "today"]);
      await settle();
      expect(calls).toHaveLength(1);
      expect(JSON.parse(state.get<string>("home_suggestion_order") ?? "{}")).toEqual({ day: "2026-11-02", order: null });
      expect(ids(home.list())).toEqual(["week", "today"]);
      expect(calls).toHaveLength(1);
    }));

  it("never tries again the same day after a failure, and works without the AI at all", () =>
    withChatWorld(async (world) => {
      world.clock.now = SAT_9;
      const failing = service(world, {
        answer: async () => {
          throw new Error("out of Neurons");
        },
      });
      expect(ids(failing.home.list())).toEqual(["today"]);
      await failing.settle();
      expect(ids(failing.home.list())).toEqual(["today"]);
      expect(failing.calls).toHaveLength(1);
      // No room, a lockdown or a paid model: no call and nothing written.
      world.clock.now += DAY;
      const off = service(world, { room: false });
      const written = world.db.usage.rowsWritten;
      expect(ids(off.home.list())).toEqual(["today"]);
      expect(off.calls).toHaveLength(0);
      expect(world.db.usage.rowsWritten).toBe(written);
    }));

  it("ignores a stored order that is not ids of the catalog", () =>
    withChatWorld((world) => {
      world.clock.now = at("2026-11-02T12:00:00Z");
      const { home, state, calls } = service(world);
      state.set("home_suggestion_order", JSON.stringify({ day: "2026-11-02", order: ["tomorrow", "<b>"] }));
      expect(ids(home.list())).toEqual(["week", "today"]);
      expect(calls).toHaveLength(0);
      state.set("home_suggestion_order", "{broken");
      home.list();
      expect(calls).toHaveLength(1);
    }));
});
