import { type ReviewMetrics, recommendationIndex } from "@zuri/shared";

/** A week, month, half year or year of the charts: its estimate and average, or null when nobody reviewed then. */
export interface Bar {
  key: string;
  index: number | null;
  promoters: number;
  neutrals: number;
  detractors: number;
  total: number;
  /** The average rating, from 1 to 5. */
  average: number | null;
}

export interface Overview {
  total: number;
  /** -100 to 100; null without reviews (the screen says so, never a zero). */
  index: number | null;
  /** The last week or month with reviews against the first one; null with fewer than two. */
  delta: number | null;
  average: number | null;
  /** Whole percent of the period's reviews with a reply; null without reviews. */
  repliedPercent: number | null;
  promoters: number;
  neutrals: number;
  detractors: number;
  bars: Bar[];
}

/**
 * The overview's numbers out of the server's counts (PR S11 sends counts only):
 * 5 stars recommend, 4 are neutral, 1 to 3 do not.
 */
export function overview(metrics: ReviewMetrics): Overview {
  const [five, four, three, two, one] = metrics.ratings;
  const total = five + four + three + two + one;
  const counts = { promoters: five, neutrals: four, detractors: three + two + one };
  const bars = metrics.buckets.map((bucket) => {
    const count = bucket.promoters + bucket.neutrals + bucket.detractors;
    // An answer without the sum of the stars (an older server) has no average, never a NaN on the screen.
    return { ...bucket, index: recommendationIndex(bucket), total: count, average: count > 0 && Number.isFinite(bucket.stars) ? bucket.stars / count : null };
  });
  const known = bars.filter((bar) => bar.index !== null);
  return {
    total,
    index: recommendationIndex(counts),
    delta: known.length >= 2 ? (known.at(-1)?.index ?? 0) - (known[0]?.index ?? 0) : null,
    average: total > 0 ? (5 * five + 4 * four + 3 * three + 2 * two + one) / total : null,
    repliedPercent: total > 0 ? Math.round((metrics.replied / total) * 100) : null,
    ...counts,
    bars,
  };
}

/** How good a number is, for its color and its name: the usual bands of a recommendation index. */
export type Zone = "excellent" | "great" | "fair" | "poor";

/** The band of an index: 75 and up, 50 to 74, 0 to 49, below zero. */
export function indexZone(index: number): Zone {
  return index >= 75 ? "excellent" : index >= 50 ? "great" : index >= 0 ? "fair" : "poor";
}

/** The band of an average rating as the screen writes it, with one decimal: 4.5 and up, 4 to 4.4, 3 to 3.9, below 3. */
export function ratingZone(rating: number): Zone {
  const average = Math.round(rating * 10) / 10;
  return average >= 4.5 ? "excellent" : average >= 4 ? "great" : average >= 3 ? "fair" : "poor";
}

export interface Stats {
  /** The middle rating; of an even count, the mean of the two in the middle. */
  median: number;
  /** The rating (or ratings, on a tie) given most often, highest first. */
  modes: number[];
  /** How far the ratings spread from the average (population standard deviation). */
  deviation: number;
  /** Whole percent of 4 and 5 stars. */
  satisfied: number;
  /** Half the width of the index's 95% interval, in points: few reviews, wide margin. Null below `MARGIN_MIN` reviews. */
  margin: number | null;
  /** Reviews per week, month, half year or year of the period. */
  perBar: number;
  /** The one with most reviews (the latest on a tie). */
  peak: Bar;
  /** Points the index gains or loses from one bar with reviews to the next (least squares); null with fewer than three. */
  trend: number | null;
}

/** Below this many reviews a margin would be a guess: the screen says so instead. */
export const MARGIN_MIN = 10;

/**
 * Half the width of the 95% interval of an index made of `yes` promoters and
 * `no` detractors among `n` reviews. One review more is counted in each of the
 * three groups before the spread is taken, so reviews that all agree never
 * claim a margin of zero; the least it says is one point.
 */
export function indexMargin(yes: number, no: number, n: number): number | null {
  if (n < MARGIN_MIN) return null;
  const p = (yes + 1) / (n + 3);
  const d = (no + 1) / (n + 3);
  return Math.max(1, Math.round(1.96 * Math.sqrt((p + d - (p - d) ** 2) / (n + 3)) * 100));
}

/** More parameters out of the same counts; null without reviews. */
export function stats(metrics: ReviewMetrics): Stats | null {
  const view = overview(metrics);
  const n = view.total;
  // No bars with reviews counted is not an answer of this server (SEC-GRAF-03): no numbers rather than a crash.
  if (n === 0 || view.average === null || view.bars.length === 0) return null;
  // The ratings in order, as [stars, count], lowest first.
  const counts = metrics.ratings.map((count, position) => [5 - position, count] as const).reverse();
  const at = (rank: number) => {
    let seen = 0;
    for (const [stars, count] of counts) {
      seen += count;
      if (rank < seen) return stars;
    }
    return 5;
  };
  const most = Math.max(...metrics.ratings);
  const variance = counts.reduce((sum, [stars, count]) => sum + count * (stars - (view.average as number)) ** 2, 0) / n;
  const known = view.bars.map((bar, x) => ({ x, y: bar.index })).filter((point): point is { x: number; y: number } => point.y !== null);
  let trend: number | null = null;
  if (known.length >= 3) {
    const meanX = known.reduce((sum, point) => sum + point.x, 0) / known.length;
    const meanY = known.reduce((sum, point) => sum + point.y, 0) / known.length;
    const spread = known.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
    trend = known.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / spread;
  }
  return {
    median: (at(Math.floor((n - 1) / 2)) + at(Math.ceil((n - 1) / 2))) / 2,
    modes: metrics.ratings.flatMap((count, position) => (count === most ? [5 - position] : [])),
    deviation: Math.sqrt(variance),
    satisfied: percent(metrics.ratings[0] + metrics.ratings[1], n),
    margin: indexMargin(view.promoters, view.detractors, n),
    perBar: n / Math.max(1, view.bars.length),
    peak: view.bars.reduce((best, bar) => (bar.total >= best.total ? bar : best)),
    trend,
  };
}

/** Part of a whole as a whole percent; 0 of nothing is 0. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** How tall a bar is, from 4 to 100: -100 sits at the floor and 100 at the top, so a negative estimate still shows. */
export function barHeight(index: number): number {
  return Math.max(4, Math.round((Math.min(100, Math.max(-100, index)) + 100) / 2));
}

/** "Half replied within": minutes below an hour, hours below two days, days after that. */
export function replyTime(minutes: number): { n: number; unit: "minute" | "hour" | "day" } {
  if (minutes < 60) return { n: Math.max(0, Math.round(minutes)), unit: "minute" };
  if (minutes < 48 * 60) return { n: Math.round(minutes / 60), unit: "hour" };
  return { n: Math.round(minutes / 1440), unit: "day" };
}

/**
 * The server's key of a week ("2026-11-09") or a month ("2026-11") as the chart writes it: "09/11" or "nov."
 * A year ("2026") is its own name; a half year ("2026-S2") is written by the screen, which has the words.
 */
export function barLabel(key: string, unit: ReviewMetrics["unit"], locale: string): string {
  if (unit === "year" || unit === "semester") return key;
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat(locale, unit === "week" ? { timeZone: "UTC", day: "2-digit", month: "2-digit" } : { timeZone: "UTC", month: "short" }).format(date);
}

/** The count to the next check as "8:47" or "1:02:03"; never below zero. */
export function countdown(msLeft: number): string {
  const total = Number.isFinite(msLeft) ? Math.max(0, Math.ceil(msLeft / 1000)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The letter in a reviewer's round mark: the first letter of the first name, "?" for an anonymous one. */
export function mark(firstName: string, anonymous: boolean): string {
  const letter = anonymous ? undefined : (firstName.match(/[\p{L}\p{N}]/u) ?? [])[0];
  return letter ? letter.toUpperCase() : "?";
}

/** The parts of the area after /avaliacoes; App.tsx sends anything else back to the overview. */
export const REVIEW_PARTS = ["lista", "pedidos", "ajustes"] as const;
export type ReviewPart = (typeof REVIEW_PARTS)[number];

/** The parts of Avaliações › Ajustes after /avaliacoes/ajustes (none: the connection). */
export const REVIEW_SETTING_PARTS = ["responder", "pedidos"] as const;

/** Where an address under /avaliacoes should go instead, or null when it is a real one. */
export function reviewAddress(part: string | undefined, item: string | undefined): string | null {
  if (part === undefined) return null;
  if (part === "lista" || part === "pedidos") return item === undefined || /^[0-9a-f-]{36}$/.test(item) ? null : `/avaliacoes/${part}`;
  if (part === "ajustes") return item === undefined || (REVIEW_SETTING_PARTS as readonly string[]).includes(item) ? null : "/avaliacoes/ajustes";
  return "/avaliacoes";
}

/** The WhatsApp address that opens a chat with `phone` (digits only) and the text written in. */
export function whatsAppLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
