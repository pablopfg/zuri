import { type ReviewMetrics, recommendationIndex } from "@zuri/shared";

/** A week or a month of the chart: its estimate, or null when nobody reviewed then. */
export interface Bar {
  key: string;
  index: number | null;
  promoters: number;
  neutrals: number;
  detractors: number;
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
  const bars = metrics.buckets.map((bucket) => ({ ...bucket, index: recommendationIndex(bucket) }));
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

/** The server's key of a week ("2026-11-09") or a month ("2026-11") as the chart writes it: "09/11" or "nov." */
export function barLabel(key: string, unit: "week" | "month", locale: string): string {
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
export const REVIEW_PARTS = ["lista", "ajustes"] as const;
export type ReviewPart = (typeof REVIEW_PARTS)[number];

/** Where an address under /avaliacoes should go instead, or null when it is a real one. */
export function reviewAddress(part: string | undefined, item: string | undefined): string | null {
  if (part === undefined) return null;
  if (part === "lista") return item === undefined || /^[0-9a-f-]{36}$/.test(item) ? null : "/avaliacoes/lista";
  if (part === "ajustes") return item === undefined || item === "responder" ? null : "/avaliacoes/ajustes";
  return "/avaliacoes";
}
