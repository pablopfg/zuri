import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// The appointment's own fields (E5e, docs/planos/agenda-campos-do-agendamento.md, protótipo v52): the
// patient's country code, phone and e-mail, a date dd/mm/aaaa and hours of 24 h whatever the language,
// the end that follows the start, the type and the place (Online asks Google for a Meet call) and the
// payment. Google is answered here; the settings go through the real server.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/** Wednesday, 18/11/2026, 10:20 in São Paulo; Friday 20 is a holiday. */
const NOW = new Date("2026-11-18T10:20:00-03:00");
const iso = (local: string) => new Date(`${local}:00-03:00`).toISOString();
const HOUR_PX = 56;
const DEFAULTS = { from: 8, to: 18, view: "week", weekStart: 1, workDays: [1, 2, 3, 4, 5], daysOff: true, outside: true, lunch: { from: 720, to: 840 }, closed: [] };
const MEET = "https://meet.google.com/abc-defg-hij";

type Sample = { title: string; day: string; from: string; to: string; description?: string; extra?: Record<string, string> };

// Invented names and numbers.
const WEEK: Sample[] = [
  {
    title: "Helena Duarte Prado",
    day: "19",
    from: "09:00",
    to: "10:00",
    description: "Consulta | Online\nTrazer o recordatório",
    extra: { country: "BR", phone: "41999990000", email: "helena@exemplo.com.br", payment: "paid", meet: MEET },
  },
  { title: "Renato Sampaio Cruz", day: "19", from: "14:00", to: "15:00", description: "Retorno | Consultório", extra: { country: "PT", phone: "912345678" } },
  // A meeting made at Google with its own call and no type.
  { title: "Reunião da equipe", day: "18", from: "15:00", to: "16:00", extra: { meet: "https://meet.google.com/xyz-abcd-efg" } },
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
  colorId: "",
  ...sample.extra,
});

type Body = Record<string, unknown>;

/** What Google answers to a call asked for: a link, still being made, or failed. */
async function routeAgenda(page: Page, samples: Sample[], call: string = "https://meet.google.com/new-call-abc") {
  const events: Body[] = samples.map(wire);
  const sent = { patches: [] as Body[], posts: [] as Body[] };
  const calendars = [{ id: "main", name: "Consultório", accessRole: "owner", primary: true, mode: "write", writable: true, color: "#4f7cff" }];
  await page.route("**/api/google", (route) =>
    route.fulfill({ json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: "connected", problem: null, connectedAt: iso("2026-11-10T10:00"), calendars } }),
  );
  await page.route("**/api/google/events?*", (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    return route.fulfill({ json: { more: false, calendars, events: events.filter((each) => String(each.start).slice(0, 10) >= from && String(each.start).slice(0, 10) <= to) } });
  });
  await page.route("**/api/google/events", async (route) => {
    const method = route.request().method();
    const body = route.request().postDataJSON() as Body;
    if (method === "POST") {
      sent.posts.push(body);
      const made = { ...wire({ title: String(body.title), day: "19", from: "13:00", to: "14:00" }, events.length), start: iso(String(body.start)), end: iso(String(body.end)) };
      return route.fulfill({ status: 201, json: { event: body.meet ? { ...made, meet: call } : made } });
    }
    if (method !== "PATCH") return route.fallback();
    sent.patches.push(body);
    const index = events.findIndex((event) => event.id === body.eventId);
    // Each change makes a new version, as Google does.
    const version = Number(/^"v(\d+)-/.exec(String(events[index]?.etag))?.[1] ?? 1) + 1;
    const saved: Body = { ...events[index], etag: `"v${version}-${index}"` };
    for (const key of ["payment", "email", "phone", "country"]) if (typeof body[key] === "string") saved[key] = body[key];
    if (body.meet === false) delete saved.meet;
    if (body.meet === true) saved.meet = call;
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

async function clickHour(page: Page, day: string, hours: number) {
  const box = await column(page, day).locator("[data-hours]").boundingBox();
  if (!box) throw new Error("the column is not on screen");
  await page.mouse.click(box.x + box.width / 2, box.y + hours * HOUR_PX + 3);
}

test.afterEach(async ({ page }) => {
  await page.request.patch("/api/settings", { headers: CSRF, data: { agenda: DEFAULTS } });
});

test("an online appointment with the patient's phone and e-mail goes to Google with a Meet call, and the details show it all", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  // The order of the prototype: the patient, then the day and the hours, then the type and the note.
  await expect(form.getByLabel("Nome completo do paciente")).toBeFocused();
  const order = await form.locator("input:not([type=hidden]), select, textarea").evaluateAll((fields) => fields.map((field) => (field as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? ""));
  expect(order.filter(Boolean)).toEqual([
    "Nome completo do paciente",
    "DDI do paciente",
    "Celular com DDD",
    "E-mail de contato",
    "Data da consulta",
    "Hora do início",
    "Hora do término",
    "Tipo do evento",
    "Local",
    "Situação",
    "Financeiro",
    "Observação (opcional)",
  ]);
  await expect(form.getByLabel("DDI do paciente")).toHaveValue("BR");
  await expect(form.getByLabel("DDI do paciente").getByRole("option").first()).toHaveText("BR Brasil (+55)");
  await expect(form.getByLabel("Data da consulta")).toHaveAttribute("placeholder", "dd/mm/aaaa");
  await expect(form.getByLabel("Data da consulta")).toHaveValue("19/11/2026");
  await expect(form.getByLabel("Hora do início")).toHaveValue("10:00");
  await expect(form.getByLabel("Hora do término")).toHaveValue("11:00");
  await expect(form.getByLabel("Financeiro")).toHaveValue("unpaid");
  await expect(form.getByLabel("Financeiro").getByRole("option")).toHaveText(["Não pago", "Pago", "Gratuito"]);
  await expect(form.getByText("Ao salvar, o Google Meet cria o link da chamada.")).toHaveCount(0);

  await form.getByLabel("Nome completo do paciente").fill("Bruno Macedo Teixeira");
  // The phone takes its shape as it is typed, and a +55 pasted in front goes.
  await form.getByLabel("Celular com DDD").fill("+55 41 98888-7777");
  await expect(form.getByLabel("Celular com DDD")).toHaveValue("(41) 98888-7777");
  await form.getByLabel("E-mail de contato").fill("  bruno@exemplo.com.br ");
  await form.getByLabel("Local", { exact: true }).selectOption("Online");
  await expect(form.getByText("Ao salvar, o Google Meet cria o link da chamada.")).toBeVisible();
  await form.getByLabel("Financeiro").selectOption("paid");
  await expect(form.getByText("No Google Agenda, a observação começa por “Consulta | Online”.")).toBeVisible();
  await expectAccessible(page, "agenda-campos-formulario");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "“Bruno Macedo Teixeira” agendado para qui, 19/11 às 10:00. O Google Meet criou o link da chamada." }).first()).toBeVisible();
  expect(sent.posts).toEqual([
    {
      calendarId: "main",
      title: "Bruno Macedo Teixeira",
      allDay: false,
      start: "2026-11-19T10:00",
      end: "2026-11-19T11:00",
      location: "",
      description: "Consulta | Online",
      country: "BR",
      phone: "41988887777",
      email: "bruno@exemplo.com.br",
      payment: "paid",
      meet: true,
    },
  ]);

  // An online appointment with its call: the link, "Copiar link", the patient and the payment.
  await event(page, "Helena Duarte Prado").click();
  const details = page.getByRole("dialog", { name: "Helena Duarte Prado" });
  await expect(details.getByRole("link", { name: "meet.google.com/abc-defg-hij" })).toHaveAttribute("href", MEET);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await details.getByRole("button", { name: "Copiar link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copiado" }).first()).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(MEET);
  await expect(details.getByText("Sem vínculo com Contatos")).toBeVisible();
  await expect(details.getByText("+55 (41) 99999-0000")).toBeVisible();
  await expect(details.getByText("helena@exemplo.com.br")).toBeVisible();
  await expect(details.getByText("Pago", { exact: true })).toBeVisible();
  await expect(details.getByText(/^Consulta \| Online/)).toBeVisible();
  await expect(details.getByText("Trazer o recordatório")).toBeVisible();
  await expectAccessible(page, "agenda-campos-detalhes");
  await details.getByRole("button", { name: "Fechar" }).click();

  // A patient abroad: the country's code and blocks of three; no payment set reads "Não pago".
  await event(page, "Renato Sampaio Cruz").click();
  const renato = page.getByRole("dialog", { name: "Renato Sampaio Cruz" });
  await expect(renato.getByText("+351 912 345 678")).toBeVisible();
  await expect(renato.getByText("Não pago", { exact: true })).toBeVisible();
  await expect(renato.getByText("Presencial", { exact: true })).toBeVisible();
});

test("the end follows the start, an end typed gives the length, and Voltar para 1 h puts the hour back", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  const start = form.getByLabel("Hora do início");
  const end = form.getByLabel("Hora do término");
  await expect(form.getByText("Dura 1 h, o padrão.")).toBeVisible();
  // Digits only: the colon goes in by itself.
  await start.fill("1030");
  await expect(start).toHaveValue("10:30");
  await expect(end).toHaveValue("11:30");
  await end.fill("11:15");
  await expect(form.getByText("Dura 45 min.")).toBeVisible();
  // A new start keeps the length typed.
  await start.fill("15:00");
  await expect(end).toHaveValue("15:45");
  await form.getByRole("button", { name: "Voltar para 1 h" }).click();
  await expect(end).toHaveValue("16:00");
  await expect(form.getByText("Dura 1 h, o padrão.")).toBeVisible();
  // A date typed as digits takes its slashes.
  await form.getByLabel("Data da consulta").fill("23112026");
  await expect(form.getByLabel("Data da consulta")).toHaveValue("23/11/2026");
});

test("QA-E5e-03: the notice and the details say what Google answered about the call: being made, or failed, and a failed one is asked again", async ({ page }) => {
  const sent = await routeAgenda(page, [...WEEK, { title: "Paula Régis Amaral", day: "19", from: "16:00", to: "17:00", description: "Consulta | Online", extra: { meet: "failed" } }], "pending");
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByLabel("Nome completo do paciente").fill("Bruno Macedo Teixeira");
  await form.getByLabel("Local", { exact: true }).selectOption("Online");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByRole("status").filter({ hasText: "“Bruno Macedo Teixeira” agendado para qui, 19/11 às 10:00. O Google está criando o link da chamada…" }).first()).toBeVisible();

  await event(page, "Paula Régis Amaral").click();
  const details = page.getByRole("dialog", { name: "Paula Régis Amaral" });
  await expect(details.getByText("O Google não criou o link da chamada. Confira se o Meet está ligado na sua conta do Google.")).toBeVisible();
  // Saving it again asks Google for the call once more, with nothing else changed.
  await details.getByRole("button", { name: "Editar" }).click();
  await page.getByRole("dialog", { name: "Editar evento" }).getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => sent.patches.length).toBe(1);
  expect(sent.patches[0]).toEqual({ calendarId: "main", eventId: "e3", etag: '"v1-3"', meet: true });
  await event(page, "Paula Régis Amaral").click();
  await expect(page.getByRole("dialog", { name: "Paula Régis Amaral" }).getByText("O Google está criando o link da chamada…")).toBeVisible();
});

test("QA-E5e-01: the end stays on the start's day", async ({ page }) => {
  const sent = await routeAgenda(page, [{ title: "Plantão", day: "19", from: "17:00", to: "18:00" }]);
  await openAgenda(page);
  await event(page, "Plantão").click();
  await page.getByRole("dialog", { name: "Plantão" }).getByRole("button", { name: "Editar" }).click();
  const form = page.getByRole("dialog", { name: "Editar evento" });
  // 23:30 with its hour runs past midnight: refused under the end, with the focus there.
  await form.getByLabel("Hora do início").fill("23:30");
  await expect(form.getByLabel("Hora do término")).toHaveValue("00:30");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(form.getByLabel("Hora do término")).toBeFocused();
  await expect(form.getByText("O término precisa ser depois do início, no mesmo dia.")).toBeVisible();
  await form.getByLabel("Hora do término").fill("23:59");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => sent.patches.length).toBe(1);
  expect(sent.patches[0]).toMatchObject({ start: "2026-11-19T23:30", end: "2026-11-19T23:59" });
});

test("each field to fix gets the focus and its message, in the order of the form", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  const save = form.getByRole("button", { name: "Criar evento" });
  await save.click();
  await expect(form.getByLabel("Nome completo do paciente")).toBeFocused();
  await expect(form.getByText("Escreva o nome completo do paciente.")).toBeVisible();
  await form.getByLabel("Nome completo do paciente").fill("Bruno Macedo Teixeira");

  await form.getByLabel("Celular com DDD").fill("419");
  await save.click();
  await expect(form.getByLabel("Celular com DDD")).toBeFocused();
  await expect(form.getByLabel("Celular com DDD")).toHaveClass(/\bshake\b/);
  await expect(form.getByText("Confira o celular: DDD e número, por exemplo (41) 99999-0000.")).toBeVisible();
  await form.getByLabel("Celular com DDD").fill("");

  await form.getByLabel("E-mail de contato").fill("bruno@");
  await save.click();
  await expect(form.getByLabel("E-mail de contato")).toBeFocused();
  await expect(form.getByText("Confira o e-mail, por exemplo nome@exemplo.com.br.")).toBeVisible();
  await form.getByLabel("E-mail de contato").fill("");

  // 31/02 is not a day.
  await form.getByLabel("Data da consulta").fill("31/02/2027");
  await save.click();
  await expect(form.getByLabel("Data da consulta")).toBeFocused();
  await expect(form.getByText("Escreva a data como dd/mm/aaaa, por exemplo 12/11/2026.")).toBeVisible();
  await form.getByLabel("Data da consulta").fill("19/11/2026");

  // 24:00 is not an hour.
  await form.getByLabel("Hora do início").fill("24:00");
  await save.click();
  await expect(form.getByLabel("Hora do início")).toBeFocused();
  await expect(form.getByText("Escreva a hora do início de 00:00 a 23:59, por exemplo 14:30.")).toBeVisible();
  await form.getByLabel("Hora do início").fill("10:00");

  await form.getByLabel("Hora do término").fill("9");
  await save.click();
  await expect(form.getByLabel("Hora do término")).toBeFocused();
  await expect(form.getByText("Escreva a hora do término de 00:00 a 23:59.")).toBeVisible();
  await form.getByLabel("Hora do término").fill("11:00");

  // "Outro, digitar" asks for the kind, and a "|" typed in it goes.
  await form.getByLabel("Tipo do evento").selectOption("Outro, digitar");
  await save.click();
  await expect(form.getByLabel("Escreva o tipo")).toBeFocused();
  await expect(form.getByText("Escreva o tipo do evento, por exemplo Bioimpedância.")).toBeVisible();
  await form.getByLabel("Escreva o tipo").fill("Bio | impedância");
  expect(sent.posts).toEqual([]);
  await save.click();
  await expect(form).toHaveCount(0);
  expect(sent.posts[0]).toMatchObject({ description: "Bio impedância | Consultório", phone: "", email: "" });
});

test("Sem tipo is a plain event: no patient, no place, no payment, and a Título", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  await clickHour(page, "19", 2);
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByLabel("Tipo do evento").selectOption("");
  await expect(form.getByLabel("Título", { exact: true })).toBeVisible();
  await expect(form.getByLabel("Data", { exact: true })).toBeVisible();
  for (const label of ["DDI do paciente", "Celular com DDD", "E-mail de contato", "Financeiro"]) await expect(form.getByLabel(label)).toHaveCount(0);
  await expect(form.getByLabel("Local", { exact: true })).toHaveCount(0);
  await form.getByLabel("Título", { exact: true }).fill("Dentista");
  await form.getByRole("button", { name: "Criar evento" }).click();
  await expect(form).toHaveCount(0);
  expect(sent.posts).toEqual([{ calendarId: "main", title: "Dentista", allDay: false, start: "2026-11-19T10:00", end: "2026-11-19T11:00", location: "", description: "" }]);
});

test("Editar sends only the patient's field that changed, and back at the office takes the call off with no Desfazer", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  await event(page, "Helena Duarte Prado").click();
  await page.getByRole("dialog", { name: "Helena Duarte Prado" }).getByRole("button", { name: "Editar" }).click();
  const form = page.getByRole("dialog", { name: "Editar evento" });
  await expect(form.getByLabel("Celular com DDD")).toHaveValue("(41) 99999-0000");
  await expect(form.getByLabel("E-mail de contato")).toHaveValue("helena@exemplo.com.br");
  await expect(form.getByLabel("Local", { exact: true })).toHaveValue("Online");
  await expect(form.getByLabel("Financeiro")).toHaveValue("paid");
  // The call exists: the hint of a new one is not there.
  await expect(form.getByText("Ao salvar, o Google Meet cria o link da chamada.")).toHaveCount(0);
  await form.getByLabel("Financeiro").selectOption("free");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "“Helena Duarte Prado” atualizado." }).first()).toBeVisible();
  expect(sent.patches).toEqual([{ calendarId: "main", eventId: "e0", etag: '"v1-0"', payment: "free" }]);
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mudança desfeita" }).first()).toBeVisible();
  expect(sent.patches[1]).toEqual({ calendarId: "main", eventId: "e0", etag: '"v2-0"', payment: "paid" });

  // A country changed goes with the phone: the two are read together.
  await event(page, "Helena Duarte Prado").click();
  await page.getByRole("dialog", { name: "Helena Duarte Prado" }).getByRole("button", { name: "Editar" }).click();
  await form.getByLabel("Local", { exact: true }).selectOption("Consultório");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "“Helena Duarte Prado” atualizado." }).first()).toBeVisible();
  expect(sent.patches[2]).toEqual({ calendarId: "main", eventId: "e0", etag: '"v3-0"', description: "Consulta | Consultório\nTrazer o recordatório", meet: false });
  // A call taken off cannot come back with the same link: no Desfazer.
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
});

test("SEC-E5e-02/03: a change of anything but the place keeps Google's call, and Sem tipo takes the patient's fields off", async ({ page }) => {
  const sent = await routeAgenda(page, WEEK);
  await openAgenda(page);
  // A meeting with a call made at Google: a new title leaves the call (and its guests' link) as it is.
  await event(page, "Reunião da equipe").click();
  await page.getByRole("dialog", { name: "Reunião da equipe" }).getByRole("button", { name: "Editar" }).click();
  const form = page.getByRole("dialog", { name: "Editar evento" });
  await form.getByLabel("Título", { exact: true }).fill("Reunião da equipe toda");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(() => sent.patches.length).toBe(1);
  expect(sent.patches[0]).toEqual({ calendarId: "main", eventId: "e2", etag: '"v1-2"', title: "Reunião da equipe toda" });

  // An appointment turned into a plain event: the phone, its country and the payment go at Google too.
  await event(page, "Renato Sampaio Cruz").click();
  await page.getByRole("dialog", { name: "Renato Sampaio Cruz" }).getByRole("button", { name: "Editar" }).click();
  await form.getByLabel("Tipo do evento").selectOption("");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => sent.patches.length).toBe(2);
  expect(sent.patches[1]).toEqual({ calendarId: "main", eventId: "e1", etag: '"v1-1"', description: "", country: "", phone: "", email: "", payment: "" });
});

test("in English the date stays dd/mm/yyyy and the hours have 24 h, never AM or PM", async ({ page }) => {
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
  await expect(form.getByLabel("Appointment date")).toHaveValue("19/11/2026");
  await expect(form.getByLabel("Appointment date")).toHaveAttribute("placeholder", "dd/mm/yyyy");
  await expect(form.getByLabel("Start time")).toHaveValue("10:00");
  await form.getByLabel("Start time").fill("2 pm");
  await expect(form.getByLabel("Start time")).toHaveValue("2");
  await form.getByLabel("Start time").fill("16:30");
  await expect(form.getByLabel("End time")).toHaveValue("17:30");
  await expect(form.getByLabel("Patient's country code").getByRole("option").first()).toHaveText("BR Brazil (+55)");
  await expect(form.getByLabel("Payment").getByRole("option")).toHaveText(["Not paid", "Paid", "Free"]);
  await expect(form.getByLabel("Event type").getByRole("option").last()).toHaveText("No type (regular event)");
});

test("on a phone the fields stack with 44 px targets and a numeric keyboard @mobile", async ({ page }) => {
  await routeAgenda(page, WEEK);
  await openAgenda(page);
  await page.getByRole("button", { name: "Novo evento" }).click();
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await expect(form.getByLabel("Data da consulta")).toHaveAttribute("inputmode", "numeric");
  await expect(form.getByLabel("Hora do início")).toHaveAttribute("inputmode", "numeric");
  await expect(form.getByLabel("Celular com DDD")).toHaveAttribute("inputmode", "tel");
  await expect(form.getByLabel("E-mail de contato")).toHaveAttribute("type", "email");
  expect(await tooSmallControls(page), "every control of the form is a 44 px target").toEqual([]);
  await expectAccessible(page, "agenda-campos-formulario-celular");
});
