import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AgendaEvent,
  type AgendaPage as AgendaWindow,
  type AgendaPrefs,
  type AppointmentProblem,
  type AgendaChange,
  AGENDA_RULES,
  closedPeriod,
  dayPlus,
  dayClosure,
  outsideHours,
  EVENT_PAYMENTS,
  EVENT_STATUS_COLOR,
  EVENT_STATUSES,
  type EventPayment,
  type EventStatus,
  GOOGLE_LIMITS,
  type GoogleCalendarInfo,
  HOME_COUNTRY,
  type GoogleStatus,
  type MessageKey,
  type NationalHoliday,
  nationalHoliday,
  ptBRAgenda,
  type Settings,
} from "@zuri/shared";
import { CalendarDays, CalendarOff, CalendarPlus, ChevronLeft, ChevronRight, Copy, Flag, MapPin, Palette, Pencil, RefreshCw, Repeat, Tag, Trash2, TriangleAlert, User, Users, Video, Wallet } from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link } from "react-router";
import { useToast } from "../../components/Toaster.tsx";
import { Button, cn, Dialog, EmptyState, ErrorNotice, Loading, Notice, PageHeader, SelectField, TextAreaField, TextField } from "../../components/ui.tsx";
import { SETTINGS_KEY } from "../../hooks/session.tsx";
import {
  AGENDA_VIEWS,
  type AgendaView,
  blankForm,
  changedFields,
  type DayBlock,
  dayEvents,
  daysOf,
  EVENT_COLORS,
  type EventForm,
  eventDays,
  eventLook,
  eventsOn,
  formAt,
  formBody,
  formLength,
  formOf,
  GOOGLE_STATUS_KEY,
  isDate,
  isFrozen,
  isTime,
  later,
  isWeekend,
  localDate,
  localTime,
  nowAt,
  OTHER_DURATION,
  planDay,
  shownDays,
  step,
  typeLine,
  typeName,
  viewRange,
  withoutType,
} from "../../lib/agenda.ts";
import { emailFits, KINDS, kindList, kindOf, maskPhone, type Place, patientBody, patientChanges, phoneFits, phoneText, placeOf, typeOf } from "../../lib/agenda-fields.ts";
import { applyChanges, clashes, type EventChanges, moveSlot, reschedules, resizeSlot, type Slot, STEP_MIN, slotChanges, slotOf, slotTimes } from "../../lib/agenda-edit.ts";
import { bookedOn, dayRefusal, freeStarts, hhmm, isAppointment, nextFree, slotProblem } from "../../lib/agenda-rules.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { play } from "../../lib/sounds.ts";
import { EVENTS_KEY, lostGoogle, useEventChanges } from "./changes.ts";
import { CountryField, DateField, TimeField } from "./AppointmentFields.tsx";
import { SyncSignal, syncKind } from "./SyncSignal.tsx";

// This screen's pt-BR texts travel with its code, not in the first bundle (rule P11).
addMessages(ptBRAgenda);

/** The palette's "Novo evento": an address and an event of that name (CommandPalette.tsx). */
export const NEW_EVENT = "novo-evento";
/** Events per day the month grid shows before "+N". */
const MONTH_SHOWN = 3;
/** How often the screen reads the clock again: the line of now walks, and at 0:00 today changes by itself. Only the browser's clock: no request. */
const TICK_MS = 30_000;
/** Where the week fits as a grid of hours (Tailwind's lg); below it the week is a strip of days over one day's list. */
const WIDE = "(min-width: 64rem)";
/** The height of one hour in the week's grid: 56 px, so the shortest block (BLOCK_MIN) is a 44 px target. */
const HOUR_REM = 3.5;
/** A press turns into a drag after this many pixels: a click that slips never moves an event. */
const DRAG_PX = 5;
/** How long the sync signal says "Salvo no Google" after a change went through. */
const SAVED_MS = 60_000;
/** An empty hour of the week opens "Novo evento" at the half hour clicked. */
const NEW_STEP_MIN = 30;

type T = ReturnType<typeof useI18n>["t"];
const VIEW_TEXT: Record<AgendaView, Parameters<T>[0]> = { day: "web.agenda.view.day", week: "web.agenda.view.week", month: "web.agenda.view.month" };
/** What the form asks to fix, each under its field (protótipo v52). */
type Problem = "title" | "name" | "day" | "start" | "endTime" | "end" | "kind" | "phone" | "email";

const PROBLEM_TEXT: Record<Problem, Parameters<T>[0]> = {
  title: "web.agenda.form.error.title",
  name: "web.agenda.form.error.name",
  day: "web.agenda.form.error.day",
  start: "web.agenda.form.error.start",
  endTime: "web.agenda.form.error.endTime",
  end: "web.agenda.form.error.endAfter",
  kind: "web.agenda.form.error.kind",
  phone: "web.agenda.form.error.phone",
  email: "web.agenda.form.error.email",
};

const PAYMENT_TEXT: Record<EventPayment, Parameters<T>[0]> = {
  unpaid: "web.agenda.payment.unpaid",
  paid: "web.agenda.payment.paid",
  free: "web.agenda.payment.free",
};

/** The type list's "Outro, digitar". */
const OTHER_KIND = "\u0000other";

const STATUS_TEXT: Record<EventStatus, Parameters<T>[0]> = {
  scheduled: "web.agenda.status.scheduled",
  confirmed: "web.agenda.status.confirmed",
  rescheduled: "web.agenda.status.rescheduled",
  cancelled: "web.agenda.status.cancelled",
};
const HOLIDAY_TEXT: Record<NationalHoliday, Parameters<T>[0]> = {
  newYear: "web.agenda.holiday.newYear",
  goodFriday: "web.agenda.holiday.goodFriday",
  tiradentes: "web.agenda.holiday.tiradentes",
  labourDay: "web.agenda.holiday.labourDay",
  independence: "web.agenda.holiday.independence",
  aparecida: "web.agenda.holiday.aparecida",
  allSouls: "web.agenda.holiday.allSouls",
  republic: "web.agenda.holiday.republic",
  blackAwareness: "web.agenda.holiday.blackAwareness",
  christmas: "web.agenda.holiday.christmas",
};
/** Google's names for its eleven event colors, by number. */
/** The short name of what refuses a drop, written on the block while it is dragged. */
const TAG_TEXT: Record<AppointmentProblem["code"], Parameters<T>[0]> = {
  step: "web.agenda.rule.tag.step",
  short: "web.agenda.rule.tag.short",
  long: "web.agenda.rule.tag.long",
  past: "web.agenda.rule.tag.past",
  far: "web.agenda.rule.tag.far",
  weekday: "web.agenda.rule.tag.weekday",
  holiday: "web.agenda.rule.tag.holiday",
  closed: "web.agenda.rule.tag.closed",
  hours: "web.agenda.rule.tag.hours",
  lunch: "web.agenda.rule.tag.lunch",
  clash: "web.agenda.rule.tag.clash",
};
const COLOR_TEXT: Record<string, Parameters<T>[0]> = {
  "1": "web.agenda.color.1",
  "2": "web.agenda.color.2",
  "3": "web.agenda.color.3",
  "4": "web.agenda.color.4",
  "5": "web.agenda.color.5",
  "6": "web.agenda.color.6",
  "7": "web.agenda.color.7",
  "8": "web.agenda.color.8",
  "9": "web.agenda.color.9",
  "10": "web.agenda.color.10",
  "11": "web.agenda.color.11",
};

/** The fill of a day without work: a national holiday first, then Saturday and Sunday. */
/** Configurações › Agenda, for every part of the screen: which days are closed and why (13/11/2026). */
// Never read outside the provider: the screen draws nothing before the settings arrive. The empty lists close no day.
const HoursContext = createContext<AgendaPrefs>({ from: 8, to: 18, view: "week", weekStart: 1, workDays: [1, 2, 3, 4, 5], daysOff: true, outside: true, lunch: null, closed: [] });

/** A closed holiday in its color, any other closed day (and the weekend) in the day-off one. */
function useDayFill() {
  const hours = useContext(HoursContext);
  return (day: string): string | undefined => {
    // A holiday on a Sunday is a holiday first, even though the weekday alone already closes it.
    if (nationalHoliday(day)) return "bg-holiday";
    return dayClosure(day, hours) || isWeekend(day) ? "bg-day-off" : undefined;
  };
}

/** "Sem expediente" (or its reason) for a day off of the settings, or null. */
function useClosedLabel() {
  const { t } = useI18n();
  const hours = useContext(HoursContext);
  return (day: string): string | null => {
    const off = closedPeriod(day, hours.closed);
    return off ? off.reason || t("web.agenda.closedDay") : null;
  };
}

/**
 * An appointment from today on that a change of the settings (or a booking made
 * at Google) left outside the office hours: it stays, marked (13/11/2026, 00:44).
 */
function outsideAppointment(event: AgendaEvent, hours: Pick<AgendaPrefs, "from" | "to" | "lunch" | "workDays" | "closed">, today: string, timeZone: string): boolean {
  if (!isAppointment(event)) return false;
  const slot = slotOf(event, timeZone);
  if (!slot || slot.day < today) return false;
  return !!dayClosure(slot.day, hours) || outsideHours(slot.start, slot.end, hours) !== null;
}

/** Two short low notes when a closed hour refuses a change: quiet, and only with the notice sound on. */
const REFUSAL_NOTES = [
  { f: 330, at: 0, dur: 0.14, gain: 0.08, type: "triangle" as const },
  { f: 247, at: 0.12, dur: 0.2, gain: 0.08, type: "triangle" as const },
];

/** "sex., 13/11" in the owner's language. */
function useShortDay() {
  const { locale } = useI18n();
  return (day: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" }).format(utcNoon(day)).replace(".", "");
}

/**
 * Why an appointment does not fit, in full: what the form, a refused drop and a closed hour say.
 * `own`: the page itself sits above the context it provides, so it hands its settings in.
 */
function useProblemText(own?: AgendaPrefs | undefined) {
  const { t } = useI18n();
  const shared = useContext(HoursContext);
  const hours = own ?? shared;
  const shortDay = useShortDay();
  const holidayOf = useHoliday();
  return (problem: AppointmentProblem, day: string): string => {
    const date = shortDay(day);
    switch (problem.code) {
      case "weekday":
        return t("web.agenda.rule.weekday", { day: date });
      case "holiday":
        return t("web.agenda.rule.holiday", { day: date, name: holidayOf(day) ?? "" });
      case "closed":
        return problem.reason ? t("web.agenda.rule.closedReason", { day: date, reason: problem.reason }) : t("web.agenda.rule.closed", { day: date });
      case "hours":
        return t("web.agenda.rule.hours", { from: hour(hours.from), to: hour(hours.to) });
      case "lunch":
        return t("web.agenda.rule.lunch", { from: hhmm(hours.lunch?.from ?? 0), to: hhmm(hours.lunch?.to ?? 0) });
      case "clash":
        return t("web.agenda.rule.clash", { title: problem.title || t("web.agenda.event.untitled"), from: hhmm(problem.start), to: hhmm(Math.min(problem.end, 1_440)) });
      case "step":
        return t("web.agenda.rule.step");
      case "short":
        return t("web.agenda.rule.short");
      case "long":
        return t("web.agenda.rule.long");
      case "past":
        return t("web.agenda.rule.past");
      case "far":
        return t("web.agenda.rule.far");
    }
  };
}

/** "Tiradentes" for a holiday's day, or null. The days are Brazil's, in the owner's language. */
function useHoliday() {
  const { t } = useI18n();
  return (day: string): string | null => {
    const holiday = nationalHoliday(day);
    return holiday ? t(HOLIDAY_TEXT[holiday]) : null;
  };
}

const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
const eventKey = (event: AgendaEvent) => `${event.calendarId}|${event.id}`;
const utcNoon = (day: string) => new Date(`${day}T12:00:00Z`);

function subscribeWide(change: () => void) {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}

function useWide() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches);
}

/** The clock, read again every half minute and when the tab comes back. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const read = () => setNow(Date.now());
    const id = window.setInterval(read, TICK_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  return now;
}

const eventsKey = (from: string, to: string) => [...EVENTS_KEY, from, to] as const;

/** `plain`: a personal event, offered when a closed hour refused an appointment: it starts without a type. */
type Editing = { mode: "new"; day: string; time?: string; minutes?: number; plain?: boolean; form?: EventForm } | { mode: "edit"; event: AgendaEvent };
/** "Escolher na agenda" (protótipo v52): the form put away while the owner taps a day and an hour. */
type Picking = { form: EventForm };
/** A refusal of the form: why, the field it points at, the hour asked and the next free one. */
type FormRefusal = { text: string; field: "date" | "start" | "end"; day: string; minute: number; next: { day: string; start: number } | null };
/** An hour that takes no appointment, clicked: why, and the next free one. */
/** A closed hour clicked, or a drop refused (`moving`: the appointment that stayed, and its length). */
type ClosedHour = { day: string; minute: number; why: string; next: { day: string; start: number } | null; moving?: { event: AgendaEvent; length: number } };
/** What a change did, for the words of its notice. */
type Changed = { kind: "moved" | "resized" | "updated"; rescheduled: boolean };
type Change = (event: AgendaEvent, changes: EventChanges, changed: Changed) => void;
/** What the preferences hide and the owner asked to see in this visit. */
type Reveal = { outside: boolean; daysOff: boolean };

/**
 * Agenda (step 19, redrawn in the Sinal S08): the owner's Google Calendar
 * events by day, week and month. It follows Google: a change made there arrives
 * by Google's push notice, which moves the "calendar" area, and the open screen
 * reads the window again. Only events change here, and only in calendars open
 * for editing (owner's choice of 03/11/2026).
 *
 * Today is the owner's zone's, never the device's, and it moves by itself at
 * 0:00. The working hours, the first day of the week and what stays hidden come
 * from Configurações › Agenda; whatever is hidden is counted beside "Mostrar".
 */
export function AgendaPage() {
  const { t, locale, timeZone } = useI18n();
  const toast = useToast();
  const status = useQuery({ queryKey: GOOGLE_STATUS_KEY, queryFn: ({ signal }) => api<GoogleStatus>("/google", { signal }) });
  // The session already read the settings: this is its answer, not a request of this screen.
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api<Settings>("/settings"), staleTime: 5 * 60_000 });
  const prefs = settings.data?.agenda;
  const wide = useWide();
  const now = useNow();
  const today = localDate(now, timeZone);
  // Until the owner picks one, the view is the preference's (a phone opens on the day) and the day is today, whichever day that becomes.
  const [chosen, setChosen] = useState<AgendaView | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const view = chosen ?? ((wide && prefs?.view) || "day");
  const anchor = picked ?? today;
  const go = (day: string) => setPicked(day === today ? null : day);
  const [reveal, setReveal] = useState<Reveal>({ outside: false, daysOff: false });
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<AgendaEvent | null>(null);
  // Counts the openings: each one gets a fresh dialog, and closing keeps it, so the focus goes back to where it came from.
  const [opening, setOpening] = useState(0);
  const show = (event: AgendaEvent) => {
    setOpening((count) => count + 1);
    setOpen(event);
  };
  const [editing, setEditing] = useState<Editing | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  // The form goes away while picking: the focus goes to the band's Cancelar, the way back by the keyboard.
  const pickingBand = useRef<HTMLDivElement>(null);
  const isPicking = !!picking;
  useEffect(() => {
    if (isPicking) pickingBand.current?.querySelector("button")?.focus();
  }, [isPicking]);
  const [closedHour, setClosedHour] = useState<ClosedHour | null>(null);
  const problemText = useProblemText(prefs);

  const ready = !!status.data?.connected && !status.data.problem && status.data.calendars.some((c) => c.mode !== "off");
  // The day reads its whole week: the strip of days changes day without a new request.
  const { from, to } = viewRange(view === "month" ? "month" : "week", anchor, prefs?.weekStart);
  const events = useQuery({
    queryKey: eventsKey(from, to),
    queryFn: ({ signal }) => api<AgendaWindow>(`/google/events?from=${from}&to=${to}`, { signal }),
    enabled: ready && !!prefs,
    // Back on the tab: Google may have changed while nobody looked (without a public address there is no push notice).
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
  // A reading refused because the access to Google was lost: the screen turns to "Conectar de novo".
  const qc = useQueryClient();
  useEffect(() => {
    if (events.error) lostGoogle(qc, events.error);
  }, [events.error, qc]);
  const calendars = events.data?.calendars ?? status.data?.calendars.filter((c) => c.mode !== "off") ?? [];
  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const writable = calendars.filter((c) => c.mode === "write" && c.writable);
  const shown = (events.data?.events ?? []).filter((event) => !hidden.has(event.calendarId));
  // The types the calendar already uses ("Consulta | Consultório"): the form offers them.
  const types = useMemo(() => [...new Set((events.data?.events ?? []).map((event) => typeLine(event.description)).filter(Boolean))].sort(), [events.data]);

  const { send, undo, forget, saving, savedAt, problem: changeProblem, log, note } = useEventChanges();
  // Read when Google answers: what else is at that hour by then.
  const onScreen = useRef(shown);
  onScreen.current = shown;
  /** Sends one change and, once Google takes it, says what happened to the event. */
  const change: Change = (event, changes, changed) =>
    void send(event, changes, (saved) => {
      const title = saved.title || t("web.agenda.event.untitled");
      const day = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" }).format(utcNoon(localDate(saved.start, timeZone))).replace(".", "");
      const said = [
        changed.kind === "moved"
          ? t("web.agenda.change.moved", { title, day, time: localTime(saved.start, timeZone) })
          : changed.kind === "resized"
            ? t("web.agenda.change.resized", { title, time: localTime(saved.end, timeZone) })
            : t("web.agenda.change.updated", { title }),
      ];
      if (changed.rescheduled) said.push(t("web.agenda.change.rescheduled"));
      if (saved.recurring) said.push(t("web.agenda.change.onlyThisDay"));
      if (clashes(saved, onScreen.current)) said.push(t("web.agenda.change.clash"));
      return said.join(" ");
    });
  /**
   * A refused drop opens the same notice as a closed hour, with the sound: a line at the foot of the
   * screen went unseen (Pablo, 13/11/2026 03:03). It offers to move the appointment to the next free hour.
   */
  const refuse = (event: AgendaEvent, slot: Slot, problem: AppointmentProblem) => {
    if (!prefs) return;
    if (settings.data?.sounds.notice !== false) play(REFUSAL_NOTES);
    const length = slot.end - slot.start;
    const next = nextFree({ prefs, events: events.data?.events ?? [], day: slot.day, minute: slot.start, until: to, now: Date.now(), timeZone, length, except: event });
    setClosedHour({ day: slot.day, minute: slot.start, why: problemText(problem, slot.day), next, moving: { event, length } });
  };
  /**
   * What stops an appointment from landing on `slot`: nothing for a meeting, or
   * for one that stays where it was. Once an appointment began, its day and
   * hours are fixed (Pablo, 13/11/2026): pulling its end is "in the past" too.
   */
  const slotCheck = (event: AgendaEvent, slot: Slot): AppointmentProblem | null => {
    if (!prefs || !isAppointment(event)) return null;
    const before = slotOf(event, timeZone);
    if (before && before.day === slot.day && before.start === slot.start && before.end === slot.end) return null;
    return slotProblem({ prefs, events: events.data?.events ?? [], except: event, day: slot.day, start: slot.start, end: slot.end, now: Date.now(), timeZone });
  };
  const moveTo = (event: AgendaEvent, slot: Slot) => {
    const problem = slotCheck(event, slot);
    if (problem) return refuse(event, slot, problem);
    const result = slotChanges(event, slot, eventLook(event, byId.get(event.calendarId)).status, timeZone);
    if (result) change(event, result.changes, { kind: result.moved ? "moved" : "resized", rescheduled: result.rescheduled });
  };
  /**
   * A click on an empty hour opens a new appointment there. An hour that takes
   * none (lunch, a holiday, the past) says why first, with the next free hour
   * and a personal event, which may go at any hour (13/11/2026, 01:04 item 5).
   */
  const newAt = (day: string, time: string) => {
    if (!prefs) return;
    const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const all = events.data?.events ?? [];
    if (picking) {
      // "Escolher na agenda": the form comes back with the day and the hour tapped, unless the hour takes no appointment.
      const length = formLength(picking.form);
      const problem = picking.form.type ? slotProblem({ prefs, events: all, day, start: minute, end: minute + length, now: Date.now(), timeZone }) : null;
      if (!problem) {
        setPicking(null);
        return setEditing({ mode: "new", day, form: formAt(picking.form, day, time) });
      }
      if (settings.data?.sounds.notice !== false) play(REFUSAL_NOTES);
      return setClosedHour({ day, minute, why: problemText(problem, day), next: nextFree({ prefs, events: all, day, minute, until: to, now: Date.now(), timeZone, length }) });
    }
    // Over an appointment already there, the hour is the owner's to see: the form tells the clash.
    const taken = bookedOn(all, day, timeZone).some((slot) => slot.start <= minute && slot.end > minute);
    // The form starts with an hour; the last half hour before lunch or the end of the day takes half an hour.
    const check = (length: number) => slotProblem({ prefs, events: all, day, start: minute, end: minute + length, now: Date.now(), timeZone });
    const problem = taken ? null : check(60);
    if (!problem) return setEditing({ mode: "new", day, time });
    if (!taken && !check(30)) return setEditing({ mode: "new", day, time, minutes: 30 });
    if (settings.data?.sounds.notice !== false) play(REFUSAL_NOTES);
    setClosedHour({ day, minute, why: problemText(problem, day), next: nextFree({ prefs, events: all, day, minute, until: to, now: Date.now(), timeZone }) });
  };
  // Ctrl or ⌘ + Z takes the last change back while its notice offers "Desfazer"; never over a field or an open dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable], dialog")) return;
      if (undo()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // "Novo evento" in the command palette: by the address on arrival, by an event when the page is open.
  const canCreate = writable.length > 0;
  useEffect(() => {
    if (!canCreate) return;
    const start = () => setEditing({ mode: "new", day: localDate(Date.now(), timeZone) });
    if (window.location.hash === `#${NEW_EVENT}`) {
      history.replaceState(history.state, "", window.location.pathname);
      start();
    }
    window.addEventListener(NEW_EVENT, start);
    return () => window.removeEventListener(NEW_EVENT, start);
  }, [canCreate, timeZone]);

  const header = (
    <PageHeader
      title={t("web.agenda.title")}
      description={t("web.agenda.description")}
      actions={
        ready && canCreate ? (
          <Button onClick={() => setEditing({ mode: "new", day: view === "month" || (view === "week" && wide) ? today : anchor })}>
            <CalendarPlus className="h-4 w-4" aria-hidden />
            {t("web.agenda.new")}
          </Button>
        ) : undefined
      }
    />
  );

  if (status.isError || settings.isError) {
    const failed = status.isError ? status : settings;
    return (
      <div className="space-y-6">
        {header}
        <ErrorNotice error={failed.error} onRetry={() => void failed.refetch()} />
      </div>
    );
  }
  if (status.isPending || !prefs) {
    return (
      <div className="space-y-6">
        {header}
        <Loading />
      </div>
    );
  }
  const google = status.data;
  if (!google.configured || !google.connected || google.problem || !ready) {
    const [title, body] = !google.configured
      ? ["web.agenda.notConnected.title", "web.agenda.notConfigured"]
      : !google.connected
        ? ["web.agenda.notConnected.title", "web.agenda.notConnected.body"]
        : google.problem
          ? ["web.agenda.notConnected.title", "web.agenda.problem"]
          : ["web.agenda.noneOpen.title", "web.agenda.noneOpen.body"];
    return (
      <div className="space-y-6">
        {header}
        <EmptyState icon={<CalendarDays className="h-6 w-6" />} title={t(title as Parameters<T>[0])}>
          <p>{t(body as Parameters<T>[0])}</p>
          {google.configured && (
            <Link to="/configuracoes/integracoes" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg hover:bg-accent-hover">
              {t("web.agenda.goIntegrations")}
            </Link>
          )}
        </EmptyState>
      </div>
    );
  }

  const week = view === "month" ? [] : daysOf(from, to);
  const grid = view === "week" && wide;
  // What the owner asked to see in this visit wins over the preference; the count is always of what the preference hides.
  const see = { from: prefs.from, to: prefs.to, outside: prefs.outside || reveal.outside };
  const columns = grid ? shownDays(week, { workDays: prefs.workDays, daysOff: prefs.daysOff || reveal.daysOff }) : [anchor];
  const left = { outside: 0, daysOff: new Set<string>() };
  if (view !== "month") {
    // Counted over the days on screen: a day off just shown brings its own out-of-hours events to this line (QA-S08-01).
    for (const day of columns) left.outside += dayEvents(shown, day, prefs, timeZone).outside;
    if (grid && !prefs.daysOff) {
      const working = new Set(shownDays(week, prefs));
      for (const day of week) if (!working.has(day)) for (const event of eventsOn(shown, day, timeZone)) left.daysOff.add(eventKey(event));
    }
  }
  const flip = (key: keyof Reveal) => setReveal((old) => ({ ...old, [key]: !old[key] }));
  const openDay = (day: string) => {
    go(day);
    setChosen("day");
  };

  return (
    <HoursContext.Provider value={prefs}>
    <div className="space-y-6">
      {header}
      <Toolbar
        view={view}
        onView={setChosen}
        from={view === "day" ? anchor : from}
        to={to}
        onStep={(direction) => go(step(view, anchor, direction))}
        onToday={() => setPicked(null)}
        loading={events.isFetching}
        signal={
          <SyncSignal
            kind={syncKind({ saving, problem: changeProblem?.kind ?? null, fetching: events.isFetching, readFailed: events.isError, readAt: events.dataUpdatedAt, savedAt, savedMs: SAVED_MS, now })}
            readAt={events.dataUpdatedAt}
            problem={changeProblem}
            log={log}
            onPull={() => void events.refetch()}
            // Only an event still on screen opens: one deleted at Google meanwhile has nothing to show.
            onShow={
              changeProblem && shown.some((each) => each.id === changeProblem.event.id && each.calendarId === changeProblem.event.calendarId)
                ? (failed) => {
                    const found = shown.find((each) => each.id === failed.event.id && each.calendarId === failed.event.calendarId);
                    if (found) show(found);
                  }
                : undefined
            }
          />
        }
      />
      {!canCreate && <Notice>{t("web.agenda.noWritable")}</Notice>}
      {events.data?.more && <Notice tone="warning">{t("web.agenda.more")}</Notice>}
      {events.isError && !events.data ? (
        <ErrorNotice error={events.error} onRetry={() => void events.refetch()} />
      ) : !events.data ? (
        <Loading rows={4} />
      ) : view === "month" ? (
        <MonthView anchor={anchor} from={from} to={to} today={today} events={shown} calendars={byId} onOpen={show} onDay={openDay} />
      ) : grid ? (
        <WeekGrid
          days={columns}
          today={today}
          now={now}
          hours={prefs}
          see={see}
          events={shown}
          calendars={byId}
          onOpen={show}
          onDay={openDay}
          movable={!saving}
          onFrozen={() => {
            if (settings.data?.sounds.notice !== false) play(REFUSAL_NOTES);
            toast(t("web.agenda.frozen.refused"));
          }}
          onMove={moveTo}
          onNew={canCreate ? newAt : undefined}
          check={slotCheck}
          tagOf={(problem) => t(TAG_TEXT[problem.code])}
        />
      ) : (
        <>
          <DayStrip days={week} day={anchor} today={today} onDay={go} />
          <HolidayBanner day={anchor} />
          <DayList day={anchor} events={dayEvents(shown, anchor, see, timeZone).events} calendars={byId} onOpen={show} />
        </>
      )}
      {view !== "month" && events.data && (
        <LeftOut
          rows={[
            { key: "outside", count: left.outside, text: "web.agenda.hidden.outside" },
            { key: "daysOff", count: left.daysOff.size, text: "web.agenda.hidden.daysOff" },
          ]}
          hours={{ from: hour(prefs.from), to: hour(prefs.to) }}
          reveal={reveal}
          onFlip={flip}
        />
      )}
      {events.isError && events.data && <ErrorNotice error={events.error} onRetry={() => void events.refetch()} />}
      {events.data && <Key statuses={canCreate} />}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Legend calendars={calendars} hidden={hidden} onToggle={(id) => setHidden((old) => toggle(old, id))} />
        <Link to="/configuracoes/agenda" className="ml-auto inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-medium text-accent-text hover:bg-raised">
          {t("web.agenda.settings")}
        </Link>
      </div>
      <EventDialog
        // A fresh dialog per opening: a delete half-confirmed never carries over.
        key={opening}
        event={open}
        calendar={open ? byId.get(open.calendarId) : undefined}
        frozen={open ? isFrozen(open, today, timeZone) : false}
        onClose={() => setOpen(null)}
        onSend={forget}
        onNote={note}
        // Only while the details still show that event: closed, or on another one, the answer changes nothing here.
        onChange={(saved) => setOpen((old) => (old && eventKey(old) === eventKey(saved) ? saved : old))}
        onEdit={(event) => {
          setOpen(null);
          setEditing({ mode: "edit", event });
        }}
      />
      {editing && (
        <EventFormDialog
          editing={editing}
          calendars={writable}
          types={types}
          busy={saving}
          prefs={prefs}
          events={events.data?.events ?? []}
          until={to}
          sound={settings.data?.sounds.notice !== false}
          onChange={change}
          // A phone shows the day as a list, with no hour to tap: there the calendar is the way.
          onPick={
            wide
              ? (form) => {
                  setEditing(null);
                  setPicking({ form });
                  // The month has no hours to tap: the week has.
                  if (view === "month") setChosen("week");
                }
              : undefined
          }
          onCreated={note}
          onClose={() => setEditing(null)}
        />
      )}
      {/* Room under the grid, so the last hours can scroll out from under the band. */}
      {picking && <div aria-hidden className="h-24" />}
      {picking && (
        <div ref={pickingBand} role="status" className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-2xl border border-accent/40 bg-surface p-3 shadow-lg lg:bottom-6">
          <CalendarPlus className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 text-sm">
            {!picking.form.type ? t("web.agenda.pick.bannerPlain") : picking.form.title.trim() ? t("web.agenda.pick.banner", { name: picking.form.title.trim() }) : t("web.agenda.pick.bannerNoName")}
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              setEditing({ mode: "new", day: picking.form.startDate, form: picking.form });
              setPicking(null);
            }}
          >
            {t("web.cancel")}
          </Button>
        </div>
      )}
      {closedHour && (
        <ClosedHourDialog
          closed={closedHour}
          onClose={() => setClosedHour(null)}
          onPlain={() => {
            setClosedHour(null);
            if (picking) {
              // The form typed so far, as a personal event at the hour tapped.
              setEditing({ mode: "new", day: closedHour.day, form: { ...formAt(picking.form, closedHour.day, hhmm(closedHour.minute)), type: "" } });
              setPicking(null);
            } else setEditing({ mode: "new", day: closedHour.day, time: hhmm(closedHour.minute), plain: true });
          }}
          onNext={(next) => {
            setClosedHour(null);
            go(next.day);
            if (closedHour.moving) moveTo(closedHour.moving.event, { day: next.day, start: next.start, end: next.start + closedHour.moving.length });
            else if (picking) {
              setEditing({ mode: "new", day: next.day, form: formAt(picking.form, next.day, hhmm(next.start)) });
              setPicking(null);
            } else setEditing({ mode: "new", day: next.day, time: hhmm(next.start) });
          }}
        />
      )}
    </div>
    </HoursContext.Provider>
  );
}

function toggle(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function Toolbar({
  view,
  onView,
  from,
  to,
  onStep,
  onToday,
  loading,
  signal,
}: { view: AgendaView; onView: (view: AgendaView) => void; from: string; to: string; onStep: (direction: 1 | -1) => void; onToday: () => void; loading: boolean; signal: ReactNode }) {
  const { t, locale } = useI18n();
  const label = rangeLabel(view, from, to, locale);
  return (
    // On a phone the period has its own line, then the arrows on the left and the views on the right (one under the other on the narrowest).
    <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
      {/* Read when the period changes, and while a new one is on its way. The week shows its days right below, so its period is spoken, not drawn. */}
      <h2 aria-live="polite" aria-busy={loading || undefined} className={cn("basis-full text-base font-semibold first-letter:uppercase lg:mr-auto lg:basis-auto", view === "week" && "sr-only")}>
        {label}
      </h2>
      <div className="flex items-center gap-1">
        <Button variant="ghost" className="px-3" aria-label={t("web.agenda.prev")} onClick={() => onStep(-1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <Button variant="secondary" onClick={onToday}>
          {t("web.agenda.today")}
        </Button>
        <Button variant="ghost" className="px-3" aria-label={t("web.agenda.next")} onClick={() => onStep(1)}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <fieldset className="flex rounded-xl border border-border bg-raised p-1 lg:order-2">
        <legend className="sr-only">{t("web.agenda.view.label")}</legend>
        {AGENDA_VIEWS.map((option) => (
          <label
            key={option}
            className={cn(
              "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg px-2.5 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent sm:px-3",
              view === option ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            <input type="radio" name="agenda-view" className="sr-only" checked={view === option} onChange={() => onView(option)} />
            {t(VIEW_TEXT[option])}
          </label>
        ))}
      </fieldset>
      {/* Every change goes to Google as it is made: this line says where that stands. Under the bar on a phone, before the views on a computer. */}
      <div role="status" className="flex basis-full items-center lg:order-1 lg:basis-auto">
        {signal}
      </div>
    </div>
  );
}

/** "segunda-feira, 9 de novembro de 2026", "9 – 15 de novembro de 2026" or "novembro de 2026", in the owner's language. */
function rangeLabel(view: AgendaView, from: string, to: string, locale: string): string {
  if (view === "day") return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(utcNoon(from));
  if (view === "week") return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).formatRange(utcNoon(from), utcNoon(to));
  // The grid starts in the week before: the month is the one of the middle day.
  const middle = daysOf(from, to)[15] ?? from;
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" }).format(utcNoon(middle));
}

function Legend({ calendars, hidden, onToggle }: { calendars: GoogleCalendarInfo[]; hidden: ReadonlySet<string>; onToggle: (id: string) => void }) {
  const { t } = useI18n();
  if (calendars.length < 2) return null;
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{t("web.agenda.calendars")}</legend>
      {calendars.map((calendar) => (
        // The whole pill is the target (44 px); a hidden calendar's pill fades.
        <label
          key={calendar.id}
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[input:not(:checked)]:opacity-60"
        >
          <input type="checkbox" className="sr-only" checked={!hidden.has(calendar.id)} onChange={() => onToggle(calendar.id)} />
          <Dot color={calendar.color} />
          <span className="max-w-48 truncate">{calendar.name}</span>
          {calendar.mode !== "write" && <span className="text-xs text-fg-muted">{t("web.agenda.readOnly")}</span>}
        </label>
      ))}
    </fieldset>
  );
}

function Dot({ color }: { color?: string | undefined }) {
  return <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" style={color ? { backgroundColor: color } : undefined} />;
}

/** What the fills and the colors mean: the four statuses (where some calendar can be edited), the weekend and the holiday. */
function Key({ statuses }: { statuses: boolean }) {
  const { t } = useI18n();
  const swatch = "h-3 w-5 shrink-0 rounded border border-border";
  return (
    <ul aria-label={t("web.agenda.legend")} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
      {statuses &&
        EVENT_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <Dot color={EVENT_COLORS[EVENT_STATUS_COLOR[status]]} />
            {t(STATUS_TEXT[status])}
          </li>
        ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className={cn(swatch, "bg-day-off")} />
        {t("web.agenda.legend.weekend")}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className={cn(swatch, "bg-holiday")} />
        {t("web.agenda.legend.holiday")}
      </li>
    </ul>
  );
}

/** Over a day's list: the holiday that day is, by name. */
function HolidayBanner({ day }: { day: string }) {
  const { t } = useI18n();
  const name = useHoliday()(day);
  const off = useClosedLabel()(day);
  if (off) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-day-off px-3 py-2 text-sm font-medium text-fg">
        <CalendarOff className="h-4 w-4 shrink-0" aria-hidden />
        {off === t("web.agenda.closedDay") ? t("web.agenda.closedDay.banner") : t("web.agenda.closedDay.label", { reason: off })}
      </p>
    );
  }
  if (!name) return null;
  return (
    <p className="flex items-center gap-2 rounded-xl bg-holiday px-3 py-2 text-sm font-medium text-holiday-text">
      <Flag className="h-4 w-4 shrink-0" aria-hidden />
      {t("web.agenda.holiday.label", { name })}
    </p>
  );
}

/** A closed hour clicked (13/11/2026, 01:04 item 5): the reason, the next free hour and a personal event, which goes anywhere. */
function ClosedHourDialog({
  closed,
  onClose,
  onPlain,
  onNext,
}: {
  closed: ClosedHour;
  onClose: () => void;
  onPlain: () => void;
  onNext: (next: { day: string; start: number }) => void;
}) {
  const { t } = useI18n();
  const shortDay = useShortDay();
  const next = closed.next;
  return (
    <Dialog open onClose={onClose} title={t("web.agenda.closedHour.title")}>
      <div className="space-y-4">
        <p role="alert" className="text-sm leading-6">
          {t("web.agenda.closedHour.when", { day: shortDay(closed.day), time: hhmm(closed.minute) })} {closed.why}
          {closed.moving && ` ${t("web.agenda.closedHour.stayed")}`}
        </p>
        {next && <p className="text-sm leading-6">{t("web.agenda.closedHour.next", { day: shortDay(next.day), time: hhmm(next.start) })}</p>}
        {!closed.moving && <p className="text-sm leading-6 text-fg-muted">{t("web.agenda.closedHour.personal")}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {closed.moving ? (
            next && (
              <Button variant="secondary" onClick={onClose}>
                {t("web.agenda.closedHour.ok")}
              </Button>
            )
          ) : (
            <Button variant="secondary" onClick={onPlain}>
              {t("web.agenda.closedHour.plain")}
            </Button>
          )}
          {next ? (
            <Button onClick={() => onNext(next)}>
              {t(closed.moving ? "web.agenda.closedHour.moveNext" : "web.agenda.closedHour.useNext")}
            </Button>
          ) : (
            <Button onClick={onClose}>
              {t("web.agenda.closedHour.ok")}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * What the preferences leave out of the period on screen, each with its count
 * and its own "Mostrar": nothing leaves the Agenda without saying so. Shown
 * once, the line stays, to hide again.
 */
function LeftOut({
  rows,
  hours,
  reveal,
  onFlip,
}: {
  rows: { key: keyof Reveal; count: number; text: "web.agenda.hidden.outside" | "web.agenda.hidden.daysOff" }[];
  hours: { from: string; to: string };
  reveal: Reveal;
  onFlip: (key: keyof Reveal) => void;
}) {
  const { t, plural } = useI18n();
  const some = rows.filter((row) => row.count > 0);
  if (some.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm text-fg-muted">
      {some.map((row) => {
        const text = plural(row.text, row.count, hours);
        return (
          <li key={row.key} className="flex flex-wrap items-center gap-x-2">
            <span>{text}</span>
            <button
              type="button"
              onClick={() => onFlip(row.key)}
              className="min-h-11 rounded-xl px-2 font-semibold text-accent-text hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t(reveal[row.key] ? "web.agenda.hidden.hide" : "web.agenda.hidden.show")}
              {/* The name starts with what is seen (WCAG 2.5.3) and then says what it shows. */}
              <span className="sr-only">, {text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "14:00 – 15:00", "Dia inteiro", or with the days when it spans more than one. */
function useWhen() {
  const { t, locale, timeZone } = useI18n();
  return (event: AgendaEvent, long = false): string => {
    const { first, last } = eventDays(event, timeZone);
    const options: Intl.DateTimeFormatOptions = long ? { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" } : { timeZone: "UTC", day: "numeric", month: "short" };
    const day = (d: string) => new Intl.DateTimeFormat(locale, options).format(utcNoon(d));
    if (event.allDay) return first === last ? (long ? `${day(first)} · ${t("web.agenda.allDay")}` : t("web.agenda.allDay")) : `${day(first)} – ${day(last)}`;
    const start = localTime(event.start, timeZone);
    const end = localTime(event.end, timeZone);
    if (first !== last) return `${day(first)} ${start} – ${day(last)} ${end}`;
    return long ? `${day(first)} · ${start} – ${end}` : `${start} – ${end}`;
  };
}

/** What a block of the week's grid adds to an event's button: it drags, and Alt + arrows move it. */
interface BlockHandlers {
  /** Names the keyboard's way of moving it, for a screen reader; only on an event that can move. */
  hint?: string | undefined;
  dragging: boolean;
  /** The short reason the place it is dragged to refuses it ("Almoço"): the block turns red and says it. */
  refused?: string | undefined;
  onGrab: (e: ReactPointerEvent, resize: boolean) => void;
  onKey: (e: ReactKeyboardEvent) => void;
  /** A click that ends a drag opens nothing. */
  skipClick: () => boolean;
}

/** An event as a small line of the month, as a chip of the week's rows around the hours (a 44 px target) or as a block of the week's grid. */
function EventButton({
  event,
  calendar,
  onOpen,
  block,
  chip = false,
  outside = false,
}: {
  event: AgendaEvent;
  calendar?: GoogleCalendarInfo | undefined;
  onOpen: (event: AgendaEvent) => void;
  block?: BlockHandlers | undefined;
  chip?: boolean;
  /** An appointment left outside the office hours: marked with an alert, never hidden. */
  outside?: boolean;
}) {
  const { t } = useI18n();
  const when = useWhen()(event);
  const look = eventLook(event, calendar);
  const type = typeName(typeLine(event.description));
  return (
    <button
      type="button"
      data-event={eventKey(event)}
      aria-describedby={block?.hint}
      onClick={() => {
        if (!block?.skipClick()) onOpen(event);
      }}
      onPointerDown={block ? (e) => block.onGrab(e, false) : undefined}
      onKeyDown={block?.onKey}
      className={cn(
        // The event's color (its status, or its calendar's) is the bar on the left and a light wash of the fill.
        "block w-full min-w-0 overflow-hidden rounded-lg border-l-4 border-l-(--event) bg-[color-mix(in_srgb,var(--event)_14%,var(--color-surface))] px-1.5 text-left text-xs hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:brightness-125",
        block ? "h-full py-0.5" : chip ? "min-h-11 py-1" : "min-h-7 py-1",
        block?.dragging && (block.refused ? "cursor-not-allowed shadow-lg ring-2 ring-danger" : "cursor-grabbing shadow-lg ring-2 ring-accent"),
      )}
      style={{ "--event": look.color ?? "var(--color-accent)" } as CSSProperties}
    >
      <span className={cn("flex min-w-0 items-center gap-1 font-semibold", (look.status === "cancelled" || event.changedAtGoogle === "deleted") && "line-through")}>
        {event.changedAtGoogle && (
          <>
            <RefreshCw className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <span className="sr-only">{t("web.agenda.record.mark")}: </span>
          </>
        )}
        {outside && (
          <>
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <span className="sr-only">{t("web.agenda.outsideMark")}: </span>
          </>
        )}
        <span className="truncate">{event.title || t("web.agenda.event.untitled")}</span>
      </span>
      {block?.refused && <span className="block truncate font-semibold text-danger">{block.refused}</span>}
      {/* The status in words too, never by the color alone: written in a block, where there is room, and spoken in a chip. */}
      {look.status && !block && <span className="sr-only">, {t(STATUS_TEXT[look.status])}</span>}
      {block ? (
        <span className="block truncate text-fg-muted">
          {when}
          {type ? ` · ${type}` : ""}
          {look.status ? ` · ${t(STATUS_TEXT[look.status])}` : ""}
          {event.location ? ` · ${event.location}` : ""}
        </span>
      ) : (
        <span className="sr-only">{when}</span>
      )}
    </button>
  );
}

/** The week over a day's list: seven days in a row, the chosen one filled, today marked. */
function DayStrip({ days, day, today, onDay }: { days: string[]; day: string; today: string; onDay: (day: string) => void }) {
  const { t, locale } = useI18n();
  const holidayOf = useHoliday();
  const dayFill = useDayFill();
  return (
    <nav aria-label={t("web.agenda.week")}>
      <ol className="grid grid-cols-7 gap-1">
        {days.map((each) => {
          const date = utcNoon(each);
          const full = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(date);
          const holiday = holidayOf(each);
          return (
            <li key={each}>
              <button
                type="button"
                onClick={() => onDay(each)}
                aria-pressed={each === day}
                aria-current={each === today ? "date" : undefined}
                className={cn(
                  "flex min-h-14 w-full flex-col items-center justify-center rounded-xl text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  each === day ? "bg-fg text-bg" : cn(dayFill(each), "hover:bg-raised"),
                )}
              >
                <span className={cn("text-xs", each !== day && "text-fg-muted")}>{new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" }).format(date).replace(".", "")}</span>
                <span className={cn("text-base font-semibold", each === today && each !== day && "text-accent-text")}>{date.getUTCDate()}</span>
                {/* The name starts with what is seen (WCAG 2.5.3) and then says where it goes. */}
                <span className="sr-only">
                  , {t("web.agenda.openDay", { date: full })}
                  {holiday ? `, ${t("web.agenda.holiday.label", { name: holiday })}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function DayList({ day, events, calendars, onOpen }: { day: string; events: AgendaEvent[]; calendars: Map<string, GoogleCalendarInfo>; onOpen: (event: AgendaEvent) => void }) {
  const { t, timeZone } = useI18n();
  const when = useWhen();
  if (events.length === 0) return <EmptyState icon={<CalendarDays className="h-6 w-6" />} title={t("web.agenda.empty.day")} />;
  return (
    <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-surface px-2 shadow-sm">
      {events.map((event) => {
        const { first, last } = eventDays(event, timeZone);
        // One day: the hour on the left and the end below. More than one: the whole period below, and the hour only on the day it starts.
        const rest = first === last ? (event.allDay ? "" : t("web.agenda.until", { time: localTime(event.end, timeZone) })) : when(event);
        const look = eventLook(event, calendars.get(event.calendarId));
        const under = [typeName(typeLine(event.description)), look.status ? t(STATUS_TEXT[look.status]) : "", rest, event.location].filter(Boolean).join(" · ");
        return (
          <li key={eventKey(event)}>
            <button
              type="button"
              onClick={() => onOpen(event)}
              className="grid min-h-14 w-full grid-cols-[4.5rem_0.625rem_minmax(0,1fr)] items-baseline gap-x-3 rounded-xl px-2 py-3 text-left hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {/* The title comes first for whoever listens; the hour is drawn first. */}
              <span className="col-start-3 row-start-1 min-w-0">
                <span className={cn("block break-words font-medium", (look.status === "cancelled" || event.changedAtGoogle === "deleted") && "line-through")}>
                  {event.changedAtGoogle && (
                    <>
                      <RefreshCw className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-warning" aria-hidden />
                      <span className="sr-only">{t("web.agenda.record.mark")}: </span>
                    </>
                  )}
                  {event.title || t("web.agenda.event.untitled")}
                </span>
                {under && <span className="block break-words text-sm text-fg-muted">{under}</span>}
              </span>
              <span className="col-start-1 row-start-1 text-sm text-fg-muted tabular-nums">
                {event.allDay ? t("web.agenda.allDay") : first === day ? localTime(event.start, timeZone) : ""}
              </span>
              <span className="col-start-2 row-start-1 self-center">
                <Dot color={look.color} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DayHeading({ day, today, onDay }: { day: string; today: string; onDay: (day: string) => void }) {
  const { t, locale } = useI18n();
  const date = utcNoon(day);
  const full = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(date);
  const holiday = useHoliday()(day);
  const off = useClosedLabel()(day);
  // Under the date: the holiday's name or "Sem expediente", where the "Dia todo" row used to say it (13/11/2026).
  const note = holiday ?? (off ? t("web.agenda.closedDay") : null);
  return (
    <button
      type="button"
      onClick={() => onDay(day)}
      aria-current={day === today ? "date" : undefined}
      className="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <span className={cn("text-xs font-semibold tracking-wide uppercase", day === today ? "text-accent-text" : "text-fg-muted")}>
        {new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" }).format(date).replace(".", "")}
      </span>
      <span className={cn("flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-lg font-semibold", day === today && "bg-accent text-accent-fg")}>{date.getUTCDate()}</span>
      {note && (
        <span aria-hidden className={cn("block max-w-full truncate px-1 text-[0.6875rem] leading-4 font-semibold", holiday ? "text-holiday-text" : "text-fg-muted")} title={holiday ?? off ?? undefined}>
          {note}
        </span>
      )}
      {/* The name starts with what is seen (WCAG 2.5.3) and then says where it goes. */}
      <span className="sr-only">
        , {t("web.agenda.openDay", { date: full })}
        {holiday ? `, ${t("web.agenda.holiday.label", { name: holiday })}` : ""}
        {off ? `, ${t("web.agenda.closedDay.label", { reason: off })}` : ""}
      </span>
    </button>
  );
}

const CELL = "min-w-0 border-t border-border";
const CHIPS = "space-y-1 p-1";

/**
 * The week as a grid of the working hours. Every day is one item of a list,
 * with its own rows (all day, before the hours, the hours, after them) lined up
 * with the other days' by a subgrid; the hours on the left are drawing only.
 * A row with nothing in any day takes no height.
 */
function WeekGrid({
  days,
  today,
  now,
  hours,
  see,
  events,
  calendars,
  onOpen,
  onDay,
  movable,
  onFrozen,
  onMove,
  onNew,
  check,
  tagOf,
}: {
  days: string[];
  today: string;
  now: number;
  hours: Pick<AgendaPrefs, "from" | "to" | "lunch" | "workDays" | "closed">;
  see: { outside: boolean };
  events: AgendaEvent[];
  calendars: Map<string, GoogleCalendarInfo>;
  onOpen: (event: AgendaEvent) => void;
  onDay: (day: string) => void;
  /** False while a change is on its way to Google: the next one waits for its answer. */
  movable: boolean;
  /** A drag of an event whose day already closed: refused with the sound and its notice. */
  onFrozen: () => void;
  onMove: (event: AgendaEvent, slot: Slot) => void;
  /** An empty hour was clicked; absent when no calendar can be edited. */
  onNew?: ((day: string, time: string) => void) | undefined;
  /** What stops an appointment from landing there, shown on the block while it moves (13/11/2026, 01:04 item 5). */
  check: (event: AgendaEvent, slot: Slot) => AppointmentProblem | null;
  tagOf: (problem: AppointmentProblem) => string;
}) {
  const { t, locale, timeZone } = useI18n();
  const toast = useToast();
  const dayFill = useDayFill();
  const hintId = useId();
  const list = useRef<HTMLOListElement>(null);
  /** Where the event being dragged, or moved by Alt + arrows, would land: drawn there, sent only when let go. */
  const [preview, setPreview] = useState<{ key: string; slot: Slot; keyboard: boolean } | null>(null);
  const skipClick = useRef(false);
  /** The event the keyboard moved: it keeps the focus when its block is drawn again in another day. */
  const keep = useRef<string | null>(null);
  const count = hours.to - hours.from;
  const original = (key: string) => events.find((event) => eventKey(event) === key);
  const writable = (event: AgendaEvent) => eventLook(event, calendars.get(event.calendarId)).editable;
  // A day that closed at midnight keeps its events where they were: dragging one says why, with the refusal's sound.
  const editable = (event: AgendaEvent) => writable(event) && !isFrozen(event, today, timeZone);
  const readOnly = (event: AgendaEvent) => (writable(event) ? onFrozen() : void toast(t("web.agenda.change.readOnly")));
  const block = (key: string) => list.current?.querySelector<HTMLElement>(`[data-event="${CSS.escape(key)}"]`);

  useLayoutEffect(() => {
    if (keep.current && document.activeElement === document.body) block(keep.current)?.focus();
  });

  /** The day and the minute under a point of the screen, and how many pixels a minute takes. */
  const at = (x: number, y: number) => {
    const columns = list.current?.getBoundingClientRect();
    const rows = list.current?.querySelector("[data-hours]")?.getBoundingClientRect();
    if (!columns || !rows || rows.height === 0) return null;
    const index = Math.min(Math.max(Math.floor(((x - columns.left) / columns.width) * days.length), 0), days.length - 1);
    const perMinute = rows.height / (count * 60);
    return { day: days[index] as string, minute: hours.from * 60 + (y - rows.top) / perMinute, perMinute };
  };

  /** A press on a block: past a few pixels it is a drag, of the whole event or of its end. A finger scrolls instead (the change is in "Editar"). */
  const grab = (e: ReactPointerEvent, key: string, resize: boolean) => {
    const event = original(key);
    if (e.button !== 0 || e.pointerType === "touch" || !event) return;
    const slot = slotOf(event, timeZone);
    const from = { x: e.clientX, y: e.clientY };
    let state: "pressed" | "dragging" | "refused" = "pressed";
    let latest: Slot | null = null;
    const move = (m: PointerEvent) => {
      if (state === "refused") return;
      if (state === "pressed") {
        if (Math.hypot(m.clientX - from.x, m.clientY - from.y) < DRAG_PX) return;
        if (!editable(event)) readOnly(event);
        state = slot && movable && editable(event) ? "dragging" : "refused";
        if (state === "refused") return;
      }
      const where = at(m.clientX, m.clientY);
      if (!where || !slot) return;
      latest = resize ? resizeSlot(slot, where.minute, hours) : moveSlot(slot, where.day, (m.clientY - from.y) / where.perMinute, hours);
      setPreview({ key, slot: latest, keyboard: false });
    };
    const finish = (drop: boolean, released = true) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onEscape);
      if (state === "pressed") return;
      // The click that follows the release belongs to the drag, also when Escape gave it up with the button still down.
      skipClick.current = true;
      const clear = () =>
        window.setTimeout(() => {
          skipClick.current = false;
        }, 0);
      if (released) clear();
      else window.addEventListener("pointerup", clear, { once: true });
      setPreview(null);
      if (drop && latest) onMove(event, latest);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const onEscape = (k: KeyboardEvent) => {
      if (k.key === "Escape") finish(false, false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onEscape);
  };

  /** Alt + arrows move the event a quarter of an hour or a day; with Shift, up and down change its length. Letting Alt go sends it. */
  const key = (e: ReactKeyboardEvent, id: string) => {
    if (e.key === "Escape" && preview?.keyboard) {
      e.preventDefault();
      setPreview(null);
      return;
    }
    const event = original(id);
    if (!e.altKey || !event || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    if (!editable(event)) return readOnly(event);
    const base = preview?.key === id ? preview.slot : slotOf(event, timeZone);
    if (!base || !movable) return;
    const down = e.key === "ArrowDown" ? STEP_MIN : e.key === "ArrowUp" ? -STEP_MIN : 0;
    let next = base;
    if (e.shiftKey) next = down ? resizeSlot(base, base.end + down, hours) : base;
    else if (down) next = moveSlot(base, base.day, down, hours);
    else {
      // Only to a day on screen: the event never leaves the owner's sight.
      const day = days[days.indexOf(base.day) + (e.key === "ArrowRight" ? 1 : -1)];
      if (day) next = moveSlot(base, day, 0, hours);
    }
    keep.current = id;
    setPreview({ key: id, slot: next, keyboard: true });
  };

  const previewEvent = preview ? original(preview.key) : undefined;
  const refused = preview && previewEvent ? check(previewEvent, preview.slot) : null;
  const drawn = preview ? events.map((event) => (eventKey(event) === preview.key ? applyChanges(event, slotTimes(preview.slot), timeZone) : event)) : events;
  const moving =
    preview?.keyboard === true
      ? t("web.agenda.change.preview", {
          day: new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(utcNoon(preview.slot.day)),
          from: slotTimes(preview.slot).start.slice(11),
          to: preview.slot.end === 24 * 60 ? "24:00" : slotTimes(preview.slot).end.slice(11),
        }) + (refused ? ` ${tagOf(refused)}` : "")
      : "";
  // Alt + Tab with the event half moved: Alt is let go somewhere else, so nothing is sent.
  const byKeyboard = preview?.keyboard === true;
  const release = useRef(() => {});
  release.current = () => {
    if (!preview?.keyboard) return;
    const event = original(preview.key);
    setPreview(null);
    if (event) onMove(event, preview.slot);
  };
  // Alt let go sends the move, wherever the focus is by then.
  useEffect(() => {
    if (!byKeyboard) return;
    const drop = () => setPreview(null);
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") release.current();
    };
    window.addEventListener("blur", drop);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("blur", drop);
      window.removeEventListener("keyup", up);
    };
  }, [byKeyboard]);
  const plans = days.map((day) => planDay(drawn, day, hours, timeZone));
  // All-day events sit under the days' names, without a row name of their own: the "Dia todo" line left on 13/11/2026.
  const allDayEvents = plans.some((plan) => plan.allDay.length > 0);
  const rows = {
    allDay: allDayEvents,
    before: see.outside && plans.some((plan) => plan.before.length > 0),
    after: see.outside && plans.some((plan) => plan.after.length > 0),
  };
  const height = `${count * HOUR_REM}rem`;
  // One line at the top of every hour, drawn once per column.
  const lines = { height, backgroundImage: `repeating-linear-gradient(to bottom, var(--color-border) 0 1px, transparent 1px ${HOUR_REM}rem)` };
  const side = "flex items-start justify-end px-2 pt-2 text-xs whitespace-nowrap text-fg-muted";
  const chips = (list: AgendaEvent[]) =>
    list.length > 0 ? (
      <ul className={CHIPS}>
        {list.map((event) => (
          <li key={eventKey(event)}>
            <EventButton event={event} calendar={calendars.get(event.calendarId)} onOpen={onOpen} chip />
          </li>
        ))}
      </ul>
    ) : null;
  return (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] grid-rows-[auto_auto_auto_auto_auto] overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div aria-hidden className="row-span-full grid grid-rows-subgrid">
        <div />
        <div className={cn(rows.allDay && CELL)} />
        <div className={cn(rows.before && CELL, rows.before && side, "bg-raised/60")}>{rows.before && t("web.agenda.row.before")}</div>
        <div className={cn(CELL, "relative")} style={{ height }}>
          {Array.from({ length: count }, (_, index) => hours.from + index).map((each) => (
            // The first hour's label sits under its line; the others straddle theirs.
            <span key={each} className={cn("absolute right-2 text-xs text-fg-muted tabular-nums", each > hours.from && "-translate-y-1/2")} style={{ top: `${(each - hours.from) * HOUR_REM}rem` }}>
              {hour(each)}
            </span>
          ))}
        </div>
        <div className={cn(rows.after && CELL, rows.after && side, "bg-raised/60")}>{rows.after && t("web.agenda.row.after")}</div>
      </div>
      <ol
        ref={list}
        onFocus={(e) => {
          if ((e.target as HTMLElement).dataset.event !== keep.current) keep.current = null;
        }}
        className="row-span-full grid grid-rows-subgrid select-none"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((day, index) => {
          const plan = plans[index];
          if (!plan) return null;
          const line = nowAt(now, day, hours, timeZone);
          return (
            <li key={day} className={cn("row-span-full grid min-w-0 grid-rows-subgrid border-l border-border", dayFill(day))}>
              <DayHeading day={day} today={today} onDay={onDay} />
              <div className={cn(rows.allDay && CELL)}>{allDayEvents && chips(plan.allDay)}</div>
              <div className={cn(rows.before && CELL, "bg-raised/60")}>{rows.before && chips(plan.before)}</div>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: a shortcut for the mouse; "Novo evento", at the top, does the same for everyone. */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: same. */}
              <div
                data-hours
                className={cn(CELL, "relative")}
                style={lines}
                onClick={
                  onNew &&
                  ((e) => {
                    // Only the empty hour itself: an event has its own click.
                    if (e.target !== e.currentTarget || skipClick.current) return;
                    const where = at(e.clientX, e.clientY);
                    if (!where) return;
                    const minute = Math.min(Math.max(Math.floor(where.minute / NEW_STEP_MIN) * NEW_STEP_MIN, hours.from * 60), hours.to * 60 - NEW_STEP_MIN);
                    onNew(day, slotTimes({ day, start: minute, end: minute }).start.slice(11));
                  })
                }
              >
                {hours.lunch && !dayClosure(day, hours) && hours.lunch.to > hours.from * 60 && hours.lunch.from < hours.to * 60 && (
                  // The lunch break as a striped band: no appointment goes there. Drawing only; the rule says it in words.
                  <span
                    aria-hidden
                    data-lunch
                    title={t("web.agenda.lunch")}
                    className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,var(--color-border)_0_1px,transparent_1px_7px)] opacity-80"
                    style={{
                      top: `${((Math.max(hours.lunch.from, hours.from * 60) - hours.from * 60) / (count * 60)) * 100}%`,
                      height: `${((Math.min(hours.lunch.to, hours.to * 60) - Math.max(hours.lunch.from, hours.from * 60)) / (count * 60)) * 100}%`,
                    }}
                  />
                )}
                {plan.blocks.length > 0 && (
                  <ul>
                    {plan.blocks.map((each) => {
                      const id = eventKey(each.event);
                      const dragging = preview?.key === id;
                      // What does not drag (more than one day) has no edge to pull and names no keys.
                      const moves = editable(each.event) && slotOf(each.event, timeZone) !== null;
                      return (
                        <li key={id} className={cn("absolute p-px", dragging && "z-20")} style={place(each)}>
                          <EventButton
                            event={each.event}
                            calendar={calendars.get(each.event.calendarId)}
                            onOpen={onOpen}
                            block={{
                              hint: moves ? hintId : undefined,
                              dragging,
                              refused: dragging && refused ? tagOf(refused) : undefined,
                              onGrab: (e, resize) => grab(e, id, resize),
                              onKey: (e) => key(e, id),
                              skipClick: () => skipClick.current,
                            }}
                            // While held, the block says only what the drop would meet.
                            outside={!dragging && outsideAppointment(each.event, hours, today, timeZone)}
                          />
                          {/* The lower edge pulls the end. Clicked without moving, it opens the event like the rest of the block. */}
                          {moves && (
                            <span
                              aria-hidden
                              data-resize
                              className="absolute inset-x-1 bottom-0 h-1.5 cursor-ns-resize rounded-b-lg hover:bg-(--color-border-strong)"
                              onPointerDown={(e) => grab(e, id, true)}
                              onClick={() => {
                                if (!skipClick.current) onOpen(each.event);
                              }}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {line !== null && (
                  <span aria-hidden data-now className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: `${line * 100}%` }}>
                    <span className="absolute -top-2.5 left-0 rounded bg-danger px-1 text-[0.625rem] leading-4 font-semibold text-surface tabular-nums">{localTime(now, timeZone)}</span>
                  </span>
                )}
              </div>
              <div className={cn(rows.after && CELL, "bg-raised/60")}>{rows.after && chips(plan.after)}</div>
            </li>
          );
        })}
      </ol>
      <p id={hintId} hidden>
        {t("web.agenda.change.keys")}
      </p>
      {/* Where Alt + arrows have the event now, said as it moves. */}
      <p aria-live="assertive" className="sr-only">
        {moving}
      </p>
    </div>
  );
}

/** Where a block goes in its day's column: down by its hour, across by its lane. */
function place(block: DayBlock) {
  return { top: `${block.top * 100}%`, height: `${block.height * 100}%`, left: `${(block.lane / block.lanes) * 100}%`, width: `${100 / block.lanes}%` };
}

function MonthView({
  anchor,
  from,
  to,
  today,
  events,
  calendars,
  onOpen,
  onDay,
}: { anchor: string; from: string; to: string; today: string; events: AgendaEvent[]; calendars: Map<string, GoogleCalendarInfo>; onOpen: (event: AgendaEvent) => void; onDay: (day: string) => void }) {
  const { t, plural, locale, timeZone } = useI18n();
  const holidayOf = useHoliday();
  const dayFill = useDayFill();
  const days = daysOf(from, to);
  const month = anchor.slice(0, 7);
  const names = days.slice(0, 7).map((day) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" }).format(utcNoon(day)).replace(".", ""));
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div aria-hidden className="grid grid-cols-7 py-2 text-center text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {names.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-px border-t border-border bg-border">
        {days.map((day) => {
          const list = eventsOn(events, day, timeZone);
          const date = utcNoon(day);
          const full = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(date);
          const holiday = holidayOf(day);
          return (
            <li key={day} className={cn("min-h-20 min-w-0 space-y-1 p-1 sm:min-h-28", day.slice(0, 7) === month ? (dayFill(day) ?? "bg-surface") : "bg-raised text-fg-muted")}>
              <button
                type="button"
                onClick={() => onDay(day)}
                aria-current={day === today ? "date" : undefined}
                className={cn(
                  "flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-semibold hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  day === today && "bg-accent text-accent-fg hover:bg-accent-hover",
                )}
              >
                {date.getUTCDate()}
                <span className="sr-only">
                  , {t("web.agenda.openDay", { date: full })}
                  {holiday ? `, ${t("web.agenda.holiday.label", { name: holiday })}` : ""}
                  {list.length ? `, ${plural("web.agenda.dayCount", list.length)}` : ""}
                </span>
              </button>
              {/* The name is already in the day's button for whoever listens; a phone has no room for it and keeps the fill. */}
              {holiday && day.slice(0, 7) === month && (
                <p aria-hidden className="hidden truncate px-1 text-[0.6875rem] leading-4 font-semibold text-holiday-text sm:block">
                  {holiday}
                </p>
              )}
              {/* Narrow screens: a dot per event (up to three); the day opens with the number. */}
              {list.length > 0 && (
                <span aria-hidden className="flex gap-0.5 px-1 sm:hidden">
                  {list.slice(0, 3).map((event) => (
                    <Dot key={eventKey(event)} color={eventLook(event, calendars.get(event.calendarId)).color} />
                  ))}
                </span>
              )}
              <ul className="hidden space-y-0.5 sm:block">
                {list.slice(0, MONTH_SHOWN).map((event) => (
                  <li key={eventKey(event)}>
                    <EventButton event={event} calendar={calendars.get(event.calendarId)} onOpen={onOpen} />
                  </li>
                ))}
                {list.length > MONTH_SHOWN && (
                  <li>
                    <button type="button" onClick={() => onDay(day)} className="min-h-7 rounded px-1.5 text-xs font-medium text-accent-text hover:bg-raised">
                      {plural("web.agenda.moreDay", list.length - MONTH_SHOWN)}
                    </button>
                  </li>
                )}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** `label` names the line for a screen reader when the line itself does not say what it is. */
function Detail({ icon, label, children }: { icon: ReactNode; label?: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span aria-hidden className="mt-0.5 text-fg-muted">
        {icon}
      </span>
      <div className="min-w-0">
        {label && <p className="sr-only">{label}</p>}
        <div className="break-words">{children}</div>
      </div>
    </div>
  );
}

function EventDialog({
  event,
  calendar,
  frozen,
  onClose,
  onSend,
  onChange,
  onEdit,
  onNote,
}: {
  event: AgendaEvent | null;
  calendar?: GoogleCalendarInfo | undefined;
  /** Its day closed at midnight (the record of the day): nothing in it changes any more. */
  frozen: boolean;
  onClose: () => void;
  /** The details are about to change or delete the event: an undo on offer names a version that is about to be old. */
  onSend: () => void;
  /** The event as Google answered after a change of status: the dialog stays open on it, with the new version. */
  onChange: (event: AgendaEvent) => void;
  onEdit: (event: AgendaEvent) => void;
  /** A line in "Últimas mudanças" of the sync signal: what happened, and whether it reached Google. */
  onNote: (text: string, ok: boolean) => void;
}) {
  const { t, plural } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const when = useWhen();
  const [confirming, setConfirming] = useState(false);
  const confirmId = useId();
  const [busy, setBusy] = useState(false);
  const look = event ? eventLook(event, calendar) : null;
  const editable = !!look?.editable && !frozen;
  const statusId = useId();
  const [marking, setMarking] = useState<EventStatus | null>(null);
  // Said inside the dialog: with it open, the rest of the page (and a toast there) is out of reach.
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  /** The status is the event's color at Google: one change, sent with the version on screen. */
  const mark = async (status: EventStatus) => {
    if (!event || marking || look?.status === status) return;
    setMarking(status);
    setNote(null);
    onSend();
    try {
      const body = { calendarId: event.calendarId, eventId: event.id, etag: event.etag, colorId: EVENT_STATUS_COLOR[status] };
      const saved = await api<{ event: AgendaEvent }>("/google/events", { method: "PATCH", body });
      onChange(saved.event);
      setNote({ text: t("web.agenda.status.saved"), failed: false });
      onNote(t("web.agenda.sync.lineAbout", { title: event.title || t("web.agenda.event.untitled"), text: t("web.agenda.status.saved") }), true);
    } catch (failure) {
      onNote(t("web.agenda.sync.lineAbout", { title: event.title || t("web.agenda.event.untitled"), text: errorMessage(failure) }), false);
      lostGoogle(qc, failure);
      // Changed or deleted at Google meanwhile: this dialog shows an old version, so it closes and the screen shows the event as it is now.
      if (failure instanceof ApiError && (failure.code === "TARGET_CHANGED" || failure.code === "NOT_FOUND")) {
        toast(errorMessage(failure));
        onClose();
      } else setNote({ text: errorMessage(failure), failed: true });
    } finally {
      setMarking(null);
      void qc.invalidateQueries({ queryKey: ["calendar", "events"] });
    }
  };
  const colorName = event?.colorId ? COLOR_TEXT[event.colorId] : undefined;
  // The appointment's type has its own line; the description shows without it.
  const type = event ? typeLine(event.description) : "";
  const rest = event ? withoutType(event.description) : "";
  const remove = async () => {
    if (!event) return;
    setBusy(true);
    onSend();
    try {
      await api("/google/events", { method: "DELETE", body: { calendarId: event.calendarId, eventId: event.id, etag: event.etag } });
      toast(t("web.agenda.deleted"));
      onNote(t("web.agenda.sync.lineAbout", { title: event.title || t("web.agenda.event.untitled"), text: t("web.agenda.deleted") }), true);
      onClose();
    } catch (failure) {
      toast(errorMessage(failure));
      onNote(t("web.agenda.sync.lineAbout", { title: event.title || t("web.agenda.event.untitled"), text: errorMessage(failure) }), false);
      lostGoogle(qc, failure);
    } finally {
      setBusy(false);
      // Deleted, or changed at Google in the meantime: either way the window is read again.
      void qc.invalidateQueries({ queryKey: ["calendar", "events"] });
    }
  };
  return (
    <Dialog open={event !== null} onClose={onClose} title={event ? event.title || t("web.agenda.event.untitled") : ""}>
      {event && (
        <div className="space-y-4">
          {editable && (
            <div className="space-y-2">
              <p id={statusId} className="text-sm text-fg-muted">
                {t("web.agenda.status.hint")}
              </p>
              <fieldset aria-label={t("web.agenda.status.label")} aria-describedby={statusId} className="grid min-w-0 grid-cols-2 gap-2">
                {EVENT_STATUSES.map((status) => {
                  const on = look?.status === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={on}
                      aria-busy={marking === status || undefined}
                      onClick={() => void mark(status)}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        on ? "border-(--event) bg-[color-mix(in_srgb,var(--event)_14%,var(--color-surface))]" : "border-border-strong hover:bg-raised",
                        marking && marking !== status && "opacity-60",
                      )}
                      style={{ "--event": EVENT_COLORS[EVENT_STATUS_COLOR[status]] } as CSSProperties}
                    >
                      <Dot color={EVENT_COLORS[EVENT_STATUS_COLOR[status]]} />
                      {t(STATUS_TEXT[status])}
                    </button>
                  );
                })}
              </fieldset>
              <p role="status" className={cn("text-sm", note?.failed ? "text-danger" : "text-fg-muted", !note && "sr-only")}>
                {note?.text}
              </p>
            </div>
          )}
          <div className="space-y-3">
            <Detail icon={<CalendarDays className="h-4 w-4" />} label={t("web.agenda.event.when")}>
              <span className="first-letter:uppercase">{when(event, true)}</span>
            </Detail>
            <Detail icon={<Dot color={calendar?.color} />} label={t("web.agenda.event.calendar")}>
              {calendar?.name ?? event.calendarId}
            </Detail>
            {look?.editable && (
              <Detail icon={<Palette className="h-4 w-4" />}>
                <span className="text-fg-muted">
                  {t("web.agenda.event.colorLine", {
                    color: look?.status
                      ? t("web.agenda.event.colorStatus", { color: t(colorName ?? "web.agenda.color.none"), status: t(STATUS_TEXT[look.status]) })
                      : t(colorName ?? "web.agenda.color.none"),
                  })}
                </span>
              </Detail>
            )}
            {type ? (
              <>
                <Detail icon={<Tag className="h-4 w-4" />} label={t("web.agenda.form.kind")}>
                  {kindOf(type)}
                </Detail>
                <AppointmentPlace event={event} place={placeOf(type)} />
                <Detail icon={<User className="h-4 w-4" />} label={t("web.agenda.event.patient")}>
                  <span>{t("web.agenda.event.unlinked")}</span>
                  {event.phone && <span className="block text-fg-muted">{phoneText(event.country ?? HOME_COUNTRY, event.phone)}</span>}
                  {event.email && <span className="block break-all text-fg-muted">{event.email}</span>}
                </Detail>
                <Detail icon={<Wallet className="h-4 w-4" />} label={t("web.agenda.event.payment")}>
                  {t(PAYMENT_TEXT[event.payment ?? "unpaid"])}
                </Detail>
                <Detail icon={<span className="block h-4 w-4" />} label={t("web.agenda.event.googleNote")}>
                  <p className="whitespace-pre-line text-fg-muted">
                    <span className="tabular-nums">{type}</span>
                    {rest && `\n${rest}`}
                  </p>
                </Detail>
              </>
            ) : (
              <>
                {event.location && (
                  <Detail icon={<MapPin className="h-4 w-4" />} label={t("web.agenda.event.location")}>
                    {event.location}
                  </Detail>
                )}
                {rest && (
                  <Detail icon={<span className="block h-4 w-4" />} label={t("web.agenda.event.description")}>
                    <p className="whitespace-pre-line text-fg-muted">{rest}</p>
                  </Detail>
                )}
              </>
            )}
            {event.recurring && (
              <Detail icon={<Repeat className="h-4 w-4" />} label={t("web.agenda.event.recurring")}>
                <span className="text-fg-muted">{t("web.agenda.event.recurring")}</span>
              </Detail>
            )}
            {event.guests > 0 && (
              <Detail icon={<Users className="h-4 w-4" />} label={plural("web.agenda.event.guests", event.guests)}>
                <span className="text-fg-muted">{plural("web.agenda.event.guests", event.guests)}</span>
              </Detail>
            )}
          </div>
          {frozen && look?.editable && (
            <p role="note" className="flex gap-2 rounded-xl border border-border px-3 py-2.5 text-sm text-fg-muted">
              {/* The closed day's icon, not a lock: an icon of its own would be one more file to fetch on the first load (P11). */}
              <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <b className="text-fg">{t("web.agenda.frozen.title")}</b> {t("web.agenda.frozen.body", { status: look.status ? t(STATUS_TEXT[look.status]) : t("web.agenda.frozen.noStatus") })}
              </span>
            </p>
          )}
          {event.changedAtGoogle && <Notice>{t(RECORD_TEXT[event.changedAtGoogle])}</Notice>}
          {!look?.editable && <Notice>{t("web.agenda.event.readOnly")}</Notice>}
          {confirming ? (
            <div className="space-y-3 rounded-xl border border-danger/40 bg-danger-soft p-3">
              <p id={confirmId} className="text-sm">
                {t("web.agenda.deleteConfirm", { title: event.title || t("web.agenda.event.untitled") })}
              </p>
              <fieldset aria-labelledby={confirmId} className="min-w-0 flex flex-wrap justify-end gap-2">
                <Button variant="secondary" autoFocus onClick={() => setConfirming(false)}>
                  {t("web.cancel")}
                </Button>
                <Button variant="danger" loading={busy} onClick={() => void remove()}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {t("web.agenda.delete")}
                </Button>
              </fieldset>
            </div>
          ) : (
            editable && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="danger" onClick={() => setConfirming(true)}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {t("web.agenda.delete")}
                </Button>
                <Button variant="secondary" onClick={() => onEdit(event)}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  {t("web.agenda.edit")}
                </Button>
              </div>
            )
          )}
        </div>
      )}
    </Dialog>
  );
}

/** What changed at Google after the day closed, in the details of the copy. */
/**
 * Where an appointment happens (protótipo v52): the Meet call with its link and "Copiar link", the
 * call Google is still making, or the office. Only Google's own Meet address is a link (the server checks it).
 */
function AppointmentPlace({ event, place }: { event: AgendaEvent; place: Place }) {
  const { t } = useI18n();
  const toast = useToast();
  if (place === "Consultório") {
    return (
      <Detail icon={<MapPin className="h-4 w-4" />} label={t("web.agenda.event.place")}>
        {t("web.agenda.event.office")}
        {event.location && <span className="block text-fg-muted">{event.location}</span>}
      </Detail>
    );
  }
  const url = event.meet?.startsWith("https://meet.google.com/") ? event.meet : null;
  return (
    <Detail icon={<Video className="h-4 w-4" />} label={t("web.agenda.event.place")}>
      {url ? (
        <span className="flex flex-wrap items-center gap-x-2">
          <span>{t("web.agenda.event.meet")} ·</span>
          <a href={url} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-accent-text underline-offset-2 hover:underline">
            {url.slice("https://".length)}
          </a>
          <Button
            variant="ghost"
            onClick={() => {
              // QA-E5e-05: a copy the browser refuses says so; the link is still there to open or select.
              const copied = navigator.clipboard?.writeText(url) ?? Promise.reject(new Error("no clipboard"));
              copied.then(
                () => toast(t("web.agenda.event.meetCopied")),
                () => toast(t("web.agenda.event.meetCopyFailed"), { failed: true }),
              );
            }}
          >
            <Copy className="h-4 w-4" aria-hidden />
            {t("web.agenda.event.meetCopy")}
          </Button>
        </span>
      ) : event.meet === "failed" ? (
        <span className="text-fg-muted">{t("web.agenda.event.meetFailed")}</span>
      ) : event.meet === undefined ? (
        // An online appointment from before the call (or made at Google without one): just the place.
        t("web.agenda.form.placeOnline")
      ) : (
        <span className="text-fg-muted">{t("web.agenda.event.meetPending")}</span>
      )}
    </Detail>
  );
}

const RECORD_TEXT = {
  changed: "web.agenda.record.changed",
  deleted: "web.agenda.record.deleted",
  added: "web.agenda.record.added",
} as const satisfies Record<AgendaChange, MessageKey>;

/** "30 min", "1 hora", "1 h 30". */
function useDuration() {
  const { t, plural } = useI18n();
  return (minutes: number): string => {
    const [h, m] = [Math.floor(minutes / 60), minutes % 60];
    return h === 0 ? t("web.agenda.form.minutes", { count: m }) : m === 0 ? plural("web.agenda.form.hours", h) : t("web.agenda.form.hoursMinutes", { hours: h, minutes: m });
  };
}

function EventFormDialog({
  editing,
  calendars,
  types,
  busy,
  prefs,
  events,
  until,
  sound,
  onChange,
  onPick,
  onCreated,
  onClose,
}: {
  editing: Editing;
  /** The last day the events read reach: the next free hour is looked for only up to it. */
  until: string;
  /** The notice sound is on: a refusal plays it. */
  sound: boolean;
  /** "Escolher na agenda": the form goes away, kept as it is, while a day and an hour are tapped. */
  /** Only where the Agenda has hours to tap (not on a phone). */
  onPick: ((form: EventForm) => void) | undefined;
  /** A new event reached Google, or did not: a line in "Últimas mudanças". */
  onCreated: (text: string, ok: boolean) => void;
  /** Configurações › Agenda: an appointment is checked against them before it goes (13/11/2026, 00:44). */
  prefs: AgendaPrefs;
  /** The events read, for a clash with another appointment. */
  events: readonly AgendaEvent[];
  /** Another change is on its way to Google: this one waits for its answer. */
  busy: boolean;
  calendars: GoogleCalendarInfo[];
  /** The types the calendar already uses, for the "Tipo" field. */
  types: string[];
  /** A change of an existing event: sent after the form closes, with its notice and "Desfazer". */
  onChange: Change;
  onClose: () => void;
}) {
  const { t, timeZone } = useI18n();
  const duration = useDuration();
  const toast = useToast();
  const qc = useQueryClient();
  const problemText = useProblemText();
  const shortDay = useShortDay();
  const initial = useMemo(() => {
    if (editing.mode === "edit") return formOf(editing.event, timeZone);
    if (editing.form) return editing.form;
    const blank = blankForm(editing.day, (calendars.find((c) => c.primary) ?? calendars[0])?.id ?? "", timeZone, Date.now(), editing.time, editing.minutes);
    // A new event is a "Consulta" at the office (plano E5e, item 1 dos fluxos), unless it is a personal one.
    return editing.plain ? blank : { ...blank, type: typeOf(KINDS[0], "Consultório") };
  }, [editing, calendars, timeZone]);
  // The phone as it is typed: "(41) 99999-0000" in Brazil.
  const [form, setForm] = useState<EventForm>(() => ({ ...initial, phone: maskPhone(initial.phone, initial.country) }));
  const [problem, setProblem] = useState<Problem | null>(null);
  /** The type picked: a kind of the list, "other" to write one, or "" for a plain event (protótipo v52). */
  const [kindChoice, setKindChoice] = useState(() => kindOf(initial.type));
  const [otherKind, setOtherKind] = useState("");
  const [place, setPlace] = useState<Place>(() => placeOf(initial.type));
  const appointment = kindChoice !== "";
  const kinds = kindList(types, initial.type);
  const listId = useId();
  /** The type line follows the kind and the place: "Consulta | Online". */
  const pickType = (choice: string, written: string, at: Place) => {
    setKindChoice(choice);
    setOtherKind(written);
    setPlace(at);
    set("type", choice === "" ? "" : typeOf(choice === OTHER_KIND ? written : choice, at));
  };
  /** What the booking rule refused, over the form: why, the field it points at and the next free hour (protótipo v52). */
  const [refusal, setRefusal] = useState<FormRefusal | null>(null);
  /** Said to a screen reader after "Usar este horário" or a free hour picked. */
  const [said, setSaid] = useState("");
  const fields = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => {
    setForm((old) => ({ ...old, [key]: value }));
    setProblem(null);
    setRefusal(null);
  };

  /** The rule's verdict on the form as it is, or null: only for an appointment whose day or hours are new. */
  const ruleProblem = (body: { allDay: boolean; start: string; end: string; description: string }) => {
    if (body.allDay || !form.type || form.status === "cancelled") return null;
    const before = editing.mode === "edit" ? formBody(initial) : null;
    const kept = before && typeof before !== "string" ? before : null;
    if (kept && kept.start === body.start && kept.end === body.end && initial.type !== "" && initial.status !== "cancelled") return null;
    const day = body.start.slice(0, 10);
    const minute = (at: string) => Math.round((Date.parse(`${at.slice(0, 10)}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 60_000) + Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
    const start = minute(body.start);
    const except = editing.mode === "edit" ? editing.event : null;
    const found = slotProblem({ prefs, events, except, day, start, end: minute(body.end), now: Date.now(), timeZone });
    if (!found) return null;
    const next = nextFree({ prefs, events, day, minute: start, until, now: Date.now(), timeZone, length: formLength(form), except });
    return { text: problemText(found, day), field: found.field, day, minute: start, next };
  };

  // A field to fix gets the focus, with its message under it.
  useEffect(() => {
    // An end before the start points at the end's hour; an all-day event has its own message.
    const field = problem === "end" && !form.allDay ? "endTime" : problem;
    const input = field ? fields.current?.querySelector<HTMLElement>(`[data-field="${field}"]`) : null;
    if (!input) return;
    input.focus();
    // The field shakes once, as in the prototype; styles.css stills it for reduced motion.
    input.classList.remove("shake");
    void input.offsetWidth;
    input.classList.add("shake");
  }, [problem, form.allDay]);

  /** The first field to fix, in the order of the form. */
  const check = (): Problem | null => {
    if (!form.title.trim()) return appointment ? "name" : "title";
    if (appointment && !phoneFits(form.country, form.phone)) return "phone";
    if (appointment && !emailFits(form.email)) return "email";
    if (!form.allDay) {
      if (!form.startDate) return "day";
      if (!form.startTime) return "start";
      if (form.duration === OTHER_DURATION && !form.endTime) return "endTime";
    }
    if (kindChoice === OTHER_KIND && !otherKind.trim()) return "kind";
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const first = check();
    if (first) {
      setProblem(first);
      return;
    }
    const body = formBody(form);
    if (typeof body === "string") {
      setProblem(body === "date" ? "day" : body);
      return;
    }
    // QA-E5e-01: the end is on the start's day ("no mesmo dia"). An event from Google over midnight keeps
    // its own days while its hours are left as they were.
    const before = editing.mode === "edit" ? formBody(initial) : null;
    const untouched = before && typeof before !== "string" && before.start === body.start && before.end === body.end;
    if (!body.allDay && body.end.slice(0, 10) !== body.start.slice(0, 10) && !untouched) {
      setProblem("end");
      return;
    }
    const patient = appointment ? patientBody(form) : null;
    if (typeof patient === "string") {
      setProblem(patient);
      return;
    }
    const meet = appointment && place === "Online";
    const refused = ruleProblem(body);
    if (refused) {
      // Over the form, with the sound: a line at its foot went unseen (Pablo, 13/11/2026 02:58).
      if (sound) play(REFUSAL_NOTES);
      setRefusal(refused);
      return;
    }
    if (editing.mode === "edit") {
      const changes: EventChanges = changedFields(initial, body);
      const before = formBody(initial);
      // A new day or hour marks the appointment "Reagendado", unless the owner picked a status here.
      const rescheduled = typeof before !== "string" && before.start !== body.start && form.status === initial.status && reschedules(body, form.status);
      const status = rescheduled ? "rescheduled" : form.status;
      if (status && status !== initial.status) changes.colorId = EVENT_STATUS_COLOR[status];
      const was = patientBody(initial);
      if (patient && typeof was !== "string") Object.assign(changes, patientChanges(was, patient));
      // SEC-E5e-03: an appointment that becomes a plain event takes the patient's fields off at Google too.
      const kept = editing.event;
      if (!appointment && (kept.country || kept.phone || kept.email || kept.payment)) Object.assign(changes, { country: "", phone: "", email: "", payment: "" });
      // SEC-E5e-02: only the place changed here asks for a call (Online) or takes it off (Presencial). Any other
      // change leaves Google's call as it is: a meeting made at Google keeps its link and its guests' link.
      if (appointment && place !== placeOf(initial.type)) changes.meet = meet;
      // QA-E5e-04: a call Google failed to make is asked for again on the next save.
      else if (meet && editing.event.meet === "failed") changes.meet = true;
      // The form closes first: the notice, with "Desfazer", is on the page, out of reach behind an open dialog.
      onClose();
      if (Object.keys(changes).length > 0) onChange(editing.event, changes, { kind: "updated", rescheduled });
      return;
    }
    setSaving(true);
    try {
      // Without a color the event counts as "Agendado": only another status is sent.
      const colorId = form.status && form.status !== "scheduled" ? { colorId: EVENT_STATUS_COLOR[form.status] } : {};
      const made = await api<{ event: AgendaEvent }>("/google/events", { method: "POST", body: { calendarId: form.calendarId, ...body, ...colorId, ...(patient ?? {}), ...(meet ? { meet: true } : {}) } });
      // QA-E5e-03: what Google answered about the call, never a link it did not make.
      const call = made.event.meet;
      const meetText = !meet ? "" : call?.startsWith("https://") ? t("web.agenda.meetMade") : call === "pending" ? t("web.agenda.event.meetPending") : t("web.agenda.event.meetFailed");
      // Who, when and the call, as the prototype says it (v52): "“Helena Prado” agendado para qua, 18/11 às 14:30."
      const at = { title: body.title, day: shortDay(form.startDate), time: form.startTime };
      const said = [t(appointment ? "web.agenda.booked" : "web.agenda.createdOn", at), meetText].filter(Boolean).join(" ");
      toast(said);
      onCreated(said, true);
      onClose();
    } catch (failure) {
      toast(errorMessage(failure), { failed: true });
      onCreated(t("web.agenda.sync.lineAbout", { title: body.title, text: errorMessage(failure) }), false);
      lostGoogle(qc, failure);
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: EVENTS_KEY });
    }
  };
  const error = (field: Problem) => (problem === field ? t(field === "phone" && form.country !== HOME_COUNTRY ? "web.agenda.form.error.phoneAbroad" : PROBLEM_TEXT[field]) : null);
  const length = formLength(form);
  const action = editing.mode === "new" ? t("web.agenda.form.create") : t("web.save");
  return (
    <Dialog open onClose={onClose} title={t(editing.mode === "new" ? "web.agenda.form.newTitle" : "web.agenda.form.editTitle")}>
      <form ref={fields} onSubmit={submit} className="space-y-4" noValidate>
        <TextField
          data-field={appointment ? "name" : "title"}
          label={t(appointment ? "web.agenda.form.patient" : "web.agenda.form.title")}
          value={form.title}
          maxLength={GOOGLE_LIMITS.titleMax}
          required
          autoFocus
          error={error(appointment ? "name" : "title")}
          onChange={(e) => set("title", e.target.value)}
        />
        {/* The patient's contact (12/11/2026): an appointment only; a plain event has none. */}
        {appointment && (
          <div className="grid gap-3 sm:grid-cols-3">
            <CountryField
              value={form.country}
              onChange={(country) => {
                set("country", country);
                set("phone", maskPhone(form.phone, country));
              }}
            />
            <TextField
              data-field="phone"
              label={t("web.agenda.form.phone")}
              inputMode="tel"
              autoComplete="off"
              value={form.phone}
              placeholder={t(form.country === HOME_COUNTRY ? "web.agenda.form.phonePlaceholder" : "web.agenda.form.phoneAbroad")}
              error={error("phone")}
              onChange={(e) => set("phone", maskPhone(e.target.value, form.country))}
            />
            <TextField
              data-field="email"
              type="email"
              label={t("web.agenda.form.email")}
              autoComplete="off"
              value={form.email}
              maxLength={254}
              placeholder={t("web.agenda.form.emailPlaceholder")}
              error={error("email")}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
        )}
        {editing.mode === "new" && calendars.length > 1 && (
          <SelectField label={t("web.agenda.form.calendar")} value={form.calendarId} onChange={(e) => set("calendarId", e.target.value)}>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
              </option>
            ))}
          </SelectField>
        )}
        {/* No "Dia todo" for a new event (13/11/2026): an all-day one from Google keeps its days. */}
        {form.allDay ? (
          <div className="grid grid-cols-2 gap-3">
            <DateField data-field="day" label={t("web.agenda.form.startDate")} value={form.startDate} required error={error("day")} onValue={(day) => set("startDate", day)} />
            <DateField
              data-field="end"
              label={t("web.agenda.form.endDate")}
              value={form.endDate}
              required
              error={problem === "end" ? t("web.agenda.form.error.endDay") : null}
              onValue={(day) => set("endDate", day)}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <DateField
                data-field="day"
                data-rule="date"
                label={t(appointment ? "web.agenda.form.visitDate" : "web.agenda.form.eventDate")}
                value={form.startDate}
                required
                className="col-span-2 sm:col-span-1"
                error={error("day")}
                onValue={(day) => {
                  setForm((old) => (day ? formAt(old, day, old.startTime) : { ...old, startDate: "" }));
                  setProblem(null);
                  setRefusal(null);
                }}
              />
              <TimeField
                data-field="start"
                data-rule="start"
                label={t("web.agenda.form.start")}
                list={`${listId}-starts`}
                value={form.startTime}
                required
                error={error("start")}
                onValue={(time) => {
                  // A new start keeps the length: the end goes with it.
                  setForm((old) => (time && old.startDate ? formAt(old, old.startDate, time) : { ...old, startTime: time }));
                  setProblem(null);
                  setRefusal(null);
                }}
              />
              <TimeField
                data-field="endTime"
                data-rule="end"
                label={t("web.agenda.form.end")}
                list={`${listId}-ends`}
                value={form.endTime}
                required
                error={error("endTime") ?? error("end")}
                onValue={(time) => {
                  setForm((old) => ({ ...old, duration: OTHER_DURATION, endDate: old.startDate, endTime: time }));
                  setProblem(null);
                  setRefusal(null);
                }}
              />
            </div>
            <datalist id={`${listId}-starts`}>
              {Array.from({ length: 96 }, (_, k) => (
                <option key={hhmm(k * 15)} value={hhmm(k * 15)} />
              ))}
            </datalist>
            <datalist id={`${listId}-ends`}>
              {isDate(form.startDate) && isTime(form.startTime) &&
                [15, 30, 45, 60, 90, 120, 180].map((minutes) => {
                  const end = later(form.startDate, form.startTime, minutes);
                  return end.date === form.startDate ? <option key={minutes} value={end.time} label={duration(minutes)} /> : null;
                })}
            </datalist>
            <p className="text-xs leading-5 text-fg-muted" aria-live="polite">
              {length === 60 ? (
                t("web.agenda.form.lengthDefault")
              ) : (
                <>
                  {t("web.agenda.form.lengthOwn", { length: duration(length) })}{" "}
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center font-medium text-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    onClick={() => {
                      setForm((old) => (old.startDate && old.startTime ? { ...formAt({ ...old, duration: "60" }, old.startDate, old.startTime) } : old));
                      setProblem(null);
                    }}
                  >
                    {t("web.agenda.form.lengthBack")}
                  </button>
                </>
              )}
            </p>
          </div>
        )}
        {!form.allDay && (
          <MiniCalendar
            form={form}
            prefs={prefs}
            except={editing.mode === "edit" ? editing.event : null}
            onDay={(day) => {
              setForm((old) => formAt(old, day, old.startTime));
              setProblem(null);
              setRefusal(null);
            }}
            onStart={(minute) => {
              setForm((old) => formAt(old, old.startDate, hhmm(minute)));
              setProblem(null);
              setRefusal(null);
              setSaid(t("web.agenda.pick.picked", { day: shortDay(form.startDate), time: hhmm(minute) }));
            }}
            onAgenda={editing.mode === "new" && onPick ? () => onPick(form) : undefined}
          />
        )}
        <p className="sr-only" aria-live="polite">
          {said}
        </p>
        <div className={cn("grid gap-3", appointment ? "sm:grid-cols-4" : "grid-cols-2")}>
          <div className="space-y-3">
            <SelectField
              label={t("web.agenda.form.kind")}
              value={kindChoice}
              onChange={(e) => pickType(e.target.value, e.target.value === OTHER_KIND ? otherKind : "", place)}
            >
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
              <option value={OTHER_KIND}>{t("web.agenda.form.kindOther")}</option>
              <option value="">{t("web.agenda.form.kindNone")}</option>
            </SelectField>
            {kindChoice === OTHER_KIND && (
              <TextField
                data-field="kind"
                label={t("web.agenda.form.kindWrite")}
                hint={t("web.agenda.form.kindWriteHint")}
                placeholder={t("web.agenda.form.kindPlaceholder")}
                maxLength={60}
                value={otherKind}
                error={error("kind")}
                onChange={(e) => pickType(OTHER_KIND, e.target.value, place)}
              />
            )}
          </div>
          {appointment && (
            <SelectField label={t("web.agenda.form.place")} value={place} onChange={(e) => pickType(kindChoice, otherKind, e.target.value === "Online" ? "Online" : "Consultório")}>
              <option value="Consultório">{t("web.agenda.form.placeOffice")}</option>
              <option value="Online">{t("web.agenda.form.placeOnline")}</option>
            </SelectField>
          )}
          <SelectField
            label={t("web.agenda.status.label")}
            value={form.status ?? ""}
            onChange={(e) => set("status", (EVENT_STATUSES.find((status) => status === e.target.value) ?? null) as EventForm["status"])}
          >
            {/* A color of the event's own at Google, outside the four: it stays until a status is picked. */}
            {initial.status === null && <option value="">{t("web.agenda.form.statusNone")}</option>}
            {EVENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(STATUS_TEXT[status])}
              </option>
            ))}
          </SelectField>
          {appointment && (
            <SelectField label={t("web.agenda.form.payment")} value={form.payment} onChange={(e) => set("payment", EVENT_PAYMENTS.find((payment) => payment === e.target.value) ?? "unpaid")}>
              {EVENT_PAYMENTS.map((payment) => (
                <option key={payment} value={payment}>
                  {t(PAYMENT_TEXT[payment])}
                </option>
              ))}
            </SelectField>
          )}
        </div>
        {appointment && place === "Online" && editing.mode === "new" && <p className="text-xs leading-5 text-fg-muted">{t("web.agenda.form.meetHint")}</p>}
        <TextAreaField
          label={t("web.agenda.form.note")}
          {...(form.type ? { hint: t("web.agenda.form.noteHint", { type: form.type }) } : {})}
          value={form.description}
          maxLength={GOOGLE_LIMITS.descriptionMax}
          rows={2}
          onChange={(e) => set("description", e.target.value)}
        />
        <p className="text-xs leading-5 text-fg-muted">{t("web.agenda.form.noGuests")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("web.cancel")}
          </Button>
          <Button type="submit" data-submit loading={saving || (busy && editing.mode === "edit")}>
            {action}
          </Button>
        </div>
        {refusal && (
          <FormAlert
            refusal={refusal}
            onFix={() => {
              setRefusal(null);
              // The focus goes to the field to fix: the day, the start or the length.
              fields.current?.querySelector<HTMLElement>(`[data-rule="${refusal.field}"]`)?.focus();
            }}
            onUse={(next) => {
              setForm((old) => formAt(old, next.day, hhmm(next.start)));
              setRefusal(null);
              setSaid(t("web.agenda.formAlert.used", { day: shortDay(next.day), time: hhmm(next.start), action }));
              fields.current?.querySelector<HTMLElement>("[data-submit]")?.focus();
            }}
          />
        )}
      </form>
    </Dialog>
  );
}

/**
 * The refusal over the form (protótipo v52): a dialog of its own on top, so nothing typed is lost.
 * Esc closes only it; "Corrigir" goes to the field; "Usar este horário" takes the next free hour.
 */
function FormAlert({ refusal, onFix, onUse }: { refusal: FormRefusal; onFix: () => void; onUse: (next: { day: string; start: number }) => void }) {
  const { t } = useI18n();
  const shortDay = useShortDay();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // The way out first: the next free hour when there is one, else "Corrigir".
    dialog?.querySelector<HTMLElement>("[data-use]")?.focus();
    return () => dialog?.close();
  }, []);
  const next = refusal.next;
  // Closing gives the focus back to the button that opened the notice, so close first and then move it.
  const fix = () => {
    ref.current?.close();
    onFix();
  };
  return (
    <dialog
      ref={ref}
      // biome-ignore lint/a11y/useSemanticElements: a modal <dialog> on top of the form's own; the role says it is an alert.
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-why`}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        fix();
      }}
      className="m-auto w-[calc(100%-3rem)] max-w-sm rounded-2xl border border-danger/40 bg-surface p-5 text-fg shadow-xl"
    >
      <p id={`${id}-title`} className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="h-4 w-4 shrink-0 text-danger" aria-hidden />
        {t("web.agenda.closedHour.title")}
      </p>
      <p id={`${id}-why`} className="mt-2 text-sm leading-6">
        {t("web.agenda.closedHour.when", { day: shortDay(refusal.day), time: hhmm(refusal.minute) })} {refusal.text}
      </p>
      {next && <p className="mt-2 text-sm leading-6 text-fg-muted">{t("web.agenda.closedHour.next", { day: shortDay(next.day), time: hhmm(next.start) })}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={fix}>
          {t("web.agenda.formAlert.fix")}
        </Button>
        {next && (
          <Button
            data-use
            onClick={() => {
              ref.current?.close();
              onUse(next);
            }}
          >
            {t("web.agenda.formAlert.use")}
          </Button>
        )}
      </div>
    </dialog>
  );
}

/** One month of events, read as the Agenda's month view reads it, under the same key: a month seen comes from the cache. */
function useMonthEvents(month: string, weekStart: AgendaPrefs["weekStart"], enabled: boolean) {
  const { from, to } = viewRange("month", `${month}-01`, weekStart);
  return useQuery({
    queryKey: eventsKey(from, to),
    queryFn: ({ signal }) => api<AgendaWindow>(`/google/events?from=${from}&to=${to}`, { signal }),
    enabled,
  });
}

/**
 * "Ver no calendário" (protótipo v52): the month of the form's day, the days that take no
 * appointment struck through, and the free hours of the day chosen as buttons. It reads the
 * month as the Agenda's month view does, under the same key: a month seen comes from the cache.
 */
function MiniCalendar({
  form,
  prefs,
  except,
  onDay,
  onStart,
  onAgenda,
}: {
  form: EventForm;
  prefs: AgendaPrefs;
  except: AgendaEvent | null;
  onDay: (day: string) => void;
  onStart: (minute: number) => void;
  /** Only for a new event. */
  onAgenda: (() => void) | undefined;
}) {
  const { t, locale, timeZone } = useI18n();
  const shortDay = useShortDay();
  const holidayOf = useHoliday();
  const duration = useDuration();
  const [open, setOpen] = useState(false);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(form.startDate) ? form.startDate : localDate(Date.now(), timeZone);
  const [month, setMonth] = useState(day.slice(0, 7));
  // The calendar follows the date typed in the form.
  useEffect(() => setMonth(day.slice(0, 7)), [day]);
  // A personal event (no type) is not checked: only the days gone are struck through, and no hours are offered.
  const plain = !form.type;
  // The month shown, for the days; the month of the form's day, for its hours (the same query when the two match).
  const monthEvents = useMonthEvents(month, prefs.weekStart, open);
  const dayEvents = useMonthEvents(day.slice(0, 7), prefs.weekStart, open && !plain);
  const length = formLength(form);
  const check = { prefs, length, now: Date.now(), timeZone, except };
  const why = (each: string, events: readonly AgendaEvent[] = monthEvents.data?.events ?? []): string | null => {
    const refusal = dayRefusal({ ...check, events, day: each });
    if (!refusal || (plain && refusal.kind !== "past")) return null;
    if (refusal.kind === "past") return t("web.agenda.pick.why.past");
    if (refusal.kind === "full") return t("web.agenda.pick.why.full");
    const closure = refusal.closure;
    if (closure.kind === "weekday") return t("web.agenda.pick.why.weekday");
    if (closure.kind === "holiday") return t("web.agenda.pick.why.holiday", { name: holidayOf(each) ?? "" });
    return t("web.agenda.pick.why.closed");
  };
  const days = Array.from({ length: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const ready = monthEvents.isSuccess;
  const reasons = new Map(ready ? days.map((each) => [each, why(each)]) : []);
  const lead = (weekdayIndex(days[0] ?? day) - prefs.weekStart + 7) % 7;
  const monthName = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" }).format(utcNoon(`${month}-01`));
  // 01/11/2026 is a Sunday: the column's weekday from the first day of the week of the settings.
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const weekday = (prefs.weekStart + i) % 7;
    return { weekday, name: new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "narrow" }).format(utcNoon(`2026-11-0${1 + weekday}`)) };
  });
  const full = (each: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(utcNoon(each));
  // From this month to the last one an appointment may reach: no arrow reads Google for a month nothing fits in.
  const today = localDate(Date.now(), timeZone);
  const first = today.slice(0, 7);
  const last = dayPlus(today, AGENDA_RULES.aheadDays).slice(0, 7);
  const shift = (by: number) => {
    const at = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
    setMonth(at.toISOString().slice(0, 7));
  };
  // Hours only from the events of the form's own day: no hour is offered from a month not read, or that failed.
  const hoursReady = open && !plain && dayEvents.isSuccess;
  const ownEvents = dayEvents.data?.events ?? [];
  const dayWhy = hoursReady ? why(day, ownEvents) : null;
  const starts = hoursReady && !dayWhy ? freeStarts({ ...check, events: ownEvents, day }) : [];
  const startNow = Number(form.startTime.slice(0, 2)) * 60 + Number(form.startTime.slice(3, 5));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
          <CalendarDays className="h-4 w-4" aria-hidden />
          {t(open ? "web.agenda.pick.calendarClose" : "web.agenda.pick.calendar")}
        </Button>
        {onAgenda && (
          <Button variant="secondary" onClick={onAgenda}>
            <CalendarPlus className="h-4 w-4" aria-hidden />
            {t("web.agenda.pick.agenda")}
          </Button>
        )}
      </div>
      {open && (
        <fieldset className="rounded-xl border border-border p-2">
          <legend className="sr-only">{t("web.agenda.pick.month", { month: monthName })}</legend>
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} disabled={month <= first} aria-label={t("web.agenda.pick.prevMonth")} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-fg-muted hover:bg-raised hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent">
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <b aria-live="polite" className="text-sm font-semibold first-letter:uppercase">
              {monthName}
            </b>
            <button type="button" onClick={() => shift(1)} disabled={month >= last} aria-label={t("web.agenda.pick.nextMonth")} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-fg-muted hover:bg-raised hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent">
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
          {monthEvents.isError ? (
            <ErrorNotice error={monthEvents.error} onRetry={() => void monthEvents.refetch()} />
          ) : !ready ? (
            <p className="p-2 text-sm text-fg-muted">{t("web.agenda.pick.loading")}</p>
          ) : (
            <>
              <div className="grid grid-cols-7 text-center text-sm">
                {weekdays.map(({ weekday, name }) => (
                  <span key={weekday} aria-hidden className="py-1 text-xs text-fg-muted">
                    {name}
                  </span>
                ))}
                {days.map((each, index) => {
                  const reason = reasons.get(each) ?? null;
                  return (
                    <button
                      key={each}
                      type="button"
                      disabled={!!reason}
                      aria-pressed={each === day}
                      aria-label={reason ? t("web.agenda.pick.dayWhy", { day: full(each), why: reason }) : full(each)}
                      onClick={() => onDay(each)}
                      // The first day sits under its weekday.
                      style={index === 0 ? { gridColumnStart: lead + 1 } : undefined}
                      className={cn(
                        "h-11 rounded-lg tabular-nums",
                        reason ? "cursor-not-allowed text-fg-muted line-through opacity-60" : each === day ? "bg-accent font-semibold text-accent-fg" : "hover:bg-raised",
                      )}
                    >
                      {Number(each.slice(8))}
                    </button>
                  );
                })}
              </div>
              {!plain && days.every((each) => reasons.get(each)) && <p className="p-2 text-sm text-fg-muted">{t("web.agenda.pick.monthFull")}</p>}
            </>
          )}
        </fieldset>
      )}
      {hoursReady && (
        <div className="space-y-2">
          {dayWhy ? (
            <p className="text-sm text-fg-muted">{t("web.agenda.pick.dayClosed", { why: dayWhy })}</p>
          ) : (
            <>
              <p id={`slots-${day}`} className="text-sm text-fg-muted">
                {t("web.agenda.pick.slots", { day: shortDay(day), length: duration(length) })}
              </p>
              <ul aria-labelledby={`slots-${day}`} className="flex flex-wrap gap-2">
                {starts.map((minute) => (
                  <li key={minute}>
                    <button
                      type="button"
                      aria-pressed={minute === startNow}
                      onClick={() => onStart(minute)}
                      className={cn(
                        "min-h-11 min-w-16 rounded-full border px-3 text-sm tabular-nums",
                        // The hover never paints over the one chosen: white on a light hover would be unreadable.
                        minute === startNow ? "border-accent bg-accent text-accent-fg" : "border-border hover:bg-raised",
                      )}
                    >
                      {hhmm(minute)}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 0 for Sunday to 6 for Saturday, of a "YYYY-MM-DD" day. */
const weekdayIndex = (day: string) => utcNoon(day).getUTCDay();
