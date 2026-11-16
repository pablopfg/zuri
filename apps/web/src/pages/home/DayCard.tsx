import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgendaPage, Automation, GoogleStatus, MessageKey, Settings } from "@zuri/shared";
import { Check, ChevronDown, Clock, Flag, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { buttonClass, cn, ErrorNotice, Loading } from "../../components/ui.tsx";
import { TASKS_KEY, useTasks } from "../../hooks/productivity.ts";
import { SETTINGS_KEY } from "../../hooks/session.tsx";
import { addDays, GOOGLE_STATUS_KEY, localDate, localTime } from "../../lib/agenda.ts";
import { api } from "../../lib/api.ts";
import { arrangeDay, DAY_WINDOW, type DayItem, type DayKind, type DayRow, dayItems } from "../../lib/day.ts";
import { useI18n } from "../../lib/i18n.tsx";

/** How often the line of now moves and the list is arranged again. Only the browser's clock: no request. */
const TICK_MS = 30_000;
/** How many tasks late since earlier days show before "Mais N em Tarefas": a long backlog never pushes today down the page. */
const BACKLOG_SHOWN = 3;

const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
const ROW = "grid grid-cols-[4rem_1.25rem_minmax(0,1fr)] items-start gap-x-3 border-t border-border/60 py-3.5 first:border-t-0 sm:grid-cols-[4rem_1.25rem_minmax(0,1fr)_auto]";
const SIDE = "col-start-3 pt-px text-sm whitespace-nowrap text-fg-muted sm:col-start-4 sm:text-right";
const KINDS: Record<DayKind, MessageKey> = {
  task: "web.home.day.kind.task",
  event: "web.home.day.kind.event",
  routine: "web.home.day.kind.routine",
  approval: "web.home.day.kind.approval",
};
const MARK = "inline-flex items-center gap-1 font-semibold";

/** The hours "Seu dia" shows, for its heading. */
export function useDayWindow(): string {
  const { t } = useI18n();
  return t("web.home.day.window", useWindow().text);
}

/** The owner's working hours (Configurações › Agenda), as numbers and as "08:00". */
function useWindow() {
  // The session already read the settings: this is its answer, not a request of this card.
  const { from, to } = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api<Settings>("/settings"), staleTime: 5 * 60_000 }).data?.agenda ?? DAY_WINDOW;
  return { hours: { from, to }, text: { from: hour(from), to: hour(to) } };
}

/**
 * "Seu dia": today's tasks, events and routines around the line of now. What
 * passed is behind a curtain, closed until asked; what still asks for the
 * owner stays on top. The list arranges itself again every 30 seconds without
 * taking the focus from whoever is using the keyboard.
 */
/** What the line under the greeting says about today (PR S22): the open tasks, how many are late, the next event. */
export interface DaySummary {
  tasks: number;
  late: number;
  next: { title: string; at: number } | null;
}

export function DayCard({ automations, onNewDay, onSummary }: { automations: readonly Automation[]; onNewDay: () => void; onSummary?: (summary: DaySummary | null) => void }) {
  const { t, plural, locale, timeZone } = useI18n();
  const qc = useQueryClient();
  const pastId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  // Marked here in this visit. The server's "today" list drops a done task, the curtain keeps it (to see, and to undo);
  // one just unmarked stays here, as not done, until that list brings it back.
  const [marked, setMarked] = useState<ReadonlyMap<string, { item: DayItem; done: boolean }>>(new Map());
  const [error, setError] = useState<unknown>(null);
  const saving = useRef(new Set<string>());

  // What had the focus before the list is drawn again: a line that changes lists is a new element, and the focus goes back to it.
  const focused = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = focused.current;
    focused.current = null;
    if (!key || !root.current || root.current.contains(document.activeElement)) return;
    const targets = [...root.current.querySelectorAll<HTMLElement>("[data-focus]")];
    const same = targets.find((el) => el.dataset.focus === key && !el.closest("[inert]"));
    // Behind the closed curtain nothing takes focus: its button is the nearest place.
    (same ?? targets.find((el) => el.dataset.focus === "fold"))?.focus();
  });

  useEffect(() => {
    const tick = () => {
      const el = document.activeElement;
      focused.current = el instanceof HTMLElement && root.current?.contains(el) ? (el.dataset.focus ?? null) : null;
      setNow(new Date());
    };
    const timer = setInterval(tick, TICK_MS);
    // Timers sleep in a background tab: catch up when it comes back.
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const today = localDate(now, timeZone);
  // The same queries as the Tarefas page's "Hoje" tab and the Agenda's day view: one cache for both.
  const tasks = useTasks({ view: "today", projectId: "", q: "" });
  const google = useQuery({ queryKey: GOOGLE_STATUS_KEY, queryFn: ({ signal }) => api<GoogleStatus>("/google", { signal }) });
  const ready = !!google.data?.connected && !google.data.problem && google.data.calendars.some((calendar) => calendar.mode !== "off");
  const events = useQuery({
    queryKey: ["calendar", "events", today, today],
    queryFn: ({ signal }) => api<AgendaPage>(`/google/events?from=${today}&to=${today}`, { signal }),
    enabled: ready,
    // Each read costs one request to Google per open calendar: here it is a glance, read again at most every five minutes.
    // A change made in the Agenda, or noticed by Google's own signal, still refreshes it at once.
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });

  // Midnight with the page open: the server's "today" is another list now, and yesterday's marks are no longer of this day.
  const shownDay = useRef(today);
  useEffect(() => {
    if (shownDay.current === today) return;
    shownDay.current = today;
    setMarked(new Map());
    void qc.invalidateQueries({ queryKey: TASKS_KEY });
    onNewDay();
  }, [today, qc, onNewDay]);

  const live = dayItems({ tasks: (tasks.data?.tasks ?? []).filter((task) => task.status !== "done"), events: events.data?.events ?? [], automations }, now, timeZone);
  const liveKeys = new Set(live.map((item) => item.key));

  // The summary from the same lists, told to the page only when it changes (and only once the tasks are read).
  const nowMs = now.getTime();
  const openTasks = live.filter((item) => item.kind === "task");
  const nextEvent = live.filter((item) => item.kind === "event" && item.at !== null && item.at > nowMs && localDate(item.at, timeZone) === today).sort((a, b) => (a.at ?? 0) - (b.at ?? 0))[0];
  const summary: DaySummary | null = tasks.isSuccess
    ? {
        tasks: openTasks.length,
        late: openTasks.filter((item) => item.daysLate > 0 || (item.at !== null && item.at < nowMs)).length,
        next: nextEvent?.at ? { title: nextEvent.title, at: nextEvent.at } : null,
      }
    : null;
  const summaryKey = JSON.stringify(summary);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the summary, so a redraw with the same day tells nothing.
  useEffect(() => {
    onSummary?.(summary);
  }, [summaryKey, onSummary]);
  // A task marked done here hides the list's copy; one unmarked shows from here only until the list has it again.
  const done = new Set([...marked].filter(([, entry]) => entry.done).map(([key]) => key));
  const items = [...live.filter((item) => !done.has(item.key)), ...[...marked].filter(([key, entry]) => entry.done || !liveKeys.has(key)).map(([, entry]) => entry.item)];
  const window = useWindow();
  const day = arrangeDay(items, { now, timeZone, all, done, window: window.hours });

  async function toggle(row: DayRow) {
    // One save at a time per task: a second tap while the first is on its way would race it.
    if (saving.current.has(row.key)) return;
    saving.current.add(row.key);
    const mark = (entry: { item: DayItem; done: boolean } | null) =>
      setMarked((current) => {
        const next = new Map(current);
        if (entry) next.set(row.key, entry);
        else next.delete(row.key);
        return next;
      });
    focused.current = row.key;
    mark({ item: row, done: !row.done });
    setError(null);
    try {
      await api(`/tasks/${row.id}`, { method: "PATCH", body: { status: row.done ? "todo" : "done" } });
    } catch (err) {
      // Back to where it was, with the reason under the list.
      mark(row.done ? { item: row, done: true } : null);
      setError(err);
    } finally {
      // Free as soon as the save answers: the lists read again on their own time, and the next tap is not lost.
      saving.current.delete(row.key);
      void qc.invalidateQueries({ queryKey: TASKS_KEY });
    }
  }

  // "07/11" (or "11/07") for a day written as YYYY-MM-DD.
  const shortDay = (date: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit" }).format(new Date(`${date}T12:00:00Z`));
  const dayBefore = (at: number) => {
    const date = localDate(at, timeZone);
    return date === addDays(today, -1) ? t("web.home.day.yesterday") : shortDay(date);
  };

  const when = (row: DayRow) => {
    if (row.daysLate === 1) return t("web.home.day.yesterday");
    // Late for longer: the day it was due.
    if (row.daysLate > 1) return shortDay(addDays(today, -row.daysLate));
    // An event that began before today says the day, not an hour that reads as today's.
    if (row.at !== null) return localDate(row.at, timeZone) < today ? dayBefore(row.at) : localTime(row.at, timeZone);
    if (row.allDay) return t("web.home.day.allDay");
    return row.kind === "task" && !row.undated ? t("web.home.day.today") : "";
  };

  const side = (row: DayRow): ReactNode => {
    if (row.done) return t("web.home.day.done");
    if (row.kind === "approval")
      return (
        <Link to="/rotinas" data-focus={`${row.key}:review`} aria-label={t("web.home.day.reviewRoutine", { title: row.title })} className={buttonClass("secondary", "max-sm:mt-1.5 sm:-my-2.5")}>
          {t("web.home.day.review")}
        </Link>
      );
    if (row.pending)
      return (
        <span className={cn(MARK, "text-danger")}>
          <TriangleAlert className="h-4 w-4" aria-hidden />
          {t(row.daysLate > 0 ? "web.home.late" : "web.home.day.overdue")}
        </span>
      );
    if (row.current)
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 text-xs leading-6 font-semibold text-accent-text">
          <i className="h-1.5 w-1.5 rounded-full bg-current" />
          {t("web.home.day.current")}
        </span>
      );
    // An end after today would read as an hour of today: left out.
    if (row.until !== null) return localDate(row.until - 1, timeZone) > today ? null : t("web.home.day.until", { time: localTime(row.until, timeZone) });
    if (row.flagged)
      return (
        <span className={cn(MARK, "text-warning")}>
          <Flag className="h-4 w-4" aria-hidden />
          {t("web.home.day.high")}
        </span>
      );
    return row.undated ? t("web.home.day.doing") : null;
  };

  const line = (row: DayRow, gone = false) => (
    <li key={row.key} className={ROW}>
      <span className={cn("pt-px text-sm font-medium tabular-nums", row.pending ? "font-semibold text-warning" : gone ? "text-fg-muted" : "text-fg")}>{when(row)}</span>
      <span className="mt-px grid h-5 w-5 place-items-center">
        {row.kind === "event" ? (
          <i className={cn("h-2.5 w-2.5 rounded-full bg-accent ring-[3px] ring-accent-soft", gone && "opacity-55")} />
        ) : row.kind === "routine" ? (
          <Clock className="h-4 w-4 text-fg-muted" aria-hidden />
        ) : row.kind === "task" ? (
          // biome-ignore lint/a11y/useSemanticElements: a round mark that saves at once, as in the Tarefas list's look; a native checkbox can't hold the 44 px target around an 18 px mark.
          <button
            type="button"
            role="checkbox"
            aria-checked={row.done}
            aria-label={t("web.home.day.complete", { title: row.title })}
            data-focus={row.key}
            onClick={() => void toggle(row)}
            className="group -m-3 grid h-11 w-11 place-items-center rounded-full"
          >
            <span
              className={cn(
                "grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] transition-colors",
                row.done ? "border-accent bg-accent text-accent-fg" : "border-border-strong group-hover:border-accent group-hover:bg-accent-soft",
              )}
            >
              {row.done && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
            </span>
          </button>
        ) : (
          <i className="h-2.5 w-2.5 rounded-full bg-warning" />
        )}
      </span>
      <span className="min-w-0">
        <span className={cn("break-words", gone ? "text-fg-muted" : row.current ? "font-semibold" : "font-medium", row.done && "line-through decoration-border-strong")}>
          {row.kind === "approval" ? t("web.home.day.approve", { title: row.title }) : row.title}
        </span>
        <span className="sr-only">, {t(KINDS[row.kind])}</span>
        {row.detail && <span className="block text-sm break-words text-fg-muted">{row.detail}</span>}
      </span>
      <span className={SIDE}>{side(row)}</span>
    </li>
  );

  if (tasks.isPending) return <Loading />;
  if (tasks.isError) return <ErrorNotice error={tasks.error} onRetry={() => void tasks.refetch()} />;

  // Today's pending lines always show; only the backlog of earlier days is cut (it comes oldest first).
  const backlog = day.pending.filter((row) => row.daysLate > 0);
  const hiddenPending = Math.max(0, backlog.length - BACKLOG_SHOWN);
  const pendingShown = day.pending.filter((row) => row.daysLate === 0 || backlog.indexOf(row) < BACKLOG_SHOWN);
  const empty = items.length === 0;
  return (
    <div ref={root} className="rounded-2xl border border-border bg-surface px-5 py-1 shadow-sm">
      {(day.gone.length > 0 || day.pending.length > 0) && (
        <div className="flex min-h-12 items-center justify-between gap-3">
          {day.gone.length > 0 ? (
            <button
              type="button"
              data-focus="fold"
              aria-expanded={open}
              aria-controls={pastId}
              onClick={() => setOpen(!open)}
              className="-ml-1.5 inline-flex min-h-11 items-center gap-2 rounded-lg pr-2.5 pl-1.5 text-sm font-medium text-fg hover:bg-raised"
            >
              <ChevronDown className={cn("h-4 w-4 motion-safe:transition-transform", !open && "-rotate-90")} aria-hidden />
              {plural("web.home.day.gone", day.gone.length)}
            </button>
          ) : (
            <span />
          )}
          {day.pending.length > 0 && (
            <span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 text-xs leading-6 font-semibold whitespace-nowrap text-warning ring-1 ring-warning/30 ring-inset">
              <i className="h-1.5 w-1.5 rounded-full bg-current" />
              {plural("web.home.day.pending", day.pending.length)}
            </span>
          )}
        </div>
      )}
      {day.gone.length > 0 && (
        <div id={pastId} inert={!open} className={cn("grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <ul aria-label={t("web.home.day.goneList")} className="min-h-0 overflow-hidden border-t border-border/60">
            {day.gone.map((row) => line(row, true))}
          </ul>
        </div>
      )}
      {day.pending.length > 0 && (
        <ul aria-label={t("web.home.day.pendingList")} className="border-t border-border/60">
          {pendingShown.map((row) => line(row))}
          {hiddenPending > 0 && (
            <li className="border-t border-border/60">
              <Link to="/tarefas" data-focus="more" className="-mx-1.5 inline-flex min-h-11 items-center rounded-lg px-1.5 text-sm font-semibold text-fg underline underline-offset-4 hover:bg-raised">
                {plural("web.home.day.more", hiddenPending)}
              </Link>
            </li>
          )}
        </ul>
      )}
      {empty ? (
        <p className="py-4 text-sm text-fg-muted">{t("web.home.day.empty")}</p>
      ) : (
        <ul aria-label={t("web.home.day.restList")} className="border-t border-border/60 first:border-t-0">
          {day.rest.map((row) =>
            "now" in row ? (
              <li key="now" aria-label={t("web.home.day.now", { time: row.now })} className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-x-3 py-1">
                <span className="relative z-10 text-xs font-semibold tabular-nums text-danger">{row.now}</span>
                <span aria-hidden className="relative h-0.5 rounded-full bg-danger before:absolute before:-top-1 before:left-1 before:h-2.5 before:w-2.5 before:rounded-full before:bg-danger before:ring-[3px] before:ring-surface" />
              </li>
            ) : (
              line(row)
            ),
          )}
        </ul>
      )}
      {error !== null && (
        <div className="py-3">
          <ErrorNotice error={error} />
        </div>
      )}
      {events.isError && (
        <div className="py-3">
          <ErrorNotice error={events.error} onRetry={() => void events.refetch()} />
        </div>
      )}
      {day.outside > 0 && (
        <p className="border-t border-border/60 text-sm">
          <button
            type="button"
            data-focus="window"
            aria-pressed={all}
            onClick={() => setAll(!all)}
            className="-mx-1.5 inline-flex min-h-11 items-center rounded-lg px-1.5 font-semibold text-fg underline underline-offset-4 hover:bg-raised"
          >
            {all ? t("web.home.day.inside", window.text) : plural("web.home.day.outside", day.outside, window.text)}
          </button>
        </p>
      )}
    </div>
  );
}
