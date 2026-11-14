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

type Notice = { day: string; versions: string };

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
      // One notice for the day, whatever number of events changed; its key names this set of versions.
      expect(notices).toEqual([{ day: "2026-10-31", versions: expect.stringMatching(/^[0-9a-f]{16}$/) }]);
      // The same changes read again give the same key (the alert keeps it for a year: no second notice).
      agenda.apply(after.events, "2026-10-31", "2026-10-31", after.ids, true);
      expect(notices[1]).toEqual(notices[0]);
      // A newer version at Google is a new set: a new key.
      if (edit) edit.etag = '"edit-3"';
      agenda.apply((await read(world)).events, "2026-10-31", "2026-10-31", after.ids, true);
      expect(notices[2]?.versions).not.toBe(notices[0]?.versions);
    }));

  it("E5e: the copy of a closed day keeps the patient's contact and the payment, whatever Google says later", () =>
    withChatWorld(async (world) => {
      await connect(world);
      const props = { zuriCountry: "BR", zuriPhone: "41999990000", zuriEmail: "a@exemplo.com.br", zuriPayment: "unpaid" };
      seed(world, PRIMARY, "visit", "2026-10-31T10:00:00-03:00", "2026-10-31T11:00:00-03:00", { description: "Consulta | Online", extendedProperties: { private: props }, hangoutLink: "https://meet.google.com/abc-defg-hij" });
      const { record: agenda } = record(world);
      await agenda.tick();
      world.clock.now = MIDNIGHT_NOV_1 + 1_000;
      await agenda.tick();

      const visit = (world.googleSim.events.get(PRIMARY) ?? []).find((event) => event.id === "visit");
      if (visit) Object.assign(visit, { etag: '"visit-2"', extendedProperties: { private: { ...props, zuriPhone: "41988880000", zuriPayment: "paid" } } });
      const after = await read(world);
      const [shown] = agenda.apply(after.events, "2026-10-31", "2026-10-31", after.ids, true);
      expect(shown).toMatchObject({ id: "visit", phone: "41999990000", payment: "unpaid", email: "a@exemplo.com.br", meet: "https://meet.google.com/abc-defg-hij", changedAtGoogle: "changed" });
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

  it("SEC-E5b-02: a listing of some hours of a closed day never calls the copies outside it deleted", () =>
    withChatWorld(async (world) => {
      await connect(world);
      seed(world, PRIMARY, "morning", "2026-10-31T09:00:00-03:00", "2026-10-31T10:00:00-03:00");
      seed(world, PRIMARY, "afternoon", "2026-10-31T15:00:00-03:00", "2026-10-31T16:00:00-03:00");
      const { record: agenda, notices } = record(world);
      await agenda.tick();
      world.clock.now = MIDNIGHT_NOV_1 + 1_000;
      await agenda.tick();
      const window = { from: new Date("2026-10-31T17:00:00Z"), to: new Date("2026-10-31T19:00:00Z") };
      const got = await world.google.events(world.google.readable(), window.from, window.to, new GoogleMeter(12), { timeZone: TIME_ZONE });
      const shown = agenda.apply(got.events, "2026-10-31", "2026-10-31", [PRIMARY, READER], true, window);
      expect(shown.map((event) => [event.id, event.changedAtGoogle])).toEqual([["afternoon", undefined]]);
      expect(notices).toEqual([]);
    }));

  it("SEC-E5b-03: a day of today or later in the record (a forged backup) neither stops the closing nor replaces Google's events", () =>
    withChatWorld(async (world) => {
      await connect(world);
      seed(world, PRIMARY, "real", "2026-11-05T10:00:00-03:00", "2026-11-05T11:00:00-03:00");
      const { record: agenda, notices } = record(world);
      await agenda.tick();
      world.db.run(`INSERT INTO zur_agenda_closed_days (day, closed_at, events) VALUES ('2099-12-31', 't', 0), ('2026-11-05', 't', 1)`);
      world.db.run(`INSERT INTO zur_agenda_record (day, calendar_id, event_id, etag, data) VALUES ('2026-11-05', ?, 'fake', '"1"', ?)`, PRIMARY, JSON.stringify({ id: "fake", calendarId: PRIMARY, title: "Inventado", start: "2026-11-05T13:00:00.000Z", end: "2026-11-05T14:00:00.000Z", allDay: false, location: "", description: "", etag: '"1"', recurring: false, guests: 0, colorId: "", shared: false }));
      expect(agenda.last()).toBeNull();
      world.clock.now = MIDNIGHT_NOV_1 + 1_000;
      expect(await agenda.tick()).toBe(true);
      expect(agenda.last()?.day).toBe("2026-10-31");
      const got = await world.google.events(world.google.readable(), new Date("2026-11-05T03:00:00Z"), new Date("2026-11-06T03:00:00Z"), new GoogleMeter(12), { timeZone: TIME_ZONE });
      expect(agenda.apply(got.events, "2026-11-05", "2026-11-05", [PRIMARY], true).map((event) => [event.id, event.changedAtGoogle])).toEqual([["real", undefined]]);
      expect(notices).toEqual([]);
    }));

  it("passes the open day of a mixed range as Google gives it and drops a copy it cannot read", () =>
    withChatWorld(async (world) => {
      await connect(world);
      seed(world, PRIMARY, "kept", "2026-10-31T10:00:00-03:00", "2026-10-31T11:00:00-03:00");
      seed(world, PRIMARY, "broken", "2026-10-31T14:00:00-03:00", "2026-10-31T15:00:00-03:00");
      seed(world, PRIMARY, "gone", "2026-10-31T16:00:00-03:00", "2026-10-31T17:00:00-03:00");
      const { record: agenda, notices } = record(world);
      await agenda.tick();
      world.clock.now = MIDNIGHT_NOV_1 + 1_000;
      await agenda.tick();
      world.db.run(`UPDATE zur_agenda_record SET data = '{not json' WHERE event_id IN ('broken', 'gone')`);
      world.googleSim.events.set(PRIMARY, (world.googleSim.events.get(PRIMARY) ?? []).filter((event) => event.id !== "gone"));
      seed(world, PRIMARY, "tomorrow", "2026-11-01T10:00:00-03:00", "2026-11-01T11:00:00-03:00");
      const got = await world.google.events(world.google.readable(), new Date("2026-10-31T03:00:00Z"), new Date("2026-11-02T03:00:00Z"), new GoogleMeter(12), { timeZone: TIME_ZONE });
      const shown = agenda.apply(got.events, "2026-10-31", "2026-11-01", [PRIMARY], true);
      expect(shown.map((event) => [event.id, event.changedAtGoogle])).toEqual([
        ["kept", undefined],
        ["tomorrow", undefined],
      ]);
      expect(notices).toEqual([]);
    }));

  it("keeps the copy of each closed day of an event moved at Google between closed days, and marks the old one deleted", () =>
    withChatWorld(async (world) => {
      await connect(world);
      const { record: agenda, notices } = record(world);
      const copy = (day: string) => JSON.stringify({ id: "x", calendarId: PRIMARY, title: "Ana", start: `${day}T13:00:00.000Z`, end: `${day}T14:00:00.000Z`, allDay: false, location: "", description: "", etag: `"${day}"`, recurring: false, guests: 0, colorId: "", shared: false });
      for (const day of ["2026-10-28", "2026-10-29"]) {
        world.db.run(`INSERT INTO zur_agenda_closed_days (day, closed_at, events) VALUES (?, 't', 1)`, day);
        world.db.run(`INSERT INTO zur_agenda_record (day, calendar_id, event_id, etag, data) VALUES (?, ?, 'x', ?, ?)`, day, PRIMARY, `"${day}"`, copy(day));
      }
      // Google has it on the 29th now, as the 29th's copy.
      seed(world, PRIMARY, "x", "2026-10-29T10:00:00-03:00", "2026-10-29T11:00:00-03:00", { etag: '"2026-10-29"' });
      const got = await world.google.events(world.google.readable(), new Date("2026-10-28T03:00:00Z"), new Date("2026-10-30T03:00:00Z"), new GoogleMeter(12), { timeZone: TIME_ZONE });
      const shown = agenda.apply(got.events, "2026-10-28", "2026-10-29", [PRIMARY], true);
      expect(shown.map((event) => [event.start.slice(0, 10), event.changedAtGoogle])).toEqual([
        ["2026-10-28", "deleted"],
        ["2026-10-29", undefined],
      ]);
      expect(notices.map((notice) => notice.day)).toEqual(["2026-10-28"]);
    }));
});
