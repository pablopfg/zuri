import type { Locator } from "@playwright/test";
import { expect, type Page, routeFakeTurnstile, test } from "./fixtures.ts";
import { expectAccessible, signIn } from "./ui-helpers.ts";

// The Agenda that edits (docs/planos/sons-menu-e-agenda-editavel.md, delivery 3): dragging an event to
// another day or hour, pulling its end, Alt + arrows, "Desfazer", the line that says where Google stands
// and the form's "Dura", "Tipo" and "Situação". Google is answered here and the clock is fixed on the week
// of 16/11/2026, so nothing depends on the sample calendar or on the day the tests run.
//
// CA7 (drag, length, keyboard, touch by "Editar"), CA8 (sent at once, "Salvando…", back on a refusal),
// CA12 (a read-only calendar's event does not move), CA13 ("Desfazer") and the rest of CA6.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/**
 * Monday, 16/11/2026, 07:20 in São Paulo, before the office opens: the week runs from Monday 16 to Sunday 22
 * and all of it is still ahead, so the booking rule never refuses a move for being in the past.
 */
const NOW = new Date("2026-11-16T07:20:00-03:00");
/**
 * The office as this file needs it: every day, until 20:00 and no lunch. The holiday of the 20th is always
 * closed (13/11/2026). What is tested here is the hand (drag, keyboard, Desfazer); the rule is agenda-travas.spec.ts.
 */
const OPEN = { workDays: [0, 1, 2, 3, 4, 5, 6], to: 20, lunch: null };
const iso = (local: string) => new Date(`${local}:00-03:00`).toISOString();
/** One hour of the week's grid, in pixels (3.5 rem). */
const HOUR_PX = 56;

type Sample = { title: string; day: string; from: string; to: string; colorId?: string; calendarId?: string; description?: string; recurring?: boolean; endDay?: string };

// Invented names: the title is the person's full name and the description brings the type, as in the office's calendar.
const WEEK: Sample[] = [
  { title: "Helena Duarte Prado", day: "16", from: "09:00", to: "10:00", colorId: "10", description: "Consulta | Consultório" },
  { title: "Marina Teles Barreto", day: "16", from: "14:00", to: "15:00", description: "Retorno | Consultório\nLevar exames" },
  { title: "Renato Sampaio Cruz", day: "17", from: "10:00", to: "11:00", colorId: "5", description: "Consulta | Consultório" },
  { title: "Reunião da equipe", day: "18", from: "14:00", to: "15:00", recurring: true },
  { title: "Isadora Pires Falcão", day: "19", from: "09:00", to: "10:00", colorId: "7", description: "Consulta | Consultório" },
  { title: "Aula de natação", day: "17", from: "14:00", to: "15:00", calendarId: "curso" },
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
  start: iso(`2026-11-${sample.day}T${sample.from}`),
  end: iso(`2026-11-${sample.endDay ?? sample.day}T${sample.to}`),
  location: "",
  description: sample.description ?? "",
  etag: `"v1-${index}"`,
  recurring: sample.recurring ?? false,
  guests: 0,
  colorId: sample.colorId ?? "",
});

type Body = Record<string, string | boolean>;
type Answer = { status: number; json?: unknown; wait?: Promise<void>; abort?: boolean };

/**
 * Google as connected with two calendars and these events. A PATCH is answered by `change` (200 when it
 * says nothing) and, taken, changes the event as Google would: the fields sent and a new version.
 */
async function routeAgenda(page: Page, samples: Sample[], change: (body: Body, count: number) => Answer = () => ({ status: 200 })) {
  const events = samples.map(wire);
  const sent = { patches: [] as Body[], posts: [] as Body[], reads: 0 };
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const settings = (await response.json()) as { agenda: object };
    await route.fulfill({ response, json: { ...settings, agenda: { ...settings.agenda, ...OPEN } } });
  });
  await page.route("**/api/google", (route) =>
    route.fulfill({ json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: iso("2026-11-10T10:00"), calendars: CALENDARS } }),
  );
  await page.route("**/api/google/events?*", (route) => {
    sent.reads++;
    return route.fulfill({ json: { more: false, calendars: CALENDARS, events } });
  });
  await page.route("**/api/google/events", async (route) => {
    const method = route.request().method();
    const body = route.request().postDataJSON() as Body;
    if (method === "POST") {
      sent.posts.push(body);
      const created = { ...wire({ title: String(body.title), day: "16", from: "08:00", to: "09:00" }, events.length), start: iso(String(body.start)), end: iso(String(body.end)), colorId: String(body.colorId ?? "") };
      events.push(created);
      return route.fulfill({ status: 201, json: { event: created } });
    }
    if (method !== "PATCH") return route.fallback();
    sent.patches.push(body);
    const answer = change(body, sent.patches.length);
    if (answer.wait) await answer.wait;
    if (answer.abort) return route.abort("connectionfailed");
    if (answer.status !== 200) return route.fulfill({ status: answer.status, json: answer.json });
    const index = events.findIndex((event) => event.id === body.eventId);
    const before = events[index] as (typeof events)[number];
    const version = Number(/v(\d+)/.exec(before.etag)?.[1]) + 1;
    const saved = { ...before, etag: `"v${version}-${index}"` };
    for (const key of ["title", "location", "description", "colorId"] as const) if (typeof body[key] === "string") saved[key] = body[key];
    if (typeof body.start === "string") saved.start = iso(body.start);
    if (typeof body.end === "string") saved.end = iso(body.end);
    events[index] = saved;
    return route.fulfill({ json: { event: saved } });
  });
  return sent;
}

async function openAgenda(page: Page) {
  await page.clock.install({ time: NOW });
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
}

const event = (page: Page, title: string) => page.getByRole("main").getByRole("button", { name: new RegExp(`^${title}`) });
/** The column of a day in the week's grid, found by its heading. */
const column = (page: Page, day: string) => page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("button", { name: new RegExp(`^\\S+\\s*${day}\\s*, Ver o dia`) }) });
const notice = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const sync = (page: Page) => page.getByRole("main").locator("[data-sync]");
/** The toast as drawn (its text is also in the spoken copy): where its buttons are. */
const toast = (page: Page, text: string) => page.locator("div.pointer-events-auto").filter({ hasText: text });

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Presses the event and moves the mouse by `dx` columns' worth of pixels and `dy` pixels, in steps as a hand would. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, drop = true) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 2, from.y + (to.y - from.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  if (drop) await page.mouse.up();
}

test("CA7, CA8, CA13: dragging to another day and hour sends one change, marks Reagendado, says so, and Desfazer puts it all back; accessible", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  const sent = await routeAgenda(page, WEEK, (_body, count) => (count === 1 ? { status: 200, wait: held } : { status: 200 }));
  await openAgenda(page);
  const helena = event(page, "Helena Duarte Prado");
  // The block names the type and the status after the hour.
  await expect(helena).toContainText("09:00 – 10:00 · Consulta · Confirmado");
  await expect(sync(page)).toHaveText("Em dia com o Google");
  await expectAccessible(page, "agenda-arrastar-semana");

  // From Monday 9:00 to Tuesday 11:15: one column to the right and two hours and a quarter down.
  const from = await center(helena);
  const tuesday = await center(column(page, "17"));
  await drag(page, from, { x: tuesday.x, y: from.y + 2.25 * HOUR_PX + 3 }, false);
  // While held, the event is drawn where it would land, and nothing was sent.
  await expect(column(page, "17").getByRole("button", { name: /^Helena Duarte Prado/ })).toContainText("11:15 – 12:15");
  expect(sent.patches).toHaveLength(0);
  await page.mouse.up();

  // Shown at once where it lands, while Google has not answered.
  await expect(sync(page)).toHaveText("Salvando no Google…");
  await expect(column(page, "17").getByRole("button", { name: /^Helena Duarte Prado/ })).toContainText("11:15 – 12:15 · Consulta · Reagendado");
  // The release of a drag opens nothing.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent.patches).toEqual([{ calendarId: "main", eventId: "e0", etag: '"v1-0"', start: "2026-11-17T11:15", end: "2026-11-17T12:15", colorId: "5" }]);
  release();
  await expect(sync(page)).toHaveText("Salvo no Google agora");
  await expect(notice(page, "“Helena Duarte Prado” agora é ter, 17/11 às 11:15. Ficou como Reagendado.")).toBeVisible();
  await expectAccessible(page, "agenda-arrastar-aviso");

  // CA13: "Desfazer" sends the opposite change with the version Google just answered.
  await toast(page, "Ficou como Reagendado.").getByRole("button", { name: "Desfazer" }).click();
  await expect(notice(page, "Mudança desfeita")).toBeVisible();
  expect(sent.patches[1]).toEqual({ calendarId: "main", eventId: "e0", etag: '"v2-0"', allDay: false, start: "2026-11-16T09:00", end: "2026-11-16T10:00", colorId: "10" });
  await expect(column(page, "16").getByRole("button", { name: /^Helena Duarte Prado/ })).toContainText("09:00 – 10:00 · Consulta · Confirmado");
  // An undo is not undone again.
  await expect(toast(page, "Mudança desfeita").getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  expect(sent.patches).toHaveLength(2);
});

test("CA7: the lower edge changes the length a quarter of an hour at a time and never the status; Ctrl + Z undoes it", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  const helena = event(page, "Helena Duarte Prado");
  const { box } = await center(helena);
  const edge = { x: box.x + box.width / 2, y: box.y + box.height - 2 };
  // 40 px down is 43 minutes: the end lands on the quarter, 10:45.
  await drag(page, edge, { x: edge.x, y: edge.y + 40 });
  await expect(notice(page, "“Helena Duarte Prado” agora vai até 10:45.")).toBeVisible();
  expect(sent.patches).toEqual([{ calendarId: "main", eventId: "e0", etag: '"v1-0"', start: "2026-11-16T09:00", end: "2026-11-16T10:45" }]);
  await expect(helena).toContainText("09:00 – 10:45 · Consulta · Confirmado");

  // Pulled far above its start, the event keeps a quarter of an hour.
  const short = await center(helena);
  const low = { x: short.x, y: short.box.y + short.box.height - 2 };
  await drag(page, low, { x: low.x, y: low.y - 6 * HOUR_PX });
  await expect(helena).toContainText("09:00 – 09:15");
  expect(sent.patches[1]).toMatchObject({ etag: '"v2-0"', start: "2026-11-16T09:00", end: "2026-11-16T09:15" });

  // Ctrl + Z, while the notice offers "Desfazer", is the same as the button.
  await page.keyboard.press("Control+z");
  await expect(notice(page, "Mudança desfeita")).toBeVisible();
  expect(sent.patches[2]).toEqual({ calendarId: "main", eventId: "e0", etag: '"v3-0"', allDay: false, start: "2026-11-16T09:00", end: "2026-11-16T10:45" });
  // Nothing left to undo: the key does nothing more.
  await page.keyboard.press("Control+z");
  await expect(helena).toContainText("09:00 – 10:45");
  expect(sent.patches).toHaveLength(3);
});

test("a press that slips less than 5 px is a click; a drop where it was and Escape send nothing; the hours on screen hold the event", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  const helena = event(page, "Helena Duarte Prado");
  const from = await center(helena);

  // 4 px: still a click, the details open.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y);
  await page.mouse.up();
  const details = page.getByRole("dialog", { name: "Helena Duarte Prado" });
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Fechar" }).click();

  // A walk that ends where it began: no change, no notice.
  await drag(page, from, { x: from.x, y: from.y + 6 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Escape in the middle of a drag leaves the event where it was.
  await drag(page, from, { x: from.x, y: from.y + 3 * HOUR_PX }, false);
  await expect(helena).toContainText("12:00 – 13:00");
  await page.keyboard.press("Escape");
  await expect(helena).toContainText("09:00 – 10:00");
  // The button let go afterwards, over the event, is still the end of that drag: no details.
  await page.mouse.move(from.x, from.y);
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent.patches).toHaveLength(0);

  // Dragged far above the first hour, to the top of the window: it stops at 8:00.
  const here = await center(helena);
  await drag(page, here, { x: here.x, y: 2 });
  await expect(notice(page, "“Helena Duarte Prado” agora é seg, 16/11 às 08:00. Ficou como Reagendado.")).toBeVisible();
  const top = await center(helena);
  await drag(page, top, { x: top.x, y: top.y + 1.5 * HOUR_PX });
  await expect(notice(page, "“Helena Duarte Prado” agora é seg, 16/11 às 09:30.")).toBeVisible();
  expect(sent.patches.map((body) => [body.start, body.end])).toEqual([
    ["2026-11-16T08:00", "2026-11-16T09:00"],
    ["2026-11-16T09:30", "2026-11-16T10:30"],
  ]);
  // Already Reagendado after the first move: the second one says nothing of the status.
  expect(sent.patches[0]).toHaveProperty("colorId", "5");
  expect(sent.patches[1]).not.toHaveProperty("colorId");
});

test("CA12: an event of a read-only calendar does not drag, does not move by the keyboard and has no Editar", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  const lesson = event(page, "Aula de natação");
  const from = await center(lesson);
  await drag(page, from, { x: from.x, y: from.y + 2 * HOUR_PX });
  await expect(notice(page, "Esta agenda é só para leitura. Mude o evento no Google Agenda.")).toBeVisible();
  await expect(lesson).toContainText("14:00 – 15:00");
  await expect(column(page, "17").getByRole("button", { name: /^Aula de natação/ })).toBeVisible();
  // No edge to pull, and no way named for the keyboard.
  await expect(column(page, "17").locator("li").filter({ has: lesson }).locator("[data-resize]")).toHaveCount(0);
  await expect(lesson).not.toHaveAttribute("aria-describedby");

  // By the keyboard the same refusal, said again.
  const refusal = "Esta agenda é só para leitura. Mude o evento no Google Agenda.";
  await toast(page, refusal).getByRole("button", { name: "Fechar" }).click();
  await expect(toast(page, refusal)).toHaveCount(0);
  await lesson.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(toast(page, refusal)).toBeVisible();
  await expect(lesson).toContainText("14:00 – 15:00");
  await lesson.click();
  const details = page.getByRole("dialog", { name: "Aula de natação" });
  await expect(details.getByRole("button", { name: "Editar" })).toHaveCount(0);
  await expect(details.getByRole("button", { name: "Apagar" })).toHaveCount(0);
  expect(sent.patches).toHaveLength(0);
});

test("CA7: Alt + arrows move the event by the keyboard and send it once, when Alt is let go; with Shift they change the length", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  const isadora = event(page, "Isadora Pires Falcão");
  // The way by the keyboard is named for a screen reader.
  await expect(isadora).toHaveAccessibleDescription("Alt com as setas muda o dia e a hora. Alt com Shift e a seta para cima ou para baixo muda a duração. Solte o Alt para salvar.");
  await isadora.focus();
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  // Drawn in the day before, said as it moves, still focused, and nothing sent while Alt is held.
  await expect(column(page, "18").getByRole("button", { name: /^Isadora Pires Falcão/ })).toContainText("09:30 – 10:30");
  await expect(page.getByText("quarta-feira, 18 de novembro, das 09:30 às 10:30")).toHaveCount(1);
  await expect(isadora).toBeFocused();
  expect(sent.patches).toHaveLength(0);
  await page.keyboard.up("Alt");
  await expect(notice(page, "“Isadora Pires Falcão” agora é qua, 18/11 às 09:30. Ficou como Reagendado.")).toBeVisible();
  expect(sent.patches).toEqual([{ calendarId: "main", eventId: "e4", etag: '"v1-4"', start: "2026-11-18T09:30", end: "2026-11-18T10:30", colorId: "5" }]);
  await expect(isadora).toBeFocused();

  // With Shift, up and down change only the end.
  await page.keyboard.down("Alt");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.up("Alt");
  await expect(notice(page, "“Isadora Pires Falcão” agora vai até 10:45.")).toBeVisible();
  expect(sent.patches[1]).toEqual({ calendarId: "main", eventId: "e4", etag: '"v2-4"', start: "2026-11-18T09:30", end: "2026-11-18T10:45" });

  // Escape gives up a move not yet sent; a move back to where it was sends nothing.
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowUp");
  await expect(isadora).toContainText("09:15 – 10:30");
  await page.keyboard.press("Escape");
  await page.keyboard.up("Alt");
  await expect(isadora).toContainText("09:30 – 10:45");
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Alt");
  expect(sent.patches).toHaveLength(2);

  // The last day on screen is the end of the way: Sunday has no day to its right.
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Alt");
  await expect(column(page, "22").getByRole("button", { name: /^Isadora Pires Falcão/ })).toBeVisible();
  expect(sent.patches[2]).toMatchObject({ start: "2026-11-22T09:30", end: "2026-11-22T10:45" });
});

test("CA8: with the connection down the event goes back and Tentar de novo sends it again; changed at Google, the screen reads it again", async ({ page }) => {
  let answer: Answer = { status: 200, abort: true };
  const sent = await routeAgenda(page, WEEK, () => answer);
  await openAgenda(page);
  const helena = event(page, "Helena Duarte Prado");
  const from = await center(helena);
  await drag(page, from, { x: from.x, y: from.y + 2 * HOUR_PX });
  const offline = "Não deu para salvar no Google. O evento voltou para onde estava.";
  await expect(notice(page, offline)).toBeVisible();
  // Back where it was, with the status it had.
  await expect(helena).toContainText("09:00 – 10:00 · Consulta · Confirmado");
  await expect(sync(page)).toHaveText("Em dia com o Google");
  expect(sent.patches).toHaveLength(1);

  // The notice stays until answered, and its button sends the same change.
  answer = { status: 200 };
  await page.clock.runFor(20_000);
  await toast(page, offline).getByRole("button", { name: "Tentar de novo" }).click();
  await expect(notice(page, "“Helena Duarte Prado” agora é seg, 16/11 às 11:00. Ficou como Reagendado.")).toBeVisible();
  expect(sent.patches[1]).toEqual(sent.patches[0]);
  await expect(helena).toContainText("11:00 – 12:00 · Consulta · Reagendado");

  // Changed at Google in the meantime: refused, said, and the week is read again.
  answer = { status: 409, json: { code: "TARGET_CHANGED", message: "O evento mudou no Google enquanto isso, então nada foi feito. Abra de novo e tente outra vez." } };
  const reads = sent.reads;
  const marina = event(page, "Marina Teles Barreto");
  const at = await center(marina);
  await drag(page, at, { x: at.x, y: at.y + HOUR_PX });
  await expect(notice(page, "O evento mudou no Google enquanto isso")).toBeVisible();
  await expect(marina).toContainText("14:00 – 15:00");
  await expect.poll(() => sent.reads).toBeGreaterThan(reads);
  // No "Desfazer" for what was not done.
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);

  // Any other refusal says what Google said and that the event went back.
  answer = { status: 503, json: { code: "SERVICE_UNAVAILABLE", message: "O Google não respondeu. Tente de novo em instantes." } };
  const again = await center(marina);
  await drag(page, again, { x: again.x, y: again.y + HOUR_PX });
  await expect(notice(page, "O Google não respondeu. Tente de novo em instantes. O evento voltou para onde estava.")).toBeVisible();
  await expect(marina).toContainText("14:00 – 15:00");
});

test("a repeating event changes on that day only, and the notice warns of another event at the same hour", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  const meeting = event(page, "Reunião da equipe");
  const from = await center(meeting);
  const tuesday = await center(column(page, "17"));
  // Onto Tuesday 14:00, where the swimming lesson already is.
  await drag(page, from, { x: tuesday.x, y: from.y });
  await expect(notice(page, "“Reunião da equipe” agora é ter, 17/11 às 14:00. Só este dia mudou. Atenção: há outro evento neste horário.")).toBeVisible();
  // Without a type it is not an appointment: the status stays.
  expect(sent.patches).toEqual([{ calendarId: "main", eventId: "e3", etag: '"v1-3"', start: "2026-11-17T14:00", end: "2026-11-17T15:00" }]);
});

test("an empty hour opens Novo evento on that day and hour; the form's Dura, Tipo and Situação go to Google", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  // Thursday, a little after 11:30: the half hour clicked.
  const thursday = column(page, "19").locator("[data-hours]");
  const box = await thursday.boundingBox();
  if (!box) throw new Error("the column is not on screen");
  await page.mouse.click(box.x + box.width / 2, box.y + 3.6 * HOUR_PX);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await expect(form.getByLabel("Dia", { exact: true })).toHaveValue("2026-11-19");
  await expect(form.getByLabel("Hora de início")).toHaveValue("11:30");
  await expect(form.getByLabel("Dura")).toHaveValue("60");
  await expect(form.getByLabel("Dura").getByRole("option")).toHaveText(["15 min", "30 min", "45 min", "1 hora", "1 h 30", "2 horas", "3 horas", "Outra"]);
  // The types the calendar already uses, and none.
  await expect(form.getByLabel("Tipo").getByRole("option")).toHaveText(["Sem tipo", "Consulta | Consultório", "Retorno | Consultório"]);
  await expect(form.getByLabel("Situação")).toHaveValue("scheduled");
  // The end's own fields show only for another length.
  await expect(form.getByLabel("Hora de fim")).toHaveCount(0);
  await expectAccessible(page, "agenda-arrastar-formulario");

  await form.getByRole("textbox", { name: "Título" }).fill("Bruno Macedo Teixeira");
  await form.getByLabel("Dura").selectOption("30");
  await form.getByLabel("Tipo").selectOption("Retorno | Consultório");
  await form.getByLabel("Situação").selectOption("confirmed");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(notice(page, "Evento criado")).toBeVisible();
  expect(sent.posts).toEqual([
    { calendarId: "main", title: "Bruno Macedo Teixeira", allDay: false, start: "2026-11-19T11:30", end: "2026-11-19T12:00", location: "", description: "Retorno | Consultório", colorId: "10" },
  ]);

  // "Agendado" is an event without a color: nothing of it is sent. A new event starts as a Consulta.
  await page.getByRole("button", { name: "Novo evento" }).click();
  await form.getByRole("textbox", { name: "Título" }).fill("Clara Nóbrega Dias");
  await form.getByLabel("Dura").selectOption("other");
  await form.getByLabel("Dia", { exact: true }).fill("2026-11-18");
  await form.getByLabel("Hora de início").fill("15:00");
  await form.getByLabel("Termina em").fill("2026-11-18");
  await form.getByLabel("Hora de fim").fill("14:00");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(form.getByRole("alert")).toHaveText("O fim precisa ser depois do começo.");
  await form.getByLabel("Hora de fim").fill("15:50");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(form).toHaveCount(0);
  expect(sent.posts[1]).toEqual({ calendarId: "main", title: "Clara Nóbrega Dias", allDay: false, start: "2026-11-18T15:00", end: "2026-11-18T15:50", location: "", description: "Consulta | Consultório" });
});

test("Editar changes the length, the type and the status in one change, with its notice and Desfazer; a new hour marks Reagendado unless a status is picked", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  await event(page, "Marina Teles Barreto").click();
  await page.getByRole("dialog", { name: "Marina Teles Barreto" }).getByRole("button", { name: "Editar" }).click();
  const form = page.getByRole("dialog", { name: "Editar evento" });
  await expect(form.getByLabel("Dura")).toHaveValue("60");
  await expect(form.getByLabel("Tipo")).toHaveValue("Retorno | Consultório");
  await expect(form.getByLabel("Situação")).toHaveValue("scheduled");
  // The description shows without its type line.
  await expect(form.getByRole("textbox", { name: "Descrição (opcional)" })).toHaveValue("Levar exames");
  await form.getByLabel("Dura").selectOption("90");
  await form.getByLabel("Tipo").selectOption("Consulta | Consultório");
  await form.getByLabel("Situação").selectOption("confirmed");
  await form.getByRole("button", { name: "Salvar" }).click();
  // The form closes and the notice is on the page, within reach.
  await expect(form).toHaveCount(0);
  await expect(notice(page, "“Marina Teles Barreto” atualizado.")).toBeVisible();
  expect(sent.patches).toEqual([
    { calendarId: "main", eventId: "e1", etag: '"v1-1"', description: "Consulta | Consultório\nLevar exames", allDay: false, start: "2026-11-16T14:00", end: "2026-11-16T15:30", colorId: "10" },
  ]);
  await expect(event(page, "Marina Teles Barreto")).toContainText("14:00 – 15:30 · Consulta · Confirmado");

  // "Desfazer" puts back the three at once.
  await toast(page, "“Marina Teles Barreto” atualizado.").getByRole("button", { name: "Desfazer" }).click();
  await expect(notice(page, "Mudança desfeita")).toBeVisible();
  expect(sent.patches[1]).toEqual({ calendarId: "main", eventId: "e1", etag: '"v2-1"', description: "Retorno | Consultório\nLevar exames", allDay: false, start: "2026-11-16T14:00", end: "2026-11-16T15:00", colorId: "" });
  await expect(event(page, "Marina Teles Barreto")).toContainText("14:00 – 15:00 · Retorno · Agendado");

  // A new hour alone marks the appointment "Reagendado", and the notice says it.
  await event(page, "Marina Teles Barreto").click();
  await page.getByRole("dialog", { name: "Marina Teles Barreto" }).getByRole("button", { name: "Editar" }).click();
  await form.getByLabel("Hora de início").fill("16:00");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(notice(page, "“Marina Teles Barreto” atualizado. Ficou como Reagendado.")).toBeVisible();
  expect(sent.patches[2]).toMatchObject({ start: "2026-11-16T16:00", end: "2026-11-16T17:00", colorId: "5" });

  // A status picked in the form wins over the mark; saving without a change sends nothing.
  await event(page, "Marina Teles Barreto").click();
  await page.getByRole("dialog", { name: "Marina Teles Barreto" }).getByRole("button", { name: "Editar" }).click();
  await form.getByLabel("Hora de início").fill("15:00");
  await form.getByLabel("Situação").selectOption("cancelled");
  await form.getByRole("button", { name: "Salvar" }).click();
  // Nothing about "Reagendado": the status picked is the one that counts.
  await expect(notice(page, /“Marina Teles Barreto” atualizado\.$/)).toBeVisible();
  expect(sent.patches[3]).toMatchObject({ start: "2026-11-16T15:00", colorId: "11" });
  await event(page, "Marina Teles Barreto").click();
  await page.getByRole("dialog", { name: "Marina Teles Barreto" }).getByRole("button", { name: "Editar" }).click();
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(form).toHaveCount(0);
  await expect(sync(page)).not.toHaveText("Salvando no Google…");
  expect(sent.patches).toHaveLength(4);
});

test("on a phone the change is by Editar: no dragging, the day's list names the type, and the notice offers Desfazer @mobile", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  // The phone opens on the day; a computer gets there by "Dia". Either way the day is a list, which does not drag.
  await page.getByRole("group", { name: "Ver por" }).getByText("Dia", { exact: true }).click();
  await page.getByRole("navigation", { name: "Dias da semana" }).getByRole("button", { name: /^seg\s*16/ }).click();
  const helena = event(page, "Helena Duarte Prado");
  await expect(helena).toContainText("Consulta · Confirmado · até 10:00");
  // A finger that slides over the event scrolls the page: nothing moves.
  await expect(page.locator("[data-resize]")).toHaveCount(0);
  await expect(sync(page)).toHaveText("Em dia com o Google");

  await helena.click();
  await page.getByRole("dialog", { name: "Helena Duarte Prado" }).getByRole("button", { name: "Editar" }).click();
  const form = page.getByRole("dialog", { name: "Editar evento" });
  await expectAccessible(page, "agenda-arrastar-formulario-celular");
  await form.getByLabel("Dia", { exact: true }).fill("2026-11-17");
  await form.getByLabel("Dura").selectOption("30");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(notice(page, "“Helena Duarte Prado” atualizado. Ficou como Reagendado.")).toBeVisible();
  expect(sent.patches).toEqual([{ calendarId: "main", eventId: "e0", etag: '"v1-0"', allDay: false, start: "2026-11-17T09:00", end: "2026-11-17T09:30", colorId: "5" }]);
  // Gone from Monday's list.
  await expect(helena).toHaveCount(0);
  await toast(page, "Ficou como Reagendado.").getByRole("button", { name: "Desfazer" }).click();
  await expect(helena).toContainText("Consulta · Confirmado · até 10:00");
  expect(sent.patches[1]).toMatchObject({ etag: '"v2-0"', start: "2026-11-16T09:00", end: "2026-11-16T10:00", colorId: "10" });
});

test("while one change is on its way the next is not taken, and leaving the Agenda takes the offer of Desfazer away", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  const sent = await routeAgenda(page, WEEK, (_body, count) => (count === 1 ? { status: 200, wait: held } : { status: 200 }));
  await openAgenda(page);
  const helena = event(page, "Helena Duarte Prado");
  const from = await center(helena);
  await drag(page, from, { x: from.x, y: from.y + HOUR_PX });
  await expect(sync(page)).toHaveText("Salvando no Google…");
  // A second drag, of another event, before the answer: it stays where it is.
  const renato = event(page, "Renato Sampaio Cruz");
  const other = await center(renato);
  await drag(page, other, { x: other.x, y: other.y + HOUR_PX });
  await expect(renato).toContainText("10:00 – 11:00");
  expect(sent.patches).toHaveLength(1);
  release();
  await expect(notice(page, "“Helena Duarte Prado” agora é seg, 16/11 às 10:00.")).toBeVisible();
  // Now it goes, with its own version.
  const free = await center(renato);
  await drag(page, free, { x: free.x, y: free.y + HOUR_PX });
  await expect(notice(page, "“Renato Sampaio Cruz” agora é ter, 17/11 às 11:00.")).toBeVisible();
  // The undo of the first change left with the second: one "Desfazer" on screen, the last one's.
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(1);

  await page.getByRole("link", { name: "Configurar a agenda" }).click();
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  expect(sent.patches).toHaveLength(2);
});

test("in English the notices, the line of Google and the form speak English", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...((await response.json()) as object), language: "en" } });
  });
  await page.clock.install({ time: NOW });
  await page.goto("/agenda");
  await signIn(page);
  await expect(sync(page)).toHaveText("Up to date with Google");
  const helena = event(page, "Helena Duarte Prado");
  const from = await center(helena);
  await drag(page, from, { x: from.x, y: from.y + HOUR_PX });
  await expect(notice(page, "“Helena Duarte Prado” is now on Mon, 11/16 at 10:00. It is now Rescheduled.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.getByRole("button", { name: "New event" }).click();
  const form = page.getByRole("dialog", { name: "New event" });
  await expect(form.getByLabel("Lasts").getByRole("option")).toHaveText(["15 min", "30 min", "45 min", "1 hour", "1 h 30", "2 hours", "3 hours", "Other"]);
  await expect(form.getByLabel("Type").getByRole("option").first()).toHaveText("No type");
});

test("QA-E3-02: Desfazer is on offer for eight seconds, by the button and by Ctrl + Z, and not a moment longer", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  const helena = event(page, "Helena Duarte Prado");
  const from = await center(helena);
  await drag(page, from, { x: from.x, y: from.y + HOUR_PX });
  const undo = page.getByRole("button", { name: "Desfazer" });
  await expect(undo).toBeVisible();
  // The mouse left the notice: its time runs.
  await page.mouse.move(5, 5);
  await page.clock.runFor(7_900);
  await expect(undo).toBeVisible();
  await page.clock.runFor(200);
  await expect(undo).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(helena).toContainText("10:00 – 11:00");
  await expect(sync(page)).not.toHaveText("Salvando no Google…");
  expect(sent.patches).toHaveLength(1);

  // Inside the eight seconds the key still undoes.
  const again = await center(helena);
  await drag(page, again, { x: again.x, y: again.y + HOUR_PX });
  await expect(undo).toBeVisible();
  await page.mouse.move(5, 5);
  await page.clock.runFor(7_000);
  await page.keyboard.press("Control+z");
  await expect(notice(page, "Mudança desfeita")).toBeVisible();
  expect(sent.patches).toHaveLength(3);
});

test("QA-E3-04: a finger on the week's grid does not drag: the event stays and nothing is sent", async ({ browser }) => {
  // A tablet or a laptop with touch: wide enough for the grid of hours.
  const context = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo", hasTouch: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await routeFakeTurnstile(context);
    const sent = await routeAgenda(page, WEEK);
    await openAgenda(page);
    const helena = event(page, "Helena Duarte Prado");
    const from = await center(helena);
    const finger = (type: string, y: number) => ({ type, init: { pointerType: "touch", pointerId: 7, isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: from.x, clientY: y, bubbles: true } });
    await helena.dispatchEvent("pointerdown", finger("pointerdown", from.y).init);
    for (const step of [20, 60, 2 * HOUR_PX]) await page.evaluate(({ type, init }) => window.dispatchEvent(new PointerEvent(type, init)), finger("pointermove", from.y + step));
    await expect(helena).toContainText("09:00 – 10:00");
    await page.evaluate(({ type, init }) => window.dispatchEvent(new PointerEvent(type, init)), finger("pointerup", from.y + 2 * HOUR_PX));
    await expect(helena).toContainText("09:00 – 10:00");
    await expect(sync(page)).toHaveText("Em dia com o Google");
    expect(sent.patches).toHaveLength(0);
    // The same walk with a mouse does move it: the refusal is the finger's.
    await drag(page, from, { x: from.x, y: from.y + 2 * HOUR_PX });
    await expect(helena).toContainText("11:00 – 12:00");
  } finally {
    await context.close();
  }
});

test("QA-E3-07: a device far from the owner's zone drags by the owner's hours", async ({ browser }) => {
  const context = await browser.newContext({ locale: "pt-BR", timezoneId: "Asia/Tokyo", viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await routeFakeTurnstile(context);
    const sent = await routeAgenda(page, WEEK);
    await openAgenda(page);
    const helena = event(page, "Helena Duarte Prado");
    await expect(helena).toContainText("09:00 – 10:00");
    const from = await center(helena);
    const tuesday = await center(column(page, "17"));
    // 11:00, right after Renato's consultation: 10:00 would sit on it and be refused.
    await drag(page, from, { x: tuesday.x, y: from.y + 2 * HOUR_PX });
    await expect(notice(page, "“Helena Duarte Prado” agora é ter, 17/11 às 11:00. Ficou como Reagendado.")).toBeVisible();
    expect(sent.patches).toEqual([{ calendarId: "main", eventId: "e0", etag: '"v1-0"', start: "2026-11-17T11:00", end: "2026-11-17T12:00", colorId: "5" }]);
    await expect(column(page, "17").getByRole("button", { name: /^Helena Duarte Prado/ })).toContainText("11:00 – 12:00");
  } finally {
    await context.close();
  }
});

test("QA-E3-01, QA-E3-08, QA-E3-09: a change is never dropped in silence, and Desfazer never names an old version", async ({ page }) => {
  let release = () => {};
  let held: Promise<void> | undefined = new Promise<void>((done) => {
    release = done;
  });
  const sent = await routeAgenda(page, WEEK, () => {
    const wait = held;
    held = undefined;
    return wait ? { status: 200, wait } : { status: 200 };
  });
  await openAgenda(page);
  const helena = event(page, "Helena Duarte Prado");
  const from = await center(helena);
  await drag(page, from, { x: from.x, y: from.y + HOUR_PX });
  await expect(sync(page)).toHaveText("Salvando no Google…");

  // QA-E3-01: "Salvar" of the form waits for the answer of the change before it; the form stays open with what was typed.
  await event(page, "Renato Sampaio Cruz").click();
  await page.getByRole("dialog", { name: "Renato Sampaio Cruz" }).getByRole("button", { name: "Editar" }).click();
  const form = page.getByRole("dialog", { name: "Editar evento" });
  await form.getByRole("textbox", { name: "Título" }).fill("Renato Sampaio Cruz Filho");
  await expect(form.getByRole("button", { name: "Salvar" })).toBeDisabled();
  expect(sent.patches).toHaveLength(1);
  release();
  await expect(form.getByRole("button", { name: "Salvar" })).toBeEnabled();
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(notice(page, "“Renato Sampaio Cruz Filho” atualizado.")).toBeVisible();
  expect(sent.patches[1]).toEqual({ calendarId: "main", eventId: "e2", etag: '"v1-2"', title: "Renato Sampaio Cruz Filho" });

  // QA-E3-08: a status changed in the details takes the offer away: its version is no longer Google's.
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(1);
  await event(page, "Renato Sampaio Cruz Filho").click();
  const details = page.getByRole("dialog", { name: "Renato Sampaio Cruz Filho" });
  await details.getByRole("group", { name: "Situação" }).getByRole("button", { name: "Confirmado" }).click();
  await expect(details.getByRole("status")).toHaveText("Situação salva");
  await details.getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  expect(sent.patches[2]).toMatchObject({ etag: '"v2-2"', colorId: "10" });

  // QA-E3-09: the owner leaves while a change is on its way: the answer offers no "Desfazer" on another screen.
  held = new Promise<void>((done) => {
    release = done;
  });
  const marina = event(page, "Marina Teles Barreto");
  const at = await center(marina);
  await drag(page, at, { x: at.x, y: at.y + HOUR_PX });
  await expect(sync(page)).toHaveText("Salvando no Google…");
  await page.getByRole("link", { name: "Configurar a agenda" }).click();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Agenda");
  release();
  await expect(notice(page, "“Marina Teles Barreto” agora é seg, 16/11 às 15:00.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  expect(sent.patches).toHaveLength(4);
});

test("QA-E3-10: an event that crosses the night has no edge to pull and names no keys; QA-E3-03: Alt + arrow to the side keeps its hour", async ({ page }) => {
  const sent = await routeAgenda(page, [
    ...WEEK,
    // 16:00 to 02:00 of the next day.
    { title: "Plantão noturno", day: "17", from: "16:00", to: "02:00", endDay: "18" },
    { title: "Paula Régis Amaral", day: "18", from: "17:30", to: "19:00", description: "Consulta | Consultório" },
  ]);
  await openAgenda(page);
  const night = column(page, "17").getByRole("button", { name: /^Plantão noturno/ });
  await expect(night).toBeVisible();
  await expect(night).not.toHaveAttribute("aria-describedby");
  await expect(column(page, "17").locator("li").filter({ has: night }).locator("[data-resize]")).toHaveCount(0);

  // 17:30 to 19:00, past the last hour on screen: a day to the left, and the hour is the same.
  const paula = event(page, "Paula Régis Amaral");
  await paula.focus();
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Alt");
  await expect(notice(page, "“Paula Régis Amaral” agora é ter, 17/11 às 17:30. Ficou como Reagendado.")).toBeVisible();
  expect(sent.patches).toEqual([{ calendarId: "main", eventId: "e7", etag: '"v1-7"', start: "2026-11-17T17:30", end: "2026-11-17T19:00", colorId: "5" }]);
});
