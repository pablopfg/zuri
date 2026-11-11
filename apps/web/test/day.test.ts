import type { AgendaEvent, Automation, Task } from "@zuri/shared";
import { DEFAULT_AGENDA_PREFS } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { STANDARD_HOURS } from "../src/pages/settings/AgendaTab.tsx";
import { arrangeDay, DAY_WINDOW, type DayItem, dayItems } from "../src/lib/day.ts";

const SP = "America/Sao_Paulo";
/** An instant written as São Paulo's wall clock (UTC−3, no daylight saving since 2019). */
const sp = (local: string) => new Date(`${local}-03:00`);
const iso = (local: string) => sp(local).toISOString();

const task = (id: string, dueAt: string | null, extra: Partial<Task> = {}): Task =>
  ({ id, title: `Task ${id}`, status: "todo", priority: "medium", dueAt, projectId: null, ...extra }) as Task;

const event = (id: string, start: string, end: string, extra: Partial<AgendaEvent> = {}): AgendaEvent =>
  ({ id, calendarId: "main", title: `Event ${id}`, start, end, allDay: false, location: "", ...extra }) as AgendaEvent;

const routine = (id: string, status: Automation["status"], nextRunAt: string | null): Automation =>
  ({ id, name: `Routine ${id}`, status, nextRunAt }) as Automation;

const item = (key: string, kind: DayItem["kind"], at: string | null, until: string | null = null, extra: Partial<DayItem> = {}): DayItem => ({
  key,
  id: key,
  kind,
  title: key,
  at: at ? sp(at).getTime() : null,
  until: until ? sp(until).getTime() : null,
  daysLate: 0,
  allDay: false,
  undated: false,
  detail: "",
  flagged: false,
  ...extra,
});

const keys = (rows: readonly { key: string }[]) => rows.map((row) => row.key);
const arrange = (items: DayItem[], now: string, extra: { all?: boolean; done?: ReadonlySet<string> } = {}) =>
  arrangeDay(items, { now: sp(now), timeZone: SP, all: extra.all ?? true, done: extra.done ?? new Set() });

describe("what goes into the day", () => {
  const now = sp("2026-11-09T08:12:00");

  it("reads a task's deadline in the owner's zone: an hour today, a day without hour, or days late", () => {
    const items = dayItems(
      {
        tasks: [
          task("timed", iso("2026-11-09T15:00:00"), { priority: "high" }),
          task("dayOnly", iso("2026-11-09T23:59:00")),
          task("yesterday", iso("2026-11-08T23:59:00")),
          task("lastWeek", iso("2026-11-02T10:00:00"), { priority: "urgent" }),
          task("doing", null, { status: "in_progress" }),
        ],
        events: [],
        automations: [],
      },
      now,
      SP,
    );
    expect(items.find((entry) => entry.undated)?.key).toBe("task:doing");
    expect(items.map(({ key, at, daysLate, flagged }) => ({ key, at, daysLate, flagged }))).toEqual([
      { key: "task:timed", at: sp("2026-11-09T15:00:00").getTime(), daysLate: 0, flagged: true },
      { key: "task:dayOnly", at: null, daysLate: 0, flagged: false },
      { key: "task:yesterday", at: null, daysLate: 1, flagged: false },
      { key: "task:lastWeek", at: sp("2026-11-02T10:00:00").getTime(), daysLate: 7, flagged: true },
      { key: "task:doing", at: null, daysLate: 0, flagged: false },
    ]);
  });

  it("keeps only the events of today, all-day ones without an hour", () => {
    const items = dayItems(
      {
        tasks: [],
        events: [
          event("visit", iso("2026-11-09T09:00:00"), iso("2026-11-09T10:00:00"), { location: "Água Verde" }),
          event("holiday", "2026-11-09", "2026-11-10", { allDay: true }),
          event("tomorrow", iso("2026-11-10T09:00:00"), iso("2026-11-10T10:00:00")),
          event("ended", "2026-11-08", "2026-11-09", { allDay: true }),
        ],
        automations: [],
      },
      now,
      SP,
    );
    expect(items.map(({ key, at, until, allDay, detail }) => ({ key, at, until, allDay, detail }))).toEqual([
      { key: "event:main:holiday", at: null, until: null, allDay: true, detail: "" },
      { key: "event:main:visit", at: sp("2026-11-09T09:00:00").getTime(), until: sp("2026-11-09T10:00:00").getTime(), allDay: false, detail: "Água Verde" },
    ]);
  });

  it("lists a routine that runs today and one waiting for approval, never a paused one or tomorrow's", () => {
    const items = dayItems(
      {
        tasks: [],
        events: [],
        automations: [
          routine("today", "active", iso("2026-11-09T17:00:00")),
          routine("tomorrow", "active", iso("2026-11-10T00:00:00")),
          routine("paused", "paused", null),
          routine("waiting", "pending_approval", null),
        ],
      },
      now,
      SP,
    );
    expect(items.map(({ key, kind, at }) => ({ key, kind, at }))).toEqual([
      { key: "routine:today", kind: "routine", at: sp("2026-11-09T17:00:00").getTime() },
      { key: "approval:waiting", kind: "approval", at: null },
    ]);
  });

  it("uses the owner's day, not UTC's: 22:00 in São Paulo is still today", () => {
    const late = sp("2026-11-09T22:00:00");
    const items = dayItems({ tasks: [task("night", iso("2026-11-09T23:00:00"))], events: [], automations: [routine("utcTomorrow", "active", iso("2026-11-09T23:30:00"))] }, late, SP);
    expect(items.map((entry) => entry.daysLate)).toEqual([0, 0]);
    expect(keys(items)).toEqual(["task:night", "routine:utcTomorrow"]);
  });
});

describe("how the day is arranged", () => {
  const items = [
    item("late", "task", null, null, { daysLate: 1 }),
    item("approval", "approval", null),
    item("early", "event", "2026-11-09T07:00:00", "2026-11-09T07:30:00"),
    item("visit", "event", "2026-11-09T09:00:00", "2026-11-09T10:00:00"),
    item("call", "task", "2026-11-09T15:00:00"),
    item("digest", "routine", "2026-11-09T17:00:00"),
    item("someday", "task", null),
    item("night", "task", "2026-11-09T21:00:00"),
  ];

  it("puts what passed and asks nothing behind the curtain, what still asks on top, and the rest around the line of now", () => {
    const day = arrange(items, "2026-11-09T08:12:00");
    expect(keys(day.gone)).toEqual(["early"]);
    expect(keys(day.pending)).toEqual(["approval", "late"]);
    expect(day.rest.map((row) => ("now" in row ? "NOW" : row.key))).toEqual(["someday", "NOW", "visit", "call", "digest", "night"]);
    expect(day.now).toBe("08:12");
  });

  it("moves the line and the items as the clock runs: an event under way, then gone; a task past its hour, pending", () => {
    const during = arrange(items, "2026-11-09T09:30:00");
    expect(during.rest.map((row) => ("now" in row ? "NOW" : `${row.key}${row.current ? "*" : ""}`))).toEqual(["someday", "visit*", "NOW", "call", "digest", "night"]);

    const after = arrange(items, "2026-11-09T15:00:00");
    expect(keys(after.gone)).toEqual(["early", "visit"]);
    expect(keys(after.pending)).toEqual(["approval", "late", "call"]);
    expect(after.rest.map((row) => ("now" in row ? "NOW" : row.key))).toEqual(["someday", "NOW", "digest", "night"]);

    const end = arrange(items, "2026-11-09T23:00:00");
    expect(keys(end.gone)).toEqual(["early", "visit", "digest"]);
    expect(end.rest.map((row) => ("now" in row ? "NOW" : row.key))).toEqual(["someday", "NOW"]);
  });

  it.each([
    ["one minute before", "2026-11-09T14:59:59", false],
    ["on the minute", "2026-11-09T15:00:00", true],
    ["one minute after", "2026-11-09T15:01:00", true],
  ])("a task is pending from its hour on: %s", (_, now, pending) => {
    expect(keys(arrange(items, now).pending).includes("call")).toBe(pending);
  });

  it("an event that ends exactly now is gone, one that starts exactly now is under way", () => {
    expect(keys(arrange(items, "2026-11-09T10:00:00").gone)).toContain("visit");
    const start = arrange(items, "2026-11-09T09:00:00");
    expect(start.rest.find((row) => !("now" in row) && row.key === "visit")).toMatchObject({ current: true });
  });

  it("a finished task goes behind the curtain as done, late or not, and comes back when unmarked", () => {
    const day = arrange(items, "2026-11-09T08:12:00", { done: new Set(["late", "call"]) });
    expect(day.gone.map((row) => `${row.key}:${row.done}`)).toEqual(["late:true", "early:false", "call:true"]);
    expect(keys(day.pending)).toEqual(["approval"]);
  });

  it("shows only the working hours until asked, counting what was left out; what has no hour always shows", () => {
    // The hours before the owner picks any are the ones a new installation saves.
    expect(DAY_WINDOW).toEqual({ from: DEFAULT_AGENDA_PREFS.from, to: DEFAULT_AGENDA_PREFS.to });
    expect(STANDARD_HOURS).toEqual(DAY_WINDOW);
    const day = arrange(items, "2026-11-09T08:12:00", { all: false });
    expect(day.outside).toBe(2);
    expect(keys(day.gone)).toEqual([]);
    expect(keys(day.pending)).toEqual(["approval", "late"]);
    expect(day.rest.map((row) => ("now" in row ? "NOW" : row.key))).toEqual(["someday", "NOW", "visit", "call", "digest"]);
    expect(arrange(items, "2026-11-09T08:12:00").outside).toBe(2);
  });

  it.each([
    ["07:59", false],
    ["08:00", true],
    ["18:00", true],
    ["18:01", false],
  ])("the window takes 08:00 and 18:00 themselves: %s", (time, inside) => {
    const day = arrange([item("edge", "routine", `2026-11-09T${time}:00`)], "2026-11-09T06:00:00", { all: false });
    expect(day.outside).toBe(inside ? 0 : 1);
  });

  it.each([
    ["06:59", false],
    ["07:00", true],
    ["20:00", true],
    ["20:01", false],
  ])("S08: the window follows the owner's working hours (07:00 to 20:00): %s", (time, inside) => {
    const day = arrangeDay([item("edge", "routine", `2026-11-09T${time}:00`)], { now: sp("2026-11-09T06:00:00"), timeZone: SP, all: false, done: new Set(), window: { from: 7, to: 20 } });
    expect(day.outside).toBe(inside ? 0 : 1);
  });

  it("S08: working hours of the whole day leave nothing outside", () => {
    const edges = ["00:00", "23:59"].map((time) => item(time, "routine", `2026-11-09T${time}:00`));
    expect(arrangeDay(edges, { now: sp("2026-11-09T06:00:00"), timeZone: SP, all: false, done: new Set(), window: { from: 0, to: 24 } }).outside).toBe(0);
  });

  it("QA-1: an event shows while any part of it is inside the window, even begun before it or on the day before", () => {
    const under = arrange([item("meeting", "event", "2026-11-09T07:30:00", "2026-11-09T09:00:00")], "2026-11-09T08:15:00", { all: false });
    expect(under.outside).toBe(0);
    expect(under.rest.find((row) => !("now" in row))).toMatchObject({ key: "meeting", current: true });
    const overnight = arrange([item("trip", "event", "2026-11-08T22:00:00", "2026-11-09T10:00:00")], "2026-11-09T09:00:00", { all: false });
    expect(overnight.rest.find((row) => !("now" in row))).toMatchObject({ key: "trip", current: true });
    // Ends exactly when the window opens, or begins after it closes: outside.
    const edges = arrange(
      [item("before", "event", "2026-11-09T07:00:00", "2026-11-09T08:00:00"), item("at", "event", "2026-11-09T18:00:00", "2026-11-09T19:00:00"), item("after", "event", "2026-11-09T18:01:00", "2026-11-10T01:00:00")],
      "2026-11-09T06:00:00",
      { all: false },
    );
    // S08: one that begins as the window closes is after it, the same answer the Agenda gives.
    expect(edges.outside).toBe(3);
    expect(edges.rest.map((row) => ("now" in row ? "NOW" : row.key))).toEqual(["NOW"]);
    const last = arrange([item("last", "event", "2026-11-09T17:59:00", "2026-11-09T19:00:00"), item("point", "event", "2026-11-09T18:00:00", "2026-11-09T18:00:00")], "2026-11-09T06:00:00", { all: false });
    expect(last.rest.flatMap((row) => ("now" in row ? [] : [row.key]))).toEqual(["last"]);
    expect(last.outside).toBe(1);
    // With no length: the first minute of the window is inside, the minute before it is not.
    expect(arrange([item("open", "event", "2026-11-09T08:00:00", "2026-11-09T08:00:00"), item("early", "event", "2026-11-09T07:59:00", "2026-11-09T07:59:00")], "2026-11-09T06:00:00", { all: false }).outside).toBe(1);
  });

  it("QA-2: a task past its hour is pending at any hour, never hidden by the window nor counted outside it", () => {
    const day = arrange([item("dawn", "task", "2026-11-09T07:30:00"), item("evening", "task", "2026-11-09T18:30:00")], "2026-11-09T19:00:00", { all: false });
    expect(keys(day.pending)).toEqual(["dawn", "evening"]);
    expect(day.outside).toBe(0);
    // Before its hour the early one is just outside the window.
    expect(arrange([item("dawn", "task", "2026-11-09T07:30:00")], "2026-11-09T07:00:00", { all: false })).toMatchObject({ pending: [], outside: 1 });
  });

  it.each([
    ["the 23-hour day", "2026-03-08"],
    ["the 25-hour day", "2026-11-01"],
  ])("QA-4: on %s in New York the hours and the days late are still the owner's", (_, date) => {
    const NY = "America/New_York";
    // Noon in New York is 16:00 UTC in summer time and 17:00 in winter; both days end in a different offset than they begin.
    const local = (time: string, offset: string) => new Date(`${date}T${time}:00${offset}`);
    const after = date === "2026-03-08" ? "-04:00" : "-05:00";
    const yesterday = new Date(local("12:00", after).getTime() - 86_400_000).toISOString();
    const items = dayItems({ tasks: [task("y", yesterday), task("eight", local("08:00", after).toISOString()), task("early", local("07:59", after).toISOString())], events: [], automations: [] }, local("06:00", after), NY);
    expect(items.map((entry) => entry.daysLate)).toEqual([1, 0, 0]);
    const day = arrangeDay(items, { now: local("06:00", after), timeZone: NY, all: false, done: new Set() });
    expect(day.now).toBe("06:00");
    expect(keys(day.pending)).toEqual(["task:y"]);
    expect(day.rest.map((row) => ("now" in row ? "NOW" : row.key))).toEqual(["NOW", "task:eight"]);
    expect(day.outside).toBe(1);
  });

  it("orders the late ones oldest first and reads the hours in the owner's zone", () => {
    const day = arrange(
      [item("b", "task", null, null, { daysLate: 1 }), item("a", "task", "2026-11-06T10:00:00", null, { daysLate: 3 }), item("c", "task", "2026-11-09T08:00:00")],
      "2026-11-09T12:00:00",
    );
    expect(keys(day.pending)).toEqual(["a", "b", "c"]);
  });

  it("an empty day still has the line of now", () => {
    const day = arrange([], "2026-11-09T00:00:00");
    expect(day).toMatchObject({ gone: [], pending: [], outside: 0, now: "00:00" });
    expect(day.rest).toEqual([{ now: "00:00" }]);
  });
});
