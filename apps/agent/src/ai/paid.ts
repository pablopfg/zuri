import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { ANTHROPIC_CACHE_RATES, type PaidModel, type PaidProviderId, paidProviderOf } from "@zuri/shared";
import { createParser } from "eventsource-parser";
import type { LanguageModel } from "ai";
import type { GenerateRequest } from "./provider.ts";
import { estimateTokens, tokenCount } from "./provider.ts";
import { SdkProvider } from "./workers-ai.ts";
import type { StepMeter } from "./workers-ai-usage.ts";

/** The secret each company's key lives in (Worker secrets, never anywhere else). */
export interface PaidKeys {
  anthropic?: string | undefined;
  openai?: string | undefined;
}

/** The key of a company, or null when the secret is absent or blank. */
export function paidKey(keys: PaidKeys, provider: PaidProviderId): string | null {
  const key = keys[provider]?.trim();
  return key ? key : null;
}

/** Anthropic's 5-minute prompt cache (the default lifetime): nothing is kept beyond it. */
const CACHE = { type: "ephemeral" } as const;

const ANTHROPIC_URL = "https://api.anthropic.com/v1";
const OPENAI_URL = "https://api.openai.com/v1";

/**
 * A paid model (step 21, ⚠️) through the AI SDK and the company's own
 * provider package, with the same loop, tools and metering as Workers AI.
 *
 * - Every request goes through a fetch that meters it (one StepMeter per call,
 *   made before the call leaves) and reads the company's own token counts from
 *   the answer, so a call that fails or is stopped halfway is still counted.
 * - No temperature or top_p: the 5.5 and GPT-6 models refuse values other than
 *   their own. Reasoning is off or at its least: it is billed output.
 * - Nothing is kept on the company's side that Zuri can ask not to keep
 *   (`store: false` on OpenAI, no files, no saved conversations; plan D6).
 */
export class PaidProvider extends SdkProvider {
  readonly id: PaidProviderId;
  readonly billable = false;
  override readonly external = true;

  constructor(
    readonly model: PaidModel,
    private readonly key: string,
    /** The tests hand a fetch of their own; the real one otherwise. */
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    super();
    this.id = paidProviderOf(model);
  }

  /** The company's own name of the model: the id without its `anthropic/` or `openai/` prefix. */
  get remoteModel(): string {
    return this.model.slice(this.model.indexOf("/") + 1);
  }

  protected createModel(steps: StepMeter[], closed: () => boolean): LanguageModel {
    const metered = meteredFetch(this.fetcher, steps, closed);
    // Fixed hosts: the SDKs would otherwise read ANTHROPIC_BASE_URL / OPENAI_BASE_URL from the environment,
    // and a var with that name would send the key elsewhere.
    if (this.id === "anthropic") return createAnthropic({ apiKey: this.key, baseURL: ANTHROPIC_URL, fetch: metered })(this.remoteModel);
    return createOpenAI({ apiKey: this.key, baseURL: OPENAI_URL, fetch: metered }).responses(this.remoteModel);
  }

  /**
   * The last tool closes the part of the prompt that is the same in every turn (the tools come first
   * on the wire): cached there, a new message minutes later still reads the tools from the cache,
   * though the system prompt (the clock, the memories) changed.
   */
  protected override toolOptions(index: number, total: number): Record<string, unknown> {
    return this.id === "anthropic" && index === total - 1 ? { providerOptions: { anthropic: { cacheControl: CACHE } } } : {};
  }

  protected override settings(req: GenerateRequest): Record<string, unknown> {
    return {
      ...(req.signal ? { abortSignal: req.signal } : {}),
      providerOptions:
        this.id === "anthropic"
          ? // Haiku takes "disabled"; Sonnet 5.5 refuses it and turns reasoning off with "between_tools".
            // cacheControl: the prompt so far is cached for 5 minutes, so the next step of the turn reads it at a tenth of the price.
            { anthropic: { thinking: this.remoteModel.startsWith("claude-haiku") ? { type: "disabled" } : { type: "between_tools" }, cacheControl: CACHE } }
          : { openai: { store: false, reasoningEffort: "none" } },
    };
  }
}

interface Usage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
}

/** Characters the model generated in one answer event, and the token counts it carries. */
function capture(meter: StepMeter, value: unknown): void {
  const event = value as {
    delta?: unknown;
    usage?: Usage;
    message?: { usage?: Usage };
    response?: { usage?: Usage };
    content?: unknown;
    output?: unknown;
  } | null;
  if (!event || typeof event !== "object") return;
  const delta = event.delta;
  // OpenAI streams text and tool arguments as a plain string; Anthropic as text, JSON or thinking.
  if (typeof delta === "string") meter.outputChars += delta.length;
  else if (delta && typeof delta === "object") {
    for (const text of [(delta as { text?: unknown }).text, (delta as { partial_json?: unknown }).partial_json, (delta as { thinking?: unknown }).thinking]) {
      if (typeof text === "string") meter.outputChars += text.length;
    }
  }
  // A whole answer (generate, not streamed): its content counts as output.
  if (Array.isArray(event.content) || Array.isArray(event.output)) meter.outputChars += JSON.stringify(event.content ?? event.output).length;
  for (const usage of [event.usage, event.message?.usage, event.response?.usage]) {
    if (!usage) continue;
    const input = tokenCount(usage.input_tokens);
    if (input !== undefined) {
      // Anthropic counts the cached part apart; it was still sent, so it counts as prompt.
      const written = tokenCount(usage.cache_creation_input_tokens) ?? 0;
      const read = tokenCount(usage.cache_read_input_tokens) ?? 0;
      meter.input = input + written + read;
      // The bill is another matter: a write costs more than plain input, a read much less.
      if (written + read > 0) meter.inputBilled = input + written * ANTHROPIC_CACHE_RATES.write + read * ANTHROPIC_CACHE_RATES.read;
    }
    meter.output = tokenCount(usage.output_tokens) ?? meter.output;
  }
}

/** Largest SSE event read for metering; a bigger one stops the count, never the answer. */
const MAX_EVENT_BYTES = 1024 * 1024;

/**
 * A fetch that meters every model call: the StepMeter is made before the
 * request leaves (so a call that fails or is aborted is counted), with the
 * prompt estimated from the body; the company's counts replace the estimate
 * as the answer passes. The answer itself is not changed.
 */
export function meteredFetch(fetcher: typeof fetch, steps: StepMeter[], closed: () => boolean): typeof fetch {
  return async (input, init) => {
    // The turn already ended and was metered: no call may start after that.
    if (closed()) throw new DOMException("The turn has ended", "AbortError");
    const body = typeof init?.body === "string" ? init.body : "";
    const meter: StepMeter = { inputEstimate: estimateTokens(body.length), outputChars: 0, reported: false };
    steps.push(meter);
    const response = await fetcher(input, init);
    // A refused call (no credit, bad key, bad request) is not billed by the company: it counts as a
    // request, but costs nothing and never eats the US$ ceiling.
    if (!response.ok) {
      meter.input = 0;
      meter.output = 0;
      return response;
    }
    if (!response.body) return response;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/event-stream")) {
      // A whole answer, or an error: read a copy for the counts.
      try {
        capture(meter, JSON.parse(await response.clone().text()));
      } catch {
        // Metering never changes how the answer is read.
      }
      return response;
    }
    const decoder = new TextDecoder();
    let observing = true;
    const parser = createParser({
      maxBufferSize: MAX_EVENT_BYTES,
      onError: (error) => {
        if (error.type === "max-buffer-size-exceeded") observing = false;
      },
      onEvent: ({ data }) => {
        if (data === "[DONE]") return;
        try {
          capture(meter, JSON.parse(data));
        } catch {
          // Metering never changes how the answer is parsed.
        }
      },
    });
    const stream = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (observing) parser.feed(decoder.decode(chunk, { stream: true }));
          controller.enqueue(chunk);
        },
        flush() {
          if (observing) parser.feed(decoder.decode());
          parser.reset();
        },
      }),
    );
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
