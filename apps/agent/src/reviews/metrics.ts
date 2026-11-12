import { REVIEW_LIMITS, type ReviewMetricBucket, type ReviewMetricPeriod, type ReviewMetrics, type ReviewMetricUnit, zonedParts, zonedTimeToUtc } from "@zuri/shared";
import type { Database } from "../db/database.ts";

/**
 * The overview of the reviews (PR S11): how many of each rating, the
 * recommendation estimate by week or month, how many were answered and how
 * long the answers took. Read from the copy Zuri already keeps, through an
 * index made for it (migration 35), in the owner's time zone. Numbers only:
 * no name, text or id of a review leaves through here.
 */

/** What the numbers need of a review. */
export interface MetricRow {
  created_at: string;
  rating: number;
  replied_at: string | null;
  /** 1 when Google shows a reply. */
  answered: number;
}

export interface MetricWindow {
  /** The first instant counted. */
  from: number;
  unit: ReviewMetricUnit;
  /** Oldest first: the local key and the instant each one starts. */
  buckets: { key: string; start: number }[];
}

const two = (n: number) => String(n).padStart(2, "0");

/** The instant a local day starts; the calendar math runs in UTC, so a month's end and a leap year come right. */
function dayStart(year: number, month: number, day: number, timeZone: string): { key: string; start: number } {
  const date = new Date(Date.UTC(year, month - 1, day));
  const parts = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 0, minute: 0 };
  // The date always exists, so the null of zonedTimeToUtc never comes.
  const start = (zonedTimeToUtc(parts, timeZone) as Date).getTime();
  return { key: `${parts.year}-${two(parts.month)}-${two(parts.day)}`, start };
}

/**
 * The period ending now, in the owner's zone. 30 days: today and the 29 days
 * before, in weeks from Monday (the first and the last are cut by the period).
 * 6 and 12 months: this month and the 5 or 11 before, each one whole but this.
 * 24 months: this half of the year (January to June, July to December) and the
 * 3 before. 5 years: this year and the 4 before.
 */
export function metricWindow(period: ReviewMetricPeriod, now: number, timeZone: string): MetricWindow {
  const today = zonedParts(new Date(now), timeZone);
  if (period === "30d") {
    const first = dayStart(today.year, today.month, today.day - 29, timeZone);
    // Monday of the first day's week (Sunday is 0).
    const back = (new Date(Date.UTC(today.year, today.month - 1, today.day - 29)).getUTCDay() + 6) % 7;
    const buckets = [];
    for (let offset = -29 - back; offset <= 0; offset += 7) buckets.push(dayStart(today.year, today.month, today.day + offset, timeZone));
    return { from: first.start, unit: "week", buckets };
  }
  if (period === "24m") {
    const half = today.month <= 6 ? 0 : 1;
    const buckets = [];
    for (let back = 3; back >= 0; back--) {
      // Halves counted from year 0, so going back crosses the year by itself.
      const count = today.year * 2 + half - back;
      const { start } = dayStart(Math.floor(count / 2), (count % 2) * 6 + 1, 1, timeZone);
      buckets.push({ key: `${Math.floor(count / 2)}-S${(count % 2) + 1}`, start });
    }
    return { from: (buckets[0] as { start: number }).start, unit: "semester", buckets };
  }
  if (period === "5y") {
    const buckets = [];
    for (let back = 4; back >= 0; back--) buckets.push({ key: String(today.year - back), start: dayStart(today.year - back, 1, 1, timeZone).start });
    return { from: (buckets[0] as { start: number }).start, unit: "year", buckets };
  }
  const months = period === "6m" ? 6 : 12;
  const buckets = [];
  for (let back = months - 1; back >= 0; back--) {
    const { key, start } = dayStart(today.year, today.month - back, 1, timeZone);
    buckets.push({ key: key.slice(0, 7), start });
  }
  return { from: (buckets[0] as { start: number }).start, unit: "month", buckets };
}

/** The middle value; of an even count, the mean of the two in the middle. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[middle] as number) : Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

/** The numbers of `rows` (reviews written from `window.from` on, with 1 to 5 stars). */
export function summarize(period: ReviewMetricPeriod, window: MetricWindow, rows: readonly MetricRow[], partial = false): ReviewMetrics {
  const ratings: ReviewMetrics["ratings"] = [0, 0, 0, 0, 0];
  const buckets: ReviewMetricBucket[] = window.buckets.map(({ key }) => ({ key, promoters: 0, neutrals: 0, detractors: 0, stars: 0 }));
  const waits: number[] = [];
  let replied = 0;
  for (const row of rows) {
    const at = Date.parse(row.created_at);
    if (!(at >= window.from) || !(row.rating >= 1 && row.rating <= 5)) continue;
    ratings[5 - row.rating] = (ratings[5 - row.rating] as number) + 1;
    let index = window.buckets.length - 1;
    while (index > 0 && (window.buckets[index] as { start: number }).start > at) index--;
    const bucket = buckets[index] as ReviewMetricBucket;
    bucket.stars += row.rating;
    if (row.rating === 5) bucket.promoters++;
    else if (row.rating === 4) bucket.neutrals++;
    else bucket.detractors++;
    if (!row.answered) continue;
    replied++;
    const answeredAt = row.replied_at ? Date.parse(row.replied_at) : Number.NaN;
    // A reply dated before the review (a clock apart, a review written again) counts as at once.
    if (!Number.isNaN(answeredAt)) waits.push(Math.max(0, Math.round((answeredAt - at) / 60_000)));
  }
  return { period, from: new Date(window.from).toISOString(), unit: window.unit, ratings, buckets, replied, medianReplyMinutes: median(waits), requests: null, partial };
}

/** The same text as migration 35's index, so the read never touches the table (rule P2). */
export const METRICS_SQL = `SELECT created_at, rating, replied_at, reply IS NOT NULL AS answered FROM zur_reviews
  WHERE created_at >= ? AND state != 'removed' AND rating BETWEEN 1 AND 5 ORDER BY created_at DESC LIMIT ?`;

/** The overview of `period`; `enabled` false (the module is off) answers zeros without reading. */
export function readMetrics(db: Database, period: ReviewMetricPeriod, now: number, timeZone: string, enabled: boolean): ReviewMetrics {
  const window = metricWindow(period, now, timeZone);
  if (!enabled) return summarize(period, window, []);
  const rows = db.all<MetricRow>(METRICS_SQL, new Date(window.from).toISOString(), REVIEW_LIMITS.metricsRows + 1);
  return summarize(period, window, rows.slice(0, REVIEW_LIMITS.metricsRows), rows.length > REVIEW_LIMITS.metricsRows);
}
