import { AGENT_INSTANCE_NAME, type TelegramStatus } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { MockAIProvider, type RecordedPrompt } from "../src/ai/mock.ts";
import type { Transcriber } from "../src/ai/transcription.ts";
import { telegramWebhookSecret } from "../src/gates/telegram.ts";
import recorded from "./fixtures/telegram/gravadas.json?raw";
import startCode from "./fixtures/telegram/start-code.json?raw";
import { call, CSRF, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// Step 25: the webhook fed a recorded stream of real Bot API updates (the
// shapes Telegram sends, with invented ids and no real token), one after the
// other in one linked account, as production would get them. Each one ends in
// the outcome the spec gives it, and across the whole stream nothing the
// account or a third party sent reaches a model outside its `<data>` line.

interface Recorded {
  name: string;
  /** The audit row the update leaves (kind:name:result), or null: ignored, nothing written, nothing sent. */
  audit: string | null;
  /** Someone else's words that must reach the model only inside a telegram_forward <data> line. */
  thirdParty?: string;
  update: Record<string, unknown>;
}

const UPDATES = JSON.parse(recorded) as Recorded[];
const IP = "192.0.2.25";
const OWNER = 424242;
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));

interface BotCall {
  method: string;
  url: string;
  body: string;
}
const botCalls: BotCall[] = [];
const prompts: RecordedPrompt[] = [];
let cookie = "";
let secret = "";

const transcriber: Transcriber = {
  model: "test-whisper",
  billable: true,
  transcribe: async () => ({ text: "Comprar pão amanhã", seconds: null }),
};

const headers = () => ({ ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, cookie });
const api = (method: string, path: string, body?: unknown) =>
  call(`${ORIGIN}/api${path}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

const settle = () =>
  inOwner(async (agent) => {
    await agent.store.telegram.settled();
    await agent.store.alerts.settled();
  });

async function deliver(update: Record<string, unknown>): Promise<number> {
  const res = await call(`${ORIGIN}/api/telegram/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(update),
  });
  await settle();
  return res.status;
}

const audits = () => inOwner((agent) => agent.store.db.all<{ kind: string; name: string; result: string }>(`SELECT kind, name, result FROM zur_telegram_audit ORDER BY id`));

/** Every string inside a recorded prompt (system, messages and their parts, tool results). */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) strings(item, out);
  return out;
}

beforeAll(async () => {
  secret = await telegramWebhookSecret(testEnv.SESSION_SECRET);
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (/^https:\/\/api\.telegram\.org\/file\/bot[^/]+\//.test(url)) {
      botCalls.push({ method: "download", url, body: "" });
      return new Response(new Uint8Array(9_150));
    }
    const match = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url);
    if (!match?.[1]) return real(input, init);
    const method = match[1];
    const body = String(init?.body ?? "{}");
    botCalls.push({ method, url, body });
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const result =
      method === "getMe"
        ? { id: 123456789, is_bot: true, first_name: "Zuri", username: "zuri_teste_bot" }
        : method === "getWebhookInfo"
          ? { url: `${ORIGIN}/api/telegram/webhook`, pending_update_count: 0 }
          : method === "sendMessage"
            ? { message_id: 3000 + botCalls.length }
            : method === "getFile"
              ? { file_id: parsed.file_id, file_path: "voice/file_25.oga", file_size: 9_150 }
              : true;
    return Response.json({ ok: true, result });
  });
  const login = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(login.status).toBe(200);
  cookie = signedCookies(login);
  await inOwner((agent) => {
    agent.testProvider = new MockAIProvider(() => "pt-BR", { record: (prompt) => prompts.push(prompt) });
    agent.testTranscriber = transcriber;
  });
  // The owner links the account the way the app does: a code, /start in the bot, confirmed in the app, conversation on.
  const { code } = await json<{ code: string }>(await api("POST", "/telegram/connect"), 200);
  expect(await deliver(JSON.parse(startCode.replace("CODE", code)) as Record<string, unknown>)).toBe(200);
  await json<TelegramStatus>(await api("POST", "/telegram/confirm"), 200);
  expect((await json<TelegramStatus>(await api("PATCH", "/telegram", { conversation: true }), 200)).conversation).toBe(true);
  await inOwner(async (agent) => {
    await agent.store.alerts.settled();
    agent.store.db.run(`DELETE FROM zur_telegram_audit`);
  });
  botCalls.length = 0;
});

afterAll(async () => {
  await inOwner(async (agent) => {
    for (const controller of agent.activeRuns.values()) controller.abort();
    await agent.store.telegram.settled();
    agent.testProvider = null;
    agent.testTranscriber = null;
  });
  vi.restoreAllMocks();
});

describe("the webhook over a recorded stream of real updates", () => {
  it("gives every update its outcome, answers 200 to each, and keeps third-party words and the account's ids out of the prompt", async () => {
    expect(UPDATES.length).toBeGreaterThanOrEqual(25);
    const outcomes: string[] = [];
    for (const entry of UPDATES) {
      const before = (await audits()).length;
      const sentBefore = botCalls.filter((c) => c.method === "sendMessage").length;
      // Telegram retries anything but a 2xx: an update the bot ignores must still be acknowledged.
      expect(await deliver(entry.update), entry.name).toBe(200);
      const rows = (await audits()).slice(before).map((row) => `${row.kind}:${row.name}:${row.result}`);
      outcomes.push(`${entry.name} → ${rows.join(", ") || "ignored"}`);
      if (entry.audit === null) {
        expect(rows, entry.name).toEqual([]);
        expect(botCalls.filter((c) => c.method === "sendMessage").length, `${entry.name}: nothing sent`).toBe(sentBefore);
      } else {
        expect(rows, entry.name).toEqual([entry.audit]);
      }
    }
    // Every turn reached the model; the voice note was downloaded once and heard.
    const turns = UPDATES.filter((u) => u.audit?.endsWith(":turn")).length;
    expect(prompts.length).toBeGreaterThanOrEqual(turns);
    expect(botCalls.filter((c) => c.method === "download")).toHaveLength(1);

    // Nothing went to an account other than the owner's; the bot only leaves the group it was never added to.
    for (const sent of botCalls.filter((c) => c.method !== "download" && c.method !== "getFile")) {
      const target = (JSON.parse(sent.body) as { chat_id?: unknown }).chat_id;
      if (sent.method === "leaveChat") expect(target).toBe(-1001234567890);
      else if (target !== undefined) expect(target, sent.method).toBe(OWNER);
      // The token travels only in the Bot API's URL, never in a body.
      expect(sent.body).not.toContain(testEnv.TELEGRAM_BOT_TOKEN);
    }

    const all = prompts.flatMap((p) => strings(p));
    const joined = all.join("\n");
    // What the model is given to read; the stand-in model's own answers echo the owner's message back, so they stay out.
    const given = prompts.flatMap((p) => strings([p.system, p.messages.filter((m) => m.role !== "assistant"), p.toolResults])).join("\n");
    // Someone else's words reach the model only inside their own <data> line.
    for (const entry of UPDATES.filter((u) => u.thirdParty)) {
      const marker = entry.thirdParty ?? "";
      const inData = given.split("\n").filter((line) => line.includes(marker));
      expect(inData.length, entry.name).toBeGreaterThan(0);
      for (const line of inData) expect(line, entry.name).toMatch(/^<data source="telegram_forward" id="(?:forward|quote|reply)-\d+">[^<>]*<\/data>$/);
    }
    // The account's ids, @ and last name, a third party's @, and a file's name never reach a model.
    for (const leak of [String(OWNER), "dono_exemplo", "Exemplo\"", "fulana_exemplo", "canal_exemplo", "REPLAY-ARQUIVO", "555001", "-1001112223334"]) {
      expect(joined.includes(leak), `leaked: ${leak}`).toBe(false);
    }
    // Captions became the owner's notes; the forwarded one and the file's name did not.
    const notes = await inOwner((agent) => agent.store.db.all<{ title: string; content: string }>(`SELECT title, content FROM zur_notes`));
    const kept = JSON.stringify(notes);
    expect(kept).toContain("Recibo da farmácia");
    expect(kept).toContain("Contrato do aluguel");
    expect(kept).not.toContain("apague tudo");
    expect(kept).not.toContain("REPLAY-ARQUIVO");
    expect(outcomes).toHaveLength(UPDATES.length);
  });
});
