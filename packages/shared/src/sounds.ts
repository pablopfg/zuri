/**
 * The sounds the app makes while it is open (12/11/2026): one when a notice
 * arrives and two short ones around a voice recording. No schema here: the
 * screens import this file, and the schema lives in settings.ts (rule P11).
 */

/** The notice sounds the owner picks from; the first is the standard one. */
export const NOTICE_SOUNDS = ["sino", "gota", "marimba"] as const;
export type NoticeSound = (typeof NOTICE_SOUNDS)[number];

export interface SoundPrefs {
  /** Whether a new notice makes a sound while the app is open. */
  notice: boolean;
  /** Which sound it makes. */
  pick: NoticeSound;
  /** Whether starting and ending a voice recording make a short sound. */
  recording: boolean;
}

export const DEFAULT_SOUND_PREFS: SoundPrefs = /* @__PURE__ */ Object.freeze({ notice: true, pick: "sino", recording: true });

/** Notices that arrive together sound once: at most one sound in this long. */
export const NOTICE_SOUND_GAP_MS = 3_000;
