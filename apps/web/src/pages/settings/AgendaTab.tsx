import type { AgendaPrefs, MessageKey } from "@zuri/shared";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, cn, ErrorNotice, Loading, SelectField } from "../../components/ui.tsx";
import { useSettings, useSettingsMutation } from "../../hooks/settings.ts";
import { errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
const hours = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const same = (a: AgendaPrefs, b: AgendaPrefs) => JSON.stringify(a) === JSON.stringify(b);
/** 4 January 2026 is a Sunday: day 0 of the week, for the short names in the owner's language. */
const weekdayName = (locale: string, day: number) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" }).format(new Date(Date.UTC(2026, 0, 4 + day, 12))).replace(".", "");

/** The hours a new installation starts with (DEFAULT_AGENDA_PREFS; a test keeps the two the same). */
export const STANDARD_HOURS = { from: 8, to: 18 };
const VIEWS = ["day", "week", "month"] as const;

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
    setDraft((old) => ({ ...old, ...patch }));
    if (save.isError) save.reset();
  };
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
    save.mutate({ agenda: draft }, { onSuccess: () => toast(t("web.agendaPrefs.saved")) });
  };

  return (
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
          {!standard && (
            <Button variant="ghost" onClick={() => set(STANDARD_HOURS)}>
              {t("web.agendaPrefs.hours.reset", { from: hour(STANDARD_HOURS.from), to: hour(STANDARD_HOURS.to) })}
            </Button>
          )}
        </fieldset>
        {/* The day as a bar, the working hours filled. */}
        <div role="img" aria-label={plural("web.agendaPrefs.hours.bar", draft.to - draft.from, range)} className="relative h-9 overflow-hidden rounded-lg border border-border bg-raised">
          <span
            className="absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-md border border-accent bg-accent-soft text-xs font-semibold whitespace-nowrap text-accent-text tabular-nums"
            style={{ left: `${(draft.from / 24) * 100}%`, width: `${((draft.to - draft.from) / 24) * 100}%` }}
          >
            {draft.to - draft.from >= 4 && t("web.agendaPrefs.hours.range", range)}
          </span>
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
      <Choice title={t("web.agendaPrefs.allDay.title")} hint={t("web.agendaPrefs.allDay.hint")} value={draft.allDay} options={shown} onChange={(allDay) => set({ allDay })} />
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
