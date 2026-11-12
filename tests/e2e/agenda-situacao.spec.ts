import { expect, type Page, test } from "./fixtures.ts";
import { expectAccessible, expectFits, signIn } from "./ui-helpers.ts";

// The Agenda's status by color, national holidays and weekends (docs/planos/sons-menu-e-agenda-editavel.md,
// delivery 2). The status of an appointment is the color of its event at Google; Saturdays, Sundays and
// national holidays get a fill of their own, and the holiday shows its name. Google is answered here and
// the clock is fixed on the week of 20/11/2026 (a Friday, Consciência Negra), so nothing depends on the
// sample calendar or on the day the tests run.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/** Wednesday, 18/11/2026, 10:20 in São Paulo: the week runs from Monday 16 to Sunday 22. */
const NOW = new Date("2026-11-18T10:20:00-03:00");
const at = (day: string, time: string) => new Date(`2026-11-${day}T${time}:00-03:00`).toISOString();

type Sample = { title: string; day: string; from: string; to: string; colorId?: string; calendarId?: string; description?: string };

// Invented names: the title is the person's full name, as in the office's calendar.
const WEEK: Sample[] = [
  { title: "Helena Duarte Prado", day: "16", from: "09:00", to: "10:00", colorId: "10" },
  { title: "Marina Teles Barreto", day: "16", from: "14:00", to: "15:00" },
  { title: "Renato Sampaio Cruz", day: "17", from: "10:00", to: "11:00", colorId: "5" },
  { title: "Caio Vasques Lima", day: "18", from: "16:00", to: "17:00", colorId: "11" },
  { title: "Isadora Pires Falcão", day: "19", from: "09:00", to: "10:00", colorId: "7" },
  { title: "Curso de fotografia", day: "19", from: "14:00", to: "15:00", colorId: "3" },
  { title: "Aula de natação", day: "17", from: "14:00", to: "15:00", colorId: "11", calendarId: "curso" },
  { title: "Plantão do feriado", day: "20", from: "09:00", to: "10:00", colorId: "10" },
];

const CALENDARS = [
  { id: "main", name: "Consultório", accessRole: "owner", primary: true, mode: "write", writable: true, color: "#4f7cff" },
  { id: "curso", name: "Curso e esporte", accessRole: "reader", primary: false, mode: "read", writable: false, color: "#f59e0b" },
];

const wire = (sample: Sample, index: number) => ({
  id: `e${index}`,
  calendarId: sample.calendarId ?? "main",
  title: sample.title,
  allDay: false,
  start: at(sample.day, sample.from),
  end: at(sample.day, sample.to),
  location: "",
  description: sample.description ?? "",
  etag: `"v1-${index}"`,
  recurring: false,
  guests: 0,
  colorId: sample.colorId ?? "",
});

/** Google as connected with two calendars and these events; a PATCH is answered by `change`. */
async function routeAgenda(page: Page, samples: Sample[], change?: (body: Record<string, string>) => { status: number; json: unknown }) {
  const events = samples.map(wire);
  const patches: Record<string, string>[] = [];
  await page.route("**/api/google", (route) =>
    route.fulfill({ json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: at("10", "10:00"), calendars: CALENDARS } }),
  );
  await page.route("**/api/google/events?*", (route) => route.fulfill({ json: { more: false, calendars: CALENDARS, events } }));
  await page.route("**/api/google/events", (route) => {
    if (route.request().method() !== "PATCH" || !change) return route.fallback();
    const body = route.request().postDataJSON() as Record<string, string>;
    patches.push(body);
    const answer = change(body);
    if (answer.status === 200) {
      // As Google would: the color changes and the event gets a new version.
      const index = events.findIndex((event) => event.id === body.eventId);
      const saved = { ...events[index], colorId: body.colorId ?? "", etag: `"v2-${index}"` } as (typeof events)[number];
      events[index] = saved;
      return route.fulfill({ json: { event: saved } });
    }
    return route.fulfill({ status: answer.status, json: answer.json });
  });
  return patches;
}

async function openAgenda(page: Page) {
  await page.clock.install({ time: NOW });
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
}

const event = (page: Page, title: string) => page.getByRole("main").getByRole("button", { name: new RegExp(`^${title}`) });
const css = (page: Page, locator: ReturnType<Page["locator"]>, property: string) => locator.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);
/** The column of a day in the week's grid, found by its heading. */
const column = (page: Page, day: string) => page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^\\S+\\s*${day}\\s*, Ver o dia`) }) });

test("the week paints each event by its status, names it for a screen reader, and fills weekends and the holiday; accessible", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  await expect(page.getByRole("radio", { name: "Semana" })).toBeChecked();

  // CA9: the color at Google is the status. None counts as "Agendado"; each of the four has its bar.
  const bars: [string, string, string][] = [
    ["Helena Duarte Prado", "Confirmado", "rgb(11, 128, 67)"],
    ["Marina Teles Barreto", "Agendado", "rgb(3, 155, 229)"],
    ["Renato Sampaio Cruz", "Reagendado", "rgb(246, 191, 38)"],
    ["Caio Vasques Lima", "Cancelado", "rgb(213, 0, 0)"],
    ["Isadora Pires Falcão", "Agendado", "rgb(3, 155, 229)"],
  ];
  for (const [title, status, bar] of bars) {
    await expect(event(page, title)).toHaveAccessibleName(new RegExp(`^${title}\\s*${status}`));
    expect(await css(page, event(page, title), "border-left-color")).toBe(bar);
  }
  // Only the cancelled one is struck through.
  expect(await css(page, event(page, "Caio Vasques Lima").locator("span").first(), "text-decoration-line")).toBe("line-through");
  expect(await css(page, event(page, "Helena Duarte Prado").locator("span").first(), "text-decoration-line")).toBe("none");
  // A color outside the four shows as it is (Grape), without a status.
  await expect(event(page, "Curso de fotografia")).not.toHaveAccessibleName(/Agendado|Confirmado|Reagendado|Cancelado/);
  expect(await css(page, event(page, "Curso de fotografia"), "border-left-color")).toBe("rgb(142, 36, 170)");
  // A calendar that is only read: the calendar's color, and no status, whatever color the event has there.
  await expect(event(page, "Aula de natação")).not.toHaveAccessibleName(/Cancelado/);
  expect(await css(page, event(page, "Aula de natação"), "border-left-color")).toBe("rgb(245, 158, 11)");

  // CA10: Saturday and Sunday have one fill, the holiday another, and a working day none.
  const fill = (day: string) => css(page, column(page, day), "background-color");
  const [weekday, saturday, sunday, holiday] = [await fill("18"), await fill("21"), await fill("22"), await fill("20")];
  expect(weekday).toBe("rgba(0, 0, 0, 0)");
  expect(saturday).not.toBe(weekday);
  expect(sunday).toBe(saturday);
  expect(holiday).not.toBe(weekday);
  expect(holiday).not.toBe(saturday);
  // The holiday shows its name on its day, and the day's button says it.
  await expect(column(page, "20").getByText("Consciência Negra", { exact: true })).toBeVisible();
  await expect(column(page, "20").getByRole("button", { name: /^\S+\s*20\s*, Ver o dia .+, Feriado nacional: Consciência Negra$/ })).toBeVisible();
  await expect(page.getByRole("main").getByText("Consciência Negra", { exact: true })).toHaveCount(1);
  // An event on the holiday is still there.
  await expect(event(page, "Plantão do feriado")).toBeVisible();

  const key = page.getByRole("list", { name: "Legenda" });
  for (const text of ["Agendado", "Confirmado", "Reagendado", "Cancelado", "Fim de semana", "Feriado nacional"]) await expect(key.getByText(text, { exact: true })).toBeVisible();
  await expectFits(page);
  await expectAccessible(page, "agenda-situacao-semana");
});

test("the holiday's name shows even with the all-day events hidden, and a week without one has no row for it", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const settings = (await response.json()) as { agenda: object };
    await route.fulfill({ response, json: { ...settings, agenda: { ...settings.agenda, allDay: false } } });
  });
  await openAgenda(page);
  await expect(column(page, "20").getByText("Consciência Negra", { exact: true })).toBeVisible();
  // The week before (9 to 15/11): its only holiday is Sunday the 15th.
  await page.getByRole("button", { name: "Período anterior" }).click();
  await expect(column(page, "15").getByText("Proclamação da República", { exact: true })).toBeVisible();
  // Two weeks later (23 to 29/11): no holiday, so no name and no all-day row.
  await page.getByRole("button", { name: "Hoje" }).click();
  await page.getByRole("button", { name: "Próximo período" }).click();
  await expect(column(page, "25")).toBeVisible();
  await expect(page.getByRole("main").getByText("Dia inteiro", { exact: true })).toHaveCount(0);
});

test("the details change the status with one tap, send only the color with the version on screen, and say the color at Google", async ({ page }) => {
  const patches = await routeAgenda(page, WEEK, () => ({ status: 200, json: {} }));
  await openAgenda(page);
  await event(page, "Marina Teles Barreto").click();
  const details = page.getByRole("dialog", { name: "Marina Teles Barreto" });
  const status = details.getByRole("group", { name: "Situação" });
  await expect(status.getByRole("button")).toHaveText(["Agendado", "Confirmado", "Reagendado", "Cancelado"]);
  await expect(status.getByRole("button", { pressed: true })).toHaveText("Agendado");
  await expect(details.getByText("Cor no Google: A da agenda (Agendado)")).toBeVisible();
  await expectAccessible(page, "agenda-situacao-detalhe");

  // By the keyboard, as a tap.
  await status.getByRole("button", { name: "Confirmado" }).focus();
  await page.keyboard.press("Enter");
  // Said inside the dialog: a toast behind it could not be reached.
  await expect(details.getByRole("status")).toHaveText("Situação salva");
  await expect(status.getByRole("button", { pressed: true })).toHaveText("Confirmado");
  await expect(details.getByText("Cor no Google: Manjericão (Confirmado)")).toBeVisible();
  expect(patches).toEqual([{ calendarId: "main", eventId: "e1", etag: '"v1-1"', colorId: "10" }]);

  // The next change goes with the version Google answered, and the status already on asks nothing.
  await status.getByRole("button", { name: "Confirmado" }).click();
  await status.getByRole("button", { name: "Cancelado" }).click();
  await expect(status.getByRole("button", { pressed: true })).toHaveText("Cancelado");
  expect(patches).toHaveLength(2);
  expect(patches[1]).toEqual({ calendarId: "main", eventId: "e1", etag: '"v2-1"', colorId: "11" });
  await details.getByRole("button", { name: "Fechar" }).click();
  await expect(event(page, "Marina Teles Barreto")).toHaveAccessibleName(/Cancelado/);
  expect(await css(page, event(page, "Marina Teles Barreto"), "border-left-color")).toBe("rgb(213, 0, 0)");

  // A color outside the four: no status is on, and the color is named.
  await event(page, "Curso de fotografia").click();
  const other = page.getByRole("dialog", { name: "Curso de fotografia" });
  await expect(other.getByRole("group", { name: "Situação" }).getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(other.getByText("Cor no Google: Uva", { exact: true })).toBeVisible();
  await other.getByRole("button", { name: "Fechar" }).click();

  // A calendar that is only read: no status to change, no color, no "Editar".
  await event(page, "Aula de natação").click();
  const readOnly = page.getByRole("dialog", { name: "Aula de natação" });
  await expect(readOnly.getByText("Esta agenda está como “Só ler” em Integrações")).toBeVisible();
  await expect(readOnly.getByRole("group", { name: "Situação" })).toHaveCount(0);
  await expect(readOnly.getByText(/Cor no Google/)).toHaveCount(0);
  await expect(readOnly.getByRole("button", { name: "Editar" })).toHaveCount(0);
});

test("a status refused because the event changed at Google closes the details and changes nothing; a failure keeps them open", async ({ page }) => {
  let answer = { status: 409, json: { code: "TARGET_CHANGED", message: "O evento mudou no Google enquanto isso. Confira como ele ficou e tente de novo." } };
  const patches = await routeAgenda(page, WEEK, () => answer);
  await openAgenda(page);
  await event(page, "Helena Duarte Prado").click();
  const details = page.getByRole("dialog", { name: "Helena Duarte Prado" });
  await details.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Cancelado" }).click();
  await expect(page.getByRole("status").filter({ hasText: "O evento mudou no Google enquanto isso" })).toBeVisible();
  await expect(details).toHaveCount(0);
  await expect(event(page, "Helena Duarte Prado")).toHaveAccessibleName(/Confirmado/);
  expect(patches).toHaveLength(1);

  answer = { status: 503, json: { code: "SERVICE_UNAVAILABLE", message: "O Google não respondeu. Tente de novo em instantes." } };
  await event(page, "Helena Duarte Prado").click();
  const again = page.getByRole("dialog", { name: "Helena Duarte Prado" });
  await again.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Reagendado" }).click();
  await expect(again.getByRole("status")).toHaveText("O Google não respondeu. Tente de novo em instantes.");
  await expect(again.getByRole("group", { name: "Situação" }).getByRole("button", { pressed: true })).toHaveText("Confirmado");
});

test("the month fills weekends and holidays and names the holiday under its day", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  await page.getByRole("radio", { name: "Mês" }).check({ force: true });
  const cell = (day: string) => page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^${day} ?, Ver o dia .+ de novembro`) }) });
  const fill = (day: string) => css(page, cell(day), "background-color");
  const [weekday, saturday, sunday, friday, sundayHoliday] = [await fill("18"), await fill("21"), await fill("22"), await fill("20"), await fill("15")];
  expect(saturday).not.toBe(weekday);
  expect(sunday).toBe(saturday);
  expect(friday).not.toBe(weekday);
  expect(friday).not.toBe(saturday);
  // A holiday on a Sunday is a holiday first.
  expect(sundayHoliday).toBe(friday);
  for (const [day, name] of [["2", "Finados"], ["15", "Proclamação da República"], ["20", "Consciência Negra"]] as const) {
    await expect(cell(day).getByText(name, { exact: true })).toBeVisible();
    await expect(cell(day).getByRole("button", { name: new RegExp(`Feriado nacional: ${name}`) })).toBeVisible();
  }
  await expect(event(page, "Caio Vasques Lima")).toHaveAccessibleName(/Cancelado/);
  await expectFits(page);
  await expectAccessible(page, "agenda-situacao-mes");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the day says the holiday in a band, the strip fills it and the weekend, and each line says its status @mobile", async ({ page }) => {
    await routeAgenda(page, WEEK);
    await openAgenda(page);
    await expect(page.getByRole("radio", { name: "Dia" })).toBeChecked();
    await expect(event(page, "Caio Vasques Lima")).toContainText("Cancelado · até 17:00");
    await expect(page.getByText(/^Feriado nacional:/)).toHaveCount(0);

    const strip = page.getByRole("navigation", { name: "Dias da semana" });
    const fill = (day: string) => css(page, strip.getByRole("button", { name: new RegExp(`^\\S+\\s*${day}\\s*, Ver o dia`) }), "background-color");
    const [weekday, saturday, holiday] = [await fill("17"), await fill("21"), await fill("20")];
    expect(saturday).not.toBe(weekday);
    expect(holiday).not.toBe(weekday);
    expect(holiday).not.toBe(saturday);

    await strip.getByRole("button", { name: /^\S+\s*20\s*, Ver o dia .+, Feriado nacional: Consciência Negra$/ }).click();
    await expect(page.getByText("Feriado nacional: Consciência Negra", { exact: true })).toBeVisible();
    await expect(event(page, "Plantão do feriado")).toContainText("Confirmado · até 10:00");
    await expectFits(page);
    await expectAccessible(page, "agenda-situacao-celular");

    // The month on a phone: the fill and the spoken name; no room for the written one.
    await page.getByRole("radio", { name: "Mês" }).check({ force: true });
    await expect(page.getByRole("button", { name: /^20 ?, Ver o dia .+, Feriado nacional: Consciência Negra, 1 evento$/ })).toBeVisible();
    await expectFits(page);
  });
});

test.describe("in the dark theme", () => {
  test.use({ colorScheme: "dark" });

  test("the statuses, the weekend and the holiday keep their contrast, in the week and in the details @mobile", async ({ page }) => {
    await routeAgenda(page, WEEK);
    await openAgenda(page);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(event(page, "Caio Vasques Lima")).toBeVisible();
    await expectAccessible(page, "agenda-situacao-escuro");
    await event(page, "Caio Vasques Lima").click();
    await expect(page.getByRole("dialog", { name: "Caio Vasques Lima" }).getByRole("group", { name: "Situação" })).toBeVisible();
    await expectAccessible(page, "agenda-situacao-detalhe-escuro");
  });
});

test("in English the statuses, the colors and the holiday speak English", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...((await response.json()) as object), language: "en" } });
  });
  await page.clock.install({ time: NOW });
  await page.goto("/agenda");
  await signIn(page);
  await expect(event(page, "Helena Duarte Prado")).toHaveAccessibleName(/Confirmed/);
  await expect(page.getByRole("main").getByText("Black Awareness Day", { exact: true })).toBeVisible();
  await event(page, "Helena Duarte Prado").click();
  const details = page.getByRole("dialog", { name: "Helena Duarte Prado" });
  await expect(details.getByRole("group", { name: "Status" }).getByRole("button")).toHaveText(["Scheduled", "Confirmed", "Rescheduled", "Cancelled"]);
  await expect(details.getByText("Color in Google: Basil (Confirmed)")).toBeVisible();
});
