/**
 * How long after the last change a draft is saved. Every save writes to the
 * owner's database (rule P4), so the pause is a real one, not each keystroke's.
 */
export const AUTOSAVE_DELAY_MS = 2_500;
/** Typing that never pauses is still saved this often. */
export const AUTOSAVE_MAX_WAIT_MS = 30_000;

export type AutosaveState = { phase: "saved" } | { phase: "saving" } | { phase: "failed"; error: unknown };

interface Options<T> {
  equal: (a: T, b: T) => boolean;
  /** Sends one draft; a rejection means it was not saved. */
  save: (draft: T) => Promise<void>;
  onState: (state: AutosaveState) => void;
}

/**
 * Saves a draft by itself (Sinal, PR S07): a moment after the owner stops
 * typing, or every so often while they don't stop. One save at a time; what is
 * typed meanwhile goes in the next one. A refused save keeps the draft as
 * unsaved and says so; it is tried again with the next change, with `flush`,
 * or when the owner asks, never in a loop of its own (free plan: every try is
 * a request). It holds no React state, so the rules are tested alone.
 */
export class Autosaver<T> {
  #latest: T;
  #saved: T;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #dirtySince: number | null = null;
  #loop: Promise<boolean> | null = null;
  #held = false;
  #disposed = false;
  readonly #options: Options<T>;

  constructor(initial: T, options: Options<T>) {
    this.#latest = initial;
    this.#saved = initial;
    this.#options = options;
  }

  /** Whether something typed has not reached the server. */
  get dirty(): boolean {
    return !this.#options.equal(this.#latest, this.#saved);
  }

  /** The owner changed the draft. */
  set(draft: T): void {
    if (this.#disposed) return;
    this.#latest = draft;
    if (!this.dirty) {
      this.#cancel();
      if (!this.#loop) this.#options.onState({ phase: "saved" });
      return;
    }
    this.#options.onState({ phase: "saving" });
    this.#schedule();
  }

  /** Another version (from elsewhere, or the one just created) becomes the saved one; a pending save is dropped. */
  reset(saved: T): void {
    this.#cancel();
    this.#latest = saved;
    this.#saved = saved;
  }

  /** While held nothing is saved: the owner is choosing between their text and a newer version. */
  hold(on: boolean): void {
    this.#held = on;
    if (on) this.#cancel();
    else if (this.dirty && !this.#disposed) this.#schedule();
  }

  /** Saves now whatever is pending. True when nothing is left unsaved. */
  flush(): Promise<boolean> {
    this.#cancel();
    this.#loop ??= this.#run();
    return this.#loop;
  }

  /** The editor is going away for good (the note went to the trash): nothing more is saved. */
  dispose(): void {
    this.#disposed = true;
    this.#cancel();
  }

  #cancel(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#dirtySince = null;
  }

  #schedule(): void {
    if (this.#held) return;
    const now = Date.now();
    this.#dirtySince ??= now;
    if (this.#timer !== null) clearTimeout(this.#timer);
    const wait = Math.max(0, Math.min(AUTOSAVE_DELAY_MS, this.#dirtySince + AUTOSAVE_MAX_WAIT_MS - now));
    this.#timer = setTimeout(() => void this.flush(), wait);
  }

  async #run(): Promise<boolean> {
    // A step later, so `flush` has stored this round before it can end.
    await Promise.resolve();
    let ok = true;
    while (ok && this.dirty && !this.#held && !this.#disposed) {
      const draft = this.#latest;
      this.#options.onState({ phase: "saving" });
      try {
        await this.#options.save(draft);
        this.#saved = draft;
      } catch (error) {
        ok = false;
        if (!this.#disposed) this.#options.onState({ phase: "failed", error });
      }
    }
    // Cleared in the same step as the last check: a flush right after this one starts a new round.
    this.#loop = null;
    const clean = ok && !this.dirty;
    if (clean && !this.#disposed) this.#options.onState({ phase: "saved" });
    return clean;
  }
}
