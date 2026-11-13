import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// The booking rule on the screen (docs/planos/agenda-travas-do-agendamento.md, E5a): a consultation goes
// only into the office hours of a working day, never at lunch, on a holiday not opened, on a day off or
// over another one. A click on a closed hour says why and offers the next free one; a drop there is
// refused with its reason on the block; the form points at the field to fix. Configurações › Agenda
// keeps the lunch, the holidays worked and the days off. Google is answered here; the settings go
// through the real server, which checks the same rule again (apps/agent/test/google-routes.test.ts).

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
  await page.route("**/api/google/events?*", (route) => route.fulfill({ json: { more: false, calendars, events } }));
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
const notice = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

/** A click on `hours` (decimal, from 08:00) of a day's column. */
async function clickHour(page: Page, day: string, hours: number) {
  const box = await column(page, day).locator("[data-hours]").boundingBox();
  if (!box) throw new Error("the column is not on screen");
  await page.mouse.click(box.x + box.width / 2, box.y + hours * HOUR_PX + 3);
}

async function center(page: Page, title: string) {
  const box = await event(page, title).boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragBy(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
}

// The preferences are one per installation: every test leaves them as they come.
test.afterEach(async ({ page }) => {
  await page.request.patch("/api/settings", { headers: CSRF, data: { agenda: DEFAULTS } });
});

test("a click on the lunch hour says why and offers the next free hour; a holiday offers a personal event instead", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  // The lunch is drawn on the open days, and not on the holiday.
  await expect(column(page, "19").locator("[data-lunch]")).toHaveCount(1);
  await expect(column(page, "20").locator("[data-lunch]")).toHaveCount(0);

  // Thursday at 12:15: the lunch.
  await clickHour(page, "19", 4.25);
  const closed = page.getByRole("dialog", { name: "Consulta não entra neste horário" });
  await expect(closed.getByRole("alert")).toHaveText("qui, 19/11, às 12:00. No almoço, das 12:00 às 14:00, não entra consulta.");
  await expect(closed.getByText("Próximo horário livre: qui, 19/11, às 15:00.")).toBeVisible();
  await expect(closed.getByRole("button", { name: "Usar o próximo livre" })).toBeVisible();
  await expectAccessible(page, "agenda-travas-horario-fechado");
  await closed.getByRole("button", { name: "Usar o próximo livre" }).click();
  // The form opens on the free hour, as a consultation: after the lunch (until 14:00) and Renato's return.
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await expect(form.getByLabel("Dia", { exact: true })).toHaveValue("2026-11-19");
  await expect(form.getByLabel("Hora de início")).toHaveValue("15:00");
  await expect(form.getByLabel("Tipo")).toHaveValue("Consulta | Consultório");
  await form.getByRole("textbox", { name: "Título" }).fill("Bruno Macedo Teixeira");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(form).toHaveCount(0);
  expect(sent.posts).toEqual([
    { calendarId: "main", title: "Bruno Macedo Teixeira", allDay: false, start: "2026-11-19T15:00", end: "2026-11-19T16:00", location: "", description: "Consulta | Consultório" },
  ]);

  // Friday 20 is Consciência Negra: nothing free is left in the week read, and a personal event still fits.
  await clickHour(page, "20", 1.5);
  await expect(closed.getByRole("alert")).toContainText("é feriado (Consciência Negra)");
  await expect(closed.getByText(/Próximo horário livre/)).toHaveCount(0);
  await expect(closed.getByRole("button", { name: "Entendi" })).toBeVisible();
  await closed.getByRole("button", { name: "Criar compromisso pessoal" }).click();
  await expect(form.getByLabel("Dia", { exact: true })).toHaveValue("2026-11-20");
  await expect(form.getByLabel("Hora de início")).toHaveValue("09:30");
  await expect(form.getByLabel("Tipo")).toHaveValue("");
  await form.getByRole("button", { name: "Fechar" }).click();

  // An hour gone by today, and Escape closes the notice without opening anything.
  await clickHour(page, "18", 1);
  await expect(closed.getByRole("alert")).toContainText("Esse horário já passou.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // An open hour opens the form straight away.
  await clickHour(page, "19", 2.5);
  await expect(form.getByLabel("Hora de início")).toHaveValue("10:30");
  await form.getByRole("button", { name: "Fechar" }).click();
  // The last half hour before lunch takes a half-hour appointment: the form opens with 30 minutes, not the notice.
  await clickHour(page, "19", 3.5);
  await expect(form.getByLabel("Hora de início")).toHaveValue("11:30");
  await expect(form.getByLabel("Dura", { exact: true })).toHaveValue("30");
});

test("a consultation dragged into the lunch or onto the holiday is refused with its reason, and a meeting is not", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  // Tall enough for the whole office day: a drag starts and ends on screen.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openAgenda(page);
  // A meeting has no type: the rule does not bind it, and the lunch takes it.
  const meeting = await center(page, "Reunião da equipe");
  await dragBy(page, meeting, { x: meeting.x, y: meeting.y - 3 * HOUR_PX });
  await page.mouse.up();
  await expect(notice(page, /“Reunião da equipe” agora é qua, 18\/11 às 12:00/)).toBeVisible();
  expect(sent.patches).toEqual([{ calendarId: "main", eventId: "e2", etag: '"v1-2"', start: "2026-11-18T12:00", end: "2026-11-18T13:00" }]);

  const from = await center(page, "Isadora Pires Falcão");

  // 09:00 to 12:00 on Thursday: the block says "Almoço" in red while it is held.
  await dragBy(page, from, { x: from.x, y: from.y + 3 * HOUR_PX });
  const held = column(page, "19").getByRole("button", { name: /^Isadora Pires Falcão/ });
  await expect(held).toContainText("Almoço");
  await expect(held).toHaveClass(/ring-danger/);
  await page.mouse.up();
  // A pop-up, not a line at the foot of the screen (13/11/2026, 03:03): the reason and the next free hour.
  const refused = page.getByRole("dialog", { name: "Consulta não entra neste horário" });
  await expect(refused.getByRole("alert")).toHaveText("qui, 19/11, às 12:00. No almoço, das 12:00 às 14:00, não entra consulta. A consulta ficou onde estava.");
  await expect(refused.getByText("Próximo horário livre: qui, 19/11, às 15:00.")).toBeVisible();
  await expect(refused.getByRole("button", { name: "Criar compromisso pessoal" })).toHaveCount(0);
  await expectAccessible(page, "agenda-travas-arrasto-recusado");
  await refused.getByRole("button", { name: "Entendi" }).click();
  await expect(refused).toHaveCount(0);
  await expect(event(page, "Isadora Pires Falcão")).toContainText("09:00 – 10:00");
  expect(sent.patches).toHaveLength(1);

  // A day to the right is the holiday.
  const friday = (await column(page, "20").boundingBox()) ?? { x: 0, width: 0 };
  await dragBy(page, from, { x: friday.x + friday.width / 2, y: from.y });
  await expect(column(page, "20").getByRole("button", { name: /^Isadora Pires Falcão/ })).toContainText("Feriado");
  await page.mouse.up();
  // Friday, Saturday and Sunday are closed: nothing free is left in the week read.
  await expect(refused.getByRole("alert")).toContainText("é feriado (Consciência Negra)");
  await expect(refused.getByRole("button", { name: "Entendi" })).toBeVisible();
  await expect(refused.getByRole("button", { name: "Mover para lá" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(sent.patches).toHaveLength(1);

  // Over Renato's return at 14:00.
  await dragBy(page, from, { x: from.x, y: from.y + 5 * HOUR_PX });
  await expect(held).toContainText("Ocupado");
  await page.mouse.up();
  await expect(refused.getByRole("alert")).toHaveText("qui, 19/11, às 14:00. Já há consulta de Renato Sampaio Cruz das 14:00 às 15:00. Escolha outro horário. A consulta ficou onde estava.");
  expect(sent.patches).toHaveLength(1);
  // "Mover para lá" takes it to the next free hour, with its own length.
  await refused.getByRole("button", { name: "Mover para lá" }).click();
  await expect(notice(page, /“Isadora Pires Falcão” agora é qui, 19\/11 às 15:00/)).toBeVisible();
  expect(sent.patches[1]).toMatchObject({ eventId: "e0", start: "2026-11-19T15:00", end: "2026-11-19T16:00" });

  // By the keyboard the same: from 15:00, Alt + arrow up into the lunch is said, and refused when Alt is let go.
  const isadora = event(page, "Isadora Pires Falcão");
  await isadora.focus();
  await page.keyboard.down("Alt");
  for (let step = 0; step < 12; step++) await page.keyboard.press("ArrowUp");
  await expect(page.getByText(/das 12:00 às 13:00 Almoço/)).toHaveCount(1);
  await page.keyboard.up("Alt");
  await expect(refused.getByRole("alert")).toContainText("No almoço, das 12:00 às 14:00, não entra consulta. A consulta ficou onde estava.");
  expect(sent.patches).toHaveLength(2);
});

test("the form refuses a consultation at lunch over the form, with Corrigir, Esc and the next free hour; without a type the lunch takes it", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  await event(page, "Isadora Pires Falcão").click();
  await page.getByRole("dialog", { name: "Isadora Pires Falcão" }).getByRole("button", { name: "Editar" }).click();
  const form = page.getByRole("dialog", { name: "Editar evento" });
  const start = form.getByLabel("Hora de início");
  const save = form.getByRole("button", { name: "Salvar" });
  // Changed herself, her own 09:00 is free; Renato takes 14:00, so the next free hour after lunch is 15:00 (E5c, protótipo v52).
  await start.fill("12:30");
  await save.click();
  const refusal = page.getByRole("alertdialog", { name: "Consulta não entra neste horário" });
  await expect(refusal).toHaveAccessibleDescription("qui, 19/11, às 12:30. No almoço, das 12:00 às 14:00, não entra consulta.");
  await expect(refusal.getByText("Próximo horário livre: qui, 19/11, às 15:00.")).toBeVisible();
  await expect(refusal.getByRole("button", { name: "Usar este horário" })).toBeFocused();
  await expectAccessible(page, "agenda-travas-formulario");
  // Esc closes only the notice: the form stays as it was typed, the cursor on the start.
  await page.keyboard.press("Escape");
  await expect(refusal).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(start).toBeFocused();
  await expect(start).toHaveValue("12:30");
  await save.click();
  await refusal.getByRole("button", { name: "Corrigir" }).click();
  await expect(start).toBeFocused();
  // "Usar este horário" takes the next free hour, keeps the length and goes to Salvar.
  await save.click();
  await refusal.getByRole("button", { name: "Usar este horário" }).click();
  await expect(refusal).toHaveCount(0);
  await expect(start).toHaveValue("15:00");
  await expect(form.getByLabel("Dura", { exact: true })).toHaveValue("60");
  await expect(save).toBeFocused();
  await expect(form.getByText("Horário trocado para qui, 19/11, às 15:00. Confira e toque em Salvar.")).toBeAttached();
  expect(sent.patches).toEqual([]);
  // Minutes off the five-minute step are refused before anything else.
  await start.fill("10:03");
  await save.click();
  await expect(refusal).toHaveAccessibleDescription(/Use horários de 5 em 5 minutos, por exemplo 14:30 ou 14:35\.$/);
  await page.keyboard.press("Escape");
  // Without a type it is a personal event: the lunch takes it.
  await start.fill("12:30");
  await form.getByLabel("Tipo").selectOption("");
  await save.click();
  await expect(form).toHaveCount(0);
  expect(sent.patches).toHaveLength(1);
  expect(sent.patches[0]).toMatchObject({ eventId: "e0", start: "2026-11-19T12:30", end: "2026-11-19T13:30", description: "" });
});

test("Configurações › Agenda keeps the lunch and the periods off, lists the holidays and what was left outside @mobile", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await page.clock.setFixedTime(NOW);
  await page.goto("/configuracoes/agenda");
  await signIn(page);
  const card = page.getByRole("region", { name: "Agenda" }).last();
  const save = card.getByRole("button", { name: "Salvar alterações" });
  await expect(card.getByRole("img", { name: "Das 08:00 às 18:00, 10 horas. Almoço das 12:00 às 14:00" })).toBeVisible();
  // The lunch moves in half hours, and goes with "Sem almoço".
  await card.getByLabel("até", { exact: true }).selectOption("810");
  await expect(card.getByRole("img", { name: "Das 08:00 às 18:00, 10 horas. Almoço das 12:00 às 13:30" })).toBeVisible();

  // The next national holidays on an office day, only to read: every one closes the day (13/11/2026).
  const holidays = card.getByRole("list", { name: "Feriados nacionais" });
  await expect(holidays.getByRole("listitem").first()).toContainText("20/11Consciência Negra");
  await expect(holidays.getByRole("button")).toHaveCount(0);
  await expect(card.getByText("A agenda fecha sozinha em todo feriado nacional.", { exact: false })).toBeVisible();
  // The record of the day: only said here, nothing to set.
  await expect(card.getByText("Registro do dia", { exact: true })).toBeVisible();

  // A period off: the dates are read as dd/mm/aaaa and checked, the end may stay empty for one day.
  const periods = card.getByRole("list", { name: "Dias sem expediente" });
  await expect(periods).toHaveText("Nenhum dia marcado.");
  await card.getByRole("button", { name: "Adicionar dia ou período" }).click();
  const add = page.getByRole("dialog", { name: "Dia sem expediente" });
  const from = add.getByLabel("De", { exact: true });
  const to = add.getByLabel("Até (vazio para um dia só)");
  const confirm = add.getByRole("button", { name: "Adicionar", exact: true });
  await expect(from).toBeFocused();
  await from.fill("30/02/2026");
  await confirm.click();
  await expect(add.getByText("Escreva a data como dd/mm/aaaa.")).toBeVisible();
  await from.fill("10/11/2026");
  await page.keyboard.press("Enter");
  await expect(add.getByText("Esse dia já passou.")).toBeVisible();
  await from.fill("10/01/2028");
  await confirm.click();
  await expect(add.getByText("A data passa de um ano a partir de hoje. Confira o ano.")).toBeVisible();
  await from.fill("24/12/2026");
  await to.fill("23/12/2026");
  await confirm.click();
  await expect(add.getByText("A data final vem antes da primeira. Confira as duas.")).toBeVisible();
  // 24/12 to 23/03 is 90 days; one more is refused.
  await to.fill("24/03/2027");
  await confirm.click();
  await expect(add.getByText("Um período vai até 90 dias. Para mais, marque em partes.")).toBeVisible();
  await to.fill("03/01/2027");
  await add.getByLabel("Motivo (opcional)").fill("Recesso");
  await expectAccessible(page, "configuracoes-agenda-dia-sem-expediente");
  await confirm.click();
  await expect(add).toHaveCount(0);
  await expect(periods.getByRole("listitem")).toHaveText(["24/12/2026 a 03/01/2027 · Recesso · 11 dias"]);
  await card.getByRole("button", { name: "Adicionar dia ou período" }).click();
  await from.fill("02/01/2027");
  await confirm.click();
  await expect(add.getByText("Esse período encosta em 24/12/2026 a 03/01/2027, que já está na lista.")).toBeVisible();
  await add.getByRole("button", { name: "Cancelar" }).click();
  // A day with appointments already booked says how many need a new time.
  await card.getByRole("button", { name: "Adicionar dia ou período" }).click();
  await from.fill("19/11/2026");
  await confirm.click();
  await expect(page.getByRole("status").filter({ hasText: "19/11/2026: 1 dia sem expediente. 2 consultas marcadas nesse período precisam de outro horário." })).toBeVisible();
  await card.getByRole("button", { name: "Tirar 19/11/2026" }).click();
  await expect(periods.getByRole("listitem")).toHaveText(["24/12/2026 a 03/01/2027 · Recesso · 11 dias"]);
  await expectAccessible(page, "configuracoes-agenda-travas");
  expect(await tooSmallControls(page), "every control of the screen is a 44 px target").toEqual([]);

  // Office until 14:00: Renato's return at 14:00 on Thursday is left outside, listed and kept.
  await card.getByLabel("Termina às").selectOption("14");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Agenda salva" })).toBeVisible();
  const stored = (await (await page.request.get("/api/settings", { headers: CSRF })).json()) as { agenda: object };
  expect(stored.agenda).toEqual({ ...DEFAULTS, to: 14, lunch: { from: 720, to: 810 }, closed: [{ from: "2026-12-24", to: "2027-01-03", reason: "Recesso" }] });
  const outside = page.getByRole("status").filter({ hasText: "1 consulta já marcada ficou fora do horário de atendimento." });
  await expect(outside).toContainText("Renato Sampaio Cruz, qui, 19/11 14:00 Fora do horário.");
  await expect(outside.getByRole("link", { name: "Abrir a Agenda" })).toBeVisible();

  // A period is taken out by its X.
  await card.getByRole("button", { name: "Tirar 24/12/2026 a 03/01/2027" }).click();
  await expect(periods).toHaveText("Nenhum dia marcado.");
  await expect(save).toBeEnabled();
  await outside.getByRole("link", { name: "Abrir a Agenda" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
});

test("every day of a period off closes like a holiday, and an old setting that opened a holiday opens nothing", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  // A setting saved before 13/11/2026 with the holiday worked: the field is read and dropped.
  expect((await page.request.patch("/api/settings", { headers: CSRF, data: { agenda: { ...DEFAULTS, openHolidays: ["2026-11-20"], closed: [{ from: "2026-11-19", to: "2026-11-27", reason: "Congresso" }] } } })).status()).toBe(200);
  const stored = (await (await page.request.get("/api/settings", { headers: CSRF })).json()) as { agenda: Record<string, unknown> };
  expect(stored.agenda).not.toHaveProperty("openHolidays");
  await page.reload();
  await clickHour(page, "20", 1.5);
  await expect(page.getByRole("dialog", { name: "Consulta não entra neste horário" }).getByRole("alert")).toContainText("é feriado (Consciência Negra)");
  await page.keyboard.press("Escape");
  // Thursday is off: its name says why, the click says it too, and Isadora stays where she was, marked.
  await expect(column(page, "19").getByText("Congresso")).toBeVisible();
  await clickHour(page, "19", 4.5);
  await expect(page.getByRole("dialog", { name: "Consulta não entra neste horário" }).getByRole("alert")).toContainText("está como dia sem expediente (Congresso)");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("main").getByRole("button", { name: /^Fora do horário de atendimento: Isadora Pires Falcão/ })).toBeVisible();
  await expectAccessible(page, "agenda-travas-dia-sem-expediente");
});

test("an event of a day that closed at midnight is frozen: no status, edit or delete, and a drag is refused; a change at Google is marked", async ({ page }) => {
  const sent = await routeAgenda(page, [
    ...WEEK,
    { title: "Helena Duarte Prado", day: "17", from: "09:00", to: "10:00", colorId: "10", description: "Consulta | Consultório" },
    { title: "Marina Teles Barreto", day: "16", from: "14:00", to: "15:00", description: "Retorno | Consultório", changedAtGoogle: "changed" },
  ]);
  await openAgenda(page);
  await event(page, "Helena Duarte Prado").click();
  const details = page.getByRole("dialog", { name: "Helena Duarte Prado" });
  await expect(details.getByRole("note")).toContainText("Congelado. Situação final: Confirmado.");
  await expect(details.getByRole("button", { name: "Editar" })).toHaveCount(0);
  await expect(details.getByRole("button", { name: "Apagar" })).toHaveCount(0);
  await expect(details.getByRole("group", { name: "Situação" })).toHaveCount(0);
  await expectAccessible(page, "agenda-evento-congelado");
  await page.keyboard.press("Escape");

  const from = await center(page, "Helena Duarte Prado");
  await dragBy(page, from, { x: from.x, y: from.y + HOUR_PX });
  await page.mouse.up();
  await expect(notice(page, "Esse dia já fechou à meia-noite. Os eventos dele ficam como estavam.")).toBeVisible();
  // Alt + arrows say the same.
  await event(page, "Helena Duarte Prado").focus();
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.up("Alt");
  expect(sent.patches).toEqual([]);

  // Changed at Google after the day closed: the copy, marked.
  const marina = page.getByRole("main").getByRole("button", { name: /^Mudou no Google depois do fechamento: Marina Teles Barreto/ });
  await expect(marina).toBeVisible();
  await marina.click();
  await expect(page.getByRole("dialog", { name: "Marina Teles Barreto" }).getByText("Mudou no Google depois do fechamento. A Zuri mostra o registro como estava à meia-noite.")).toBeVisible();
});

test.describe("in the dark theme", () => {
  test.use({ colorScheme: "dark" });

  test("the closed hour, the refused block and the settings have no serious violation", async ({ page }) => {
    await routeAgenda(page, WEEK);
    await openAgenda(page);
    await expect(page.locator("html")).toHaveClass(/dark/);
    await clickHour(page, "19", 4.25);
    await expect(page.getByRole("dialog", { name: "Consulta não entra neste horário" })).toBeVisible();
    await expectAccessible(page, "agenda-travas-horario-fechado-escuro");
    await page.keyboard.press("Escape");
    await page.goto("/configuracoes/agenda");
    await expect(page.getByRole("list", { name: "Feriados nacionais" })).toBeVisible();
    await expectAccessible(page, "configuracoes-agenda-travas-escuro");
  });
});

test("in English the closed hour and the refusal speak English", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...((await response.json()) as object), language: "en" } });
  });
  await page.clock.setFixedTime(NOW);
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await clickHour(page, "19", 4.25);
  const closed = page.getByRole("dialog", { name: "No appointments at this time" });
  await expect(closed.getByRole("button", { name: "Use next free time" })).toBeVisible();
  await page.keyboard.press("Escape");
  const from = await center(page, "Isadora Pires Falcão");
  await dragBy(page, from, { x: from.x, y: from.y + 3 * HOUR_PX });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "No appointments at this time" }).getByRole("alert")).toContainText("The appointment stayed where it was.");
  expect(sent.patches).toEqual([]);
});
