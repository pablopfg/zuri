import { dayOffset } from "../../lib/recents.ts";

const valid = (iso: string) => iso !== "" && !Number.isNaN(Date.parse(iso));

/** The hour of an instant in the owner's zone ("08:12"); empty while the message has no time yet. */
export function clock(iso: string, locale: string, timeZone: string): string {
  if (!valid(iso)) return "";
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/**
 * When a conversation was last used, as its row shows it: the hour under "Hoje"
 * and "Ontem" (the group names the day), the weekday and the hour for the rest
 * of the last seven days, and the date before that.
 */
export function rowWhen(iso: string, now: Date, locale: string, timeZone: string): string {
  const days = -dayOffset(iso, now, timeZone);
  if (days <= 1) return clock(iso, locale, timeZone);
  const instant = new Date(iso);
  if (days < 7) {
    // "sáb." in pt-BR: without the dot and with a capital, as the names of the groups.
    const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short" }).format(instant).replace(/\.$/, "");
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${clock(iso, locale, timeZone)}`;
  }
  return shortDate(iso, now, locale, timeZone);
}

/** The date in numbers ("02/11"), with the year when it is not this one. */
export function shortDate(iso: string, now: Date, locale: string, timeZone: string): string {
  const instant = new Date(iso);
  const year = (date: Date) => new Intl.DateTimeFormat("en", { timeZone, year: "numeric" }).format(date);
  return new Intl.DateTimeFormat(locale, { timeZone, day: "2-digit", month: "2-digit", ...(year(instant) === year(now) ? {} : { year: "numeric" }) }).format(instant);
}

/**
 * The day a message belongs to, for the line between the days of a
 * conversation: how far from today (0 today, -1 yesterday) and the date in
 * full. A message still being written has no time: it is today's.
 */
export function messageDay(iso: string, now: Date, locale: string, timeZone: string): { offset: number; date: string } {
  const instant = valid(iso) ? new Date(iso) : now;
  const year = (date: Date) => new Intl.DateTimeFormat("en", { timeZone, year: "numeric" }).format(date);
  return {
    offset: Math.min(0, dayOffset(instant.toISOString(), now, timeZone)),
    date: new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long", ...(year(instant) === year(now) ? {} : { year: "numeric" }) }).format(instant),
  };
}
