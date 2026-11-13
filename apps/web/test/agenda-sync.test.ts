import { describe, expect, it } from "vitest";
import { LOG_MAX, pushLine } from "../src/pages/agenda/changes.ts";
import { STALE_MS, syncKind } from "../src/pages/agenda/SyncSignal.tsx";

// The Agenda's sync signal (E5d, protótipo v51 item 4): one signal at a time, the most urgent first.

const NOW = Date.parse("2026-11-18T13:20:00.000Z");
const base = { saving: false, problem: null, fetching: false, readFailed: false, readAt: NOW - 60_000, savedAt: null, savedMs: 60_000, now: NOW } as const;

describe("syncKind", () => {
  it("is in step when nothing is going on", () => {
    expect(syncKind(base)).toBe("ok");
  });

  it("puts a change on its way above all, then the last change's problem, then a reading", () => {
    expect(syncKind({ ...base, saving: true, problem: "offline", fetching: true, readFailed: true })).toBe("saving");
    expect(syncKind({ ...base, problem: "changed", fetching: true, readFailed: true })).toBe("changed");
    for (const problem of ["offline", "failed", "paused"] as const) expect(syncKind({ ...base, problem })).toBe(problem);
    expect(syncKind({ ...base, fetching: true, readFailed: true })).toBe("pulling");
  });

  it("is out of date past 15 minutes without word from Google, or when the reading failed", () => {
    expect(syncKind({ ...base, readAt: NOW - STALE_MS + 1 })).toBe("ok");
    expect(syncKind({ ...base, readAt: NOW - STALE_MS })).toBe("ok");
    expect(syncKind({ ...base, readAt: NOW - STALE_MS - 1 })).toBe("stale");
    expect(syncKind({ ...base, readFailed: true, savedAt: NOW })).toBe("stale");
  });

  it("is never out of date before the first reading, and says so only when that reading fails", () => {
    expect(syncKind({ ...base, readAt: 0 })).toBe("pulling");
    expect(syncKind({ ...base, readAt: 0, fetching: true })).toBe("pulling");
    expect(syncKind({ ...base, readAt: 0, readFailed: true })).toBe("stale");
  });

  it("says a change was saved for a while, and then goes back to in step", () => {
    expect(syncKind({ ...base, savedAt: NOW - 59_999 })).toBe("saved");
    expect(syncKind({ ...base, savedAt: NOW - 60_000 })).toBe("ok");
  });
});

describe("Últimas mudanças", () => {
  it("keeps the newest first and only the last five", () => {
    let log = [] as ReturnType<typeof pushLine>;
    for (let n = 1; n <= LOG_MAX; n++) log = pushLine(log, { at: n, text: `${n}`, ok: true });
    expect(log.map((line) => line.text)).toEqual(["5", "4", "3", "2", "1"]);
    log = pushLine(log, { at: 6, text: "6", ok: false });
    expect(log.map((line) => line.text)).toEqual(["6", "5", "4", "3", "2"]);
  });
});
