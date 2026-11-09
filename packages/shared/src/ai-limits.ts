/**
 * The few AI values the settings need: kept apart from ai.ts (prices, the usage
 * report's schema) because the settings module is in the interface's first
 * bundle, and everything in a module it imports lands there too (rule P11).
 */

/** Chat models the owner may pick; ai.ts holds their rates and names. The first one is the default. */
export const CHAT_MODEL_IDS = [
  "@cf/zai-org/glm-4.7-flash",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
] as const;

export type ChatModel = (typeof CHAT_MODEL_IDS)[number];
export const DEFAULT_CHAT_MODEL: ChatModel = "@cf/zai-org/glm-4.7-flash";

/**
 * Paid models (step 21, ⚠️): each one only with its provider's key set as a
 * Worker secret, and never by default. ai.ts holds their dated prices.
 */
export const PAID_MODEL_IDS = ["anthropic/claude-haiku-5-5", "anthropic/claude-sonnet-5-5", "openai/gpt-6-luna", "openai/gpt-6.1-terra"] as const;
export type PaidModel = (typeof PAID_MODEL_IDS)[number];

/** Every model the owner may pick to chat: the free ones of Workers AI, then the paid ones. */
export const AI_MODEL_IDS = [...CHAT_MODEL_IDS, ...PAID_MODEL_IDS] as const;
export type AiModel = (typeof AI_MODEL_IDS)[number];

/** The companies behind the paid models. */
export const PAID_PROVIDER_IDS = ["anthropic", "openai"] as const;
export type PaidProviderId = (typeof PAID_PROVIDER_IDS)[number];

export function isPaidModel(value: unknown): value is PaidModel {
  return typeof value === "string" && (PAID_MODEL_IDS as readonly string[]).includes(value);
}

/** The company of a paid model, from its id (`anthropic/…`, `openai/…`). */
export function paidProviderOf(model: PaidModel): PaidProviderId {
  return model.startsWith("anthropic/") ? "anthropic" : "openai";
}

/** "No fallback model": the owner may turn the fallback off. */
export const NO_FALLBACK_MODEL = "none";
/** What the fallback setting holds: no model, or one of the list (paid ones too). */
export const FALLBACK_MODEL_IDS = [NO_FALLBACK_MODEL, ...AI_MODEL_IDS] as const;
export type FallbackModel = (typeof FALLBACK_MODEL_IDS)[number];
/**
 * The model that answers when the chosen one fails before answering (busy,
 * out of service). Free like every model of the list, inside the same daily
 * Neuron cap; the cheapest one, and not the default model, so the default pair
 * always has two different models (decision of 02/11/2026).
 */
export const DEFAULT_FALLBACK_MODEL: FallbackModel = "@cf/qwen/qwen3-30b-a3b-fp8";

/** Cloudflare's free Workers AI allocation per day, reset at 00:00 UTC. */
export const FREE_NEURONS_PER_DAY = 10_000;

/**
 * The AI limits the owner may change, with their defaults ("Constantes
 * padrão"). The Neuron cap is one for chat, voice and embeddings together, and
 * stays 1,000 under the free allocation (decision of 31/10/2026), so the account
 * never reaches Cloudflare's own refusal, let alone a bill.
 */
export const AI_LIMIT_RANGES = {
  aiRequestsPerDay: { min: 1, max: 2_000, default: 200 },
  aiNeuronsPerDay: { min: 1_000, max: 9_000, default: 9_000 },
  aiMaxOutputTokens: { min: 256, max: 4_096, default: 1_024 },
  /** Step 9: one chat turn's tool calls, model calls, and prompt tokens (system, memories and history). */
  aiMaxToolCalls: { min: 1, max: 20, default: 6 },
  aiMaxIterations: { min: 1, max: 10, default: 4 },
  aiMaxContextTokens: { min: 2_000, max: 32_000, default: 6_000 },
  /** Step 10: AI routine runs per day ("Execuções de IA agendadas"); 0 turns them off. Resets at 00:00 UTC. */
  aiScheduledRunsPerDay: { min: 0, max: 48, default: 6 },
  /**
   * Step 21: the day's ceiling for the paid models, in US cents. 0 means no
   * ceiling, the default (decision of 04/11/2026); any other value up to
   * US$ 10,000 a day is the owner's to pick.
   */
  aiUsdCentsPerDay: { min: 0, max: 1_000_000, default: 0 },
} as const;
