import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// The home page of the Sinal frontend (docs/planos/implementacao-frontend-sinal.md, PR S04):
// the day under the greeting, "Seu dia" from 08:00 to 18:00 around the line of now, the curtain
// of what passed, what is pending on top, and the list arranging itself as the clock runs
// without taking the focus.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const SP = "America/Sao_Paulo";
const tag = () => uniqueTag(test.info().project.name);

/** The owner's day `days` from the real today, as "YYYY-MM-DD". The server decides "today" by its own clock. */
const dayIn = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: SP }).format(new Date(Date.now() + days * 86_400_000));
/** The instant of `time` on the owner's day `days` from today (São Paulo is UTC−3 all year). */
const at = (days: number, time: string) => new Date(`${dayIn(days)}T${time}:00-03:00`);

const addTask = async (page: Page, title: string, dueAt: Date, extra: object = {}) => {
  const res = await page.request.post("/api/tasks", { headers: CSRF, data: { title, dueAt: dueAt.toISOString(), ...extra } });
  expect(res.status()).toBe(201);
};

/**
 * Finishes what earlier tests left for today: the pending lines and their count are then only
 * this test's. One worker runs the files in turn, and no test counts on another's leftovers.
 */
async function clearTasks(page: Page, view: "today" | "upcoming" = "today") {
  const { tasks } = (await (await page.request.get(`/api/tasks?view=${view}`, { headers: CSRF })).json()) as { tasks: { id: string }[] };
  for (const task of tasks) expect((await page.request.patch(`/api/tasks/${task.id}`, { headers: CSRF, data: { status: "done" } })).status()).toBe(200);
}
const clearToday = (page: Page) => clearTasks(page);

/** No routine of other tests in the day: the list answered here holds only these. */
const routeRoutines = (page: Page, automations: object[]) =>
  page.route("**/api/automations", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { automations, counts: {} } }) : route.fallback()));

/** Google as connected with one calendar and these events today, answered here: the day's events don't depend on the sample calendar's hours. */
async function routeAgenda(page: Page, events: { title: string; start: Date; end: Date; location?: string }[]) {
  await page.route("**/api/google", (route) =>
    route.fulfill({
      json: {
        configured: true,
        connected: true,
        account: "dono@exemplo.com.br",
        status: "connected",
        problem: null,
        connectedAt: at(-1, "10:00").toISOString(),
        calendars: [{ id: "main", name: "Pessoal", mode: "write", writable: true }],
      },
    }),
  );
  await page.route("**/api/google/events?*", (route) =>
    route.fulfill({
      json: {
        more: false,
        calendars: [],
        events: events.map((event, index) => ({
          id: `e${index}`,
          calendarId: "main",
          title: event.title,
          start: event.start.toISOString(),
          end: event.end.toISOString(),
          allDay: false,
          location: event.location ?? "",
          description: "",
          etag: "",
          recurring: false,
          guests: 0,
        })),
      },
    }),
  );
}

async function openHome(page: Page) {
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
}

const dayRegion = (page: Page) => page.getByRole("region", { name: "Seu dia" });
const row = (page: Page, title: string) => dayRegion(page).getByRole("listitem").filter({ hasText: title });

test("the day shows over the greeting and Seu dia arranges itself as the clock runs, keeping the focus @mobile", async ({ page }) => {
  const word = tag();
  const visit = `Vistoria ${word}`;
  const early = `Cedo ${word}`;
  const afternoon = `Tarde ${word}`;
  const night = `Noite ${word}`;
  const late = `Ontem ${word}`;
  // The page's clock at 08:12 of the owner's real today: the server's "today" and the browser's agree.
  await page.clock.install({ time: at(0, "08:12") });
  await routeAgenda(page, [{ title: visit, start: at(0, "08:20"), end: at(0, "08:28"), location: "Água Verde" }]);
  await routeRoutines(page, []);
  await openHome(page);
  await clearToday(page);
  await addTask(page, early, at(0, "08:36"));
  await addTask(page, afternoon, at(0, "15:00"), { priority: "high" });
  await addTask(page, night, at(0, "21:00"));
  await addTask(page, late, at(-1, "23:59"));
  await page.reload();

  // The day, in the owner's zone, over the greeting.
  const today = new Intl.DateTimeFormat("pt-BR", { timeZone: SP, weekday: "long", day: "numeric", month: "long" }).format(at(0, "08:12"));
  await expect(page.getByRole("main").getByText(today, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Bom dia/);

  const region = dayRegion(page);
  await expect(region.getByText("08:00 às 18:00", { exact: true })).toBeVisible();
  const ahead = region.getByRole("list", { name: "Agora e depois" });
  const pending = region.getByRole("list", { name: "Pendentes" });
  await expect(ahead.getByRole("listitem", { name: "Agora, 08:12" })).toBeVisible();
  // In order after the line: the event, then the tasks by the hour.
  const order = async () => (await ahead.getByRole("listitem").allTextContents()).map((text) => [visit, early, afternoon, night, "LINE"].find((name) => text.includes(name)) ?? (/^\d\d:\d\d$/.test(text) ? "LINE" : ""));
  await expect.poll(async () => (await order()).filter(Boolean)).toEqual(["LINE", visit, early, afternoon]);
  await expect(row(page, visit)).toContainText("08:20");
  await expect(row(page, visit)).toContainText("até 08:28");
  await expect(row(page, visit)).toContainText("Água Verde");
  await expect(row(page, afternoon)).toContainText("Alta");
  // Yesterday's is on top, late; the count says how many wait.
  await expect(pending.getByRole("listitem").filter({ hasText: late })).toContainText("Atrasada");
  await expect(row(page, late)).toContainText("Ontem");
  const count = region.getByRole("status");
  await expect(count).toHaveText("1 pendente");

  // Outside 08:00 to 18:00 waits behind one line, which keeps the focus when it turns.
  await expect(row(page, night)).toHaveCount(0);
  const outside = region.getByRole("button", { name: "1 fora das 08:00 às 18:00 · Mostrar" });
  await expect(outside).toHaveAttribute("aria-pressed", "false");
  await outside.focus();
  await page.keyboard.press("Enter");
  await expect(row(page, night)).toContainText("21:00");
  const inside = region.getByRole("button", { name: "Mostrar só das 08:00 às 18:00" });
  await expect(inside).toHaveAttribute("aria-pressed", "true");
  await expect(inside).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(row(page, night)).toHaveCount(0);

  // 08:22: the event is under way. (Short jumps, with the keyboard in use between them: a long one
  // with nobody at the page would end the session for lack of use.)
  await page.clock.fastForward("10:00");
  await expect(ahead.getByRole("listitem", { name: "Agora, 08:22" })).toBeVisible();
  await expect(row(page, visit)).toContainText("Agora");

  // 08:38, with the focus on the 08:36 task's mark: the event passed behind the curtain, the task
  // went up as pending, and the focus is still on its mark.
  const mark = region.getByRole("checkbox", { name: `Concluir “${early}”` });
  await mark.focus();
  await page.keyboard.press("Shift");
  await page.clock.fastForward("16:00");
  await expect(ahead.getByRole("listitem", { name: "Agora, 08:38" })).toBeVisible();
  await expect(pending.getByRole("listitem").filter({ hasText: early })).toContainText("Passou da hora");
  await expect(mark).toBeFocused();
  await expect(count).toHaveText("2 pendentes");
  await expect(ahead.getByRole("listitem").filter({ hasText: visit })).toHaveCount(0);

  // The curtain: closed until asked, opened and closed by the keyboard.
  const fold = region.getByRole("button", { name: /^\d já (passou|passaram)$/ });
  await expect(fold).toHaveText("1 já passou");
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  const past = page.locator(`[id="${await fold.getAttribute("aria-controls")}"]`);
  await expect(past).toHaveAttribute("inert", "");
  await fold.focus();
  await page.keyboard.press("Enter");
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(past).not.toHaveAttribute("inert", "");
  await expect(past.getByRole("listitem").filter({ hasText: visit })).toBeVisible();
  expect(await tooSmallControls(page)).toEqual([]);
  await expectAccessible(page, "início com o dia e a cortina aberta");

  // Marking a task done saves at once, puts it behind the curtain as done and keeps the focus on its mark.
  const finish = region.getByRole("checkbox", { name: `Concluir “${afternoon}”` });
  const saved = page.waitForResponse((r) => r.url().includes("/api/tasks/") && r.request().method() === "PATCH");
  await finish.focus();
  await page.keyboard.press("Space");
  expect((await saved).status()).toBe(200);
  await expect(past.getByRole("listitem").filter({ hasText: afternoon })).toContainText("Feito");
  await expect(finish).toBeChecked();
  await expect(finish).toBeFocused();
  const done = (await (await page.request.get("/api/tasks?view=completed", { headers: CSRF })).json()) as { tasks: { title: string }[] };
  expect(done.tasks.some((task) => task.title === afternoon)).toBe(true);
  // Unmarked, it goes back to its hour.
  const undone = page.waitForResponse((r) => r.url().includes("/api/tasks/") && r.request().method() === "PATCH");
  await page.keyboard.press("Space");
  expect((await undone).status()).toBe(200);
  await expect(ahead.getByRole("listitem").filter({ hasText: afternoon })).toBeVisible();
  await expect(finish).not.toBeChecked();
  await expect(finish).toBeFocused();

  // Closed again, a task finished goes behind it and the focus goes to the curtain's button.
  await fold.click();
  await expect(past).toHaveAttribute("inert", "");
  await finish.focus();
  await page.keyboard.press("Space");
  await expect(fold).toBeFocused();
  await expect(ahead.getByRole("listitem").filter({ hasText: afternoon })).toHaveCount(0);

  await region.getByRole("link", { name: "Abrir agenda" }).click();
  await expect(page).toHaveURL(/\/agenda$/);
});

test("a task that could not be saved goes back to its place and says why", async ({ page }) => {
  const title = `Falha ${tag()}`;
  await page.clock.install({ time: at(0, "08:12") });
  await openHome(page);
  await clearToday(page);
  await addTask(page, title, at(0, "10:00"));
  await page.reload();
  await page.route("**/api/tasks/*", (route) => (route.request().method() === "PATCH" ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "Não deu para salvar. Tente de novo." } }) : route.fallback()));
  const region = dayRegion(page);
  const mark = region.getByRole("checkbox", { name: `Concluir “${title}”` });
  await mark.click();
  await expect(region.getByRole("alert")).toContainText("Não deu para concluir. Nada se perdeu; tente de novo.");
  await expect(mark).not.toBeChecked();
  await expect(region.getByRole("list", { name: "Agora e depois" }).getByRole("listitem").filter({ hasText: title })).toBeVisible();
});

test("QA-5: a second tap while the first save is on its way is ignored, and the server ends as the screen shows", async ({ page }) => {
  const title = `Dois toques ${tag()}`;
  await page.clock.install({ time: at(0, "08:12") });
  await openHome(page);
  await clearToday(page);
  await addTask(page, title, at(0, "10:00"));
  await page.reload();
  let saves = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tasks/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    saves++;
    await held;
    await route.fallback();
  });
  const region = dayRegion(page);
  const mark = region.getByRole("checkbox", { name: `Concluir “${title}”` });
  await mark.focus();
  await page.keyboard.press("Space");
  await expect(mark).toBeChecked();
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  release();
  await expect(region.getByRole("button", { name: "1 já passou" })).toBeFocused();
  expect(saves).toBe(1);
  const done = (await (await page.request.get("/api/tasks?view=completed", { headers: CSRF })).json()) as { tasks: { title: string }[] };
  expect(done.tasks.some((task) => task.title === title)).toBe(true);
});

test("QA-7: the day's states: nothing today, an all-day event, work under way, a routine, and each list's error with its way out @mobile", async ({ page }) => {
  const word = tag();
  await page.clock.install({ time: at(0, "08:12") });
  await routeRoutines(page, [{ id: "r1", name: `Resumo ${word}`, kind: "digest", status: "active", nextRunAt: at(0, "17:00").toISOString() }]);
  await openHome(page);
  await clearToday(page);
  await clearTasks(page, "upcoming");

  // Nothing but the routine: answered without it, the day says so.
  await page.unroute("**/api/automations");
  await routeRoutines(page, []);
  await page.reload();
  const region = dayRegion(page);
  await expect(region.getByText("Nada marcado para hoje.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Próximos dias" }).getByText("Nada marcado para os próximos dias.", { exact: true })).toBeVisible();
  await expectAccessible(page, "início vazio");

  // An all-day event, an undated task under way and a routine of today, each said by its kind.
  await page.unroute("**/api/automations");
  await routeRoutines(page, [{ id: "r1", name: `Resumo ${word}`, kind: "digest", status: "active", nextRunAt: at(0, "17:00").toISOString() }]);
  await page.route("**/api/google", (route) => route.fulfill({ json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: null, calendars: [{ id: "main", name: "Pessoal", mode: "read", writable: false }] } }));
  let agendaFails = false;
  await page.route("**/api/google/events?*", (route) =>
    agendaFails
      ? route.fulfill({ status: 502, json: { code: "INTEGRATION_ERROR", message: "Não deu para falar com o Google agora. Tente de novo." } })
      : route.fulfill({ json: { more: false, calendars: [], events: [{ id: "h", calendarId: "main", title: `Feriado ${word}`, start: dayIn(0), end: dayIn(1), allDay: true, location: "", description: "", etag: "", recurring: false, guests: 0 }] } }),
  );
  expect((await page.request.post("/api/tasks", { headers: CSRF, data: { title: `Andando ${word}`, status: "in_progress" } })).status()).toBe(201);
  await page.reload();
  await expect(row(page, `Feriado ${word}`)).toContainText(/^Dia todo/);
  await expect(row(page, `Feriado ${word}`)).toContainText(", Evento");
  await expect(row(page, `Andando ${word}`)).toContainText("Em andamento");
  await expect(row(page, `Resumo ${word}`)).toContainText(/^17:00/);
  await expect(row(page, `Resumo ${word}`)).toContainText(", Rotina");

  // The agenda out of reach: the rest of the day stays, with the way to try again.
  agendaFails = true;
  await page.reload();
  await expect(row(page, `Andando ${word}`)).toBeVisible();
  await expect(row(page, `Feriado ${word}`)).toHaveCount(0);
  const alert = region.getByRole("alert");
  await expect(alert).toBeVisible();
  agendaFails = false;
  await alert.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(row(page, `Feriado ${word}`)).toBeVisible();
  await expect(region.getByRole("alert")).toHaveCount(0);

  // The tasks out of reach: the list says so and reads again when asked.
  let tasksFail = true;
  await page.route("**/api/tasks?view=today*", (route) => (tasksFail ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "x" } }) : route.fallback()));
  await page.reload();
  await expect(region.getByRole("alert")).toBeVisible();
  await expect(region.getByRole("list")).toHaveCount(0);
  tasksFail = false;
  await region.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(row(page, `Andando ${word}`)).toBeVisible();
});

test("QA-3: at midnight with the page open the day turns: the date, the lists read again and what was marked leaves", async ({ page }) => {
  const title = `Virada ${tag()}`;
  await routeRoutines(page, []);
  await routeAgenda(page, []);
  await page.clock.install({ time: at(0, "23:59") });
  await openHome(page);
  await clearToday(page);
  await addTask(page, title, at(0, "23:59"));
  await page.reload();
  const region = dayRegion(page);
  const mark = region.getByRole("checkbox", { name: `Concluir “${title}”` });
  await mark.click();
  await expect(region.getByRole("button", { name: "1 já passou" })).toBeVisible();

  const tasksAgain = page.waitForRequest((r) => r.url().includes("/api/tasks?view=today"));
  const eventsAgain = page.waitForRequest((r) => r.url().includes(`/api/google/events?from=${dayIn(1)}&to=${dayIn(1)}`));
  await page.clock.fastForward("01:30");
  await tasksAgain;
  await eventsAgain;
  const tomorrow = new Intl.DateTimeFormat("pt-BR", { timeZone: SP, weekday: "long", day: "numeric", month: "long" }).format(at(1, "00:00"));
  await expect(page.getByRole("main").getByText(tomorrow, { exact: true })).toBeVisible();
  await expect(region.getByRole("listitem", { name: /^Agora, 00:0\d$/ })).toBeVisible();
  // Yesterday's "Feito" is not of this day.
  await expect(region.getByRole("button", { name: /já pass/ })).toHaveCount(0);
  await expect(row(page, title)).toHaveCount(0);
});

test("a routine waiting for approval is pending in Seu dia, first of all, with the way to review it @mobile", async ({ page }) => {
  const name = `Revisão ${tag()}`;
  await routeRoutines(page, [{ id: "a1", name, kind: "ai_routine", status: "pending_approval", nextRunAt: null }]);
  await page.clock.install({ time: at(0, "08:12") });
  await openHome(page);
  await clearToday(page);
  // Four tasks late since earlier days: three show, the oldest first, and the rest is one tap away.
  const word = tag();
  for (const days of [-2, -3, -4, -5]) await addTask(page, `Velha ${-days} ${word}`, at(days, "10:00"));
  await page.reload();
  const region = dayRegion(page);
  const pending = region.getByRole("list", { name: "Pendentes" });
  await expect(region.getByRole("status")).toHaveText("5 pendentes");
  const lines = pending.getByRole("listitem");
  await expect(lines).toHaveCount(5);
  const first = lines.first();
  await expect(first).toContainText(`Aprovar a rotina “${name}”`);
  await expect(first).toContainText("Confirmação");
  // A task late for more than a day shows the day it was due.
  const short = (days: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: SP, day: "2-digit", month: "2-digit" }).format(at(days, "10:00"));
  for (const [index, days] of [-5, -4, -3].entries()) {
    await expect(lines.nth(index + 1)).toContainText(`Velha ${-days} ${word}`);
    await expect(lines.nth(index + 1)).toContainText(short(days));
    await expect(lines.nth(index + 1)).toContainText("Atrasada");
  }
  await expect(lines.nth(4).getByRole("link", { name: "Mais 1 em Tarefas" })).toBeVisible();
  expect(await tooSmallControls(page)).toEqual([]);
  await expectAccessible(page, "início com pendências");
  await first.getByRole("link", { name: `Revisar a rotina “${name}”` }).click();
  await expect(page).toHaveURL(/\/rotinas$/);
});

test.describe("with the device in another zone", () => {
  // The owner's zone (São Paulo) decides "today", never the device's (Tokyo is 12 h ahead).
  test.use({ timezoneId: "Asia/Tokyo" });

  test("today and tomorrow follow the owner's zone, and the next days list what comes @mobile", async ({ page }) => {
    const word = tag();
    await page.clock.install({ time: at(0, "08:12") });
    await openHome(page);
    await clearToday(page);
    await clearTasks(page, "upcoming");
    await addTask(page, `Hoje ${word}`, at(0, "23:59"));
    await addTask(page, `Hora ${word}`, at(0, "16:30"));
    await addTask(page, `Amanhã ${word}`, at(1, "23:00"));
    await page.reload();
    const region = dayRegion(page);
    // A deadline with only the day has no hour: it reads "Hoje"; the hour is São Paulo's, not Tokyo's.
    await expect(row(page, `Hoje ${word}`)).toContainText(/^Hoje/);
    await expect(row(page, `Hora ${word}`)).toContainText(/^16:30/);
    await expect(region.getByRole("listitem", { name: "Agora, 08:12" })).toBeVisible();
    await expect(row(page, `Amanhã ${word}`)).toHaveCount(0);
    // Tomorrow by the owner's clock (São Paulo), with the device 12 h ahead in Tokyo.
    const next = page.getByRole("region", { name: "Próximos dias" });
    const line = next.getByRole("listitem").filter({ hasText: `Amanhã ${word}` });
    await expect(line).toContainText(/^Amanhã/);
    await expect(line).toContainText("23:00");
    await next.getByRole("link", { name: "Ver tarefas" }).click();
    await expect(page).toHaveURL(/\/tarefas$/);
  });
});
