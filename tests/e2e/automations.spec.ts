import type { Locator } from "@playwright/test";
import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, openPlace, rowAction, signIn, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// Rotinas against the real Worker (step 10; one screen and "Criar rotina" in five
// steps since the Sinal, S14): create with the preview, run now, pause, edit,
// duplicate and delete; a routine Zuri proposes in the chat waits for the
// owner's approval; the palette and, on a phone, the Settings list reach the page. pt-BR.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/** A word of its own per run: the database keeps what earlier runs and the other project saved. */
const tag = () => uniqueTag(test.info().project.name);

async function openAutomations(page: Page) {
  await page.goto("/rotinas");
  await signIn(page);
  await expect(page).toHaveURL(/\/rotinas$/);
  await expect(page.getByRole("heading", { level: 1, name: "Rotinas" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
}

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

/** "Criar rotina", open on its first step. */
async function openWizard(page: Page) {
  await page.getByRole("button", { name: "Criar rotina" }).click();
  const form = page.getByRole("dialog", { name: "Criar rotina" });
  await expect(form.getByText("Passo 1 de 5 · Tipo")).toBeVisible();
  return form;
}

const next = (form: Locator) => form.getByRole("button", { name: "Continuar" });

test("a reminder: create in five steps, run now, pause, edit, duplicate and delete @mobile", async ({ page }) => {
  const name = `Remédio ${tag()}`;
  await openAutomations(page);
  const form = await openWizard(page);
  // Step 1: the kinds are radios, the reminder chosen; the focus starts on it.
  await expect(form.getByRole("radio", { name: "Lembrete" })).toBeChecked();
  await expect(form.getByRole("radio", { name: "Lembrete" })).toBeFocused();
  await expect(form.getByRole("radio")).toHaveCount(4);
  await expect(form.getByRole("button", { name: "Voltar" })).toHaveCount(0);
  await expectAccessible(page, "criar rotina: tipo");
  expect(await tooSmallControls(page), "every control of the first step is a 44 px target").toEqual([]);
  await next(form).click();

  // Step 2: "Todo dia" at 09:00 is the default; the next three runs show before saving.
  await expect(form.getByText("Passo 2 de 5 · Quando")).toBeVisible();
  await expect(form.getByRole("radio", { name: "Todo dia" })).toBeChecked();
  await form.getByLabel("Horário").fill("08:15");
  await expect(form.getByText("Próximas execuções")).toBeVisible();
  await expect(form.getByRole("listitem")).toHaveCount(3);
  await expect(form.getByText(/^Sao Paulo \(/)).toBeVisible();
  // A week with no day chosen can't go on.
  await form.getByRole("radio", { name: "Toda semana" }).check();
  for (const day of ["Seg", "Ter", "Qua", "Qui", "Sex"]) await form.getByRole("button", { name: day, exact: true }).click();
  await expect(next(form)).toBeDisabled();
  await form.getByRole("button", { name: "Seg", exact: true }).click();
  await expect(form.getByRole("button", { name: "Seg", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expectAccessible(page, "criar rotina: quando");
  expect(await tooSmallControls(page), "every control of the second step is a 44 px target").toEqual([]);
  await next(form).click();

  // Step 3: a reminder needs its text; Enter in the field would only break the line, so the button goes on.
  await expect(form.getByText("Passo 3 de 5 · O que")).toBeVisible();
  await expect(form.getByLabel("Texto do lembrete")).toBeFocused();
  await expect(next(form)).toBeDisabled();
  await expect(form.getByText("Começar de um modelo")).toHaveCount(0);
  await form.getByLabel("Texto do lembrete").fill("Tomar o remédio da pressão");
  await next(form).click();

  // Step 4: normal by default; high says the Zuri calls again.
  await expect(form.getByText("Passo 4 de 5 · Avisos")).toBeVisible();
  await expect(form.getByRole("radio", { name: "Normal" })).toBeChecked();
  await form.getByRole("radio", { name: "Alta" }).check();
  await expect(form.getByText(/chama de novo até duas vezes/)).toBeVisible();
  await expectAccessible(page, "criar rotina: avisos");
  await next(form).click();

  // Step 5: the name starts from the reminder's text; the summary says what was chosen.
  await expect(form.getByText("Passo 5 de 5 · Revisar")).toBeVisible();
  await expect(form.getByLabel("Nome")).toHaveValue("Tomar o remédio da pressão");
  await expect(form.getByLabel("Nome")).toBeFocused();
  const summary = form.getByRole("definition");
  await expect(summary).toHaveText([/^Lembrete$/, /^Segunda, às 08:15\. Próxima: /, "Tomar o remédio da pressão", "Alta", "Nenhum: não usa IA"]);
  await expect(form.getByText(/Começa ativa\..*Ativas agora: \d+ de 50\./)).toBeVisible();
  // Going back keeps what was typed, and a name nobody typed follows the text.
  await form.getByRole("button", { name: "Voltar" }).click();
  await expect(form.getByRole("radio", { name: "Alta" })).toBeChecked();
  await form.getByRole("button", { name: "Voltar" }).click();
  await form.getByLabel("Texto do lembrete").fill("Tomar o remédio da pressão\ncom água");
  await next(form).click();
  await next(form).click();
  await expect(form.getByLabel("Nome")).toHaveValue("Tomar o remédio da pressão");
  await expect(summary.nth(2)).toHaveText("Tomar o remédio da pressão\ncom água");
  const create = form.getByRole("button", { name: "Criar rotina" });
  await form.getByLabel("Nome").fill("");
  await expect(create).toBeDisabled();
  await form.getByLabel("Nome").fill(name);
  await expectAccessible(page, "criar rotina: revisar");
  expect(await tooSmallControls(page), "every control of the last step is a 44 px target").toEqual([]);
  await create.click();
  await expect(toast(page, "Rotina criada")).toBeVisible();
  await expect(form).toHaveCount(0);

  const list = page.getByRole("list", { name: "Suas rotinas" });
  const row = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(row.getByText("Lembrete · Segunda, às 08:15")).toBeVisible();
  await expect(row.getByText("Ativa", { exact: true })).toBeVisible();
  await expect(row.getByText(/^Próxima: /)).toBeVisible();
  // A reminder uses no AI, and the row says so only for the ones that do.
  await expect(row.getByText("Usa IA")).toHaveCount(0);
  await expect(page.getByText(/\d+ de 50 ativas\./)).toBeVisible();
  expect(await tooSmallControls(page), "every control of the routines page is a 44 px target").toEqual([]);

  // Run now: the result lands in the history.
  await row.getByRole("button", { name: "Rodar agora" }).click();
  await expect(toast(page, "Pronto. O resultado está em Últimas execuções.")).toBeVisible();
  const history = page.getByRole("region", { name: "Últimas execuções" });
  const run = history.getByRole("listitem").filter({ hasText: name }).first();
  await expect(run.getByText("Tomar o remédio da pressão")).toBeVisible();
  await expect(run.getByText("Entregue")).toBeVisible();
  await expect(run.getByText(/Executada agora/)).toBeVisible();

  // Pause, then resume: one switch, named after the routine.
  const active = row.getByRole("switch", { name: `“${name}” ativa` });
  await expect(active).toBeChecked();
  // A click, not uncheck(): the switch follows the list, which turns a moment after the tap.
  await active.click();
  await expect(active).not.toBeChecked();
  await expect(toast(page, "Rotina pausada.")).toBeVisible();
  await expect(row.getByText("Pausada", { exact: true })).toBeVisible();
  await expect(row.getByText(/^Próxima: /)).toHaveCount(0);
  // Paused, it still runs by hand: the way to try a routine before turning it back on.
  await row.getByRole("button", { name: "Rodar agora" }).click();
  await expect(toast(page, "Pronto. O resultado está em Últimas execuções.").last()).toBeVisible();
  await expect(history.getByRole("listitem").filter({ hasText: name })).toHaveCount(2);
  await expect(row.getByText("Pausada", { exact: true })).toBeVisible();
  await active.click();
  await expect(active).toBeChecked();
  await expect(toast(page, "Rotina retomada.")).toBeVisible();
  await expect(row.getByText("Ativa", { exact: true })).toBeVisible();
  await expect(row.getByText(/^Próxima: /)).toBeVisible();

  // Edit: four steps, starting at "Quando", with what is stored.
  await rowAction(row, page, "Editar");
  const edit = page.getByRole("dialog", { name: "Editar rotina" });
  await expect(edit.getByText("Passo 1 de 4 · Quando")).toBeVisible();
  await expect(edit.getByRole("radio", { name: "Toda semana" })).toBeChecked();
  await edit.getByRole("radio", { name: "Todo mês" }).check();
  await edit.getByLabel("Dia do mês").fill("31");
  await expect(edit.getByText("Nos meses mais curtos, roda no último dia.")).toBeVisible();
  await next(edit).click();
  await expect(edit.getByLabel("Texto do lembrete")).toHaveValue("Tomar o remédio da pressão\ncom água");
  await next(edit).click();
  await expect(edit.getByRole("radio", { name: "Alta" })).toBeChecked();
  await next(edit).click();
  await expect(edit.getByLabel("Nome")).toHaveValue(name);
  await expect(edit.getByText(/Começa ativa/)).toHaveCount(0);
  await edit.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, "Alterações salvas")).toBeVisible();
  await expect(row.getByText("Lembrete · Todo dia 31 às 08:15 (ou no último dia do mês)")).toBeVisible();

  // Duplicate: the copy keeps everything and starts paused.
  await rowAction(row, page, "Duplicar");
  await expect(toast(page, "Rotina duplicada. A cópia começa pausada.")).toBeVisible();
  const copy = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: `${name} (cópia)`, exact: true }) });
  await expect(copy.getByText("Lembrete · Todo dia 31 às 08:15 (ou no último dia do mês)")).toBeVisible();
  await expect(copy.getByText("Pausada", { exact: true })).toBeVisible();
  await expect(copy.getByRole("switch")).not.toBeChecked();
  await rowAction(copy, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar “${name} (cópia)”?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(copy).toHaveCount(0);

  // Delete, after a confirmation; the history stays.
  await rowAction(row, page, "Apagar");
  const confirm = page.getByRole("dialog", { name: `Apagar “${name}”?` });
  await expectAccessible(page, "apagar rotina");
  await confirm.getByRole("button", { name: "Apagar" }).click();
  await expect(toast(page, "Rotina apagada")).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(run).toBeVisible();
});

test("SEC-S14-01: a copy that can't be paused is undone, never left running beside the original", async ({ page }) => {
  const name = `Cópia ${tag()}`;
  await openAutomations(page);
  const created = await page.request.post("/api/automations", { headers: CSRF, data: { name, kind: "reminder", message: "Uma vez só", schedule: { type: "daily", time: "06:00" } } });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { automation: { id: string } }).automation.id;
  const mine = async () => ((await (await page.request.get("/api/automations", { headers: CSRF })).json()) as { automations: { id: string; name: string; status: string }[] }).automations.filter((a) => a.name.startsWith(name));
  try {
    await page.reload();
    const row = page.getByRole("list", { name: "Suas rotinas" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
    // The pause of the copy fails; the original's own id is left alone.
    await page.route("**/api/automations/*", (route) => (route.request().method() === "PATCH" ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "x" } }) : route.continue()));
    await rowAction(row, page, "Duplicar");
    await expect(toast(page, "Não deu para duplicar. Tente de novo.")).toBeVisible();
    await expect(page.getByRole("heading", { name: `${name} (cópia)`, exact: true })).toHaveCount(0);
    expect((await mine()).map((a) => [a.name, a.status])).toEqual([[name, "active"]]);

    // If the copy can't be undone either, the owner is told it is running.
    await page.route("**/api/automations/*", (route) => (route.request().method() === "DELETE" ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "x" } }) : route.fallback()));
    await rowAction(row, page, "Duplicar");
    await expect(toast(page, "A cópia foi criada, mas ficou ativa. Pause a cópia na lista.")).toBeVisible();
    const copy = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: `${name} (cópia)`, exact: true }) });
    await expect(copy.getByText("Ativa", { exact: true })).toBeVisible();
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    for (const made of await mine()) await page.request.delete(`/api/automations/${made.id}`, { headers: CSRF });
    await page.request.delete(`/api/automations/${id}`, { headers: CSRF });
  }
});

test("a switch the server refuses goes back to where it was, with the reason", async ({ page }) => {
  const name = `Chave ${tag()}`;
  await openAutomations(page);
  const created = await page.request.post("/api/automations", { headers: CSRF, data: { name, kind: "reminder", message: "Recusa", schedule: { type: "daily", time: "06:00" } } });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { automation: { id: string } }).automation.id;
  try {
    await page.reload();
    const row = page.getByRole("list", { name: "Suas rotinas" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
    const active = row.getByRole("switch", { name: `“${name}” ativa` });
    await expect(active).toBeChecked();
    await page.route("**/api/automations/*", (route) =>
      route.request().method() === "PATCH" ? route.fulfill({ status: 409, json: { code: "CONFLICT", message: "Você já tem 50 rotinas ativas. Pause ou apague uma antes de ligar outra." } }) : route.continue(),
    );
    await active.click();
    await expect(toast(page, "Você já tem 50 rotinas ativas.")).toBeVisible();
    await expect(active).toBeChecked();
    await expect(row.getByText("Ativa", { exact: true })).toBeVisible();
    await expect(row.getByText("Pausada", { exact: true })).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await page.request.delete(`/api/automations/${id}`, { headers: CSRF });
  }
});

test("“Criar rotina” from the palette over an open edit starts clean", async ({ page }) => {
  const name = `Aberta ${tag()}`;
  await openAutomations(page);
  const created = await page.request.post("/api/automations", { headers: CSRF, data: { name, kind: "reminder", message: "Texto da antiga", schedule: { type: "daily", time: "06:00" } } });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { automation: { id: string } }).automation.id;
  try {
    await page.reload();
    const row = page.getByRole("list", { name: "Suas rotinas" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await rowAction(row, page, "Editar");
    await expect(page.getByRole("dialog", { name: "Editar rotina" })).toBeVisible();
    // The palette's request arrives as this event when the page is already open.
    await page.evaluate(() => window.dispatchEvent(new Event("nova-automacao")));
    const form = page.getByRole("dialog", { name: "Criar rotina" });
    await expect(form.getByText("Passo 1 de 5 · Tipo")).toBeVisible();
    await next(form).click();
    await next(form).click();
    await expect(form.getByLabel("Texto do lembrete")).toHaveValue("");
    await form.getByRole("button", { name: "Fechar" }).click();
  } finally {
    await page.request.delete(`/api/automations/${id}`, { headers: CSRF });
  }
});

test.describe("on a device in another time zone", () => {
  test.use({ timezoneId: "Asia/Tokyo" });

  test("the hours are the owner's: the zone shown and the next runs follow the settings, not the device", async ({ page }) => {
    await openAutomations(page);
    const form = await openWizard(page);
    await next(form).click();
    await expect(form.getByText(/^Sao Paulo \(/)).toBeVisible();
    await form.getByLabel("Horário").fill("09:00");
    // 09:00 in São Paulo is 21:00 in Tokyo: the device's hour never shows.
    await expect(form.getByRole("listitem")).toHaveText([/ às 09:00$/, / às 09:00$/, / às 09:00$/]);
    await form.getByRole("button", { name: "Fechar" }).click();
  });
});

test("the steps answer the keyboard: arrows pick, Enter goes on, Esc closes and the focus goes back", async ({ page }) => {
  await openAutomations(page);
  const open = page.getByRole("button", { name: "Criar rotina" });
  const form = await openWizard(page);
  // Arrows walk the four kinds; the digest's note is optional, so its step lets Enter through.
  await page.keyboard.press("ArrowDown");
  await expect(form.getByRole("radio", { name: "Resumo das tarefas" })).toBeChecked();
  await page.keyboard.press("Enter");
  await expect(form.getByText("Passo 2 de 5 · Quando")).toBeVisible();
  await expect(form.getByRole("radio", { name: "Todo dia" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(form.getByText("O que entra no resumo?")).toBeVisible();
  await expect(form.getByText("As tarefas atrasadas e as de hoje, em ordem de prazo.")).toBeVisible();
  await next(form).click();
  await next(form).click();
  // The digest is named after its kind, and costs no AI.
  await expect(form.getByLabel("Nome")).toHaveValue("Resumo das tarefas");
  await expect(form.getByRole("definition").nth(2)).toHaveText("Tarefas atrasadas e de hoje");
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(open).toBeFocused();
  // Nothing was created by walking the steps.
  await expect(page.getByRole("heading", { name: "Resumo das tarefas", exact: true })).toHaveCount(0);
  // The X closes too, and a new visit starts clean.
  const again = await openWizard(page);
  await expect(again.getByRole("radio", { name: "Lembrete" })).toBeChecked();
  await again.getByRole("button", { name: "Fechar" }).click();
  await expect(again).toHaveCount(0);
});

test("“Fluxo” leaves for the flows' editor instead of going on", async ({ page }) => {
  await openAutomations(page);
  const form = await openWizard(page);
  await form.getByRole("radio", { name: "Fluxo" }).check();
  await expect(next(form)).toHaveCount(0);
  await form.getByRole("link", { name: "Abrir fluxos" }).click();
  await expect(page).toHaveURL(/\/crm\/fluxos$/);
  const flow = page.getByRole("dialog", { name: "Novo fluxo" });
  await expect(flow).toBeVisible();
  await flow.getByRole("button", { name: "Cancelar" }).click();
});

test("the server's refusal shows at the last step: a one-time moment already past", async ({ page }) => {
  await openAutomations(page);
  const form = await openWizard(page);
  await next(form).click();
  await form.getByRole("radio", { name: "Uma vez" }).check();
  await form.getByLabel("Dia", { exact: true }).fill("2020-01-01");
  await form.getByLabel("Horário").fill("09:00");
  await expect(form.getByText("Esse horário já passou. Escolha um momento no futuro.")).toBeVisible();
  await next(form).click();
  await form.getByLabel("Texto do lembrete").fill("Nada");
  await next(form).click();
  await next(form).click();
  await form.getByLabel("Nome").fill(`Passado ${tag()}`);
  await form.getByRole("button", { name: "Criar rotina" }).click();
  await expect(form.getByRole("alert")).toContainText("Esse horário já passou.");
  // The way back to fix it stays open, and going back clears the refusal.
  await form.getByRole("button", { name: "Voltar" }).click();
  await next(form).click();
  await expect(form.getByRole("alert")).toHaveCount(0);
  await form.getByRole("button", { name: "Cancelar" }).click();
  await expect(form).toHaveCount(0);
});

test("the AI routine templates fill the text, the name and, while untouched, the hours", async ({ page }) => {
  await openAutomations(page);
  const form = await openWizard(page);
  await form.getByRole("radio", { name: "Rotina da Zuri" }).check();
  await next(form).click();
  await next(form).click();
  const templates = form.getByRole("group", { name: "Começar de um modelo" });
  await templates.getByRole("button", { name: "Briefing da manhã" }).click();
  await expect(templates.getByRole("button", { name: "Briefing da manhã" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByLabel("O que a Zuri deve fazer", { exact: true })).toHaveValue(/eventos de hoje na agenda/);
  // A routine with AI says what it costs and can stay quiet when there is nothing.
  await expect(form.getByText(/Cada execução gasta IA/)).toBeVisible();
  const quiet = form.getByRole("switch", { name: "Só me avise quando houver algo" });
  await expect(quiet).not.toBeChecked();
  await quiet.check();
  await expectAccessible(page, "criar rotina: o que");
  expect(await tooSmallControls(page), "every control of the third step is a 44 px target").toEqual([]);
  // Step 22b: the CRM's funnel on Monday mornings.
  await templates.getByRole("button", { name: "Resumo do funil" }).click();
  await expect(form.getByLabel("O que a Zuri deve fazer", { exact: true })).toHaveValue(/funil do meu CRM/);
  await next(form).click();
  await next(form).click();
  await expect(form.getByLabel("Nome")).toHaveValue("Resumo do funil");
  const summary = form.getByRole("definition");
  await expect(summary.nth(0)).toHaveText("Rotina da Zuri");
  await expect(summary.nth(1)).toHaveText(/^Segunda, às 08:00\. Próxima: /);
  await expect(summary.nth(2)).toContainText("Só avisa quando houver algo");
  await expect(summary.nth(4)).toHaveText("Usa IA a cada vez, dentro do limite do dia");

  // Hours the owner chose are his: a template picked afterwards leaves them alone.
  for (let back = 0; back < 3; back++) await form.getByRole("button", { name: "Voltar" }).click();
  await form.getByLabel("Horário").fill("06:45");
  await next(form).click();
  await templates.getByRole("button", { name: "Fechamento do dia" }).click();
  await next(form).click();
  await next(form).click();
  await expect(form.getByLabel("Nome")).toHaveValue("Fechamento do dia");
  await expect(summary.nth(1)).toHaveText(/^Segunda, às 06:45\. Próxima: /);
  await form.getByRole("button", { name: "Cancelar" }).click();
  await expect(form).toHaveCount(0);
});

/** Asks the Zuri, in the chat, to propose a routine with AI, and follows the link to Rotinas. */
async function propose(page: Page, name: string) {
  await page.goto("/conversa");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Conversa" })).toBeVisible();
  const box = page.getByRole("textbox", { name: "Mensagem" });
  const routine = { name, prompt: "Veja minhas tarefas da semana e diga o que está atrasado.", schedule: { type: "weekly", days: [5], time: "17:00" }, quiet: true };
  await box.fill(`call propose_ai_routine ${JSON.stringify(routine)}`);
  const done = page.waitForResponse((r) => r.url().endsWith("/api/chat") && r.request().method() === "POST");
  await box.press("Enter");
  expect((await done).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Parar" })).toHaveCount(0);
  await page.getByRole("link", { name: "Revisar em Rotinas" }).last().click();
  await expect(page).toHaveURL(/\/rotinas#automacao-[0-9a-f-]{36}$/);
  const pending = page.getByRole("region", { name: /^A Zuri sugeriu (uma rotina|\d+ rotinas)$/ });
  return { pending, item: pending.getByRole("listitem").filter({ hasText: name }) };
}

test("a suggestion the owner declines is gone, and nothing was scheduled", async ({ page }) => {
  const name = `Recusada ${tag()}`;
  const { item } = await propose(page, name);
  await item.getByRole("button", { name: "Recusar" }).click();
  const sure = page.getByRole("dialog", { name: `Recusar a rotina “${name}”?` });
  await expect(sure.getByText("A sugestão é apagada e nada é agendado.")).toBeVisible();
  // Cancelar keeps the suggestion where it was.
  await sure.getByRole("button", { name: "Cancelar" }).click();
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Recusar" }).click();
  await sure.getByRole("button", { name: "Recusar" }).click();
  await expect(toast(page, "Sugestão recusada.")).toBeVisible();
  await expect(item).toHaveCount(0);
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
});

test("a routine Zuri proposes in the chat runs nothing until the owner approves it", async ({ page }) => {
  const name = `Revisão ${tag()}`;
  const { pending, item } = await propose(page, name);
  await expect(item.getByText("Veja minhas tarefas da semana e diga o que está atrasado.")).toBeVisible();
  await expect(item.getByRole("heading", { name: `${name} · Sexta, às 17:00` })).toBeVisible();
  await expect(item.getByText("Usa IA")).toBeVisible();
  await expect(pending.getByText("Esperando aprovação")).toBeVisible();
  await expect(item.getByText("Só avisa quando houver algo")).toBeVisible();
  await expectAccessible(page, "rotina esperando aprovação");

  await item.getByRole("button", { name: "Aprovar" }).click();
  await expect(toast(page, "Rotina aprovada. A primeira execução já está marcada.")).toBeVisible();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(row.getByText("Ativa", { exact: true })).toBeVisible();
  await expect(row.getByText("Criada na conversa")).toBeVisible();
  await expect(row.getByText("Usa IA")).toBeVisible();
  await expect(row.getByText("Só avisa quando houver algo")).toBeVisible();
  await rowAction(row, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar “${name}”?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(row).toHaveCount(0);
});

test("the palette opens the form, from another page or on the page itself", async ({ page }) => {
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  for (const from of ["home", "automations"]) {
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "Buscar e ir para" }).getByRole("combobox").fill("criar rotina");
    await page.keyboard.press("Enter");
    const form = page.getByRole("dialog", { name: "Criar rotina" });
    await expect(form, from).toBeVisible();
    // The request is consumed: the address is clean, so a reload doesn't open the form again.
    await expect(page).toHaveURL(/\/rotinas$/);
    await form.getByRole("button", { name: "Cancelar" }).click();
    await expect(form).toBeHidden();
  }
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Rotinas" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Criar rotina" })).toBeHidden();
});

test("Rotinas sits in the side menu, and behind Mais on a phone @mobile", async ({ page }) => {
  await page.goto("/");
  await signIn(page);
  await openPlace(page, "Rotinas");
  await expect(page.getByRole("heading", { level: 1, name: "Rotinas" })).toBeVisible();
  // The sheet closes once a place is picked.
  await expect(page.getByRole("dialog", { name: "Mais" })).toHaveCount(0);
});
