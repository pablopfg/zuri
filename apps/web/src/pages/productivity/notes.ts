import { NOTE_CONTENT_MAX } from "@zuri/shared";

// The hour and the date are written here, not taken from the conversation's helpers: a module two
// on-demand screens share becomes a chunk of its own, and its name weighs on the first load (rule P11).

/**
 * How many calendar days, in the owner's zone, `iso` is after `now`: 0 today,
 * -1 yesterday. The same count as `dayOffset` of lib/recents.ts, written again
 * on purpose: tasks and notes importing that module would change which screens
 * share it, and the bundler would split the first load another way (rule P11,
 * armadilhas.md). `productivity-notes.test.ts` keeps the two in step.
 */
export function localDayOffset(iso: string, now: Date, timeZone: string): number {
  // en-CA writes the date as YYYY-MM-DD.
  const day = (instant: Date) => Date.parse(`${new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant)}T00:00:00Z`) / 86_400_000;
  return day(new Date(iso)) - day(now);
}
const dayOffset = localDayOffset;

/** The hour of an instant in the owner's zone ("08:12"). */
export function noteClock(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/**
 * When a note was last saved, as its row shows it: the hour today, "ontem"
 * (the word comes from the catalog), the weekday for the rest of the last
 * seven days and the date before that. Always in the owner's zone.
 */
export function noteWhen(iso: string, now: Date, locale: string, timeZone: string, yesterday: string): string {
  if (Number.isNaN(Date.parse(iso))) return "";
  const days = -dayOffset(iso, now, timeZone);
  if (days <= 0) return noteClock(iso, locale, timeZone);
  if (days === 1) return yesterday;
  if (days < 7) return new Intl.DateTimeFormat(locale, { timeZone, weekday: "short" }).format(new Date(iso)).replace(/\.$/, "");
  const year = (date: Date) => new Intl.DateTimeFormat("en", { timeZone, year: "numeric" }).format(date);
  // The date in numbers ("02/11"), with the year when it is not this one.
  return new Intl.DateTimeFormat(locale, { timeZone, day: "2-digit", month: "2-digit", ...(year(new Date(iso)) === year(now) ? {} : { year: "numeric" }) }).format(new Date(iso));
}

/**
 * What was dictated goes to the end of the note, as a paragraph of its own
 * (criterion of PR S07): never in the middle of what is written, wherever the
 * cursor is. The text never grows past what a note holds.
 */
export function appendDictation(content: string, said: string): string {
  const base = content.trimEnd();
  return (base ? `${base}\n\n${said.trim()}` : said.trim()).slice(0, NOTE_CONTENT_MAX);
}

/** The note as a Markdown file: a name the file systems accept and the title as the first heading. */
export function markdownFile(title: string, content: string): { name: string; text: string } {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return { name: `${slug || "nota"}.md`, text: `# ${title.replace(/\s+/g, " ").trim()}\n\n${content.trimEnd()}\n` };
}
