import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, listenToSounds, signIn, soundsHeard, tooSmallControls } from "./ui-helpers.ts";

/** The form names its fields by what is being booked: an appointment or a plain event (E5e). */
const NAME = /^(Nome completo do paciente|Título)$/;
const DAY = /^(Data da consulta|Data)$/;

// The form of an appointment (docs/planos/agenda-formulario-v52.md, E5c, protótipo v52): "Ver no
// calendário" strikes through the days that take no appointment and offers the free hours as buttons;
// "Escolher na agenda" puts the form away while a day and an hour are tapped. Google is answered here;
// the settings go through the real server.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/** Wednesday, 18/11/2026, 10:20 in São Paulo: the week runs from Monday 16 to Sunday 22; Friday 20 is a holiday. */
const NOW = new Date("2026-11-18T10:20:00-03:00");
const iso = (local: string) => new Date(`${local}:00-03:00`).toISOString();
/** One hour of the week's grid, in pixels (3.5 rem). */
const HOUR_PX = 56;
const DEFAULTS = { from: 8, to: 18, view: "week", weekStart: 1, workDays: [1, 2, 3, 4, 5], daysOff: true, outside: true, lunch: { from: 720, to: 840 }, closed: [] };

type Sample = { title: string; day: string; from: string; to: string; description?: string; colorId?: string; changedAtGoogle?: "changed" | "deleted" | "added" };

// Invented names: the title is the person's full name and the description brings the type.
const WEEK: Sample[] = [
  { title: "Isadora Pires Falcão", day: "19", from: "09:00", to: "10:00", description: "Consulta | Consultório" },
  { title: "Renato Sampaio Cruz", day: "19", from: "14:00", to: "15:00", description: "Retorno | Consultório" },
  { title: "Reunião da equipe", day: "18", from: "15:00", to: "16:00" },
];

const wire = (sample: Sample, index: number) => ({
  id: `e${index}`,
  calendarId: "main",
  title: sample.title,
  allDay: false,
  start: iso(`2026-11-${sample.day}T${sample.from}`),
  end: iso(`2026-11-${sample.day}T${sample.to}`),
  location: "",
  description: sample.description ?? "",
  etag: `"v1-${index}"`,
  recurring: false,
  guests: 0,
  colorId: sample.colorId ?? "",
  ...(sample.changedAtGoogle ? { changedAtGoogle: sample.changedAtGoogle } : {}),
});

type Body = Record<string, unknown>;

/** Google as connected with one calendar and these events; what the screen sends is kept, and taken. */
async function routeAgenda(page: Page, samples: Sample[]) {
  const events = samples.map(wire);
  const sent = { patches: [] as Body[], posts: [] as Body[] };
  const calendars = [{ id: "main", name: "Consultório", accessRole: "owner", primary: true, mode: "write", writable: true, color: "#4f7cff" }];
  await page.route("**/api/google", (route) =>
    route.fulfill({ json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: iso("2026-11-10T10:00"), calendars } }),
  );
  // Each window gets only its own days, as Google answers: a month read for the wrong days shows.
  await page.route("**/api/google/events?*", (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    return route.fulfill({ json: { more: false, calendars, events: events.filter((each) => each.start.slice(0, 10) >= from && each.start.slice(0, 10) <= to) } });
  });
  await page.route("**/api/google/events", async (route) => {
    const method = route.request().method();
    const body = route.request().postDataJSON() as Body;
    if (method === "POST") {
      sent.posts.push(body);
      return route.fulfill({ status: 201, json: { event: { ...wire({ title: String(body.title), day: "19", from: "13:00", to: "14:00" }, events.length), start: iso(String(body.start)), end: iso(String(body.end)) } } });
    }
    if (method !== "PATCH") return route.fallback();
    sent.patches.push(body);
    const index = events.findIndex((event) => event.id === body.eventId);
    const saved = { ...(events[index] as (typeof events)[number]), etag: `"v2-${index}"` };
    if (typeof body.start === "string") saved.start = iso(body.start);
    if (typeof body.end === "string") saved.end = iso(body.end);
    events[index] = saved;
    return route.fulfill({ json: { event: saved } });
  });
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

/** A click on `hours` (decimal, from 08:00) of a day's column. */
async function clickHour(page: Page, day: string, hours: number) {
  const box = await column(page, day).locator("[data-hours]").boundingBox();
  if (!box) throw new Error("the column is not on screen");
  await page.mouse.click(box.x + box.width / 2, box.y + hours * HOUR_PX + 3);
}



// The preferences are one per installation: every test leaves them as they come.
test.afterEach(async ({ page }) => {
  await page.request.patch("/api/settings", { headers: CSRF, data: { agenda: DEFAULTS } });
});

test("Ver no calendário strikes through the closed days, offers the free hours in the length chosen and follows the date", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  // 10:00 of Thursday 19: a new appointment there.
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByLabel(NAME).fill("Bruno Macedo Teixeira");
  await form.getByRole("button", { name: "Ver no calendário" }).click();
  await expect(form.getByRole("button", { name: "Fechar o calendário" })).toHaveAttribute("aria-expanded", "true");
  const month = form.getByRole("group", { name: "Calendário de novembro de 2026" });
  // The days gone, the weekend, the holiday: struck through and said.
  await expect(month.getByRole("button", { name: "segunda-feira, 16 de novembro: já passou" })).toBeDisabled();
  await expect(month.getByRole("button", { name: "sábado, 21 de novembro: sem atendimento" })).toBeDisabled();
  await expect(month.getByRole("button", { name: "sexta-feira, 20 de novembro: feriado, Consciência Negra" })).toBeDisabled();
  await expect(month.getByRole("button", { name: "quinta-feira, 19 de novembro", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Isadora at 09:00, lunch from 12:00 to 14:00 and Renato at 14:00: an hour fits at these.
  const hours = form.getByRole("list", { name: "Horários livres em qui, 19/11, com 1 hora de duração:" });
  await expect(hours.getByRole("button")).toHaveText(["08:00", "10:00", "10:30", "11:00", "15:00", "15:30", "16:00", "16:30", "17:00"]);
  await expect(hours.getByRole("button", { name: "10:00" })).toHaveAttribute("aria-pressed", "true");
  await expectAccessible(page, "agenda-formulario-calendario");
  expect(await tooSmallControls(page), "every control of the form is a 44 px target").toEqual([]);
  await hours.getByRole("button", { name: "15:30" }).click();
  await expect(form.getByLabel("Hora do início")).toHaveValue("15:30");
  // Three hours: only 15:00 is left on Thursday.
  await form.getByLabel("Hora do término").fill("18:30");
  await expect(form.getByRole("list", { name: "Horários livres em qui, 19/11, com 3 horas de duração:" }).getByRole("button")).toHaveText(["15:00"]);
  // Another day: Monday 23, the morning before lunch and the afternoon.
  await month.getByRole("button", { name: "segunda-feira, 23 de novembro", exact: true }).click();
  await expect(form.getByLabel(DAY)).toHaveValue("23/11/2026");
  const monday = form.getByRole("list", { name: "Horários livres em seg, 23/11, com 3 horas de duração:" });
  await expect(monday.getByRole("button")).toHaveText(["08:00", "08:30", "09:00", "14:00", "14:30", "15:00"]);
  await monday.getByRole("button", { name: "09:00" }).click();
  // The arrows change the month, never back past this one; a date typed brings the calendar back to it.
  await expect(form.getByRole("button", { name: "Mês anterior" })).toBeDisabled();
  await form.getByRole("button", { name: "Próximo mês" }).click();
  await expect(form.getByRole("group", { name: "Calendário de dezembro de 2026" })).toBeVisible();
  await expect(form.getByRole("group", { name: "Calendário de dezembro de 2026" }).getByRole("button", { name: "sexta-feira, 25 de dezembro: feriado, Natal" })).toBeDisabled();
  await form.getByLabel(DAY).fill("24/11/2026");
  await expect(form.getByRole("group", { name: "Calendário de novembro de 2026" })).toBeVisible();
  await form.getByLabel(DAY).fill("23/11/2026");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(form).toHaveCount(0);
  expect(sent.posts).toHaveLength(1);
  expect(sent.posts[0]).toMatchObject({ title: "Bruno Macedo Teixeira", start: "2026-11-23T09:00", end: "2026-11-23T12:00" });
});

test("a personal event is not checked: the calendar strikes through only the days gone and offers no hours", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByLabel("Tipo do evento").selectOption("");
  await form.getByRole("button", { name: "Ver no calendário" }).click();
  const month = form.getByRole("group", { name: "Calendário de novembro de 2026" });
  await expect(month.getByRole("button", { name: "segunda-feira, 16 de novembro: já passou" })).toBeDisabled();
  await expect(month.getByRole("button", { name: "sábado, 21 de novembro", exact: true })).toBeEnabled();
  await expect(form.getByText(/Horários livres em/)).toHaveCount(0);
});

test("Escolher na agenda puts the form away, keeps what was typed and brings it back with the day and hour tapped", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByLabel(NAME).fill("Bruno Macedo Teixeira");
  await form.getByLabel("Celular com DDD").fill("41999990000");
  await form.getByLabel("Local", { exact: true }).selectOption("Online");
  await form.getByRole("button", { name: "Escolher na agenda" }).click();
  await expect(form).toHaveCount(0);
  const banner = page.getByRole("status").filter({ hasText: "Toque no dia e na hora da consulta de Bruno Macedo Teixeira." });
  await expect(banner).toBeVisible();
  // The way back by the keyboard: the form is gone, the focus is on the band's Cancelar.
  await expect(banner.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await expectAccessible(page, "agenda-formulario-escolher");
  // A closed hour says why, as always, and the banner stays.
  await clickHour(page, "19", 4.5);
  await expect(page.getByRole("dialog", { name: "Consulta não entra neste horário" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(banner).toBeVisible();
  // Wednesday 18 at 11:00: the form comes back with it and with what was typed.
  await clickHour(page, "18", 3);
  await expect(banner).toHaveCount(0);
  await expect(form.getByLabel(NAME)).toHaveValue("Bruno Macedo Teixeira");
  await expect(form.getByLabel("Celular com DDD")).toHaveValue("(41) 99999-0000");
  await expect(form.getByLabel("Local", { exact: true })).toHaveValue("Online");
  await expect(form.getByLabel(DAY)).toHaveValue("18/11/2026");
  await expect(form.getByLabel("Hora do início")).toHaveValue("11:00");
  // Cancelar brings the form back as it was.
  await form.getByRole("button", { name: "Escolher na agenda" }).click();
  await page.getByRole("status").filter({ hasText: "Toque no dia e na hora" }).getByRole("button", { name: "Cancelar" }).click();
  await expect(form.getByLabel("Hora do início")).toHaveValue("11:00");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(form).toHaveCount(0);
  expect(sent.posts[0]).toMatchObject({ title: "Bruno Macedo Teixeira", description: "Consulta | Online", phone: "41999990000", meet: true, start: "2026-11-18T11:00", end: "2026-11-18T12:00" });
});

test("changing an appointment frees its own hour and offers no Escolher na agenda", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  await event(page, "Isadora Pires Falcão").click();
  await page.getByRole("dialog", { name: "Isadora Pires Falcão" }).getByRole("button", { name: "Editar" }).click();
  const form = page.getByRole("dialog", { name: "Editar evento" });
  await expect(form.getByRole("button", { name: "Escolher na agenda" })).toHaveCount(0);
  await form.getByRole("button", { name: "Ver no calendário" }).click();
  await expect(form.getByRole("list", { name: /^Horários livres em qui, 19\/11/ }).getByRole("button", { name: "09:00" })).toHaveAttribute("aria-pressed", "true");
});

test("in English the calendar and the notice speak English", async ({ page }) => {
  await routeAgenda(page, WEEK);
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
  await form.getByLabel("Patient's full name").fill("Helena Duarte Prado");
  await form.getByRole("button", { name: "See on the calendar" }).click();
  await expect(form.getByRole("button", { name: "Saturday, November 21: no appointments" })).toBeDisabled();
  await form.getByLabel("Start time").fill("12:30");
  await form.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByRole("alertdialog", { name: "No appointments at this time" }).getByRole("button", { name: "Use this time" })).toBeVisible();
});

test("on a phone the calendar fills the form with 44 px targets and is the way to pick, with no Escolher na agenda @mobile", async ({ page, isMobile }) => {
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  await page.getByRole("button", { name: "Novo evento" }).click();
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByLabel(NAME).fill("Bruno Macedo Teixeira");
  await form.getByLabel(DAY).fill("19/11/2026");
  await form.getByRole("button", { name: "Ver no calendário" }).click();
  const hours = form.getByRole("list", { name: "Horários livres em qui, 19/11, com 1 hora de duração:" });
  await hours.getByRole("button", { name: "15:00" }).click();
  await expect(form.getByLabel("Hora do início")).toHaveValue("15:00");
  await expectAccessible(page, "agenda-formulario-celular");
  expect(await tooSmallControls(page), "every control of the form is a 44 px target").toEqual([]);
  // The month is as wide as the form: no sideways scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // A phone shows the day as a list, with no hour to tap: there the calendar is the way, and "Escolher na agenda" is not offered.
  await expect(form.getByRole("button", { name: "Escolher na agenda" })).toHaveCount(isMobile ? 0 : 1);
});

test("the hours come from the form's own month, never from the month shown, and a month that fails offers none", async ({ page }) => {
  // Clara at 08:00 of Thursday 26: only November's window holds her.
  await routeAgenda(page, [...WEEK, { title: "Clara Nunes Bastos", day: "26", from: "08:00", to: "09:00", description: "Consulta | Consultório" }]);
  await page.route("**/api/google/events?from=2026-11-30*", (route) => route.fulfill({ status: 502, json: { code: "GOOGLE_UNAVAILABLE", message: "Google fora do ar." } }));
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByLabel(NAME).fill("Bruno Macedo Teixeira");
  await form.getByLabel(DAY).fill("26/11/2026");
  await form.getByRole("button", { name: "Ver no calendário" }).click();
  const hours = form.getByRole("list", { name: "Horários livres em qui, 26/11, com 1 hora de duração:" });
  await expect(hours.getByRole("button").first()).toHaveText("09:00");
  // December's window starts on Monday 30: it fails here, and the hours of the 26th stay as November has them.
  await form.getByRole("button", { name: "Próximo mês" }).click();
  await expect(form.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await expect(hours.getByRole("button").first()).toHaveText("09:00");
  // A day in the month that failed: no hour is offered from events not read.
  await form.getByLabel(DAY).fill("02/12/2026");
  await expect(form.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await expect(form.getByText(/Horários livres em/)).toHaveCount(0);
});

test("a month all off says so, and the period off is struck through with its reason", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  expect((await page.request.patch("/api/settings", { headers: CSRF, data: { agenda: { ...DEFAULTS, closed: [{ from: "2026-12-01", to: "2026-12-31", reason: "Férias" }] } } })).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByRole("button", { name: "Ver no calendário" }).click();
  await form.getByRole("button", { name: "Próximo mês" }).click();
  const december = form.getByRole("group", { name: "Calendário de dezembro de 2026" });
  await expect(december.getByRole("button", { name: "terça-feira, 1 de dezembro: sem expediente" })).toBeDisabled();
  await expect(form.getByText("Nenhum dia livre neste mês. Veja o próximo.")).toBeVisible();
});

test("the refusal over the form plays the refusal sound", async ({ page }) => {
  await listenToSounds(page);
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByLabel(NAME).fill("Bruno Macedo Teixeira");
  await form.getByLabel("Hora do início").fill("12:30");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByRole("alertdialog", { name: "Consulta não entra neste horário" })).toBeVisible();
  await expect.poll(() => soundsHeard(page)).toEqual([330, 247]);
});

test("while picking, a closed hour's Usar o próximo livre brings the form back at that hour, with what was typed", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByLabel(NAME).fill("Bruno Macedo Teixeira");
  await form.getByRole("button", { name: "Escolher na agenda" }).click();
  // 12:30 of Thursday 19 is lunch; Renato takes 14:00, so the next free hour is 15:00.
  await clickHour(page, "19", 4.5);
  await page.getByRole("dialog", { name: "Consulta não entra neste horário" }).getByRole("button", { name: "Usar o próximo livre" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Toque no dia" })).toHaveCount(0);
  await expect(form.getByLabel(NAME)).toHaveValue("Bruno Macedo Teixeira");
  await expect(form.getByLabel(DAY)).toHaveValue("19/11/2026");
  await expect(form.getByLabel("Hora do início")).toHaveValue("15:00");
});
