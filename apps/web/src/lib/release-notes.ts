/**
 * "Novidades desta versão" in Settings > Sobre a Zuri (PR S16). The build reads
 * CHANGELOG.md once (vite.config.ts) and hands the screen only the newest
 * version's lines, as plain text: no Markdown reaches the page, so nothing in the
 * changelog can become markup. Pure, so the build and the tests share it.
 */
export type ReleaseNotes = { version: string; items: string[] };

/** Lines the card shows; "Ver todas as versões" has the rest. */
export const RELEASE_NOTES_MAX = 6;
/** A longer first sentence is cut at a word, with an ellipsis. */
const MAX_CHARS = 160;

/**
 * Links, code, bold and italics as their text only. Only real tags go (outside code spans):
 * `/eventos/<chave>` and "5 < 10" keep their text.
 */
export function plainText(markdown: string): string {
  return markdown
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith("`") && part.endsWith("`") && part.length > 1 ? part : part.replace(/<\/?[a-zA-Z][^<>]*>/g, "")))
    .join("")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=$|[\s.,;:)])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first sentence: up to the first ". " followed by a capital letter (so "0.x" or "p. ex." don't end it). */
export function firstSentence(text: string): string {
  const end = /[.!?](?=\s+[A-ZÀ-Ý])/.exec(text);
  const sentence = end ? text.slice(0, end.index + 1) : text;
  if (sentence.length <= MAX_CHARS) return sentence;
  const cut = sentence.slice(0, MAX_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[\s,;:.]+$/, "")}…`;
}

/** The newest numbered section of the changelog ("## [0.50.0] - 2026-11-12"), its top-level items only. */
export function releaseNotes(changelog: string, max = RELEASE_NOTES_MAX): ReleaseNotes | null {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => /^## \[\d+\.\d+\.\d+\]/.test(line));
  if (start < 0) return null;
  const version = /^## \[(\d+\.\d+\.\d+)\]/.exec(lines[start] ?? "")?.[1] ?? "";
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("- ")) continue;
    const text = firstSentence(plainText(line.slice(2)));
    // The same line twice says nothing new (and the list keys on the text).
    if (text && !items.includes(text)) items.push(text);
    if (items.length >= max) break;
  }
  return { version, items };
}
