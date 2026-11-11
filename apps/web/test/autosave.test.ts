import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_DELAY_MS, AUTOSAVE_MAX_WAIT_MS, Autosaver, type AutosaveState } from "../src/lib/autosave.ts";

type Draft = { title: string; content: string };
const equal = (a: Draft, b: Draft) => a.title === b.title && a.content === b.content;

/** A saver over a fake server: `calls` is what reached it, `fail` makes the next save refuse. */
function setup(initial: Draft = { title: "", content: "" }) {
  const calls: Draft[] = [];
  const states: AutosaveState[] = [];
  const control = { fail: false, gate: null as Promise<void> | null };
  const saver = new Autosaver<Draft>(initial, {
    equal,
    save: async (draft) => {
      calls.push(draft);
      if (control.gate) await control.gate;
      if (control.fail) throw new Error("offline");
    },
    onState: (state) => states.push(state),
  });
  return { saver, calls, states, control };
}

describe("Autosaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once, a moment after the owner stops typing", async () => {
    const { saver, calls, states } = setup();
    saver.set({ title: "a", content: "" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    saver.set({ title: "ab", content: "" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(calls).toEqual([]);
    expect(saver.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([{ title: "ab", content: "" }]);
    expect(saver.dirty).toBe(false);
    expect(states.at(-1)).toEqual({ phase: "saved" });
  });

  it("says it is saving from the first change", () => {
    const { saver, states } = setup();
    saver.set({ title: "a", content: "" });
    expect(states.at(-1)).toEqual({ phase: "saving" });
  });

  it("never saves a draft equal to what is saved, and typing back to it cancels the save", async () => {
    const { saver, calls, states } = setup({ title: "a", content: "" });
    saver.set({ title: "a", content: "" });
    saver.set({ title: "ab", content: "" });
    saver.set({ title: "a", content: "" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 2);
    expect(calls).toEqual([]);
    expect(states.at(-1)).toEqual({ phase: "saved" });
  });

  it("saves in the middle of typing that never pauses", async () => {
    const { saver, calls } = setup();
    for (let elapsed = 0; elapsed < AUTOSAVE_MAX_WAIT_MS; elapsed += 500) {
      saver.set({ title: "", content: `text ${elapsed}` });
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(calls.length).toBe(1);
  });

  it("flush saves at once and tells whether everything is saved", async () => {
    const { saver, calls } = setup();
    saver.set({ title: "a", content: "" });
    await expect(saver.flush()).resolves.toBe(true);
    expect(calls).toEqual([{ title: "a", content: "" }]);
    // Nothing left: the timer of the change does not save again.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS);
    expect(calls.length).toBe(1);
    await expect(saver.flush()).resolves.toBe(true);
    expect(calls.length).toBe(1);
  });

  it("what is typed during a save goes in the next one, never two saves at once", async () => {
    const { saver, calls, control } = setup();
    let open = () => {};
    control.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    saver.set({ title: "a", content: "" });
    const first = saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    saver.set({ title: "ab", content: "" });
    const second = saver.flush();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS);
    expect(calls).toEqual([{ title: "a", content: "" }]);
    control.gate = null;
    open();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(calls).toEqual([
      { title: "a", content: "" },
      { title: "ab", content: "" },
    ]);
    expect(saver.dirty).toBe(false);
  });

  it("a refused save keeps the text as unsaved, says why, and the next change tries again", async () => {
    const { saver, calls, states, control } = setup();
    control.fail = true;
    saver.set({ title: "a", content: "" });
    await expect(saver.flush()).resolves.toBe(false);
    expect(saver.dirty).toBe(true);
    expect(states.at(-1)).toMatchObject({ phase: "failed" });
    expect((states.at(-1) as { error: Error }).error.message).toBe("offline");
    // No loop of retries on its own.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS * 3);
    expect(calls.length).toBe(1);
    control.fail = false;
    saver.set({ title: "ab", content: "" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(calls.at(-1)).toEqual({ title: "ab", content: "" });
    expect(states.at(-1)).toEqual({ phase: "saved" });
  });

  it("held, it waits: nothing is saved over a version the owner has not chosen yet", async () => {
    const { saver, calls } = setup();
    saver.hold(true);
    saver.set({ title: "a", content: "" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS);
    await expect(saver.flush()).resolves.toBe(false);
    expect(calls).toEqual([]);
    saver.hold(false);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(calls).toEqual([{ title: "a", content: "" }]);
  });

  it("reset takes another version as the saved one and drops the pending save", async () => {
    const { saver, calls } = setup();
    saver.set({ title: "a", content: "" });
    saver.reset({ title: "theirs", content: "x" });
    expect(saver.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS);
    expect(calls).toEqual([]);
  });

  it("disposed, it never saves again", async () => {
    const { saver, calls } = setup();
    saver.set({ title: "a", content: "" });
    saver.dispose();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_WAIT_MS);
    await expect(saver.flush()).resolves.toBe(false);
    expect(calls).toEqual([]);
  });
});
