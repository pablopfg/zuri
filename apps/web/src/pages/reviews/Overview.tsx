import { useQuery } from "@tanstack/react-query";
import { type MessageKey, REVIEW_LIMITS, REVIEW_METRIC_PERIODS, type ReviewMetricPeriod, type ReviewMetrics, type ReviewMetricUnit, type ReviewPage, type ReviewsStatus } from "@zuri/shared";
import { MessageSquareText, Star, ThumbsUp, Timer } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Link } from "react-router";
import { buttonClass, cn, ErrorNotice, Loading, Notice } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { REVIEWS_KEY } from "../../lib/reviews.ts";
import { type Bar, barHeight, barLabel, indexZone, MARGIN_MIN, overview, percent, ratingZone, replyTime, type Stats, stats, type Zone } from "./numbers.ts";
import { Mark, Stars } from "./parts.tsx";

const PERIOD_TEXT = {
  "30d": "web.reviews.period.30d",
  "6m": "web.reviews.period.6m",
  "12m": "web.reviews.period.12m",
  "24m": "web.reviews.period.24m",
  "5y": "web.reviews.period.5y",
} as const;
const ZONES = ["excellent", "great", "fair", "poor"] as const;
const ZONE_TEXT: Record<Zone, MessageKey> = { excellent: "web.reviews.zone.excellent", great: "web.reviews.zone.great", fair: "web.reviews.zone.fair", poor: "web.reviews.zone.poor" };
const ZONE_RANGE: Record<Zone, MessageKey> = {
  excellent: "web.reviews.zone.excellent.range",
  great: "web.reviews.zone.great.range",
  fair: "web.reviews.zone.fair.range",
  poor: "web.reviews.zone.poor.range",
};
const INDEX_TITLE: Record<ReviewMetricUnit, MessageKey> = { week: "web.reviews.chart.week", month: "web.reviews.chart.month", semester: "web.reviews.chart.semester", year: "web.reviews.chart.year" };
const VOLUME_TITLE: Record<ReviewMetricUnit, MessageKey> = { week: "web.reviews.volume.week", month: "web.reviews.volume.month", semester: "web.reviews.volume.semester", year: "web.reviews.volume.year" };
const UNIT_COLUMN: Record<ReviewMetricUnit, MessageKey> = {
  week: "web.reviews.chart.col.week",
  month: "web.reviews.chart.col.month",
  semester: "web.reviews.chart.col.semester",
  year: "web.reviews.chart.col.year",
};
const PER_UNIT: Record<ReviewMetricUnit, MessageKey> = { week: "web.reviews.stats.per.week", month: "web.reviews.stats.per.month", semester: "web.reviews.stats.per.semester", year: "web.reviews.stats.per.year" };
/** The three parts of a bar of reviews, by the stars, and the color each one has everywhere on the screen. */
const PARTS = [
  ["yes", "web.reviews.chart.col.yes"],
  ["neutral", "web.reviews.chart.col.neutral"],
  ["no", "web.reviews.chart.col.no"],
] as const;
/** Below this the trend is noise: the screen says the index holds. */
const TREND_FLAT = 0.5;
/** How many of the waiting reviews the overview shows; the rest is in the list. */
const NEEDS_SHOWN = 3;

/** The band of a number, by name; the dot only repeats it in color. */
function ZoneTag({ zone }: { zone: Zone }) {
  const { t } = useI18n();
  return (
    <span className="zuri-review-zone" data-zone={zone}>
      {t(ZONE_TEXT[zone])}
    </span>
  );
}

function Tile({ icon, label, value, note, zone }: { icon: ReactNode; label: string; value: string; note?: string | undefined; zone?: Zone | undefined }) {
  return (
    <div className="zuri-review-tile">
      <dt>
        {icon}
        {label}
      </dt>
      <dd>
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-3xl font-semibold tracking-tight tabular-nums text-fg">{value}</span>
          {zone && <ZoneTag zone={zone} />}
        </span>
        {note && <span className="block text-sm text-fg-muted">{note}</span>}
      </dd>
    </div>
  );
}

/**
 * Avaliações › Visão geral: the numbers of the reviews written in a period.
 * The server sends counts only; the estimate, the average and the shares are
 * worked out here (numbers.ts). The requests' funnel stays away until Zuri
 * sends requests: zeros there would read as "nobody opened the link".
 */
export function Overview({ status }: { status: ReviewsStatus }) {
  const { t, plural, locale } = useI18n();
  const [period, setPeriod] = useState<ReviewMetricPeriod>("30d");
  const periodId = useId();
  const metrics = useQuery({
    queryKey: [...REVIEWS_KEY, "metrics", period],
    queryFn: ({ signal }) => api<ReviewMetrics>(`/reviews/metrics?period=${period}`, { signal }),
    // The period before stays on the screen while the next one comes.
    placeholderData: (before) => before,
  });
  // Its own key, apart from the list's pages (another shape under the same filter).
  const waiting = useQuery({
    queryKey: [...REVIEWS_KEY, "waiting"],
    queryFn: ({ signal }) => api<ReviewPage>("/reviews?tab=needs", { signal }),
    enabled: status.needs > 0,
  });
  const needs = { ...waiting, data: waiting.data?.items.slice(0, NEEDS_SHOWN) };

  const data = metrics.data;
  const view = data ? overview(data) : null;
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const time = data?.medianReplyMinutes != null ? replyTime(data.medianReplyMinutes) : null;
  const numbers = data ? stats(data) : null;
  // A half year has no name in Intl: "1º sem. 2026".
  const label = (key: string) => {
    if (data?.unit !== "semester") return barLabel(key, data?.unit ?? "week", locale);
    const [year, half] = key.split("-S");
    return t("web.reviews.chart.semester.label", { n: half ?? "", ano: year ?? "" });
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <label htmlFor={periodId} className="text-sm font-medium">
          {t("web.reviews.period")}
        </label>
        <select id={periodId} className="zuri-review-select w-auto" value={period} onChange={(e) => setPeriod(e.target.value as ReviewMetricPeriod)}>
          {REVIEW_METRIC_PERIODS.map((key) => (
            <option key={key} value={key}>
              {t(PERIOD_TEXT[key])}
            </option>
          ))}
        </select>
      </div>

      {metrics.isPending ? (
        <Loading rows={4} />
      ) : !data || !view ? (
        <ErrorNotice error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : (
        <>
          {data.partial && <Notice>{t("web.reviews.partial", { max: REVIEW_LIMITS.metricsRows.toLocaleString(locale) })}</Notice>}
          <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-busy={metrics.isPlaceholderData || undefined}>
            <Tile
              icon={<ThumbsUp aria-hidden />}
              label={t("web.reviews.index")}
              value={view.index === null ? "–" : String(view.index).replace("-", "−")}
              zone={view.index === null ? undefined : indexZone(view.index)}
              note={
                view.index === null
                  ? t("web.reviews.none")
                  : view.delta === null
                    ? undefined
                    : view.delta === 0
                      ? t("web.reviews.index.same")
                      : t(view.delta > 0 ? "web.reviews.index.up" : "web.reviews.index.down", { n: Math.abs(view.delta) })
              }
            />
            <Tile icon={<Star aria-hidden />} label={t("web.reviews.average")} value={view.average === null ? "–" : one.format(view.average)}
              note={plural("web.reviews.count", view.total)}
              zone={view.average === null ? undefined : ratingZone(view.average)}
            />
            <Tile
              icon={<MessageSquareText aria-hidden />}
              label={t("web.reviews.replied")}
              value={view.repliedPercent === null ? "–" : `${view.repliedPercent}%`}
              note={view.total > 0 ? t("web.reviews.replied.of", { n: data.replied, total: view.total }) : undefined}
            />
            <Tile
              icon={<Timer aria-hidden />}
              label={t("web.reviews.time")}
              value={time ? (time.unit === "day" ? plural("web.reviews.time.day", time.n) : t(time.unit === "hour" ? "web.reviews.time.hour" : "web.reviews.time.minute", { n: time.n })) : "–"}
              note={t(time ? "web.reviews.time.half" : data.replied > 0 ? "web.reviews.time.unknown" : "web.reviews.time.none")}
            />
          </dl>

          <div className="zuri-review-split">
            <IndexChart bars={view.bars} unit={data.unit} label={label} />
            <section className="zuri-review-card" aria-labelledby={`${periodId}-stars`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 id={`${periodId}-stars`} className="text-base font-semibold">
                  {t("web.reviews.dist")}
                </h2>
                {view.total > 0 && <p className="text-sm text-fg-muted">{t("web.reviews.dist.summary", { sim: view.promoters, neutros: view.neutrals, nao: view.detractors })}</p>}
              </div>
              <ul className="mt-4 space-y-3">
                {data.ratings.map((count, position) => {
                  const stars = 5 - position;
                  const share = percent(count, view.total);
                  return (
                    <li key={stars} className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm tabular-nums">
                      <span className="inline-flex items-center gap-1" role="img" aria-label={plural("web.reviews.stars", stars)}>
                        {stars}
                        <Star className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
                      </span>
                      <span aria-hidden className="zuri-review-meter">
                        <span data-part={stars === 5 ? "yes" : stars === 4 ? "neutral" : "no"} style={{ width: `${share}%` }} />
                      </span>
                      <span className="text-right">{t("web.reviews.dist.row", { n: count, pct: share })}</span>
                    </li>
                  );
                })}
              </ul>
              <Legend />
            </section>
          </div>

          <div className="zuri-review-split">
            <VolumeChart bars={view.bars} unit={data.unit} label={label} />
            {numbers && <Statistics numbers={numbers} unit={data.unit} index={view.index} label={label} />}
          </div>
          {data.requests && <Funnel funnel={data.requests} />}
        </>
      )}

      <section className="zuri-review-card" aria-labelledby={`${periodId}-needs`}>
        <div className="flex items-center justify-between gap-3">
          <h2 id={`${periodId}-needs`} className="text-base font-semibold">
            {t("web.reviews.needs.title")}
          </h2>
          {status.needs > 0 && (
            <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold tabular-nums" aria-hidden>
              {status.needs}
            </span>
          )}
        </div>
        {status.needs === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">{t("web.reviews.empty.needs.body")}</p>
        ) : needs.isPending ? (
          <Loading rows={2} />
        ) : !needs.data ? (
          <ErrorNotice error={needs.error} onRetry={() => void needs.refetch()} />
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border">
              {needs.data.map((review) => {
                const name = review.anonymous || !review.firstName ? t("web.reviews.anonymous") : review.firstName;
                return (
                  <li key={review.id} className="flex items-center gap-3 py-3">
                    <Mark firstName={review.firstName} anonymous={review.anonymous} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                        <span className="min-w-0 truncate">{name}</span>
                        <Stars rating={review.rating} />
                      </p>
                      <p className={cn("line-clamp-2 break-words text-sm leading-5 text-fg-muted", !review.comment && "italic")}>{review.comment || t("web.reviews.noText")}</p>
                    </div>
                    <Link to={`/avaliacoes/lista/${review.id}`} className={buttonClass("secondary", "shrink-0")} aria-label={t("web.reviews.needs.reviewOf", { nome: name })}>
                      {t("web.reviews.needs.review")}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {status.needs > needs.data.length && (
              <Link to="/avaliacoes/lista" className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">
                {t("web.reviews.needs.more", { n: status.needs - needs.data.length })}
              </Link>
            )}
          </>
        )}
      </section>

      <p className="max-w-prose text-xs leading-5 text-fg-muted">{t("web.reviews.index.note")}</p>
    </div>
  );
}

/** What the three colors of the reviews mean, once per card that uses them. */
function Legend() {
  const { t } = useI18n();
  return (
    <ul className="zuri-review-legend">
      {PARTS.map(([part, text]) => (
        <li key={part} data-part={part}>
          {t(text)}
        </li>
      ))}
    </ul>
  );
}

type Label = (key: string) => string;
const shown = (index: number) => String(index).replace("-", "−");

/**
 * The estimate by week, month, half year or year, as bars in the color of
 * their band (the band's name is in the legend and in the table, never in the
 * color alone). One nobody reviewed has no bar. The same numbers come as a
 * table for whoever cannot read a chart; the server sends from 4 to 12 bars,
 * so nothing here counts on a fixed number.
 */
function IndexChart({ bars, unit, label }: { bars: Bar[]; unit: ReviewMetricUnit; label: Label }) {
  const { t, locale } = useI18n();
  const id = useId();
  const any = bars.some((bar) => bar.index !== null);
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <section className="zuri-review-card" aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold">
        {t(INDEX_TITLE[unit])}
      </h2>
      {!any ? (
        <p className="mt-2 text-sm text-fg-muted">{t("web.reviews.chart.empty")}</p>
      ) : (
        <>
          <div aria-hidden className="zuri-review-bars">
            {bars.map((bar) => (
              <div key={bar.key}>
                <div>
                  {bar.index !== null && (
                    <>
                      <span className="text-xs font-semibold tabular-nums">{shown(bar.index)}</span>
                      <span data-bar data-zone={indexZone(bar.index)} style={{ height: `${barHeight(bar.index)}%` }} />
                    </>
                  )}
                </div>
                <span className="text-center text-xs leading-tight tabular-nums text-fg-muted">{label(bar.key)}</span>
              </div>
            ))}
          </div>
          <ul className="zuri-review-legend">
            {ZONES.map((zone) => (
              <li key={zone} data-zone={zone}>
                {t(ZONE_RANGE[zone])}
              </li>
            ))}
          </ul>
          <details className="mt-1 text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-fg-muted underline-offset-2 hover:underline">{t("web.reviews.chart.table")}</summary>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a table wider than a phone scrolls sideways, and the keyboard must reach it to scroll */}
            <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" tabIndex={0}>
              <table className="w-full min-w-80 text-left tabular-nums">
                <thead className="text-xs text-fg-muted">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t(UNIT_COLUMN[unit])}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("web.reviews.chart.col.index")}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("web.reviews.chart.col.zone")}
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      {t("web.reviews.average")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bars.map((bar) => (
                    <tr key={bar.key} className="border-t border-border">
                      <th scope="row" className="py-1.5 pr-3 font-normal">
                        {label(bar.key)}
                      </th>
                      <td className="py-1.5 pr-3">{bar.index === null ? t("web.reviews.none") : shown(bar.index)}</td>
                      <td className="py-1.5 pr-3">{bar.index === null ? "–" : t(ZONE_TEXT[indexZone(bar.index)])}</td>
                      <td className="py-1.5">{bar.average === null ? "–" : one.format(bar.average)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

/**
 * How many reviews came in each week, month, half year or year: one bar each,
 * as tall as its count against the busiest one, split in who recommends, who
 * is neutral and who does not. The count sits on the bar and the table has
 * every number.
 */
function VolumeChart({ bars, unit, label }: { bars: Bar[]; unit: ReviewMetricUnit; label: Label }) {
  const { t } = useI18n();
  const id = useId();
  const most = Math.max(0, ...bars.map((bar) => bar.total));
  return (
    <section className="zuri-review-card" aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold">
        {t(VOLUME_TITLE[unit])}
      </h2>
      {most === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">{t("web.reviews.chart.empty")}</p>
      ) : (
        <>
          <div aria-hidden className="zuri-review-bars">
            {bars.map((bar) => (
              <div key={bar.key}>
                <div>
                  {bar.total > 0 && (
                    <>
                      <span className="text-xs font-semibold tabular-nums">{bar.total}</span>
                      <span data-stack style={{ height: `${Math.max(4, Math.round((bar.total / most) * 100))}%` }}>
                        {bar.promoters > 0 && <span data-part="yes" style={{ flexGrow: bar.promoters }} />}
                        {bar.neutrals > 0 && <span data-part="neutral" style={{ flexGrow: bar.neutrals }} />}
                        {bar.detractors > 0 && <span data-part="no" style={{ flexGrow: bar.detractors }} />}
                      </span>
                    </>
                  )}
                </div>
                <span className="text-center text-xs leading-tight tabular-nums text-fg-muted">{label(bar.key)}</span>
              </div>
            ))}
          </div>
          <Legend />
          <details className="mt-1 text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-fg-muted underline-offset-2 hover:underline">{t("web.reviews.chart.table")}</summary>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a table wider than a phone scrolls sideways, and the keyboard must reach it to scroll */}
            <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" tabIndex={0}>
              <table className="w-full min-w-80 text-left tabular-nums">
                <thead className="text-xs text-fg-muted">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t(UNIT_COLUMN[unit])}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("web.reviews.chart.col.total")}
                    </th>
                    {PARTS.map(([part, text]) => (
                      <th key={part} scope="col" className="py-1 pr-3 font-medium last:pr-0">
                        {t(text)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bars.map((bar) => (
                    <tr key={bar.key} className="border-t border-border">
                      <th scope="row" className="py-1.5 pr-3 font-normal">
                        {label(bar.key)}
                      </th>
                      <td className="py-1.5 pr-3">{bar.total}</td>
                      <td className="py-1.5 pr-3">{bar.promoters}</td>
                      <td className="py-1.5 pr-3">{bar.neutrals}</td>
                      <td className="py-1.5">{bar.detractors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

/** More parameters out of the period's counts, each with a line that says how to read it. */
function Statistics({ numbers, unit, index, label }: { numbers: Stats; unit: ReviewMetricUnit; index: number | null; label: Label }) {
  const { t, plural, locale } = useI18n();
  const id = useId();
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const two = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const low = Math.max(-100, (index ?? 0) - (numbers.margin ?? 0));
  const high = Math.min(100, (index ?? 0) + (numbers.margin ?? 0));
  const rows: [string, string, string][] = [
    [t("web.reviews.stats.satisfied"), `${numbers.satisfied}%`, t("web.reviews.stats.satisfied.note")],
    [
      t("web.reviews.stats.margin"),
      numbers.margin === null ? "–" : plural("web.reviews.stats.margin.value", numbers.margin),
      numbers.margin === null ? t("web.reviews.stats.margin.few", { min: MARGIN_MIN }) : t("web.reviews.stats.margin.note", { de: shown(low), ate: shown(high) }),
    ],
    [
      t("web.reviews.stats.trend"),
      numbers.trend === null
        ? "–"
        : Math.abs(numbers.trend) < TREND_FLAT
          ? t("web.reviews.stats.trend.flat")
          : t(numbers.trend > 0 ? "web.reviews.stats.trend.up" : "web.reviews.stats.trend.down", { n: one.format(Math.abs(numbers.trend)) }),
      t(numbers.trend === null ? "web.reviews.stats.trend.none" : "web.reviews.stats.trend.note"),
    ],
    [t("web.reviews.stats.median"), t("web.reviews.stats.of5", { n: one.format(numbers.median) }), t("web.reviews.stats.median.note")],
    [t("web.reviews.stats.mode"), list.format(numbers.modes.map(String)), t("web.reviews.stats.mode.note")],
    [t("web.reviews.stats.deviation"), two.format(numbers.deviation), t("web.reviews.stats.deviation.note")],
    [t(PER_UNIT[unit]), one.format(numbers.perBar), t("web.reviews.stats.peak", { quando: label(numbers.peak.key), n: numbers.peak.total })],
  ];
  return (
    <section className="zuri-review-card" aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold">
        {t("web.reviews.stats")}
      </h2>
      <dl className="mt-2 divide-y divide-border">
        {rows.map(([name, value, note]) => (
          <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2.5">
            <dt className="text-sm font-medium">{name}</dt>
            <dd className="text-right text-sm font-semibold tabular-nums">{value}</dd>
            <dd className="col-span-2 text-xs leading-5 text-fg-muted">{note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The requests' funnel (PR S20): from the link to the review, in the period. Shown only once Zuri sent requests. */
function Funnel({ funnel }: { funnel: NonNullable<ReviewMetrics["requests"]> }) {
  const { t } = useI18n();
  const id = useId();
  const rows = [
    ["web.reviews.funnel.sent", funnel.sent],
    ["web.reviews.funnel.opened", funnel.opened],
    ["web.reviews.funnel.reviewed", funnel.reviewed],
  ] as const;
  return (
    <section className="zuri-review-card" aria-labelledby={`${id}-fun`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-fun`} className="text-base font-semibold">
          {t("web.reviews.funnel.title")}
        </h2>
        <Link to="/avaliacoes/pedidos" className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">
          {t("web.reviews.funnel.see")}
        </Link>
      </div>
      <ul className="mt-3 space-y-3">
        {rows.map(([key, n], index) => {
          const share = percent(n, funnel.sent);
          return (
            <li key={key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5.5rem] items-center gap-3 text-sm tabular-nums">
              <span>{t(key)}</span>
              <span aria-hidden className="zuri-review-meter">
                <span data-part="yes" style={{ width: `${share}%` }} />
              </span>
              <span className="text-right">{index === 0 ? n : t("web.reviews.funnel.row", { n, pct: share })}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs leading-5 text-fg-muted">{t("web.reviews.funnel.hint")}</p>
    </section>
  );
}
