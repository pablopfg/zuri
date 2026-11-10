import { generateText, type LanguageModel, streamText, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { AgentEvent, AIProvider, GenerateRequest, ToolRequest } from "./provider.ts";
import { AppError } from "../http/errors.ts";
import { classifyAiError, estimateTokens, plainMessages } from "./provider.ts";
import { meteredBinding, type StepMeter, stepUsage } from "./workers-ai-usage.ts";

// The SDK would log every provider warning (an unsupported setting, say) with
// console.warn on the common path: each line is a billed log event (rule P10).
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

/**
 * The models whose chat template has a "thinking" switch (their model pages
 * list `chat_template_kwargs`). The Llama models do not take the field, and an
 * unknown input could make Cloudflare refuse every call to them.
 */
const THINKING_MODELS: ReadonlySet<string> = new Set(["@cf/zai-org/glm-4.7-flash", "@cf/qwen/qwen3-30b-a3b-fp8"]);

/**
 * A model reached through the AI SDK (Workers AI here, the paid companies in
 * paid.ts): the turn's loop, the tools and the metering of every call that
 * started. A subclass gives the model, already wrapped so each call it makes
 * pushes one StepMeter, and the call settings it accepts. The SDK's retries
 * are off: a retry is a model call the daily limits would not see.
 */
export abstract class SdkProvider implements AIProvider {
  abstract readonly id: AIProvider["id"];
  abstract readonly model: string;
  abstract readonly billable: boolean;
  /** A company outside the owner's account (the paid models, step 21). */
  readonly external: boolean = false;

  protected abstract createModel(steps: StepMeter[], closed: () => boolean): LanguageModel;

  /** The settings of one call: Workers AI takes the temperature; the paid models get their own (paid.ts). */
  protected settings(req: GenerateRequest, _withTools = false): Record<string, unknown> {
    return callOptions(req);
  }

  /** Extra fields of one tool's definition; `last` is the last one the model is offered as the turn starts. None unless a provider has some (paid.ts). */
  protected toolOptions(_last: boolean): Record<string, unknown> {
    return {};
  }

  private usage(meter: StepMeter, outputChars: number) {
    return { ...stepUsage(this.model, meter, outputChars), billable: this.billable };
  }

  /**
   * Hands every started call that was not reported yet to `onStepUsage`. After
   * it, the turn is closed: a call the SDK would still start (a step after the
   * Stop button) is refused, so none runs without being counted.
   */
  private flush(req: GenerateRequest, steps: StepMeter[], lastOutputChars: number): void {
    for (const [index, meter] of steps.entries()) {
      if (meter.reported) continue;
      meter.reported = true;
      req.onStepUsage?.(this.usage(meter, index === steps.length - 1 ? lastOutputChars : 0));
    }
  }

  async generate(req: GenerateRequest): Promise<{ text: string }> {
    const steps: StepMeter[] = [];
    let closed = false;
    let outputChars = 0;
    try {
      const result = await generateText({
        model: this.createModel(steps, () => closed),
        instructions: req.system,
        messages: plainMessages(req.messages),
        maxOutputTokens: req.maxOutputTokens,
        ...this.settings(req),
        maxRetries: 0,
        telemetry: { isEnabled: false },
      });
      outputChars = result.text.length + (result.reasoningText?.length ?? 0);
      if (result.finishReason === "content-filter" && !result.text) throw refused();
      return { text: result.text };
    } catch (error) {
      throw classifyAiError(error, this.external === true);
    } finally {
      // A call that reached the binding is metered, whether it answered, failed or was aborted.
      closed = true;
      this.flush(req, steps, outputChars);
    }
  }

  async *stream(req: GenerateRequest): AsyncIterable<AgentEvent> {
    yield* this.generateWithTools({ ...req, tools: [], maxIterations: 1, toolBudgetExhausted: () => true });
  }

  async *generateWithTools(req: ToolRequest): AsyncIterable<AgentEvent> {
    const tools: ToolSet = {};
    // Tools that are off this turn (an MCP server not in use) are not sent, so the last one sent may not be the last of the list.
    const active = req.activeTools ? new Set(req.activeTools()) : null;
    const last = req.tools.findLastIndex((tool) => !active || active.has(tool.name));
    for (const [index, tool] of req.tools.entries()) {
      tools[tool.name] = {
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (input: unknown, options: { toolCallId: string }) => tool.execute(input, options.toolCallId),
        ...this.toolOptions(index === last),
      } as ToolSet[string];
    }
    const hasTools = req.tools.length > 0;
    const steps: StepMeter[] = [];
    let closed = false;
    let stepIndex = 0;
    let stepOutputChars = 0;
    let streamError: unknown = null;
    // A model that declines (Anthropic's "refusal", OpenAI's content filter) ends with nothing said.
    let said = false;
    let declined = false;
    const result = streamText({
      model: this.createModel(steps, () => closed),
      instructions: req.system,
      messages: plainMessages(req.messages),
      maxOutputTokens: req.maxOutputTokens,
      ...this.settings(req, hasTools),
      maxRetries: 0,
      telemetry: { isEnabled: false },
      ...(hasTools
        ? {
            tools,
            // Each further step is another model call: stop at the cap or when the daily limits say so.
            stopWhen: ({ steps: done }: { steps: { toolResults?: unknown }[] }) =>
              done.length >= req.maxIterations || (req.reserveNextStep ? !req.reserveNextStep(nextPrompt(steps, done)) : false),
            // On the last allowed step, or with the tool budget spent, the model must answer in text.
            prepareStep: ({ stepNumber }: { stepNumber: number }) => ({
              ...(req.activeTools ? { activeTools: req.activeTools() } : {}),
              ...(stepNumber >= req.maxIterations - 1 || req.toolBudgetExhausted() ? { toolChoice: "none" as const } : {}),
            }),
          }
        : {}),
      onError: ({ error }: { error: unknown }) => {
        streamError = error;
      },
    });

    let failure: unknown = null;
    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "reasoning-delta":
            stepOutputChars += part.text.length;
            break;
          case "text-delta":
            stepOutputChars += part.text.length;
            if (part.text) {
              said = true;
              yield { type: "text", delta: part.text };
            }
            break;
          case "tool-call":
            said = true;
            stepOutputChars += JSON.stringify({ name: part.toolName, input: part.input }).length;
            yield { type: "tool-start", id: part.toolCallId, name: part.toolName, input: part.input };
            break;
          case "tool-result":
            yield { type: "tool-end", id: part.toolCallId, name: part.toolName, output: part.output };
            break;
          case "tool-error":
            yield {
              type: "tool-end",
              id: part.toolCallId,
              name: part.toolName,
              output: null,
              error: part.error instanceof Error ? part.error.message : String(part.error),
            };
            break;
          case "finish-step": {
            if (part.finishReason === "content-filter") declined = true;
            const meter = steps[stepIndex];
            if (meter && !meter.reported) {
              meter.reported = true;
              req.onStepUsage?.(this.usage(meter, stepOutputChars));
            }
            stepIndex++;
            stepOutputChars = 0;
            break;
          }
          case "error":
            throw part.error;
          default:
            break;
        }
      }
    } catch (error) {
      failure = error;
    } finally {
      // Runs also when the caller stops reading (the Stop button, a closed tab):
      // every call that started is metered before anything else happens.
      closed = true;
      this.flush(req, steps, stepOutputChars);
    }
    failure ??= streamError;
    if (failure) throw classifyAiError(failure, this.external === true);
    // Another model would decline the same request: a refused request, never a switch.
    if (declined && !said) throw refused();
  }
}

/** The model declined to answer: like a refused request, the same for any model (no switch). */
function refused(): AppError {
  return new AppError("SERVICE_UNAVAILABLE", "error.aiRequestRejected");
}

/**
 * Cloudflare Workers AI through the AI SDK and Cloudflare's own provider for it.
 * Reasoning ("thinking") is off: it would multiply the output Neurons.
 */
export class WorkersAIProvider extends SdkProvider {
  readonly id = "workers-ai";
  readonly billable = true;

  constructor(
    private readonly binding: Ai,
    readonly model: string,
  ) {
    super();
  }

  protected createModel(steps: StepMeter[], closed: () => boolean) {
    const workersai = createWorkersAI({ binding: meteredBinding(this.binding, steps, closed) });
    return workersai(
      this.model as Parameters<typeof workersai>[0],
      THINKING_MODELS.has(this.model) ? { chat_template_kwargs: { enable_thinking: false } } : {},
    );
  }
}

/**
 * The next step's prompt, in tokens: the last prompt, plus what the model
 * answered in it, plus the tool results it gets back.
 */
function nextPrompt(steps: StepMeter[], done: { toolResults?: unknown }[]): number {
  const last = steps.at(-1);
  const previous = last ? (last.input ?? last.inputEstimate) + (last.output ?? estimateTokens(last.outputChars)) : 0;
  return previous + estimateTokens(JSON.stringify(done.at(-1)?.toolResults ?? []));
}

/**
 * Optional call settings, left out rather than passed as undefined. Only
 * these reach the model through the SDK: `seed`, `top_k` and the penalties
 * are not sent (docs/planos/guardrails-multiagentes-ia.md, section 6).
 */
export function callOptions(req: GenerateRequest): { temperature?: number; topP?: number; abortSignal?: AbortSignal } {
  return {
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    ...(req.topP === undefined ? {} : { topP: req.topP }),
    ...(req.signal ? { abortSignal: req.signal } : {}),
  };
}
