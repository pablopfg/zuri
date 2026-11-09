/**
 * Zuri's AI agents and their call settings (docs/planos/guardrails-especialistas-ia.md).
 *
 * The chat is the only agent with tools; every other one is a specialist the
 * code calls with data in and a checked answer out. Each one has fixed
 * defaults here, so changing the chat model no longer changes how it answers
 * (each model has its own default temperature, from 0.15 to 0.6).
 *
 * Only `temperature`, `top_p` and the output cap reach Workers AI through the
 * SDK (workers-ai-provider passes nothing else): `seed`, `top_k` and
 * `repetition_penalty` are left out on purpose.
 */

export const AGENT_IDS = ["chat", "summary", "flow_ai", "review_draft", "review_check", "routine_check"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export interface AgentProfile {
  /** Default temperature: low for data work, 0 for the checkers. */
  temperature: number;
  /** null: the model's own default. */
  topP: number | null;
  /** Output cap in tokens; the chat's comes from the AI limits (aiMaxOutputTokens), so it has none here. */
  maxOutputTokens: number | null;
  /** The range the owner may pick for the output cap. */
  maxOutputRange: { min: number; max: number } | null;
  /**
   * Whether the owner may write this agent's style and task layer. The
   * checkers' prompts are all safety, so they only show theirs.
   */
  ownerPrompt: boolean;
}

/** The range every agent's temperature may take: inside what all four chat models accept (0–2 or 0–5). */
export const AGENT_TEMPERATURE = { min: 0, max: 1.5, step: 0.05 } as const;
/** `top_p`, when set. */
export const AGENT_TOP_P = { min: 0.1, max: 1, step: 0.05 } as const;
/** Longest owner layer of a prompt, in characters. */
export const AGENT_PROMPT_MAX = 2_000;

export const AGENT_PROFILES: Readonly<Record<AgentId, AgentProfile>> = {
  chat: { temperature: 0.4, topP: null, maxOutputTokens: null, maxOutputRange: null, ownerPrompt: true },
  summary: { temperature: 0.2, topP: null, maxOutputTokens: 300, maxOutputRange: { min: 100, max: 600 }, ownerPrompt: true },
  flow_ai: { temperature: 0.2, topP: null, maxOutputTokens: 512, maxOutputRange: { min: 64, max: 1_024 }, ownerPrompt: true },
  review_draft: { temperature: 0.2, topP: null, maxOutputTokens: 320, maxOutputRange: { min: 200, max: 600 }, ownerPrompt: true },
  review_check: { temperature: 0, topP: null, maxOutputTokens: 120, maxOutputRange: { min: 60, max: 300 }, ownerPrompt: false },
  routine_check: { temperature: 0, topP: null, maxOutputTokens: 120, maxOutputRange: { min: 60, max: 300 }, ownerPrompt: false },
};

/** What one call of an agent uses: the code's defaults, or the owner's saved version (PR 2). */
export interface AgentCallSettings {
  temperature: number;
  topP: number | null;
  /** null for the chat: its cap is aiMaxOutputTokens. */
  maxOutputTokens: number | null;
  /** The owner's style and task layer; null keeps the code's default layer. */
  prompt: string | null;
  /** The owner's version in use; 0 is the code's defaults. */
  version: number;
}

/** The code's defaults of an agent, as call settings. */
export function defaultAgentSettings(id: AgentId): AgentCallSettings {
  const profile = AGENT_PROFILES[id];
  return { temperature: profile.temperature, topP: profile.topP, maxOutputTokens: profile.maxOutputTokens, prompt: null, version: 0 };
}
