import { describe, expect, it } from "vitest";
import { InternalState } from "../src/db/internal-state.ts";
import type { DevEvent } from "../src/google/dev-google.ts";
import { AgendaRecord, RECORD_CATCH_UP_DAYS } from "../src/google/record.ts";
import { type GoogleCalendar, GoogleMeter } from "../src/google/service.ts";
import { type ChatWorld, TIME_ZONE, withChatWorld } from "./chat-world.ts";

// E5b (plan agenda-registro-do-dia.md): at the owner's 0:00 the Zuri copies the
// day that ended from the calendars it may change, and the Agenda shows that
// copy from then on, marking what changed at Google afterwards.

const PRIMARY = "dono@exemplo.com.br";
const READER = "consultorio@exemplo.com.br";
// The world's clock starts on Saturday 31/10/2026, 09:00 in São Paulo.
const MIDNIGHT_NOV_1 = Date.parse("2026-11-01T03:00:00Z");

async function connect(world: ChatWorld): Promise<void> {
  const url = new URL(await world.google.begin("sessao"));
  await world.google.finish({ state: url.searchParams.get("state") ?? "", code: `dev.${url.searchParams.get("code_challenge") ?? ""}` }, "sessao");
  await world.google.setMode(PRIMARY, "write");
  await world.google.setMode(READER, "read");
}

function seed(world: ChatWorld, calendarId: string, id: string, start: string, end: string, extra: Partial<DevEvent> = {}): void {
  const list = world.googleSim.events.get(calendarId) ?? [];
  list.push({ id, etag: `"${id}-1"`, summary: id, start: { dateTime: start }, end: { dateTime: end }, ...extra });
  world.googleSim.events.set(calendarId, list);
}

type Notice = { day: string; calendarId: string; eventId: string; etag: string };

function record(world: ChatWorld, google: GoogleCalendar = world.google): { record: AgendaRecord; notices: Notice[]; state: InternalState } {
  const notices: Notice[] = [];
  const state = new InternalState(world.db);
  return { record: new AgendaRecord({ db: world.db, state, google, timeZone: () => TIME_ZONE, notify: (notice) => notices.push(notice) }), notices, state };
}

/** What the Agenda reads at Google for 31/10, before the record replaces it. */
async function read(world: ChatWorld) {
  const calendars = world.google.readable();
  const got = await world.google.events(calendars, new Date("2026-10-31T03:00:00Z"), new Date("2026-11-01T03:00:00Z"), new GoogleMeter(12), { timeZone: TIME_ZONE });
  return { events: got.events, ids: calendars.map((calendar) => calendar.id) };
}

describe("agenda record: closing the day", () => {
  it("only marks today on the first run, then closes yesterday at the owner's 0:00 with the writable calendars only", () =>
    withChatWorld(async (world) => {
      await connect(world);
      seed(world, PRIMARY, "a1", "2026-10-31T10:00:00-03:00", "2026-10-31T11:00:00-03:00");
      seed(world, READER, "r1", "2026-10-31T14:00:00-03:00", "2026-10-31T15:00:00-03:00");
      seed(world, PRIMARY, "n1", "2026-11-01T10:00:00-03:00", "2026-11-01T11:00:00-03:00");
      const { record: agenda, state } = record(world);
      expect(agenda.nextDue()).toBe(world.clock.now);
      expect(await agenda.tick()).toBe(true);
      expect(state.get("agenda_record_from")).toBe("2026-10-31");
      expect(await agenda.tick()).toBe(false);
      expect(agenda.last()).toBeNull();
      expect(agenda.nextDue()).toBe(MIDNIGHT_NOV_1);

      world.clock.now = MIDNIGHT_NOV_1 + 1_000;
      expect(agenda.nextDue()).toBe(world.clock.now);
      expect(await agenda.tick()).toBe(true);
      expect(agenda.last()).toEqual({ day: "2026-10-31", closedAt: new Date(world.clock.now).toISOString(), events: 1 });
      const rows = world.db.all<{ calendar_id: string; event_id: string }>(`SELECT calendar_id, event_id FROM zur_agenda_record`);
      expect(rows).toEqual([{ calendar_id: PRIMARY, event_id: "a1" }]);
      expect(await agenda.tick()).toBe(false);
      expect(agenda.nextDue()).toBe(Date.parse("2026-11-02T03:00:00Z"));
    }));

  it("closes an empty day too, and nothing at all without Google", () =>
    withChatWorld(async (world) => {
      const { record: agenda } = record(world);
      expect(agenda.nextDue()).toBeNull();
      expect(await agenda.tick()).toBe(false);
      await connect(world);
      await agenda.tick();
      world.clock.now = MIDNIGHT_NOV_1 + 1_000;
      expect(await agenda.tick()).toBe(true);
      expect(agenda.last()?.events).toBe(0);
    }));

  it("catches up one missed day per wake, oldest first, and never further back than a week", () =>
    withChatWorld(async (world) => {
      await connect(world);
      const { record: agenda, state } = record(world);
      state.set("agenda_record_from", "2026-10-01");
      const closed = () => world.db.all<{ day: string }>(`SELECT day FROM zur_agenda_closed_days ORDER BY day`).map((row) => row.day);
      expect(await agenda.tick()).toBe(true);
      expect(closed()).toEqual([`2026-10-${31 - RECORD_CATCH_UP_DAYS}`]);
      for (let n = 0; n < RECORD_CATCH_UP_DAYS + 2; n++) await agenda.tick();
      expect(closed()).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    }));

  it("closes nothing on a partial or failed reading and waits 15 minutes before trying again", () =>
    withChatWorld(async (world) => {
      await connect(world);
      let outcome: "partial" | "skipped" | "throw" = "partial";
      const google = {
        usable: () => true,
        now: () => new Date(world.clock.now),
        writable: () => world.google.writable(),
        events: async () => {
          if (outcome === "throw") throw new Error("down");
          return { events: [], more: outcome === "partial", skipped: outcome === "skipped" ? [PRIMARY] : [] };
        },
      } as unknown as GoogleCalendar;
      const { record: agenda, state } = record(world, google);
      await agenda.tick();
      world.clock.now = MIDNIGHT_NOV_1 + 1_000;
      for (const next of ["partial", "skipped", "throw"] as const) {
        outcome = next;
        expect(await agenda.tick()).toBe(true);
        expect(agenda.last()).toBeNull();
        expect(state.get("agenda_record_retry_at")).toBe(world.clock.now + 15 * 60_000);
        expect(agenda.nextDue()).toBe(world.clock.now + 15 * 60_000);
        expect(await agenda.tick()).toBe(false);
        world.clock.now += 15 * 60_000;
      }
    }));
});

describe("agenda record: the copy on the Agenda", () => {
  it("shows the copy of a closed day and marks what changed, was deleted or was added at Google", () =>
    withChatWorld(async (world) => {
      await connect(world);
      seed(world, PRIMARY, "keep", "2026-10-31T10:00:00-03:00", "2026-10-31T11:00:00-03:00");
      seed(world, PRIMARY, "edit", "2026-10-31T11:00:00-03:00", "2026-10-31T12:00:00-03:00");
      seed(world, PRIMARY, "gone", "2026-10-31T13:00:00-03:00", "2026-10-31T14:00:00-03:00");
      const { record: agenda, notices } = record(world);
      await agenda.tick();
      world.clock.now = MIDNIGHT_NOV_1 + 1_000;
      await agenda.tick();

      // Untouched at Google: the copy, without a mark nor a notice.
      const before = await read(world);
      expect(agenda.apply(before.events, "2026-10-31", "2026-10-31", before.ids, true).map((event) => [event.id, event.changedAtGoogle])).toEqual([
        ["keep", undefined],
        ["edit", undefined],
        ["gone", undefined],
      ]);
      expect(notices).toEqual([]);

      const list = world.googleSim.events.get(PRIMARY) ?? [];
      const edit = list.find((event) => event.id === "edit");
      if (edit) Object.assign(edit, { summary: "Mudado no Google", etag: '"edit-2"' });
      world.googleSim.events.set(PRIMARY, list.filter((event) => event.id !== "gone"));
      seed(world, PRIMARY, "late", "2026-10-31T16:00:00-03:00", "2026-10-31T17:00:00-03:00");
      seed(world, READER, "other", "2026-10-31T09:00:00-03:00", "2026-10-31T09:30:00-03:00");

      const after = await read(world);
      const shown = agenda.apply(after.events, "2026-10-31", "2026-10-31", after.ids, true);
      expect(shown.map((event) => [event.id, event.title, event.changedAtGoogle])).toEqual([
        ["other", "other", undefined],
        ["keep", "keep", undefined],
        ["edit", "edit", "changed"],
        ["gone", "gone", "deleted"],
        ["late", "late", "added"],
      ]);
      expect(notices.map((notice) => `${notice.eventId} ${notice.etag}`)).toEqual(['edit "edit-2"', 'late "late-1"', "gone deleted"]);
      expect(notices.every((notice) => notice.day === "2026-10-31")).toBe(true);
    }));

  it("never calls an event deleted on a partial reading, and leaves open days and other calendars as Google gives them", () =>
    withChatWorld(async (world) => {
      await connect(world);
      seed(world, PRIMARY, "a1", "2026-10-31T10:00:00-03:00", "2026-10-31T11:00:00-03:00");
      const { record: agenda, notices } = record(world);
      await agenda.tick();
      world.clock.now = MIDNIGHT_NOV_1 + 1_000;
      await agenda.tick();
      world.googleSim.events.set(PRIMARY, []);
      seed(world, PRIMARY, "today", "2026-11-01T10:00:00-03:00", "2026-11-01T11:00:00-03:00");
      const shown = agenda.apply([], "2026-10-31", "2026-10-31", [PRIMARY], false);
      expect(shown.map((event) => [event.id, event.changedAtGoogle])).toEqual([["a1", undefined]]);
      expect(agenda.apply([], "2026-10-31", "2026-10-31", [READER], true)).toEqual([]);
      const open = await world.google.events(world.google.readable(), new Date("2026-11-01T03:00:00Z"), new Date("2026-11-02T03:00:00Z"), new GoogleMeter(12), { timeZone: TIME_ZONE });
      expect(agenda.apply(open.events, "2026-11-01", "2026-11-01", [PRIMARY], true)).toBe(open.events);
      expect(notices).toEqual([]);
    }));
});
