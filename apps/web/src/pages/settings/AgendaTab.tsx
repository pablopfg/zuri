import { useQuery } from "@tanstack/react-query";
import { AGENDA_RULES, type AgendaEvent, type AgendaPage, type AgendaPrefs, type AgendaRecordLast, dayClosure, dayPlus, type MessageKey, nationalHoliday, outsideHours, periodDays } from "@zuri/shared";
import { TriangleAlert, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, cn, Dialog, ErrorNotice, Loading, SelectField, TextField } from "../../components/ui.tsx";
import { useSettings, useSettingsMutation } from "../../hooks/settings.ts";
import { hhmm, isAppointment, localDate, localTime } from "../../lib/agenda.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
const hours = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const same = (a: AgendaPrefs, b: AgendaPrefs) => JSON.stringify(a) === JSON.stringify(b);
/** 4 January 2026 is a Sunday: day 0 of the week, for the short names in the owner's language. */
const weekdayName = (locale: string, day: number) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" }).format(new Date(Date.UTC(2026, 0, 4 + day, 12))).replace(".", "");

/** The hours a new installation starts with (DEFAULT_AGENDA_PREFS; a test keeps the two the same). */
export const STANDARD_HOURS = { from: 8, to: 18 };
const VIEWS = ["day", "week", "month"] as const;

/**
 * The lunch break moved inside new hours: whole half hours, at most 3 h, with half
 * an hour of work before and after; none when the hours are too short for one.
 */
export function fitLunch(lunch: AgendaPrefs["lunch"], from: number, to: number): AgendaPrefs["lunch"] {
  if (!lunch) return null;
  const { lunchStep, lunchMax, lunchMargin } = AGENDA_RULES;
  const first = from * 60 + lunchMargin;
  const last = to * 60 - lunchMargin;
  if (last - first < lunchStep) return null;
  const start = Math.min(Math.max(lunch.from, first), last - lunchStep);
  const end = Math.min(Math.max(lunch.to, start + lunchStep), start + lunchMax, last);
  return { from: start, to: end };
}

/** The half hours from `from` to `to`, both included. */
const halfHours = (from: number, to: number) => Array.from({ length: Math.max(0, Math.floor((to - from) / 30) + 1) }, (_, index) => from + index * 30);

/** The next national holidays that fall on an office day: at most 12, within a year. */
export function nextHolidays(today: string, workDays: readonly number[]): string[] {
  const out: string[] = [];
  for (let offset = 0; offset <= 366 && out.length < 12; offset++) {
    const day = dayPlus(today, offset);
    if (nationalHoliday(day) && workDays.includes(new Date(`${day}T12:00:00Z`).getUTCDay())) out.push(day);
  }
  return out;
}

/** "24/12/2026" of "2026-12-24", and back; null when it is no real date. */
const brDate = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
export function parseBrDate(text: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const day = `${match[3]}-${match[2]?.padStart(2, "0")}-${match[1]?.padStart(2, "0")}`;
  const back = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(back.getTime()) || back.toISOString().slice(0, 10) !== day ? null : day;
}

const VIEW_TEXT = { day: "web.agendaPrefs.view.day", week: "web.agendaPrefs.view.week", month: "web.agendaPrefs.view.month" } as const satisfies Record<AgendaPrefs["view"], MessageKey>;

/** One line of the card: what it is on the left, the control on the right, under it on a narrow screen. */
function Row({ title, hint, id, hintId, children }: { title: string; hint?: string; id?: string; hintId?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border/60 py-4">
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <p id={id} className="text-sm font-semibold">
          {title}
        </p>
        {hint && (
          <p id={hintId} className="text-sm leading-6 text-fg-muted">
            {hint}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/** A choice of a few, one at a time: real radios drawn as one control. */
function Choice<V extends string | number | boolean>({
  title,
  hint,
  value,
  options,
  onChange,
}: { title: string; hint?: string; value: V; options: readonly { value: V; label: string }[]; onChange: (value: V) => void }) {
  const id = useId();
  return (
    <Row title={title} {...(hint ? { hint, hintId: `${id}-hint` } : {})} id={id}>
      <div role="radiogroup" aria-labelledby={id} aria-describedby={hint ? `${id}-hint` : undefined} className="flex rounded-xl border border-border bg-raised p-1">
        {options.map((option) => (
          <label
            key={String(option.value)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
              value === option.value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            <input type="radio" name={id} className="sr-only" checked={value === option.value} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </Row>
  );
}

function AgendaForm({ stored }: { stored: AgendaPrefs }) {
  const { t, plural, locale } = useI18n();
  const save = useSettingsMutation();
  const toast = useToast();
  const [draft, setDraft] = useState(stored);
  // A change saved in another tab shows up here.
  useEffect(() => setDraft(stored), [stored]);
  const set = (patch: Partial<AgendaPrefs>) => {
    // New hours carry the lunch break inside them.
    setDraft((old) => {
      const next = { ...old, ...patch };
      return patch.from !== undefined || patch.to !== undefined ? { ...next, lunch: fitLunch(next.lunch, next.from, next.to) } : next;
    });
    if (save.isError) save.reset();
  };
  const { timeZone } = useI18n();
  const today = localDate(Date.now(), timeZone);
  const [adding, setAdding] = useState(false);
  const holidays = nextHolidays(today, draft.workDays);
  const hoursId = useId();
  const daysId = useId();
  const offId = useId();
  const unchanged = same(draft, stored);
  const range = { from: hour(draft.from), to: hour(draft.to) };
  const standard = draft.from === STANDARD_HOURS.from && draft.to === STANDARD_HOURS.to;
  const shown = [
    { value: true, label: t("web.agendaPrefs.show") },
    { value: false, label: t("web.agendaPrefs.hide") },
  ];
  // The week in the owner's order: from Sunday or from Monday.
  const week = Array.from({ length: 7 }, (_, index) => (index + draft.weekStart) % 7);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unchanged) return;
    // Days that went by leave the lists: they close nothing any more.
    const agenda = { ...draft, closed: draft.closed.filter((period) => period.to >= today) };
    save.mutate({ agenda }, { onSuccess: () => toast(t("web.agendaPrefs.saved")) });
  };

  return (
    <>
    <form onSubmit={submit}>
      <div className="space-y-3 pb-4">
        <div className="space-y-1">
          <p id={hoursId} className="text-sm font-semibold">
            {t("web.agendaPrefs.hours.title")}
          </p>
          <p className="text-sm leading-6 text-fg-muted">{t("web.agendaPrefs.hours.hint")}</p>
        </div>
        <fieldset aria-labelledby={hoursId} className="flex min-w-0 flex-wrap items-end gap-3">
          {/* Each list stops at the other's choice: the end is always after the start. */}
          <SelectField label={t("web.agendaPrefs.hours.from")} className="w-28" value={draft.from} onChange={(e) => set({ from: Number(e.target.value) })}>
            {hours(0, draft.to - 1).map((value) => (
              <option key={value} value={value}>
                {hour(value)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("web.agendaPrefs.hours.to")} className="w-28" value={draft.to} onChange={(e) => set({ to: Number(e.target.value) })}>
            {hours(draft.from + 1, 24).map((value) => (
              <option key={value} value={value}>
                {hour(value)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t("web.agendaPrefs.lunch.from")}
            className="w-32"
            value={draft.lunch?.from ?? ""}
            onChange={(e) => {
              const from = e.target.value === "" ? null : Number(e.target.value);
              set({ lunch: from === null ? null : fitLunch({ from, to: Math.max(draft.lunch?.to ?? from + 60, from + 30) }, draft.from, draft.to) });
            }}
          >
            <option value="">{t("web.agendaPrefs.lunch.none")}</option>
            {halfHours(draft.from * 60 + AGENDA_RULES.lunchMargin, draft.to * 60 - AGENDA_RULES.lunchMargin - AGENDA_RULES.lunchStep).map((value) => (
              <option key={value} value={value}>
                {hhmm(value)}
              </option>
            ))}
          </SelectField>
          {draft.lunch && (
            <SelectField label={t("web.agendaPrefs.lunch.to")} className="w-28" value={draft.lunch.to} onChange={(e) => draft.lunch && set({ lunch: { from: draft.lunch.from, to: Number(e.target.value) } })}>
              {halfHours(draft.lunch.from + AGENDA_RULES.lunchStep, Math.min(draft.lunch.from + AGENDA_RULES.lunchMax, draft.to * 60 - AGENDA_RULES.lunchMargin)).map((value) => (
                <option key={value} value={value}>
                  {hhmm(value)}
                </option>
              ))}
            </SelectField>
          )}
          {!standard && (
            <Button variant="ghost" onClick={() => set(STANDARD_HOURS)}>
              {t("web.agendaPrefs.hours.reset", { from: hour(STANDARD_HOURS.from), to: hour(STANDARD_HOURS.to) })}
            </Button>
          )}
        </fieldset>
        {/* The day as a bar, the working hours filled. */}
        <div
          role="img"
          aria-label={[plural("web.agendaPrefs.hours.bar", draft.to - draft.from, range), draft.lunch ? t("web.agendaPrefs.lunch.bar", { from: hhmm(draft.lunch.from), to: hhmm(draft.lunch.to) }) : ""].filter(Boolean).join(". ")} className="relative h-9 overflow-hidden rounded-lg border border-border bg-raised">
          <span
            className="absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-md border border-accent bg-accent-soft text-xs font-semibold whitespace-nowrap text-accent-text tabular-nums"
            style={{ left: `${(draft.from / 24) * 100}%`, width: `${((draft.to - draft.from) / 24) * 100}%` }}
          />
          {draft.lunch && (
            <span
              title={t("web.agendaPrefs.lunch.bar", { from: hhmm(draft.lunch.from), to: hhmm(draft.lunch.to) })}
              className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,var(--color-border-strong)_0_1px,transparent_1px_6px)] bg-raised"
              style={{ left: `${(draft.lunch.from / 1440) * 100}%`, width: `${((draft.lunch.to - draft.lunch.from) / 1440) * 100}%` }}
            />
          )}
          {/* The hours in words, over the lunch's stripes, on a fill of their own to stay readable. */}
          {draft.to - draft.from >= 4 && (
            <span
              className="absolute inset-y-0 flex items-center justify-center text-xs font-semibold whitespace-nowrap text-accent-text tabular-nums"
              style={{ left: `${(draft.from / 24) * 100}%`, width: `${((draft.to - draft.from) / 24) * 100}%` }}
            >
              <span className="rounded bg-accent-soft px-1.5">{t("web.agendaPrefs.hours.range", range)}</span>
            </span>
          )}
        </div>
        <div aria-hidden className="flex justify-between text-xs text-fg-muted tabular-nums">
          {[0, 6, 12, 18, 24].map((value) => (
            <span key={value}>{hour(value)}</span>
          ))}
        </div>
      </div>
      <Choice title={t("web.agendaPrefs.view.title")} hint={t("web.agendaPrefs.view.hint")} value={draft.view} options={VIEWS.map((value) => ({ value, label: t(VIEW_TEXT[value]) }))} onChange={(view) => set({ view })} />
      <Choice
        title={t("web.agendaPrefs.weekStart.title")}
        value={draft.weekStart}
        options={[
          { value: 0, label: t("web.agendaPrefs.weekStart.sunday") },
          { value: 1, label: t("web.agendaPrefs.weekStart.monday") },
        ]}
        onChange={(weekStart) => set({ weekStart })}
      />
      <Row title={t("web.agendaPrefs.workDays.title")} hint={t("web.agendaPrefs.workDays.hint")} id={daysId} hintId={`${daysId}-hint`}>
        <fieldset aria-labelledby={daysId} aria-describedby={`${daysId}-hint`} className="flex min-w-0 flex-wrap gap-1">
          {week.map((day) => {
            const on = draft.workDays.includes(day);
            return (
              <label
                key={day}
                className={cn(
                  "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border px-2 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                  on ? "border-accent bg-accent-soft text-accent-text" : "border-border text-fg-muted hover:text-fg",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  aria-disabled={(on && draft.workDays.length === 1) || undefined}
                  // The last working day stays: a week with none would show nothing.
                  onChange={() => (on ? draft.workDays.length > 1 && set({ workDays: draft.workDays.filter((each) => each !== day) }) : set({ workDays: [...draft.workDays, day].sort((a, b) => a - b) }))}
                />
                {weekdayName(locale, day)}
              </label>
            );
          })}
        </fieldset>
      </Row>
      <div className="space-y-1 border-t border-border/60 py-3">
        <Switch label={t("web.agendaPrefs.daysOff.title")} checked={draft.daysOff} onChange={(daysOff) => set({ daysOff })} describedBy={offId} />
        <p id={offId} className="text-sm leading-6 text-fg-muted">
          {t("web.agendaPrefs.daysOff.hint")}
        </p>
      </div>
      <Holidays days={holidays} />
      <ClosedDays
        periods={draft.closed.filter((period) => period.to >= today)}
        onRemove={(from) => set({ closed: draft.closed.filter((period) => period.from !== from) })}
        onAdd={() => setAdding(true)}
      />
      <DayRecord />
      <OutsideList hours={stored} today={today} />
      <Choice title={t("web.agendaPrefs.outside.title")} hint={t("web.agendaPrefs.outside.hint")} value={draft.outside} options={shown} onChange={(outside) => set({ outside })} />
      {save.isError && (
        <p role="alert" className="pb-3 text-sm text-danger">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="flex justify-end border-t border-border/60 pt-4">
        <Button type="submit" loading={save.isPending} disabled={unchanged}>
          {t("web.agendaPrefs.save")}
        </Button>
      </div>
    </form>
      {adding && (
        <AddClosedDay
          today={today}
          taken={draft.closed}
          full={draft.closed.filter((period) => period.to >= today).length >= AGENDA_RULES.closedMax}
          onClose={() => setAdding(false)}
          onAdd={(period) => {
            set({ closed: [...draft.closed, period].sort((a, b) => (a.from < b.from ? -1 : 1)) });
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

const HOLIDAY_TEXT = {
  newYear: "web.agendaPrefs.holiday.newYear",
  goodFriday: "web.agendaPrefs.holiday.goodFriday",
  tiradentes: "web.agendaPrefs.holiday.tiradentes",
  labourDay: "web.agendaPrefs.holiday.labourDay",
  independence: "web.agendaPrefs.holiday.independence",
  aparecida: "web.agendaPrefs.holiday.aparecida",
  allSouls: "web.agendaPrefs.holiday.allSouls",
  republic: "web.agendaPrefs.holiday.republic",
  blackAwareness: "web.agendaPrefs.holiday.blackAwareness",
  christmas: "web.agendaPrefs.holiday.christmas",
} as const satisfies Record<NonNullable<ReturnType<typeof nationalHoliday>>, MessageKey>;

/** The national holidays of the next 12 months on office days: they always close the day (13/11/2026, 10:37). */
function Holidays({ days }: { days: string[] }) {
  const { t, locale } = useI18n();
  const id = useId();
  return (
    <Row title={t("web.agendaPrefs.holidays.title")} hint={t("web.agendaPrefs.holidays.hint")} id={id} hintId={`${id}-hint`}>
      {days.length === 0 ? (
        <p className="w-full text-sm text-fg-muted">{t("web.agendaPrefs.holidays.none")}</p>
      ) : (
        <ul aria-labelledby={id} className="w-full divide-y divide-border/60 rounded-xl border border-border">
          {days.map((day) => {
            const holiday = nationalHoliday(day);
            return (
              <li key={day} className="flex min-h-11 items-center gap-3 px-3 py-1">
                <span className="w-12 text-sm text-fg-muted tabular-nums">{brDate(day).slice(0, 5)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{holiday ? t(HOLIDAY_TEXT[holiday]) : ""}</span>
                <span className="text-sm text-fg-muted">{weekdayName(locale, new Date(`${day}T12:00:00Z`).getUTCDay())}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Row>
  );
}

/** "24/12/2026" for one day, "24/12/2026 a 03/01/2027" for a period. */
const periodText = (period: { from: string; to: string }, joiner: string) => (period.from === period.to ? brDate(period.from) : `${brDate(period.from)} ${joiner} ${brDate(period.to)}`);

/** Days off, one day or a period (a vacation, a break, a trip): every day of it closes in the Agenda and for new appointments. */
function ClosedDays({ periods, onRemove, onAdd }: { periods: AgendaPrefs["closed"]; onRemove: (from: string) => void; onAdd: () => void }) {
  const { t, plural } = useI18n();
  const id = useId();
  const joiner = t("web.agendaPrefs.closed.joiner");
  return (
    <Row title={t("web.agendaPrefs.closed.title")} hint={t("web.agendaPrefs.closed.hint")} id={id} hintId={`${id}-hint`}>
      <div className="w-full min-w-0 space-y-2">
        <ul aria-labelledby={id} className="w-full divide-y divide-border/60 rounded-xl border border-border">
          {periods.length === 0 && <li className="px-3 py-3 text-sm text-fg-muted">{t("web.agendaPrefs.closed.none")}</li>}
          {periods.map((period) => (
            <li key={period.from} className="flex items-center gap-2 pl-3 text-sm">
              <span className="min-w-0 flex-1 py-2">
                <b className="font-semibold tabular-nums">{periodText(period, joiner)}</b>
                {period.reason && <span> · {period.reason}</span>}
                <span className="text-fg-muted"> · {plural("web.agendaPrefs.closed.days", periodDays(period))}</span>
              </span>
              <button
                type="button"
                aria-label={t("web.agendaPrefs.closed.remove", { date: periodText(period, joiner) })}
                onClick={() => onRemove(period.from)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        {/* No icon: a "plus" of its own would be one more file on the first load (P11). */}
        <Button variant="secondary" onClick={onAdd}>
          {t("web.agendaPrefs.closed.add")}
        </Button>
      </div>
    </Row>
  );
}

/**
 * The record of the day (13/11/2026, 10:37): at 0:00 the events of the day that
 * ended freeze. Only shown here; nothing to set.
 */
function DayRecord() {
  const { t, plural, locale, timeZone } = useI18n();
  const id = useId();
  const record = useQuery({
    queryKey: ["google", "record"],
    queryFn: ({ signal }) => api<{ last: AgendaRecordLast | null }>("/google/record", { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const last = record.data?.last;
  const when = last ? new Intl.DateTimeFormat(locale, { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(last.closedAt)) : "";
  return (
    <Row title={t("web.agendaPrefs.record.title")} hint={t("web.agendaPrefs.record.hint")} id={id} hintId={`${id}-hint`}>
      <p className="w-full text-sm text-fg-muted" aria-live="polite">
        {record.isError ? t("web.agendaPrefs.record.unread") : last ? t("web.agendaPrefs.record.last", { day: brDate(last.day).slice(0, 5), when, events: plural("web.agendaPrefs.record.events", last.events) }) : record.isPending ? "" : t("web.agendaPrefs.record.none")}
      </p>
    </Row>
  );
}

function AddClosedDay({ today, taken, full, onClose, onAdd }: { today: string; taken: AgendaPrefs["closed"]; full: boolean; onClose: () => void; onAdd: (period: AgendaPrefs["closed"][number]) => void }) {
  const { t } = useI18n();
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<{ field: "from" | "to"; text: string } | null>(null);
  const confirm = () => {
    const from = parseBrDate(fromText);
    const to = toText.trim() ? parseBrDate(toText) : from;
    const refuse = (field: "from" | "to", text: string) => setProblem({ field, text });
    if (full) return refuse("from", t("web.agendaPrefs.closed.full", { max: AGENDA_RULES.closedMax }));
    if (!from) return refuse("from", t("web.agendaPrefs.closed.badDate"));
    if (!to) return refuse("to", t("web.agendaPrefs.closed.badEnd"));
    if (from < today) return refuse("from", t("web.agendaPrefs.closed.pastDate"));
    if (to < from) return refuse("to", t("web.agendaPrefs.closed.endBefore"));
    if (to > dayPlus(today, AGENDA_RULES.aheadDays)) return refuse(toText.trim() ? "to" : "from", t("web.agendaPrefs.closed.far"));
    if (periodDays({ from, to }) > AGENDA_RULES.closedDaysMax) return refuse("to", t("web.agendaPrefs.closed.long", { max: AGENDA_RULES.closedDaysMax }));
    const hit = taken.find((period) => period.from <= to && from <= period.to);
    if (hit) return refuse("from", t("web.agendaPrefs.closed.overlap", { period: periodText(hit, t("web.agendaPrefs.closed.joiner")) }));
    onAdd({ from, to, reason: reason.trim() });
  };
  return (
    <Dialog open onClose={onClose} title={t("web.agendaPrefs.closed.dialog")}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        <p className="text-sm leading-6 text-fg-muted">{t("web.agendaPrefs.closed.dialogHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={t("web.agendaPrefs.closed.from")}
            inputMode="numeric"
            autoComplete="off"
            placeholder={t("web.agendaPrefs.closed.datePlaceholder")}
            maxLength={10}
            autoFocus
            value={fromText}
            error={problem?.field === "from" ? problem.text : null}
            onChange={(e) => {
              setFromText(e.target.value);
              setProblem(null);
            }}
          />
          <TextField
            label={t("web.agendaPrefs.closed.to")}
            inputMode="numeric"
            autoComplete="off"
            placeholder={t("web.agendaPrefs.closed.datePlaceholder")}
            maxLength={10}
            value={toText}
            error={problem?.field === "to" ? problem.text : null}
            onChange={(e) => {
              setToText(e.target.value);
              setProblem(null);
            }}
          />
          <TextField
            label={t("web.agendaPrefs.closed.reason")}
            placeholder={t("web.agendaPrefs.closed.reasonPlaceholder")}
            maxLength={AGENDA_RULES.closedReasonMax}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("web.cancel")}
          </Button>
          <Button type="submit">{t("web.agendaPrefs.closed.confirm")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

type Slot = { day: string; start: number; end: number };
/** An event of one day as minutes of the owner's clock; null for one that crosses midnight. */
function slotOn(event: AgendaEvent, timeZone: string): Slot | null {
  const day = localDate(event.start, timeZone);
  if (localDate(Date.parse(event.end) - 1, timeZone) !== day) return null;
  const minute = (at: string) => Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5));
  const end = localTime(event.end, timeZone);
  return { day, start: minute(localTime(event.start, timeZone)), end: end === "00:00" ? 1_440 : minute(end) };
}

/**
 * Appointments already booked that the saved settings leave outside (or made at
 * Google in a closed hour): nothing disappears, the card lists them (13/11/2026, 00:44).
 */
function OutsideList({ hours, today }: { hours: AgendaPrefs; today: string }) {
  const { t, plural, timeZone, locale } = useI18n();
  const to = dayPlus(today, 42);
  // The same window the Agenda asks for (six weeks), under its key: a change there refreshes this list.
  const events = useQuery({
    queryKey: ["calendar", "events", today, to],
    queryFn: ({ signal }) => api<AgendaPage>(`/google/events?from=${today}&to=${to}`, { signal }),
    staleTime: 60_000,
    retry: false,
  });
  const out = (events.data?.events ?? [])
    .map((event) => ({ event, slot: slotOn(event, timeZone) }))
    .filter((each): each is { event: AgendaEvent; slot: Slot } => !!each.slot && each.slot.day >= today && isAppointment(each.event))
    .map((each) => ({ ...each, closure: dayClosure(each.slot.day, hours), when: outsideHours(each.slot.start, each.slot.end, hours) }))
    .filter((each) => each.closure || each.when)
    .sort((a, b) => (a.event.start < b.event.start ? -1 : 1));
  if (out.length === 0) return null;
  const day = (date: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${date}T12:00:00Z`)).replace(".", "");
  return (
    <div role="status" className="my-3 flex gap-3 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 space-y-2">
        <p>
          <b>{plural("web.agendaPrefs.outsideList.title", out.length)}</b> {t("web.agendaPrefs.outsideList.hint")}
        </p>
        <ul className="space-y-1">
          {out.slice(0, 5).map(({ event, slot, closure, when }) => {
            const why =
              closure?.kind === "weekday"
                ? t("web.agendaPrefs.outsideList.weekday")
                : closure?.kind === "holiday"
                  ? t("web.agendaPrefs.outsideList.holiday", { name: t(HOLIDAY_TEXT[closure.holiday]) })
                  : closure
                    ? t("web.agendaPrefs.outsideList.closed")
                    : when === "lunch"
                      ? t("web.agendaPrefs.outsideList.lunch")
                      : t("web.agendaPrefs.outsideList.hours");
            return (
              <li key={`${event.calendarId}|${event.id}`}>
                {t("web.agendaPrefs.outsideList.item", { title: event.title || t("web.agendaPrefs.outsideList.untitled"), when: `${day(slot.day)} ${hhmm(slot.start)}` })} <span className="text-fg-muted">{why}</span>
              </li>
            );
          })}
          {out.length > 5 && <li className="text-fg-muted">{t("web.agendaPrefs.outsideList.more", { count: out.length - 5 })}</li>}
        </ul>
        <Link to="/agenda" className="inline-flex min-h-11 items-center font-semibold text-accent-text hover:underline">
          {t("web.agendaPrefs.outsideList.open")}
        </Link>
      </div>
    </div>
  );
}

/** Configurações › Agenda (Sinal S08): the working hours, the view on opening, the week's shape and what stays hidden. */
export function AgendaTab() {
  const { t } = useI18n();
  const settings = useSettings();
  return (
    <Card title={t("web.agendaPrefs.title")} description={t("web.agendaPrefs.description")}>
      {settings.isPending ? <Loading /> : settings.isError ? <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} /> : <AgendaForm stored={settings.data.agenda} />}
    </Card>
  );
}
