import { useQuery } from "@tanstack/react-query";
import { REVIEW_LIMITS, REVIEW_METRIC_PERIODS, type ReviewMetricPeriod, type ReviewMetrics, type ReviewPage, type ReviewsStatus } from "@zuri/shared";
import { MessageSquareText, Star, ThumbsUp, Timer } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Link } from "react-router";
import { buttonClass, cn, ErrorNotice, Loading, Notice } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { REVIEWS_KEY } from "../../lib/reviews.ts";
import { barHeight, barLabel, overview, percent, replyTime } from "./numbers.ts";
import { Mark, Stars } from "./parts.tsx";

const PERIOD_TEXT = { "30d": "web.reviews.period.30d", "6m": "web.reviews.period.6m", "12m": "web.reviews.period.12m" } as const;
/** How many of the waiting reviews the overview shows; the rest is in the list. */
const NEEDS_SHOWN = 3;

function Tile({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note?: string | undefined }) {
  return (
    <div className="zuri-review-tile">
      <dt>
        {icon}
        {label}
      </dt>
      <dd>
        <span className="block text-3xl font-semibold tracking-tight tabular-nums text-fg">{value}</span>
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
            <Tile icon={<Star aria-hidden />} label={t("web.reviews.average")} value={view.average === null ? "–" : one.format(view.average)} note={plural("web.reviews.count", view.total)} />
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
            <Chart bars={view.bars} unit={data.unit} />
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
                      <span aria-hidden className="h-2 overflow-hidden rounded-full bg-raised">
                        <span className="block h-full rounded-full bg-fg" style={{ width: `${share}%` }} />
                      </span>
                      <span className="text-right">{t("web.reviews.dist.row", { n: count, pct: share })}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
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

/**
 * The estimate by week or by month, as bars. The last one is the current
 * period, in the accent. A week or month nobody reviewed has no bar. The same
 * numbers come as a table for whoever cannot read a chart; the server may send
 * 5 or 6 weeks, or up to 12 months, so nothing here counts on a fixed number.
 */
function Chart({ bars, unit }: { bars: ReturnType<typeof overview>["bars"]; unit: "week" | "month" }) {
  const { t, locale } = useI18n();
  const id = useId();
  const any = bars.some((bar) => bar.index !== null);
  const shown = (index: number) => String(index).replace("-", "−");
  return (
    <section className="zuri-review-card" aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold">
        {t(unit === "week" ? "web.reviews.chart.week" : "web.reviews.chart.month")}
      </h2>
      {!any ? (
        <p className="mt-2 text-sm text-fg-muted">{t("web.reviews.chart.empty")}</p>
      ) : (
        <>
          <div aria-hidden className="zuri-review-bars">
            {bars.map((bar, position) => (
              <div key={bar.key}>
                <div>
                  {bar.index !== null && (
                    <>
                      <span className="text-xs font-semibold tabular-nums">{shown(bar.index)}</span>
                      <span data-bar data-last={position === bars.length - 1 ? "" : undefined} style={{ height: `${barHeight(bar.index)}%` }} />
                    </>
                  )}
                </div>
                <span className="truncate text-xs tabular-nums text-fg-muted">{barLabel(bar.key, unit, locale)}</span>
              </div>
            ))}
          </div>
          <details className="mt-3 text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-fg-muted underline-offset-2 hover:underline">{t("web.reviews.chart.table")}</summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-80 text-left tabular-nums">
                <thead className="text-xs text-fg-muted">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t(unit === "week" ? "web.reviews.chart.col.week" : "web.reviews.chart.col.month")}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("web.reviews.chart.col.index")}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("web.reviews.chart.col.yes")}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {t("web.reviews.chart.col.neutral")}
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      {t("web.reviews.chart.col.no")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bars.map((bar) => (
                    <tr key={bar.key} className="border-t border-border">
                      <th scope="row" className="py-1.5 pr-3 font-normal">
                        {barLabel(bar.key, unit, locale)}
                      </th>
                      <td className="py-1.5 pr-3">{bar.index === null ? t("web.reviews.none") : shown(bar.index)}</td>
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
