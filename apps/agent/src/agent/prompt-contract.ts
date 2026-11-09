import { AppError } from "../http/errors.ts";
import { CLOSING, OPENING } from "./data.ts";

/**
 * The prompt contract (plan D1, docs/planos/troca-de-provedores-e-protecao-de-dados.md).
 *
 * Every piece of a system prompt is a section that says where it comes from
 * (`origin`, a closed list) and what kind of text it is (`class`):
 *
 * - `instruction`: text written in this code (rules, the clock, the agent's
 *   name from the deploy). The only class the model may obey.
 * - `personal`: the owner's stored content (the owner's name, memories, the
 *   running summary, a routine's name). Always inside `<data>` lines (dataLine), never obeyed.
 * - `sensitive`: personal content a later profile keeps away from an external
 *   provider (plan D3/D4, step 21). Same rules as `personal`.
 * - `owner`: what the owner wrote as an instruction on the settings screen or
 *   in a flow step (an agent's style and task layer, an AI step's
 *   instruction). It is obeyed, but only after the fixed rules, which it can
 *   never relax: its angle brackets become look-alikes, so it can't forge a
 *   `<data>` line, and invisible characters are dropped
 *   (docs/planos/guardrails-especialistas-ia.md, section 8.1 of the study).
 *
 * `composePrompt` is the only way a system prompt is made: nothing gets in by
 * loose concatenation. It refuses a content section with markup outside its
 * `<data>` lines, so stored text can never pose as an instruction.
 *
 * The chat history goes as messages, not here: the owner's own words (origin
 * `history`) and the answers, with stored content in `<data>` (context.ts).
 * Tool results reach the model inside the provider, each one a
 * `<data source="tool">` block (tools/registry.ts).
 */

export const PROMPT_ORIGINS = [
  "agent_name",
  "fixed_instructions",
  "clock",
  "owner_name",
  "memories",
  "summary",
  "routine",
  "summary_task",
  "language_reminder",
  "specialist_rules",
  "owner_prompt",
  "owner_instruction",
] as const;
export type PromptOrigin = (typeof PROMPT_ORIGINS)[number];

export const PROMPT_CLASSES = ["instruction", "owner", "personal", "sensitive"] as const;
export type PromptClass = (typeof PROMPT_CLASSES)[number];

/** The class every origin has: a section can't claim another. */
export const ORIGIN_CLASS: Readonly<Record<PromptOrigin, PromptClass>> = {
  agent_name: "instruction",
  fixed_instructions: "instruction",
  clock: "instruction",
  language_reminder: "instruction",
  summary_task: "instruction",
  specialist_rules: "instruction",
  owner_prompt: "owner",
  owner_instruction: "owner",
  owner_name: "personal",
  memories: "personal",
  summary: "personal",
  routine: "personal",
};

/**
 * What never enters a prompt, from any origin (closed list, plan D1). No
 * origin above reads any of these, no tool returns them (tools/), and the
 * canary test (test/prompt-canary.test.ts) plants each one and checks every
 * prompt and tool result. The deploy's secrets also go through MeteredAI's
 * last net, which replaces any that slips through.
 */
export const NEVER_IN_PROMPT = [
  "owner_email",
  "password_and_hashes",
  "secrets_and_tokens",
  "telegram_ids",
  "access_ip_city_network",
  "mfa_and_recovery_codes",
  "cookies_and_session_ids",
  "mcp_credentials",
] as const;
export type NeverInPrompt = (typeof NEVER_IN_PROMPT)[number];

export interface PromptSection {
  origin: PromptOrigin;
  text: string;
}

/**
 * One `<data …>…</data>` line as dataLine writes it (no markup inside,
 * attributes quoted), or the bare `<data>` the rules use to name those lines.
 */
export const DATA_LINE = /<data(?: [a-z_]+="[^"<>]*")+>[^<>]*<\/data>|<data>/g;

/**
 * The system prompt from its sections, in order, empty ones left out. A
 * content section (not `instruction`) whose text has `<` or `>` outside its
 * `<data>` lines is a bug that could let stored text pose as markup: it fails
 * the turn instead of reaching the model.
 */
export function composePrompt(sections: readonly PromptSection[]): string {
  const parts: string[] = [];
  for (const section of sections) {
    const kind = ORIGIN_CLASS[section.origin];
    const text = (kind === "owner" ? ownerText(section.text) : section.text).trim();
    if (!text) continue;
    if (kind !== "instruction" && kind !== "owner" && /[<>]/.test(text.replace(DATA_LINE, ""))) {
      throw new AppError("INTERNAL_ERROR");
    }
    parts.push(text);
  }
  return parts.join("\n\n");
}

/** Controls but the line break and the tab, invisible format characters (the emoji joiner stays), blank letters and the line separators. */
const OWNER_HIDDEN = /(?!\u200d)[\p{Cf}\u2028\u2029\u115f\u1160\u3164\uffa0\u2800]|(?![\n\t])\p{Cc}|(?![\ufe0e\ufe0f])\p{Variation_Selector}/gu;

/**
 * The owner's instruction as it enters a prompt: obeyed, but unable to pose as
 * markup or to hide text. Line breaks stay, since they are the owner's layout.
 */
export function ownerText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(OWNER_HIDDEN, "")
    .replace(/[^\n]/gu, (char) => (OPENING.has(char) ? "‹" : CLOSING.has(char) ? "›" : char));
}
