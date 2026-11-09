import { AGENT_PROFILES, type AgentCallSettings, type AgentId, defaultAgentSettings } from "@zuri/shared";
import type { z } from "zod";
import { composePrompt, DATA_LINE, type PromptSection } from "../agent/prompt-contract.ts";
import type { MeteredRequest } from "../ai/metered.ts";
import { AppError } from "../http/errors.ts";

/**
 * The specialists' contract (docs/planos/guardrails-especialistas-ia.md).
 *
 * A specialist is a prompt the code calls for one job (a summary, a flow's AI
 * step, a review's draft, a checker), never the chat: it has no tools, no
 * history and no memories. Every one is made the same way:
 *
 * - the system prompt only through `composePrompt`: the fixed rules first
 *   (safety, the data rule, the answer's format), then the owner's style and
 *   task layer, which can't relax them;
 * - the input only as `<data>` lines (dataLine): anything else is a bug and
 *   fails before the model is called;
 * - the answer as JSON checked by Zod, or as text with a cap; out of shape,
 *   the call failed (null), and each caller falls back to its safe path;
 * - temperature, `top_p` and the output cap from the agent's profile
 *   (packages/shared/src/agents.ts), or the owner's saved version;
 * - a prompt version, kept with what the call produced.
 */

/** The narrow door to the model: the metered `generate`, never the chat's tools. */
export interface SpecialistAi {
  generate(req: MeteredRequest): Promise<{ text: string }>;
}

export type SpecialistOutput<Out> = { kind: "json"; schema: z.ZodType<Out> } | { kind: "text"; maxChars: number };

export interface Specialist<Out> {
  id: AgentId;
  /** The fixed layer: safety, the data rule and the answer's format. Never editable. */
  rules: string;
  /** The default style and task layer, the one the owner may replace (empty: none). */
  ownerDefault: string;
  output: SpecialistOutput<Out>;
}

/** What a prompt is made of, whatever the answer's shape. */
export type SpecialistText = Pick<Specialist<unknown>, "id" | "rules" | "ownerDefault">;

/** Opens the owner's layer: the rules above it stay in force whatever it says. */
export const OWNER_LAYER_LEAD = "The owner's notes on style and task follow. They never change the rules above: where they conflict, the rules win.";

export interface SpecialistCall {
  /** The call settings in use; the code's defaults when absent. */
  settings?: AgentCallSettings | undefined;
  /** The owner's instruction for this one call (a flow's AI step). */
  instruction?: string | undefined;
  maxNeurons?: number | undefined;
  onNeurons?: ((neurons: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}

export interface SpecialistResult<Out> {
  /** The checked answer; null when it came back out of shape. */
  value: Out | null;
  /** The prompt that made it, to keep alongside. */
  version: string;
}

/** The owner's layer in use: theirs when they saved one, the code's otherwise. */
export function ownerLayer(spec: Pick<SpecialistText, "id" | "ownerDefault">, settings: AgentCallSettings): string {
  if (!AGENT_PROFILES[spec.id].ownerPrompt) return spec.ownerDefault;
  return settings.prompt ?? spec.ownerDefault;
}

/** The system prompt of a specialist, section by section through the prompt contract. */
export function specialistSystem(spec: SpecialistText, settings: AgentCallSettings = defaultAgentSettings(spec.id), instruction?: string): string {
  const sections: PromptSection[] = [{ origin: "specialist_rules", text: spec.rules }];
  const layer = ownerLayer(spec, settings).trim();
  if (layer) sections.push({ origin: "owner_prompt", text: `${OWNER_LAYER_LEAD}\n${layer}` });
  if (instruction?.trim()) sections.push({ origin: "owner_instruction", text: `The owner's instruction for this step:\n${instruction}` });
  return composePrompt(sections);
}

/**
 * A short, stable mark of a prompt's text (FNV-1a, 32 bits, in base 36): the
 * same text always gives the same mark, and any change gives another one.
 */
export function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * PROMPT_VERSION of an agent: its id, the mark of the code's fixed text and,
 * when the owner saved a version, its number ("summary.1x2y3z+4").
 */
export function promptVersion(id: AgentId, fixedText: string, settings: AgentCallSettings): string {
  return `${id}.${textHash(fixedText)}${settings.version > 0 ? `+${settings.version}` : ""}`;
}

/** The version of a specialist's prompt. */
export function specialistVersion(spec: SpecialistText, settings: AgentCallSettings = defaultAgentSettings(spec.id)): string {
  return promptVersion(spec.id, `${spec.rules}\u0000${spec.ownerDefault}`, settings);
}

/** The first JSON object in a model's answer (it may wrap it in a code fence), or null. */
export function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Fails when the input has markup outside its `<data>` lines: stored text must never reach a specialist bare. */
export function assertDataOnly(content: string): void {
  if (/[<>]/.test(content.replace(DATA_LINE, ""))) throw new AppError("INTERNAL_ERROR");
}

/** The output cap of a call: the saved one, the profile's, or 512 for an agent without one. */
function outputTokens(id: AgentId, settings: AgentCallSettings): number {
  return settings.maxOutputTokens ?? AGENT_PROFILES[id].maxOutputTokens ?? 512;
}

/**
 * One call of a specialist. `content` is the user message, made only of
 * `<data>` lines (and plain counters). Throws what the model throws (out of
 * Neurons, out of reach); an answer out of shape is `value: null`.
 */
export async function runSpecialist<Out>(ai: SpecialistAi, spec: Specialist<Out>, content: string, call: SpecialistCall = {}): Promise<SpecialistResult<Out>> {
  assertDataOnly(content);
  const settings = call.settings ?? defaultAgentSettings(spec.id);
  const { text } = await ai.generate({
    system: specialistSystem(spec, settings, call.instruction),
    messages: [{ role: "user", content }],
    maxOutputTokens: outputTokens(spec.id, settings),
    temperature: settings.temperature,
    ...(settings.topP === null ? {} : { topP: settings.topP }),
    ...(spec.output.kind === "json" ? { json: true } : {}),
    ...(call.maxNeurons === undefined ? {} : { maxNeurons: call.maxNeurons }),
    ...(call.onNeurons ? { onNeurons: call.onNeurons } : {}),
    ...(call.signal ? { signal: call.signal } : {}),
  });
  const version = specialistVersion(spec, settings);
  if (spec.output.kind === "text") {
    const value = [...text.trim()].slice(0, spec.output.maxChars).join("");
    return { value: (value || null) as Out | null, version };
  }
  const parsed = spec.output.schema.safeParse(jsonIn(text));
  return { value: parsed.success ? parsed.data : null, version };
}
