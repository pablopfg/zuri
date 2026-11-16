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
  canReschedule: false,
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
const MESSAGE = `Olá, Helena! Sua *consulta* está marcada.\nConfirme por este link:\nhttps://zuri.exemplo.com.br/c/${"A".repeat(22)}`;
const EVENTS = [
  { ...appointment("e1", "Helena Duarte Prado", "2026-11-19T14:00:00-03:00", "2026-11-19T15:00:00-03:00"), country: "BR", phone: "41999990000", email: "helena@exemplo.com.br" },
  appointment("e2", "Marina Teles Barreto", "2026-11-18T09:00:00-03:00", "2026-11-18T10:00:00-03:00", "10"),
  appointment("e3", "Caio Vasques Lima", "2026-11-17T10:00:00-03:00", "2026-11-17T11:00:00-03:00", "11"),
  appointment("e4", "Renato Sampaio Cruz", "2026-11-16T08:30:00-03:00", "2026-11-16T09:30:00-03:00"),
  appointment("e5", "Paula Reis Moura", "2026-11-18T15:00:00-03:00", "2026-11-18T16:00:00-03:00", "5"),
  { ...appointment("e6", "Lívia Prates Nunes", "2026-11-19T10:00:00-03:00", "2026-11-19T11:00:00-03:00"), email: "livia@exemplo.com.br" },
  // E7c3a: on Saturday the 21st, after the 20th (Consciência Negra, a national holiday).
  { ...appointment("e7", "Otávio Brandão Reis", "2026-11-21T09:00:00-03:00", "2026-11-21T10:00:00-03:00"), country: "BR", phone: "41999990001" },
  { ...appointment("e8", "Sílvia Matos Rocha", "2026-11-21T11:00:00-03:00", "2026-11-21T12:00:00-03:00"), country: "BR", phone: "41999990002" },
  { ...appointment("e9", "Tomás Pires Lago", "2026-11-21T13:00:00-03:00", "2026-11-21T14:00:00-03:00"), country: "BR", phone: "41999990003" },
  { ...appointment("e10", "Vera Lúcia Campos", "2026-11-21T15:00:00-03:00", "2026-11-21T16:00:00-03:00"), country: "BR", phone: "41999990004" },
  // QA-E7c3a-2: a landline, and one confirmed by hand, the automation leaves out.
  { ...appointment("e11", "Rui Fontes Prado", "2026-11-19T16:00:00-03:00", "2026-11-19T17:00:00-03:00"), country: "BR", phone: "4133330000" },
  { ...appointment("e12", "Ester Nogueira Dias", "2026-11-18T11:00:00-03:00", "2026-11-18T12:00:00-03:00", "10"), country: "BR", phone: "41999990005" },
];

async function routeAgenda(page: Page, status: Record<string, unknown>) {
  const made: unknown[] = [];
  const sent: unknown[] = [];
  await page.route("**/api/google", (route) =>
    route.fulfill({ json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: "2026-11-10T13:00:00.000Z", calendars: CALENDARS } }),
  );
  await page.route("**/api/google/events?*", (route) => route.fulfill({ json: { more: false, calendars: CALENDARS, events: EVENTS } }));
  await page.route("**/api/google/events/link*", (route) => {
    if (route.request().method() === "POST") {
      made.push(route.request().postDataJSON());
      return route.fulfill({ json: { made: true, answer: "none", answeredAt: "", answerStart: "", url: `https://zuri.exemplo.com.br/c/${TOKEN}`, message: MESSAGE } });
    }
    const id = new URL(route.request().url()).searchParams.get("eventId") ?? "";
    return route.fulfill({ json: status[id] ?? { made: false, answer: "none", answeredAt: "", answerStart: "" } });
  });
  // E7c1: the WhatsApp send, recorded; the status says so from then on.
  await page.route("**/api/google/events/link/sent", (route) => {
    const body = route.request().postDataJSON() as { eventId: string };
    sent.push(body);
    const now = { made: true, answer: "none", answeredAt: "", answerStart: "", sentChannel: "whatsapp", sentAt: "2026-11-16T11:00:00.000Z", sentStart: EVENTS.find((event) => event.id === body.eventId)?.start ?? "" };
    status[body.eventId] = now;
    return route.fulfill({ json: now });
  });
  // E7c2: the e-mail, sent by the server to the appointment's own e-mail; the status says so.
  const mailed: unknown[] = [];
  await page.route("**/api/google/events/link/mail", (route) => {
    const body = route.request().postDataJSON() as { eventId: string };
    mailed.push(body);
    const start = EVENTS.find((event) => event.id === body.eventId)?.start ?? "";
    const now = { made: true, answer: "none", answeredAt: "", answerStart: "", sentChannel: "email", sentAt: "2026-11-16T11:00:00.000Z", sentStart: start, mailedStart: start };
    status[body.eventId] = now;
    return route.fulfill({ json: now });
  });
  return Object.assign(made, { sent, mailed });
}

async function openDetails(page: Page, title: string) {
  await page.getByRole("main").getByRole("button", { name: new RegExp(`^(Fora do horário de atendimento: )?${title}`) }).click();
  return page.getByRole("dialog", { name: title });
}

// E7c2: "Enviar por e-mail" sends to the appointment's e-mail through the server, and goes for that start.
test("an appointment with the patient's e-mail sends the confirmation by e-mail once for its start; a refusal says why", async ({ page }) => {
  const made = await routeAgenda(page, {});
  await page.clock.install({ time: NOW });
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
  let details = await openDetails(page, "Helena Duarte Prado");
  let box = details.getByRole("region", { name: "Confirmação do paciente" });
  await box.getByRole("button", { name: "Enviar por e-mail" }).click();
  await expect(page.getByRole("status").filter({ hasText: "E-mail enviado para Helena" }).first()).toBeVisible();
  expect(made.mailed).toEqual([{ calendarId: "main", eventId: "e1" }]);
  await expect(box.getByText("Enviado por e-mail 16 de nov., 08:00. Ainda sem resposta.", { exact: true })).toBeVisible();
  await expect(box.getByRole("button", { name: "Enviar por e-mail" })).toHaveCount(0);
  // WhatsApp still there, as "send again" (the protótipo's cf.st): the e-mail doesn't take its place.
  await expect(box.getByRole("button", { name: "Enviar de novo" })).toBeVisible();
  await details.getByRole("button", { name: "Fechar" }).click();

  // An appointment without the patient's e-mail has no button.
  details = await openDetails(page, "Paula Reis Moura");
  await expect(details.getByRole("region", { name: "Confirmação do paciente" }).getByRole("button", { name: "Enviar por e-mail" })).toHaveCount(0);
  await details.getByRole("button", { name: "Fechar" }).click();

  // The e-mail way out refuses: the reason, and nothing changes.
  await page.route("**/api/google/events/link/mail", (route) =>
    route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE", message: "O e-mail não saiu. Confira Integrações › E-mail para pacientes e tente de novo.", details: { problem: "not_configured" } } }),
  );
  details = await openDetails(page, "Lívia Prates Nunes");
  box = details.getByRole("region", { name: "Confirmação do paciente" });
  await box.getByRole("button", { name: "Enviar por e-mail" }).click();
  await expect(page.getByRole("status").filter({ hasText: "O e-mail não saiu. Confira Integrações › E-mail para pacientes e tente de novo." }).first()).toBeVisible();
  await expect(box.getByText("Ainda não enviado", { exact: true })).toBeVisible();
  await expect(box.getByRole("button", { name: "Enviar por e-mail" })).toBeVisible();
});

// E11c: an appointment linked to a contact sends where the server says: the responsible's mobile and e-mail.
test("a linked appointment says the messages go to the responsible and sends there; one whose responsible left the labels sends nowhere", async ({ page }) => {
  const LUCAS = "00000000-0000-4000-8000-0000000000d1";
  const CAIO = "00000000-0000-4000-8000-0000000000d2";
  const linked = [
    { ...appointment("e21", "Lucas Prado", "2026-11-19T09:00:00-03:00", "2026-11-19T10:00:00-03:00"), contact: "people/c11", contactId: LUCAS },
    { ...appointment("e22", "Caio Melo", "2026-11-19T11:00:00-03:00", "2026-11-19T12:00:00-03:00"), contact: "people/c12", contactId: CAIO },
  ];
  const made = await routeAgenda(page, {});
  await page.route("**/api/google/events?*", (route) => route.fulfill({ json: { more: false, calendars: CALENDARS, events: [...EVENTS, ...linked] } }));
  // Invented people: Lucas's own data at Google, and where the server says his messages go.
  const contact = (id: string, name: string) => ({ id, name, labels: ["Pacientes"], phone: "", email: "", birthday: "", birthdayFull: "", note: "", cpf: null, photo: null, phones: [], emails: [], sameName: 0 });
  await page.route(`**/api/contacts/${LUCAS}`, (route) =>
    route.fulfill({ json: { contact: contact(LUCAS, "Lucas Prado"), reach: { phone: "+5511988880010", email: "helena@exemplo.com.br", via: { name: "Helena Prado", role: "mother" }, gone: false } } }),
  );
  await page.route(`**/api/contacts/${CAIO}`, (route) => route.fulfill({ json: { contact: contact(CAIO, "Caio Melo"), reach: { phone: "", email: "", via: null, gone: true } } }));
  await page.clock.install({ time: NOW });
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();

  let details = await openDetails(page, "Lucas Prado");
  await expect(details.getByText("As mensagens vão para Helena Prado (mãe).", { exact: true })).toBeVisible();
  await expectAccessible(page, "confirmacao-responsavel");
  const box = details.getByRole("region", { name: "Confirmação do paciente" });
  await page.context().route("https://wa.me/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>WhatsApp</title>" }));
  const opening = page.waitForEvent("popup");
  await box.getByRole("button", { name: "Enviar pelo WhatsApp" }).click();
  const popup = await opening;
  await popup.waitForURL(/^https:\/\/wa\.me\//);
  const wa = new URL(popup.url());
  expect(wa.origin + wa.pathname).toBe("https://wa.me/5511988880010");
  await popup.close();
  await box.getByRole("button", { name: "Enviar por e-mail" }).click();
  // The server picks the address; the request names only the appointment.
  await expect.poll(() => made.mailed).toEqual([{ calendarId: "main", eventId: "e21" }]);
  await details.getByRole("button", { name: "Fechar" }).click();

  details = await openDetails(page, "Caio Melo");
  await expect(details.getByText("O responsável está fora das etiquetas escolhidas, então nenhuma mensagem sai para este paciente.", { exact: true })).toBeVisible();
  const none = details.getByRole("region", { name: "Confirmação do paciente" });
  await expect(none.getByRole("button", { name: "Copiar mensagem" })).toBeVisible();
  await expect(none.getByRole("button", { name: "Enviar pelo WhatsApp" })).toHaveCount(0);
  await expect(none.getByRole("button", { name: "Enviar por e-mail" })).toHaveCount(0);
});

// E7c3a: the automatic confirmation by Chatwoot, while it is on: when it goes, in the queue, sent, or not sent.
test("with the automatic confirmation on, the details say when it goes, that it is queued, sent or didn't go", async ({ page }) => {
  const base = { made: true, answer: "none", answeredAt: "", answerStart: "", sentChannel: "", sentAt: "", sentStart: "", mailedStart: "", autoHour: "07:00", autoState: "", autoStart: "", autoAt: "" };
  const startOf = (id: string) => EVENTS.find((event) => event.id === id)?.start ?? "";
  await routeAgenda(page, {
    e1: base,
    e6: base,
    e7: { ...base, autoState: "sent", autoStart: startOf("e7"), autoAt: "2026-11-16T10:00:05.000Z" },
    e8: { ...base, autoState: "missed", autoStart: startOf("e8"), autoAt: "2026-11-16T10:00:05.000Z" },
    e9: { ...base, autoState: "queued", autoStart: startOf("e9"), autoAt: "2026-11-16T10:00:05.000Z" },
    e10: base,
    e11: base,
    e12: base,
  });
  await page.clock.install({ time: NOW });
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
  const boxOf = async (title: string) => (await openDetails(page, title)).getByRole("region", { name: "Confirmação do paciente" });
  const close = () => page.getByRole("dialog").getByRole("button", { name: "Fechar" }).click();

  // Thursday's appointment goes on Wednesday, at the automation's hour.
  let box = await boxOf("Helena Duarte Prado");
  await expect(box.getByText("Sai sozinho pelo Chatwoot em qua., 18 de nov., às 07:00. Se você enviar antes pelo WhatsApp, o automático não repete.")).toBeVisible();
  await close();
  // Saturday's skips Friday's holiday: it goes on Thursday.
  box = await boxOf("Vera Lúcia Campos");
  await expect(box.getByText("Sai sozinho pelo Chatwoot em qui., 19 de nov., às 07:00.", { exact: false })).toBeVisible();
  await close();
  // Without a mobile there is nothing to send by Chatwoot.
  box = await boxOf("Lívia Prates Nunes");
  await expect(box.getByText("Sai sozinho pelo Chatwoot", { exact: false })).toHaveCount(0);
  await close();
  // Nor for a landline, or one marked Confirmado in the calendar.
  for (const name of ["Rui Fontes Prado", "Ester Nogueira Dias"]) {
    box = await boxOf(name);
    await expect(box.getByText("Ainda não enviado", { exact: true })).toBeVisible();
    await expect(box.getByText("Sai sozinho pelo Chatwoot", { exact: false })).toHaveCount(0);
    await close();
  }
  box = await boxOf("Otávio Brandão Reis");
  await expect(box.getByText("Enviado pelo Chatwoot 16 de nov., 07:00. Ainda sem resposta.", { exact: true })).toBeVisible();
  await expect(box.getByRole("button", { name: "Enviar de novo" })).toBeVisible();
  await close();
  box = await boxOf("Sílvia Matos Rocha");
  await expect(box.getByText("Ainda não enviado", { exact: true })).toBeVisible();
  await expect(box.getByText("Não foi enviado pelo Chatwoot. Envie pelo WhatsApp ou por e-mail.")).toBeVisible();
  await expect(box.getByRole("button", { name: "Enviar pelo WhatsApp" })).toBeVisible();
  await close();
  box = await boxOf("Tomás Pires Lago");
  await expect(box.getByText("Na fila do Chatwoot. Ainda sem resposta.", { exact: true })).toBeVisible();
  await expectAccessible(page, "confirmacao-automatica");
});

// Desktop only: the phone opens on the day, and the details are the same panel.
test("an appointment's details show the patient's answer and copy the link; a cancelled, a near and an answered-before-it-moved one say so", async ({ page }) => {
  const made = await routeAgenda(page, {
    e2: { made: true, answer: "confirmed", answeredAt: "2026-11-15T13:12:00.000Z", answerStart: EVENTS[1]?.start },
    e1: { made: true, answer: "confirmed", answeredAt: "2026-11-14T13:12:00.000Z", answerStart: "2026-11-18T17:00:00.000Z" },
    e5: { made: true, answer: "rescheduled", answeredAt: "2026-11-15T13:12:00.000Z", answerStart: EVENTS[4]?.start, previousStart: "2026-11-17T17:00:00.000Z" },
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install({ time: NOW });
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();

  // Answered for another start: the appointment moved, so it asks again.
  let details = await openDetails(page, "Helena Duarte Prado");
  const box = details.getByRole("region", { name: "Confirmação do paciente" });
  await expect(box.getByText("Ainda não enviado", { exact: true })).toBeVisible();
  await expectAccessible(page, "confirmacao-detalhe");
  expect(await tooSmallControls(page)).toEqual([]);
  await box.getByRole("button", { name: "Copiar mensagem" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mensagem copiada" }).first()).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(MESSAGE);
  expect([...made]).toEqual([{ calendarId: "main", eventId: "e1" }]);
  // Copying sends nothing: still not sent.
  expect(made.sent).toEqual([]);
  await expect(box.getByRole("link", { name: "Editar a mensagem modelo" })).toHaveAttribute("href", "/configuracoes/consultorio");

  // E7c1: WhatsApp opens with the filled message to the patient's mobile, and counts as sent.
  await page.context().route("https://wa.me/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>WhatsApp</title>" }));
  const opening = page.waitForEvent("popup");
  await box.getByRole("button", { name: "Enviar pelo WhatsApp" }).click();
  const popup = await opening;
  await popup.waitForURL(/^https:\/\/wa\.me\//);
  const wa = new URL(popup.url());
  expect(wa.origin + wa.pathname).toBe("https://wa.me/5541999990000");
  expect(wa.searchParams.get("text")).toBe(MESSAGE);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
  expect(made.sent).toEqual([{ calendarId: "main", eventId: "e1", channel: "whatsapp" }]);
  await expect(box.getByText("Enviado pelo WhatsApp 16 de nov., 08:00. Ainda sem resposta.", { exact: true })).toBeVisible();
  await expect(box.getByRole("button", { name: "Enviar de novo" })).toBeVisible();
  // A record that fails leaves the WhatsApp tab open with the message, and says so.
  await page.route("**/api/google/events/link/sent", (route) => route.fulfill({ status: 409, json: { code: "CONFLICT", message: "Envio sem registro." } }));
  const again = page.waitForEvent("popup");
  await box.getByRole("button", { name: "Enviar de novo" }).click();
  const kept = await again;
  await expect(page.getByRole("status").filter({ hasText: "Envio sem registro." }).first()).toBeVisible();
  expect(kept.isClosed()).toBe(false);
  await kept.close();
  await page.unroute("**/api/google/events/link/sent");
  await details.getByRole("button", { name: "Fechar" }).click();

  details = await openDetails(page, "Marina Teles Barreto");
  const confirmed = details.getByRole("region", { name: "Confirmação do paciente" });
  await expect(confirmed.getByText("Confirmou pelo link 15 de nov., 10:12", { exact: true })).toBeVisible();
  // Already confirmed: nothing to send; no mobile on it either.
  await expect(confirmed.getByText("Já confirmou pelo link: não precisa enviar de novo.")).toBeVisible();
  await expect(confirmed.getByRole("button")).toHaveCount(0);
  await details.getByRole("button", { name: "Fechar" }).click();

  // Moved by the patient (E7b): when, and where it was before.
  details = await openDetails(page, "Paula Reis Moura");
  await expect(details.getByRole("region", { name: "Confirmação do paciente" }).getByText(/^Remarcou pelo link 15 de nov\., 10:12\. Antes: ter\., 17 de nov\.,? 14:00\.$/)).toBeVisible();
  await details.getByRole("button", { name: "Fechar" }).click();

  details = await openDetails(page, "Caio Vasques Lima");
  const cancelled = details.getByRole("region", { name: "Confirmação do paciente" });
  await expect(cancelled.getByText("Consulta cancelada: o link deixou de valer.", { exact: true })).toBeVisible();
  await expect(cancelled.getByRole("button")).toHaveCount(0);
  await details.getByRole("button", { name: "Fechar" }).click();

  // Less than an hour away: no link to give.
  details = await openDetails(page, "Renato Sampaio Cruz");
  const near = details.getByRole("region", { name: "Confirmação do paciente" });
  await expect(near.getByText("O link expirou 1 hora antes da consulta.")).toBeVisible();
  await expect(near.getByRole("button")).toHaveCount(0);
});

// ---------- E7b: "Preciso remarcar" ----------

const MOVABLE = ok({ canReschedule: true });
const DAYS = {
  length: 60,
  days: [
    {
      day: "2026-11-23",
      turns: [
        { turn: "morning", from: 480, to: 720, hours: [480, 540, 600, 660] },
        { turn: "afternoon", from: 840, to: 1080, hours: [840, 900, 960, 1020] },
      ],
    },
    { day: "2026-11-24", turns: [{ turn: "afternoon", from: 840, to: 1080, hours: [840, 900, 960, 1020] }] },
  ],
};

/** The three routes of the steps; `move` answers the tap. Returns the bodies sent. */
async function routeReschedule(page: Page, options: { days?: unknown; offers?: number[][]; move?: () => Reply } = {}) {
  const sent: { days: unknown[]; offer: unknown[]; move: unknown[] } = { days: [], offer: [], move: [] };
  const offers = [...(options.offers ?? [[540, 660]])];
  await page.route("**/api/c/days", (route) => {
    sent.days.push(route.request().postDataJSON());
    return route.fulfill({ json: options.days ?? DAYS });
  });
  await page.route("**/api/c/offer", (route) => {
    sent.offer.push(route.request().postDataJSON());
    return route.fulfill({ json: { slots: offers.length > 1 ? offers.shift() : offers[0] } });
  });
  await page.route("**/api/c/reschedule", (route) => {
    sent.move.push(route.request().postDataJSON());
    const reply = options.move?.() ?? ok({ state: "rescheduled", start: "2026-11-23T12:00:00.000Z", end: "2026-11-23T13:00:00.000Z", canReschedule: true });
    return route.fulfill({ status: reply.status, json: reply.json });
  });
  return sent;
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

test("@mobile rescheduling goes day, half, hour and slot, asks first with 'Voltar' focused, and shows the new time; accessible", async ({ page }) => {
  await routeConfirm(page, MOVABLE);
  const sent = await routeReschedule(page);
  await page.goto(PATH);
  // Instead of "talk to the team", the button.
  await expect(card(page).getByText("Para mudar o dia ou o horário, fale com a nossa equipe pelo WhatsApp.")).toHaveCount(0);
  await card(page).getByRole("button", { name: "Preciso remarcar" }).click();

  await expect(heading(page, "Para quando, Helena?")).toBeFocused();
  await expect(card(page).getByText("Passo 1 de 4")).toBeVisible();
  await expect(card(page).getByText("Consulta marcada")).toBeVisible();
  await expect(card(page).getByText("quinta-feira, 19 de novembro, às 14:00", { exact: true })).toBeVisible();
  const team = card(page).getByRole("link", { name: "Fale com a nossa equipe pelo WhatsApp" });
  expect(new URL((await team.getAttribute("href")) ?? "").searchParams.get("text")).toBe(
    "Olá! Sou Helena, tenho consulta marcada para quinta-feira, 19 de novembro às 14:00 e não achei um bom horário para remarcar pelo link. Vocês podem me ajudar?",
  );
  await expectFits(page, "remarcar-dia");
  await expectAccessible(page, "remarcar-dia");
  expect(await tooSmallControls(page)).toEqual([]);
  await card(page).getByRole("button", { name: /segunda-feira\s*23 de nov/ }).click();

  await expect(heading(page, "Manhã ou tarde?")).toBeFocused();
  await expect(card(page).getByText("Passo 2 de 4")).toBeVisible();
  await card(page).getByRole("button", { name: /Manhã\s*das 08:00 às 12:00/ }).click();

  await expect(heading(page, "Que horário fica melhor?")).toBeFocused();
  const hours = card(page).getByRole("group", { name: "Horário de preferência" });
  await expect(hours.getByRole("button")).toHaveText(["08:00", "09:00", "10:00", "11:00"]);
  await hours.getByRole("button", { name: "11:00" }).click();

  await expect(heading(page, "Horários para você")).toBeFocused();
  await expect(card(page).getByRole("listitem")).toHaveText(["09:00 até 10:00", "11:00 até 12:00"]);
  await expectAccessible(page, "remarcar-horarios");
  expect(await tooSmallControls(page)).toEqual([]);
  await card(page).getByRole("button", { name: "09:00 até 10:00" }).click();

  const ask = page.getByRole("dialog", { name: "Remarcar para este horário?" });
  await expect(ask).toContainText("segunda-feira, 23 de novembro, das 09:00 às 10:00. O horário de quinta-feira, 19 de novembro, 14:00 fica livre para outra pessoa.");
  await expect(ask.getByRole("button", { name: "Voltar" })).toBeFocused();
  await expectAccessible(page, "remarcar-confirmar");
  await ask.getByRole("button", { name: "Sim, remarcar" }).click();

  await expect(card(page).getByRole("status")).toContainText("Consulta remarcada. Até lá, Helena! O novo dia e horário estão abaixo.");
  await expect(card(page).getByText("segunda-feira, 23 de novembro", { exact: true })).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Confirmar presença" })).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: "Preciso remarcar" })).toBeVisible();
  expect(sent.days).toEqual([{ token: TOKEN }]);
  expect(sent.offer).toEqual([{ token: TOKEN, day: "2026-11-23", turn: "morning", pref: 660 }]);
  expect(sent.move).toEqual([{ token: TOKEN, day: "2026-11-23", turn: "morning", pref: 660, start: 540 }]);
});

test("an hour taken meanwhile says so and offers what is left; a day with one half skips step 2 and Voltar walks back", async ({ page }) => {
  await routeConfirm(page, MOVABLE);
  let tries = 0;
  const sent = await routeReschedule(page, {
    offers: [[900, 1020], [1020]],
    move: () => (tries++ === 0 ? { status: 409, json: { code: "CONFLICT", message: "x", details: { problem: "taken" } } } : ok({ state: "rescheduled", canReschedule: true })),
  });
  await page.goto(PATH);
  await card(page).getByRole("button", { name: "Preciso remarcar" }).click();
  await card(page).getByRole("button", { name: /terça-feira\s*24 de nov/ }).click();
  // One half only: straight to the hours, and back to the days.
  await expect(heading(page, "Que horário fica melhor?")).toBeVisible();
  await expect(card(page).getByText("Passo 3 de 4")).toBeVisible();
  await card(page).getByRole("button", { name: "Voltar" }).click();
  await expect(heading(page, "Para quando, Helena?")).toBeVisible();
  await card(page).getByRole("button", { name: /terça-feira\s*24 de nov/ }).click();
  await card(page).getByRole("button", { name: "14:00" }).click();
  await card(page).getByRole("button", { name: "15:00 até 16:00" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sim, remarcar" }).click();

  await expect(card(page).getByRole("alert")).toHaveText("Esse horário acabou de ser ocupado. Escolha outro.");
  await expect(card(page).getByRole("listitem")).toHaveText(["17:00 até 18:00"]);
  expect(sent.offer).toHaveLength(2);
  await card(page).getByRole("button", { name: "17:00 até 18:00" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sim, remarcar" }).click();
  await expect(card(page).getByRole("status")).toContainText("Consulta remarcada.");
  // Voltar on the first step goes back to the page as it was.
  await card(page).getByRole("button", { name: "Preciso remarcar" }).click();
  await card(page).getByRole("button", { name: "Voltar" }).click();
  await expect(card(page).getByRole("status")).toContainText("Consulta remarcada.");
});

for (const [status, code] of [
  [429, "RATE_LIMITED"],
  [503, "SERVICE_UNAVAILABLE"],
] as const) {
  test(`a move refused with ${status} says so on the slots and keeps the appointment where it was`, async ({ page }) => {
    await routeConfirm(page, MOVABLE);
    let tries = 0;
    const sent = await routeReschedule(page, { move: () => (tries++ === 0 ? { status, json: { code, message: "x" } } : ok({ state: "rescheduled", canReschedule: true })) });
    await page.goto(PATH);
    await card(page).getByRole("button", { name: "Preciso remarcar" }).click();
    await card(page).getByRole("button", { name: /segunda-feira\s*23 de nov/ }).click();
    await card(page).getByRole("button", { name: /Manhã/ }).click();
    await card(page).getByRole("button", { name: "08:00" }).click();
    await card(page).getByRole("button", { name: "09:00 até 10:00" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sim, remarcar" }).click();
    await expect(card(page).getByRole("alert")).toHaveText("Não deu para remarcar agora. A consulta continua no horário de antes. Tente de novo em alguns minutos.");
    await expect(heading(page, "Horários para você")).toBeVisible();
    // Another tap, and it goes: the note leaves with it.
    await card(page).getByRole("button", { name: "09:00 até 10:00" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sim, remarcar" }).click();
    await expect(card(page).getByRole("status")).toContainText("Consulta remarcada.");
    expect(sent.move).toHaveLength(2);
  });
}

test("with no free day it offers WhatsApp; the cancel dialog offers to reschedule; past two moves only the team", async ({ page }) => {
  let view = MOVABLE;
  await routeConfirm(page, () => view);
  await routeReschedule(page, { days: { length: 60, days: [] } });
  await page.goto(PATH);
  await card(page).getByRole("button", { name: "Cancelar a consulta" }).click();
  const ask = page.getByRole("dialog", { name: "Cancelar a consulta?" });
  await expect(ask).toContainText("Se for só o dia ou o horário que não dá, você pode remarcar agora.");
  await expectAccessible(page, "cancelar-remarcar");
  expect(await tooSmallControls(page)).toEqual([]);
  await ask.getByRole("button", { name: "Prefiro remarcar" }).click();
  await expect(ask).toBeHidden();
  await expect(card(page).getByText("Não há horário livre nos próximos 8 dias.")).toBeVisible();
  const whatsapp = card(page).getByRole("link", { name: "Combinar pelo WhatsApp" });
  expect(new URL((await whatsapp.getAttribute("href")) ?? "").searchParams.get("text")).toContain("não achei um bom horário para remarcar pelo link");

  view = ok({ state: "rescheduled", canReschedule: false });
  await page.reload();
  await expect(card(page).getByRole("button", { name: "Preciso remarcar" })).toHaveCount(0);
  await expect(card(page).getByText("Para mudar o dia ou o horário, fale com a nossa equipe pelo WhatsApp.")).toBeVisible();
  await card(page).getByRole("button", { name: "Cancelar a consulta" }).click();
  await expect(page.getByRole("dialog", { name: "Cancelar a consulta?" }).getByRole("button", { name: "Prefiro remarcar" })).toHaveCount(0);
});

test.describe("rescheduling in the dark theme and in English", () => {
  test.use({ colorScheme: "dark", locale: "en-US" });
  test("@mobile the steps have no serious violation and speak English", async ({ page }) => {
    await routeConfirm(page, MOVABLE);
    await routeReschedule(page);
    await page.goto(PATH);
    await card(page).getByRole("button", { name: "I need to reschedule" }).click();
    await expect(heading(page, "When works, Helena?")).toBeVisible();
    await expectAccessible(page, "remarcar-escuro-dia");
    await card(page).getByRole("button", { name: /23/ }).click();
    await card(page).getByRole("button", { name: /Morning/ }).click();
    await card(page).getByRole("button", { name: "08:00" }).click();
    await expect(heading(page, "Times for you")).toBeVisible();
    await expectAccessible(page, "remarcar-escuro-horarios");
  });
});
