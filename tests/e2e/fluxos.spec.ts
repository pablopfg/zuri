import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, rowAction, signIn, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// The Flows tab of Automations (step 22a) against the real Worker: the site
// monitor from its model, a connection with a credential that never comes back,
// a flow that calls it, filters and tells the owner, the history, the palette
// and the screen's states. Over loopback the Worker answers *.exemplo.com.br
// itself (apps/agent/src/flows/dev-flows.ts). pt-BR.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/** A word of its own per run: the database keeps what the other project saved. */
const tag = () => uniqueTag(test.info().project.name);

async function openFlows(page: Page) {
  await page.goto("/crm/fluxos");
  await signIn(page);
  await expect(page).toHaveURL(/\/crm\/fluxos$/);
  await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
}

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const flowRow = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });

test("the site monitor: from its model, run now, turn on and off, delete @mobile", async ({ page }) => {
  const name = `Monitor ${tag()}`;
  await openFlows(page);
  await page.getByRole("button", { name: "Monitorar sites" }).click();
  const form = page.getByRole("dialog", { name: "Novo fluxo" });
  await expect(form.getByLabel("Nome")).toHaveValue("Monitor de sites");
  await form.getByLabel("Nome").fill(name);
  // Every 15 minutes, with one monitor step.
  await expect(form.getByLabel("Quando roda")).toHaveValue("interval");
  await expect(form.getByLabel("Minutos entre execuções")).toHaveValue("15");
  await expect(form.getByText("Passo 1: Olhar sites")).toBeVisible();
  await form.getByLabel("Endereços").fill("https://loja.exemplo.com.br\nhttps://fora.exemplo.com.br");
  await expectAccessible(page, "novo monitor");
  await form.getByRole("button", { name: "Criar fluxo" }).click();
  await expect(toast(page, "Fluxo criado, ainda desligado")).toBeVisible();

  const row = flowRow(page, name);
  await expect(row.getByText("Desligado", { exact: true })).toBeVisible();
  await expect(row.getByText("A cada 15 minutos · 1 passo")).toBeVisible();
  const sites = row.getByRole("list", { name: `Sites de ${name}` });
  await expect(sites.getByRole("listitem")).toHaveCount(2);
  await expect(sites.getByText("Ainda não olhado")).toHaveCount(2);
  expect(await tooSmallControls(page), "every control of the Flows tab is a 44 px target").toEqual([]);

  // Run now: the shop answers; the site that is down gets its next try in a minute.
  await rowAction(row, page, "Executar agora");
  await expect(toast(page, /^Fluxo em andamento\. Ele continua sozinho em /)).toBeVisible();
  const shop = sites.getByRole("listitem").filter({ hasText: "loja.exemplo.com.br" });
  await expect(shop.getByText("No ar")).toBeVisible();
  await expect(shop.getByText(/código 200/)).toBeVisible();
  const history = page.getByRole("region", { name: "Histórico dos fluxos" });
  await expect(history.getByRole("listitem").filter({ hasText: name }).first().getByText("Esperando")).toBeVisible();

  // On: the next run shows. Off again.
  await row.getByRole("button", { name: "Ligar" }).click();
  await expect(toast(page, "Fluxo ligado")).toBeVisible();
  await expect(row.getByText("Ligado", { exact: true })).toBeVisible();
  await expect(row.getByText(/^Próxima: /)).toBeVisible();
  await row.getByRole("button", { name: "Desligar" }).click();
  await expect(toast(page, "Fluxo desligado")).toBeVisible();
  await expect(row.getByText(/^Próxima: /)).toHaveCount(0);

  // An address the monitor refuses: the server says why and nothing is saved.
  await rowAction(row, page, "Editar");
  const edit = page.getByRole("dialog", { name: "Editar fluxo" });
  await edit.getByLabel("Endereços").fill("http://loja.exemplo.com.br");
  await edit.getByRole("button", { name: "Salvar" }).click();
  await expect(edit.getByRole("alert")).toBeVisible();
  await edit.getByRole("button", { name: "Cancelar" }).click();

  await rowAction(row, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar ${name}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(toast(page, "Fluxo apagado")).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("a connection keeps its credential on the server; a flow calls it, filters and tells the owner", async ({ page }) => {
  const id = tag();
  const connection = `CRM ${id}`;
  const name = `Propostas ${id}`;
  const secret = `segredo-e2e-${id}`;
  await openFlows(page);

  await page.getByRole("button", { name: "Nova conexão" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova conexão" });
  await dialog.getByLabel("Nome").fill(connection);
  await dialog.getByLabel("Endereço do serviço").fill("https://api.exemplo.com.br");
  // GET comes ticked; DELETE is not on the list at all.
  await expect(dialog.getByLabel("GET")).toBeChecked();
  await expect(dialog.getByLabel("DELETE")).toHaveCount(0);
  await dialog.getByLabel("Caminhos permitidos").fill("/v1/clientes");
  await dialog.getByLabel("Credencial", { exact: true }).selectOption("bearer");
  await dialog.getByLabel("Valor da credencial").fill(secret);
  await expectAccessible(page, "nova conexão");
  await dialog.getByRole("button", { name: "Criar conexão" }).click();
  await expect(toast(page, "Conexão criada")).toBeVisible();
  const connections = page.getByRole("region", { name: "Conexões" });
  const item = connections.getByRole("listitem").filter({ hasText: connection });
  await expect(item.getByText("Com credencial")).toBeVisible();
  await expect(item.getByText("https://api.exemplo.com.br · GET · /v1/clientes")).toBeVisible();

  // Editing shows an empty credential field: the value never comes back to the browser.
  await item.getByRole("button", { name: `Editar a conexão ${connection}` }).click();
  const editing = page.getByRole("dialog", { name: "Editar conexão" });
  await expect(editing.getByLabel("Valor da credencial")).toHaveValue("");
  await editing.getByRole("button", { name: "Cancelar" }).click();
  expect(await page.content()).not.toContain(secret);

  // The flow: call the clients, keep the proposals, one notice each.
  await page.getByRole("button", { name: "Novo fluxo" }).click();
  const form = page.getByRole("dialog", { name: "Novo fluxo" });
  await form.getByLabel("Nome").fill(name);
  await form.getByLabel("Quando roda").selectOption("manual");
  await form.getByLabel("Tipo do passo").selectOption("request");
  await form.getByRole("button", { name: "Adicionar passo" }).click();
  await expect(form.getByLabel("Conexão")).toHaveValue(/.+/);
  await form.getByLabel("Conexão").selectOption({ label: connection });
  await form.getByLabel("Caminho").fill("/v1/clientes");
  await form.getByLabel("Onde está a lista na resposta").fill("data");
  await form.getByLabel("Tipo do passo").selectOption("filter");
  await form.getByRole("button", { name: "Adicionar passo" }).click();
  await form.getByLabel("Campo", { exact: true }).fill("etapa");
  await form.getByLabel("Valor", { exact: true }).fill("proposta");
  await form.getByLabel("Tipo do passo").selectOption("notify");
  await form.getByRole("button", { name: "Adicionar passo" }).click();
  await form.getByLabel("Título do aviso").fill("Proposta de {{nome}}");
  await form.getByLabel("Um aviso para cada item (até 10)").check();
  // The order can change with the buttons.
  await form.getByRole("button", { name: "Subir o passo 3" }).click();
  await expect(form.getByText("Passo 2: Avisar você")).toBeVisible();
  await form.getByRole("button", { name: "Descer o passo 2" }).click();
  await expect(form.getByText("Passo 3: Avisar você")).toBeVisible();
  await expectAccessible(page, "novo fluxo");
  await form.getByRole("button", { name: "Criar fluxo" }).click();
  await expect(toast(page, "Fluxo criado, ainda desligado")).toBeVisible();

  const row = flowRow(page, name);
  await expect(row.getByText("Só quando você executar · 3 passos")).toBeVisible();
  await expect(item.getByText(`Usada por ${name}`)).toBeVisible();
  await rowAction(row, page, "Executar agora");
  await expect(toast(page, "Fluxo executado")).toBeVisible();
  const run = page.getByRole("region", { name: "Histórico dos fluxos" }).getByRole("listitem").filter({ hasText: name }).first();
  await expect(run.getByText("Concluída")).toBeVisible();
  await expect(run.getByText(/1 chamadas · 2 itens/)).toBeVisible();

  // In use, the connection can't go; once the flow is gone, it can.
  await item.getByRole("button", { name: `Apagar a conexão ${connection}` }).click();
  await page.getByRole("dialog", { name: `Apagar a conexão ${connection}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(toast(page, "Um fluxo usa esta conexão. Tire-a do fluxo antes.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(item).toBeVisible();
  await rowAction(row, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar ${name}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(row).toHaveCount(0);
  await item.getByRole("button", { name: `Apagar a conexão ${connection}` }).click();
  await page.getByRole("dialog", { name: `Apagar a conexão ${connection}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(toast(page, "Conexão apagada")).toBeVisible();
  await expect(item).toHaveCount(0);
});

test("the flows have their own address in the CRM, and the palette opens a new flow from anywhere", async ({ page }) => {
  await page.goto("/rotinas");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Rotinas" })).toBeVisible();
  // An unknown part of the CRM goes back to its first screen.
  await page.goto("/crm/outra");
  await expect(page).toHaveURL(/\/crm$/);
  await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();

  // From another place and from the flows themselves.
  for (const from of ["/rotinas", "/crm/fluxos"]) {
    await page.goto(from);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "Buscar e ir para" }).getByRole("combobox").fill("criar fluxo");
    await page.keyboard.press("Enter");
    const form = page.getByRole("dialog", { name: "Novo fluxo" });
    await expect(form, from).toBeVisible();
    await expect(page).toHaveURL(/\/crm\/fluxos$/);
    await form.getByRole("button", { name: "Cancelar" }).click();
    await expect(form).toBeHidden();
  }
});

const START = { failuresToPause: 5, runsPerDay: 500, minIntervalMinutes: 15, aiMinIntervalMinutes: 60, callsPerRun: 40, neuronsPerDay: 3_000, attempts: 3 };

test("the owner sets what holds for every flow on the screen, each number inside limits that fit the free plan @mobile", async ({ page }) => {
  await openFlows(page);
  // The database keeps what the other project saved: start from the numbers of a new installation.
  expect((await page.request.patch("/api/flows/settings", { headers: CSRF, data: START })).ok()).toBe(true);
  try {
    await page.reload();
    const card = page.getByRole("region", { name: "Configurações dos fluxos" });
    const field = {
      interval: card.getByLabel("Intervalo mínimo entre execuções (minutos)"),
      aiInterval: card.getByLabel("Intervalo mínimo com passo de IA (minutos)"),
      runs: card.getByLabel("Execuções por dia, todos os fluxos juntos"),
      calls: card.getByLabel("Chamadas a serviços por execução"),
      neurons: card.getByLabel("Uso de IA dos fluxos por dia (Neurons)"),
      attempts: card.getByLabel("Tentativas de uma chamada que falhou"),
      failures: card.getByLabel("Pausar o fluxo depois de quantas falhas seguidas"),
    };
    const save = card.getByRole("button", { name: "Salvar configurações" });
    for (const [name, value] of [["interval", "15"], ["aiInterval", "60"], ["runs", "500"], ["calls", "40"], ["neurons", "3000"], ["attempts", "3"], ["failures", "5"]] as const) {
      await expect(field[name], name).toHaveValue(value);
    }
    for (const range of ["De 5 a 60.", "De 30 a 1440.", "De 10 a 500.", "De 5 a 40.", "De 100 a 3000.", "De 1 a 3.", "De 2 a 10."]) await expect(card.getByText(range, { exact: true })).toBeVisible();
    await expect(card.getByText(/Horários por dia dos fluxos ligados: \d+ de 2000\./)).toBeVisible();
    // Nothing changed, or a number outside its limits: nothing to save.
    await expect(save).toBeDisabled();
    for (const [name, bad] of [["runs", "501"], ["runs", "9"], ["interval", "4"], ["calls", "41"], ["neurons", "3001"], ["attempts", "0"], ["failures", "1"]] as const) {
      const before = await field[name].inputValue();
      await field[name].fill(bad);
      await expect(save, `${name} ${bad}`).toBeDisabled();
      await field[name].fill(before);
    }
    await field.failures.fill("3");
    await field.interval.fill("5");
    await field.runs.fill("120");
    await expectAccessible(page, "fluxos configuracoes");
    // By the keyboard: Enter in a field saves.
    await field.runs.press("Enter");
    await expect(toast(page, "Configurações salvas")).toBeVisible();
    await expect(save).toBeDisabled();
    await page.reload();
    await expect(field.failures).toHaveValue("3");
    await expect(field.interval).toHaveValue("5");
    await expect(field.runs).toHaveValue("120");
    // The editor follows the owner's floor: 5 minutes is now offered, with the hint saying so.
    await page.getByRole("button", { name: "Novo fluxo" }).click();
    const form = page.getByRole("dialog", { name: "Novo fluxo" });
    await expect(form.getByText("No mínimo 5. Com um passo de IA, no mínimo 60.")).toBeVisible();
    await expect(form.getByLabel("Minutos entre execuções")).toHaveAttribute("min", "5");
    await form.getByRole("button", { name: "Cancelar" }).click();
  } finally {
    expect((await page.request.patch("/api/flows/settings", { headers: CSRF, data: START })).ok()).toBe(true);
  }
});

test("a flow at a time of day shows its schedule when the CRM is the first screen opened", async ({ page }) => {
  // Not through Rotinas first: the schedule's words must come with this screen.
  await openFlows(page);
  const name = `Semanal ${tag()}`;
  const created = await page.request.post("/api/flows", {
    headers: CSRF,
    data: { name, definition: { version: 1, trigger: { type: "schedule", schedule: { type: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" } }, nodes: [{ type: "notify", title: "Bom dia", body: "", priority: "low", each: false }] } },
  });
  expect(created.status()).toBe(201);
  const { flow } = (await created.json()) as { flow: { id: string } };
  try {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();
    await expect(flowRow(page, name)).toContainText("às 09:00");
    await expect(page.getByText("Esta tela parou")).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/flows/${flow.id}`, { headers: CSRF });
  }
});

test("loading, empty and error states of the tab", async ({ page }) => {
  let answer: "slow" | "empty" | "error" = "slow";
  let release: () => void = () => undefined;
  await page.route("**/api/flows", async (route) => {
    if (answer === "slow") await new Promise<void>((resolve) => (release = resolve));
    if (answer === "error") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL", message: "Algo deu errado." }) });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ flows: [], drafts: [], connections: [], counts: { flows: 0, enabled: 0, connections: 0, sites: 0, runsToday: 0, neuronsToday: 0, slots: 0 }, settings: START, credentialsAvailable: false }),
    });
  });
  await page.goto("/crm/fluxos");
  await signIn(page);
  await expect(page.getByRole("status").filter({ hasText: "Carregando fluxos" })).toBeVisible();
  answer = "empty";
  release();
  await expect(page.getByText("Nenhum fluxo ainda", { exact: true })).toBeVisible();
  await expect(page.getByText("Guardar credenciais ainda não está disponível nesta instalação.", { exact: false })).toBeVisible();
  await expectAccessible(page, "fluxos vazio");
  answer = "error";
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
});

test("a flow the chat suggests waits on the tab; saved by the owner, it starts off (step 22b)", async ({ page }) => {
  const name = `Sugerido ${tag()}`;
  await page.goto("/conversa");
  await signIn(page);
  const definition = { version: 1, trigger: { type: "manual" }, nodes: [{ type: "monitor", sites: ["https://loja.exemplo.com.br"] }] };
  const box = page.getByRole("textbox", { name: "Mensagem" });
  await box.fill(`call propose_flow ${JSON.stringify({ name, definition })}`);
  const done = page.waitForResponse((r) => r.url().endsWith("/api/chat") && r.request().method() === "POST");
  await box.press("Enter");
  expect((await done).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Parar" })).toHaveCount(0);

  await page.goto("/crm/fluxos");
  await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();
  const drafts = page.getByRole("region", { name: "Sugestões da Zuri" });
  const draft = drafts.getByRole("listitem").filter({ hasText: name });
  await expect(draft).toBeVisible();
  // Nothing was made from it yet.
  await expect(flowRow(page, name)).toHaveCount(0);
  await expectAccessible(page, "fluxos com sugestão");

  await draft.getByRole("button", { name: "Revisar" }).click();
  const form = page.getByRole("dialog", { name: "Revisar sugestão da Zuri" });
  await expect(form.getByLabel("Nome")).toHaveValue(name);
  await form.getByRole("button", { name: "Criar fluxo" }).click();
  await expect(toast(page, "Fluxo criado, ainda desligado")).toBeVisible();
  await expect(drafts).toHaveCount(0);
  const row = flowRow(page, name);
  await expect(row.getByRole("button", { name: "Ligar" })).toBeVisible();

  await rowAction(row, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar ${name}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(flowRow(page, name)).toHaveCount(0);
});
