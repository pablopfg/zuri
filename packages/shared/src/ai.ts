// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

// The interface parses the usage report with this one: Zod Mini keeps the classic API out of its bundle.
import { z as mini } from "zod/mini";
import {
  AI_LIMIT_RANGES,
  AI_MODEL_IDS,
  type AiModel,
  isPaidModel,
  PAID_MODEL_IDS,
  PAID_PROVIDER_IDS,
  type PaidModel,
  type PaidProviderId,
  paidProviderOf,
  CHAT_MODEL_IDS,
  type ChatModel,
  DEFAULT_CHAT_MODEL,
  DEFAULT_FALLBACK_MODEL,
  FALLBACK_MODEL_IDS,
  type FallbackModel,
  FREE_NEURONS_PER_DAY,
  NO_FALLBACK_MODEL,
} from "./ai-limits.ts";

export {
  AI_LIMIT_RANGES,
  AI_MODEL_IDS,
  type AiModel,
  isPaidModel,
  PAID_MODEL_IDS,
  PAID_PROVIDER_IDS,
  type PaidModel,
  type PaidProviderId,
  paidProviderOf,
  CHAT_MODEL_IDS,
  type ChatModel,
  DEFAULT_CHAT_MODEL,
  DEFAULT_FALLBACK_MODEL,
  FALLBACK_MODEL_IDS,
  type FallbackModel,
  FREE_NEURONS_PER_DAY,
  NO_FALLBACK_MODEL,
};

/**
 * Workers AI prices, copied from the official pricing page on the date below
 * (docs/especificacao.md, "Modelos do Workers AI"). Estimates use these rates
 * when a call is recorded, never when a report is read, so a later price change
 * does not rewrite the past. Only models with a published rate are listed: the
 * daily cap can only be checked for a call whose cost can be estimated.
 */
export const WORKERS_AI_PRICING = {
  asOf: "2026-10-31",
  sourceUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
  /** What 1,000 Neurons cost on Workers Paid; on the Free plan they are free up to the daily allocation. */
  usdPer1000Neurons: 0.011,
  /** The Free plan's daily allocation, reset at 00:00 UTC. */
  freeNeuronsPerDay: FREE_NEURONS_PER_DAY,
} as const;

/**
 * Chat models the owner may pick, all with tool calling and a published rate in
 * Neurons per million input and output tokens. `context` is the model's whole
 * window (prompt + answer) in tokens, from each model's page on the same date. The default is the Talorys
 * default on 30/10/2026. Paid providers are out (decision N7).
 */
export const CHAT_MODELS = {
  "@cf/zai-org/glm-4.7-flash": { label: "GLM 4.7 Flash", input: 5_500, output: 36_400, context: 131_072 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { label: "Qwen3 30B A3B", input: 4_625, output: 30_475, context: 32_768 },
  "@cf/meta/llama-4-scout-17b-16e-instruct": { label: "Llama 4 Scout 17B", input: 24_545, output: 77_273, context: 131_000 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { label: "Llama 3.3 70B", input: 26_668, output: 204_805, context: 24_000 },
} as const satisfies Record<string, { label: string; input: number; output: number; context: number }>;

/**
 * Paid models (step 21, ⚠️), US$ per million tokens, copied from each
 * company's pricing page on `PAID_PRICING.asOf`. The cost is written when a
 * call is recorded, so a later price change does not rewrite the past. Haiku
 * 5.5's price is the one for prompts up to 100,000 tokens: Zuri's prompt cap
 * (aiMaxContextTokens) stays far below it.
 */
export const PAID_MODELS = {
  "anthropic/claude-haiku-5-5": { label: "Claude Haiku 5.5", input: 0.1, output: 0.5, context: 1_000_000 },
  "anthropic/claude-sonnet-5-5": { label: "Claude Sonnet 5.5", input: 2, output: 10, context: 1_000_000 },
  "openai/gpt-6-luna": { label: "GPT-6 Luna", input: 0.1, output: 0.5, context: 272_000 },
  "openai/gpt-6.1-terra": { label: "GPT-6.1 Terra", input: 1, output: 5, context: 272_000 },
} as const satisfies Record<PaidModel, { label: string; input: number; output: number; context: number }>;

export const PAID_PRICING = {
  asOf: "2026-11-04",
  sources: {
    anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
    openai: "https://developers.openai.com/api/docs/pricing",
  },
} as const satisfies { asOf: string; sources: Record<PaidProviderId, string> };

/**
 * What each company does with what it receives (plan D6), checked on `asOf`.
 * A company only enters the list if it does not train on API data. Zuri asks
 * nothing to be kept on their side (no files, no saved conversations; OpenAI
 * gets `store: false`).
 */
export const PAID_PROVIDERS = {
  anthropic: {
    label: "Anthropic",
    secret: "ANTHROPIC_API_KEY",
    trainsOnData: false,
    retentionDays: 30,
    termsUrl: "https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data",
  },
  openai: {
    label: "OpenAI",
    secret: "OPENAI_API_KEY",
    trainsOnData: false,
    retentionDays: 30,
    termsUrl: "https://developers.openai.com/api/docs/guides/your-data",
  },
} as const satisfies Record<PaidProviderId, { label: string; secret: string; trainsOnData: false; retentionDays: number; termsUrl: string }>;

export const PAID_TERMS_AS_OF = "2026-11-04";

/** US$ of `inputTokens` in and `outputTokens` out on a paid model. */
export function paidUsd(model: PaidModel, inputTokens: number, outputTokens: number): number {
  const rate = PAID_MODELS[model];
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/** A typical answer for the cost hints: 6,000 tokens of context in, 400 out. */
export const TYPICAL_TURN_TOKENS = { input: 6_000, output: 400 } as const;


/** Speech to text (step 9): Neurons per minute of audio. */
export const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const TRANSCRIPTION_NEURONS_PER_MINUTE = 46.63;

/** Embeddings (step 17): Neurons per million input tokens. */
export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_NEURONS_PER_MILLION = 1_075;

/** Seconds of audio transcribed per day, app and bot together (not configurable). */
export const AUDIO_SECONDS_PER_DAY = 3_600;

/** Days of usage history kept; older rows are removed when a new day starts (rule P13). */
export const USAGE_RETENTION_DAYS = 90;

/** How a paid company answers: fine, out of credit, or its key refused, until the owner says to try again. */
export const PROVIDER_STATES = ["ok", "no_credit", "bad_key"] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];

export const USAGE_KINDS = ["chat", "transcription", "embedding"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

const count = /* @__PURE__ */ mini.int().check(mini.nonnegative());
const amount = /* @__PURE__ */ mini.number().check(mini.nonnegative());
const day = /* @__PURE__ */ mini.string().check(mini.regex(/^\d{4}-\d{2}-\d{2}$/));

/** One model's line of the report: what the calls used, reported by Cloudflare or estimated here. */
export const modelUsageSchema = /* @__PURE__ */ mini.strictObject({
  model: mini.string().check(mini.minLength(1)),
  kind: mini.enum(USAGE_KINDS),
  billable: mini.boolean(),
  calls: count,
  inputTokens: count,
  outputTokens: count,
  /** Tokens counted by ~4 characters each, when Cloudflare did not report them. */
  estimatedTokens: count,
  audioSeconds: count,
  neurons: amount,
  costUsd: amount,
});

export type ModelUsage = mini.infer<typeof modelUsageSchema>;

/** GET /api/usage: today's use against the limits, and the last 7 days. */
export const usageReportSchema = /* @__PURE__ */ mini.strictObject({
  /** The UTC day the counters belong to: Cloudflare's allocation resets at 00:00 UTC. */
  day,
  resetsAt: mini.iso.datetime(),
  /** Who answers with the main model: Workers AI, a paid company (step 21) or the simulator. */
  provider: mini.enum(["workers-ai", "anthropic", "openai", "mock"]),
  model: mini.enum(AI_MODEL_IDS),
  today: mini.strictObject({
    requests: count,
    errors: count,
    aborted: count,
    neurons: amount,
    costUsd: amount,
    /** What the paid models cost today, in US$ (step 21). */
    paidUsd: amount,
    /** Calls the fallback model took over today. */
    fallbacks: count,
    audioSeconds: count,
    models: mini.array(modelUsageSchema),
  }),
  limits: mini.strictObject({
    requestsPerDay: count,
    neuronsPerDay: count,
    audioSecondsPerDay: count,
    maxOutputTokens: count,
    /** The paid models' ceiling for the day in US cents; 0 is no ceiling. */
    usdCentsPerDay: count,
  }),
  lastDays: mini.array(mini.strictObject({ day, requests: count, neurons: amount })),
  /** The paid companies: whether the key is set, and whether they answer (step 21). */
  providers: mini.array(
    mini.strictObject({
      id: mini.enum(PAID_PROVIDER_IDS),
      configured: mini.boolean(),
      state: mini.enum(PROVIDER_STATES),
    }),
  ),
  pricing: mini.strictObject({
    asOf: day,
    sourceUrl: mini.string(),
    usdPer1000Neurons: amount,
    freeNeuronsPerDay: count,
  }),
});

export type UsageReport = mini.infer<typeof usageReportSchema>;

/** The periods the usage panel shows, in days, today included. */
export const USAGE_HISTORY_DAYS = [7, 30, 90] as const;
export type UsageHistoryDays = (typeof USAGE_HISTORY_DAYS)[number];

/** GET /api/usage/history?days=…: one line per day that had any use, and the period by model. Numbers only. */
export const usageHistorySchema = /* @__PURE__ */ mini.strictObject({
  from: day,
  to: day,
  days: mini.array(
    mini.strictObject({
      day,
      requests: count,
      errors: count,
      aborted: count,
      fallbacks: count,
      neurons: amount,
      paidUsd: amount,
      audioSeconds: count,
    }),
  ),
  models: mini.array(
    mini.strictObject({
      model: mini.string().check(mini.minLength(1)),
      kind: mini.enum(USAGE_KINDS),
      calls: count,
      inputTokens: count,
      outputTokens: count,
      neurons: amount,
      /** Real US$ for a paid model; Workers AI's list price otherwise (free within the allocation). */
      costUsd: amount,
      paid: mini.boolean(),
    }),
  ),
  /** Paid US$ per day and model, for the stacked bars. */
  paidByDay: mini.array(mini.strictObject({ day, model: mini.string().check(mini.minLength(1)), usd: amount })),
});

export type UsageHistory = mini.infer<typeof usageHistorySchema>;

/** Neurons of `tokens` input and `outputTokens` output on a chat model of the list. */
export function chatNeurons(model: ChatModel, inputTokens: number, outputTokens: number): number {
  const rate = CHAT_MODELS[model];
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/** The list price of `neurons` on Workers Paid; on the Free plan they cost nothing within the allocation. */
export function neuronsToUsd(neurons: number): number {
  return (neurons * WORKERS_AI_PRICING.usdPer1000Neurons) / 1_000;
}

/** The name a person reads for any model Zuri uses; an unknown id is shown as it is. */
export function modelLabel(model: string): string {
  if (isChatModel(model)) return CHAT_MODELS[model].label;
  if (isPaidModel(model)) return PAID_MODELS[model].label;
  if (model === TRANSCRIPTION_MODEL) return "Whisper Large v3 Turbo";
  if (model === EMBEDDING_MODEL) return "BGE-M3";
  return model;
}

/** True for a chat model of the list (a stored value from an older version may not be). */
export function isChatModel(value: unknown): value is ChatModel {
  return typeof value === "string" && Object.hasOwn(CHAT_MODELS, value);
}
