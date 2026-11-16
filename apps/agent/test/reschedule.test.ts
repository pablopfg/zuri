import { DEFAULT_AGENDA_PREFS } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { type Busy, freeIn, gridOf, offerOf, turnsOf } from "../src/google/reschedule.ts";

// E7b (plano link-de-confirmacao.md, seção 15): the hours the patient's link offers, as pure rules.

const HOURS = { ...DEFAULT_AGENDA_PREFS, workDays: [1, 2, 3, 4, 5], lunch: { from: 720, to: 840 }, closed: [] };
const MORNING = { turn: "morning" as const, from: 480, to: 720 };
const AFTERNOON = { turn: "afternoon" as const, from: 840, to: 1080 };
const seed = (...values: number[]) => new Uint8Array(values.flatMap((value) => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]));
const free = (day: string, window: typeof MORNING, busy: Busy[], exclude?: number) => freeIn({ day, window, length: 60, busy, hours: HOURS, today: "2026-12-01", nowMinute: 540, exclude });

describe("E7b: the halves of the day", () => {
  it("splits at lunch, and at noon without one; a lunch at the edge leaves one half", () => {
    expect(turnsOf(HOURS)).toEqual([MORNING, AFTERNOON]);
    expect(turnsOf({ from: 8, to: 18, lunch: null })).toEqual([
      { turn: "morning", from: 480, to: 720 },
      { turn: "afternoon", from: 720, to: 1080 },
    ]);
    expect(turnsOf({ from: 13, to: 18, lunch: null })).toEqual([{ turn: "afternoon", from: 780, to: 1080 }]);
    expect(turnsOf({ from: 8, to: 12, lunch: null })).toEqual([{ turn: "morning", from: 480, to: 720 }]);
  });

  it("lists the hours on the hour that fit the appointment: n−1, n and n+1 minutes of room", () => {
    expect(gridOf(MORNING, 60)).toEqual([480, 540, 600, 660]);
    expect(gridOf({ from: 480, to: 719 }, 60)).toEqual([480, 540, 600]);
    expect(gridOf({ from: 480, to: 721 }, 60)).toEqual([480, 540, 600, 660]);
    expect(gridOf(MORNING, 90)).toEqual([480, 540, 600]);
    expect(gridOf({ from: 480, to: 539 }, 60)).toEqual([]);
  });
});

describe("E7b: what is free", () => {
  it("leaves out what overlaps, keeps what only touches, and never the appointment's own hour", () => {
    const meeting: Busy = { start: 600, end: 660, appointment: false };
    expect(free("2026-12-02", MORNING, [meeting])).toEqual([480, 540, 660]);
    expect(free("2026-12-02", MORNING, [{ start: 599, end: 661, appointment: true }])).toEqual([480]);
    expect(free("2026-12-02", MORNING, [], 540)).toEqual([480, 600, 660]);
  });

  it("is nothing on a weekend, a national holiday or a day off", () => {
    expect(free("2026-12-05", MORNING, [])).toEqual([]);
    expect(free("2026-12-25", MORNING, [])).toEqual([]);
    expect(freeIn({ day: "2026-12-02", window: MORNING, length: 60, busy: [], hours: { ...HOURS, closed: [{ from: "2026-12-02", to: "2026-12-02", reason: "" }] }, today: "2026-12-01", nowMinute: 0 })).toEqual([]);
  });
});

describe("E7b: what step 4 offers", () => {
  it("a half with an appointment: the free hours right next to it, nearest the preferred hour first, up to 3", () => {
    const busy: Busy[] = [{ start: 600, end: 660, appointment: true }];
    const open = free("2026-12-02", MORNING, busy);
    expect(offerOf({ window: MORNING, length: 60, busy, free: open, pref: 480, seed: seed(0) })).toEqual([540, 660]);
    expect(offerOf({ window: MORNING, length: 60, busy, free: open, pref: 660, seed: seed(0) })).toEqual([660, 540]);
    // Four appointments' edges: never more than 3.
    const many: Busy[] = [
      { start: 840, end: 900, appointment: true },
      { start: 960, end: 1020, appointment: true },
    ];
    const afternoon = [900, 1020];
    expect(offerOf({ window: AFTERNOON, length: 60, busy: many, free: afternoon, pref: 840, seed: seed(0) })).toEqual([900, 1020]);
    const wide = { turn: "afternoon" as const, from: 600, to: 1200 };
    const spread: Busy[] = [
      { start: 660, end: 720, appointment: true },
      { start: 900, end: 960, appointment: true },
    ];
    expect(offerOf({ window: wide, length: 60, busy: spread, free: [600, 720, 840, 960, 1080], pref: 600, seed: seed(0) })).toEqual([600, 720, 840]);
  });

  it("a half with an appointment but nothing right next to it: the 2 nearest one, in order of time", () => {
    const busy: Busy[] = [{ start: 870, end: 930, appointment: true }];
    expect(offerOf({ window: AFTERNOON, length: 60, busy, free: [960, 1020], pref: 840, seed: seed(0) })).toEqual([960, 1020]);
    const far: Busy[] = [{ start: 500, end: 530, appointment: true }];
    expect(offerOf({ window: MORNING, length: 60, busy: far, free: [540, 600, 660], pref: 660, seed: seed(0) })).toEqual([600, 660]);
  });

  it("a meeting is no appointment to sit next to: the half draws 2, the same for the same seed, others for another", () => {
    const busy: Busy[] = [{ start: 600, end: 660, appointment: false }];
    const open = [480, 540, 660];
    const first = offerOf({ window: MORNING, length: 60, busy, free: open, pref: 480, seed: seed(0, 0) });
    expect(first).toEqual([480, 540]);
    expect(offerOf({ window: MORNING, length: 60, busy, free: open, pref: 660, seed: seed(0, 0) })).toEqual(first);
    expect(offerOf({ window: MORNING, length: 60, busy, free: open, pref: 480, seed: seed(2, 1) })).toEqual([540, 660]);
    expect(offerOf({ window: MORNING, length: 60, busy: [], free: [540], pref: 480, seed: seed(7, 7) })).toEqual([540]);
    expect(offerOf({ window: MORNING, length: 60, busy: [], free: [], pref: 480, seed: seed(7, 7) })).toEqual([]);
  });
});
