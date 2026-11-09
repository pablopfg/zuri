import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EXTERNAL_HISTORY_MESSAGES,
  externalPrompt,
  LOCAL_ONLY_TEXT,
  luhn,
  Pseudonymizer,
  shorterHistory,
  withoutLocalOnly,
} from "../src/ai/external.ts";
import { MeteredAI } from "../src/ai/metered.ts";
import { MockAIProvider, type RecordedPrompt } from "../src/ai/mock.ts";
import type { AgentEvent, ModelMessage } from "../src/ai/provider.ts";
import type { AiLimits } from "../src/ai/usage.ts";
import { withAiWorld } from "./ai-fakes.ts";

const LIMITS: AiLimits = { requestsPerDay: 100, neuronsPerDay: 9_000, maxOutputTokens: 1_024 };

const EMAIL = "pablo@exemplo.com.br";
const CPF = "529.982.247-25";
const CARD = "4111 1111 1111 1111";
const IBAN = "GB82 WEST 1234 5698 7654 32";
const PHONE = "+55 11 98765-4321";
const KEY = "sk-ant-abcdefghijklmnop1234";

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const text = (events: AgentEvent[]) =>
  events
    .filter((event): event is Extract<AgentEvent, { type: "text" }> => event.type === "text")
    .map((event) => event.delta)
    .join("");

describe("the pseudonymizer (D5)", () => {
  it("hides each kind of value behind a marker, the same value behind the same marker, and gives them back", () => {
    const p = new Pseudonymizer();
    const original = `E-mail ${EMAIL}, CPF ${CPF}, cartão ${CARD}, IBAN ${IBAN}, fone ${PHONE}, chave ${KEY}. De novo: ${EMAIL}.`;
    const hidden = p.hide(original);
    for (const value of [EMAIL, CPF, CARD, IBAN, PHONE, KEY]) expect(hidden).not.toContain(value);
    expect(hidden).toContain("[EMAIL_1]");
    expect(hidden.match(/\[EMAIL_1\]/g)).toHaveLength(2);
    expect(hidden).toMatch(/\[CPF_1\]/);
    expect(hidden).toMatch(/\[CARD_1\]/);
    expect(hidden).toMatch(/\[IBAN_1\]/);
    expect(hidden).toMatch(/\[KEY_1\]/);
    expect(hidden).toMatch(/\[PHONE_1\]/);
    expect(p.size).toBe(6);
    expect(p.reveal(hidden)).toBe(original);
  });

  it("leaves alone what only looks like a value: a wrong check digit, a bad IBAN, a timestamp, an id", () => {
    const p = new Pseudonymizer();
    const plain = "CPF 529.982.247-26, IBAN GB00 WEST 1234 5698 7654 32, cartão 4111 1111 1111 1112, hora 1730376000000, id 0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d, 111.111.111-11";
    expect(p.hide(plain)).toBe(plain);
    expect(p.size).toBe(0);
  });

  it("checks cards with Luhn", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("4111111111111112")).toBe(false);
    expect(luhn("0000000")).toBe(false);
  });

  it("never gives back a marker it did not hand out, so a model cannot ask for a value by guessing", () => {
    const p = new Pseudonymizer();
    p.hide(`Fale com ${EMAIL}`);
    expect(p.reveal("[EMAIL_1] e [EMAIL_2] e [CPF_1]")).toBe(`${EMAIL} e [EMAIL_2] e [CPF_1]`);
    expect(new Pseudonymizer().reveal("[EMAIL_1]")).toBe("[EMAIL_1]");
  });

  it("turns a marker already written in the content into plain text, so it never gives back a value from elsewhere", () => {
    const p = new Pseudonymizer();
    const hidden = p.hide(`Mande para [EMAIL_1]. O meu é ${EMAIL}`);
    expect(hidden).toBe("Mande para (EMAIL_1). O meu é [EMAIL_1]");
    expect(p.reveal(hidden)).toBe(`Mande para (EMAIL_1). O meu é ${EMAIL}`);
  });

  it("puts back whole a marker split between two pieces of a streamed answer", () => {
    const p = new Pseudonymizer();
    p.hide(`Fale com ${EMAIL}`);
    const reader = p.revealStream();
    const pieces = ["Escreva para [EM", "AIL", "_1", "] hoje [", "nota] e [EMAIL_"];
    const out = pieces.map((piece) => reader.push(piece)).join("") + reader.flush();
    expect(out).toBe(`Escreva para ${EMAIL} hoje [nota] e [EMAIL_`);
  });

  it("reveals and hides every string of a value, keys left alone", () => {
    const p = new Pseudonymizer();
    const hidden = p.hideDeep({ [EMAIL]: [EMAIL, { cpf: CPF, n: 3 }] });
    expect(hidden).toEqual({ [EMAIL]: ["[EMAIL_1]", { cpf: "[CPF_1]", n: 3 }] });
    expect(p.revealDeep(hidden)).toEqual({ [EMAIL]: [EMAIL, { cpf: CPF, n: 3 }] });
  });
});

describe("what leaves for an external model (D3 and D4)", () => {
  it("empties the text of a line marked local, and keeps the line so the model knows something is there", () => {
    const prompt = `<data kind="memory" id="m1" local="1">Senha do cofre é 1234</data>\n<data kind="memory" id="m2">Gosta de café</data>`;
    const out = withoutLocalOnly(prompt);
    expect(out).not.toContain("Senha do cofre");
    expect(out).toContain(`<data kind="memory" id="m1" local="1">${LOCAL_ONLY_TEXT}</data>`);
    expect(out).toContain("Gosta de café");
  });

  it("reads a long run of attributes in linear time, and leaves an unmarked line whole", () => {
    const hostile = `<data local="1"${' local="1"'.repeat(50_000)}`;
    const started = performance.now();
    expect(withoutLocalOnly(hostile)).toBe(hostile);
    expect(performance.now() - started).toBeLessThan(500);
    expect(withoutLocalOnly(`<data kind="note" id="n1" note="local">texto</data>`)).toBe(`<data kind="note" id="n1" note="local">texto</data>`);
  });

  it("sends the last messages only, starting at one of the owner's", () => {
    const messages: ModelMessage[] = Array.from({ length: 13 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }));
    const short = shorterHistory(messages);
    expect(short.length).toBeLessThanOrEqual(EXTERNAL_HISTORY_MESSAGES);
    expect(short[0]?.role).toBe("user");
    expect(short.at(-1)?.content).toBe("m12");
    const few = messages.slice(0, 3);
    expect(shorterHistory(few)).toBe(few);
  });

  it("applies the three to the system prompt and the messages", () => {
    const p = new Pseudonymizer();
    const out = externalPrompt(
      { system: `Dono: ${EMAIL}\n<data kind="note" local="1">CPF ${CPF}</data>`, messages: [{ role: "user", content: `Meu CPF é ${CPF}` }] },
      p,
    );
    expect(out.system).toBe(`Dono: [EMAIL_1]\n<data kind="note" local="1">${LOCAL_ONLY_TEXT}</data>`);
    expect(out.messages).toEqual([{ role: "user", content: "Meu CPF é [CPF_1]" }]);
  });
});

describe("MeteredAI with an external model", () => {
  it("hides the values on the way out and gives them back in the answer the owner reads", async () => {
    await withAiWorld(async ({ meter }) => {
      const prompts: RecordedPrompt[] = [];
      const mock = new MockAIProvider(undefined, { external: true, model: "anthropic/claude-haiku-5-5", record: (p) => prompts.push(p) });
      const ai = new MeteredAI(mock, meter, () => LIMITS);
      const exposure = { external: false };
      const events = await collect(ai.stream({ system: `Dono: ${EMAIL}`, messages: [{ role: "user", content: `Meu e-mail é ${EMAIL}` }], maxOutputTokens: 256, exposure }));
      expect(JSON.stringify(prompts)).not.toContain(EMAIL);
      expect(prompts[0]?.messages[0]?.content).toBe("Meu e-mail é [EMAIL_1]");
      expect(text(events)).toContain(EMAIL);
      expect(text(events)).not.toContain("[EMAIL_1]");
      expect(exposure.external).toBe(true);
    });
  });

  it("gives the tool the real argument, and hides its result before the model reads it", async () => {
    await withAiWorld(async ({ meter }) => {
      const prompts: RecordedPrompt[] = [];
      const mock = new MockAIProvider(undefined, { external: true, model: "openai/gpt-6-luna", record: (p) => prompts.push(p) });
      const ai = new MeteredAI(mock, meter, () => LIMITS);
      const received: unknown[] = [];
      const tools = [
        {
          name: "find_contact",
          description: "Finds a contact",
          inputSchema: z.object({ email: z.string() }),
          execute: async (input: unknown) => {
            received.push(input);
            return { name: "Ana", cpf: CPF };
          },
        },
      ];
      const events = await collect(
        ai.generateWithTools({
          system: "Você é a Zuri.",
          messages: [{ role: "user", content: `call find_contact {"email":"${EMAIL}"}` }],
          maxOutputTokens: 256,
          tools,
          maxIterations: 3,
          toolBudgetExhausted: () => false,
          exposure: { external: false },
        }),
      );
      expect(received).toEqual([{ email: EMAIL }]);
      expect(JSON.stringify(prompts)).not.toContain(CPF);
      expect(JSON.stringify(prompts)).not.toContain(EMAIL);
      expect(prompts[0]?.toolResults).toEqual([{ name: "Ana", cpf: "[CPF_1]" }]);
      // The owner's screen shows the real values.
      const start = events.find((event) => event.type === "tool-start");
      const end = events.find((event) => event.type === "tool-end");
      expect(start).toMatchObject({ input: { email: EMAIL } });
      expect(end).toMatchObject({ output: { name: "Ana", cpf: CPF } });
    });
  });

  it("sends the whole context to Workers AI: nothing hidden, exposure says so", async () => {
    await withAiWorld(async ({ meter }) => {
      const prompts: RecordedPrompt[] = [];
      const mock = new MockAIProvider(undefined, { record: (p) => prompts.push(p) });
      const ai = new MeteredAI(mock, meter, () => LIMITS);
      const exposure = { external: true };
      await collect(ai.stream({ system: `<data local="1">segredo</data>`, messages: [{ role: "user", content: `Meu e-mail é ${EMAIL}` }], maxOutputTokens: 256, exposure }));
      expect(prompts[0]?.messages[0]?.content).toBe(`Meu e-mail é ${EMAIL}`);
      expect(prompts[0]?.system).toContain("segredo");
      expect(exposure.external).toBe(false);
    });
  });
});
