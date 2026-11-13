import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, rowAction, signIn, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// CRM › Fluxos and CRM › Credenciais (step 22a; Sinal, S15) against the real
// Worker: the site monitor from its model, a credential whose key never comes back,
// a flow that calls it, filters and tells the owner, the last runs, the palette
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
  await row.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(toast(page, /^Fluxo em andamento\. Ele continua sozinho em /)).toBeVisible();
  const shop = sites.getByRole("listitem").filter({ hasText: "loja.exemplo.com.br" });
  await expect(shop.getByText("No ar")).toBeVisible();
  await expect(shop.getByText(/código 200/)).toBeVisible();
  const history = page.getByRole("region", { name: "Últimas execuções" });
  await expect(history.getByRole("listitem").filter({ hasText: name }).first().getByText("Esperando")).toBeVisible();

  // On: the next run shows. Off again.
  await rowAction(row, page, "Ligar");
  await expect(toast(page, "Fluxo ligado")).toBeVisible();
  await expect(row.getByText("Ligado", { exact: true })).toBeVisible();
  await expect(row.getByText(/^Próxima: /)).toBeVisible();
  await rowAction(row, page, "Desligar");
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

test("a credential keeps its key on the server; a flow calls it, filters and tells the owner", async ({ page }) => {
  const id = tag();
  const connection = `CRM ${id}`;
  const name = `Propostas ${id}`;
  const secret = `segredo-e2e-${id}`;
  await openFlows(page);
  const parts = page.getByRole("navigation", { name: "Partes do CRM" });

  await parts.getByRole("link", { name: /^Credenciais/ }).click();
  await expect(page).toHaveURL(/\/crm\/credenciais$/);
  await page.getByRole("button", { name: "Nova credencial" }).click();
  // The kind first (PR S17): a service the flows call.
  await page.getByRole("dialog", { name: "Nova credencial" }).getByRole("button", { name: "Outro serviço (https)" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova credencial" });
  await dialog.getByLabel("Nome").fill(connection);
  await dialog.getByLabel("Endereço do serviço").fill("https://api.exemplo.com.br");
  // GET comes ticked; DELETE is not on the list at all.
  await expect(dialog.getByLabel("GET")).toBeChecked();
  await expect(dialog.getByLabel("DELETE")).toHaveCount(0);
  await dialog.getByLabel("Caminhos permitidos").fill("/v1/clientes");
  await dialog.getByLabel("Tipo de chave").selectOption("bearer");
  await dialog.getByLabel("Chave", { exact: true }).fill(secret);
  await expectAccessible(page, "nova credencial");
  await dialog.getByRole("button", { name: "Criar credencial" }).click();
  await expect(toast(page, "Credencial criada")).toBeVisible();
  const item = page.getByRole("list", { name: "Credenciais" }).getByRole("listitem").filter({ hasText: connection });
  // Only the key's last 4 characters come back, and the kind's tag.
  await expect(item.getByText(`Chave terminada em ${secret.slice(-4)}`)).toBeVisible();
  await expect(item.getByText("Serviço", { exact: true })).toBeVisible();
  await expect(item.getByText("https://api.exemplo.com.br · GET · /v1/clientes")).toBeVisible();
  await expect(item.getByText("Nenhum fluxo usa ainda")).toBeVisible();
  expect(await tooSmallControls(page), "every control of Credenciais is a 44 px target").toEqual([]);
  await expectAccessible(page, "credenciais com linha");

  // Editing shows an empty key field: the value never comes back to the browser.
  await rowAction(item, page, "Editar");
  const editing = page.getByRole("dialog", { name: "Editar credencial" });
  await expect(editing.getByLabel("Chave", { exact: true })).toHaveValue("");
  // A new address asks for the key again before saving (PR S17).
  await editing.getByLabel("Endereço do serviço").fill("https://outra.exemplo.com.br");
  await expect(editing.getByText("O endereço mudou: digite a chave de novo.")).toBeVisible();
  await expect(editing.getByRole("button", { name: "Salvar" })).toBeDisabled();
  await editing.getByRole("button", { name: "Cancelar" }).click();
  // Testar reads the first path once.
  await rowAction(item, page, "Testar");
  await expect(toast(page, /^Respondeu em \d+ ms\.$/)).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  await parts.getByRole("link", { name: /^Fluxos/ }).click();
  await expect(page).toHaveURL(/\/crm\/fluxos$/);

  // The flow: call the clients, keep the proposals, one notice each.
  await page.getByRole("button", { name: "Novo fluxo" }).click();
  const form = page.getByRole("dialog", { name: "Novo fluxo" });
  await form.getByLabel("Nome").fill(name);
  await form.getByLabel("Quando roda").selectOption("manual");
  await form.getByLabel("Tipo do passo").selectOption("request");
  await form.getByRole("button", { name: "Adicionar passo" }).click();
  await expect(form.getByLabel("Credencial")).toHaveValue(/.+/);
  await form.getByLabel("Credencial").selectOption({ label: connection });
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
  await row.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(toast(page, "Fluxo executado")).toBeVisible();
  const run = page.getByRole("region", { name: "Últimas execuções" }).getByRole("listitem").filter({ hasText: name }).first();
  await expect(run.getByText("Concluída")).toBeVisible();
  await expect(run.getByText(/1 chamadas · 2 itens/)).toBeVisible();

  // In use, the credential can't go; once the flow is gone, it can.
  await parts.getByRole("link", { name: /^Credenciais/ }).click();
  await expect(item.getByText(`Usada por ${name}`)).toBeVisible();
  await rowAction(item, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar a credencial ${connection}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(toast(page, "Um fluxo usa esta credencial. Tire-a do fluxo antes.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(item).toBeVisible();
  await parts.getByRole("link", { name: /^Fluxos/ }).click();
  await rowAction(row, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar ${name}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(row).toHaveCount(0);
  await parts.getByRole("link", { name: /^Credenciais/ }).click();
  await rowAction(item, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar a credencial ${connection}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(toast(page, "Credencial apagada")).toBeVisible();
  await expect(item).toHaveCount(0);
});

test("a Chatwoot credential: account, key, waits checked on the screen, the inbox picked from what the key sees @mobile", async ({ page }) => {
  const id = tag();
  const name = `Chatwoot ${id}`;
  const key = `chave-do-agente-${id}`;
  await page.goto("/crm/credenciais");
  await signIn(page);
  await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
  await page.getByRole("button", { name: "Nova credencial" }).click();
  const chooser = page.getByRole("dialog", { name: "Nova credencial" });
  await expectAccessible(page, "tipo de credencial");
  await chooser.getByRole("button", { name: "Chatwoot" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova credencial do Chatwoot" });
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Endereço do Chatwoot").fill("https://chat.exemplo.com.br");
  await expect(dialog.getByLabel("Número da conta")).toHaveValue("1");
  // No key yet: nothing to save.
  await expect(dialog.getByRole("button", { name: "Criar credencial" })).toBeDisabled();
  await dialog.getByLabel("Chave de acesso").fill(key);
  // One person's wait must stay below the bulk "from": 30 isn't, 29 is.
  const one = dialog.getByRole("group", { name: "Espera para mensagem a uma pessoa (segundos)" });
  await one.getByLabel("Até").fill("30");
  await one.getByLabel("De").fill("1");
  await expect(dialog.getByRole("alert").filter({ hasText: "menor que o primeiro dos envios em massa" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Criar credencial" })).toBeDisabled();
  await one.getByLabel("Até").fill("29");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expectAccessible(page, "nova credencial do chatwoot");
  await dialog.getByRole("button", { name: "Criar credencial" }).click();
  await expect(toast(page, "Credencial criada")).toBeVisible();

  const item = page.getByRole("list", { name: "Credenciais" }).getByRole("listitem").filter({ hasText: name });
  await expect(item.getByText("Chatwoot", { exact: true })).toBeVisible();
  await expect(item.getByText(`Chave terminada em ${key.slice(-4)}`)).toBeVisible();
  await expect(item.getByText(/Conta 1 · caixa ainda não escolhida · envios em massa: 30 a 60 s · uma pessoa: 1 a 29 s/)).toBeVisible();

  // The inbox comes from what the saved key sees.
  await rowAction(item, page, "Editar");
  const editing = page.getByRole("dialog", { name: "Editar credencial" });
  await expect(editing.getByLabel("Chave de acesso")).toHaveValue("");
  await editing.getByRole("button", { name: "Buscar caixas" }).click();
  await expect(editing.getByText("2 caixas encontradas")).toBeVisible();
  await editing.getByLabel("Caixa de entrada").selectOption({ label: "WhatsApp do consultório" });
  await expect(editing.getByRole("option", { name: "E-mail (não é de API)" })).toHaveCount(1);
  await expectAccessible(page, "editar credencial do chatwoot");
  await editing.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, "Credencial salva")).toBeVisible();
  await expect(item.getByText(/caixa “WhatsApp do consultório”/)).toBeVisible();
  expect(await page.content()).not.toContain(key);
  expect(await tooSmallControls(page), "every control of Credenciais is a 44 px target").toEqual([]);
  await rowAction(item, page, "Testar");
  await expect(toast(page, "Conectou. A chave enxerga 2 caixas de entrada.")).toBeVisible();

  // A flow never offers it.
  await page.goto("/crm/fluxos");
  await page.getByRole("button", { name: "Novo fluxo" }).click();
  const form = page.getByRole("dialog", { name: "Novo fluxo" });
  await form.getByLabel("Tipo do passo").selectOption("request");
  await form.getByRole("button", { name: "Adicionar passo" }).click();
  await expect(form.getByLabel("Credencial").getByRole("option", { name })).toHaveCount(0);
  await form.getByRole("button", { name: "Cancelar" }).click();

  await page.goto("/crm/credenciais");
  await rowAction(item, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar a credencial ${name}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(toast(page, "Credencial apagada")).toBeVisible();
});

test("the flows have their own address in the CRM, and the palette opens a new flow from anywhere", async ({ page }) => {
  await page.goto("/rotinas");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Rotinas" })).toBeVisible();
  // An unknown part of the CRM goes back to its first screen.
  await page.goto("/crm/outra");
  await expect(page).toHaveURL(/\/crm$/);
  await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();

  // From another place, from the flows themselves and from the other part of the CRM, which it leaves for the flows.
  for (const from of ["/rotinas", "/crm/fluxos", "/crm/credenciais"]) {
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
    await expect(card.getByText(/Horários por dia dos fluxos ligados: \d+ de \d+\./)).toBeVisible();
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

test("flows with a daily, weekly or hourly schedule read on the CRM opened directly, and the editor shows the week (#297)", async ({ page }) => {
  const id = tag();
  const schedules = [
    { name: `Alguns dias ${id}`, schedule: { type: "weekly", days: [1, 3], time: "10:15" }, reads: "Segunda e quarta, às 10:15 · 1 passo" },
    { name: `Fim de semana ${id}`, schedule: { type: "weekly", days: [0, 6], time: "08:00" }, reads: "Sábado e domingo às 08:00 · 1 passo" },
    { name: `Diário ${id}`, schedule: { type: "daily", time: "07:30" }, reads: "Todo dia às 07:30 · 1 passo" },
    { name: `De hora em hora ${id}`, schedule: { type: "interval", minutes: 60 }, reads: "A cada hora · 1 passo" },
    { name: `A cada duas horas ${id}`, schedule: { type: "interval", minutes: 120 }, reads: "A cada 2 horas · 1 passo" },
  ];
  await openFlows(page);
  const ids: string[] = [];
  try {
    for (const { name, schedule } of schedules) {
      const definition = { version: 1, trigger: { type: "schedule", schedule }, nodes: [{ type: "notify", title: "Aviso", body: "Hora de olhar.", priority: "normal", each: false }] };
      const created = await page.request.post("/api/flows", { headers: CSRF, data: { name, definition } });
      expect(created.status(), name).toBe(201);
      ids.push(((await created.json()) as { flow: { id: string } }).flow.id);
    }

    // A fresh load of the CRM, never through Rotinas: the schedule's words must come with this screen.
    for (const address of ["/crm/fluxos"]) {
      await page.goto(address);
      await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();
      for (const { name, reads } of schedules) await expect(flowRow(page, name).getByText(reads), `${address}: ${name}`).toBeVisible();
      await expect(page.getByText("Esta tela parou")).toHaveCount(0);
      // A text that did not come with the screen would show as its key.
      await expect(page.getByText(/\bweb\.[a-z]+\./i), address).toHaveCount(0);
    }

    // The editor of a weekly flow names the days of the week.
    const weekly = schedules[0] as (typeof schedules)[number];
    await rowAction(flowRow(page, weekly.name), page, "Editar");
    const edit = page.getByRole("dialog", { name: "Editar fluxo" });
    await expect(edit.getByLabel("Quando roda")).toHaveValue("weekly");
    const days = edit.getByRole("group", { name: "Dias" });
    await expect(days.getByRole("button")).toHaveText(["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]);
    await expect(days.getByRole("button", { pressed: true })).toHaveText(["Seg", "Qua"]);
    await expect(edit.getByText(/\bweb\.[a-z]+\./i)).toHaveCount(0);
    await expectAccessible(page, "editar fluxo semanal");
    await edit.getByRole("button", { name: "Cancelar" }).click();
  } finally {
    for (const flow of ids) await page.request.delete(`/api/flows/${flow}`, { headers: CSRF });
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
      body: JSON.stringify({ flows: [], drafts: [], connections: [], counts: { flows: 0, enabled: 0, connections: 0, sites: 0, runsToday: 0, neuronsToday: 0, slots: 0, slotsLimit: 2000 }, settings: START, credentialsAvailable: false }),
    });
  });
  await page.goto("/crm/fluxos");
  await signIn(page);
  await expect(page.getByRole("status").filter({ hasText: "Carregando fluxos" })).toBeVisible();
  answer = "empty";
  release();
  await expect(page.getByText("Nenhum fluxo ainda", { exact: true })).toBeVisible();
  await expectAccessible(page, "fluxos vazio");
  // The other part is empty too, and says that this installation keeps no key.
  await page.getByRole("navigation", { name: "Partes do CRM" }).getByRole("link", { name: /^Credenciais/ }).click();
  await expect(page.getByText("Nenhuma credencial ainda", { exact: true })).toBeVisible();
  await expect(page.getByText("Guardar chaves ainda não está disponível nesta instalação.", { exact: false })).toBeVisible();
  await expectAccessible(page, "credenciais vazio");
  await page.goBack();
  answer = "error";
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
});

test("the row says a flow was turned off by failures at the owner's number, not at 5", async ({ page }) => {
  const flow = (name: string, failures: number) => ({
    id: `f${failures}`,
    name,
    definition: { version: 1, trigger: { type: "manual" }, nodes: [{ type: "wait", minutes: 1 }] },
    enabled: false,
    usesAi: false,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastProblem: null,
    failures,
    sites: [],
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
  });
  await page.route("**/api/flows", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        flows: [flow("Parou em duas", 2), flow("Desligado à mão", 1)],
        drafts: [],
        connections: [],
        counts: { flows: 2, enabled: 0, connections: 0, sites: 0, runsToday: 0, neuronsToday: 0, slots: 0, slotsLimit: 2000 },
        settings: { ...START, failuresToPause: 2 },
        credentialsAvailable: false,
      }),
    }),
  );
  await page.goto("/crm/fluxos");
  await signIn(page);
  await expect(page.getByRole("listitem").filter({ hasText: "Parou em duas" }).getByText("Desligado por falhas", { exact: true })).toBeVisible();
  const byHand = page.getByRole("listitem").filter({ hasText: "Desligado à mão" });
  await expect(byHand.getByText("Desligado", { exact: true })).toBeVisible();
  await expect(byHand.getByText("Desligado por falhas", { exact: true })).toHaveCount(0);
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
  await expect(row.getByText("Desligado", { exact: true })).toBeVisible();

  await rowAction(row, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar ${name}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(flowRow(page, name)).toHaveCount(0);
});

test("the CRM has three parts, Automações at /crm; Envios still waits for its server (S15, S18) @mobile", async ({ page }) => {
  await page.goto("/crm/fluxos");
  await signIn(page);
  const parts = page.getByRole("navigation", { name: "Partes do CRM" });
  // The number beside each name is how many it holds.
  await expect(parts.getByRole("link")).toHaveCount(3);
  await expect(parts.getByRole("link").nth(0)).toHaveAccessibleName(/^Automações \d+$/);
  await expect(parts.getByRole("link").nth(1)).toHaveAccessibleName(/^Fluxos \d+$/);
  await expect(parts.getByRole("link").nth(2)).toHaveAccessibleName(/^Credenciais \d+$/);
  await expect(page.getByText("Fluxos que você monta passo a passo, com hora para rodar e limites.")).toBeVisible();
  await expect(parts.getByRole("link", { name: /^Fluxos/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Novo fluxo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova credencial" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Últimas execuções" })).toBeVisible();
  // "Envios" waits for its server (S19): no link, and its address goes back to the CRM, as /crm/automacoes does.
  await expect(page.getByRole("link", { name: /Envios/ })).toHaveCount(0);
  for (const address of ["/crm/automacoes", "/crm/envios"]) {
    await page.goto(address);
    await expect(page).toHaveURL(/\/crm$/);
    await expect(parts.getByRole("link", { name: /^Automações/ })).toHaveAttribute("aria-current", "page");
  }
  await page.goto("/crm/fluxos");
  // By the keyboard: the link of the other part, then back by the note under the flows' runs.
  await parts.getByRole("link", { name: /^Credenciais/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/crm\/credenciais$/);
  await expect(parts.getByRole("link", { name: /^Credenciais/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Nova credencial" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo fluxo" })).toHaveCount(0);
  await expect(page.getByText("A chave fica cifrada no servidor e nunca volta para a tela.")).toBeVisible();
  // The notices about clients moved to Configurações › Avisos: no switch is left here.
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expectAccessible(page, "crm credenciais");
  expect(await tooSmallControls(page), "every control of Credenciais is a 44 px target").toEqual([]);
  await page.goBack();
  await expect(page).toHaveURL(/\/crm\/fluxos$/);
  await page.getByRole("link", { name: "Ver credenciais" }).click();
  await expect(page).toHaveURL(/\/crm\/credenciais$/);
});

test("a duplicated flow starts off, under the original's name marked as a copy (S15)", async ({ page }) => {
  // A name of exactly the 80 characters a flow takes: the copy is cut on the original's side to fit.
  const name = `Original ${tag()} `.padEnd(80, "x");
  expect(name).toHaveLength(80);
  const copyName = `${name.slice(0, 72)} (cópia)`;
  await openFlows(page);
  const definition = { version: 1, trigger: { type: "schedule", schedule: { type: "daily", time: "07:30" } }, nodes: [{ type: "notify", title: "Aviso", body: "", priority: "low", each: false }] };
  const created = await page.request.post("/api/flows", { headers: CSRF, data: { name, definition } });
  expect(created.status()).toBe(201);
  const ids = [((await created.json()) as { flow: { id: string } }).flow.id];
  try {
    await page.reload();
    await rowAction(flowRow(page, name), page, "Duplicar");
    await expect(toast(page, "Fluxo duplicado. Começa desligado.")).toBeVisible();
    const copy = flowRow(page, copyName);
    await expect(copy.getByText("Desligado", { exact: true })).toBeVisible();
    await expect(copy.getByText("Todo dia às 07:30 · 1 passo")).toBeVisible();
    await expect(copy.getByText(/^Próxima: /)).toHaveCount(0);
    const list = (await (await page.request.get("/api/flows", { headers: CSRF })).json()) as { flows: { id: string; name: string; enabled: boolean }[] };
    const saved = list.flows.find((flow) => flow.name === copyName);
    expect(saved?.enabled).toBe(false);
    if (saved) ids.push(saved.id);
  } finally {
    for (const id of ids) await page.request.delete(`/api/flows/${id}`, { headers: CSRF });
  }
});

test("the last runs say why one stopped, load older ones, and have their empty and error states (S15, C6)", async ({ page }) => {
  const run = (id: string, more: Record<string, unknown>) => ({
    id,
    flowId: "f1",
    flowName: `Fluxo ${id}`,
    trigger: "schedule",
    status: "success",
    problem: null,
    node: null,
    httpStatus: null,
    calls: 2,
    items: 5,
    startedAt: "2026-11-10T12:00:00.000Z",
    finishedAt: "2026-11-10T12:00:01.000Z",
    resumeAt: null,
    ...more,
  });
  let answer: "pages" | "empty" | "error" = "pages";
  await page.route("**/api/flows/runs*", (route) => {
    if (answer === "error") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL", message: "Algo deu errado." }) });
    if (answer === "empty") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ runs: [], nextCursor: null }) });
    const older = new URL(route.request().url()).searchParams.get("before") === "cursor-1";
    const runs = older
      ? [run("antigo", {})]
      : [run("falhou", { status: "error", problem: "http_error", node: 2, httpStatus: 503 }), run("esperando", { status: "waiting", resumeAt: "2026-11-10T18:00:00.000Z" })];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ runs, nextCursor: older ? null : "cursor-1" }) });
  });
  await openFlows(page);
  const history = page.getByRole("region", { name: "Últimas execuções" });
  // Under the list of flows (or its empty state), never above it.
  const above = page.getByRole("list", { name: "Seus fluxos" }).or(page.getByText("Nenhum fluxo ainda", { exact: true }));
  await expect(above).toBeVisible();
  const order = await above.evaluate((list) => {
    const runs = document.querySelector("ol.zuri-routine-runs");
    return runs ? !!(list.compareDocumentPosition(runs) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
  });
  expect(order).toBe(true);
  const failed = history.getByRole("listitem").filter({ hasText: "Fluxo falhou" });
  await expect(failed.getByText("Com erro", { exact: true })).toBeVisible();
  await expect(failed.getByText(/^Passo 2 · .+ · código 503$/)).toBeVisible();
  const waiting = history.getByRole("listitem").filter({ hasText: "Fluxo esperando" });
  await expect(waiting.getByText(/^Continua em /)).toBeVisible();
  await expect(waiting.getByText("2 chamadas · 5 itens", { exact: false })).toBeVisible();
  await expectAccessible(page, "ultimas execucoes");
  // Older ones come at the owner's request, after the ones in view.
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await history.getByRole("button", { name: "Carregar mais" }).click();
  await expect(history.getByRole("listitem")).toHaveText([/Fluxo falhou/, /Fluxo esperando/, /Fluxo antigo/]);
  await expect(history.getByRole("button", { name: "Carregar mais" })).toHaveCount(0);

  answer = "empty";
  await page.reload();
  await expect(history.getByText("Nenhuma execução ainda.")).toBeVisible();
  answer = "error";
  await page.reload();
  await expect(history.getByRole("alert")).toBeVisible();
  // The flows above it still load: only the runs failed, and trying again brings them.
  await expect(page.getByRole("button", { name: "Novo fluxo" })).toBeEnabled();
  answer = "empty";
  await history.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(history.getByText("Nenhuma execução ainda.")).toBeVisible();
});
