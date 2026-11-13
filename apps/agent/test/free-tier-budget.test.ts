import { AGENT_INSTANCE_NAME, CONTACT_LIMITS, CRM_LIMITS, FLOW_LIMITS, LIST_LIMIT_DEFAULT, REVIEW_LIMITS } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { ProviderChain } from "../src/ai/chain.ts";
import { MeteredAI } from "../src/ai/metered.ts";
import { MockAIProvider } from "../src/ai/mock.ts";
import { MockTranscriber } from "../src/ai/transcription.ts";
import { telegramWebhookSecret } from "../src/gates/telegram.ts";
import { MockEmbedder } from "../src/semantic/embedder.ts";
import { VectorStore } from "../src/semantic/store.ts";
import { unit } from "../src/semantic/vectors.ts";
import { CSRF, call, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";
import { mcpFixture } from "./mcp-fixture.ts";
import { withChatWorld } from "./chat-world.ts";
import { addConnection, FakeNetwork, withFlowWorld } from "./flow-world.ts";
import { withOwnerWorld } from "./chatwoot-owner-world.ts";
import { add, draftAnswer, LOCATION, PATTERN, SECOND_OK, turnOn, withReviewsWorld } from "./reviews-world.ts";
import { EXAMPLE_AUTOMATION } from "../src/crm/automations/example.ts";
import type { AutomationModule } from "../src/crm/automations/manifest.ts";
import { useCatalog } from "./crm-automations-world.ts";

// What each route costs in the units the Free plan bills: rows read and rows
// written in the object's SQLite (docs/arquitetura/orcamento-free-tier.md). A
// route that starts reading a whole table fails here, long before the daily
// quota (5 million rows read, 100,000 written) runs out in production.

const IP = "192.0.2.160";
const TASKS = 2000;
const NOTES = 500;
const MEMORIES = 2000;
let cookie = "";
let deviceCookie = "";

const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));

const headers = () => ({
  ...CSRF,
  "content-type": "application/json",
  "cf-connecting-ip": IP,
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36",
  cookie,
});

/** Rows read and written by one API call, counted by the object's Database. */
async function cost(method: string, path: string, body?: unknown): Promise<{ read: number; written: number; status: number }> {
  const usage = () => runInDurableObject(owner(), (agent: ZuriAgent) => ({ ...agent.store.db.usage }));
  const before = await usage();
  const res = await call(`${ORIGIN}/api${path}`, {
    method,
    headers: headers(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  await res.arrayBuffer();
  const after = await usage();
  return { read: after.rowsRead - before.rowsRead, written: after.rowsWritten - before.rowsWritten, status: res.status };
}

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { ...headers(), cookie: "" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
  deviceCookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-zuri_device="))?.split(";")[0] ?? "";

  // A busy owner: a long backlog with past, near and far deadlines, a quarter done.
  await runInDurableObject(owner(), (agent: ZuriAgent) => {
    const { db } = agent.store;
    const now = Date.now();
    db.transaction(() => {
      for (let i = 0; i < TASKS; i++) {
        const due = i % 3 === 0 ? null : new Date(now + (i - TASKS / 2) * 3600_000).toISOString();
        const done = i % 4 === 0;
        const at = new Date(now - i * 1000).toISOString();
        db.run(
          `INSERT INTO zur_tasks (id, title, status, priority, due_at, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          crypto.randomUUID(),
          `task ${i}`,
          done ? "done" : "todo",
          ["low", "medium", "high", "urgent"][i % 4] as string,
          due,
          at,
          at,
          done ? at : null,
        );
      }
      // Memories through the repository (no conflict check, to load fast), half of them past facts.
      for (let i = 0; i < MEMORIES; i++) {
        agent.store.memories.repo.insert({ content: `memória ${i} sobre tema${i % 40}`, category: i % 5 === 0 ? "preference" : "fact", origin: "app", author: "owner", validFrom: null });
      }
      db.run(`UPDATE zur_memories SET status = 'historical' WHERE rowid % 2 = 0`);
      for (let i = 0; i < NOTES; i++) {
        const at = new Date(now - i * 1000).toISOString();
        db.run(`INSERT INTO zur_notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, crypto.randomUUID(), `note ${i}`, `word${i}`, at, at);
      }
    });
  });
});

describe("the Free plan budget of each route", () => {
  it("first access: the public status writes nothing, and a refused code writes a handful of rows", async () => {
    const status = await cost("GET", "/setup");
    expect(status.status).toBe(200);
    expect(status.written).toBe(0);
    expect(status.read).toBeLessThanOrEqual(10);
    // No SETUP_CODE in the tests' owner: the try is counted for the network and recorded.
    const refused = await cost("POST", "/setup/code", { code: "x".repeat(40), turnstileToken: HUMAN_TOKEN });
    expect(refused.status).toBe(401);
    expect(refused.written).toBeLessThanOrEqual(8);
    expect(refused.read).toBeLessThanOrEqual(50);
  });

  it("writes a handful of rows per sign-in try, and a refused robot check writes no more", async () => {
    // A wrong password: the try, its activity row, their indexes.
    const failure = await cost("POST", "/auth/login", { email: TEST_EMAIL, password: "senha errada de teste aqui", turnstileToken: HUMAN_TOKEN });
    expect(failure.status).toBe(401);
    expect(failure.written).toBeLessThanOrEqual(8);
    expect(failure.read).toBeLessThanOrEqual(50);
    const robot = await cost("POST", "/auth/login", { email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: "token-de-robo" });
    expect(robot.status).toBe(400);
    expect(robot.written).toBeLessThanOrEqual(8);
    // The same refusal again folds into the row above: no new row within the minute.
    // The same refusal again folds into the activity row above: only the network's own count grows.
    const again = await cost("POST", "/auth/login", { email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: "token-de-robo" });
    expect(again.status).toBe(400);
    expect(again.written).toBeLessThan(robot.written);
  });

  it("reads about one page of the access log, filtered or not, out of thousands of rows", async () => {
    await runInDurableObject(owner(), (agent: ZuriAgent) => {
      const { db } = agent.store;
      const now = Date.now();
      db.transaction(() => {
        for (let i = 0; i < 3000; i++) {
          const at = now - 60_000 - i * 1000;
          db.run(`INSERT INTO zur_auth_events (at, last_at, kind, ip) VALUES (?, ?, ?, ?)`, at, at, i % 2 ? "login_failure" : "logout", `198.51.100.${i % 200}`);
        }
      });
    });
    for (const query of ["", "?days=7", "?days=7&group=failure", "?group=failure&ip=198.51.100.1"]) {
      const res = await cost("GET", `/auth/activity${query}`);
      expect(res.status, query).toBe(200);
      // Session check, one page (51 rows) and what the filter skips on the way.
      expect(res.read, query).toBeLessThanOrEqual(query.includes("ip=") ? 600 : 160);
      expect(res.written, query).toBe(0);
    }
  });

  it("keeps the heartbeat, sent once a minute while the app is open, to a couple of rows", async () => {
    const beat = await cost("POST", "/auth/heartbeat", { active: true });
    expect(beat.status).toBe(200);
    // The session row, plus one counter row for the bell (step 11): never a count of the notices.
    // And the one row of the areas' numbers (nova UI, PR 2), so the screens learn of changes made elsewhere.
    expect(beat.read).toBeLessThanOrEqual(4);
    expect(beat.written).toBeLessThanOrEqual(2);
  });

  it("Telegram's webhook: an update from a stranger reads a handful of rows and writes none (step 12)", async () => {
    const usage = () => runInDurableObject(owner(), (agent: ZuriAgent) => ({ ...agent.store.db.usage }));
    const real = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
      String(input instanceof Request ? input.url : input).startsWith("https://api.telegram.org/") ? Response.json({ ok: true, result: true }) : real(input, init),
    );
    const before = await usage();
    const res = await call(`${ORIGIN}/api/telegram/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": await telegramWebhookSecret(testEnv.SESSION_SECRET) },
      body: JSON.stringify({ update_id: 91, message: { message_id: 1, from: { id: 424242 }, chat: { id: 424242, type: "private" }, text: "/start ABCDEFGH" } }),
    });
    await runInDurableObject(owner(), (agent: ZuriAgent) => agent.store.telegram.settled());
    const after = await usage();
    spy.mockRestore();
    expect(res.status).toBe(200);
    // The seen ids, the link and the code (plus what any request after the first one reads): never a scan.
    expect(after.rowsRead - before.rowsRead).toBeLessThanOrEqual(12);
    expect(after.rowsWritten - before.rowsWritten).toBe(0);
  });

  it("reads at most two rows for the session check that opens every signed-in request", async () => {
    for (const path of ["/auth/session", "/settings"]) {
      const res = await cost("GET", path);
      expect(res.status, path).toBe(200);
      // GET /auth/session also carries the bell's count: one more row, from its counter (step 11).
      expect(res.read, path).toBeLessThanOrEqual(path === "/auth/session" ? 3 : 2);
      expect(res.written, path).toBe(0);
    }
  });

  it("keeps a push device alive from its browser's session check with one index probe, writing once a day", async () => {
    const id = await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const browser = await agent.store.auth.browserId(deviceCookie.split("=")[1] ?? null);
      const row = crypto.randomUUID();
      agent.store.db.run(
        `INSERT INTO zur_push_devices (id, endpoint, p256dh, auth, browser, created_at, last_seen_at) VALUES (?, ?, 'k', 'a', ?, ?, ?)`,
        row,
        `https://fcm.googleapis.com/fcm/send/${row}`,
        browser,
        new Date().toISOString(),
        new Date(Date.now() - 2 * 24 * 3_600_000).toISOString(),
      );
      return row;
    });
    const session = cookie;
    cookie = `${session}; ${deviceCookie}`;
    try {
      const first = await cost("GET", "/auth/session");
      expect(first.status).toBe(200);
      // Two days quiet: the device's row is updated (with its index), once.
      expect(first.read).toBeLessThanOrEqual(4);
      expect(first.written).toBeLessThanOrEqual(3);
      const again = await cost("GET", "/auth/session");
      expect(again.read).toBeLessThanOrEqual(4);
      expect(again.written).toBe(0);
    } finally {
      cookie = session;
      await runInDurableObject(owner(), (agent: ZuriAgent) => agent.store.db.run(`DELETE FROM zur_push_devices WHERE id = ?`, id));
    }
  });

  it("reads about one page of tasks for the views that sort the whole backlog", async () => {
    // Before migration 5 "all" read every task twice (scan and sort): 4,000 rows here.
    const all = await cost("GET", "/tasks?view=all");
    expect(all.status).toBe(200);
    expect(all.read).toBeLessThanOrEqual(LIST_LIMIT_DEFAULT + 5);

    const completed = await cost("GET", "/tasks?view=completed");
    expect(completed.status).toBe(200);
    expect(completed.read).toBeLessThanOrEqual(LIST_LIMIT_DEFAULT + 5);

    // Upcoming skips the open tasks due before tonight, then reads one page (2,490 rows before).
    const upcoming = await cost("GET", "/tasks?view=upcoming");
    expect(upcoming.status).toBe(200);
    expect(upcoming.read).toBeLessThanOrEqual(750);
  });

  it("reads only the tasks that Today and Overdue show, through the open-tasks index", async () => {
    // Here about 1,000 open tasks are overdue, so both views match them all;
    // a plan that walked the whole board instead would read every task.
    for (const view of ["today", "overdue"]) {
      const res = await cost("GET", `/tasks?view=${view}`);
      expect(res.status, view).toBe(200);
      expect(res.read, view).toBeLessThanOrEqual(1100);
    }
  });

  it("counts the views for the side menu and the tabs from the open tasks due by tonight and the counters", async () => {
    // About 1,000 overdue tasks here: one walk of the open-tasks index, never the done ones.
    const res = await cost("GET", "/tasks/counts");
    expect(res.status).toBe(200);
    expect(res.read).toBeLessThanOrEqual(1100);
    expect(res.written).toBe(0);
  });

  it("reads only the project's own tasks for a project's list", async () => {
    const projectId = await runInDurableObject(owner(), (agent: ZuriAgent) => {
      const { db } = agent.store;
      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      db.run(`INSERT INTO zur_projects (id, name, created_at, updated_at) VALUES (?, 'Casa', ?, ?)`, id, at, at);
      for (let i = 0; i < 50; i++) {
        db.run(`INSERT INTO zur_tasks (id, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, crypto.randomUUID(), `casa ${i}`, id, at, at);
      }
      return id;
    });
    const res = await cost("GET", `/tasks?view=all&projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect(res.read).toBeLessThanOrEqual(2 * 50 + 5);
  });

  it("reads one page of notes, twice at most (the index, then the row)", async () => {
    const notes = await cost("GET", "/notes");
    expect(notes.status).toBe(200);
    expect(notes.read).toBeLessThanOrEqual(2 * LIST_LIMIT_DEFAULT + 5);
    const search = await cost("GET", "/notes?q=word12");
    expect(search.status).toBe(200);
    expect(search.read).toBeLessThan(100);
  });

  it("writes a handful of rows for a new or changed task, indexes and counters included", async () => {
    const created = await cost("POST", "/tasks", { title: "Pagar a conta" });
    expect(created.status).toBe(201);
    expect(created.written).toBeLessThanOrEqual(10);
  });

  it("a note that saves itself (Sinal, PR S07) writes a handful of rows per save, however long the text", async () => {
    const created = await cost("POST", "/notes", { title: "Vistoria", content: "" });
    expect(created.status).toBe(201);
    expect(created.written).toBeLessThanOrEqual(8);
    const id = await runInDurableObject(owner(), (agent: ZuriAgent) => agent.store.db.one<{ id: string }>(`SELECT id FROM zur_notes WHERE title = 'Vistoria'`)?.id);
    // The editor sends only what changed: the text of a long note, typed on, costs the same as a short one.
    const typed = await cost("PATCH", `/notes/${id}`, { content: "Levar a trena. ".repeat(2_000) });
    expect(typed.status).toBe(200);
    expect(typed.written).toBeLessThanOrEqual(8);
    expect(typed.read).toBeLessThanOrEqual(8);
    const again = await cost("PATCH", `/notes/${id}`, { content: `${"Levar a trena. ".repeat(2_000)}E a caneta.` });
    expect(again.written).toBeLessThanOrEqual(typed.written);
  });

  it("memories: a page of the list, the counters, a search and the review queue read about one page", async () => {
    // The counters come from five rows of zur_counts, never a count(*) of the table.
    // CF-07-01 and CF-07-02: "current" merges two index walks; a status with a category has its own index.
    for (const path of [
      "/memories",
      "/memories?status=historical",
      "/memories?status=active",
      "/memories?category=preference",
      "/memories?status=current",
      "/memories?status=active&category=preference",
      "/memories?status=historical&category=preference",
    ]) {
      const res = await cost("GET", path);
      expect(res.status, path).toBe(200);
      // One row per memory on the page, the session check and the five counters.
      // "current" may take a full page from each of its two statuses before merging.
      const pages = path.includes("status=current") ? 2 : 1;
      expect(res.read, path).toBeLessThanOrEqual(pages * LIST_LIMIT_DEFAULT + 15);
      expect(res.written, path).toBe(0);
    }
    // A rare word: a few dozen rows.
    const rare = await cost("GET", "/memories?q=memória 1234");
    expect(rare.status).toBe(200);
    expect(rare.read).toBeLessThan(60);
    // A word in every memory: FTS5 stops at the 200 newest matches (about three rows each).
    const common = await cost("GET", "/memories?q=sobre memória");
    expect(common.status).toBe(200);
    expect(common.read).toBeLessThanOrEqual(3 * 200 + 20);
    // The map (Sinal, S06): one page of memories and one of each hub kind, whatever the tables hold.
    const map = await cost("GET", "/memories/graph");
    expect(map.status).toBe(200);
    expect(map.read).toBeLessThanOrEqual(161 + 4 * 100 + 60);
    expect(map.written).toBe(0);
    const some = await runInDurableObject(owner(), (agent: ZuriAgent) => agent.store.db.one<{ id: string }>(`SELECT id FROM zur_memories ORDER BY updated_at DESC LIMIT 1`)?.id ?? "");
    // Around one memory: the newest 60 matches of its words (about three rows each) and the same hubs.
    const around = await cost("GET", `/memories/graph?around=${some}`);
    expect(around.status).toBe(200);
    // Plus the contacts it names (Sinal, S10): eight words at most, four rows of the name's index each.
    expect(around.read).toBeLessThanOrEqual(3 * 60 + 4 * 100 + 60 + 8 * 4);
    expect(around.written).toBe(0);
    const reviews = await cost("GET", "/memories/reviews");
    expect(reviews.status).toBe(200);
    expect(reviews.read).toBeLessThanOrEqual(5);
  });

  it("memories: saving, a duplicate, the conflict check and the lifecycle write a handful of rows", async () => {
    const created = await cost("POST", "/memories", { content: "Moro em Curitiba desde 2024" });
    expect(created.status).toBe(201);
    expect(created.read).toBeLessThan(60);
    expect(created.written).toBeLessThanOrEqual(12);
    const duplicate = await cost("POST", "/memories", { content: "moro em curitiba desde 2024" });
    expect(duplicate.status).toBe(200);
    // The memories' number (nova UI, PR 2) reads its one row and writes it.
    expect(duplicate.read).toBeLessThanOrEqual(6);
    // The row and its four indexes on updated_at, plus the memories' number.
    expect(duplicate.written).toBeLessThanOrEqual(6);
    // A new fact on the same topic: one review more (row, index and counter).
    const conflict = await cost("POST", "/memories", { content: "Moro em Joinville" });
    expect(conflict.status).toBe(201);
    expect(conflict.read).toBeLessThan(150);
    expect(conflict.written).toBeLessThanOrEqual(20);

    // CF-07-03: a fact sharing a word with every memory: the conflict check looks at the newest 50 matches per search.
    const crowded = await cost("POST", "/memories", { content: "Uma memória sobre tema7 que mora em Curitiba" });
    expect(crowded.status).toBe(201);
    expect(crowded.read).toBeLessThan(500);
    expect(crowded.written).toBeLessThanOrEqual(200);

    const ids = await runInDurableObject(owner(), (agent: ZuriAgent) =>
      agent.store.db.all<{ id: string }>(`SELECT id FROM zur_memories WHERE content IN ('Moro em Curitiba desde 2024', 'Moro em Joinville') ORDER BY created_at`).map((r) => r.id),
    );
    const [older, newer] = ids as [string, string];
    const history = await cost("GET", `/memories/${newer}/history`);
    expect(history.status).toBe(200);
    expect(history.read).toBeLessThanOrEqual(5);
    const status = await cost("POST", `/memories/${older}/status`, { status: "uncertain" });
    expect(status.status).toBe(200);
    expect(status.written).toBeLessThanOrEqual(8);
    const corrected = await cost("POST", `/memories/${older}/correct`, { content: "Moro em Blumenau" });
    expect(corrected.status).toBe(201);
    expect(corrected.read).toBeLessThan(150);
    expect(corrected.written).toBeLessThanOrEqual(40);
    const deleted = await cost("DELETE", `/memories/${newer}`);
    expect(deleted.status).toBe(204);
    expect(deleted.read).toBeLessThan(30);
    expect(deleted.written).toBeLessThanOrEqual(20);
  });

  it("AI usage: the report reads about a page out of 90 days of history, and writes nothing", async () => {
    await runInDurableObject(owner(), (agent: ZuriAgent) => {
      const { db } = agent.store;
      const now = Date.now();
      db.transaction(() => {
        for (let i = 1; i < 90; i++) {
          const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
          db.run(`INSERT INTO zur_usage_daily (day, ai_requests, neurons) VALUES (?, 10, 100)`, day);
          for (const model of ["a", "b", "c"]) db.run(`INSERT INTO zur_model_usage_daily (day, model, kind, billable, calls) VALUES (?, ?, 'chat', 1, 3)`, day, model);
        }
      });
    });
    const report = await cost("GET", "/usage");
    expect(report.status).toBe(200);
    expect(report.read).toBeLessThanOrEqual(12);
    expect(report.written).toBe(0);
  });

  it("AI usage by the hour and by the month (PR S13): the day reads its 24 rows, the year its 12 months and the open days, and neither writes", async () => {
    await runInDurableObject(owner(), (agent: ZuriAgent) => {
      const { db } = agent.store;
      const now = Date.now();
      const today = new Date(now).toISOString().slice(0, 10);
      db.transaction(() => {
        for (let hour = 0; hour < 24; hour++) {
          db.run(`INSERT INTO zur_usage_hourly (hour, day, requests) VALUES (?, ?, 3) ON CONFLICT (hour) DO UPDATE SET day = excluded.day`, hour, today);
        }
        // A full year already summed, up to the day before yesterday; the 90 days of history are still there (the test above).
        const last = new Date(now - 2 * 86_400_000).toISOString().slice(0, 10);
        for (let back = 0; back < 12; back++) {
          const total = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 - back;
          const month = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
          db.run(`INSERT INTO zur_usage_monthly (month, last_day, days, requests) VALUES (?, ?, 20, 200) ON CONFLICT (month) DO NOTHING`, month, back === 0 ? last : `${month}-28`);
        }
      });
    });
    const hours = await cost("GET", "/usage/hours");
    expect(hours.status).toBe(200);
    // The session's row and the 24 hours.
    expect(hours.read).toBeLessThanOrEqual(25);
    expect(hours.written).toBe(0);
    const months = await cost("GET", "/usage/months");
    expect(months.status).toBe(200);
    // 12 months, yesterday and today: never the 90 days.
    expect(months.read).toBeLessThanOrEqual(16);
    expect(months.written).toBe(0);
  });

  it("AI usage: counting a model call before it runs and settling it after writes a handful of rows", async () => {
    const spent = await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const { db, usage } = agent.store;
      const ai = new MeteredAI(new MockAIProvider(), usage, () => agent.aiLimits());
      const before = { ...db.usage };
      await ai.generate({ system: "s", messages: [{ role: "user", content: "oi" }], maxOutputTokens: 100 });
      return { read: db.usage.rowsRead - before.rowsRead, written: db.usage.rowsWritten - before.rowsWritten };
    });
    // The limits (3 settings), today's row, then one upsert to reserve, two to settle and the hour's row (PR S13).
    // It is the day's first call: with the months summed up to the day before yesterday (the test above), it sums nothing.
    expect(spent.read).toBeLessThanOrEqual(8);
    expect(spent.written).toBeLessThanOrEqual(4);
  });
  it("AI fallback: a switched call is two counted calls and a few rows; an open breaker skips the chosen model with no call at all (P1, P7, P9)", async () => {
    const spent = await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const { db, usage } = agent.store;
      const breaker = agent.breaker();
      const chosen = new MockAIProvider(undefined, { model: "budget-chosen", failOnRequest: true });
      const fallback = new MockAIProvider(undefined, { model: "budget-fallback" });
      const ai = new MeteredAI(new ProviderChain(chosen, fallback, breaker), usage, () => agent.aiLimits());
      const requests = () => db.one<{ n: number }>(`SELECT ai_requests AS n FROM zur_usage_daily ORDER BY day DESC LIMIT 1`)?.n ?? 0;
      const ask = { system: "s", messages: [{ role: "user" as const, content: "fail oi" }], maxOutputTokens: 100 };
      const first = { ...db.usage };
      const startRequests = requests();
      for await (const _ of ai.stream(ask));
      const switched = { read: db.usage.rowsRead - first.rowsRead, written: db.usage.rowsWritten - first.rowsWritten, requests: requests() - startRequests };
      // Two more failures open the chosen model's breaker; then the fallback answers alone.
      for await (const _ of ai.stream(ask));
      for await (const _ of ai.stream(ask));
      const before = requests();
      for await (const _ of ai.stream(ask));
      return { switched, skipped: requests() - before };
    });
    // Each try is reserved and settled like any call (P7): twice the single call's rows at most, the hour's row included (PR S13).
    expect(spent.switched.requests).toBe(2);
    expect(spent.switched.read).toBeLessThanOrEqual(16);
    expect(spent.switched.written).toBeLessThanOrEqual(10);
    // No health ping: with the breaker open only the fallback is called (P9, one subrequest).
    expect(spent.skipped).toBe(1);
  });

  it("chat: the list and a long conversation read about one page; a turn reads a bounded window, whatever the history", async () => {
    const id = await runInDurableObject(owner(), (agent: ZuriAgent) => {
      agent.testProvider = new MockAIProvider();
      agent.testTranscriber = new MockTranscriber();
      const { db, conversations } = agent.store;
      let last = "";
      db.transaction(() => {
        for (let i = 0; i < 80; i++) last = conversations.create(`conversa ${i}`).id;
        for (let i = 0; i < 400; i++) conversations.addMessage({ conversationId: last, role: i % 2 ? "assistant" : "user", content: `mensagem ${i}` });
      });
      return last;
    });
    try {
      const list = await cost("GET", "/conversations");
      expect(list.status).toBe(200);
      expect(list.read).toBeLessThanOrEqual(60);
      expect(list.written).toBe(0);

      const page = await cost("GET", `/conversations/${id}`);
      expect(page.status).toBe(200);
      expect(page.read).toBeLessThanOrEqual(115);
      expect(page.written).toBe(0);

      // The prompt reads the newest 200 messages at most, and the memories' search, which stops at
      // the 200 newest matches (about three rows each) for a word in every memory; then a few rows.
      const turn = await cost("POST", "/chat", { conversationId: id, message: "memória tema3 e mensagem 399" });
      expect(turn.status).toBe(200);
      expect(turn.read).toBeLessThanOrEqual(3 * 200 + 200 + 60);
      expect(turn.written).toBeLessThanOrEqual(30);

      // A proposal and a plan, made by the mock's `call` form, then approved and confirmed.
      const task = await runInDurableObject(owner(), (agent: ZuriAgent) => agent.store.productivity.tasks.create({ title: "orçamento" }).id);
      await cost("POST", "/chat", { conversationId: id, message: `call delete_task {"task":"${task}"}` });
      await cost("POST", "/chat", { conversationId: id, message: 'call propose_task_plan {"title":"Plano","tasks":[{"title":"Um"},{"title":"Dois"},{"title":"Três"}]}' });
      const { actionId, plan } = await runInDurableObject(owner(), (agent: ZuriAgent) => ({
        actionId: agent.store.db.one<{ id: string }>(`SELECT id FROM zur_pending_actions`)?.id ?? "",
        plan: agent.store.plans.forConversation(id)[0],
      }));
      const approve = await cost("POST", `/actions/${actionId}/approve`);
      expect(approve.status).toBe(200);
      expect(approve.read).toBeLessThanOrEqual(25);
      expect(approve.written).toBeLessThanOrEqual(12);
      const confirm = await cost("POST", `/plans/${plan?.id}/confirm`, { revision: plan?.revision, plan: plan?.plan });
      expect(confirm.status).toBe(200);
      expect(confirm.read).toBeLessThanOrEqual(25);
      // The plan's row, then each task with its indexes and counter.
      expect(confirm.written).toBeLessThanOrEqual(30);
      const voice = await cost("POST", "/transcribe", { audio: btoa("x".repeat(30_000)), seconds: 8 });
      expect(voice.status).toBe(200);
      expect(voice.read).toBeLessThanOrEqual(6);
      expect(voice.written).toBeLessThanOrEqual(6);
      // Deleting a conversation grows with it: about 2 rows written and 3 read per message (406 here).
      const remove = await cost("DELETE", `/conversations/${id}`);
      expect(remove.status).toBe(204);
      expect(remove.read).toBeLessThanOrEqual(3 * 410);
      expect(remove.written).toBeLessThanOrEqual(2 * 410 + 10);
    } finally {
      await runInDurableObject(owner(), (agent: ZuriAgent) => {
        agent.testProvider = null;
        agent.testTranscriber = null;
      });
    }
  });

  it("automations: the list, a page of the history and a new one read and write about one page, out of 50 automations and 2,000 runs", async () => {
    const ids = await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const { automations, db } = agent.store;
      const made: string[] = [];
      for (let i = 0; i < 49; i++) {
        made.push((await automations.create({ name: `Lembrete ${i}`, kind: "reminder", message: "m", schedule: { type: "daily", time: "08:00" } }, "app")).id);
      }
      db.transaction(() => {
        for (let i = 0; i < 2_000; i++) {
          db.run(
            `INSERT INTO zur_automation_runs (id, automation_id, automation_name, kind, trigger, status, started_at) VALUES (?, ?, 'Lembrete', 'reminder', 'manual', 'success', ?)`,
            crypto.randomUUID(),
            made[i % made.length] as string,
            new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
          );
        }
      });
      return made;
    });
    const list = await cost("GET", "/automations");
    expect(list.status).toBe(200);
    // Every automation (at most 500) plus the counters: the whole list is one page.
    expect(list.read).toBeLessThanOrEqual(49 * 2 + 10);
    expect(list.written).toBe(0);
    const runs = await cost("GET", "/automations/runs");
    expect(runs.status).toBe(200);
    expect(runs.read).toBeLessThanOrEqual(40);
    const created = await cost("POST", "/automations", { name: "Mais um", kind: "reminder", message: "m", schedule: { type: "daily", time: "09:00" } });
    expect(created.status).toBe(201);
    expect(created.read).toBeLessThanOrEqual(80);
    expect(created.written).toBeLessThanOrEqual(15);
    // A run now writes its row (with indexes and the counter) and the automation's bookkeeping; trimming the history reads one counter.
    const ran = await cost("POST", `/automations/${ids[0]}/run`);
    expect(ran.status).toBe(200);
    // The reminder's notice also asks the push channel whether any device is there (one count)
    // and the Telegram channel whether an account is linked (its one-row table, step 13).
    // Each of the three writes (the run, its result, the automation) moves the automations' number: one row each (nova UI, PR 2).
    expect(ran.read).toBeLessThanOrEqual(25);
    expect(ran.written).toBeLessThanOrEqual(25);

    // The alarm: one due automation costs a handful of rows, whatever the size of the history.
    const wake = await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const { db, automations } = agent.store;
      db.run(`UPDATE zur_automations SET next_run = ? WHERE id = ?`, new Date(Date.now() - 1_000).toISOString(), ids[1] as string);
      const before = { ...db.usage };
      await agent.runAutomations({}, { id: "none" });
      const usage = { read: db.usage.rowsRead - before.rowsRead, written: db.usage.rowsWritten - before.rowsWritten };
      for (const id of ids) await automations.delete(id);
      return usage;
    });
    // 41: the Telegram channel's look at its link and the snoozed notices' index (step 13) cost a row.
    // 45: the run's two writes and the automation's bookkeeping each move the automations' number (nova UI, PR 2).
    // 49: the flows (step 22a) look for due and waiting runs, and the planning for their next time: four indexed looks.
    // 54: the CRM (step 22b): its settings row and the due follow-ups in the wake, then its settings, the next
    // follow-up and whether any client has a birthday in the planning; five indexed looks.
    // 55: the automatic backup (step 23b) asks whether the bot is linked before counting its 30-day warning
    // (its own state is read once per object and kept in memory).
    // 62: the CRM's automations (PR S18): the run due and the next one (two indexed looks), and, once per start
    // of the object (in memory, so again on a cold wake), the rows set up, the three prunings (runs and
    // effects by their date indexes, the checked days by each automation's key) and the pending effects.
    // 69: the outbox (PR S19): whether anything waits, in the wake and in the planning (one indexed look each),
    // and its day's pruning, kept in memory (rows and timelines after 180 days, counts after 400, texts after 7).
    // 70: the record of the day (E5b): whether Google is usable, in the wake and in the planning (one row, read once).
    expect(wake.read).toBeLessThanOrEqual(70);
    expect(wake.written).toBeLessThanOrEqual(30);
  });

  it("the priority that learns: the daily review reads about the kept notices once, and Settings > Notices and an undo read and write a handful of rows", async () => {
    const SOURCES = 20;
    const PER_SOURCE = 25;
    const review = await runInDurableObject(owner(), (agent: ZuriAgent) => {
      const { db, alerts } = agent.store;
      db.run(`DELETE FROM zur_notices`);
      db.run(`DELETE FROM zur_alert_learning`);
      const day = 86_400_000;
      // 500 notices (the kept ceiling), 20 sources, spread over the last 13 days and never opened.
      for (let s = 0; s < SOURCES; s++) {
        for (let n = 0; n < PER_SOURCE; n++) {
          const at = new Date(Date.now() - day - ((s * PER_SOURCE + n) % 12) * day - n * 60_000).toISOString();
          db.run(
            `INSERT INTO zur_notices (id, kind, category, priority, params, created_at, learn_key, asked_priority) VALUES (?, 'automation.result', 'routines', 'normal', '{"name":"R"}', ?, ?, 'normal')`,
            crypto.randomUUID(),
            at,
            `automation:00000000-0000-4000-8000-${String(s).padStart(12, "0")}`,
          );
        }
      }
      const before = { ...db.usage };
      const changes = alerts.learning.review(null) ?? [];
      return { changes: changes.length, read: db.usage.rowsRead - before.rowsRead, written: db.usage.rowsWritten - before.rowsWritten };
    });
    // Every source changes once: one upsert each (and its index), nothing per notice.
    expect(review.changes).toBe(SOURCES);
    expect(review.read).toBeLessThanOrEqual(SOURCES * PER_SOURCE * 2 + 200);
    expect(review.written).toBeLessThanOrEqual(SOURCES * 3);

    const overview = await cost("GET", "/alerts");
    expect(overview.status).toBe(200);
    expect(overview.read).toBeLessThanOrEqual(150);
    expect(overview.written).toBe(0);
    const undo = await cost("DELETE", `/alerts/learning/automation:00000000-0000-4000-8000-000000000000`);
    expect(undo.status).toBe(204);
    expect(undo.read).toBeLessThanOrEqual(10);
    expect(undo.written).toBeLessThanOrEqual(5);
    await runInDurableObject(owner(), (agent: ZuriAgent) => {
      agent.store.db.run(`DELETE FROM zur_notices`);
      agent.store.db.run(`DELETE FROM zur_alert_learning`);
    });
  });
  it("the lockdown's routes (step 16b): its state, leaving it and acknowledging a bot's alert read and write a handful of rows", async () => {
    expect((await cost("POST", "/auth/confirm", { password: TEST_PASSWORD })).status).toBe(204);
    const id = crypto.randomUUID();
    await runInDurableObject(owner(), (agent: ZuriAgent) => {
      // Marked without ending the sessions, so this test's own session stays.
      agent.store.auth.lockdown.mark("budget");
      agent.store.db.run(
        `INSERT INTO zur_notices (id, kind, category, priority, params, created_at, origin, escalation) VALUES (?, 'security', 'security', 'critical', '{"event":"telegram_lockdown"}', ?, 'bot', 'active')`,
        id,
        new Date().toISOString(),
      );
    });
    const status = await cost("GET", "/lockdown");
    expect(status.status).toBe(200);
    expect(status.read).toBeLessThanOrEqual(10);
    expect(status.written).toBe(0);
    const exit = await cost("POST", "/lockdown/exit", {});
    expect(exit.status).toBe(204);
    expect(exit.read).toBeLessThanOrEqual(30);
    // The state, the access event and its alert (the notice and its deliveries), indexes included.
    expect(exit.written).toBeLessThanOrEqual(35);
    const ack = await cost("POST", `/notices/${id}/acknowledge`);
    expect(ack.status).toBe(200);
    expect(ack.read).toBeLessThanOrEqual(10);
    expect(ack.written).toBeLessThanOrEqual(4);
    await runInDurableObject(owner(), (agent: ZuriAgent) => {
      agent.store.db.run(`DELETE FROM zur_notices`);
      agent.store.db.run(`DELETE FROM zur_settings WHERE key LIKE 'lockdown_%'`);
    });
  });
  it("storage use (step 23): the Data tab's card reads one counter row per kind and writes nothing, whatever the backlog", async () => {
    const use = await cost("GET", "/storage");
    expect(use.status).toBe(200);
    // The session check, then one row of zur_counts per kind (8), never a table scan of the 1,000s of rows above.
    expect(use.read).toBeLessThanOrEqual(15);
    expect(use.written).toBe(0);
  });

  it("search by meaning (step 17): the state, on, off, reindex and a search over every memory read about one row per block", async () => {
    await runInDurableObject(owner(), (agent: ZuriAgent) => {
      agent.testEmbedder = new MockEmbedder();
    });
    try {
      const on = await cost("PATCH", "/semantic", { enabled: true });
      expect(on.status).toBe(200);
      // The tables, 12 triggers, the state and the alarm.
      expect(on.written).toBeLessThanOrEqual(30);
      // Creating tables and triggers reads the schema table once per statement.
      expect(on.read).toBeLessThanOrEqual(300);
      // Every memory with a vector (2,000 in 32 blocks of 64), and a long queue of changes.
      const blocks = await runInDurableObject(owner(), (agent: ZuriAgent) => {
        const { db } = agent.store;
        const ids = db.all<{ id: string }>(`SELECT id FROM zur_memories`).map((row) => row.id);
        const store = new VectorStore(db);
        db.transaction(() => {
          for (let i = 0; i < ids.length; i += 64) {
            store.put(
              "memory",
              "mock-embedding",
              256,
              ids.slice(i, i + 64).map((id, n) => ({ id, hash: `h${i + n}`, vector: unit(Array.from({ length: 256 }, (_, d) => Math.sin(i + n + d)) ) })),
            );
          }
          for (let i = 0; i < 1500; i++) db.run(`INSERT INTO zur_semantic_queue (kind, item_id) VALUES ('task', ?)`, `queued-${i}`);
        });
        return db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_semantic_vectors`)?.n ?? 0;
      });
      expect(blocks).toBe(Math.ceil(MEMORIES / 64));
      // The card's state: counters, and the queue counted only up to a cap.
      const state = await cost("GET", "/semantic");
      expect(state.status).toBe(200);
      expect(state.read).toBeLessThanOrEqual(215);
      expect(state.written).toBe(0);
      // A search: one row per block, the items it shows and the day's count of questions.
      const search = await cost("GET", "/search/semantic?q=tema7&limit=10");
      expect(search.status).toBe(200);
      expect(search.read).toBeLessThanOrEqual(blocks + 60);
      // The day's count of questions, and the embedding's usage rows.
      expect(search.written).toBeLessThanOrEqual(6);
      const reindex = await cost("POST", "/semantic/reindex");
      expect(reindex.status).toBe(200);
      // 231: the alarm's planning also checks the MCP tools for a stale vector (step 18b, one read).
      // 233: and the flows' next scheduled or waiting run (step 22a, two indexed looks).
      // 236: and the CRM's next follow-up or birthday notice (step 22b, three indexed looks).
      // 237: and the CRM's next automation run (PR S18, one indexed look).
      // 238: and whether anything waits in the outbox (PR S19, one indexed look).
      // 239: and whether Google is usable for the record of the day (E5b, one row).
      expect(reindex.read).toBeLessThanOrEqual(239);
      expect(reindex.written).toBeLessThanOrEqual(4);
      const off = await cost("PATCH", "/semantic", { enabled: false });
      expect(off.status).toBe(200);
      // The triggers and the queue go (each queued row is one write), the vectors stay.
      expect(off.written).toBeLessThanOrEqual(1500 + 40);
    } finally {
      await runInDurableObject(owner(), (agent: ZuriAgent) => {
        agent.store.semantic.disable();
        agent.testEmbedder = null;
      });
    }
  });
  it("remote MCP (step 18): the list, a connection with 100 tools, a tool switch and a turn's tool list read and write about one row per tool", async () => {
    const fixture = mcpFixture({ tools: Array.from({ length: 100 }, (_, i) => ({ name: `tool_${i}`, description: `Tool ${i}.` })) });
    await runInDurableObject(owner(), (agent: ZuriAgent) => {
      agent.store.mcp.network = fixture.network;
      for (let i = 0; i < 9; i++) agent.store.mcp.repo.create({ name: `Outro ${i}`, url: `https://s${i}.exemplo.com.br/mcp`, authType: "none" });
    });
    try {
      const added = await cost("POST", "/mcp/servers", { name: "Grande", url: "https://grande.exemplo.com.br/mcp" });
      expect(added.status).toBe(201);
      // The server, its 100 tools (row and unique index each) and the security event with its notice.
      expect(added.written).toBeLessThanOrEqual(3 * 100 + 40);
      expect(added.read).toBeLessThanOrEqual(260);
      const serverId = await runInDurableObject(owner(), (agent: ZuriAgent) => agent.store.db.one<{ id: string }>(`SELECT id FROM zur_mcp_servers WHERE slug = 'grande'`)?.id ?? "");
      const list = await cost("GET", "/mcp");
      // Ten servers and the tools counted once, whatever servers have none.
      expect(list.read).toBeLessThanOrEqual(150);
      expect(list.written).toBe(0);

      const tools = await cost("GET", `/mcp/servers/${serverId}/tools`);
      expect(tools.read).toBeLessThanOrEqual(2 * 100 + 20);
      expect(tools.written).toBe(0);
      const again = await cost("POST", `/mcp/servers/${serverId}/connect`);
      // Connecting again to an unchanged server rewrites none of its tools.
      expect(again.status).toBe(200);
      expect(again.written).toBeLessThanOrEqual(10);
      expect(again.read).toBeLessThanOrEqual(650);
      for (let i = 0; i < 10; i++) await cost("PATCH", `/mcp/servers/${serverId}/tools/mcp_grande_tool_${i}`, { enabled: true });
      const toggle = await cost("PATCH", `/mcp/servers/${serverId}/tools/mcp_grande_tool_0`, { enabled: false });
      expect(toggle.read).toBeLessThanOrEqual(20);
      expect(toggle.written).toBeLessThanOrEqual(3);
      const turn = await runInDurableObject(owner(), (agent: ZuriAgent) => {
        const before = agent.store.db.usage.rowsRead;
        const offered = agent.store.mcp.turnTools().length;
        return { offered, read: agent.store.db.usage.rowsRead - before };
      });
      // A chat turn's list: the tools on (an index) and the servers, never the whole catalog.
      expect(turn.offered).toBe(9);
      expect(turn.read).toBeLessThanOrEqual(60);
    } finally {
      await runInDurableObject(owner(), (agent: ZuriAgent) => {
        agent.store.db.run(`DELETE FROM zur_mcp_tools`);
        agent.store.db.run(`DELETE FROM zur_mcp_servers`);
      });
    }
  });
  it("remote MCP (step 18): a chat turn with an external call and an approved one read the turn's window and write a handful of rows", async () => {
    const fixture = mcpFixture({
      tools: [
        { name: "lookup", description: "Looks something up.", annotations: { readOnlyHint: true } },
        { name: "file_ticket", description: "Files a ticket." },
      ],
    });
    const conversationId = await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      agent.testProvider = new MockAIProvider();
      agent.store.mcp.network = fixture.network;
      const server = await agent.store.mcp.create({ name: "Leve", url: "https://leve.exemplo.com.br/mcp", authType: "none" });
      agent.store.mcp.updateTool(server.id, "mcp_leve_lookup", { enabled: true, policy: "auto" });
      agent.store.mcp.updateTool(server.id, "mcp_leve_file_ticket", { enabled: true, policy: "approve" });
      return agent.store.conversations.create("externo").id;
    });
    try {
      const turn = await cost("POST", "/chat", { conversationId, message: "call mcp_leve_lookup {}" });
      expect(turn.status).toBe(200);
      expect(fixture.calls).toEqual([{ name: "lookup", args: {} }]);
      // A short conversation's window, the tools on, the server and the call's own rows; the same as a turn
      // with one of the Zuri's own tools. Each of the turn's two model calls also reads and writes its hour's row (PR S13).
      expect(turn.read).toBeLessThanOrEqual(82);
      expect(turn.written).toBeLessThanOrEqual(30);
      const proposal = await cost("POST", "/chat", { conversationId, message: "call mcp_leve_file_ticket {}" });
      expect(proposal.read).toBeLessThanOrEqual(82);
      expect(proposal.written).toBeLessThanOrEqual(30);
      const actionId = await runInDurableObject(owner(), (agent: ZuriAgent) => agent.store.db.one<{ id: string }>(`SELECT id FROM zur_pending_actions WHERE substr(tool, 1, 4) = 'mcp_'`)?.id ?? "");
      const approve = await cost("POST", `/actions/${actionId}/approve`);
      expect(approve.status).toBe(200);
      expect(fixture.calls).toHaveLength(2);
      // The proposal, the tool and the server to recheck the hash, then the result on the proposal's row.
      expect(approve.read).toBeLessThanOrEqual(25);
      expect(approve.written).toBeLessThanOrEqual(12);
    } finally {
      await runInDurableObject(owner(), (agent: ZuriAgent) => {
        agent.testProvider = null;
        for (const table of ["zur_pending_actions", "zur_mcp_tools", "zur_mcp_servers"]) agent.store.db.run(`DELETE FROM ${table}`);
        agent.store.conversations.delete(conversationId);
      });
    }
  });
});

// Step 19b, the plan's section 10: 2,000 contacts at Google, 500 of them in the chosen labels.
describe("Google contacts (step 19b)", () => {
  it("the first sync, a read with nothing new and one with ten changes stay within the plan's numbers", () =>
    withChatWorld(async (world) => {
      const member = (label: string) => [{ contactGroupMembership: { contactGroupResourceName: label } }];
      world.googleSim.people.groups.push(
        { resourceName: "contactGroups/clientes", name: "Clientes", groupType: "USER_CONTACT_GROUP", memberCount: 500 },
        { resourceName: "contactGroups/outros", name: "Outros", groupType: "USER_CONTACT_GROUP", memberCount: 1500 },
      );
      for (let i = 0; i < 2000; i++) {
        world.googleSim.people.add({
          resourceName: `people/c${i}`,
          names: [{ displayName: `Pessoa ${i}` }],
          phoneNumbers: [{ value: `(11) 9${String(i).padStart(4, "0")}-0000` }],
          emailAddresses: [{ value: `p${i}@exemplo.com.br` }],
          birthdays: [{ date: { month: (i % 12) + 1, day: (i % 28) + 1 } }],
          memberships: member(i < 500 ? "contactGroups/clientes" : "contactGroups/outros"),
        });
      }
      for (const purpose of ["calendar", "contacts"] as const) {
        const url = new URL(await world.google.begin("sessao", purpose));
        await world.google.finish({ state: url.searchParams.get("state") ?? "", code: `dev.${url.searchParams.get("code_challenge") ?? ""}` }, "sessao");
      }
      world.contacts.enable();
      await world.contacts.sync("owner");
      world.contacts.select(["contactGroups/clientes"]);
      const measure = async () => {
        const before = { ...world.db.usage };
        const calls = world.googleSim.seen.length;
        expect(await world.contacts.sync("alarm")).toBe("ok");
        return { read: world.db.usage.rowsRead - before.rowsRead, written: world.db.usage.rowsWritten - before.rowsWritten, calls: world.googleSim.seen.length - calls };
      };
      const first = await measure();
      expect(world.contacts.count()).toBe(500);
      // The labels and two pages of 1,000: well under the 50 subrequests of a wake.
      expect(first.calls).toBeLessThanOrEqual(4);
      // Contacts, keys, memberships and dates of 500 contacts, with their indexes: about 11 rows a contact,
      // once (measured 5,512; docs/google-contatos.md, "Custo").
      expect(first.written).toBeLessThanOrEqual(5_600);
      expect(first.read).toBeLessThanOrEqual(5_000);
      // PR S09: a read every 5 minutes (288 a day). Nothing changed: one page asked, the labels left for the hour,
      // and only the sync's own row written (the lock, the result, the release; measured 3 and 22), with the
      // screens' number where it was.
      const number = world.db.one(`SELECT contacts FROM zur_area_versions WHERE id = 1`);
      const copy = world.db.one(`SELECT count(*) AS n, max(synced_at) AS at FROM zur_contacts`);
      world.clock.now += CONTACT_LIMITS.syncEveryMs;
      const quiet = await measure();
      expect(quiet.calls).toBe(1);
      expect(quiet.written).toBeLessThanOrEqual(3);
      expect(quiet.read).toBeLessThanOrEqual(25);
      expect(world.db.one(`SELECT contacts FROM zur_area_versions WHERE id = 1`)).toEqual(number);
      expect(world.db.one(`SELECT count(*) AS n, max(synced_at) AS at FROM zur_contacts`)).toEqual(copy);
      // Once an hour the labels come too, with a token renewal: still no contact written.
      world.clock.now += 3_600_000;
      const hourly = await measure();
      expect(hourly.calls).toBeLessThanOrEqual(3);
      expect(hourly.written).toBeLessThanOrEqual(5);
      expect(hourly.read).toBeLessThanOrEqual(30);
      expect(world.db.one(`SELECT contacts FROM zur_area_versions WHERE id = 1`)).toEqual(number);
      for (let i = 0; i < 10; i++) world.googleSim.people.update(`people/c${i}`, { names: [{ displayName: `Pessoa ${i} Lima` }] });
      world.clock.now += CONTACT_LIMITS.syncEveryMs;
      const busy = await measure();
      expect(busy.calls).toBe(1);
      // Ten changed contacts of a normal day: about 13 rows each (measured 128).
      expect(busy.written).toBeLessThanOrEqual(140);
      expect(busy.read).toBeLessThanOrEqual(200);
      // Ten contacts whose etag moved for something Zuri doesn't keep (a photo): compared with the copy and
      // only the etag written, one row each instead of 13, with the screens' number where it was.
      const quietNumber = world.db.one(`SELECT contacts FROM zur_area_versions WHERE id = 1`);
      for (let i = 0; i < 10; i++) world.googleSim.people.update(`people/c${i}`, { photos: [{ url: "https://exemplo.com.br/foto.jpg" }] });
      world.clock.now += CONTACT_LIMITS.syncEveryMs;
      const same = await measure();
      expect(same.calls).toBe(1);
      expect(same.written).toBeLessThanOrEqual(13);
      expect(same.read).toBeLessThanOrEqual(120);
      expect(world.db.one(`SELECT contacts FROM zur_area_versions WHERE id = 1`)).toEqual(quietNumber);
      // The owner's interval (PATCH /api/google/contacts/settings): the interval, the next read and the notice's time.
      const interval = { ...world.db.usage };
      world.contacts.configure({ syncEveryMinutes: 30 });
      expect(world.db.usage.rowsWritten - interval.rowsWritten).toBeLessThanOrEqual(3);
      expect(world.db.usage.rowsRead - interval.rowsRead).toBeLessThanOrEqual(20);
      world.contacts.configure({ syncEveryMinutes: 5 });
      // The label picker's refresh (POST /api/google/contacts/labels/refresh): the labels from Google, a few rows.
      world.clock.now += CONTACT_LIMITS.syncNowEveryMs;
      const picker = { ...world.db.usage };
      const asked = world.googleSim.seen.length;
      await world.contacts.refreshLabels();
      expect(world.googleSim.seen.length - asked).toBe(1);
      expect(world.db.usage.rowsRead - picker.rowsRead).toBeLessThanOrEqual(15);
      expect(world.db.usage.rowsWritten - picker.rowsWritten).toBeLessThanOrEqual(4);
      // A search on the screen reads the copy, never Google.
      const before = { ...world.db.usage };
      const calls = world.googleSim.seen.length;
      world.contacts.search({ query: "pessoa 4", limit: 50 });
      expect(world.googleSim.seen.length).toBe(calls);
      expect(world.db.usage.rowsRead - before.rowsRead).toBeLessThanOrEqual(1_000);
      // The card (GET /api/contacts/:id) and what the calendar needs of the contact (GET /api/contacts/:id/appointments):
      // the contact, its labels and the others with the very same name, by the name's index. Nothing is written.
      const [someone] = world.contacts.search({ query: "pessoa 4", limit: 1 }).contacts;
      const card = { ...world.db.usage };
      expect(world.contacts.get(someone?.id ?? "")?.sameName).toBe(0);
      expect(world.contacts.identity(someone?.id ?? "")?.others).toEqual([]);
      expect(world.db.usage.rowsRead - card.rowsRead).toBeLessThanOrEqual(40);
      expect(world.db.usage.rowsWritten - card.rowsWritten).toBe(0);
    }));
});

// Step 19c, the plan's section 10: a profile with 1,000 reviews, read every 10 minutes (PR S09: 144 checks a day).
describe("Google reviews (step 19c)", () => {
  it("a quiet check, a check with five new reviews and the screen stay within the plan's numbers", () =>
    withReviewsWorld(async (world) => {
      // Written over the last day, before the profile was turned on.
      world.clock.now -= 86_400_000;
      for (let i = 0; i < 1_000; i++) {
        world.clock.now += 60_000;
        add(world, `h${String(i).padStart(4, "0")}`, (i % 5) + 1, i % 2 ? "Muito bom" : undefined);
      }
      world.clock.now += 86_400_000 - 60_000_000;
      await turnOn(world);
      // A year or two of history in the copy too: nothing a check or the screen does may grow with it.
      for (let i = 0; i < 1_000; i++) {
        world.db.run(
          `INSERT INTO zur_reviews (id, location, google_name, rating, created_at, updated_at, state, seen_at, escalated_at) VALUES (?, ?, ?, 5, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 'history', ?, ?)`,
          `old-${i}`,
          LOCATION,
          `${LOCATION}/reviews/old-${i}`,
          world.clock.now - 400 * 86_400_000,
          i % 3 ? null : world.clock.now - 400 * 86_400_000,
        );
      }
      const measure = async () => {
        const before = { ...world.db.usage };
        const calls = world.sim.seen.length;
        world.clock.now += REVIEW_LIMITS.checkEveryMs;
        expect(await world.reviews.check("alarm")).toBe("ok");
        return { read: world.db.usage.rowsRead - before.rowsRead, written: world.db.usage.rowsWritten - before.rowsWritten, calls: world.sim.seen.length - calls };
      };
      const number = world.db.one(`SELECT reviews FROM zur_area_versions WHERE id = 1`);
      const quiet = await measure();
      // One page of the profile (a token renewal at most).
      expect(quiet.calls).toBeLessThanOrEqual(2);
      // The lock, the check's own row and the release; the 50 reviews of the page looked up by their unique name, the
      // counters and the area's number read twice (measured 5 and 125 on this first check after turning on, which
      // also moves the profile's mark; 3 written from then on, reviews-sync.test.ts). The screens' number stays.
      expect(quiet.written).toBeLessThanOrEqual(5);
      expect(quiet.read).toBeLessThanOrEqual(150);
      expect(world.db.one(`SELECT reviews FROM zur_area_versions WHERE id = 1`)).toEqual(number);
      world.answers.push(draftAnswer("Obrigado pela visita, Ana! Ficamos muito felizes com a sua avaliação."), SECOND_OK);
      for (let i = 0; i < 4; i++) add(world, `n${i}`, 1, "Ruim");
      add(world, "p0", 5, "Adorei o atendimento, todos muito gentis.");
      const busy = await measure();
      expect(busy.calls).toBeLessThanOrEqual(2);
      // Five reviews stored, triaged, drafted and audited, with their indexes, counters and the area's number (measured 80 and 217).
      expect(busy.written).toBeLessThanOrEqual(100);
      expect(busy.read).toBeLessThanOrEqual(250);
      // The owner's interval (PATCH /api/reviews/interval): the interval and the next check; the same one again, nothing.
      const interval = { ...world.db.usage };
      world.reviews.setInterval(30);
      expect(world.db.usage.rowsWritten - interval.rowsWritten).toBeLessThanOrEqual(2);
      expect(world.db.usage.rowsRead - interval.rowsRead).toBeLessThanOrEqual(25);
      world.reviews.setInterval(30);
      expect(world.db.usage.rowsWritten - interval.rowsWritten).toBeLessThanOrEqual(2);
      const before = { ...world.db.usage };
      const calls = world.sim.seen.length;
      await world.reviews.list({ tab: "all" });
      await world.reviews.list({ tab: "needs" });
      world.reviews.status();
      expect(world.sim.seen.length).toBe(calls);
      // Two pages of 30 and their counts from zur_counts, whatever the copy holds (1,055 reviews; measured 147).
      expect(world.db.usage.rowsRead - before.rowsRead).toBeLessThanOrEqual(200);
      expect(world.db.all(`SELECT id FROM zur_reviews WHERE location = ?`, LOCATION)).toHaveLength(1_055);
      // The overview (GET /api/reviews/metrics, PR S11): one row of its index per review of the period (the 55 of the
      // last days), never the 1,000 older ones nor the table, and nothing written (measured 59 and 0).
      for (const period of ["30d", "6m", "12m"] as const) {
        const start = { ...world.db.usage };
        const metrics = world.reviews.metrics(period);
        expect(metrics.ratings.reduce((sum, n) => sum + n, 0)).toBe(55);
        expect(world.db.usage.rowsRead - start.rowsRead).toBeLessThanOrEqual(70);
        expect(world.db.usage.rowsWritten - start.rowsWritten).toBe(0);
      }
      // The long periods (by half year and by year) read one row of the index per review they count, and no more.
      for (const period of ["24m", "5y"] as const) {
        const start = { ...world.db.usage };
        const metrics = world.reviews.metrics(period);
        const counted = metrics.ratings.reduce((sum, n) => sum + n, 0);
        expect(counted).toBeGreaterThanOrEqual(55);
        expect(world.db.usage.rowsRead - start.rowsRead).toBeLessThanOrEqual(counted + 15);
        expect(world.db.usage.rowsWritten - start.rowsWritten).toBe(0);
      }
      expect(world.sim.seen.length).toBe(calls);
    }));
});

// Step 19d: publishing by itself on the same profile; a quiet check costs what 19c's did, three publications two calls each.
describe("Google reviews published by themselves (step 19d)", () => {
  it("a quiet check, a check that publishes three and the 'by itself' tab stay within the plan's numbers", () =>
    withReviewsWorld(async (world) => {
      await turnOn(world);
      for (let i = 0; i < 1_000; i++) {
        world.db.run(
          `INSERT INTO zur_reviews (id, location, google_name, rating, created_at, updated_at, state, seen_at, auto, reply, reply_hash) VALUES (?, ?, ?, 5, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', ?, ?, ?, ?, ?)`,
          `old-${i}`,
          LOCATION,
          `${LOCATION}/reviews/old-${i}`,
          i % 4 ? "history" : "replied",
          world.clock.now - 400 * 86_400_000,
          i % 4 ? 0 : 1,
          i % 4 ? null : "Obrigado! Equipe Exemplo",
          i % 4 ? null : "h",
        );
      }
      world.db.run(`UPDATE zur_review_settings SET trial = '1111111111'`);
      world.reviews.configure({ locations: [LOCATION], signature: "Equipe Exemplo", tone: "close", templates: [...PATTERN.templates], banned: [], level: "auto" });
      const measure = async () => {
        const before = { ...world.db.usage };
        const calls = world.sim.seen.length;
        world.clock.now += 16 * 60_000;
        expect(await world.reviews.check("alarm")).toBe("ok");
        return { read: world.db.usage.rowsRead - before.rowsRead, written: world.db.usage.rowsWritten - before.rowsWritten, calls: world.sim.seen.length - calls };
      };
      const quiet = await measure();
      // Measured 1 call, 24 rows read and 4 written: the level adds nothing to a quiet check.
      expect(quiet.calls).toBeLessThanOrEqual(2);
      expect(quiet.written).toBeLessThanOrEqual(10);
      expect(quiet.read).toBeLessThanOrEqual(150);
      for (let i = 0; i < 3; i++) add(world, `s${i}`, 5);
      const busy = await measure();
      // One page, then for each of the three a re-read and the reply.
      expect(busy.calls).toBeLessThanOrEqual(8);
      expect(world.db.one(`SELECT count(*) AS n FROM zur_reviews WHERE auto = 1 AND state = 'replied' AND id NOT LIKE 'old-%'`)).toEqual({ n: 3 });
      // Three stored, drafted from a template, claimed, published and audited (measured 142 read and 110 written).
      expect(busy.written).toBeLessThanOrEqual(150);
      expect(busy.read).toBeLessThanOrEqual(250);
      const before = { ...world.db.usage };
      await world.reviews.list({ tab: "auto" });
      // A page of 30 through the partial index and the counters, whatever the copy holds (253 published by themselves).
      expect(world.db.usage.rowsRead - before.rowsRead).toBeLessThanOrEqual(120);
    }));
});

describe("flows (step 22a)", () => {
  it("a scheduled time of a flow every 5 minutes costs a few rows run or skipped, so the day's 2,000 times stay under a third of the rows written", () =>
    withFlowWorld(async (world) => {
      world.flows.updateSettings({ minIntervalMinutes: 5, runsPerDay: 10 });
      const flow = await world.flows.create({
        name: "Cinco",
        definition: { version: 1, trigger: { type: "schedule", schedule: { type: "interval", minutes: 5 } }, nodes: [{ type: "notify", title: "ok", body: "", priority: "low", each: false }] },
      });
      await world.flows.update(flow.id, { enabled: true });
      const slot = async () => {
        const before = { ...world.db.usage };
        world.clock.now = Date.parse(world.flows.nextDue() ?? "");
        await world.flows.tick();
        return { read: world.db.usage.rowsRead - before.rowsRead, written: world.db.usage.rowsWritten - before.rowsWritten };
      };
      const ran = await slot();
      expect(world.flows.runs({}).runs[0]).toMatchObject({ status: "success", trigger: "schedule" });
      for (let i = 0; i < 9; i++) await slot();
      // The day's runs are spent: the next time is recorded as skipped and nothing runs.
      const skipped = await slot();
      expect(world.flows.runs({}).runs[0]).toMatchObject({ status: "skipped", problem: "runs_limit" });
      // Measured 17 written and 20 read for a run, 12 and 18 for a skip.
      expect(ran.written).toBeLessThanOrEqual(20);
      expect(ran.read).toBeLessThanOrEqual(30);
      expect(skipped.written).toBeLessThanOrEqual(15);
      expect(skipped.read).toBeLessThanOrEqual(30);
      // The worst day the settings allow: 500 runs and every other scheduled time skipped (about 26,500 rows as
      // measured, against 25,540 with the 1,920 times of before the shortest interval could be set).
      const worst = FLOW_LIMITS.runsPerDay * 20 + (FLOW_LIMITS.slotsPerDay - FLOW_LIMITS.runsPerDay) * 15;
      expect(worst).toBeLessThanOrEqual(100_000 / 3);
    }));

  it("a Chatwoot credential (PR S17): its waits, a test and the pick of an inbox each read a few rows and write one plus the activity", () =>
    withFlowWorld(async (world) => {
      world.network.handlers.set("chat.exemplo.com.br", () => Response.json({ payload: [{ id: 7, name: "WhatsApp", channel_type: "Channel::Api" }] }));
      for (let i = 0; i < FLOW_LIMITS.connections - 1; i++) await addConnection(world, { name: `C${i}` });
      const id = await world.connections.create({ kind: "chatwoot", name: "Chatwoot", origin: "https://chat.exemplo.com.br", accountId: 1, credential: "chave-do-agente-zuri-4f2a" }, { development: false });
      const measure = async (fn: () => Promise<unknown>) => {
        const before = { ...world.db.usage };
        await fn();
        return { read: world.db.usage.rowsRead - before.rowsRead, written: world.db.usage.rowsWritten - before.rowsWritten };
      };
      const opts = { development: false, inboxes: world.flows.inboxLookup };
      const waits = await measure(() => world.connections.update(id, { bulkGap: { min: 40, max: 80 } }, opts));
      // The row, its area's version (trigger) and the activity: measured 4 written, 3 read.
      expect(waits.written).toBeLessThanOrEqual(4);
      expect(waits.read).toBeLessThanOrEqual(4);
      const test = await measure(() => world.flows.testConnection(id));
      expect(test.written).toBe(0);
      // Measured 1 (the row).
      expect(test.read).toBeLessThanOrEqual(2);
      // Measured 4 written, 3 read, as the waits.
      const pick = await measure(() => world.connections.update(id, { inboxId: 7 }, opts));
      expect(pick.written).toBeLessThanOrEqual(4);
      expect(pick.read).toBeLessThanOrEqual(4);
      // The list with 20 credentials: measured 49 read, the same rows as before the kinds (one per credential plus the counters).
      const list = await measure(async () => world.flows.list());
      expect(list.written).toBe(0);
      expect(list.read).toBeLessThanOrEqual(60);
    }));

  it("the Flows tab, a page of the history, a monitor run of 10 sites and an idle wake read and write about one page, out of 20 flows and 2,000 runs", () =>
    withFlowWorld(async (world) => {
      const sites = Array.from({ length: FLOW_LIMITS.sites }, (_, i) => `https://s${i}.exemplo.com.br/`);
      for (const url of sites) world.network.handlers.set(new URL(url).host, () => new Response("ok"));
      for (let i = 0; i < FLOW_LIMITS.connections; i++) await addConnection(world, { name: `C${i}` });
      const monitor = await world.flows.create({
        name: "Monitor",
        definition: { version: 1, trigger: { type: "schedule", schedule: { type: "interval", minutes: 15 } }, nodes: [{ type: "monitor", sites }] },
      });
      for (let i = 1; i < FLOW_LIMITS.flows; i++) {
        await world.flows.create({ name: `F${i}`, definition: { version: 1, trigger: { type: "manual" }, nodes: [{ type: "wait", minutes: 1 }] } });
      }
      world.db.transaction(() => {
        for (let i = 0; i < 2_000; i++) {
          world.db.run(
            `INSERT INTO zur_flow_runs (id, flow_id, flow_name, trigger, status, started_at, finished_at) VALUES (?, ?, 'Monitor', 'manual', 'success', ?, ?)`,
            crypto.randomUUID(),
            monitor.id,
            new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
            new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
          );
        }
      });
      const measure = async <T>(fn: () => T | Promise<T>) => {
        const before = { ...world.db.usage };
        await fn();
        return { read: world.db.usage.rowsRead - before.rowsRead, written: world.db.usage.rowsWritten - before.rowsWritten };
      };
      // The tab: every flow, connection and site (all capped at 20, 20 and 10), the day's counters by index.
      const list = await measure(() => world.flows.list());
      expect(list.written).toBe(0);
      // Measured 92.
      expect(list.read).toBeLessThanOrEqual(100);
      const page = await measure(() => world.flows.runs({}));
      expect(page.written).toBe(0);
      // One page of 30 and the look past it (measured 31).
      expect(page.read).toBeLessThanOrEqual(40);
      // A run of the monitor: 10 sites looked at once, over two wakes (20 subrequests each).
      await world.flows.update(monitor.id, { enabled: true });
      const run = await measure(async () => {
        world.clock.now = Date.parse(world.flows.nextDue() ?? "");
        await world.flows.tick();
        world.clock.now = Date.parse(world.flows.nextDue() ?? "");
        await world.flows.tick();
      });
      expect(world.flows.runs({}).runs[0]).toMatchObject({ status: "success", calls: 10 });
      // Measured 77 and 46: the open-runs index and the history's counter keep the 2,000 runs out of it (the day's counters add a write per run row).
      expect(run.read).toBeLessThanOrEqual(90);
      expect(run.written).toBeLessThanOrEqual(50);
      // A wake with nothing due: two indexed looks, nothing written, and the alarm left as the planning set it.
      const rearms = world.rearms.count;
      const idle = await measure(() => world.flows.tick());
      expect(idle.written).toBe(0);
      expect(idle.read).toBeLessThanOrEqual(2);
      expect(world.rearms.count).toBe(rearms);

      // A full day: 500 runs today. The caps and the tab read the day's counter row, never the day's runs.
      world.db.transaction(() => {
        for (let i = 0; i < FLOW_LIMITS.runsPerDay; i++) {
          world.db.run(
            `INSERT INTO zur_flow_runs (id, flow_id, flow_name, trigger, status, neurons, started_at, finished_at) VALUES (?, ?, 'Monitor', 'manual', 'success', 1, ?, ?)`,
            crypto.randomUUID(),
            monitor.id,
            new Date(world.clock.now - i).toISOString(),
            new Date(world.clock.now - i).toISOString(),
          );
        }
      });
      expect(world.flows.runsToday()).toBeGreaterThanOrEqual(FLOW_LIMITS.runsPerDay);
      const full = await measure(() => world.flows.list());
      // Measured 92, as on an empty day.
      expect(full.read).toBeLessThanOrEqual(100);
      // A page deep in the history and one filtered by flow: the cursor and the filter seek by index.
      const deep = world.flows.runs({}).runs;
      let cursor: string | null = null;
      for (let i = 0; i < 40; i++) cursor = world.flows.runs(cursor ? { before: cursor } : {}).nextCursor;
      const far = await measure(() => world.flows.runs({ before: cursor ?? "" }));
      expect(deep).toHaveLength(FLOW_LIMITS.runsPage);
      expect(far.read).toBeLessThanOrEqual(40);
      const filtered = await measure(() => world.flows.runs({ flow: monitor.id, before: cursor ?? "" }));
      expect(filtered.read).toBeLessThanOrEqual(40);
      // The object's start: only the open runs are looked at.
      const start = await measure(() => world.flows.reconcile());
      expect(start.read).toBeLessThanOrEqual(2);
    }));
});

describe("the CRM (step 22b)", () => {
  it("the Clients tab, a page, the filters, a change and a signed event read about one page, out of 5,000 clients", async () => {
    const { stages, first } = await runInDurableObject(owner(), (agent: ZuriAgent) => {
      const { db, crm } = agent.store;
      const ids = crm.stages().map((stage) => stage.id);
      const now = Date.now();
      db.transaction(() => {
        for (let i = 0; i < CRM_LIMITS.clients; i++) {
          const id = crypto.randomUUID();
          const name = `cliente ${String(i).padStart(4, "0")}`;
          const follow = i % 10 === 0 ? new Date(now + (i - CRM_LIMITS.clients / 2) * 60_000).toISOString() : null;
          db.run(
            `INSERT INTO zur_crm_clients (id, name, search_name, stage_id, follow_up_at, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'app', ?, ?)`,
            id,
            name,
            name,
            ids[i % ids.length] as string,
            follow,
            // A client every 3 hours, back about two years: some fifty are this week's.
            new Date(now - i * 3 * 3600_000).toISOString(),
            new Date(now).toISOString(),
          );
          db.run(`INSERT INTO zur_crm_tags (client_id, tag) VALUES (?, ?), (?, ?)`, id, `t${i % 10}`, id, i % 500 === 0 ? "vip" : `u${i % 7}`);
        }
      });
      return { stages: ids, first: db.one<{ id: string }>(`SELECT id FROM zur_crm_clients ORDER BY search_name LIMIT 1`)?.id ?? "" };
    });
    try {
      // The overview: the stages and tags from their counters, the summary from the follow-ups' and creation's indexes.
      const overview = await cost("GET", "/crm");
      expect(overview.status).toBe(200);
      expect(overview.read).toBeLessThanOrEqual(CRM_LIMITS.clients / 10 + 1_000);
      expect(overview.written).toBe(0);
      const page = await cost("GET", "/crm/clients");
      expect(page.status).toBe(200);
      // A page is 50 clients and each one's tags (two here), plus the session.
      expect(page.read).toBeLessThanOrEqual(CRM_LIMITS.page * 4 + 20);
      const stage = await cost("GET", `/crm/clients?stage=${stages[2]}`);
      expect(stage.read).toBeLessThanOrEqual(CRM_LIMITS.page * 4 + 20);
      // A rare tag is read from the tags' index, not by walking every client.
      const tag = await cost("GET", "/crm/clients?tag=vip");
      expect(tag.status).toBe(200);
      // Ten clients carry it: their index entries, rows and tags, plus the session; far from 5,000.
      expect(tag.read).toBeLessThanOrEqual(100);
      const today = await cost("GET", "/crm/clients?followUp=today");
      expect(today.read).toBeLessThanOrEqual(CRM_LIMITS.clients / 10 + 50);
      // The CRM is full: one more is refused before it costs a write.
      const refused = await cost("POST", "/crm/clients", { name: "Nova" });
      expect(refused.status).toBe(507);
      expect(refused.written).toBe(0);
      const changed = await cost("PATCH", `/crm/clients/${first}`, { stageId: stages[1], tags: ["t0", "vip"], followUp: { at: new Date(Date.now() + 86_400_000).toISOString() } });
      expect(changed.status).toBe(200);
      expect(changed.read).toBeLessThanOrEqual(150);
      expect(changed.written).toBeLessThanOrEqual(40);
    } finally {
      await runInDurableObject(owner(), (agent: ZuriAgent) => {
        const { db } = agent.store;
        for (const table of ["zur_crm_tags", "zur_crm_history", "zur_crm_clients", "zur_crm_tag_counts"]) db.run(`DELETE FROM ${table}`);
      });
    }
  });
});

describe("the owner's Chatwoot (docs/planos/zuri-no-chatwoot.md)", () => {
  it("the page, a forged notice, a stranger and an answered message read and write a handful of rows", () =>
    withOwnerWorld(async (world) => {
      await world.link();
      const measure = async (fn: () => unknown) => {
        const before = { ...world.db.usage };
        await fn();
        return { read: world.db.usage.rowsRead - before.rowsRead, written: world.db.usage.rowsWritten - before.rowsWritten };
      };
      // Measured 13/11/2026: page 3 read; forged 3 read; stranger 8 read, 2 written; answered 18 read, 10 written
      // (the first answer also opens the app conversation "Chatwoot").
      // The page: the link (one setting) and the vault's row.
      const page = await measure(() => world.owner.status());
      expect(page.written).toBe(0);
      expect(page.read).toBeLessThanOrEqual(4);
      // A forged notice: the link and the row read, nothing written (a flood costs no writes).
      const link = JSON.parse(world.state.get<string>("chatwoot_owner") as string) as { id: string };
      const forged = await measure(() => world.owner.receive(link.id, "{}", { signature: `sha256=${"0".repeat(64)}`, timestamp: String(Math.floor(Date.now() / 1000)), delivery: "x" }));
      expect(forged.written).toBe(0);
      expect(forged.read).toBeLessThanOrEqual(4);
      // Someone else writes: the delivery seen, the stranger counted (the link's setting, a few times).
      const stranger = await measure(async () => {
        await world.chatwoot.agentSays(world.conversationId(), "oi", { id: 9, name: "Rafael Souza" });
        await world.settle();
      });
      expect(stranger.written).toBeLessThanOrEqual(3);
      expect(stranger.read).toBeLessThanOrEqual(10);
      // The owner writes and the (fake) agent answers: the link's setting a few times and the app conversation's row.
      const answered = await measure(async () => {
        await world.chatwoot.agentSays(world.conversationId(), "oi");
        await world.settle();
      });
      expect(answered.written).toBeLessThanOrEqual(12);
      expect(answered.read).toBeLessThanOrEqual(20);
    }));
});

describe("CRM's automations (PR S18)", () => {
  it("a run at its ceilings: 60 effects noted in one wake cost their own rows, and the counts read only the day", async () => {
    // A module at the manifest's ceilings: 96 runs and 60 effects a day. In rehearsal no call is made, so the
    // test needs no network; live adds one write per effect (its status after the call).
    const busy: AutomationModule = {
      manifest: {
        ...EXAMPLE_AUTOMATION.manifest,
        id: "example",
        // An effect of its own call (the example sends through the outbox since PR S19).
        calls: [...EXAMPLE_AUTOMATION.manifest.calls, { name: "note", method: "POST", path: "/api/v1/accounts/{account}/zuri-example" }],
        effects: ["note"],
        trigger: { kind: "every", minutes: 15, workingDays: false },
        caps: { runsPerDay: 96, callsPerRun: 2, effectsPerDay: 60, neuronsPerRun: 0 },
      },
      run: async (ctx) => {
        for (let n = 0; n < 60; n++) await ctx.effect({ effect: "note", key: `${ctx.day}:${n}`, label: "Pessoa de exemplo", call: "note" });
      },
    };
    const measured = await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const { db } = agent.store;
      for (const table of ["zur_crm_automations", "zur_crm_automation_runs", "zur_crm_automation_effects", "zur_crm_automation_days"]) db.run(`DELETE FROM ${table}`);
      db.run(
        `INSERT INTO zur_flow_connections (id, name, origin, methods, paths, auth, header_name, credential, created_at, updated_at, kind, meta) VALUES ('budget-chatwoot', 'Chatwoot', 'https://chat.exemplo.com.br', '["GET"]', '["/api"]', 'header', 'api_access_token', 'v1.a.b', 't', 't', 'chatwoot', '{"accountId":1}')`,
      );
      const automations = useCatalog(agent, [busy]);
      const now = Date.now();
      db.run(`INSERT INTO zur_crm_automations (id, state, effects_version, connection_id, rehearsal_since, next_run_at, updated_at) VALUES ('example', 'rehearsal', 1, 'budget-chatwoot', ?, ?, ?)`, new Date(now - 86_400_000).toISOString(), new Date(now - 1000).toISOString(), new Date(now).toISOString());
      // A wake first: the start of the object and the day's pruning, kept in memory, are not this one's.
      db.run(`UPDATE zur_crm_automations SET next_run_at = NULL`);
      await automations.tick();
      db.run(`UPDATE zur_crm_automations SET next_run_at = ?`, new Date(now - 1000).toISOString());
      // Half a year of runs before today's: the count reads only the day's by the index. They start a full day back,
      // so none falls inside the owner's today whatever the hour the test runs at (from 8 a.m. on it read 133).
      for (let n = 1; n < 180 * 24; n++) db.run(`INSERT INTO zur_crm_automation_runs (automation_id, started_at, mode, outcome) VALUES ('example', ?, 'rehearsal', 'ok')`, new Date(now - (24 + n) * 3_600_000).toISOString());
      const before = { ...db.usage };
      await automations.tick();
      const after = { ...db.usage };
      const noted = db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_crm_automation_effects`)?.n;
      for (const table of ["zur_crm_automations", "zur_crm_automation_runs", "zur_crm_automation_effects", "zur_crm_automation_days"]) db.run(`DELETE FROM ${table}`);
      db.run(`DELETE FROM zur_flow_connections WHERE id = 'budget-chatwoot'`);
      return { read: after.rowsRead - before.rowsRead, written: after.rowsWritten - before.rowsWritten, noted };
    });
    expect(measured.noted).toBe(60);
    // Each effect: its row, the primary key and 3 indexes (and a read of the state before it, S18-A1);
    // the run: its row and 2 indexes; the next time: the row and the partial index.
    expect(measured.written).toBeLessThanOrEqual(60 * 4 + 3 + 3);
    // The due row, the day's runs and effects, the credential and the 60 state reads.
    expect(measured.read).toBeLessThanOrEqual(130);
  });

  it("the list, the activity and the alarm's look stay small", async () => {
    await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const { db } = agent.store;
      for (const table of ["zur_crm_automations", "zur_crm_automation_runs", "zur_crm_automation_effects", "zur_crm_automation_days"]) db.run(`DELETE FROM ${table}`);
      useCatalog(agent, []);
    });
    // Nothing set up: the catalog comes from the code; one empty read of the table.
    const empty = await cost("GET", "/crm/automations");
    expect(empty.status).toBe(200);
    expect(empty.read).toBeLessThanOrEqual(10);
    expect(empty.written).toBe(0);
    await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const { db } = agent.store;
      const automations = useCatalog(agent, [EXAMPLE_AUTOMATION]);
      const now = Date.now();
      db.run(`INSERT INTO zur_crm_automations (id, state, effects_version, rehearsal_since, next_run_at, updated_at) VALUES ('example', 'rehearsal', 1, ?, ?, ?)`, new Date(now - 30 * 86_400_000).toISOString(), new Date(now + 3_600_000).toISOString(), new Date(now).toISOString());
      // Half a year of an automation at its ceilings: 24 runs and 3 effects a day.
      for (let n = 0; n < 180 * 24; n++) db.run(`INSERT INTO zur_crm_automation_runs (automation_id, started_at, mode, outcome) VALUES ('example', ?, 'rehearsal', 'ok')`, new Date(now - n * 3_600_000).toISOString());
      for (let n = 0; n < 180 * 3; n++) {
        const at = new Date(now - n * 8 * 3_600_000).toISOString();
        db.run(`INSERT INTO zur_crm_automation_effects (automation_id, key, mode, day, status, label, created_at, updated_at) VALUES ('example', ?, 'rehearsal', ?, 'would', 'Pessoa de exemplo', ?, ?)`, `k${n}`, at.slice(0, 10), at, at);
      }
      for (let n = 0; n < 20; n++) db.run(`INSERT OR IGNORE INTO zur_crm_automation_days (automation_id, day, verdict, decided_at) VALUES ('example', ?, 'match', ?)`, new Date(now - n * 86_400_000).toISOString().slice(0, 10), new Date(now).toISOString());
      expect(automations.nextDue()).not.toBeNull();
    });
    try {
      const list = await cost("GET", "/crm/automations");
      expect(list.status).toBe(200);
      // The rows set up and the rehearsal's last 14 days checked.
      expect(list.read).toBeLessThanOrEqual(40);
      expect(list.written).toBe(0);
      const activity = await cost("GET", "/crm/automations/example/activity");
      expect(activity.status).toBe(200);
      // 50 runs, 50 effects, the 14 days' effects by the day index and their checks: never the half year.
      expect(activity.read).toBeLessThanOrEqual(260);
      const checked = await cost("PUT", `/crm/automations/review-link/watch`, { watch: true });
      expect(checked.status).toBe(200);
      expect(checked.written).toBeLessThanOrEqual(12);
      // The alarm's look when nothing is due: one row from the index.
      const before = await runInDurableObject(owner(), (agent: ZuriAgent) => ({ ...agent.store.db.usage }));
      await runInDurableObject(owner(), async (agent: ZuriAgent) => {
        agent.store.crmAutomations.nextDue();
      });
      const after = await runInDurableObject(owner(), (agent: ZuriAgent) => ({ ...agent.store.db.usage }));
      expect(after.rowsRead - before.rowsRead).toBeLessThanOrEqual(2);
    } finally {
      await runInDurableObject(owner(), (agent: ZuriAgent) => {
        const { db } = agent.store;
        for (const table of ["zur_crm_automations", "zur_crm_automation_runs", "zur_crm_automation_effects", "zur_crm_automation_days"]) db.run(`DELETE FROM ${table}`);
      });
    }
  });
});

describe("the outbox (PR S19)", () => {
  it("CRM › Envios with half a year of history reads about one page; one send writes its own rows", async () => {
    const seeded = await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const { db } = agent.store;
      for (const table of ["zur_outbox", "zur_outbox_steps", "zur_outbox_queues", "zur_outbox_days"]) db.run(`DELETE FROM ${table}`);
      const now = Date.now();
      // 180 days of 20 messages each, all ended, and their days' counts.
      for (let day = 0; day < 180; day++) {
        const date = new Date(now - day * 86_400_000).toISOString();
        db.run(`INSERT INTO zur_outbox_days (day, sent, ms_total, ms_n) VALUES (?, 20, 20000, 20)`, date.slice(0, 10));
        for (let n = 0; n < 20; n++) {
          db.run(
            `INSERT INTO zur_outbox (id, automation_id, key, connection_id, priority, label, status, grp, attempts, available_at, day, created_at, updated_at, done_at) VALUES (?, 'review-request', ?, 'budget-chatwoot', 3, 'Pessoa', 'sent', 'sent', 1, ?, ?, ?, ?, ?)`,
            `o-${day}-${n}`,
            `${day}:${n}`,
            date,
            date.slice(0, 10),
            new Date(Date.parse(date) - n * 1000).toISOString(),
            date,
            date,
          );
        }
      }
      return db.one<{ id: string }>(`SELECT id FROM zur_outbox ORDER BY created_at DESC LIMIT 1`)?.id as string;
    });
    const status = await cost("GET", "/outbox/status");
    expect(status.status).toBe(200);
    // Nothing waiting: the state, the queues and two indexed lookups.
    expect(status.read).toBeLessThanOrEqual(10);
    expect(status.written).toBe(0);
    const month = await cost("GET", "/outbox?period=30d");
    expect(month.status).toBe(200);
    // A page (51 rows) and the 30 days' counts, never the half year.
    expect(month.read).toBeLessThanOrEqual(51 + 30 + 5);
    const failed = await cost("GET", "/outbox?period=30d&filter=failed");
    // No failed row in half a year: the group's index finds none; the 30 days' counts are still read.
    expect(failed.read).toBeLessThanOrEqual(30 + 5);
    const detail = await cost("GET", `/outbox/${seeded}`);
    expect(detail.read).toBeLessThanOrEqual(5);
    const paused = await cost("POST", "/outbox/pause");
    // The switch, its area's number, the activity row with its index, and the alarm planned again.
    expect(paused.written).toBeLessThanOrEqual(5);
    await cost("POST", "/outbox/resume");

    const sent = await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const { db } = agent.store;
      for (const table of ["zur_outbox", "zur_outbox_steps", "zur_outbox_queues", "zur_outbox_days"]) db.run(`DELETE FROM ${table}`);
      const connection = await agent.store.flows.connections.create({ kind: "chatwoot", name: "Chatwoot", origin: "https://chat.exemplo.com.br", accountId: 1, credential: "chave-do-agente-zuri-4f2a" }, { development: false });
      db.run(`UPDATE zur_flow_connections SET meta = json_set(meta, '$.inboxId', 7) WHERE id = ?`, connection);
      const network = new FakeNetwork();
      network.handlers.set("chat.exemplo.com.br", (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/contacts/search")) return Response.json({ payload: [{ id: 5, phone_number: "+5511987654321" }] });
        if (path.endsWith("/conversations") && request.method === "GET") return Response.json({ payload: [{ id: 9, inbox_id: 7, status: "open" }] });
        return Response.json({ id: 11 });
      });
      agent.store.flows.network = network;
      const { outbox } = agent.store;
      // Only what an automation on for real queued goes out (SEC-A8-04).
      db.run(`INSERT INTO zur_crm_automations (id, state, updated_at) VALUES ('review-request', 'live', ?) ON CONFLICT (id) DO UPDATE SET state = 'live'`, new Date().toISOString());
      outbox.enqueue({ automationId: "review-request", connectionId: connection, key: "k1", label: "Pessoa", phone: "+5511987654321", text: "Olá", bulk: true });
      // A wake first: the day's pruning, kept in memory, is not this one's.
      await outbox.tick();
      outbox.enqueue({ automationId: "review-request", connectionId: connection, key: "k2", label: "Pessoa", phone: "+5511987654321", text: "Olá", bulk: true });
      db.run(`UPDATE zur_outbox_queues SET next_free_at = NULL`);
      const before = { ...db.usage };
      await outbox.tick();
      const after = { ...db.usage };
      const done = db.one(`SELECT status FROM zur_outbox WHERE key = 'k2'`);
      for (const table of ["zur_outbox", "zur_outbox_steps", "zur_outbox_queues", "zur_outbox_days"]) db.run(`DELETE FROM ${table}`);
      db.run(`DELETE FROM zur_crm_automations WHERE id = 'review-request'`);
      db.run(`DELETE FROM zur_flow_connections WHERE id = ?`, connection);
      return { read: after.rowsRead - before.rowsRead, written: after.rowsWritten - before.rowsWritten, done };
    });
    expect(sent.done).toEqual({ status: "sent" });
    // Measured 14 written and 20 read: the claim and the status with their indexes and trigger, the step,
    // the day's count, the queue's clock and the contact's and conversation's ids.
    expect(sent.written).toBeLessThanOrEqual(16);
    expect(sent.read).toBeLessThanOrEqual(24);
  });
});

describe("the record of the day (E5b)", () => {
  it("two years of closed days: the settings line, a week of the Agenda and the backup read about what they show", async () => {
    const measured = await runInDurableObject(owner(), async (agent: ZuriAgent) => {
      const { db, agendaRecord } = agent.store;
      for (const table of ["zur_agenda_record", "zur_agenda_closed_days"]) db.run(`DELETE FROM ${table}`);
      const start = Date.parse("2024-11-01T12:00:00Z");
      // 730 days of 5 events each.
      for (let n = 0; n < 730; n++) {
        const day = new Date(start + n * 86_400_000).toISOString().slice(0, 10);
        db.run(`INSERT INTO zur_agenda_closed_days (day, closed_at, events) VALUES (?, ?, 5)`, day, `${day}T03:00:05.000Z`);
        for (let e = 0; e < 5; e++) db.run(`INSERT INTO zur_agenda_record (day, calendar_id, event_id, etag, data) VALUES (?, 'dono@exemplo.com.br', ?, '"1"', '{}')`, day, `ev${n}-${e}`);
      }
      const measure = <T>(fn: () => T) => {
        const before = { ...db.usage };
        const value = fn();
        return { value, read: db.usage.rowsRead - before.rowsRead, written: db.usage.rowsWritten - before.rowsWritten };
      };
      const last = measure(() => agendaRecord.last());
      const week = measure(() => agendaRecord.apply([], "2026-10-25", "2026-10-31", ["dono@exemplo.com.br"], false));
      for (const table of ["zur_agenda_record", "zur_agenda_closed_days"]) db.run(`DELETE FROM ${table}`);
      return { last: last.read, lastDay: last.value?.day, week: week.read, weekEvents: week.value.length, written: last.written + week.written };
    });
    expect(measured.lastDay).toBe("2026-10-31");
    // The newest row of the primary key, never the 730 days.
    expect(measured.last).toBeLessThanOrEqual(2);
    // The week's 7 days and their 35 copies, by the primary key.
    expect(measured.weekEvents).toBe(35);
    expect(measured.week).toBeLessThanOrEqual(7 + 35 + 4);
    // Reading never writes (a notice only when something changed at Google).
    expect(measured.written).toBe(0);
    const route = await cost("GET", "/google/record");
    expect(route.status).toBe(200);
    expect(route.read).toBeLessThanOrEqual(12);
  });
});
