import { QueryClient } from "@tanstack/react-query";
import { DEFAULT_SOUND_PREFS, NOTICE_SOUND_GAP_MS, NOTICE_SOUNDS, type SoundPrefs } from "@zuri/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNoticeEar, NOTICE_GAP_MS, NOTICE_NOTES, NOTICE_SOUNDS as SHOWN, type Note, play, RECORDING_NOTES, recordingSound, resetSounds, STANDARD_SOUNDS, watchNotices } from "../src/lib/sounds.ts";

/** A stand-in for the browser's audio: counts the notes it was asked to play. */
class FakeAudio {
  static made: FakeAudio[] = [];
  static startState: AudioContextState = "running";
  static resumes: Promise<void> = Promise.resolve();
  state: AudioContextState = FakeAudio.startState;
  currentTime = 10;
  destination = {};
  played: { frequency: number; type: string; start: number; stop: number }[] = [];
  resumed = 0;
  constructor() {
    FakeAudio.made.push(this);
  }
  resume() {
    this.resumed += 1;
    return FakeAudio.resumes.then(() => {
      this.state = "running";
    });
  }
  createOscillator() {
    const note = { frequency: 0, type: "sine", start: 0, stop: 0 };
    this.played.push(note);
    return {
      set type(value: string) {
        note.type = value;
      },
      frequency: {
        setValueAtTime: (value: number) => {
          note.frequency = value;
        },
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: <T>(next: T) => next,
      start: (at: number) => {
        note.start = at;
      },
      stop: (at: number) => {
        note.stop = at;
      },
    };
  }
  createGain() {
    return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: <T>(next: T) => next };
  }
}

const notesPlayed = () => FakeAudio.made.flatMap((ctx) => ctx.played);

beforeEach(() => {
  FakeAudio.made = [];
  FakeAudio.startState = "running";
  FakeAudio.resumes = Promise.resolve();
  vi.stubGlobal("AudioContext", FakeAudio);
  vi.useFakeTimers({ now: new Date("2026-11-12T12:00:00Z") });
});

afterEach(() => {
  resetSounds();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function signedIn(unread: number, sounds: SoundPrefs = DEFAULT_SOUND_PREFS) {
  const qc = new QueryClient();
  qc.setQueryData(["settings"], { sounds });
  qc.setQueryData(["session"], { unreadNotices: unread });
  return qc;
}

describe("the sounds themselves", () => {
  it("the screen's own list, standard choices and gap are the shared ones", () => {
    expect(SHOWN).toEqual([...NOTICE_SOUNDS]);
    expect(STANDARD_SOUNDS).toEqual(DEFAULT_SOUND_PREFS);
    expect(NOTICE_GAP_MS).toBe(NOTICE_SOUND_GAP_MS);
  });

  it("every notice sound is short and quiet: under 1.5 s, no note louder than 0.2", () => {
    const all: [string, readonly Note[]][] = [...NOTICE_SOUNDS.map((name): [string, readonly Note[]] => [name, NOTICE_NOTES[name]]), ...Object.entries(RECORDING_NOTES)];
    expect(all.map(([name]) => name)).toEqual(["sino", "gota", "marimba", "start", "stop"]);
    for (const [name, notes] of all) {
      expect(notes.length, name).toBeGreaterThan(0);
      for (const note of notes) {
        expect(note.at + note.dur, name).toBeLessThanOrEqual(1.5);
        expect(note.gain, name).toBeGreaterThan(0);
        expect(note.gain, name).toBeLessThanOrEqual(0.2);
        expect(note.f, name).toBeGreaterThanOrEqual(200);
      }
    }
    // The recording sounds are a blink: the microphone hears almost none of them.
    for (const notes of Object.values(RECORDING_NOTES)) expect(Math.max(...notes.map((note) => note.at + note.dur))).toBeLessThan(0.2);
    // Up at the start, down at the end.
    expect(RECORDING_NOTES.start.map((note) => note.f)).toEqual([620, 930]);
    expect(RECORDING_NOTES.stop.map((note) => note.f)).toEqual([930, 620]);
  });

  it("plays each note at its moment, on one audio context for the whole app", () => {
    play(NOTICE_NOTES.marimba);
    play(NOTICE_NOTES.gota);
    expect(FakeAudio.made).toHaveLength(1);
    expect(notesPlayed()).toHaveLength(8);
    expect(notesPlayed()[0]).toEqual({ frequency: 783.99, type: "triangle", start: 10, stop: 10 + 0.42 + 0.02 });
    expect(notesPlayed()[2]?.start).toBeCloseTo(10.11);
  });

  it("a sound the browser holds back is dropped, never played late", async () => {
    FakeAudio.startState = "suspended";
    let letGo: () => void = () => undefined;
    FakeAudio.resumes = new Promise((resolve) => {
      letGo = resolve;
    });
    play(NOTICE_NOTES.sino);
    expect(notesPlayed()).toHaveLength(0);
    // The owner clicks five seconds later: the browser lets go, the old sound stays unplayed.
    vi.advanceTimersByTime(5_000);
    letGo();
    await vi.runAllTimersAsync();
    expect(notesPlayed()).toHaveLength(0);
    // The context is awake now: the next one sounds.
    play(NOTICE_NOTES.sino);
    expect(notesPlayed()).toHaveLength(4);
  });

  it("a context that wakes at once (a click on Ouvir in Safari) plays", async () => {
    FakeAudio.startState = "suspended";
    play(NOTICE_NOTES.gota);
    await vi.runAllTimersAsync();
    expect(notesPlayed()).toHaveLength(2);
  });

  it("without Web Audio, or when the browser refuses a context, nothing breaks", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(() => play(NOTICE_NOTES.sino)).not.toThrow();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("refused");
        }
      },
    );
    expect(() => play(NOTICE_NOTES.sino)).not.toThrow();
    // A refusal is not kept: once the browser makes a context again, the next sound plays.
    vi.stubGlobal("AudioContext", FakeAudio);
    play(NOTICE_NOTES.sino);
    expect(notesPlayed()).toHaveLength(4);
  });

  it("the older Safari name (webkitAudioContext) works too", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", FakeAudio);
    play(NOTICE_NOTES.gota);
    expect(notesPlayed()).toHaveLength(2);
  });
});

describe("when a notice sounds (CA1)", () => {
  it("the first count is only the base; a higher count sounds, the same or a lower one does not", () => {
    const ear = createNoticeEar();
    expect(ear.heard(4, 0)).toBe(false);
    expect(ear.heard(4, 10_000)).toBe(false);
    expect(ear.heard(5, 20_000)).toBe(true);
    // The owner read them all, then one more arrived.
    expect(ear.heard(0, 30_000)).toBe(false);
    expect(ear.heard(1, 40_000)).toBe(true);
  });

  it("at most one sound every 3 s: n-1 ms is silent, n ms sounds", () => {
    expect(NOTICE_SOUND_GAP_MS).toBe(3_000);
    const ear = createNoticeEar();
    ear.heard(0, 0);
    expect(ear.heard(1, 1_000)).toBe(true);
    expect(ear.heard(2, 1_000 + NOTICE_SOUND_GAP_MS - 1)).toBe(false);
    // The silent one still moved the base: the same count again is not a new notice.
    expect(ear.heard(2, 1_000 + NOTICE_SOUND_GAP_MS)).toBe(false);
    expect(ear.heard(3, 1_000 + NOTICE_SOUND_GAP_MS)).toBe(true);
  });

  it("after a sign-out the next sign-in starts from a new base", () => {
    const ear = createNoticeEar();
    ear.heard(2, 0);
    expect(ear.heard(null, 10_000)).toBe(false);
    expect(ear.heard(7, 20_000)).toBe(false);
    expect(ear.heard(8, 30_000)).toBe(true);
  });

  it("a count another tab already sounded for does not sound here again", () => {
    const ear = createNoticeEar();
    ear.heard(2, 0);
    ear.told(3);
    expect(ear.heard(3, 10_000)).toBe(false);
    expect(ear.heard(4, 20_000)).toBe(true);
    // An older message from the other tab, arriving late, does not bring the notice back.
    ear.told(3);
    expect(ear.heard(4, 30_000)).toBe(false);
    // The owner read everything in the other tab, then one more arrived: this tab learns both from its own reading.
    ear.told(0);
    expect(ear.heard(0, 40_000)).toBe(false);
    expect(ear.heard(1, 50_000)).toBe(true);
  });
});

describe("the bell's count in the open app (CA1)", () => {
  it("a new notice plays the chosen sound; opening the app with unread notices plays nothing", () => {
    const qc = signedIn(3, { ...DEFAULT_SOUND_PREFS, pick: "gota" });
    watchNotices(qc);
    expect(notesPlayed()).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    qc.setQueryData(["session"], { unreadNotices: 4 });
    expect(notesPlayed().map((note) => note.frequency)).toEqual([1500, 760]);
  });

  it("the standard sound is the Sino, on", () => {
    expect(DEFAULT_SOUND_PREFS).toEqual({ notice: true, pick: "sino", recording: true });
    const qc = signedIn(0);
    // Settings not loaded yet: the standard ones apply.
    qc.removeQueries({ queryKey: ["settings"] });
    watchNotices(qc);
    qc.setQueryData(["session"], { unreadNotices: 1 });
    expect(notesPlayed().map((note) => note.frequency)).toEqual([987.77, 1975.5, 1318.5, 2637]);
  });

  it("with the sound off nothing plays, and no audio context is even made", () => {
    const qc = signedIn(0, { ...DEFAULT_SOUND_PREFS, notice: false });
    watchNotices(qc);
    qc.setQueryData(["session"], { unreadNotices: 5 });
    expect(FakeAudio.made).toHaveLength(0);
  });

  it("notices that arrive together sound once; the next one after 3 s sounds again", () => {
    const qc = signedIn(0);
    watchNotices(qc);
    qc.setQueryData(["session"], { unreadNotices: 1 });
    vi.advanceTimersByTime(NOTICE_SOUND_GAP_MS - 1);
    qc.setQueryData(["session"], { unreadNotices: 2 });
    expect(notesPlayed()).toHaveLength(4);
    vi.advanceTimersByTime(1);
    qc.setQueryData(["session"], { unreadNotices: 3 });
    expect(notesPlayed()).toHaveLength(8);
  });

  it("the same session answer again, a session without the count and a sign-out are silent", () => {
    const qc = signedIn(1);
    watchNotices(qc);
    watchNotices(qc);
    qc.setQueryData(["session"], { unreadNotices: 1 });
    qc.setQueryData(["session"], { deadlines: {} });
    qc.setQueryData(["session"], null);
    vi.advanceTimersByTime(10_000);
    // Signed in again with more unread: the base, not a new notice.
    qc.setQueryData(["session"], { unreadNotices: 9 });
    expect(notesPlayed()).toHaveLength(0);
    // Listening once, however many times it was started.
    qc.setQueryData(["session"], { unreadNotices: 10 });
    expect(notesPlayed()).toHaveLength(4);
  });

  it("other parts of the app's memory changing never sound", () => {
    const qc = signedIn(0);
    watchNotices(qc);
    qc.setQueryData(["tasks"], { unreadNotices: 50 });
    qc.setQueryData(["notices", "list"], [{}, {}]);
    expect(notesPlayed()).toHaveLength(0);
  });
});

describe("other tabs and the browser's hold on sound", () => {
  /** One channel per name, shared by every "tab" of the test; a message reaches the others, never its sender. */
  class FakeChannel {
    static open: FakeChannel[] = [];
    listeners: ((event: { data: unknown }) => void)[] = [];
    constructor(readonly name: string) {
      FakeChannel.open.push(this);
    }
    addEventListener(_type: string, listener: (event: { data: unknown }) => void) {
      this.listeners.push(listener);
    }
    postMessage(data: unknown) {
      for (const other of FakeChannel.open) if (other !== this && other.name === this.name) for (const listener of other.listeners) listener({ data });
    }
    close() {
      FakeChannel.open = FakeChannel.open.filter((each) => each !== this);
    }
  }

  beforeEach(() => {
    FakeChannel.open = [];
    vi.stubGlobal("BroadcastChannel", FakeChannel);
  });

  it("a count this tab read reaches the other tabs; what another tab says only counts as a whole number that is not negative", () => {
    const qc = signedIn(2);
    watchNotices(qc);
    const other = new FakeChannel("zuri-sounds");
    const got: unknown[] = [];
    other.addEventListener("message", (event) => got.push(event.data));
    // Another tab read 3 first (and sounded there): the same 3 here is silent.
    other.postMessage(3);
    qc.setQueryData(["session"], { unreadNotices: 3 });
    expect(notesPlayed()).toHaveLength(0);
    // Nothing new to tell: the other tab already knows.
    expect(got).toEqual([]);
    // Anything else on the channel is ignored: the next real notice still sounds.
    for (const hostile of ["9", -1, 1.5, Number.NaN, Number.MAX_VALUE, { unread: 9 }, null, [9]]) other.postMessage(hostile);
    vi.advanceTimersByTime(10_000);
    qc.setQueryData(["session"], { unreadNotices: 4 });
    expect(notesPlayed()).toHaveLength(4);
    expect(got).toEqual([4]);
    // Signed out: nothing is said to the other tabs.
    qc.setQueryData(["session"], null);
    expect(got).toEqual([4]);
  });

  it("a context the browser left asleep wakes on the owner's next click or key, and the next notice sounds", async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("window", { addEventListener: (type: string, listener: () => void) => listeners.set(type, listener), removeEventListener: (type: string) => listeners.delete(type) });
    FakeAudio.startState = "suspended";
    // The browser holds the context until the owner touches the page.
    let letGo: () => void = () => undefined;
    FakeAudio.resumes = new Promise((resolve) => {
      letGo = resolve;
    });
    const qc = signedIn(0);
    watchNotices(qc);
    expect([...listeners.keys()].sort()).toEqual(["keydown", "pointerdown"]);
    // Before any context exists, a click does nothing.
    listeners.get("pointerdown")?.();
    expect(FakeAudio.made).toHaveLength(0);
    qc.setQueryData(["session"], { unreadNotices: 1 });
    expect(notesPlayed()).toHaveLength(0);
    vi.advanceTimersByTime(30_000);
    listeners.get("keydown")?.();
    expect(FakeAudio.made[0]?.resumed).toBe(2);
    letGo();
    await vi.runAllTimersAsync();
    // The first notice stays unplayed; the next one sounds.
    expect(notesPlayed()).toHaveLength(0);
    qc.setQueryData(["session"], { unreadNotices: 2 });
    expect(notesPlayed()).toHaveLength(4);
    resetSounds();
    expect(listeners.size).toBe(0);
  });
});

describe("the recording sounds (CA4)", () => {
  it("play at the start and at the end while the switch is on, and never when it is off", () => {
    const on = signedIn(0);
    recordingSound(on, "start");
    expect(notesPlayed().map((note) => note.frequency)).toEqual([620, 930]);
    recordingSound(on, "stop");
    expect(notesPlayed().map((note) => note.frequency)).toEqual([620, 930, 930, 620]);

    const off = signedIn(0, { ...DEFAULT_SOUND_PREFS, recording: false });
    recordingSound(off, "start");
    recordingSound(off, "stop");
    expect(notesPlayed()).toHaveLength(4);
  });

  it("the notice switch does not silence the recording, nor the other way round", () => {
    recordingSound(signedIn(0, { ...DEFAULT_SOUND_PREFS, notice: false }), "start");
    expect(notesPlayed()).toHaveLength(2);
    const qc = signedIn(0, { ...DEFAULT_SOUND_PREFS, recording: false });
    watchNotices(qc);
    qc.setQueryData(["session"], { unreadNotices: 1 });
    expect(notesPlayed()).toHaveLength(6);
  });
});
