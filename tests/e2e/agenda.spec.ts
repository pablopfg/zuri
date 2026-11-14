import { expect, type Page, routeFakeTurnstile, test } from "./fixtures.ts";
import { CSRF, expectAccessible, expectFits, navIsPhone, openSettingsSection, signIn, tooSmallControls } from "./ui-helpers.ts";

// The Agenda of the Sinal frontend (docs/planos/implementacao-frontend-sinal.md, PR S08): the
// week as a grid of the working hours, the day under a strip of the week, today by the owner's
// zone (and turning by itself at 0:00), and Configurações › Agenda. Whatever a preference hides
// is counted on the screen beside "Mostrar". Google is answered here, so the events don't depend
// on the sample calendar; the preferences go through the real server.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const SP = "America/Sao_Paulo";
const DEFAULTS = { from: 8, to: 18, view: "week", weekStart: 1, workDays: [1, 2, 3, 4, 5], daysOff: true, outside: true, lunch: { from: 720, to: 840 }, closed: [] };

// Every test that reads "today" installs the page's clock on an hour of that same day (`at(0, …)`),
// so the day the screen marks is the one the samples were made for, even when the run crosses midnight.
/** The owner's day `days` from the real today, as "YYYY-MM-DD". */
const dayIn = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: SP }).format(new Date(Date.now() + days * 86_400_000));
/** The instant of `time` on the owner's day `days` from today (São Paulo is UTC−3 all year). */
const at = (days: number, time: string) => new Date(`${dayIn(days)}T${time}:00-03:00`);
const dayNumber = (days: number) => String(Number(dayIn(days).slice(8)));
/** Today's day of the week (0 = Sunday) and another day of the same Monday-to-Sunday week: tomorrow, or yesterday on a Sunday. */
const DOW = new Date(`${dayIn(0)}T12:00:00Z`).getUTCDay();
const NEIGHBOUR = DOW === 0 ? -1 : 1;
/** A day of this week that is not today, to be the day off: Sunday, or Saturday when today is Sunday. */
const DAY_OFF = DOW === 0 ? { in: -1, dow: 6 } : { in: 7 - DOW, dow: 0 };

type Sample = { title: string; start: Date; end: Date; location?: string } | { title: string; allDay: string };

/** Google as connected with one calendar and these events, whatever window the screen asks for. */
async function routeAgenda(page: Page, events: Sample[]) {
  await page.route("**/api/google", (route) =>
    route.fulfill({
      json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: at(-1, "10:00").toISOString(), calendars: [{ id: "main", name: "Pessoal", mode: "write", writable: true }] },
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
          ...("allDay" in event
            ? { allDay: true, start: event.allDay, end: new Date(Date.parse(`${event.allDay}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10), location: "" }
            : { allDay: false, start: event.start.toISOString(), end: event.end.toISOString(), location: event.location ?? "" }),
          description: "",
          etag: `"${index}"`,
          recurring: false,
          guests: 0,
        })),
      },
    }),
  );
}

const setPrefs = async (page: Page, agenda: object) => expect((await page.request.patch("/api/settings", { headers: CSRF, data: { agenda: { ...DEFAULTS, ...agenda } } })).status()).toBe(200);

/** Today's events of every test here: two inside the working hours, one before, one after and one all day. */
const TODAY: Sample[] = [
  { title: "Corrida no parque", start: at(0, "07:00"), end: at(0, "07:45") },
  { title: "Vistoria do apartamento", start: at(0, "09:00"), end: at(0, "10:00"), location: "Água Verde" },
  { title: "Almoço com a Bia", start: at(0, "12:30"), end: at(0, "13:30") },
  { title: "Aula de fotografia", start: at(0, "19:00"), end: at(0, "20:30") },
  { title: "Feriado municipal", allDay: dayIn(0) },
];
/** The day off of the "hidden" tests: one event inside the hours, one after them and one all day. */
const OFF: Sample[] = [
  { title: "Feira do bairro", start: at(DAY_OFF.in, "10:00"), end: at(DAY_OFF.in, "11:00") },
  { title: "Jantar de folga", start: at(DAY_OFF.in, "20:00"), end: at(DAY_OFF.in, "21:00") },
  { title: "Viagem de folga", allDay: dayIn(DAY_OFF.in) },
];

async function openAgenda(page: Page) {
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
}

const event = (page: Page, title: string) => page.getByRole("main").getByRole("button", { name: new RegExp(`^${title}`) });
const leftOut = (page: Page, text: string | RegExp) => page.getByRole("main").getByRole("listitem").filter({ hasText: text });

// The preferences are one per installation: every test leaves them as they come.
test.afterEach(async ({ page }) => {
  await page.request.patch("/api/settings", { headers: CSRF, data: { agenda: DEFAULTS } });
});

test("the week is a grid of the working hours, with what is outside them in its own rows and the line of now; accessible", async ({ page }) => {
  await routeAgenda(page, TODAY);
  await page.clock.install({ time: at(0, "08:12") });
  await openAgenda(page);
  await expect(page.getByRole("radio", { name: "Semana" })).toBeChecked();
  // P11: the week has no title on screen (its days are right below); a screen reader still hears the period.
  const period = page.getByRole("heading", { level: 2 });
  await expect(period).toHaveClass(/sr-only/);
  await expect(period).toHaveText(new RegExp(String(new Date().getFullYear())));
  // Today by the owner's zone, marked in the week's header.
  await expect(page.locator('[aria-current="date"]')).toHaveText(new RegExp(`^\\S+\\s*${dayNumber(0)}, Ver o dia`));

  for (const title of ["Corrida no parque", "Vistoria do apartamento", "Almoço com a Bia", "Aula de fotografia", "Feriado municipal"]) await expect(event(page, title)).toBeVisible();
  // Each block sits at its hour: 09:00 is one hour under the first line, and one hour tall.
  const first = await page.getByText("08:00", { exact: true }).boundingBox();
  const ten = await page.getByText("10:00", { exact: true }).boundingBox();
  const block = await event(page, "Vistoria do apartamento").boundingBox();
  const hourPx = ((ten?.y ?? 0) + (ten?.height ?? 0) / 2 - (first?.y ?? 0)) / 2;
  expect(hourPx).toBeGreaterThan(40);
  expect(Math.abs((block?.height ?? 0) - hourPx)).toBeLessThan(4);
  expect(Math.abs((block?.y ?? 0) - (first?.y ?? 0) - hourPx)).toBeLessThan(8);
  // What is outside the hours waits above and below them, in order.
  const y = async (title: string) => (await event(page, title).boundingBox())?.y ?? 0;
  expect(await y("Feriado municipal")).toBeLessThan(await y("Corrida no parque"));
  expect(await y("Corrida no parque")).toBeLessThan(await y("Vistoria do apartamento"));
  expect(await y("Almoço com a Bia")).toBeLessThan(await y("Aula de fotografia"));
  // The line of now, at 08:12, and walking with the clock.
  const now = page.locator("[data-now]");
  await expect(now).toHaveText("08:12");
  await page.clock.fastForward("01:00");
  await expect(now).toHaveText("08:13");
  // Nothing is hidden, so nothing is announced as hidden.
  await expect(page.getByRole("button", { name: /^Mostrar/ })).toHaveCount(0);
  await expectAccessible(page, "agenda-semana-grade");
  await expectFits(page, "agenda-semana-grade");
  // A five-minute event is still a block the owner can hit, and so is every chip of the rows around the hours.
  expect(await tooSmallControls(page), "every control of the week is a 44 px target").toEqual([]);

  // An event opens from its block, and the day from its header.
  await event(page, "Vistoria do apartamento").click();
  await expect(page.getByRole("dialog", { name: "Vistoria do apartamento" })).toBeVisible();
  // The X closes it and the focus goes back to the block it came from; by the keyboard, the same with Esc.
  await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(event(page, "Vistoria do apartamento")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Vistoria do apartamento" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(event(page, "Vistoria do apartamento")).toBeFocused();
  await page.getByRole("button", { name: new RegExp(`^\\S+\\s*${dayNumber(NEIGHBOUR)}\\s*, Ver o dia`) }).click();
  await expect(page.getByRole("radio", { name: "Dia" })).toBeChecked();
  await expect(page.getByText("Nada na agenda neste dia.")).toBeVisible();
});

test("what the preferences hide is counted beside “Mostrar”, in the week and in the day, and comes back with one click", async ({ page }) => {
  await routeAgenda(page, [...TODAY, ...OFF]);
  await page.clock.install({ time: at(0, "10:20") });
  await openAgenda(page);
  // Every day of the week is a working day but the one of the fair.
  await setPrefs(page, { outside: false, daysOff: false, workDays: [0, 1, 2, 3, 4, 5, 6].filter((day) => day !== DAY_OFF.dow) });
  await page.reload();
  await expect(event(page, "Vistoria do apartamento")).toBeVisible();
  // An all-day event is always on screen: there is no preference to hide it any more.
  await expect(event(page, "Feriado municipal")).toBeVisible();
  for (const title of ["Corrida no parque", "Aula de fotografia", ...OFF.map((each) => each.title)]) await expect(event(page, title)).toHaveCount(0);

  // The days on screen count their own; the day off counts everything it holds.
  const outside = leftOut(page, /fora das 08:00 às 18:00/);
  const daysOff = leftOut(page, "3 eventos em dias de folga");
  await expect(leftOut(page, /dia inteiro/)).toHaveCount(0);
  await expect(outside).toContainText("2 eventos fora das 08:00 às 18:00");
  for (const line of [outside, daysOff]) await expect(line.getByRole("button", { name: /^Mostrar/ })).toBeVisible();
  // Each "Mostrar" says what it shows.
  await expect(outside.getByRole("button")).toHaveAccessibleName(/^Mostrar ?, 2 eventos fora das 08:00 às 18:00$/);
  await expectAccessible(page, "agenda-escondidos");

  // QA-S08-01: the day off on screen is under the same preferences. What it brings and they hide is counted, never lost.
  await daysOff.getByRole("button").click();
  await expect(event(page, "Feira do bairro")).toBeVisible();
  await expect(event(page, "Jantar de folga")).toHaveCount(0);
  await expect(event(page, "Viagem de folga")).toBeVisible();
  await expect(outside).toContainText("3 eventos fora das 08:00 às 18:00");

  // By the keyboard, one at a time; the line stays, to hide again.
  await outside.getByRole("button").focus();
  await page.keyboard.press("Enter");
  for (const title of ["Corrida no parque", "Aula de fotografia", "Jantar de folga"]) await expect(event(page, title)).toBeVisible();
  await expect(outside.getByRole("button", { name: /^Esconder/ })).toBeFocused();
  await outside.getByRole("button", { name: /^Esconder/ }).click();
  await expect(event(page, "Corrida no parque")).toHaveCount(0);
  // The day off goes away again with all it holds, and the counts go back to the days on screen.
  await daysOff.getByRole("button", { name: /^Esconder/ }).click();
  for (const each of OFF) await expect(event(page, each.title)).toHaveCount(0);
  await expect(outside).toContainText("2 eventos fora das 08:00 às 18:00");

  // The day counts only its own.
  await page.getByRole("group", { name: "Ver por" }).getByText("Dia", { exact: true }).click();
  await expect(leftOut(page, "2 eventos fora das 08:00 às 18:00")).toBeVisible();
  await expect(leftOut(page, /dia de folga/)).toHaveCount(0);
  await expect(event(page, "Almoço com a Bia")).toBeVisible();
  await expect(event(page, "Aula de fotografia")).toHaveCount(0);
  await leftOut(page, "2 eventos fora das 08:00 às 18:00").getByRole("button").click();
  await expect(event(page, "Aula de fotografia")).toContainText("até 20:30");
  // The month shows everything: it is the place to see a whole period.
  await page.getByRole("group", { name: "Ver por" }).getByText("Mês", { exact: true }).click();
  await expect(page.getByRole("button", { name: /^Mostrar|^Esconder/ })).toHaveCount(0);
});

test("at 23:59 today is still today, and at 0:00 the Agenda turns the day by itself @mobile", async ({ page }) => {
  await routeAgenda(page, [
    { title: "Fecho do dia", start: at(0, "23:00"), end: at(0, "23:30") },
    { title: "Primeira de amanhã", start: at(1, "09:00"), end: at(1, "10:00") },
  ]);
  await page.clock.install({ time: at(0, "23:59") });
  await openAgenda(page);
  await page.getByRole("group", { name: "Ver por" }).getByText("Dia", { exact: true }).click();
  const long = (days: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: SP, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(at(days, "12:00"));
  const period = page.getByRole("heading", { level: 2 });
  await expect(period).toHaveText(long(0), { ignoreCase: true });
  await expect(page.locator('[aria-current="date"]')).toHaveText(new RegExp(`^\\S+\\s*${dayNumber(0)}, `));
  await expect(event(page, "Fecho do dia")).toBeVisible();

  // 23:59:30: still the same day.
  await page.clock.fastForward("00:30");
  await expect(period).toHaveText(long(0), { ignoreCase: true });
  // 0:00:30: the day on screen was today, so it follows; the mark moves with it.
  await page.clock.fastForward("01:00");
  await expect(period).toHaveText(long(1), { ignoreCase: true });
  await expect(page.locator('[aria-current="date"]')).toHaveText(new RegExp(`^\\S+\\s*${dayNumber(1)}, `));
  await expect(event(page, "Primeira de amanhã")).toBeVisible();
  await expect(event(page, "Fecho do dia")).toHaveCount(0);

  // A day the owner picked stays put when the clock turns; "Hoje" comes back to the new today.
  await page.getByRole("button", { name: "Período anterior" }).click();
  await expect(period).toHaveText(long(0), { ignoreCase: true });
  await page.getByRole("button", { name: "Hoje", exact: true }).click();
  await expect(period).toHaveText(long(1), { ignoreCase: true });
});

test("today is the owner's, not the device's: a phone ahead of the owner's zone still marks the owner's day", async ({ browser }) => {
  // Tokyo is 12 hours ahead of São Paulo: at 20:00 there it is already tomorrow on the device.
  const context = await browser.newContext({ locale: "pt-BR", timezoneId: "Asia/Tokyo", baseURL: test.info().project.use.baseURL ?? "" });
  await routeFakeTurnstile(context);
  const page = await context.newPage();
  await routeAgenda(page, [{ title: "Reunião da noite", start: at(0, "20:30"), end: at(0, "21:00") }]);
  await page.clock.install({ time: at(0, "20:00") });
  await openAgenda(page);
  await page.getByRole("group", { name: "Ver por" }).getByText("Dia", { exact: true }).click();
  await expect(page.locator('[aria-current="date"]')).toHaveText(new RegExp(`^\\S+\\s*${dayNumber(0)}, `));
  // The hour shown is the owner's too.
  await expect(event(page, "Reunião da noite")).toContainText("20:30");
  await context.close();
});

test.describe("on a phone", () => {
  // The phone's layout whatever the project: the window is a phone's here.
  test.use({ viewport: { width: 390, height: 844 } });

  test("on a phone the Agenda opens on the day, with the week as a strip and the bar as a grid; every control is a 44 px target @mobile", async ({ page }) => {
    await routeAgenda(page, TODAY);
    await page.clock.install({ time: at(0, "10:20") });
    await openAgenda(page);
    // The preference says week; a phone opens on the day all the same.
    await expect(page.getByRole("radio", { name: "Dia" })).toBeChecked();
    const strip = page.getByRole("navigation", { name: "Dias da semana" });
    await expect(strip.getByRole("button")).toHaveCount(7);
    await expect(strip.getByRole("button", { pressed: true })).toHaveAttribute("aria-current", "date");
    // The seven days share one line, and the arrows and the views share the next.
    const tops = await strip.getByRole("button").evaluateAll((buttons) => [...new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)))]);
    expect(tops).toHaveLength(1);
    const arrows = await page.getByRole("button", { name: "Hoje", exact: true }).boundingBox();
    const views = await page.getByRole("group", { name: "Ver por" }).boundingBox();
    expect(Math.abs((arrows?.y ?? 0) + (arrows?.height ?? 0) / 2 - ((views?.y ?? 0) + (views?.height ?? 0) / 2))).toBeLessThan(4);
    expect((views?.x ?? 0) + (views?.width ?? 0)).toBeGreaterThan((page.viewportSize()?.width ?? 0) - 40);

    await expect(event(page, "Feriado municipal")).toContainText("Dia inteiro");
    await expect(event(page, "Vistoria do apartamento")).toContainText("até 10:00 · Água Verde");
    // "Semana" on a phone is the same strip, a week at a time.
    await page.getByRole("group", { name: "Ver por" }).getByText("Semana", { exact: true }).click();
    await expect(strip.getByRole("button")).toHaveCount(7);
    await expect(event(page, "Almoço com a Bia")).toBeVisible();
    await strip.getByRole("button").nth(0).click();
    await expect(strip.getByRole("button").nth(0)).toHaveAttribute("aria-pressed", "true");
    await expectAccessible(page, "agenda-celular");
    await expectFits(page, "agenda-celular");
    expect(await tooSmallControls(page), "every control of the screen is a 44 px target").toEqual([]);
  });
});

test("Configurações › Agenda saves the working hours, the week and what stays hidden; the Agenda and “Seu dia” follow @mobile", async ({ page }) => {
  await routeAgenda(page, TODAY);
  // 06:30: the run at 07:00 is still ahead, and before the standard hours.
  await page.clock.install({ time: at(0, "06:30") });
  await page.goto("/configuracoes/agenda");
  await signIn(page);
  const card = page.getByRole("region", { name: "Agenda" }).last();
  const save = card.getByRole("button", { name: "Salvar alterações" });
  await expect(save).toBeDisabled();
  await expect(card.getByRole("img", { name: "Das 08:00 às 18:00, 10 horas" })).toBeVisible();
  // The end can't come before the start: each list stops at the other's choice.
  const from = card.getByLabel("Começa às");
  const to = card.getByLabel("Termina às");
  await expect(from.locator("option").last()).toHaveText("17:00");
  await expect(to.locator("option").first()).toHaveText("09:00");
  await expect(to.locator("option").last()).toHaveText("24:00");
  await from.selectOption("7");
  await to.selectOption("20");
  await expect(card.getByRole("img", { name: "Das 07:00 às 20:00, 13 horas" })).toBeVisible();
  await expect(to.locator("option").first()).toHaveText("08:00");
  await card.getByRole("radiogroup", { name: "A semana começa" }).getByText("Domingo", { exact: true }).click();
  // The last working day can't be unchecked.
  const days = card.getByRole("group", { name: "Dias de atendimento" });
  await expect(days.getByRole("checkbox").first()).toHaveAccessibleName("dom");
  for (const name of ["seg", "ter", "qua", "qui"]) await days.getByText(name, { exact: true }).click();
  await expect(days.getByRole("checkbox", { name: "sex" })).toHaveAttribute("aria-disabled", "true");
  await days.getByRole("checkbox", { name: "sex" }).focus();
  await page.keyboard.press("Space");
  await expect(days.getByRole("checkbox", { name: "sex" })).toBeChecked();
  for (const name of ["seg", "ter", "qua", "qui"]) await days.getByText(name, { exact: true }).click();
  await expectAccessible(page, "configuracoes-agenda");
  await expectFits(page, "configuracoes-agenda");
  expect(await tooSmallControls(page), "every control of the screen is a 44 px target").toEqual([]);
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Agenda salva" })).toBeVisible();
  await expect(save).toBeDisabled();
  const stored = (await (await page.request.get("/api/settings", { headers: CSRF })).json()) as { agenda: object };
  expect(stored.agenda).toEqual({ ...DEFAULTS, from: 7, to: 20, weekStart: 0 });

  // "Voltar para 08:00 até 18:00" is there only away from it, and is not saved until asked.
  await card.getByRole("button", { name: "Voltar para 08:00 até 18:00" }).click();
  await expect(from).toHaveValue("8");
  await expect(card.getByRole("button", { name: "Voltar para 08:00 até 18:00" })).toHaveCount(0);
  await expect(save).toBeEnabled();
  await page.reload();
  await expect(from).toHaveValue("7");

  // The Agenda: 07:00 is inside the hours now, the week starts on Sunday and the all-day event is on screen.
  await page.goto("/agenda");
  await expect(event(page, "Corrida no parque")).toBeVisible();
  await expect(event(page, "Feriado municipal")).toBeVisible();
  if (!navIsPhone(page)) {
    await expect(page.getByRole("main").getByRole("list").first().getByRole("button", { name: /Ver o dia/ }).first()).toHaveAccessibleName(/^dom /i);
    await expect(page.getByText("07:00", { exact: true }).first()).toBeVisible();
  } else {
    await expect(page.getByRole("navigation", { name: "Dias da semana" }).getByRole("button").first()).toHaveAccessibleName(/^dom /i);
  }
  // The link under the Agenda leads back here.
  await page.getByRole("link", { name: "Configurar a agenda" }).click();
  await expect(page).toHaveURL(/\/configuracoes\/agenda$/);
  // "Seu dia" on the home page uses the same hours: the run at 07:00 is listed, not counted as outside them.
  await page.goto("/");
  await expect(page.getByRole("main").getByText("07:00 às 20:00").first()).toBeVisible();
  await expect(page.getByRole("main").getByText("Corrida no parque")).toBeVisible();
  // Back to the standard hours, the same run is outside them.
  await setPrefs(page, {});
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("main").getByText("Vistoria do apartamento")).toBeVisible();
  await expect(page.getByRole("main").getByText("Aula de fotografia")).toHaveCount(0);
  await expect(page.getByRole("main").getByText("Corrida no parque")).toHaveCount(0);
});

test("the Agenda opens on the view the owner saved, and a week that starts on Sunday turns on Sunday", async ({ page }) => {
  await routeAgenda(page, TODAY);
  await page.clock.install({ time: at(0, "10:20") });
  await openAgenda(page);
  await setPrefs(page, { view: "month", weekStart: 0 });
  await page.reload();
  await expect(page.getByRole("radio", { name: "Mês" })).toBeChecked();
  await expect(page.getByRole("heading", { level: 2 })).not.toHaveClass(/sr-only/);
  await setPrefs(page, { view: "day" });
  await page.reload();
  await expect(page.getByRole("radio", { name: "Dia" })).toBeChecked();
  await expect(event(page, "Almoço com a Bia")).toContainText("até 13:30");
  // Sunday first: the week on screen is the one that begins on the Sunday on or before today.
  await setPrefs(page, { weekStart: 0 });
  await page.reload();
  const first = page.getByRole("main").getByRole("button", { name: /Ver o dia/ }).first();
  await expect(first).toHaveAccessibleName(new RegExp(`^dom\\S*\\s*${dayNumber(-DOW)}\\s*, Ver o dia`, "i"));
});

test.describe("in the dark theme", () => {
  test.use({ colorScheme: "dark" });

  test("the week with events, what is hidden and Configurações › Agenda have no serious violation @mobile", async ({ page }) => {
    await routeAgenda(page, [...TODAY, ...OFF]);
    await page.clock.install({ time: at(0, "10:20") });
    await openAgenda(page);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(event(page, "Almoço com a Bia")).toBeVisible();
    await expectAccessible(page, "agenda-escuro");
    // On a Saturday or a Sunday today is itself a day off: hiding the days off would hide today's column
    // and the line about its hours with it, so the weekend keeps them (the run fell on 14/11/2026, a Saturday).
    await setPrefs(page, { outside: false, daysOff: DOW === 0 || DOW === 6 });
    await page.reload();
    await expect(leftOut(page, /fora das 08:00 às 18:00/)).toBeVisible();
    await expectAccessible(page, "agenda-escondidos-escuro");
    await page.goto("/configuracoes/agenda");
    await expect(page.getByRole("button", { name: "Salvar alterações" })).toBeVisible();
    await expectAccessible(page, "configuracoes-agenda-escuro");
  });
});

test("in English the Agenda and its settings speak English, hours and counts included", async ({ page }) => {
  await routeAgenda(page, TODAY);
  await page.clock.install({ time: at(0, "10:20") });
  await openAgenda(page);
  try {
    expect((await page.request.patch("/api/settings", { headers: CSRF, data: { language: "en", agenda: { ...DEFAULTS, outside: false } } })).status()).toBe(200);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Week" })).toBeChecked();
    const outside = leftOut(page, "2 events outside 08:00 to 18:00");
    await outside.getByRole("button", { name: /^Show/ }).click();
    await expect(outside.getByRole("button", { name: /^Hide/ })).toBeVisible();
    await expect(event(page, "Aula de fotografia")).toBeVisible();
    await expect(page.getByText("Before", { exact: true })).toBeVisible();
    await expect(page.getByText("After", { exact: true })).toBeVisible();
    await expectAccessible(page, "agenda-en");
    await page.getByRole("link", { name: "Set up the calendar" }).click();
    const card = page.getByRole("region", { name: "Calendar" }).last();
    await expect(card.getByRole("img", { name: "From 08:00 to 18:00, 10 hours" })).toBeVisible();
    await card.getByLabel("Starts at").selectOption("9");
    await expect(card.getByRole("button", { name: "Back to 08:00 to 18:00" })).toBeVisible();
    await card.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Calendar saved" })).toBeVisible();
    await expectAccessible(page, "configuracoes-agenda-en");
  } finally {
    await page.request.patch("/api/settings", { headers: CSRF, data: { language: "pt-BR" } });
  }
});

test("the settings list has the Agenda section, and the palette finds it", async ({ page }) => {
  await page.goto("/configuracoes");
  await signIn(page);
  await openSettingsSection(page, "Agenda");
  await expect(page).toHaveURL(/\/configuracoes\/agenda$/);
  await expect(page.getByRole("button", { name: "Salvar alterações" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Buscar e ir para" });
  await palette.getByRole("combobox", { name: "Buscar e ir para" }).fill("configuracoes agenda");
  await palette.getByRole("option", { name: "Configurações › Agenda" }).click();
  await expect(page).toHaveURL(/\/configuracoes\/agenda$/);
});
