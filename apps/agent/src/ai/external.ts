import type { ModelMessage } from "./provider.ts";

/**
 * What a company outside the owner's account receives (step 21, plan D3 to
 * D5, docs/planos/troca-de-provedores-e-protecao-de-dados.md). MeteredAI
 * applies it to every try that goes to an external provider, so a switch
 * from Workers AI to a paid fallback sends the external profile, and a switch
 * the other way sends the whole context.
 *
 * - D3: a memory marked "never send out" reaches the prompt as a `<data … local="1">`
 *   line; its text is replaced. Tools leave marked notes and memories out
 *   themselves (ToolContext.exposure).
 * - D4: a shorter history (the last messages only).
 * - D5: e-mails, phones, CPFs, cards, IBANs and API keys become markers such as
 *   `[EMAIL_1]`; the table lives only in this object, for one try. The answer
 *   shown to the owner and the tools' arguments get the values back; a marker
 *   this try did not hand out is left as it is.
 */

/** Messages of the history an external model gets (D4): enough to follow the talk, not the whole of it. */
export const EXTERNAL_HISTORY_MESSAGES = 8;

/** Characters of a note an external model reads (D4): the start, not the whole text. */
export const EXTERNAL_NOTE_CHARS = 600;

/** What a marked item's text becomes on its way out (D3). */
export const LOCAL_ONLY_TEXT = "(kept on the owner's account: not shared with this model)";

/** A `<data>` line of a marked item, as dataLine writes it (attributes quoted, no markup inside). */
const LOCAL_LINE = /(<data(?: [a-z_]+="[^"<>]*")* local="1"(?: [a-z_]+="[^"<>]*")*>)[^<>]*(<\/data>)/g;

const KINDS = ["KEY", "EMAIL", "IBAN", "CARD", "CPF", "PHONE"] as const;
type Kind = (typeof KINDS)[number];

/**
 * The patterns, in the order they are tried: a longer, more specific one first,
 * so a key is never read as a phone. Each one stops at a digit or letter on
 * either side, so a part of a longer number (a timestamp, an id) is left alone.
 * A random Pix key looks like any other id (a UUID) and is not hidden; Pix keys
 * that are an e-mail, a phone or a CPF are.
 */
const PATTERNS: Readonly<Record<Kind, RegExp>> = {
  KEY: /(?<![\w-])(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})(?![\w-])/g,
  EMAIL: /(?<![\w.+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![\w-])/g,
  IBAN: /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])/g,
  CARD: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g,
  CPF: /(?<![\d.-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d.-])/g,
  PHONE: /(?<![\d+])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,3}\)|\d{2,3})[ .-]?9?\d{4}[ .-]?\d{4}(?!\d)/g,
};

/** A card number passes the Luhn check; any other run of digits is not a card. */
export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

/** The IBAN check (ISO 13616, mod 97): a run of letters and digits that only looks like one stays. */
function ibanValid(value: string): boolean {
  const compact = value.replace(/ /g, "");
  if (compact.length < 15 || compact.length > 34) return false;
  const moved = `${compact.slice(4)}${compact.slice(0, 4)}`;
  let rest = 0;
  for (const char of moved) {
    const code = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of code) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

/** The CPF's two check digits; repeated digits (111.111.111-11) are no CPF. */
function cpfValid(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(digits[i]) * (size + 1 - i);
    const check = ((sum * 10) % 11) % 10;
    if (check !== Number(digits[size])) return false;
  }
  return true;
}

const ACCEPT: Partial<Record<Kind, (match: string) => boolean>> = {
  CARD: (match) => luhn(match.replace(/[ -]/g, "")),
  CPF: cpfValid,
  IBAN: ibanValid,
};

/** A marker this module hands out, such as `[EMAIL_12]`. */
const MARKER = /\[(?:KEY|EMAIL|IBAN|CARD|CPF|PHONE)_\d{1,4}\]/g;
/** The longest marker: a text that ends in an open one of up to this many characters waits for the rest. */
const MARKER_MAX = "[EMAIL_9999]".length;

export class Pseudonymizer {
  readonly #byValue = new Map<string, string>();
  readonly #byMarker = new Map<string, string>();
  readonly #counts = new Map<Kind, number>();

  /** How many values this try replaced. */
  get size(): number {
    return this.#byMarker.size;
  }

  /** The text with every value of the list replaced by its marker (the same value, the same marker). */
  hide(text: string): string {
    let out = text;
    for (const kind of KINDS) {
      out = out.replace(PATTERNS[kind], (match) => {
        if (ACCEPT[kind] && !ACCEPT[kind](match)) return match;
        return this.markerFor(kind, match);
      });
    }
    return out;
  }

  /** The values back in the place of the markers this try handed out; any other marker stays as written. */
  reveal(text: string): string {
    if (this.#byMarker.size === 0) return text;
    return text.replace(MARKER, (marker) => this.#byMarker.get(marker) ?? marker);
  }

  /** `reveal` on every string of a value (a tool's arguments, a tool's result), keys left alone. */
  revealDeep<T>(value: T): T {
    return mapStrings(value, (text) => this.reveal(text)) as T;
  }

  hideDeep<T>(value: T): T {
    return mapStrings(value, (text) => this.hide(text)) as T;
  }

  /** A reader for a streamed answer: a marker split between two pieces is put back whole. */
  revealStream(): { push(delta: string): string; flush(): string } {
    let pending = "";
    return {
      push: (delta) => {
        const text = pending + delta;
        // Hold back a tail that may be the start of a marker ("[EMA"), so it is revealed once complete.
        const open = text.lastIndexOf("[");
        if (open !== -1 && text.length - open < MARKER_MAX && !text.slice(open).includes("]") && /^\[[A-Z]*_?\d*$/.test(text.slice(open))) {
          pending = text.slice(open);
          return this.reveal(text.slice(0, open));
        }
        pending = "";
        return this.reveal(text);
      },
      flush: () => {
        const rest = this.reveal(pending);
        pending = "";
        return rest;
      },
    };
  }

  private markerFor(kind: Kind, value: string): string {
    const known = this.#byValue.get(value);
    if (known) return known;
    const n = (this.#counts.get(kind) ?? 0) + 1;
    this.#counts.set(kind, n);
    const marker = `[${kind}_${n}]`;
    this.#byValue.set(value, marker);
    this.#byMarker.set(marker, value);
    return marker;
  }
}

function mapStrings(value: unknown, fn: (text: string) => string, depth = 0): unknown {
  if (typeof value === "string") return fn(value);
  if (depth > 20 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = mapStrings(item, fn, depth + 1);
  return out;
}

/** D3: a marked item's text never leaves; the line stays, so the model knows something is there. */
export function withoutLocalOnly(text: string): string {
  return text.replace(LOCAL_LINE, (_line, open: string, close: string) => `${open}${LOCAL_ONLY_TEXT}${close}`);
}

/** D4: the last messages of the history, starting at one of the owner's (the companies want a user message first). */
export function shorterHistory(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= EXTERNAL_HISTORY_MESSAGES) return messages;
  const recent = messages.slice(-EXTERNAL_HISTORY_MESSAGES);
  const first = recent.findIndex((message) => message.role === "user");
  return first <= 0 ? recent : recent.slice(first);
}

/** The prompt of one try to an external provider: D3, D4 and D5 on the system prompt and the messages. */
export function externalPrompt(
  req: { system: string; messages: ModelMessage[] },
  pseudonyms: Pseudonymizer,
): { system: string; messages: ModelMessage[] } {
  return {
    system: pseudonyms.hide(withoutLocalOnly(req.system)),
    messages: shorterHistory(req.messages).map((message) => ({ ...message, content: pseudonyms.hide(withoutLocalOnly(message.content)) })),
  };
}
