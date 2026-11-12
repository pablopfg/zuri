import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AgendaEvent,
  type AgendaPage as AgendaWindow,
  EVENT_STATUS_COLOR,
  EVENT_STATUSES,
  type EventStatus,
  GOOGLE_LIMITS,
  type GoogleCalendarInfo,
  type GoogleStatus,
  type NationalHoliday,
  nationalHoliday,
  ptBRAgenda,
  type Settings,
} from "@zuri/shared";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Flag, MapPin, Palette, Pencil, Repeat, Trash2, Users } from "lucide-react";
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Switch } from "../../components/Switch.tsx";
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
  type FormProblem,
  formBody,
  formOf,
  GOOGLE_STATUS_KEY,
  isWeekend,
  localDate,
  localTime,
  nowAt,
  planDay,
  shownDays,
  step,
  viewRange,
} from "../../lib/agenda.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";

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

type T = ReturnType<typeof useI18n>["t"];
const VIEW_TEXT: Record<AgendaView, Parameters<T>[0]> = { day: "web.agenda.view.day", week: "web.agenda.view.week", month: "web.agenda.view.month" };
const PROBLEM_TEXT: Record<FormProblem, Parameters<T>[0]> = {
  title: "web.agenda.form.error.title",
  date: "web.agenda.form.error.date",
  end: "web.agenda.form.error.end",
};

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
const dayFill = (day: string) => (nationalHoliday(day) ? "bg-holiday" : isWeekend(day) ? "bg-day-off" : undefined);

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

const eventsKey = (from: string, to: string) => ["calendar", "events", from, to] as const;

type Editing = { mode: "new"; day: string } | { mode: "edit"; event: AgendaEvent };
/** What the preferences hide and the owner asked to see in this visit. */
type Reveal = { allDay: boolean; outside: boolean; daysOff: boolean };

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
  const { t, timeZone } = useI18n();
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
  const [reveal, setReveal] = useState<Reveal>({ allDay: false, outside: false, daysOff: false });
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<AgendaEvent | null>(null);
  // Counts the openings: each one gets a fresh dialog, and closing keeps it, so the focus goes back to where it came from.
  const [opening, setOpening] = useState(0);
  const show = (event: AgendaEvent) => {
    setOpening((count) => count + 1);
    setOpen(event);
  };
  const [editing, setEditing] = useState<Editing | null>(null);

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
  const calendars = events.data?.calendars ?? status.data?.calendars.filter((c) => c.mode !== "off") ?? [];
  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const writable = calendars.filter((c) => c.mode === "write" && c.writable);
  const shown = (events.data?.events ?? []).filter((event) => !hidden.has(event.calendarId));

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
  const see = { from: prefs.from, to: prefs.to, allDay: prefs.allDay || reveal.allDay, outside: prefs.outside || reveal.outside };
  const columns = grid ? shownDays(week, { workDays: prefs.workDays, daysOff: prefs.daysOff || reveal.daysOff }) : [anchor];
  const left = { allDay: new Set<string>(), outside: 0, daysOff: new Set<string>() };
  if (view !== "month") {
    // Counted over the days on screen: a day off just shown brings its own all-day and out-of-hours events to these lines (QA-S08-01).
    for (const day of columns) {
      for (const event of eventsOn(shown, day, timeZone)) if (event.allDay && !prefs.allDay) left.allDay.add(eventKey(event));
      left.outside += dayEvents(shown, day, prefs, timeZone).outside;
    }
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
        <WeekGrid days={columns} today={today} now={now} hours={prefs} see={see} events={shown} calendars={byId} onOpen={show} onDay={openDay} />
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
            { key: "allDay", count: left.allDay.size, text: "web.agenda.hidden.allDay" },
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
        onClose={() => setOpen(null)}
        // Only while the details still show that event: closed, or on another one, the answer changes nothing here.
        onChange={(saved) => setOpen((old) => (old && eventKey(old) === eventKey(saved) ? saved : old))}
        onEdit={(event) => {
          setOpen(null);
          setEditing({ mode: "edit", event });
        }}
      />
      {editing && <EventFormDialog editing={editing} calendars={writable} onClose={() => setEditing(null)} />}
    </div>
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
}: { view: AgendaView; onView: (view: AgendaView) => void; from: string; to: string; onStep: (direction: 1 | -1) => void; onToday: () => void; loading: boolean }) {
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
      <fieldset className="flex rounded-xl border border-border bg-raised p-1">
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
  if (!name) return null;
  return (
    <p className="flex items-center gap-2 rounded-xl bg-holiday px-3 py-2 text-sm font-medium text-holiday-text">
      <Flag className="h-4 w-4 shrink-0" aria-hidden />
      {t("web.agenda.holiday.label", { name })}
    </p>
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
  rows: { key: keyof Reveal; count: number; text: "web.agenda.hidden.allDay" | "web.agenda.hidden.outside" | "web.agenda.hidden.daysOff" }[];
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

/** An event as a small line of the month, as a chip of the week's rows around the hours (a 44 px target) or as a block of the week's grid. */
function EventButton({
  event,
  calendar,
  onOpen,
  block = false,
  chip = false,
}: { event: AgendaEvent; calendar?: GoogleCalendarInfo | undefined; onOpen: (event: AgendaEvent) => void; block?: boolean; chip?: boolean }) {
  const { t } = useI18n();
  const when = useWhen()(event);
  const look = eventLook(event, calendar);
  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className={cn(
        // The event's color (its status, or its calendar's) is the bar on the left and a light wash of the fill.
        "block w-full min-w-0 overflow-hidden rounded-lg border-l-4 border-l-(--event) bg-[color-mix(in_srgb,var(--event)_14%,var(--color-surface))] px-1.5 text-left text-xs hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:brightness-125",
        block ? "h-full py-0.5" : chip ? "min-h-11 py-1" : "min-h-7 py-1",
      )}
      style={{ "--event": look.color ?? "var(--color-accent)" } as CSSProperties}
    >
      <span className={cn("block truncate font-semibold", look.status === "cancelled" && "line-through")}>{event.title || t("web.agenda.event.untitled")}</span>
      {/* The status in words too, never by the color alone: written in a block, where there is room, and spoken in a chip. */}
      {look.status && !block && <span className="sr-only">, {t(STATUS_TEXT[look.status])}</span>}
      {block ? (
        <span className="block truncate text-fg-muted">
          {when}
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
        const under = [look.status ? t(STATUS_TEXT[look.status]) : "", rest, event.location].filter(Boolean).join(" · ");
        return (
          <li key={eventKey(event)}>
            <button
              type="button"
              onClick={() => onOpen(event)}
              className="grid min-h-14 w-full grid-cols-[4.5rem_0.625rem_minmax(0,1fr)] items-baseline gap-x-3 rounded-xl px-2 py-3 text-left hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {/* The title comes first for whoever listens; the hour is drawn first. */}
              <span className="col-start-3 row-start-1 min-w-0">
                <span className={cn("block break-words font-medium", look.status === "cancelled" && "line-through")}>{event.title || t("web.agenda.event.untitled")}</span>
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
      {/* The name starts with what is seen (WCAG 2.5.3) and then says where it goes. */}
      <span className="sr-only">
        , {t("web.agenda.openDay", { date: full })}
        {holiday ? `, ${t("web.agenda.holiday.label", { name: holiday })}` : ""}
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
}: {
  days: string[];
  today: string;
  now: number;
  hours: { from: number; to: number };
  see: { allDay: boolean; outside: boolean };
  events: AgendaEvent[];
  calendars: Map<string, GoogleCalendarInfo>;
  onOpen: (event: AgendaEvent) => void;
  onDay: (day: string) => void;
}) {
  const { t, timeZone } = useI18n();
  const holidayOf = useHoliday();
  const plans = days.map((day) => planDay(events, day, hours, timeZone));
  const holidays = days.map(holidayOf);
  // A holiday's name sits in the all-day row, so the row shows for it even with the all-day events hidden.
  const allDayEvents = see.allDay && plans.some((plan) => plan.allDay.length > 0);
  const rows = {
    allDay: allDayEvents || holidays.some(Boolean),
    before: see.outside && plans.some((plan) => plan.before.length > 0),
    after: see.outside && plans.some((plan) => plan.after.length > 0),
  };
  const count = hours.to - hours.from;
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
        <div className={cn(rows.allDay && CELL, rows.allDay && side)}>{rows.allDay && t("web.agenda.allDay")}</div>
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
      <ol className="row-span-full grid grid-rows-subgrid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((day, index) => {
          const plan = plans[index];
          if (!plan) return null;
          const line = nowAt(now, day, hours, timeZone);
          return (
            <li key={day} className={cn("row-span-full grid min-w-0 grid-rows-subgrid border-l border-border", dayFill(day))}>
              <DayHeading day={day} today={today} onDay={onDay} />
              <div className={cn(rows.allDay && CELL)}>
                {holidays[index] && <p className="px-1.5 pt-1.5 pb-1 text-xs leading-4 font-semibold break-words text-holiday-text">{holidays[index]}</p>}
                {allDayEvents && chips(plan.allDay)}
              </div>
              <div className={cn(rows.before && CELL, "bg-raised/60")}>{rows.before && chips(plan.before)}</div>
              <div className={cn(CELL, "relative")} style={lines}>
                {plan.blocks.length > 0 && (
                  <ul>
                    {plan.blocks.map((block) => (
                      <li key={eventKey(block.event)} className="absolute p-px" style={place(block)}>
                        <EventButton event={block.event} calendar={calendars.get(block.event.calendarId)} onOpen={onOpen} block />
                      </li>
                    ))}
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
  onClose,
  onChange,
  onEdit,
}: {
  event: AgendaEvent | null;
  calendar?: GoogleCalendarInfo | undefined;
  onClose: () => void;
  /** The event as Google answered after a change of status: the dialog stays open on it, with the new version. */
  onChange: (event: AgendaEvent) => void;
  onEdit: (event: AgendaEvent) => void;
}) {
  const { t, plural } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const when = useWhen();
  const [confirming, setConfirming] = useState(false);
  const confirmId = useId();
  const [busy, setBusy] = useState(false);
  const look = event ? eventLook(event, calendar) : null;
  const editable = !!look?.editable;
  const statusId = useId();
  const [marking, setMarking] = useState<EventStatus | null>(null);
  // Said inside the dialog: with it open, the rest of the page (and a toast there) is out of reach.
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  /** The status is the event's color at Google: one change, sent with the version on screen. */
  const mark = async (status: EventStatus) => {
    if (!event || marking || look?.status === status) return;
    setMarking(status);
    setNote(null);
    try {
      const body = { calendarId: event.calendarId, eventId: event.id, etag: event.etag, colorId: EVENT_STATUS_COLOR[status] };
      const saved = await api<{ event: AgendaEvent }>("/google/events", { method: "PATCH", body });
      onChange(saved.event);
      setNote({ text: t("web.agenda.status.saved"), failed: false });
    } catch (failure) {
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
  const remove = async () => {
    if (!event) return;
    setBusy(true);
    try {
      await api("/google/events", { method: "DELETE", body: { calendarId: event.calendarId, eventId: event.id, etag: event.etag } });
      toast(t("web.agenda.deleted"));
      onClose();
    } catch (failure) {
      toast(errorMessage(failure));
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
            {editable && (
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
            {event.location && (
              <Detail icon={<MapPin className="h-4 w-4" />} label={t("web.agenda.event.location")}>
                {event.location}
              </Detail>
            )}
            {event.description && (
              <Detail icon={<span className="block h-4 w-4" />} label={t("web.agenda.event.description")}>
                <p className="whitespace-pre-line text-fg-muted">{event.description}</p>
              </Detail>
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
          {!editable && <Notice>{t("web.agenda.event.readOnly")}</Notice>}
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

function EventFormDialog({ editing, calendars, onClose }: { editing: Editing; calendars: GoogleCalendarInfo[]; onClose: () => void }) {
  const { t, timeZone } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const initial = useMemo(
    () => (editing.mode === "edit" ? formOf(editing.event, timeZone) : blankForm(editing.day, (calendars.find((c) => c.primary) ?? calendars[0])?.id ?? "", timeZone)),
    [editing, calendars, timeZone],
  );
  const [form, setForm] = useState<EventForm>(initial);
  const [problem, setProblem] = useState<FormProblem | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => {
    setForm((old) => ({ ...old, [key]: value }));
    setProblem(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = formBody(form);
    if (typeof body === "string") {
      setProblem(body);
      return;
    }
    setSaving(true);
    try {
      if (editing.mode === "new") {
        await api("/google/events", { method: "POST", body: { calendarId: form.calendarId, ...body } });
        toast(t("web.agenda.created"));
      } else {
        const changes = changedFields(initial, body);
        if (Object.keys(changes).length > 0) {
          await api("/google/events", { method: "PATCH", body: { calendarId: editing.event.calendarId, eventId: editing.event.id, etag: editing.event.etag, ...changes } });
        }
        toast(t("web.agenda.saved"));
      }
      onClose();
    } catch (failure) {
      toast(errorMessage(failure));
      // Changed or deleted at Google meanwhile: this form holds an old version, so it closes and the
      // screen shows the event as it is now, to open again.
      if (editing.mode === "edit" && failure instanceof ApiError && (failure.code === "TARGET_CHANGED" || failure.code === "NOT_FOUND")) onClose();
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: ["calendar", "events"] });
    }
  };

  const error = problem ? t(PROBLEM_TEXT[problem]) : null;
  return (
    <Dialog open onClose={onClose} title={t(editing.mode === "new" ? "web.agenda.form.newTitle" : "web.agenda.form.editTitle")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField
          label={t("web.agenda.form.title")}
          value={form.title}
          maxLength={GOOGLE_LIMITS.titleMax}
          required
          autoFocus
          error={problem === "title" ? error : null}
          onChange={(e) => set("title", e.target.value)}
        />
        {editing.mode === "new" && calendars.length > 1 && (
          <SelectField label={t("web.agenda.form.calendar")} value={form.calendarId} onChange={(e) => set("calendarId", e.target.value)}>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
              </option>
            ))}
          </SelectField>
        )}
        <Switch label={t("web.agenda.form.allDay")} checked={form.allDay} onChange={(on) => set("allDay", on)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField type="date" label={t("web.agenda.form.startDate")} value={form.startDate} required onChange={(e) => set("startDate", e.target.value)} />
          {!form.allDay && <TextField type="time" label={t("web.agenda.form.startTime")} value={form.startTime} required onChange={(e) => set("startTime", e.target.value)} />}
          <TextField type="date" label={t("web.agenda.form.endDate")} value={form.endDate} required onChange={(e) => set("endDate", e.target.value)} />
          {!form.allDay && <TextField type="time" label={t("web.agenda.form.endTime")} value={form.endTime} required onChange={(e) => set("endTime", e.target.value)} />}
        </div>
        {problem && problem !== "title" && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <TextField label={t("web.agenda.form.location")} value={form.location} maxLength={GOOGLE_LIMITS.locationMax} onChange={(e) => set("location", e.target.value)} />
        <TextAreaField label={t("web.agenda.form.description")} value={form.description} maxLength={GOOGLE_LIMITS.descriptionMax} rows={3} onChange={(e) => set("description", e.target.value)} />
        <p className="text-xs leading-5 text-fg-muted">{t("web.agenda.form.noGuests")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("web.cancel")}
          </Button>
          <Button type="submit" loading={saving}>
            {editing.mode === "new" ? t("web.agenda.form.create") : t("web.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
