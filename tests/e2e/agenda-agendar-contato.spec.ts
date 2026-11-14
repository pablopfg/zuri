import type { ContactAppointments, ContactDetail, ContactsStatus } from "@zuri/shared";
import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// "Agendar" on a contact's card (E5g, docs/planos/agenda-agendar-pelo-contato.md, protótipo v52): the
// Agenda opens with the contact's appointment ready, linked, at the first free hour, and says when the
// contact already has one ahead. Cancelar goes back to the card. Google and Contacts are answered here.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/** Wednesday, 18/11/2026, 10:20 in São Paulo. */
const NOW = new Date("2026-11-18T10:20:00-03:00");
const iso = (local: string) => new Date(`${local}:00-03:00`).toISOString();
const DEFAULTS = { from: 8, to: 18, view: "week", weekStart: 1, workDays: [1, 2, 3, 4, 5], daysOff: true, outside: true, lunch: { from: 720, to: 840 }, closed: [] };
const CARLA_ID = "00000000-0000-4000-8000-0000000000c1";
const NONAME_ID = "00000000-0000-4000-8000-0000000000c9";

type Body = Record<string, unknown>;

// Invented people.
const carla: ContactDetail = {
  id: CARLA_ID,
  resource: "people/c1",
  name: "Carla Mendes",
  labels: ["Pacientes"],
  phone: "(41) 99999-0001",
  email: "carla@exemplo.com.br",
  birthday: "09-02",
  birthdayFull: "1995-09-02",
  note: "",
  cpf: null,
  photo: null,
  given: "Carla",
  middle: "",
  family: "Mendes",
  nickname: "",
  phones: [{ label: "Celular", value: "(41) 99999-0001" }],
  emails: [{ label: "", value: "carla@exemplo.com.br" }],
  dates: [],
  organization: "",
  jobTitle: "",
  notes: "",
  fields: [],
  addresses: [],
  urls: [],
  relations: [],
  chats: [],
  more: {},
  sameName: 1,
  googleUrl: "https://contacts.google.com/person/c1",
};
// No name at Google: the server sends the phone in its place.
const noName: ContactDetail = { ...carla, id: NONAME_ID, resource: "people/c9", name: "(41) 99999-0117", given: "", family: "", phone: "(41) 99999-0117", email: "sem.nome@exemplo.com.br", phones: [{ label: "Celular", value: "(41) 99999-0117" }], emails: [{ label: "", value: "sem.nome@exemplo.com.br" }], sameName: 0, birthday: null, birthdayFull: null };

const status: ContactsStatus = {
  connected: true,
  enabled: true,
  status: "ok",
  problem: null,
  lastSyncAt: iso("2026-11-18T10:00"),
  nextSyncAt: iso("2026-11-18T10:25"),
  lastResult: "unchanged",
  refreshing: false,
  labelsRead: true,
  syncEveryMinutes: 5,
  contacts: 2,
  labels: [{ id: "contactGroups/pacientes", name: "Pacientes", count: 2, selected: true }],
  reminders: { birthdays: false, dates: false, time: "08:00", daysAhead: 0, match: "" },
  onAdded: "off",
};

async function routeAll(page: Page, next: ContactAppointments["next"] = null) {
  // This morning is taken until 11:00: the first free hour is 11:00.
  const events: Body[] = [
    {
      id: "e1",
      calendarId: "main",
      title: "Paula Régis",
      allDay: false,
      start: iso("2026-11-18T10:00"),
      end: iso("2026-11-18T11:00"),
      location: "",
      description: "Consulta | Consultório",
      etag: '"v1-e1"',
      recurring: false,
      guests: 0,
      colorId: "",
    },
  ];
  const sent = { posts: [] as Body[], ranges: [] as string[] };
  const calendars = [{ id: "main", name: "Consultório", accessRole: "owner", primary: true, mode: "write", writable: true, color: "#4f7cff" }];
  await page.route("**/api/google", (route) =>
    route.fulfill({ json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: iso("2026-11-10T10:00"), calendars } }),
  );
  await page.route("**/api/google/events?*", (route) => {
    sent.ranges.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { more: false, calendars, events } });
  });
  await page.route("**/api/google/events", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as Body;
    sent.posts.push(body);
    return route.fulfill({ status: 201, json: { event: { ...events[0], id: "n1", title: body.title, start: iso(String(body.start)), end: iso(String(body.end)) } } });
  });
  await page.route("**/api/google/contacts", (route) => route.fulfill({ json: status }));
  await page.route("**/api/contacts?*", (route) => route.fulfill({ json: { contacts: [], next: null } }));
  for (const contact of [carla, noName]) {
    await page.route(`**/api/contacts/${contact.id}`, (route) => route.fulfill({ json: { contact } }));
    await page.route(`**/api/contacts/${contact.id}/appointments`, (route) => route.fulfill({ json: { available: true, last: null, next: contact === carla ? next : null, more: false } satisfies ContactAppointments }));
  }
  return sent;
}

async function openCard(page: Page, id: string) {
  await page.clock.setFixedTime(NOW);
  await page.goto(`/contatos/${id}`);
  await signIn(page);
}

const form = (page: Page) => page.getByRole("dialog", { name: "Novo evento" });

test.afterEach(async ({ page }) => {
  await page.request.patch("/api/settings", { headers: CSRF, data: { agenda: DEFAULTS } });
});

test("Agendar on the card opens the appointment linked, at the first free hour, and says the one ahead", async ({ page }) => {
  const sent = await routeAll(page, { start: iso("2026-11-26T09:00"), allDay: false, kind: "return", type: "Retorno", place: "Consultório", certain: true });
  await openCard(page, CARLA_ID);
  await page.getByRole("link", { name: "Agendar com Carla Mendes" }).click();
  await expect(page).toHaveURL(/\/agenda$/);
  const dialog = form(page);
  // QA-E5g-02: the line is the dialog's description, so a screen reader hears it with the title.
  await expect(dialog).toHaveAccessibleDescription("Já vem com os dados de Carla Mendes e no primeiro horário livre: qua, 18/11 às 11:00. Confira antes de agendar. Atenção: já existe “Retorno” em qui, 26/11 às 09:00.");
  // The contact was chosen: linked even with a homonym, and the focus goes to the day.
  await expect(dialog.getByText("Vinculado a Carla Mendes, nasc. 02/09/1995")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Nome completo do paciente" })).toHaveValue("Carla Mendes");
  await expect(dialog.getByLabel("Data da consulta")).toBeFocused();
  await expect(dialog.getByLabel("Data da consulta")).toHaveValue("18/11/2026");
  await expect(dialog.getByLabel("Hora do início")).toHaveValue("11:00");
  await expect(dialog.getByText(/mais de um contato|contatos chamados/)).toHaveCount(0);
  await expectAccessible(page, "agenda-agendar-contato");
  // The month and the next one were read for the free hour.
  expect(sent.ranges.some((range) => range.includes("to=2026-12-"))).toBe(true);
  await dialog.getByRole("button", { name: "Criar evento" }).click();
  await expect.poll(() => sent.posts.length).toBe(1);
  expect(sent.posts[0]).toMatchObject({ title: "Carla Mendes", contact: "people/c1", start: "2026-11-18T11:00", description: "Consulta | Consultório" });
  // Linked, the phone and the e-mail are the contact's: none of the event's own (E5f).
  expect(sent.posts[0]).toMatchObject({ phone: "", email: "" });
  // Booked, the Agenda stays, and reloading opens no form again.
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/agenda$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
  await expect(form(page)).toHaveCount(0);
});

test("Escolher na agenda keeps the contact linked when the form comes back", async ({ page }) => {
  const sent = await routeAll(page);
  await openCard(page, CARLA_ID);
  await page.getByRole("link", { name: "Agendar com Carla Mendes" }).click();
  await form(page).getByRole("button", { name: "Escolher na agenda" }).click();
  // Thursday 19/11 at 09:00, tapped on the week's grid.
  const column = page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("button", { name: /^\S+\s*19\s*, Ver o dia/ }) });
  const box = await column.locator("[data-hours]").boundingBox();
  if (!box) throw new Error("the column is not on screen");
  await page.mouse.click(box.x + box.width / 2, box.y + 56 + 3);
  await expect(form(page).getByText("Vinculado a Carla Mendes, nasc. 02/09/1995")).toBeVisible();
  await expect(form(page).getByLabel("Hora do início")).toHaveValue("09:00");
  await form(page).getByRole("button", { name: "Criar evento" }).click();
  await expect.poll(() => sent.posts.length).toBe(1);
  expect(sent.posts[0]).toMatchObject({ contact: "people/c1", start: "2026-11-19T09:00" });
});

test("Cancelar goes back to the card, with the focus on Agendar", async ({ page }) => {
  await routeAll(page);
  await openCard(page, CARLA_ID);
  await page.getByRole("link", { name: "Agendar com Carla Mendes" }).click();
  await expect(form(page).getByText(/^Já vem com os dados de Carla Mendes/)).toBeVisible();
  await form(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(page).toHaveURL(new RegExp(`/contatos/${CARLA_ID}$`));
  await expect(page.getByRole("link", { name: "Agendar com Carla Mendes" })).toBeFocused();
  // Esc and the X do the same.
  await page.getByRole("link", { name: "Agendar com Carla Mendes" }).press("Enter");
  await expect(form(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`/contatos/${CARLA_ID}$`));
  await expect(page.getByRole("link", { name: "Agendar com Carla Mendes" })).toBeFocused();
  await page.getByRole("link", { name: "Agendar com Carla Mendes" }).click();
  await form(page).getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByRole("link", { name: "Agendar com Carla Mendes" })).toBeFocused();
  // QA-E5g-08: the way back took the Agenda's place: the browser's Voltar never passes by an empty Agenda.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/agenda/);
});

test("a contact with no name at Google is not linked: its phone and e-mail come, and the name is asked", async ({ page }) => {
  const sent = await routeAll(page);
  // QA-E5g-04: the field is "Celular": the mobile number, not the landline that comes first.
  await page.route(`**/api/contacts/${NONAME_ID}`, (route) => route.fulfill({ json: { contact: { ...noName, phones: [{ label: "Trabalho", value: "(41) 3333-0001" }, ...noName.phones] } } }));
  await openCard(page, NONAME_ID);
  await page.getByRole("link", { name: "Agendar com (41) 99999-0117" }).click();
  const dialog = form(page);
  await expect(dialog).toHaveAccessibleDescription("Já vem com o celular e o e-mail do contato e no primeiro horário livre: qua, 18/11 às 11:00. Confira antes de agendar.");
  await expect(dialog.getByText("Este contato não tem nome no Google. Escreva o nome completo do paciente.")).toBeVisible();
  const name = dialog.getByRole("combobox", { name: "Nome completo do paciente" });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("");
  await expect(dialog.getByLabel("Celular com DDD")).toHaveValue("(41) 99999-0117");
  await expect(dialog.getByLabel("E-mail de contato")).toHaveValue("sem.nome@exemplo.com.br");
  await name.fill("Rita Campos");
  await expect(dialog.getByText("Este contato não tem nome no Google.", { exact: false })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Criar evento" }).click();
  await expect.poll(() => sent.posts.length).toBe(1);
  expect(sent.posts[0]).toMatchObject({ title: "Rita Campos", phone: "41999990117", email: "sem.nome@exemplo.com.br" });
  expect(sent.posts[0]).not.toHaveProperty("contact");
});

test("an address that is not a contact's id, or a contact gone, opens the Agenda without a form", async ({ page }) => {
  await routeAll(page);
  await page.clock.setFixedTime(NOW);
  await page.goto(`/agenda?agendar=${encodeURIComponent('"><img src=x onerror=window.__xss=1>')}`);
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(form(page)).toHaveCount(0);
  // Upper case, one character more, a path: never an id of the copy.
  for (const value of [CARLA_ID.toUpperCase(), `${CARLA_ID}0`, `../${CARLA_ID.slice(3)}`]) {
    await page.goto(`/agenda?agendar=${encodeURIComponent(value)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
    await expect(page).toHaveURL(/\/agenda$/);
    await expect(form(page)).toHaveCount(0);
  }
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  const gone = "00000000-0000-4000-8000-0000000000ff";
  await page.route(`**/api/contacts/${gone}`, (route) => route.fulfill({ status: 404, json: { code: "NOT_FOUND", message: "Não encontrado." } }));
  await page.goto(`/agenda?agendar=${gone}`);
  await expect(page.getByText("Este contato não está mais em Contatos.").first()).toBeVisible();
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(form(page)).toHaveCount(0);
});

test("QA-E5g-01: a reading that failed opens no form; with no calendar to write, it says how to have one", async ({ page }) => {
  await routeAll(page, { start: iso("2026-11-26T09:00"), allDay: false, kind: "return", type: "Retorno", place: "Consultório", certain: true });
  await page.route(`**/api/contacts/${CARLA_ID}/appointments`, (route) => route.fulfill({ status: 500, json: { code: "INTERNAL_ERROR", message: "Falhou." } }));
  await page.clock.setFixedTime(NOW);
  await page.goto(`/agenda?agendar=${CARLA_ID}`);
  await signIn(page);
  await expect(page.getByText("Não deu para abrir o agendamento deste contato. Tente de novo pela ficha.").first()).toBeVisible();
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(form(page)).toHaveCount(0);
  // Only a calendar to read: nowhere to book.
  await page.unroute(`**/api/contacts/${CARLA_ID}/appointments`);
  const readOnly = [{ id: "main", name: "Consultório", accessRole: "reader", primary: true, mode: "read", writable: false, color: "#4f7cff" }];
  await page.route("**/api/google", (route) =>
    route.fulfill({ json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: iso("2026-11-10T10:00"), calendars: readOnly } }),
  );
  await page.route("**/api/google/events?*", (route) => route.fulfill({ json: { more: false, calendars: readOnly, events: [] } }));
  await page.goto(`/agenda?agendar=${CARLA_ID}`);
  await expect(page.getByText("Para agendar, conecte o Google e deixe uma agenda como “Ler e editar” em Integrações.").first()).toBeVisible();
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(form(page)).toHaveCount(0);
});

test("on a phone the card's Agendar is a 44 px target and opens the form @mobile", async ({ page }) => {
  await routeAll(page);
  await openCard(page, CARLA_ID);
  const book = page.getByRole("link", { name: "Agendar com Carla Mendes" });
  await expect(book).toBeVisible();
  expect(await tooSmallControls(page), "every control of the card is a 44 px target").toEqual([]);
  await book.click();
  await expect(form(page).getByText("Vinculado a Carla Mendes, nasc. 02/09/1995")).toBeVisible();
  await expectAccessible(page, "agenda-agendar-contato-celular");
});

test("in English, the card and the form follow the language", async ({ page }) => {
  await routeAll(page);
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...((await response.json()) as object), language: "en" } });
  });
  await openCard(page, CARLA_ID);
  await page.getByRole("link", { name: "Book with Carla Mendes" }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleDescription(/^It comes with Carla Mendes's details and the first free hour: Wed, 11\/18 at 11:00\. Check it before booking\.$/);
});

test.describe("on a device in another time zone", () => {
  test.use({ timezoneId: "Asia/Tokyo" });
  test("the first free hour is the owner's, in São Paulo", async ({ page }) => {
    await routeAll(page);
    await openCard(page, CARLA_ID);
    await page.getByRole("link", { name: "Agendar com Carla Mendes" }).click();
    await expect(form(page)).toHaveAccessibleDescription(/primeiro horário livre: qua, 18\/11 às 11:00\./);
    await expect(form(page).getByLabel("Hora do início")).toHaveValue("11:00");
  });
});
