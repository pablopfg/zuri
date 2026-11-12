import { isValidCalendarDate } from "./dates.ts";

/**
 * Brazil's national holidays, worked out from the date alone: the fixed days of
 * the law and Good Friday, two days before Easter. No network and no table of
 * years. Carnival and Corpus Christi are optional days off, not holidays, and
 * state and city holidays stay out (owner's choice, 12/11/2026).
 */
export const NATIONAL_HOLIDAYS = ["newYear", "goodFriday", "tiradentes", "labourDay", "independence", "aparecida", "allSouls", "republic", "blackAwareness", "christmas"] as const;
export type NationalHoliday = (typeof NATIONAL_HOLIDAYS)[number];

const FIXED: Record<string, NationalHoliday> = {
  "01-01": "newYear",
  "04-21": "tiradentes",
  "05-01": "labourDay",
  "09-07": "independence",
  "10-12": "aparecida",
  "11-02": "allSouls",
  "11-15": "republic",
  "11-20": "blackAwareness",
  "12-25": "christmas",
};
/** 20/11 is national since law 14.759, of December 2023. */
const BLACK_AWARENESS_SINCE = 2024;

/** Easter Sunday of a year in the Gregorian calendar (the "anonymous" algorithm), as [month, day]. */
function easter(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return [Math.floor(n / 31), (n % 31) + 1];
}

/** The national holiday a local date ("YYYY-MM-DD") is, or null. */
export function nationalHoliday(date: string): NationalHoliday | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isValidCalendarDate(year, month, day)) return null;
  const [easterMonth, easterDay] = easter(year);
  const friday = new Date(Date.UTC(year, easterMonth - 1, easterDay - 2));
  // Good Friday first: when it falls on 21/4, the day has one name.
  if (friday.getUTCMonth() + 1 === month && friday.getUTCDate() === day) return "goodFriday";
  const fixed = FIXED[date.slice(5)] ?? null;
  return fixed === "blackAwareness" && year < BLACK_AWARENESS_SINCE ? null : fixed;
}
