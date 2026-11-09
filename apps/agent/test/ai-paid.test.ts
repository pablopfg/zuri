import { AI_LIMIT_RANGES, type AiModel, PAID_MODEL_IDS, PAID_MODELS, PAID_PROVIDERS, paidUsd, usageHistorySchema, usageReportSchema } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { CircuitBreaker, ProviderChain } from "../src/ai/chain.ts";
import { chooseChain, chooseProvider } from "../src/ai/index.ts";
import { MeteredAI } from "../src/ai/metered.ts";
import { MockAIProvider } from "../src/ai/mock.ts";
import { PaidProvider } from "../src/ai/paid.ts";
import { classifyAiError, isSwitchable, type StepUsage } from "../src/ai/provider.ts";
import { type AiLimits, stepNeurons, stepUsd } from "../src/ai/usage.ts";
import { AppError } from "../src/http/errors.ts";
import { withAiWorld } from "./ai-fakes.ts";

const HAIKU = "anthropic/claude-haiku-5-5";
const SONNET = "anthropic/claude-sonnet-5-5";
const LUNA = "openai/gpt-6-luna";
const GLM = "@cf/zai-org/glm-4.7-flash";
const LIMITS: AiLimits = { requestsPerDay: 100, neuronsPerDay: 9_000, maxOutputTokens: 1_024 };

const used = (model: string, input: number, output: number): StepUsage => ({
  model,
  billable: false,
  input: { reported: input, estimated: 0 },
  output: { reported: output, estimated: 0 },
});

function refusal(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

const encoder = new TextEncoder();

/** Anthropic's stream: one `data:` line per event, as the Messages API sends it. */
function anthropicStream(text: string, usage: { input: number; output: number }): Response {
  const events = [
    {
      type: "message_start",
      message: { id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: 1 } },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...[...text.matchAll(/.{1,4}/gs)].map(([piece]) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } })),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: usage.output } },
    { type: "message_stop" },
  ];
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(encoder.encode(body), { status: 200, headers: { "content-type": "text/event-stream" } });
}

const errorResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function fakeFetch(answer: (sent: Sent, index: number) => Response): { fetcher: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input instanceof Request ? input.url : input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? "{}")) };
    sent.push(call);
    return answer(call, sent.length - 1);
  }) as typeof fetch;
  return { fetcher, sent };
}

async function collect(events: AsyncIterable<{ type: string; delta?: string }>) {
  const out: { type: string; delta?: string }[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("the paid models' catalog", () => {
  it("has a dated price for every paid id, and every company says it does not train on API data (D6)", () => {
    for (const id of PAID_MODEL_IDS) {
      expect(PAID_MODELS[id].input).toBeGreaterThan(0);
      expect(PAID_MODELS[id].output).toBeGreaterThan(PAID_MODELS[id].input);
    }
    for (const provider of Object.values(PAID_PROVIDERS)) {
      expect(provider.trainsOnData).toBe(false);
      expect(provider.retentionDays).toBeLessThanOrEqual(30);
    }
  });

  it("prices a step in US$ by the table and never in Neurons", () => {
    // 6,000 tokens in and 400 out on Haiku 5.5: 0.0006 + 0.0002.
    expect(paidUsd(HAIKU, 6_000, 400)).toBeCloseTo(0.0008, 10);
    expect(stepUsd(used(SONNET, 1_000_000, 100_000))).toBeCloseTo(3, 10);
    // Even a step marked billable (a bug) costs no Neurons on a paid model.
    expect(stepNeurons({ ...used(HAIKU, 6_000, 400), billable: true })).toBe(0);
    expect(stepUsd(used(GLM, 6_000, 400))).toBe(0);
  });

  it("starts with no ceiling: 0 is the default, and the range goes up to US$ 10,000", () => {
    expect(AI_LIMIT_RANGES.aiUsdCentsPerDay).toEqual({ min: 0, max: 1_000_000, default: 0 });
  });
});

describe("US$ counted before the call and settled after it", () => {
  it("holds the estimate, then keeps what the company reported, on the day and on the model's line", async () => {
    await withAiWorld(({ meter, db }) => {
      const reservation = meter.reserveChat({ model: HAIKU, billable: false, inputTokens: 10_000, maxOutputTokens: 1_000 }, LIMITS);
      // 10,000 × 0.10 + 1,000 × 0.50 per million.
      expect(reservation.usd).toBeCloseTo(0.0015, 10);
      expect(reservation.neurons).toBe(0);
      expect(db.one<{ paid_usd: number }>(`SELECT paid_usd FROM zur_usage_daily`)?.paid_usd).toBeCloseTo(0.0015, 10);
      meter.settle(reservation, used(HAIKU, 8_000, 200));
      const report = meter.report(LIMITS, "workers-ai", HAIKU);
      expect(report.today.paidUsd).toBeCloseTo(0.0009, 10);
      expect(report.today.neurons).toBe(0);
      // Workers AI's list price is not mixed with real money.
      expect(report.today.costUsd).toBe(0);
      expect(report.today.models).toEqual([expect.objectContaining({ model: HAIKU, calls: 1, neurons: 0, costUsd: expect.closeTo(0.0009, 10) })]);
      expect(usageReportSchema.safeParse(report).success).toBe(true);
    });
  });

  it("gives the hold back when the call never started", async () => {
    await withAiWorld(({ meter }) => {
      const reservation = meter.reserveChat({ model: SONNET, billable: false, inputTokens: 5_000, maxOutputTokens: 500 }, LIMITS);
      meter.release(reservation);
      expect(meter.report(LIMITS, "workers-ai", SONNET).today).toMatchObject({ paidUsd: 0, requests: 0 });
    });
  });

  it("has no ceiling when it is 0: a dear day goes on", async () => {
    await withAiWorld(({ meter }) => {
      for (let i = 0; i < 5; i++) {
        meter.settle(meter.reserveChat({ model: SONNET, billable: false, inputTokens: 1_000_000, maxOutputTokens: 1_000 }, LIMITS), used(SONNET, 1_000_000, 1_000));
      }
      expect(meter.report(LIMITS, "workers-ai", SONNET).today.paidUsd).toBeCloseTo(10.05, 6);
    });
  });

  it("with a ceiling, allows the call that lands exactly on it and refuses the one that would pass it (n−1, n, n+1)", async () => {
    // US$ 0.03 a day; Sonnet holds 2 per million in and 10 per million out.
    await withAiWorld(({ meter }) => {
      const limits = { ...LIMITS, usdCentsPerDay: 3 };
      const call = { model: SONNET, billable: false, inputTokens: 1_000, maxOutputTokens: 1_000 };
      meter.reserveChat(call, limits); // 0.012 (n−1)
      meter.reserveChat({ ...call, maxOutputTokens: 1_600 }, limits); // 0.018: lands on 0.030 exactly (n)
      const error = refusal(() => meter.reserveChat({ ...call, inputTokens: 1, maxOutputTokens: 1 }, limits)); // n+1
      expect(error.code).toBe("AI_LIMIT_REACHED");
      expect(error.messageKey).toBe("error.aiLimit.usd");
      expect(error.details).toMatchObject({ limit: "usd", max: 0.03 });
      // The free models don't count against the paid ceiling.
      meter.reserveChat({ model: GLM, billable: true, inputTokens: 1_000, maxOutputTokens: 100 }, limits);
    });
  });
});

describe("the usage history", () => {
  it("moves the usage area's number with every write of the counters, without a row of its own", async () => {
    await withAiWorld(({ meter }) => {
      const before = meter.version;
      expect(meter.version).toBe(before);
      meter.settle(meter.reserveChat({ model: HAIKU, billable: false, inputTokens: 100, maxOutputTokens: 10 }, LIMITS), used(HAIKU, 100, 10));
      expect(meter.version).toBeGreaterThan(before);
      expect(Number.isSafeInteger(meter.version)).toBe(true);
    });
  });

  it("returns the period's days and models, with the paid US$ per day and model, and parses with the shared schema", async () => {
    await withAiWorld(({ meter, clock }) => {
      meter.settle(meter.reserveChat({ model: GLM, billable: true, inputTokens: 1_000, maxOutputTokens: 100 }, LIMITS), { ...used(GLM, 1_000, 100), billable: true });
      clock.now -= 3 * 86_400_000;
      meter.settle(meter.reserveChat({ model: HAIKU, billable: false, inputTokens: 1_000, maxOutputTokens: 100 }, LIMITS), used(HAIKU, 2_000, 400));
      clock.now -= 10 * 86_400_000;
      meter.settle(meter.reserveChat({ model: LUNA, billable: false, inputTokens: 1_000, maxOutputTokens: 100 }, LIMITS), used(LUNA, 1_000, 100));
      clock.now += 13 * 86_400_000;

      const week = meter.history(7);
      expect(usageHistorySchema.safeParse(week).success).toBe(true);
      expect(week).toMatchObject({ from: "2026-10-25", to: "2026-10-31" });
      expect(week.days.map((d) => d.day)).toEqual(["2026-10-28", "2026-10-31"]);
      // One call each: the tie is broken by the model's name.
      expect(week.models.map((m) => [m.model, m.paid])).toEqual([
        [GLM, false],
        [HAIKU, true],
      ]);
      expect(week.paidByDay).toEqual([{ day: "2026-10-28", model: HAIKU, usd: expect.closeTo(0.0004, 10) }]);

      const month = meter.history(30);
      expect(month.days).toHaveLength(3);
      expect(month.paidByDay.map((r) => r.model).sort()).toEqual([HAIKU, LUNA]);
    });
  });
});

describe("the paid provider", () => {
  it("streams Claude's answer through the company's API, with the key in its header, reasoning off and no temperature", async () => {
    const { fetcher, sent } = fakeFetch(() => anthropicStream("Olá, Pablo!", { input: 1_200, output: 40 }));
    const provider = new PaidProvider(HAIKU, "sk-ant-test-key-123456", fetcher);
    const steps: StepUsage[] = [];
    const events = await collect(
      provider.stream({ system: "Be brief.", messages: [{ role: "user", content: "Oi" }], maxOutputTokens: 300, temperature: 0.4, onStepUsage: (u) => steps.push(u) }),
    );
    expect(events.map((e) => e.delta ?? "").join("")).toBe("Olá, Pablo!");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent[0]?.headers.get("x-api-key")).toBe("sk-ant-test-key-123456");
    expect(sent[0]?.body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 300, thinking: { type: "disabled" } });
    expect(sent[0]?.body).not.toHaveProperty("temperature");
    // The company's own counts, never the estimate.
    expect(steps).toEqual([{ model: HAIKU, billable: false, input: { reported: 1_200, estimated: 0 }, output: { reported: 40, estimated: 0 } }]);
    expect(provider).toMatchObject({ id: "anthropic", external: true, billable: false });
  });

  it("asks OpenAI to keep nothing (store: false), with reasoning off and no temperature", async () => {
    const { fetcher, sent } = fakeFetch(() => errorResponse(500, { error: { message: "server error", type: "server_error" } }));
    const provider = new PaidProvider(LUNA, "sk-proj-test-key-1234567", fetcher);
    const steps: StepUsage[] = [];
    await expect(collect(provider.stream({ system: "x", messages: [{ role: "user", content: "Oi" }], maxOutputTokens: 200, temperature: 0.2, onStepUsage: (u) => steps.push(u) }))).rejects.toMatchObject({
      messageKey: "error.aiUnavailable",
    });
    expect(sent[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(sent[0]?.headers.get("authorization")).toBe("Bearer sk-proj-test-key-1234567");
    expect(sent[0]?.body).toMatchObject({ model: "gpt-6-luna", store: false, reasoning: { effort: "none" } });
    expect(sent[0]?.body).not.toHaveProperty("temperature");
    // A call that reached the company is metered even when it failed.
    expect(steps).toHaveLength(1);
    expect(steps[0]?.input.estimated).toBeGreaterThan(0);
  });

  it("turns Sonnet's reasoning off the way it accepts (between_tools)", async () => {
    const { fetcher, sent } = fakeFetch(() => anthropicStream("ok", { input: 10, output: 2 }));
    await collect(new PaidProvider(SONNET, "sk-ant-test-key-123456", fetcher).stream({ system: "x", messages: [{ role: "user", content: "Oi" }], maxOutputTokens: 50 }));
    expect(sent[0]?.body).toMatchObject({ model: "claude-sonnet-5-5", thinking: { type: "between_tools" } });
  });

  it("reads a company's refusals as stable errors: no credit and a refused key switch, a bad request doesn't", () => {
    const status = (code: number, message: string) => Object.assign(new Error(message), { statusCode: code });
    const noCredit = classifyAiError(status(400, "Your credit balance is too low to access the Anthropic API."));
    expect(noCredit.messageKey).toBe("error.aiNoCredit");
    expect(classifyAiError(status(429, "You exceeded your current quota, please check your plan and billing details.")).messageKey).toBe("error.aiNoCredit");
    expect(classifyAiError(status(402, "Payment required")).messageKey).toBe("error.aiNoCredit");
    const key = classifyAiError(status(401, "invalid x-api-key"));
    expect(key.messageKey).toBe("error.aiKeyRefused");
    expect(classifyAiError(status(403, "forbidden")).messageKey).toBe("error.aiKeyRefused");
    expect([noCredit, key].every(isSwitchable)).toBe(true);
    // An ordinary rate limit is still "busy", and a bad request never switches.
    expect(classifyAiError(status(429, "rate limit")).messageKey).toBe("error.aiBusy");
    expect(isSwitchable(classifyAiError(status(400, "messages: too long")))).toBe(false);
  });
});

describe("no credit and a refused key", () => {
  it("keep the company out until the owner says to try again, stored apart from the object's memory", () => {
    const saved: Record<string, string> = {};
    const states = { load: () => ({}), save: (provider: "anthropic" | "openai", state: string) => {
        saved[provider] = state;
      },
    };
    const breaker = new CircuitBreaker(() => 0, null, states);
    const haiku = { id: "anthropic" as const, model: HAIKU };
    expect(breaker.available(haiku)).toBe(true);
    breaker.failed(haiku, new AppError("SERVICE_UNAVAILABLE", "error.aiNoCredit"));
    expect(breaker.state("anthropic")).toBe("no_credit");
    expect(saved).toEqual({ anthropic: "no_credit" });
    // Every model of that company is out; the other company and Workers AI are not.
    expect(breaker.available({ id: "anthropic", model: SONNET })).toBe(false);
    expect(breaker.available({ id: "openai", model: LUNA })).toBe(true);
    expect(breaker.available({ id: "workers-ai", model: GLM })).toBe(true);
    breaker.reset("anthropic");
    expect(breaker.available(haiku)).toBe(true);
    expect(saved).toEqual({ anthropic: "ok" });
    // A restarted object reads the state back.
    expect(new CircuitBreaker(() => 0, null, { load: () => ({ openai: "bad_key" }), save: () => undefined }).state("openai")).toBe("bad_key");
  });

  it("answers from the fallback while the chosen paid model has no credit, and says why when there is none", async () => {
    await withAiWorld(async ({ meter }) => {
      const breaker = new CircuitBreaker(() => 0);
      breaker.failed({ id: "anthropic", model: HAIKU }, new AppError("SERVICE_UNAVAILABLE", "error.aiNoCredit"));
      const paid = new PaidProvider(HAIKU, "sk-ant-test-key-123456", fakeFetch(() => anthropicStream("never", { input: 1, output: 1 })).fetcher);
      const fallback = new MockAIProvider(() => "pt-BR", { model: "mock-fallback" });
      const ai = new MeteredAI(new ProviderChain(paid, fallback, breaker), meter, () => LIMITS);
      const events = await collect(ai.stream({ system: "x", messages: [{ role: "user", content: "Oi" }], maxOutputTokens: 100 }));
      expect(events[0]).toEqual({ type: "fallback", model: "mock-fallback" });
      // The usage panel counts the take-over, per day, in the same write as the call.
      expect(meter.report(LIMITS, "workers-ai", HAIKU).today.fallbacks).toBe(1);
      expect(meter.history(7).days.at(-1)?.fallbacks).toBe(1);
      const alone = new MeteredAI(new ProviderChain(paid, null, breaker), meter, () => LIMITS);
      await expect(collect(alone.stream({ system: "x", messages: [{ role: "user", content: "Oi" }], maxOutputTokens: 100 }))).rejects.toMatchObject({ messageKey: "error.aiNoCredit" });
    });
  });
});

describe("choosing a paid model", () => {
  it("is refused without the company's key, and builds the provider with it", () => {
    const options = { development: false, binding: undefined, model: HAIKU as AiModel, locale: () => "pt-BR" as const };
    expect(refusal(() => chooseProvider(options)).code).toBe("NOT_CONFIGURED");
    expect(refusal(() => chooseProvider({ ...options, keys: { anthropic: "   " } })).code).toBe("NOT_CONFIGURED");
    // The other company's key is not this one's.
    expect(refusal(() => chooseProvider({ ...options, keys: { openai: "sk-proj-1234567890" } })).code).toBe("NOT_CONFIGURED");
    expect(chooseProvider({ ...options, keys: { anthropic: "sk-ant-1234567890" } })).toBeInstanceOf(PaidProvider);
  });

  it("leaves a paid fallback out when its key is missing, so the chosen model still answers", () => {
    const fake = { run: async () => ({}) } as unknown as Ai;
    const chain = chooseChain({ development: false, binding: fake, model: GLM, fallback: LUNA, locale: () => "pt-BR", breaker: new CircuitBreaker() });
    expect(chain.fallback).toBeNull();
    const withKey = chooseChain({ development: false, binding: fake, model: GLM, fallback: LUNA, locale: () => "pt-BR", breaker: new CircuitBreaker(), keys: { openai: "sk-proj-1234567890" } });
    expect(withKey.fallback).toMatchObject({ id: "openai", model: LUNA });
  });

  it("is the mock under the paid name in local development: nothing leaves, and it gets the external profile", () => {
    const chain = chooseChain({ development: true, binding: undefined, model: SONNET, fallback: "none", locale: () => "pt-BR", breaker: new CircuitBreaker() });
    expect(chain.primary).toMatchObject({ id: "mock", model: SONNET, external: true });
  });
});
