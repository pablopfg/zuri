import type { Note } from "@zuri/shared";
import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, uniqueTag } from "./ui-helpers.ts";

// The new interface, part 2 (docs/planos/nova-ui.md): only what changed is
// fetched again, without reloading. A change made elsewhere (here, straight
// through the API, as the bot, a routine or another device would) arrives with
// the heartbeat when the live channel is down; one the chat makes arrives with
// its own tool event.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

// These are the backup path: the live channel (part 3, realtime.spec.ts) falls at
// every try here, and the heartbeat alone still brings what changed elsewhere.
test.beforeEach(({ page }) => page.routeWebSocket(/\/api\/live$/, (ws) => ws.close()));

const tag = () => uniqueTag(test.info().project.name);

/** Today's date in São Paulo (the owner's zone), as YYYY-MM-DD. */
const localToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Tonight at 23:00 in São Paulo, so the task counts as today's. */
const tonight = () => new Date(`${localToday()}T23:00:00-03:00`).toISOString();

/** A mark on the window: still there means the page was never reloaded. */
const markPage = (page: Page) => page.evaluate(() => Object.assign(window, { __zuriMark: 1 }));
const stillSamePage = (page: Page) => page.evaluate(() => (window as unknown as { __zuriMark?: number }).__zuriMark === 1);

async function openTasks(page: Page) {
  await page.clock.install();
  await page.goto("/tarefas");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Tarefas" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Hoje \d+$/ })).toBeVisible();
}

/** The heartbeat's minute passes: the one tab that sends it learns the areas' numbers. */
async function nextHeartbeat(page: Page) {
  const beat = page.waitForResponse((r) => r.url().endsWith("/api/auth/heartbeat"));
  await page.clock.runFor(61_000);
  expect((await beat).status()).toBe(200);
}

/**
 * The page's clock is held (for the heartbeat), and the lists tell the screen of
 * a change through a zero-delay timer: move the clock a little until `check` passes.
 */
async function settled(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.clock.runFor(20);
    await check();
  }).toPass({ timeout: 5_000 });
}

const todayCount = async (page: Page) => Number((await page.getByRole("button", { name: /^Hoje \d+$/ }).textContent())?.replace(/\D/g, ""));

test("a task made elsewhere shows up on the open list without a reload, glowing, with the counts", async ({ page }) => {
  const title = `Comprar ração ${tag()}`;
  await openTasks(page);
  const before = await todayCount(page);
  await markPage(page);

  const created = await page.request.post("/api/tasks", { headers: CSRF, data: { title, dueAt: tonight() } });
  expect(created.status()).toBe(201);
  // Nothing moves before the news arrives: no request of the list's own.
  await expect(page.getByRole("button", { name: title })).toHaveCount(0);

  const listFetched = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/tasks");
  await nextHeartbeat(page);
  await listFetched;
  const row = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: title, exact: true }) });
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/zuri-flash/);
  await expect(page.getByRole("button", { name: `Hoje ${before + 1}` })).toBeVisible();
  // The side menu's count of today's tasks follows (on a computer it is always in view).
  await expect(page.locator("aside").getByRole("link", { name: `Tarefas ${before + 1}` })).toBeVisible();
  expect(await stillSamePage(page)).toBe(true);
  // The screen reader hears one short line about it.
  await expect(page.getByRole("status").filter({ hasText: "1 item da lista mudou." })).toHaveCount(1);
  await expectAccessible(page, "tarefa nova com destaque");
  // The glow goes out by itself.
  await page.clock.runFor(2_500);
  await expect(row).not.toHaveClass(/zuri-flash/);
});

test("a change elsewhere to another area refreshes nothing on this screen", async ({ page }) => {
  await openTasks(page);
  await page.request.post("/api/notes", { headers: CSRF, data: { title: `Nota ${tag()}`, content: "x" } });
  const asked: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/") && path !== "/api/auth/heartbeat") asked.push(path);
  });
  await nextHeartbeat(page);
  await page.clock.runFor(1_000);
  expect(asked).toEqual([]);
});

test("completing a task marks it at once, and a refusal puts it back", async ({ page }) => {
  const title = `Ligar para a vet ${tag()}`;
  await openTasks(page);
  await page.request.post("/api/tasks", { headers: CSRF, data: { title, dueAt: tonight() } });
  await nextHeartbeat(page);
  const box = page.getByRole("checkbox", { name: `Concluir "${title}"` });
  await expect(box).toBeVisible();

  // The server takes its time: the mark is already there.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/tasks\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await held;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL", message: "Algo deu errado." }) });
  });
  await box.click();
  await settled(page, () => expect(page.getByRole("checkbox", { name: `Reabrir "${title}"` })).toBeChecked({ timeout: 100 }));
  const refused = page.waitForResponse((r) => r.request().method() === "PATCH");
  release();
  await refused;
  // Refused: back to open, with the reason.
  await settled(page, () => expect(page.getByRole("checkbox", { name: `Concluir "${title}"` })).not.toBeChecked({ timeout: 100 }));
  await expect(page.getByRole("alert")).toBeVisible();
});

test("a note changed elsewhere while being edited keeps what was typed and offers the new version", async ({ page }) => {
  const title = `Ideias ${tag()}`;
  await page.clock.install();
  await page.goto("/notas");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Notas" })).toBeVisible();
  const made = await page.request.post("/api/notes", { headers: CSRF, data: { title, content: "primeira versão" } });
  expect(made.status()).toBe(201);
  const { note } = (await made.json()) as { note: Note };
  await page.goto(`/notas/${note.id}`);
  const editor = page.getByLabel("Texto da nota");
  await expect(editor).toHaveValue("primeira versão");
  const saves: number[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "PATCH") saves.push(response.status());
  });

  // The other device saves first; this one types and its own save, a moment later, is refused (Sinal, PR S07).
  const changed = await page.request.patch(`/api/notes/${note.id}`, { headers: CSRF, data: { title: `${title} de fora`, content: "versão do outro aparelho" } });
  expect(changed.status()).toBe(200);
  await editor.fill("o que eu escrevi");
  await page.clock.runFor(5_000);
  await expect(page.getByText("Esta nota mudou em outro aparelho enquanto você editava.")).toBeVisible();
  expect(saves).toEqual([409]);
  await expect(editor).toHaveValue("o que eu escrevi");
  // Nothing saves itself over the other version while the owner has not chosen.
  await expect(page.getByText("Ainda não salva: escolha qual versão fica")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.clock.runFor(90_000);
  expect(saves).toEqual([409]);
  expect(((await (await page.request.get(`/api/notes/${note.id}`, { headers: CSRF })).json()) as { note: Note }).note.content).toBe("versão do outro aparelho");
  await expectAccessible(page, "nota mudou em outro aparelho");

  // "Manter a minha" saves the owner's text at once.
  await page.getByRole("button", { name: "Manter a minha" }).click();
  await expect(page.getByText("Esta nota mudou em outro aparelho enquanto você editava.")).toHaveCount(0);
  await expect(editor).toHaveValue("o que eu escrevi");
  await expect(page.getByText(/^Salva às \d{2}:\d{2}$/)).toBeVisible();
  expect(saves).toEqual([409, 200]);
  // SEC-S07-01: all of this editor's version stays, the title the other device changed too, not only the field typed here.
  const kept = ((await (await page.request.get(`/api/notes/${note.id}`, { headers: CSRF })).json()) as { note: Note }).note;
  expect([kept.title, kept.content]).toEqual([title, "o que eu escrevi"]);

  // Again, and this time the new version is taken: nothing of this editor is saved over it.
  await page.request.patch(`/api/notes/${note.id}`, { headers: CSRF, data: { content: "terceira versão" } });
  await editor.fill("o que eu escrevi depois");
  await page.clock.runFor(5_000);
  await page.getByRole("button", { name: "Ver a versão nova" }).click();
  await expect(editor).toHaveValue("terceira versão");
  await page.clock.runFor(90_000);
  expect(saves).toEqual([409, 200, 409]);

  // An untouched editor simply shows what changed elsewhere, at the next beat.
  await page.request.patch(`/api/notes/${note.id}`, { headers: CSRF, data: { content: "quarta versão" } });
  await nextHeartbeat(page);
  await expect(editor).toHaveValue("quarta versão");
  await expect(page.getByText("Esta nota mudou em outro aparelho enquanto você editava.")).toHaveCount(0);
});

test("a task the chat creates updates the side menu's count right away, without the heartbeat", async ({ page }) => {
  await page.goto("/conversa");
  const counted = page.waitForResponse((r) => r.url().endsWith("/api/tasks/counts"));
  await signIn(page);
  // The count as the server sent it, and on the screen before the task is made: read from the link alone, a menu
  // drawn before the answer arrived read as zero and the test compared with the wrong number.
  const before = ((await (await counted).json()) as { counts: { today: number } }).counts.today;
  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("link", { name: before > 0 ? `Tarefas ${before}` : "Tarefas", exact: true })).toBeVisible();
  const field = page.getByRole("textbox", { name: "Mensagem" });
  await field.fill(`call create_task {"title":"Pagar a luz ${tag()}","due":"${localToday()}"}`);
  await field.press("Enter");
  await expect(sidebar.getByRole("link", { name: `Tarefas ${before + 1}` })).toBeVisible();
});

test("the counts ride on numbers only: the heartbeat carries no content", async ({ page }) => {
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  const beat = await page.request.post("/api/auth/heartbeat", { headers: CSRF, data: { active: false } });
  expect(beat.status()).toBe(200);
  const body = (await beat.json()) as { versions?: Record<string, unknown> };
  expect(Object.keys(body.versions ?? {}).sort()).toEqual(["automations", "calendar", "contacts", "conversations", "crm", "flows", "memories", "notes", "projects", "reviews", "tasks", "trash", "usage"]);
  for (const value of Object.values(body.versions ?? {})) expect(typeof value).toBe("number");
  const tasks = (await (await page.request.get("/api/tasks/counts", { headers: CSRF })).json()) as { counts: Record<string, number> };
  expect(Object.keys(tasks.counts).sort()).toEqual(["all", "completed", "overdue", "today", "upcoming"]);
});
