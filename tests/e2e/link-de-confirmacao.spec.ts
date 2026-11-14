import type { ConfirmView } from "@zuri/shared";
import { expect, type Page, test } from "./fixtures.ts";
import { expectAccessible, expectFits, signIn, tooSmallControls } from "./ui-helpers.ts";

// The patient's confirmation link (E7a, docs/planos/link-de-confirmacao.md, protótipo cfPage/cfBox).
// The page is outside the app: no session, no menu. Its two API calls are answered here, so no
// token of the shared e2e Worker is spent and nothing hangs on Google; the server's side (tokens,
// limits, deadline, Google) is tested in apps/agent/test/confirm-links.test.ts.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// A made-up token of the right shape (22 base64url characters).
const TOKEN = `${"Ex".repeat(10)}_9`;
const PATH = `/c/${TOKEN}`;

/** An appointment on Thursday 19/11/2026, 14:00 to 15:00 in São Paulo; invented office and patient. */
const OPEN: ConfirmView = {
  state: "open",
  clinic: "Consultório Exemplo",
  first: "Helena",
  start: "2026-11-19T17:00:00.000Z",
  end: "2026-11-19T18:00:00.000Z",
  zone: "America/Sao_Paulo",
  type: "Consulta",
  online: false,
  place: "Rua das Flores, 100",
  cancelUntil: "2026-11-19T02:59:00.000Z",
  canCancel: true,
  team: "11987654321",
};

type Reply = { status: number; json: unknown };

/** /api/c/view answers `view`; /api/c/answer answers `answer(action)`. Returns the bodies sent. */
async function routeConfirm(page: Page, view: Reply | (() => Reply), answer?: (action: string) => Reply) {
  const sent: { view: unknown[]; answer: unknown[] } = { view: [], answer: [] };
  await page.route("**/api/c/view", (route) => {
    sent.view.push(route.request().postDataJSON());
    const reply = typeof view === "function" ? view() : view;
    return route.fulfill({ status: reply.status, json: reply.json });
  });
  await page.route("**/api/c/answer", (route) => {
    const body = route.request().postDataJSON() as { action: string };
    sent.answer.push(body);
    const reply = answer?.(body.action) ?? { status: 500, json: { code: "INTERNAL", message: "x" } };
    return route.fulfill({ status: reply.status, json: reply.json });
  });
  return sent;
}

const ok = (view: Partial<ConfirmView> = {}): Reply => ({ status: 200, json: { ...OPEN, ...view } });
const card = (page: Page) => page.getByRole("main");

test("@mobile the page shows the appointment without a session, confirms with one tap and keeps the token out of every address; accessible", async ({ page }) => {
  const sent = await routeConfirm(page, ok(), () => ok({ state: "confirmed" }));
  // As behind Access: the session check never gets an answer.
  await page.route("**/api/auth/session", (route) => route.abort("failed"));
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  await page.goto(PATH);

  await expect(page.getByRole("heading", { level: 1, name: "Olá, Helena!" })).toBeVisible();
  await expect(page).toHaveTitle("Consultório Exemplo");
  // The office's name with its initials: the page wears the office.
  await expect(card(page).getByText(/^CE\s*Consultório Exemplo$/)).toBeVisible();
  await expect(card(page).getByText("quinta-feira, 19 de novembro", { exact: true })).toBeVisible();
  await expect(card(page).getByText("14:00 às 15:00", { exact: true })).toBeVisible();
  await expect(card(page).getByText("Consulta", { exact: true })).toBeVisible();
  await expect(card(page).getByText("Rua das Flores, 100", { exact: true })).toBeVisible();
  // The deadline: until 23:59 of the day before (12 h before would be later than that).
  await expect(card(page).getByText("Dá para cancelar por aqui até quarta-feira, 18 de novembro, 23:59.")).toBeVisible();
  // The team's WhatsApp, with the message ready and the patient's own words.
  const team = card(page).getByRole("link", { name: "Falar com a equipe pelo WhatsApp" });
  const href = new URL((await team.getAttribute("href")) ?? "");
  expect(href.origin + href.pathname).toBe("https://wa.me/5511987654321");
  expect(href.searchParams.get("text")).toBe("Olá! Sou Helena, tenho consulta marcada para quinta-feira, 19 de novembro às 14:00 e tenho uma dúvida.");
  expect(await team.getAttribute("rel")).toContain("noreferrer");
  // Nothing of the app: no menu, no link into the Zuri.
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator('a[href^="/"]')).toHaveCount(0);
  await expectFits(page, "confirmacao-aberta");
  await expectAccessible(page, "confirmacao-aberta");
  // Every button and link is a finger wide (44 px).
  expect(await tooSmallControls(page)).toEqual([]);

  await card(page).getByRole("button", { name: "Confirmar presença" }).click();
  await expect(card(page).getByRole("status")).toContainText("Presença confirmada. Até lá, Helena!");
  await expect(card(page).getByRole("button", { name: "Confirmar presença" })).toHaveCount(0);
  // Confirmed, the patient can still cancel before the deadline.
  await expect(card(page).getByRole("button", { name: "Cancelar a consulta" })).toBeVisible();
  await expectAccessible(page, "confirmacao-confirmada");

  expect(sent.view).toEqual([{ token: TOKEN }]);
  expect(sent.answer).toEqual([{ token: TOKEN, action: "confirm" }]);
  // The token goes in a body, never in a query's address.
  expect(urls.filter((url) => url.includes("/api/") && url.includes(TOKEN))).toEqual([]);
  // Its two routes, and the app's session check, which Access refuses to the patient: the page never needs it.
  expect([...new Set(urls.map((url) => new URL(url).pathname).filter((path) => path.startsWith("/api/")))].sort()).toEqual(["/api/auth/session", "/api/c/answer", "/api/c/view"]);
});

test("cancelling asks first with 'keep' focused, Esc and 'keep' change nothing, and the answer ends the link", async ({ page }) => {
  const sent = await routeConfirm(page, ok(), () => ok({ state: "cancelled", canCancel: false }));
  await page.goto(PATH);
  await card(page).getByRole("button", { name: "Cancelar a consulta" }).click();
  const ask = page.getByRole("dialog", { name: "Cancelar a consulta?" });
  await expect(ask).toContainText("Helena, a consulta de quinta-feira, 19 de novembro, 14:00 será cancelada");
  // Enter or a double tap by mistake never cancels: "keep" has the focus.
  await expect(ask.getByRole("button", { name: "Não, manter a consulta" })).toBeFocused();
  await expectAccessible(page, "confirmacao-cancelar");
  await page.keyboard.press("Escape");
  await expect(ask).toBeHidden();
  await card(page).getByRole("button", { name: "Cancelar a consulta" }).click();
  await page.keyboard.press("Enter");
  await expect(ask).toBeHidden();
  expect(sent.answer).toEqual([]);

  await card(page).getByRole("button", { name: "Cancelar a consulta" }).click();
  await ask.getByRole("button", { name: "Sim, cancelar a consulta" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Consulta cancelada" })).toBeFocused();
  await expect(card(page).getByText("Este link deixou de valer.", { exact: false })).toBeVisible();
  await expect(card(page).getByRole("button")).toHaveCount(0);
  expect(sent.answer).toEqual([{ token: TOKEN, action: "cancel" }]);
  // Without the appointment in the message: the plain words for the team.
  const href = new URL((await card(page).getByRole("link", { name: "Falar com a equipe pelo WhatsApp" }).getAttribute("href")) ?? "");
  expect(href.searchParams.get("text")).toBe("Olá! Tenho uma dúvida sobre a minha consulta.");
});

test("past the deadline there is no cancel button, and one that ran out meanwhile shows the deadline note", async ({ page }) => {
  let view = ok({ canCancel: false });
  await routeConfirm(
    page,
    () => view,
    () => ({ status: 409, json: { code: "CONFLICT", message: "late" } }),
  );
  await page.goto(PATH);
  await expect(card(page).getByText(/O prazo para cancelar por aqui acabou/)).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Cancelar a consulta" })).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: "Confirmar presença" })).toBeVisible();

  // Open with time to cancel, then the deadline passes before the tap.
  view = ok();
  await page.reload();
  await card(page).getByRole("button", { name: "Cancelar a consulta" }).click();
  view = ok({ canCancel: false });
  await page.getByRole("dialog").getByRole("button", { name: "Sim, cancelar a consulta" }).click();
  await expect(card(page).getByText(/O prazo para cancelar por aqui acabou/)).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Cancelar a consulta" })).toHaveCount(0);
});

test.describe("dark theme", () => {
  test.use({ colorScheme: "dark" });
  test("@mobile the open and the confirmed page have no serious violation in the dark theme", async ({ page }) => {
    await routeConfirm(page, ok(), () => ok({ state: "confirmed" }));
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1, name: "Olá, Helena!" })).toBeVisible();
    await expectAccessible(page, "confirmacao-aberta-escuro");
    await card(page).getByRole("button", { name: "Confirmar presença" }).click();
    await expect(card(page).getByRole("status")).toContainText("Presença confirmada.");
    await expectAccessible(page, "confirmacao-confirmada-escuro");
  });
});

test("a link that stops working between opening and the tap says so, and a failure keeps the page", async ({ page }) => {
  let answer: Reply = { status: 503, json: { code: "SERVICE_UNAVAILABLE", message: "x" } };
  let view = ok();
  await routeConfirm(
    page,
    () => view,
    () => answer,
  );
  await page.goto(PATH);
  await card(page).getByRole("button", { name: "Confirmar presença" }).click();
  await expect(card(page).getByRole("alert")).toHaveText("Não deu para carregar agora");
  await expect(card(page).getByRole("button", { name: "Confirmar presença" })).toBeEnabled();
  // The event was deleted meanwhile: the page shows the link as it is now.
  answer = { status: 404, json: { code: "NOT_FOUND", message: "x" } };
  view = { status: 404, json: { code: "NOT_FOUND", message: "x" } };
  await card(page).getByRole("button", { name: "Confirmar presença" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Este link não vale mais" })).toBeVisible();
  await expect(card(page).getByRole("alert")).toHaveCount(0);
});

test.describe("in English", () => {
  test.use({ locale: "en-US" });
  test("the page speaks the patient's browser language", async ({ page }) => {
    await routeConfirm(page, ok());
    await page.goto(PATH);
    await expect(page.getByRole("heading", { level: 1, name: "Hello, Helena!" })).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Confirm I'm coming" })).toBeVisible();
  });
});

test("an online appointment says the call link comes later, and a team without WhatsApp shows no link", async ({ page }) => {
  await routeConfirm(page, ok({ online: true, place: "", team: "" }));
  await page.goto(PATH);
  await expect(card(page).getByText("Atendimento online: o link da chamada chega antes da consulta.")).toBeVisible();
  await expect(card(page).getByRole("link")).toHaveCount(0);
});

test("@mobile an expired, an invalid and a limited link each say what to do; a failure offers to try again", async ({ page }) => {
  await routeConfirm(page, ok({ state: "expired", canCancel: false }));
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Este link expirou" })).toBeFocused();
  await expect(card(page).getByRole("button")).toHaveCount(0);
  await expectAccessible(page, "confirmacao-expirada");
  await page.unrouteAll({ behavior: "ignoreErrors" });

  // A token out of shape is never asked about.
  const asked = await routeConfirm(page, ok());
  await page.goto("/c/curto");
  await expect(page.getByRole("heading", { level: 1, name: "Este link não vale mais" })).toBeVisible();
  expect(asked.view).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });

  await routeConfirm(page, { status: 404, json: { code: "NOT_FOUND", message: "x" } });
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Este link não vale mais" })).toBeVisible();
  await expectAccessible(page, "confirmacao-invalida");
  await page.unrouteAll({ behavior: "ignoreErrors" });

  await routeConfirm(page, { status: 429, json: { code: "RATE_LIMITED", message: "x" } });
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Muitas tentativas" })).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });

  let reply: Reply = { status: 503, json: { code: "SERVICE_UNAVAILABLE", message: "x" } };
  await routeConfirm(page, () => reply);
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Não deu para carregar agora" })).toBeVisible();
  reply = ok();
  await card(page).getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Olá, Helena!" })).toBeVisible();
});

test("the page's address is served with no cache, no referrer and no indexing, and other methods are refused", async ({ page, request }) => {
  const response = await request.get(PATH);
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(headers["content-security-policy"]).toContain("default-src");
  expect((await request.post(PATH, { headers: { "x-zuri-request": "1" } })).status()).toBe(404);
  // The app's shell, so the page itself runs: answered here, it shows the appointment.
  await routeConfirm(page, ok());
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Olá, Helena!" })).toBeVisible();
});

// The box in an appointment's details at the Agenda (cfBox).

const NOW = new Date("2026-11-16T08:00:00-03:00");
const CALENDARS = [{ id: "main", name: "Consultório", accessRole: "owner", primary: true, mode: "write", writable: true, color: "#4f7cff" }];
const appointment = (id: string, title: string, start: string, end: string, colorId = "") => ({
  id,
  calendarId: "main",
  title,
  allDay: false,
  start: new Date(start).toISOString(),
  end: new Date(end).toISOString(),
  location: "",
  description: "Consulta | Consultório",
  etag: `"v1-${id}"`,
  recurring: false,
  guests: 0,
  colorId,
});
const EVENTS = [
  appointment("e1", "Helena Duarte Prado", "2026-11-19T14:00:00-03:00", "2026-11-19T15:00:00-03:00"),
  appointment("e2", "Marina Teles Barreto", "2026-11-18T09:00:00-03:00", "2026-11-18T10:00:00-03:00", "10"),
  appointment("e3", "Caio Vasques Lima", "2026-11-17T10:00:00-03:00", "2026-11-17T11:00:00-03:00", "11"),
  appointment("e4", "Renato Sampaio Cruz", "2026-11-16T08:30:00-03:00", "2026-11-16T09:30:00-03:00"),
];

async function routeAgenda(page: Page, status: Record<string, unknown>) {
  const made: unknown[] = [];
  await page.route("**/api/google", (route) =>
    route.fulfill({ json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: "2026-11-10T13:00:00.000Z", calendars: CALENDARS } }),
  );
  await page.route("**/api/google/events?*", (route) => route.fulfill({ json: { more: false, calendars: CALENDARS, events: EVENTS } }));
  await page.route("**/api/google/events/link*", (route) => {
    if (route.request().method() === "POST") {
      made.push(route.request().postDataJSON());
      return route.fulfill({ json: { made: true, answer: "none", answeredAt: "", answerStart: "", url: `https://zuri.exemplo.com.br/c/${TOKEN}` } });
    }
    const id = new URL(route.request().url()).searchParams.get("eventId") ?? "";
    return route.fulfill({ json: status[id] ?? { made: false, answer: "none", answeredAt: "", answerStart: "" } });
  });
  return made;
}

async function openDetails(page: Page, title: string) {
  await page.getByRole("main").getByRole("button", { name: new RegExp(`^${title}`) }).click();
  return page.getByRole("dialog", { name: title });
}

// Desktop only: the phone opens on the day, and the details are the same panel.
test("an appointment's details show the patient's answer and copy the link; a cancelled, a near and an answered-before-it-moved one say so", async ({ page }) => {
  const made = await routeAgenda(page, {
    e2: { made: true, answer: "confirmed", answeredAt: "2026-11-15T13:12:00.000Z", answerStart: EVENTS[1]?.start },
    e1: { made: true, answer: "confirmed", answeredAt: "2026-11-14T13:12:00.000Z", answerStart: "2026-11-18T17:00:00.000Z" },
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install({ time: NOW });
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();

  // Answered for another start: the appointment moved, so it asks again.
  let details = await openDetails(page, "Helena Duarte Prado");
  const box = details.getByRole("region", { name: "Confirmação do paciente" });
  await expect(box.getByRole("status")).toHaveText("Ainda sem resposta");
  await expectAccessible(page, "confirmacao-detalhe");
  await box.getByRole("button", { name: "Copiar link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copiado" }).first()).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`https://zuri.exemplo.com.br/c/${TOKEN}`);
  expect(made).toEqual([{ calendarId: "main", eventId: "e1" }]);
  await details.getByRole("button", { name: "Fechar" }).click();

  details = await openDetails(page, "Marina Teles Barreto");
  await expect(details.getByRole("region", { name: "Confirmação do paciente" }).getByRole("status")).toHaveText("Confirmou pelo link 15 de nov., 10:12");
  await details.getByRole("button", { name: "Fechar" }).click();

  details = await openDetails(page, "Caio Vasques Lima");
  const cancelled = details.getByRole("region", { name: "Confirmação do paciente" });
  await expect(cancelled.getByRole("status")).toHaveText("Consulta cancelada: o link deixou de valer.");
  await expect(cancelled.getByRole("button")).toHaveCount(0);
  await details.getByRole("button", { name: "Fechar" }).click();

  // Less than an hour away: no link to give.
  details = await openDetails(page, "Renato Sampaio Cruz");
  const near = details.getByRole("region", { name: "Confirmação do paciente" });
  await expect(near.getByText("O link expirou 1 hora antes da consulta.")).toBeVisible();
  await expect(near.getByRole("button")).toHaveCount(0);
});
