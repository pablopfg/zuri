import type { QueryClient } from "@tanstack/react-query";
import type { NoticeSound, SoundPrefs } from "@zuri/shared";

/**
 * The sounds of the open app (12/11/2026): one when a notice arrives and two
 * short ones around a voice recording. The browser makes them on the spot (Web
 * Audio), so no audio file is downloaded or kept in the repository. Loaded
 * after the first screen (rule P11): nothing here is in the first load.
 */

// Only types come from the shared package: a value of its sounds.ts would become a piece of its own in the
// first load's list of files (rule P11, armadilhas.md). A test keeps the three below the same as the shared ones.
/** The sounds before the settings arrive (DEFAULT_SOUND_PREFS). */
export const STANDARD_SOUNDS: SoundPrefs = { notice: true, pick: "sino", recording: true };
/** Notices that arrive together sound once (NOTICE_SOUND_GAP_MS). */
export const NOTICE_GAP_MS = 3_000;

/** One note: its pitch (Hz), when it starts and how long it lasts (s), how loud it gets, and optionally its wave, its attack (s) and the pitch it slides to. */
export interface Note {
  f: number;
  at: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  attack?: number;
  to?: number;
}

/** The notice sounds, as the owner heard and chose them in the prototype. */
export const NOTICE_NOTES: Record<NoticeSound, readonly Note[]> = {
  // Two soft notes, each with a quiet octave above it.
  sino: [
    { f: 987.77, at: 0, dur: 0.9, gain: 0.16 },
    { f: 1975.5, at: 0, dur: 0.5, gain: 0.04 },
    { f: 1318.5, at: 0.16, dur: 1.1, gain: 0.15 },
    { f: 2637, at: 0.16, dur: 0.6, gain: 0.035 },
  ],
  // One short tap that falls and comes back up.
  gota: [
    { f: 1500, at: 0, dur: 0.11, gain: 0.2, to: 620 },
    { f: 760, at: 0.1, dur: 0.2, gain: 0.16, to: 1480 },
  ],
  // Three rising notes, each with the click of the mallet.
  marimba: [
    [783.99, 0],
    [987.77, 0.11],
    [1174.66, 0.22],
  ].flatMap(([f = 0, at = 0]): Note[] => [
    { f, at, dur: 0.42, gain: 0.2, type: "triangle", attack: 0.004 },
    { f: f * 4, at, dur: 0.08, gain: 0.05, attack: 0.002 },
  ]),
};

/** The notice sounds in the order the owner sees them (NOTICE_SOUNDS). */
export const NOTICE_SOUNDS = Object.keys(NOTICE_NOTES) as NoticeSound[];

/** Two notes up when the recording starts, the same two down when it ends. */
export const RECORDING_NOTES: Record<"start" | "stop", readonly Note[]> = {
  start: [
    { f: 620, at: 0, dur: 0.07, gain: 0.16 },
    { f: 930, at: 0.075, dur: 0.1, gain: 0.16 },
  ],
  stop: [
    { f: 930, at: 0, dur: 0.07, gain: 0.14 },
    { f: 620, at: 0.075, dur: 0.1, gain: 0.14 },
  ],
};

/** A sound the browser held back plays only if it lets go within this long: never a stale sound later. */
const LATE_MS = 1_000;

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (context) return context;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    // The browser refused (too many contexts, a policy): no sound.
  }
  return context;
}

function schedule(ctx: AudioContext, notes: readonly Note[]): void {
  for (const note of notes) {
    const start = ctx.currentTime + note.at;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = note.type ?? "sine";
    oscillator.frequency.setValueAtTime(note.f, start);
    if (note.to) oscillator.frequency.exponentialRampToValueAtTime(note.to, start + note.dur);
    // From silence up and back down, so no note clicks.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.gain, start + (note.attack ?? 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + note.dur + 0.02);
  }
}

/**
 * Plays the notes now. A browser only lets a page sound after the owner's
 * first click or touch: until then the sound is dropped, not kept for later.
 */
export function play(notes: readonly Note[]): void {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === "running") {
    schedule(ctx, notes);
    return;
  }
  const asked = Date.now();
  void ctx.resume().then(
    () => {
      if (Date.now() - asked < LATE_MS) schedule(ctx, notes);
    },
    () => undefined,
  );
}

/** The owner's choices, as the settings in memory have them (SETTINGS_KEY, written out to keep this file out of the first load's imports). */
export function soundPrefs(qc: QueryClient): SoundPrefs {
  return qc.getQueryData<{ sounds?: SoundPrefs }>(["settings"])?.sounds ?? STANDARD_SOUNDS;
}

/** The short sound around a voice recording, when the owner keeps it on. */
export function recordingSound(qc: QueryClient, moment: "start" | "stop"): void {
  if (soundPrefs(qc).recording) play(RECORDING_NOTES[moment]);
}

/**
 * Decides when a notice sounds, from the bell's count as each answer brings
 * it: the first count only sets the base, a count above the base is a new
 * notice, and notices that arrive together (within `gapMs`) sound once.
 */
export function createNoticeEar(gapMs: number = NOTICE_GAP_MS) {
  let base: number | null = null;
  let last = Number.NEGATIVE_INFINITY;
  return {
    /** A count read by this tab (null: signed out). True when a sound is due. */
    heard(unread: number | null, now: number): boolean {
      const rose = base !== null && unread !== null && unread > base;
      base = unread;
      if (!rose || now - last < gapMs) return false;
      last = now;
      return true;
    },
    /** A count another tab already read: it sounded there, so not here again. Never lowers the base: an older message arriving late must not make the same notice sound twice. */
    told(unread: number): void {
      base = base === null ? unread : Math.max(base, unread);
    },
    base: () => base,
  };
}

const CHANNEL = "zuri-sounds";

let stopWatching: (() => void) | null = null;

/**
 * Sounds when the bell's count goes up while the app is open. The count rides
 * on the session check and the heartbeat, so this only listens to the session
 * in memory: no request of its own. The tab that read the new count tells the
 * others, so one notice sounds in one tab. Started with the areas' numbers
 * (lib/versions.ts), after the first screen.
 */
export function watchNotices(qc: QueryClient): void {
  if (stopWatching) return;
  const ear = createNoticeEar();
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data === "number" && Number.isSafeInteger(event.data) && event.data >= 0) ear.told(event.data);
  });
  const read = () => {
    const session = qc.getQueryData<{ unreadNotices?: number } | null>(["session"]);
    // A session answer without the count (no notice center) says nothing.
    if (session && session.unreadNotices === undefined) return;
    const unread = session ? (session.unreadNotices ?? null) : null;
    if (unread === ear.base()) return;
    const due = ear.heard(unread, Date.now());
    if (unread !== null) channel?.postMessage(unread);
    const prefs = soundPrefs(qc);
    if (due && prefs.notice) play(NOTICE_NOTES[prefs.pick]);
  };
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] === "session") read();
  });
  // A context the browser made asleep wakes on the owner's next click, touch or key: the next notice sounds.
  const wake = () => {
    if (context && context.state !== "running") void context.resume().catch(() => undefined);
  };
  const target = typeof window === "undefined" ? null : window;
  target?.addEventListener("pointerdown", wake, { capture: true, passive: true });
  target?.addEventListener("keydown", wake, { capture: true, passive: true });
  stopWatching = () => {
    unsubscribe();
    channel?.close();
    target?.removeEventListener("pointerdown", wake, { capture: true });
    target?.removeEventListener("keydown", wake, { capture: true });
  };
  read();
}

/** Tests only: forget the audio context and stop listening. */
export function resetSounds(): void {
  stopWatching?.();
  stopWatching = null;
  context = null;
}
