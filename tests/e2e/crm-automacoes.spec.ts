import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// CRM › Automações (PR S18) against the real Worker: the list in the order the
// automations arrive, "Avisar quando chegar", and the example automation (only
// in local development) turned on in rehearsal with a Chatwoot credential the
// Worker answers itself (apps/agent/src/flows/dev-flows.ts), followed, turned on
// for real taking the risk, and off. pt-BR.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const tag = () => uniqueTag(test.info().project.name);
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const row = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: new RegExp(`^\\d+ ${name}$`) }) });

async function openAutomations(page: Page) {
  await page.goto("/crm");
  await signIn(page);
  await expect(page).toHaveURL(/\/crm$/);
  await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
}

/** The example starts off and nothing else holds a Chatwoot credential of a run before. */
async function reset(page: Page) {
  await page.request.post("/api/crm/automations/example/mode", { headers: CSRF, data: { mode: "off" } });
  await page.request.put("/api/crm/automations/review-request/watch", { headers: CSRF, data: { watch: false } });
}

test("lists the automations in the order they arrive, with the base and the notice when one arrives @mobile", async ({ page }) => {
  await openAutomations(page);
  await reset(page);
  await page.reload();
  const parts = page.getByRole("navigation", { name: "Partes do CRM" });
  await expect(parts.getByRole("link", { name: /^Automações \d+$/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/As automações do consultório passam a rodar na Zuri/)).toBeVisible();
  // No button to create: automations come from the code.
  await expect(page.getByRole("button", { name: /^Nova|^Novo|^Criar/ })).toHaveCount(0);
  const base = page.getByRole("region", { name: "Base" });
  await expect(base.getByRole("listitem")).toHaveCount(3);
  await expect(base.getByRole("listitem").filter({ hasText: "Dias úteis e feriados." })).toContainText("Pronta");
  await expect(base.getByRole("listitem").filter({ hasText: "Envio pelo Chatwoot, com fila." })).toContainText("A caminho");
  const list = page.getByRole("list", { name: "Automações, na ordem em que chegam" });
  await expect(list.getByRole("listitem").first()).toContainText("1Pedido de avaliação");
  await expect(row(page, "Pedido de avaliação")).toContainText("Próxima a chegar");
  await expect(row(page, "Pedido de avaliação")).toContainText("Escreve a contatos");
  await expect(row(page, "Ligar avaliação ao contato")).toContainText("Em desenvolvimento");
  await expect(row(page, "Acompanhamento do plano")).toContainText("10");
  // Only local development has the example, last, with its code.
  await expect(row(page, "Automação de exemplo")).toContainText("Desligada");
  await expect(page.getByText("1 de 11 liberada")).toBeVisible();
  // "Avisar quando chegar": a button that says whether it's pressed.
  const bell = row(page, "Pedido de avaliação").getByRole("button", { name: "Avisar quando “Pedido de avaliação” chegar" });
  await expect(bell).toHaveAttribute("aria-pressed", "false");
  await bell.click();
  await expect(toast(page, "Aviso ligado")).toBeVisible();
  const unwatch = row(page, "Pedido de avaliação").getByRole("button", { name: "Não avisar quando “Pedido de avaliação” chegar" });
  await expect(unwatch).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(unwatch).toHaveAttribute("aria-pressed", "true");
  await unwatch.click();
  await expect(toast(page, "Aviso desligado")).toBeVisible();
  await expect(page.getByText(/\bweb\.[a-z]+\./i)).toHaveCount(0);
  await expectAccessible(page, "crm automações");
  expect(await tooSmallControls(page), "every control of Automações is a 44 px target").toEqual([]);
});

test("the example: credential tested, rehearsal, a day checked, on for real taking the risk, then off", async ({ page }) => {
  await openAutomations(page);
  await reset(page);
  const name = `Chatwoot ${tag()}`;
  const created = await page.request.post("/api/flows/connections", {
    headers: CSRF,
    data: { kind: "chatwoot", name, origin: "https://chat.exemplo.com.br", accountId: 1, credential: "chave-do-agente-de-exemplo-9b1c" },
  });
  expect(created.status()).toBe(201);
  const credential = ((await created.json()) as { connection: { id: string } }).connection.id;
  await page.reload();
  const example = row(page, "Automação de exemplo");
  await example.getByRole("button", { name: "Ligar" }).click();
  const form = page.getByRole("form", { name: "Ligar “Automação de exemplo”" });
  await form.getByLabel("Usar a credencial").selectOption(credential);
  // Saving waits for the test of the credential picked.
  await expect(form.getByRole("button", { name: "Salvar e começar o ensaio" })).toBeDisabled();
  await expect(form.getByText("Teste a credencial antes de salvar.")).toBeVisible();
  await form.getByRole("button", { name: "Testar credencial" }).click();
  await expect(toast(page, "Conectou. A chave enxerga 2 caixas de entrada.")).toBeVisible();
  await expect(form.getByLabel("Por dia")).toHaveValue("3");
  await form.getByLabel("Por dia").fill("2");
  await expectAccessible(page, "ligar automação");
  // A day of the rehearsal, fixed here: the server's own date may be a weekend.
  let checked: unknown = null;
  await page.route("**/api/crm/automations/example/activity", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runs: [],
        effects: [{ id: "rehearsal:a", at: "2026-11-05T12:00:00.000Z", mode: "rehearsal", status: "would", label: "Pessoa de exemplo 1" }],
        days: [{ day: "2026-11-05", would: 2, verdict: null, note: null }],
      }),
    }),
  );
  await page.route("**/api/crm/automations/example/days/2026-11-05", async (route) => {
    checked = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await form.getByRole("button", { name: "Salvar e começar o ensaio" }).click();
  await expect(toast(page, "Ensaio começou")).toBeVisible();
  await expect(example).toContainText("Em ensaio");
  await expect(example).toContainText("Usa: credencial do Chatwoot");
  // The credential is now in use by it.
  const list = (await (await page.request.get("/api/flows", { headers: CSRF })).json()) as { connections: { id: string; usedBy: string[] }[] };
  expect(list.connections.find((item) => item.id === credential)?.usedBy).toEqual(["Automação de exemplo"]);

  // Saved, the panel turns into the follow-up of the rehearsal.
  await expect(example.getByRole("button", { name: "Acompanhar" })).toHaveAttribute("aria-expanded", "true");
  // The panel takes the row's whole width, not the tile's column (as it did before the screenshots).
  const panel = page.locator(`#${await example.getByRole("button", { name: "Acompanhar" }).getAttribute("aria-controls")}`);
  const [rowBox, panelBox] = [await example.boundingBox(), await panel.boundingBox()];
  expect(panelBox?.width ?? 0, "the follow-up panel spans the row").toBeGreaterThan((rowBox?.width ?? 0) * 0.8);
  await expect(example.getByText("A Zuri roda tudo, mas não envia nada")).toBeVisible();
  const days = example.getByRole("region", { name: "Confira cada dia" });
  await expect(days).toContainText("05/11");
  await expect(days).toContainText("2 itens");
  await expect(example.getByRole("region", { name: "O que a Zuri fez" })).toContainText("Pessoa de exemplo 1");
  await expect(example.getByRole("region", { name: "O que a Zuri fez" })).toContainText("Faria");
  await days.getByRole("button", { name: "Tem erro" }).click();
  const reason = days.getByLabel("O que está errado");
  await expect(days.getByRole("button", { name: "Salvar motivo" })).toBeDisabled();
  await reason.fill("Faltou uma pessoa");
  await days.getByRole("button", { name: "Salvar motivo" }).click();
  await expect(toast(page, "Dia conferido")).toBeVisible();
  expect(checked).toEqual({ verdict: "differs", note: "Faltou uma pessoa" });
  await days.getByRole("button", { name: "Está certo" }).click();
  await expect.poll(() => checked).toEqual({ verdict: "match" });
  await expectAccessible(page, "acompanhar automação");
  await page.unroute("**/api/crm/automations/example/activity");

  // Before the 3 days, only taking the risk.
  const live = example.getByRole("button", { name: "Ligar de verdade" });
  await expect(live).toBeDisabled();
  await example.getByLabel(/Ligar antes de conferir os 3 dias úteis/).check();
  await live.click();
  await expect(toast(page, "Automação ligada")).toBeVisible();
  await expect(example).toContainText("Ligada");
  await example.getByRole("button", { name: "Desligar" }).click();
  await expect(toast(page, "Automação desligada")).toBeVisible();
  await expect(example).toContainText("Desligada");
  // Off, it no longer holds the credential.
  expect((await page.request.delete(`/api/flows/connections/${credential}`, { headers: CSRF })).status()).toBe(200);
});

test("the screen's error, and a retry", async ({ page }) => {
  await openAutomations(page);
  let fail = true;
  await page.route("**/api/crm/automations", (route) => (fail ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL", message: "Algo deu errado." }) }) : route.continue()));
  await page.reload();
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(row(page, "Pedido de avaliação")).toBeVisible();
});
