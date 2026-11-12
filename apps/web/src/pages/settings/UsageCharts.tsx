import { useQuery } from "@tanstack/react-query";
import {
  formatDateTimeParts,
  type Locale,
  modelLabel,
  PAID_MODEL_IDS,
  ptBRUsage,
  USAGE_MONTHS,
  type UsageHistory,
  usageHistorySchema,
  type UsageHours,
  usageHoursSchema,
  type UsageMonths,
  usageMonthsSchema,
} from "@zuri/shared";
import { type ReactNode, useState } from "react";
import { Card, cn, ErrorNotice, Loading } from "../../components/ui.tsx";
import { USAGE_KEY, useUsage } from "../../hooks/usage.ts";
import { api } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { useUsd } from "./usd.ts";

// The panel's texts come with it, not in the first bundle (rule P11).
addMessages(ptBRUsage);

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** One color per paid model, always the same one (tokens in styles.css). */
const SERIES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"] as const;
const seriesOf = (model: string) => SERIES[Math.max(0, (PAID_MODEL_IDS as readonly string[]).indexOf(model)) % SERIES.length];

/** The four views of the prototype: today by the hour, 7 and 30 days by the day, 12 months by the month (PR S16). */
export const USAGE_PERIODS = ["day", "week", "month", "year"] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

/** One column of a chart: an hour, a day or a month. */
export type UsageRow = {
  key: string;
  /** For the table, the bar's title and the screen reader's summary. */
  label: string;
  /** Under the bar. */
  short: string;
  requests: number;
  errors: number;
  aborted: number;
  fallbacks: number;
  neurons: number;
  paidUsd: number;
  /** Paid spending by model: only the daily history splits it. */
  paid: { model: string; usd: number }[];
};

const ZERO = { requests: 0, errors: 0, aborted: 0, fallbacks: 0, neurons: 0, paidUsd: 0, audioSeconds: 0 };

/**
 * Today's 24 hours, the quiet ones as zeros. The server counts in UTC hours, like the daily
 * counters (the free allocation starts over at 00:00 UTC); each column is labeled with the
 * hour it starts at in the owner's time zone, so for UTC−3 the "day" runs 21:00 to 20:59.
 */
export function hourRows(data: UsageHours, locale: string, timeZone: string): UsageRow[] {
  const byHour = new Map<number, UsageHours["hours"][number]>(data.hours.map((h) => [h.hour, h]));
  const start = Date.parse(`${data.day}T00:00:00Z`);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  return Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour) ?? { hour, ...ZERO };
    const at = time.format(new Date(start + hour * HOUR_MS));
    return { ...row, key: String(hour), label: at, short: at.slice(0, 2), paid: [] };
  });
}

/** The 12 months from `from` to `to`, the quiet ones as zeros. */
export function monthRows(data: UsageMonths, locale: string): UsageRow[] {
  const byMonth = new Map(data.months.map((m) => [m.month, m]));
  const [year, month] = data.from.split("-").map(Number) as [number, number];
  const long = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const short = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  return Array.from({ length: USAGE_MONTHS }, (_, i) => {
    const at = new Date(Date.UTC(year, month - 1 + i, 15));
    const key = at.toISOString().slice(0, 7);
    const row = byMonth.get(key) ?? { month: key, days: 0, ...ZERO };
    return { ...row, key, label: long.format(at), short: short.format(at).replace(".", ""), paid: [] };
  });
}

/** Every day of the period, the quiet ones as zeros, so the bars keep the calendar's rhythm. */
function dayRows(history: UsageHistory, days: number, locale: Locale): UsageRow[] {
  const byDay = new Map(history.days.map((d) => [d.day, d]));
  const paid = new Map<string, { model: string; usd: number }[]>();
  for (const row of history.paidByDay) paid.set(row.day, [...(paid.get(row.day) ?? []), { model: row.model, usd: row.usd }]);
  const end = Date.parse(`${history.to}T12:00:00Z`);
  const short = new Intl.DateTimeFormat(locale, days <= 7 ? { weekday: "short", timeZone: "UTC" } : { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(end - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    const row = byDay.get(day) ?? { day, ...ZERO };
    const at = Date.parse(`${day}T12:00:00Z`);
    return { ...row, key: day, label: formatDateTimeParts(at, locale, "UTC").date, short: short.format(at), paid: paid.get(day) ?? [] };
  });
}

/**
 * The usage panel (step 21, Dia and Ano since PR S16): what the AI used and cost, by
 * hour, day or month. Its queries sit under the "usage" key, so the area's number on
 * the live channel refetches them while the screen is open (no polling, rule P11).
 */
export function UsageCharts() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<UsagePeriod>("week");
  return (
    <Card title={t("web.usage.title")} description={t("web.usage.description")} actions={<PeriodPicker value={period} onChange={setPeriod} />}>
      {period === "day" ? <DayView /> : period === "year" ? <YearView /> : <DaysView days={period === "week" ? 7 : 30} />}
    </Card>
  );
}

// One literal key per value, so the i18n lint sees each one.
const PERIOD_LABEL = {
  day: "web.usage.period.day",
  week: "web.usage.period.week",
  month: "web.usage.period.month",
  year: "web.usage.period.year",
} as const;

function PeriodPicker({ value, onChange }: { value: UsagePeriod; onChange: (period: UsagePeriod) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="inline-flex rounded-xl border border-border bg-raised p-0.5">
      <legend className="sr-only">{t("web.usage.period")}</legend>
      {USAGE_PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          aria-pressed={value === period}
          onClick={() => onChange(period)}
          className={cn(
            "min-h-11 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            value === period ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {t(PERIOD_LABEL[period])}
        </button>
      ))}
    </fieldset>
  );
}

function useHistory(days: 7 | 30 | 90) {
  return useQuery({
    queryKey: [...USAGE_KEY, "history", days],
    queryFn: async ({ signal }): Promise<UsageHistory> => usageHistorySchema.parse(await api<unknown>(`/usage/history?days=${days}`, { signal })),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
}

function DaysView({ days }: { days: 7 | 30 }) {
  const { locale } = useI18n();
  const history = useHistory(days);
  if (history.isPending) return <Loading />;
  if (history.isError) return <ErrorNotice error={history.error} onRetry={() => void history.refetch()} />;
  const rows = dayRows(history.data, days, locale);
  return (
    <Panel rows={rows} unit="day" empty={history.data.models.length === 0}>
      <ModelTable history={history.data} />
    </Panel>
  );
}

function DayView() {
  const { t, locale, timeZone } = useI18n();
  const hours = useQuery({
    queryKey: [...USAGE_KEY, "hours"],
    queryFn: async ({ signal }) => usageHoursSchema.parse(await api<unknown>("/usage/hours", { signal })),
    staleTime: 15_000,
  });
  if (hours.isPending) return <Loading />;
  if (hours.isError) return <ErrorNotice error={hours.error} onRetry={() => void hours.refetch()} />;
  const rows = hourRows(hours.data, locale, timeZone);
  return (
    <Panel rows={rows} unit="hour" empty>
      {/* The day is the free allocation's, in UTC: say when it starts over, as the card of today's usage does. */}
      <p className="text-xs text-fg-muted">{t("web.usage.dayStarts", { time: rows[0]?.label ?? "" })}</p>
    </Panel>
  );
}

function YearView() {
  const { t, locale } = useI18n();
  const months = useQuery({
    queryKey: [...USAGE_KEY, "months"],
    queryFn: async ({ signal }) => usageMonthsSchema.parse(await api<unknown>("/usage/months", { signal })),
    staleTime: 15_000,
  });
  // The months keep no split by model: the table shows the last 90 days and says so.
  const history = useHistory(90);
  if (months.isPending) return <Loading />;
  if (months.isError) return <ErrorNotice error={months.error} onRetry={() => void months.refetch()} />;
  const rows = monthRows(months.data, locale);
  const usedDays = months.data.months.reduce((n, m) => n + m.days, 0);
  return (
    <Panel rows={rows} unit="month" usedDays={usedDays} empty={(history.data?.models.length ?? 0) === 0}>
      {history.data ? (
        <ModelTable history={history.data} title={t("web.usage.models90")} />
      ) : history.isError ? (
        <ErrorNotice error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <Loading />
      )}
    </Panel>
  );
}

type Unit = "hour" | "day" | "month";

// One literal key per unit, so the i18n lint sees each one.
const UNIT_TEXT = {
  hour: {
    paidAverage: "web.usage.paidAverageHour",
    neuronsAverage: "web.usage.neuronsAverageHour",
    paidChart: "web.usage.chart.paidHour",
    neuronChart: "web.usage.chart.neuronsHour",
    show: "web.usage.table.showHour",
    col: "web.usage.col.hour",
  },
  day: {
    paidAverage: "web.usage.paidAverage",
    neuronsAverage: "web.usage.neuronsAverage",
    paidChart: "web.usage.chart.paid",
    neuronChart: "web.usage.chart.neurons",
    show: "web.usage.table.show",
    col: "web.usage.col.day",
  },
  month: {
    paidAverage: "web.usage.paidAverageMonth",
    neuronsAverage: "web.usage.neuronsAverageUsedDay",
    paidChart: "web.usage.chart.paidMonth",
    neuronChart: "web.usage.chart.neuronsMonth",
    show: "web.usage.table.showMonth",
    col: "web.usage.col.month",
  },
} as const;

function Panel({ rows, unit, usedDays, empty, children }: { rows: UsageRow[]; unit: Unit; usedDays?: number; empty: boolean; children?: ReactNode }) {
  const { t, plural, locale } = useI18n();
  const usd = useUsd();
  const text = UNIT_TEXT[unit];
  const number = (value: number, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const total = rows.reduce(
    (sum, d) => ({
      paid: sum.paid + d.paidUsd,
      neurons: sum.neurons + d.neurons,
      requests: sum.requests + d.requests,
      errors: sum.errors + d.errors,
      aborted: sum.aborted + d.aborted,
      fallbacks: sum.fallbacks + d.fallbacks,
    }),
    { paid: 0, neurons: 0, requests: 0, errors: 0, aborted: 0, fallbacks: 0 },
  );
  if (total.requests === 0 && empty) return <p className="text-sm text-fg-muted">{t("web.usage.empty")}</p>;
  const average = total.paid / rows.length;
  // The year's average is per day with use (the months carry how many), not per month.
  const neuronsAverage = unit === "month" ? total.neurons / Math.max(1, usedDays ?? 0) : total.neurons / rows.length;
  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label={t("web.usage.paid")}
          value={usd(total.paid)}
          detail={unit === "day" ? `${t(text.paidAverage, { usd: usd(average) })} · ${t("web.usage.projection", { usd: usd(average * 30) })}` : t(text.paidAverage, { usd: usd(average) })}
        />
        <Tile label={t("web.usage.neurons")} value={number(total.neurons)} detail={t(text.neuronsAverage, { neurons: number(neuronsAverage) })} />
        <Tile label={t("web.usage.requests")} value={number(total.requests)} detail={t("web.usage.failures", { errors: number(total.errors), aborted: number(total.aborted) })} />
        <Tile label={t("web.usage.fallbacks")} value={number(total.fallbacks)} detail={total.fallbacks === 0 ? t("web.usage.fallbacksNone") : plural("web.usage.fallbacksValue", total.fallbacks)} />
      </dl>
      <PaidChart rows={rows} title={t(text.paidChart)} />
      <NeuronChart rows={rows} title={t(text.neuronChart)} cap={unit === "day"} />
      <RowTable rows={rows} show={t(text.show)} col={t(text.col)} />
      {children}
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs leading-5 text-fg-muted">{detail}</dd>
    </div>
  );
}

/** Labels under the bars, only for the eye: all of them up to 12 columns, every 6th hour of a day, else first, middle and last. */
function Axis({ rows }: { rows: UsageRow[] }) {
  const all = rows.length <= 12;
  const marks = all ? rows : rows.length === 24 ? rows.filter((_, i) => i % 6 === 0) : [rows[0], rows[Math.floor(rows.length / 2)], rows.at(-1)].filter((d): d is UsageRow => d !== undefined);
  return (
    <div aria-hidden className={cn("flex text-xs text-fg-muted", all ? "gap-1" : "justify-between")}>
      {marks.map((d) => (
        <span key={d.key} className={cn(all && "min-w-0 flex-1 truncate text-center")}>
          {d.short}
        </span>
      ))}
    </div>
  );
}

const gap = (rows: UsageRow[]) => (rows.length > 30 ? "gap-px" : "gap-1");

/** US$ per column, one stacked piece per paid model when the day knows them. */
function PaidChart({ rows, title }: { rows: UsageRow[]; title: string }) {
  const { t } = useI18n();
  const usd = useUsd();
  const peak = Math.max(0, ...rows.map((d) => d.paidUsd));
  const models = [...new Set(rows.flatMap((d) => d.paid.map((p) => p.model)))];
  const busiest = rows.reduce((best, d) => (d.paidUsd > best.paidUsd ? d : best), rows[0] as UsageRow);
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {peak === 0 ? (
        <p className="text-sm text-fg-muted">{t("web.usage.chart.paidEmpty")}</p>
      ) : (
        <>
          <p className="sr-only">{t("web.usage.chart.summary", { from: rows[0]?.label ?? "", to: rows.at(-1)?.label ?? "", peak: `${busiest.label}, ${usd(busiest.paidUsd)}` })}</p>
          <div aria-hidden className={cn("flex h-36 items-end", gap(rows))}>
            {rows.map((d) => (
              <div key={d.key} title={`${d.label}: ${usd(d.paidUsd)}`} className="flex h-full min-w-0 flex-1 flex-col-reverse">
                {d.paid.length > 0 ? (
                  d.paid.map((p) => (
                    <span key={p.model} className={cn("w-full first:rounded-b-sm last:rounded-t-sm", seriesOf(p.model))} style={{ height: `${(p.usd / peak) * 100}%` }} />
                  ))
                ) : (
                  <span className="w-full rounded-t-sm bg-chart-1" style={{ height: `${(d.paidUsd / peak) * 100}%` }} />
                )}
              </div>
            ))}
          </div>
          <Axis rows={rows} />
          {models.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {models.map((model) => (
                <li key={model} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className={cn("h-2.5 w-2.5 rounded-sm", seriesOf(model))} />
                  {modelLabel(model)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </figure>
  );
}

/** Neurons per column; by the day, against the daily cap (a dashed line). */
function NeuronChart({ rows, title, cap: withCap }: { rows: UsageRow[]; title: string; cap: boolean }) {
  const { t, locale } = useI18n();
  const usage = useUsage();
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  const cap = withCap ? (usage.data?.limits.neuronsPerDay ?? 0) : 0;
  const peak = Math.max(cap, 1, ...rows.map((d) => d.neurons));
  const busiest = rows.reduce((best, d) => (d.neurons > best.neurons ? d : best), rows[0] as UsageRow);
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      <p className="sr-only">{t("web.usage.chart.summary", { from: rows[0]?.label ?? "", to: rows.at(-1)?.label ?? "", peak: `${busiest.label}, ${number(busiest.neurons)}` })}</p>
      <div aria-hidden className="relative h-36">
        {cap > 0 && <span className="absolute inset-x-0 border-t border-dashed border-border-strong" style={{ bottom: `${(cap / peak) * 100}%` }} />}
        <div className={cn("flex h-full items-end", gap(rows))}>
          {rows.map((d, i) => (
            <span
              key={d.key}
              title={`${d.label}: ${number(d.neurons)}`}
              className={cn("min-w-0 flex-1 rounded-t-sm", i === rows.length - 1 ? "bg-accent" : "bg-border-strong")}
              style={{ height: `${d.neurons > 0 ? Math.max(2, (d.neurons / peak) * 100) : 0}%` }}
            />
          ))}
        </div>
      </div>
      <Axis rows={rows} />
      {cap > 0 && <p className="text-xs text-fg-muted">{t("web.usage.chart.cap", { neurons: number(cap) })}</p>}
    </figure>
  );
}

/** The numbers behind the bars, for anyone who'd rather read them (and screen readers). Columns with use only, newest first. */
function RowTable({ rows, show, col }: { rows: UsageRow[]; show: string; col: string }) {
  const { t, locale } = useI18n();
  const usd = useUsd();
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  const used = rows.filter((d) => d.requests > 0 || d.neurons > 0 || d.paidUsd > 0).reverse();
  if (used.length === 0) return null;
  return (
    <details className="rounded-xl border border-border">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">{show}</summary>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-raised text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {col}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                {t("web.usage.col.requests")}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                {t("web.usage.col.neurons")}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                {t("web.usage.col.paid")}
              </th>
              <th scope="col" className="hidden px-2 py-2 text-right font-medium sm:table-cell">
                {t("web.usage.col.fallbacks")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {used.map((d) => (
              <tr key={d.key}>
                <th scope="row" className="px-2 py-2 font-normal whitespace-nowrap sm:px-3">
                  {d.label}
                </th>
                <td className="px-2 py-2 text-right tabular-nums">{number(d.requests)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{number(d.neurons)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{usd(d.paidUsd)}</td>
                <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{number(d.fallbacks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** The period's models, most called first, with their share of the calls. */
function ModelTable({ history, title }: { history: UsageHistory; title?: string }) {
  const { t, locale } = useI18n();
  const usd = useUsd();
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  const calls = history.models.reduce((n, m) => n + m.calls, 0);
  if (history.models.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title ?? t("web.usage.models")}</h3>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-raised text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">
                {t("web.usage.col.model")}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3">
                {t("web.usage.col.calls")}
              </th>
              <th scope="col" className="hidden px-2 py-2 text-right font-medium sm:table-cell sm:px-3">
                {t("web.usage.col.tokens")}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3">
                {t("web.usage.col.cost")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {history.models.map((m) => {
              const percent = calls > 0 ? Math.round((m.calls / calls) * 100) : 0;
              return (
                <tr key={`${m.model}|${m.kind}`}>
                  <th scope="row" className="px-2 py-2 font-normal sm:px-3">
                    <span className="block font-medium [overflow-wrap:anywhere]">{modelLabel(m.model)}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
                      <span aria-hidden className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-subtle">
                        <span className={cn("block h-full rounded-full", m.paid ? seriesOf(m.model) : "bg-accent")} style={{ width: `${percent}%` }} />
                      </span>
                      {t("web.usage.share", { percent })}
                    </span>
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums sm:px-3">{number(m.calls)}</td>
                  <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell sm:px-3">{number(m.inputTokens + m.outputTokens)}</td>
                  <td className="px-2 py-2 text-right tabular-nums sm:px-3">{m.paid ? usd(m.costUsd) : t("web.usage.free")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
