import { type AgendaPrefs, appointmentProblem, CONFIRM_LINK_LIMITS as L, type RescheduleTurn } from "@zuri/shared";

/**
 * Rescheduling by the patient's link (E7b, docs/planos/link-de-confirmacao.md, section 15): which
 * hours of a day are free and which of them the page offers. Pure: the caller reads Google and the
 * owner's settings. Times are minutes of the day on the owner's wall clock.
 */

/** Something that takes time on the day: any timed event of any calendar read, cancelled ones left out. */
export interface Busy {
  start: number;
  end: number;
  /** An appointment (an event with a type): what the offer likes to sit next to. */
  appointment: boolean;
}

export interface TurnWindow {
  turn: RescheduleTurn;
  from: number;
  to: number;
}

type Hours = Pick<AgendaPrefs, "from" | "to" | "workDays" | "lunch" | "closed">;

/** Morning from the start to lunch, afternoon from lunch's end to the close; without lunch, noon splits them. */
export function turnsOf(hours: Pick<AgendaPrefs, "from" | "to" | "lunch">): TurnWindow[] {
  const open = hours.from * 60;
  const close = hours.to * 60;
  const split = hours.lunch ?? { from: 720, to: 720 };
  const out: TurnWindow[] = [
    { turn: "morning", from: open, to: Math.min(split.from, close) },
    { turn: "afternoon", from: Math.max(split.to, open), to: close },
  ];
  return out.filter((window) => window.to > window.from);
}

/** The hours of step 3: on the hour from the window's start, each with room for the appointment. */
export function gridOf(window: Pick<TurnWindow, "from" | "to">, length: number): number[] {
  const out: number[] = [];
  for (let start = window.from; start + length <= window.to; start += L.rescheduleStep) out.push(start);
  return out;
}

/**
 * The grid's hours that take the appointment on `day`: the booking rule passes (open day, hours,
 * lunch) and nothing of the day overlaps. Touching another event's start or end is free.
 */
export function freeIn(input: { day: string; window: TurnWindow; length: number; busy: readonly Busy[]; hours: Hours; today: string; nowMinute: number; exclude?: number | undefined }): number[] {
  const { window, length, busy } = input;
  return gridOf(window, length).filter(
    (start) =>
      start !== input.exclude &&
      !busy.some((other) => other.start < start + length && other.end > start) &&
      appointmentProblem({ day: input.day, start, end: start + length, today: input.today, nowMinute: input.nowMinute, hours: input.hours }) === null,
  );
}

/**
 * What step 4 offers (the patient never sees the rule):
 * 1. A half with an appointment: the free hours right before or after one, nearest the preferred hour first, up to 3.
 * 2. A half with an appointment but no such hour: the 2 of lowest score (minutes to an appointment plus 1.5 times
 *    the minutes to the preferred hour), in order of time.
 * 3. A half with no appointment: 2 drawn by `seed`, the same each time the page asks.
 */
export function offerOf(input: { window: TurnWindow; length: number; busy: readonly Busy[]; free: readonly number[]; pref: number; seed: Uint8Array }): number[] {
  const { window, length, free, pref } = input;
  const inside = input.busy.filter((other) => other.appointment && other.start < window.to && other.end > window.from);
  if (inside.length > 0) {
    const edges = inside.flatMap((other) => [other.start, other.end]);
    const next = free.filter((start) => edges.includes(start) || edges.includes(start + length));
    if (next.length > 0) return [...next].sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref) || a - b).slice(0, L.offerNext);
    // The prototype's score: nearer an appointment first, then nearer the preferred hour; a tie goes to the earlier.
    const gap = (start: number) => Math.min(...edges.map((edge) => Math.min(Math.abs(edge - start), Math.abs(edge - (start + length)))));
    const score = (start: number) => 2 + gap(start) / 60 + (Math.abs(start - pref) / 60) * 1.5;
    return [...free]
      .sort((a, b) => score(a) - score(b) || a - b)
      .slice(0, L.offerOther)
      .sort((a, b) => a - b);
  }
  const pool = [...free];
  const got: number[] = [];
  for (let i = 0; pool.length > 0 && got.length < L.offerOther; i++) {
    const at = i * 4;
    const n = (((input.seed[at] ?? 0) << 24) | ((input.seed[at + 1] ?? 0) << 16) | ((input.seed[at + 2] ?? 0) << 8) | (input.seed[at + 3] ?? 0)) >>> 0;
    got.push(pool.splice(n % pool.length, 1)[0] as number);
  }
  return got.sort((a, b) => a - b);
}
