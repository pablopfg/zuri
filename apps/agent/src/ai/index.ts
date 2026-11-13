import { type ChosenFallback, type ChosenModel, isPaidModel, type Locale, NO_FALLBACK_MODEL, paidProviderOf } from "@zuri/shared";
import { AppError } from "../http/errors.ts";
import { type CircuitBreaker, ProviderChain } from "./chain.ts";
import { MockAIProvider } from "./mock.ts";
import { PaidProvider, type PaidKeys, paidKey } from "./paid.ts";
import type { AgentEvent, AIProvider } from "./provider.ts";
import { WorkersAIProvider } from "./workers-ai.ts";

export { CircuitBreaker, ProviderChain } from "./chain.ts";
export { type PaidKeys, paidKey } from "./paid.ts";

export type { AiLimits } from "./usage.ts";
export { MeteredAI } from "./metered.ts";
export { UsageMeter } from "./usage.ts";

/**
 * The provider of this deploy. Local development (a loopback http PUBLIC_URL)
 * always gets the mock, so `npm run dev` and the e2e tests never spend Neurons.
 * Anywhere else it is Workers AI; without the AI binding the AI is not configured.
 */
export function chooseProvider(options: {
  development: boolean;
  binding: Ai | undefined;
  model: ChosenModel;
  locale: () => Locale;
  keys?: PaidKeys;
}): AIProvider {
  if (options.development) {
    // A paid model in local development is the mock under its name: costs are simulated, nothing leaves.
    return isPaidModel(options.model) ? new MockAIProvider(options.locale, { model: options.model, external: true }) : new MockAIProvider(options.locale);
  }
  return realProvider(options.model, options.binding, options.keys ?? {});
}

/** A real provider, or NOT_CONFIGURED: Workers AI without the binding, a paid model without its company's key. */
function realProvider(model: ChosenModel, binding: Ai | undefined, keys: PaidKeys): AIProvider {
  if (isPaidModel(model)) {
    const key = paidKey(keys, paidProviderOf(model));
    if (!key) throw new AppError("NOT_CONFIGURED");
    return new PaidProvider(model, key);
  }
  if (!binding) throw new AppError("NOT_CONFIGURED");
  return new WorkersAIProvider(binding, model);
}

/**
 * The chosen model and the fallback the owner picked (Settings > AI), as one
 * chain with the object's breaker. In local development both are the mock: the
 * chosen one fails a message that starts with `fail `, so the switch can be
 * seen and tested without a real model.
 */
export function chooseChain(options: {
  development: boolean;
  binding: Ai | undefined;
  model: ChosenModel;
  fallback: ChosenFallback;
  locale: () => Locale;
  breaker: CircuitBreaker;
  keys?: PaidKeys;
}): ProviderChain {
  const wanted = options.fallback !== NO_FALLBACK_MODEL && options.fallback !== options.model ? options.fallback : null;
  if (options.development) {
    const paid = isPaidModel(options.model);
    const primary = new MockAIProvider(options.locale, { failOnRequest: true, ...(paid ? { model: options.model, external: true } : {}) });
    const fallback = wanted
      ? new MockAIProvider(options.locale, isPaidModel(wanted) ? { model: wanted, external: true } : { model: "mock-fallback" })
      : null;
    return new ProviderChain(primary, fallback, options.breaker);
  }
  let fallback: AIProvider | null = null;
  // A fallback that can't be built (no binding, no key) is no fallback: the chosen model still answers.
  if (wanted && (isPaidModel(wanted) ? paidKey(options.keys ?? {}, paidProviderOf(wanted)) : options.binding)) {
    fallback = realProvider(wanted, options.binding, options.keys ?? {});
  }
  let primary: AIProvider;
  try {
    primary = chooseProvider(options);
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "NOT_CONFIGURED") throw error;
    // The chosen model can't be built (a paid one whose key was removed): the fallback answers alone,
    // and without one the chat says "not configured" while voice and the search by meaning go on.
    return new ProviderChain(fallback ?? new UnavailableProvider(options.model), null, options.breaker);
  }
  return new ProviderChain(primary, fallback, options.breaker);
}

/** A chosen model that can't be built: every call says NOT_CONFIGURED, before anything leaves or is counted. */
class UnavailableProvider implements AIProvider {
  readonly id = "mock";
  readonly billable = false;
  constructor(readonly model: string) {}
  async generate(): Promise<{ text: string }> {
    throw new AppError("NOT_CONFIGURED");
  }
  // biome-ignore lint/correctness/useYield: it fails before any event, like a provider that can't be reached.
  async *stream(): AsyncIterable<AgentEvent> {
    throw new AppError("NOT_CONFIGURED");
  }
  // biome-ignore lint/correctness/useYield: as above.
  async *generateWithTools(): AsyncIterable<AgentEvent> {
    throw new AppError("NOT_CONFIGURED");
  }
}
