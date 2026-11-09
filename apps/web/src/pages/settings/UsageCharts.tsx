import { useQuery } from "@tanstack/react-query";
import {
  formatDateTimeParts,
  modelLabel,
  PAID_MODEL_IDS,
  ptBRUsage,
  USAGE_HISTORY_DAYS,
  type UsageHistory,
  type UsageHistoryDays,
  usageHistorySchema,
} from "@zuri/shared";
import { useState } from "react";
import { Card, cn, ErrorNotice, Loading } from "../../components/ui.tsx";
import { USAGE_KEY, useUsage } from "../../hooks/usage.ts";
import { api } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { useUsd } from "./usd.ts";

// The panel's texts come with it, not in the first bundle (rule P11).
addMessages(ptBRUsage);

const DAY_MS = 86_400_000;

/** One color per paid model, always the same one (tokens in styles.css). */
const SERIES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"] as const;
const seriesOf = (model: string) => SERIES[Math.max(0, (PAID_MODEL_IDS as readonly string[]).indexOf(model)) % SERIES.length];

type Day = UsageHistory["days"][number] & { paid: { model: string; usd: number }[] };

/**
 * The usage panel (step 21): what the AI used and cost, by day, for 7, 30 or
 * 90 days. Its query sits under the "usage" key, so the area's number on the
 * live channel refetches it while the screen is open (no polling, rule P11).
 */
export function UsageCharts() {
  const { t } = useI18n();
  const [days, setDays] = useState<UsageHistoryDays>(7);
  const history = useQuery({
    queryKey: [...USAGE_KEY, "history", days],
    queryFn: async ({ signal }): Promise<UsageHistory> => usageHistorySchema.parse(await api<unknown>(`/usage/history?days=${days}`, { signal })),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
  return (
    <Card title={t("web.usage.title")} description={t("web.usage.description")} actions={<PeriodPicker value={days} onChange={setDays} />}>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorNotice error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <Panel history={history.data} days={days} />
      )}
    </Card>
  );
}

function PeriodPicker({ value, onChange }: { value: UsageHistoryDays; onChange: (days: UsageHistoryDays) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="inline-flex rounded-xl border border-border bg-raised p-0.5">
      <legend className="sr-only">{t("web.usage.period")}</legend>
      {USAGE_HISTORY_DAYS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={value === days}
          onClick={() => onChange(days)}
          className={cn(
            "min-h-11 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            value === days ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {t("web.usage.period.days", { days })}
        </button>
      ))}
    </fieldset>
  );
}

/** Every day of the period, the quiet ones as zeros, so the bars keep the calendar's rhythm. */
function fill(history: UsageHistory, days: number): Day[] {
  const byDay = new Map(history.days.map((d) => [d.day, d]));
  const paid = new Map<string, { model: string; usd: number }[]>();
  for (const row of history.paidByDay) paid.set(row.day, [...(paid.get(row.day) ?? []), { model: row.model, usd: row.usd }]);
  const end = Date.parse(`${history.to}T12:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(end - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    const row = byDay.get(day) ?? { day, requests: 0, errors: 0, aborted: 0, fallbacks: 0, neurons: 0, paidUsd: 0, audioSeconds: 0 };
    return { ...row, paid: paid.get(day) ?? [] };
  });
}

function Panel({ history, days }: { history: UsageHistory; days: UsageHistoryDays }) {
  const { t, plural, locale } = useI18n();
  const usd = useUsd();
  const number = (value: number, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const list = fill(history, days);
  const total = list.reduce(
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
  if (total.requests === 0 && history.models.length === 0) return <p className="text-sm text-fg-muted">{t("web.usage.empty")}</p>;
  const average = total.paid / days;
  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t("web.usage.paid")} value={usd(total.paid)} detail={`${t("web.usage.paidAverage", { usd: usd(average) })} · ${t("web.usage.projection", { usd: usd(average * 30) })}`} />
        <Tile label={t("web.usage.neurons")} value={number(total.neurons)} detail={t("web.usage.neuronsAverage", { neurons: number(total.neurons / days) })} />
        <Tile label={t("web.usage.requests")} value={number(total.requests)} detail={t("web.usage.failures", { errors: number(total.errors), aborted: number(total.aborted) })} />
        <Tile label={t("web.usage.fallbacks")} value={number(total.fallbacks)} detail={plural("web.usage.fallbacksValue", total.fallbacks)} />
      </dl>
      <PaidChart list={list} />
      <NeuronChart list={list} />
      <DayTable list={list} />
      <ModelTable history={history} />
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

/** Dates under the bars: first, middle and last, so 90 bars stay readable. Only for the eye. */
function Axis({ list }: { list: Day[] }) {
  const { locale } = useI18n();
  const short = new Intl.DateTimeFormat(locale, list.length <= 7 ? { weekday: "short", timeZone: "UTC" } : { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const marks = list.length <= 7 ? list : [list[0], list[Math.floor(list.length / 2)], list.at(-1)].filter((d): d is Day => d !== undefined);
  return (
    <div aria-hidden className={cn("flex text-xs text-fg-muted", list.length <= 7 ? "gap-1" : "justify-between")}>
      {marks.map((d) => (
        <span key={d.day} className={cn(list.length <= 7 && "flex-1 text-center")}>
          {short.format(Date.parse(`${d.day}T12:00:00Z`))}
        </span>
      ))}
    </div>
  );
}

function useDayLabel() {
  const { locale } = useI18n();
  return (day: string) => formatDateTimeParts(`${day}T12:00:00Z`, locale, "UTC").date;
}

/** US$ per day, one stacked piece per paid model. */
function PaidChart({ list }: { list: Day[] }) {
  const { t } = useI18n();
  const usd = useUsd();
  const dayLabel = useDayLabel();
  const peak = Math.max(0, ...list.map((d) => d.paidUsd));
  const models = [...new Set(list.flatMap((d) => d.paid.map((p) => p.model)))];
  const busiest = list.reduce((best, d) => (d.paidUsd > best.paidUsd ? d : best), list[0] as Day);
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold">{t("web.usage.chart.paid")}</figcaption>
      {peak === 0 ? (
        <p className="text-sm text-fg-muted">{t("web.usage.chart.paidEmpty")}</p>
      ) : (
        <>
          <p className="sr-only">
            {t("web.usage.chart.summary", { from: dayLabel(list[0]?.day ?? ""), to: dayLabel(list.at(-1)?.day ?? ""), peak: `${dayLabel(busiest.day)}, ${usd(busiest.paidUsd)}` })}
          </p>
          <div aria-hidden className={cn("flex h-36 items-end", list.length > 30 ? "gap-px" : "gap-1")}>
            {list.map((d) => (
              <div key={d.day} title={`${dayLabel(d.day)}: ${usd(d.paidUsd)}`} className="flex h-full min-w-0 flex-1 flex-col-reverse">
                {d.paid.map((p) => (
                  <span key={p.model} className={cn("w-full first:rounded-b-sm last:rounded-t-sm", seriesOf(p.model))} style={{ height: `${(p.usd / peak) * 100}%` }} />
                ))}
              </div>
            ))}
          </div>
          <Axis list={list} />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {models.map((model) => (
              <li key={model} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("h-2.5 w-2.5 rounded-sm", seriesOf(model))} />
                {modelLabel(model)}
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}

/** Neurons per day against the daily cap (a dashed line). */
function NeuronChart({ list }: { list: Day[] }) {
  const { t, locale } = useI18n();
  const usage = useUsage();
  const dayLabel = useDayLabel();
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  const cap = usage.data?.limits.neuronsPerDay ?? 0;
  const peak = Math.max(cap, 1, ...list.map((d) => d.neurons));
  const busiest = list.reduce((best, d) => (d.neurons > best.neurons ? d : best), list[0] as Day);
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold">{t("web.usage.chart.neurons")}</figcaption>
      <p className="sr-only">
        {t("web.usage.chart.summary", { from: dayLabel(list[0]?.day ?? ""), to: dayLabel(list.at(-1)?.day ?? ""), peak: `${dayLabel(busiest.day)}, ${number(busiest.neurons)}` })}
      </p>
      <div aria-hidden className="relative h-36">
        {cap > 0 && <span className="absolute inset-x-0 border-t border-dashed border-border-strong" style={{ bottom: `${(cap / peak) * 100}%` }} />}
        <div className={cn("flex h-full items-end", list.length > 30 ? "gap-px" : "gap-1")}>
          {list.map((d, i) => (
            <span
              key={d.day}
              title={`${dayLabel(d.day)}: ${number(d.neurons)}`}
              className={cn("min-w-0 flex-1 rounded-t-sm", i === list.length - 1 ? "bg-accent" : "bg-border-strong")}
              style={{ height: `${d.neurons > 0 ? Math.max(2, (d.neurons / peak) * 100) : 0}%` }}
            />
          ))}
        </div>
      </div>
      <Axis list={list} />
      {cap > 0 && <p className="text-xs text-fg-muted">{t("web.usage.chart.cap", { neurons: number(cap) })}</p>}
    </figure>
  );
}

/** The numbers behind the bars, for anyone who'd rather read them (and screen readers). Days with use only. */
function DayTable({ list }: { list: Day[] }) {
  const { t, locale } = useI18n();
  const usd = useUsd();
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  // Day and month only: the period never spans more than 90 days, and the table fits a phone.
  const short = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const used = list.filter((d) => d.requests > 0 || d.neurons > 0 || d.paidUsd > 0).reverse();
  if (used.length === 0) return null;
  return (
    <details className="rounded-xl border border-border">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">{t("web.usage.table.show")}</summary>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-raised text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("web.usage.col.day")}
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
              <tr key={d.day}>
                <th scope="row" className="px-2 py-2 font-normal whitespace-nowrap sm:px-3">
                  {short.format(Date.parse(`${d.day}T12:00:00Z`))}
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
function ModelTable({ history }: { history: UsageHistory }) {
  const { t, locale } = useI18n();
  const usd = useUsd();
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  const calls = history.models.reduce((n, m) => n + m.calls, 0);
  if (history.models.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t("web.usage.models")}</h3>
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
