/**
 * How the Agenda shows the owner's days (Sinal, S08) and, since 13/11/2026,
 * when the office takes appointments: one place for both (rule
 * uma-fonte-por-ajuste). No schema here: the
 * screens import this file, and the schema lives in settings.ts (rule P11).
 */

/** The views of the Agenda screen. */
export const AGENDA_VIEWS = ["day", "week", "month"] as const;
export type AgendaView = (typeof AGENDA_VIEWS)[number];

export interface AgendaPrefs {
  /** The working hours the day and the week show: whole hours of the owner's clock, `to` exclusive (24 = midnight). */
  from: number;
  to: number;
  /** The view the Agenda opens in on a wide screen (a phone opens on the day). */
  view: AgendaView;
  /** The first day of the week: Sunday (0) or Monday (1). */
  weekStart: 0 | 1;
  /** The days the owner works, 0 (Sunday) to 6 (Saturday), in order. */
  workDays: number[];
  /** Whether the week also shows the days off. */
  daysOff: boolean;
  /** Whether events outside the working hours show without asking. */
  outside: boolean;
  /**
   * The lunch break, in minutes of the owner's clock (720 = 12:00), or none.
   * No appointment goes into it (13/11/2026): see agenda-rules.ts.
   */
  lunch: { from: number; to: number } | null;
  /**
   * Days off: periods from `from` to `to` ("YYYY-MM-DD", both included; one day
   * has from = to), such as a vacation, a break, a trip or a holiday of the
   * city, each with an optional reason. A national holiday always closes the
   * day by itself (13/11/2026: the owner never works on one).
   */
  closed: { from: string; to: string; reason: string }[];
}

export const DEFAULT_AGENDA_PREFS: AgendaPrefs = /* @__PURE__ */ Object.freeze({
  from: 8,
  to: 18,
  view: "week",
  weekStart: 1,
  workDays: [1, 2, 3, 4, 5],
  daysOff: true,
  outside: true,
  lunch: { from: 720, to: 840 },
  closed: [],
});
