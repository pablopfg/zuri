import type { BookingPage, BookingPerson } from "@zuri/shared";
import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// The link of an appointment to Contacts (E5f, docs/planos/agenda-vinculo-com-contatos.md, protótipo
// v52): the name field looks in the copy of Contacts, nothing links on its own, and homonyms need the
// right contact or "É outra pessoa" with a phone. Google and Contacts are answered here.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/** Wednesday, 18/11/2026, 10:20 in São Paulo. */
const NOW = new Date("2026-11-18T10:20:00-03:00");
const iso = (local: string) => new Date(`${local}:00-03:00`).toISOString();
const HOUR_PX = 56;
const DEFAULTS = { from: 8, to: 18, view: "week", weekStart: 1, workDays: [1, 2, 3, 4, 5], daysOff: true, outside: true, lunch: { from: 720, to: 840 }, closed: [] };
const CARLA_ID = "00000000-0000-4000-8000-0000000000c1";

// Invented people.
const PEOPLE: (BookingPerson & { same: number })[] = [
  { id: CARLA_ID, resource: "people/c1", name: "Carla Mendes", phone: "(41) 99999-0001", email: "carla@exemplo.com.br", birthday: "1995-09-02", lastVisit: "2026-11-04", same: 0 },
  { id: "00000000-0000-4000-8000-0000000000c2", resource: "people/c2", name: "Marcos Vieira Lopes", phone: "(41) 97777-0112", email: "", birthday: "1979-02-11", lastVisit: "", same: 1 },
  { id: "00000000-0000-4000-8000-0000000000c3", resource: "people/c3", name: "Marcos Vieira Lopes", phone: "(41) 96666-0113", email: "", birthday: "", lastVisit: "", same: 1 },
];
const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();

type Body = Record<string, unknown>;

const wire = (id: string, title: string, day: string, from: string, extra: Body = {}) => ({
  id,
  calendarId: "main",
  title,
  allDay: false,
  start: iso(`2026-11-${day}T${from}`),
  end: iso(`2026-11-${day}T${String(Number(from.slice(0, 2)) + 1).padStart(2, "0")}${from.slice(2)}`),
  location: "",
  description: "Consulta | Consultório",
  etag: `"v1-${id}"`,
  recurring: false,
  guests: 0,
  colorId: "",
  ...extra,
});

async function routeAgenda(page: Page) {
  const events: Body[] = [
    wire("e1", "Carla Mendes", "19", "09:00", { contact: "people/c1", contactId: CARLA_ID, payment: "paid" }),
    wire("e2", "Marcos Vieira Lopes", "19", "15:00", { country: "BR", phone: "41955550000" }),
    wire("e3", "Paula Régis", "19", "16:00", { country: "BR", phone: "41944440000" }),
  ];
  const sent = { posts: [] as Body[], patches: [] as Body[], searches: [] as string[] };
  const calendars = [{ id: "main", name: "Consultório", accessRole: "owner", primary: true, mode: "write", writable: true, color: "#4f7cff" }];
  await page.route("**/api/google", (route) =>
    route.fulfill({ json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: iso("2026-11-10T10:00"), calendars } }),
  );
  await page.route("**/api/google/events?*", (route) => route.fulfill({ json: { more: false, calendars, events } }));
  await page.route("**/api/google/events", async (route) => {
    const method = route.request().method();
    const body = route.request().postDataJSON() as Body;
    if (method === "POST") {
      sent.posts.push(body);
      return route.fulfill({ status: 201, json: { event: { ...wire(`n${sent.posts.length}`, String(body.title), "19", "11:00"), start: iso(String(body.start)), end: iso(String(body.end)) } } });
    }
    if (method !== "PATCH") return route.fallback();
    sent.patches.push(body);
    const index = events.findIndex((each) => each.id === body.eventId);
    const saved: Body = { ...events[index], etag: `"v2-${body.eventId}"`, ...(typeof body.contact === "string" ? { contact: body.contact || undefined } : {}) };
    events[index] = saved;
    return route.fulfill({ json: { event: saved } });
  });
  await page.route("**/api/contacts?*", (route) => {
    const q = fold(new URL(route.request().url()).searchParams.get("q") ?? "");
    sent.searches.push(q);
    const words = q.split(/\s+/);
    const people = PEOPLE.filter((person) => words.every((word) => fold(person.name).split(" ").some((part) => part.startsWith(word))));
    const same = PEOPLE.filter((person) => fold(person.name) === q).length;
    return route.fulfill({ json: { people: people.map(({ same: _, ...person }) => person), same } satisfies BookingPage });
  });
  await page.route(`**/api/contacts/${CARLA_ID}`, (route) =>
    route.fulfill({
      json: {
        contact: {
          id: CARLA_ID,
          name: "Carla Mendes",
          labels: ["Pacientes"],
          phone: "(41) 99999-0001",
          email: "carla@exemplo.com.br",
          birthday: "09-02",
          birthdayFull: "1995-09-02",
          note: "",
          cpf: null,
          photo: null,
          phones: [{ label: "Celular", value: "(41) 99999-0001" }],
          emails: [{ label: "", value: "carla@exemplo.com.br" }],
          sameName: 0,
        },
      },
    }),
  );
  return sent;
}

async function openAgenda(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
}

const event = (page: Page, title: string) => page.getByRole("main").getByRole("button", { name: new RegExp(`^${title}`) });
const column = (page: Page, day: string) => page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^\\S+\\s*${day}\\s*, (Ver o dia|See)`) }) });

async function clickHour(page: Page, day: string, hours: number) {
  const box = await column(page, day).locator("[data-hours]").boundingBox();
  if (!box) throw new Error("the column is not on screen");
  await page.mouse.click(box.x + box.width / 2, box.y + hours * HOUR_PX + 3);
}

test.afterEach(async ({ page }) => {
  await page.request.patch("/api/settings", { headers: CSRF, data: { agenda: DEFAULTS } });
});

test("the name finds the patient in Contacts, the link fills the data to read only, and a new name undoes it", async ({ page }) => {
  const sent = await routeAgenda(page);
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  const name = form.getByRole("combobox", { name: "Nome completo do paciente" });
  await name.fill("carla m");
  const list = form.getByRole("listbox", { name: "Contatos com este nome" });
  await expect(list.getByRole("option")).toHaveText([/^Carla Mendes\(41\) 99999-0001 · nasc\. 02\/09\/1995 · última consulta em 04\/11$/, "Agendar “carla m” sem vínculo"]);
  await expect(name).toHaveAttribute("aria-expanded", "true");
  await expectAccessible(page, "agenda-vinculo-lista");
  // The keyboard: down to Carla, Enter links; the focus goes to the day.
  await name.press("ArrowDown");
  await expect(name).toHaveAttribute("aria-activedescendant", /.+/);
  await name.press("Enter");
  await expect(name).toHaveValue("Carla Mendes");
  await expect(form.getByLabel("Data da consulta")).toBeFocused();
  await expect(form.getByText("Vinculado a Carla Mendes, nasc. 02/09/1995")).toBeVisible();
  await expect(form.getByText("carla@exemplo.com.br")).toBeVisible();
  // Linked, the phone and the e-mail are the contact's: no field of the event's own.
  await expect(form.getByLabel("Celular com DDD")).toHaveCount(0);
  expect(await tooSmallControls(page), "every control of the form is a 44 px target").toEqual([]);

  // A new name undoes the link: one person's data never stays on another's appointment.
  await name.fill("Carla Mendes S");
  await expect(form.getByText(/^Vinculado a/)).toHaveCount(0);
  await expect(form.getByLabel("Celular com DDD")).toHaveValue("");
  await name.fill("carla");
  await list.getByRole("option", { name: /^Carla Mendes/ }).click();
  await form.getByRole("button", { name: "Remover vínculo" }).click();
  await expect(form.getByLabel("Celular com DDD")).toBeVisible();
  // "Vincular" under the very name of one contact: nothing links on its own.
  await expect(form.getByText("“Carla Mendes” está em Contatos.")).toBeVisible();
  await form.getByRole("button", { name: "Vincular" }).click();
  await expect(form.getByText("Vinculado a Carla Mendes, nasc. 02/09/1995")).toBeVisible();
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "“Carla Mendes” agendado para qui, 19/11 às 10:00." }).first()).toBeVisible();
  expect(sent.posts).toEqual([
    {
      calendarId: "main",
      title: "Carla Mendes",
      allDay: false,
      start: "2026-11-19T10:00",
      end: "2026-11-19T11:00",
      location: "",
      description: "Consulta | Consultório",
      country: "",
      phone: "",
      email: "",
      payment: "unpaid",
      contact: "people/c1",
    },
  ]);
  // One letter never asks Contacts.
  expect(sent.searches.every((q) => q.length >= 2)).toBe(true);
});

test("homonyms: saving needs the right contact or É outra pessoa with a phone", async ({ page }) => {
  const sent = await routeAgenda(page);
  await openAgenda(page);
  await clickHour(page, "19", 3);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  const name = form.getByRole("combobox", { name: "Nome completo do paciente" });
  await name.fill("Marcos Vieira Lopes");
  await expect(form.getByText("2 contatos chamados “Marcos Vieira Lopes”. Escolha o certo na lista, pelo telefone e pela data de nascimento, ou toque em “É outra pessoa”.")).toBeVisible();
  const list = form.getByRole("listbox", { name: "Contatos com este nome" });
  await expect(list.getByRole("option")).toHaveText([/97777-0112 · nasc\. 11\/02\/1979$/, /96666-0113 · sem data de nascimento$/, "Agendar “Marcos Vieira Lopes” sem vínculo"]);
  await name.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(form.getByText("Escolha o contato certo na lista ou toque em “É outra pessoa”.")).toBeVisible();
  await expect(name).toBeFocused();
  expect(sent.posts).toEqual([]);

  await form.getByRole("button", { name: "É outra pessoa" }).click();
  await expect(form.getByText("Pessoa nova, com o mesmo nome de 2 contatos. O celular é obrigatório.")).toBeVisible();
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(form.getByText("Informe o celular. É ele que separa esta pessoa dos contatos com o mesmo nome.")).toBeVisible();
  await expect(form.getByLabel("Celular com DDD")).toBeFocused();
  await form.getByLabel("Celular com DDD").fill("41955550000");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(form).toHaveCount(0);
  expect(sent.posts).toHaveLength(1);
  expect(sent.posts[0]).toMatchObject({ title: "Marcos Vieira Lopes", phone: "41955550000" });
  expect(sent.posts[0]).not.toHaveProperty("contact");
});

test("the details show the linked contact or the homonyms, and Vincular opens the form with the list", async ({ page }) => {
  const sent = await routeAgenda(page);
  await openAgenda(page);
  await event(page, "Carla Mendes").click();
  const carla = page.getByRole("dialog", { name: "Carla Mendes" });
  await expect(carla.getByText("Vinculado a Carla Mendes, nasc. 02/09/1995")).toBeVisible();
  await expect(carla.getByRole("link", { name: "Abrir em Contatos" })).toHaveAttribute("href", `/contatos/${CARLA_ID}`);
  await expect(carla.getByText("Homônimo")).toHaveCount(0);
  await expectAccessible(page, "agenda-vinculo-detalhes");
  await carla.getByRole("button", { name: "Fechar" }).click();

  await event(page, "Marcos Vieira Lopes").click();
  const marcos = page.getByRole("dialog", { name: "Marcos Vieira Lopes" });
  await expect(marcos.getByText("Pessoa nova, com o mesmo nome de 2 contatos")).toBeVisible();
  await expect(marcos.getByText("+55 (41) 95555-0000")).toBeVisible();
  await marcos.getByRole("button", { name: "Fechar" }).click();

  // "Vincular": the form opens on the name, with the list of Contacts.
  await event(page, "Marcos Vieira Lopes").click();
  await page.getByRole("dialog", { name: "Marcos Vieira Lopes" }).getByRole("button", { name: "Vincular" }).click();
  const form = page.getByRole("dialog", { name: "Editar evento" });
  const list = form.getByRole("listbox", { name: "Contatos com este nome" });
  await expect(list.getByRole("option")).toHaveCount(3);
  await list.getByRole("option", { name: /97777-0112/ }).click();
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => sent.patches.length).toBe(1);
  expect(sent.patches[0]).toMatchObject({ eventId: "e2", contact: "people/c2", country: "", phone: "" });
});

test("on a phone the list of Contacts fits, with 44 px targets @mobile", async ({ page }) => {
  await routeAgenda(page);
  await openAgenda(page);
  await page.getByRole("button", { name: "Novo evento" }).click();
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByRole("combobox", { name: "Nome completo do paciente" }).fill("marcos");
  await expect(form.getByRole("listbox", { name: "Contatos com este nome" }).getByRole("option")).toHaveCount(3);
  expect(await tooSmallControls(page), "every control of the list is a 44 px target").toEqual([]);
  await expectAccessible(page, "agenda-vinculo-celular");
});

test("in English, the link's texts follow the language", async ({ page }) => {
  await routeAgenda(page);
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...((await response.json()) as object), language: "en" } });
  });
  await page.clock.setFixedTime(NOW);
  await page.goto("/agenda");
  await signIn(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "New event" });
  await form.getByRole("combobox").first().fill("carla");
  await expect(form.getByRole("option", { name: "Book “carla” without a link" })).toBeVisible();
  await form.getByRole("option", { name: /^Carla Mendes/ }).click();
  await expect(form.getByText("Linked to Carla Mendes, born 02/09/1995")).toBeVisible();
});
