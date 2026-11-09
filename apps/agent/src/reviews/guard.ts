import { REVIEW_LIMITS, type ReviewGuardCode } from "@zuri/shared";
import { CONTACT, contactsIn, copied, hasHidden, MARKUP } from "../specialists/checker.ts";
import { fold, HEALTH_WORDS, words } from "./triage.ts";

/**
 * The fixed checker of a reply (step 19c), without AI: whatever wrote it (the
 * agent, a template, the owner), a reply that fails any item never goes out.
 * Each failure is a code, kept in the audit; never the text.
 */

/** Words a public reply never carries (pt-BR and en, folded): promises and prices, health, legal matters, the machine. */
const BANNED = [
  "garantia",
  "garantimos",
  "garanto",
  "desconto",
  "descontos",
  "cupom",
  "cupons",
  "gratis",
  "reembolso",
  "devolucao",
  "indenizacao",
  "prometo",
  "prometemos",
  "processo",
  "advogado",
  "procon",
  "prompt",
  "instrucao",
  "instrucoes",
  "sistema",
  "inteligencia artificial",
  "ia",
  "modelo",
  "zuri",
  "guarantee",
  "discount",
  "coupon",
  "free",
  "refund",
  "compensation",
  "promise",
  "lawsuit",
  "lawyer",
  "instruction",
  "instructions",
  "system",
  "artificial intelligence",
  "ai",
  "model",
  ...HEALTH_WORDS,
];

const PT = new Set(["obrigado", "obrigada", "voce", "nos", "sua", "seu", "pela", "pelo", "muito", "que", "para", "com", "equipe", "ficamos", "felizes", "agradecemos", "volte", "sempre", "nao", "uma", "esperamos"]);
const EN = new Set(["thank", "thanks", "you", "your", "we", "for", "the", "and", "with", "team", "our", "very", "glad", "happy", "hope", "again", "soon", "visit", "not"]);

/** The reply's language by its common words; null when it can't tell. */
export function languageOf(text: string): "pt-BR" | "en" | null {
  let pt = 0;
  let en = 0;
  for (const word of words(text)) {
    if (PT.has(word)) pt++;
    if (EN.has(word)) en++;
  }
  if (pt === en) return null;
  return pt > en ? "pt-BR" : "en";
}

const EMOJI = /\p{Extended_Pictographic}/gu;

export interface GuardContext {
  /** The reviewer's first name ("" when anonymous): the only person a reply may name. */
  firstName: string;
  signature: string;
  /** The owner's own banned words. */
  banned: readonly string[];
  /** The review's text: five words in a row copied from it fail. */
  comment: string;
  /** The review's language, when known; a reply in another one fails. */
  language: "pt-BR" | "en" | null;
  /** Words the owner wrote (signature, templates) a name may come from. */
  ownWords?: readonly string[];
}

/** Ends with the signature, ignoring case, accents and the final punctuation. */
export function signed(text: string, signature: string): boolean {
  const end = words(text).join(" ");
  const sign = words(signature).join(" ");
  return sign !== "" && (end === sign || end.endsWith(` ${sign}`));
}

/** The signature at the end of a reply, on its own line, unless it already ends with it. */
export function withSignature(text: string, signature: string): string {
  const trimmed = text.trim();
  return signed(trimmed, signature) ? trimmed : `${trimmed}\n\n${signature.trim()}`;
}

/** Capitalized words past a sentence's start: names, brands, places. */
function namesIn(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/[.!?\n]+/u)) {
    const tokens = sentence.trim().split(/\s+/u).filter(Boolean);
    for (const [index, token] of tokens.entries()) {
      const word = token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if (index > 0 && /^\p{Lu}/u.test(word)) out.push(fold(word));
    }
  }
  return out;
}

/** "golpe ponto com", "exemplo ponto com ponto br": a domain written out in words. */
const SPELLED_DOMAIN = /\bponto\s+(?:com|br|net|org|io|me|app|pt|co)\b|\bdot\s+(?:com|net|org|io)\b/iu;

/** What fails in a reply; empty when it may go out. */
export function guard(text: string, ctx: GuardContext): ReviewGuardCode[] {
  const codes = new Set<ReviewGuardCode>();
  const chars = [...text.trim()].length;
  // 600 characters are at most 2,400 bytes: Google's 4,096-byte cap never comes into play.
  if (chars < REVIEW_LIMITS.replyMin || chars > REVIEW_LIMITS.replyMax) codes.add("size");
  if (hasHidden(text)) codes.add("hidden");
  const language = languageOf(text);
  if (ctx.language && language && language !== ctx.language) codes.add("language");
  // Wide and styled look-alikes made plain first: "exemplo．com", "＠perfil" and "①" are a link, a handle and a digit.
  const plain = text.normalize("NFKC");
  // Letters of another alphabet are another language, and the way to dress one word up as another.
  if ([...plain].some((char) => /\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char))) codes.add("language");
  // Any ending is a domain ("golpe.pt", "golpe.club"), and so is one spelled out: the short list alone let them through (SEC-A6-05).
  if (CONTACT.test(plain) || contactsIn(text).size > 0 || SPELLED_DOMAIN.test(plain)) codes.add("contact");
  if (MARKUP.test(plain) || (text.match(EMOJI)?.length ?? 0) > 1) codes.add("markup");
  const allowed = new Set([...words(ctx.signature), ...(ctx.ownWords ?? []).flatMap((value) => words(value)), ...(ctx.firstName ? [fold(ctx.firstName)] : [])]);
  if (namesIn(text).some((name) => !allowed.has(name))) codes.add("name");
  if (copied(text, ctx.comment)) codes.add("copied");
  // A banned word the owner's own signature carries ("Equipe Sistema Exemplo") is theirs to use, in the signature only.
  const sign = words(ctx.signature).join(" ");
  let body = words(text).join(" ");
  if (sign && body.endsWith(sign)) body = body.slice(0, body.length - sign.length);
  const all = ` ${body} `;
  const banned = [...BANNED, ...ctx.banned.map((word) => words(word).join(" ")).filter(Boolean)];
  if (banned.some((word) => all.includes(` ${word} `))) codes.add("banned");
  if (!signed(text, ctx.signature)) codes.add("signature");
  return [...codes];
}
