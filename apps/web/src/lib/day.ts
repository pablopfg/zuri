import type { AgendaEvent, Automation, Task } from "@zuri/shared";
import { eventsOn, localDate, localTime } from "./agenda.ts";
import { dueInputs } from "./due.ts";
import { dayOffset } from "./recents.ts";

/**
 * "Seu dia" on the home page: today's tasks, events and routines in one list
 * around the line of now. What passed and asks nothing goes behind a curtain;
 * a task past its hour or a routine waiting for approval stays on top, as
 * pending. Everything here is the browser's clock over data already loaded:
 * no request of its own.
 */

/** The hours the list shows until asked for the rest. Fixed until the Agenda settings bring the owner's own (S08). */
export const DAY_WINDOW = { from: 8, to: 18 } as const;

export type DayKind = "task" | "event" | "routine" | "approval";

export interface DayItem {
  /** Unique in the list and stable between redraws: the kind and the id. */
  key: string;
  id: string;
  kind: DayKind;
  title: string;
  /** When it starts (a task's deadline, a routine's run); null with no hour: a day-only deadline, an all-day event, work under way. */
  at: number | null;
  /** Events only: when it ends. */
  until: number | null;
  /** Tasks only: how many days ago the deadline's day was (1 = yesterday). */
  daysLate: number;
  allDay: boolean;
  /** A task with no deadline (work under way). */
  undated: boolean;
  /** An event's place. */
  detail: string;
  /** A task of high or urgent priority. */
  flagged: boolean;
}

export interface DayRow extends DayItem {
  done: boolean;
  /** An event under way. */
  current: boolean;
  pending: boolean;
}

export interface DayView {
  gone: DayRow[];
  pending: DayRow[];
  /** What is ahead, with the line of now in its place. */
  rest: (DayRow | { now: string })[];
  /** How many items fall outside the window, shown or not (what is pending never does). */
  outside: number;
  /** "HH:MM" in the owner's zone. */
  now: string;
}

/** Today's items out of what the page loaded: the "today" tasks, the day's events and the routines. */
export function dayItems(data: { tasks: readonly Task[]; events: readonly AgendaEvent[]; automations: readonly Automation[] }, now: Date, timeZone: string): DayItem[] {
  const today = localDate(now, timeZone);
  const base = { until: null, daysLate: 0, allDay: false, undated: false, detail: "", flagged: false };
  return [
    ...data.tasks.map((task): DayItem => {
      const due = dueInputs(task.dueAt, timeZone);
      return {
        ...base,
        key: `task:${task.id}`,
        id: task.id,
        kind: "task",
        title: task.title,
        at: task.dueAt && due.time ? Date.parse(task.dueAt) : null,
        daysLate: task.dueAt && due.date < today ? -dayOffset(task.dueAt, now, timeZone) : 0,
        undated: task.dueAt === null,
        flagged: task.priority === "high" || task.priority === "urgent",
      };
    }),
    ...eventsOn(data.events, today, timeZone).map(
      (event): DayItem => ({
        ...base,
        key: `event:${event.calendarId}:${event.id}`,
        id: event.id,
        kind: "event",
        title: event.title,
        at: event.allDay ? null : Date.parse(event.start),
        until: event.allDay ? null : Date.parse(event.end),
        allDay: event.allDay,
        detail: event.location,
      }),
    ),
    ...data.automations.flatMap((routine): DayItem[] => {
      if (routine.status === "pending_approval") return [{ ...base, key: `approval:${routine.id}`, id: routine.id, kind: "approval", title: routine.name, at: null }];
      if (routine.status !== "active" || !routine.nextRunAt || localDate(routine.nextRunAt, timeZone) !== today) return [];
      return [{ ...base, key: `routine:${routine.id}`, id: routine.id, kind: "routine", title: routine.name, at: Date.parse(routine.nextRunAt) }];
    }),
  ];
}

/** Oldest late ones first, then what has no hour, then by the hour. */
function byTime(a: DayItem, b: DayItem): number {
  return b.daysLate - a.daysLate || (a.at ?? 0) - (b.at ?? 0);
}

export function arrangeDay(items: readonly DayItem[], options: { now: Date; timeZone: string; all: boolean; done: ReadonlySet<string> }): DayView {
  const { timeZone } = options;
  const now = options.now.getTime();
  const today = localDate(now, timeZone);
  const label = localTime(now, timeZone);
  // Minutes into today, in the owner's zone: 0 for an instant of an earlier day, the whole day for a later one.
  const minute = (at: number) => {
    const date = localDate(at, timeZone);
    if (date !== today) return date < today ? 0 : 24 * 60;
    const time = localTime(at, timeZone);
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  };
  const inWindow = (item: DayItem) => {
    if (item.at === null || item.daysLate > 0) return true;
    const [from, to] = [DAY_WINDOW.from * 60, DAY_WINDOW.to * 60];
    const start = minute(item.at);
    // An event counts while any part of it is inside: one that began at 07:30 and is under way at 08:15 shows.
    if (item.until !== null && item.until > item.at) return start <= to && minute(item.until) > from;
    return start >= from && start <= to;
  };
  const view: DayView = { gone: [], pending: [], rest: [], outside: 0, now: label };
  const ahead: DayRow[] = [];
  for (const item of [...items].sort(byTime)) {
    const done = options.done.has(item.key);
    const current = item.at !== null && item.until !== null && item.at <= now && now < item.until;
    const past = item.daysLate > 0 || (item.at !== null && !current && Math.max(item.at, item.until ?? item.at) <= now);
    // Only what the owner can still act on waits on top: an event or a routine's run just passes.
    const pending = !done && (item.kind === "approval" || (item.kind === "task" && past));
    // What is pending shows at any hour: a task due at 07:30 and not done is not hidden by the window.
    if (!pending && !inWindow(item)) {
      view.outside++;
      if (!options.all) continue;
    }
    const row = { ...item, done, current, pending };
    if (pending) view.pending.push(row);
    else if (past || done) view.gone.push(row);
    else ahead.push(row);
  }
  // What waits for a yes comes first: it is never more than a few, and a long backlog of late tasks would hide it.
  view.pending.sort((a, b) => Number(b.kind === "approval") - Number(a.kind === "approval"));
  const next = ahead.findIndex((row) => row.at !== null && row.at > now);
  const line = { now: label };
  view.rest = next === -1 ? [...ahead, line] : [...ahead.slice(0, next), line, ...ahead.slice(next)];
  return view;
}
