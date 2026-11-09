import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, PASSWORD, signIn, tooSmallControls } from "./ui-helpers.ts";

// Settings > IA > Agentes against the real Worker (docs/planos/guardrails-especialistas-ia.md, PR 2):
// each agent's parameters and style layer, the fixed rules read only, versions and going back. pt-BR.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

async function openAgents(page: Page) {
  await page.goto("/configuracoes/ia");
  await signIn(page);
  await expect(page).toHaveURL(/\/configuracoes\/ia$/);
  const card = page.getByRole("region", { name: "Agentes" });
  await expect(card.getByRole("listitem").first()).toBeVisible();
  return card;
}

const row = (page: Page, name: string) => page.getByRole("region", { name: "Agentes" }).getByRole("listitem").filter({ has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) });

/** The newest version kept of an agent, read from the server: other runs of the suite may have saved some. */
async function newest(page: Page, id: string): Promise<number> {
  const body = (await (await page.request.get(`/api/ai/agents/${id}/versions`, { headers: CSRF })).json()) as { versions: Array<{ version: number }> };
  return body.versions[0]?.version ?? 0;
}

test.afterEach(async ({ page }) => {
  // Back to the code's defaults, for the other tests of the run.
  for (const id of ["summary", "chat"]) await page.request.post(`/api/ai/agents/${id}/restore`, { headers: CSRF, data: { default: true } });
});

test("lists every agent with its parameters, accessible and with 44 px targets @mobile", async ({ page }) => {
  const card = await openAgents(page);
  for (const name of ["Conversa", "Resumo da conversa", "Passo de IA dos fluxos", "Rascunho das avaliações", "Segunda leitura das avaliações", "Conferência das rotinas"]) {
    await expect(row(page, name)).toHaveCount(1);
  }
  await expect(row(page, "Conversa")).toContainText("Temperatura 0,4");
  await expect(row(page, "Resumo da conversa")).toContainText("Temperatura 0,2 · até 300 tokens");

  // A checker shows its rules but has no style layer to write.
  await row(page, "Conferência das rotinas").getByRole("button", { name: "Ajustar" }).click();
  const check = row(page, "Conferência das rotinas");
  await expect(check.getByRole("button", { name: "Fechar" })).toHaveAttribute("aria-expanded", "true");
  await expect(check.getByText(/Este agente só confere/)).toBeVisible();
  await expect(check.getByLabel("Estilo e tarefa")).toHaveCount(0);
  // Nor a temperature or top_p of its own: a checker answers the same way every time.
  await expect(check.getByText(/A temperatura fica em 0/)).toBeVisible();
  await expect(check.getByRole("spinbutton", { name: "Temperatura" })).toHaveCount(0);
  await expect(check.getByRole("spinbutton", { name: "Tamanho máximo da resposta, em tokens" })).toBeVisible();
  await check.getByText("Regras fixas (só leitura)").click();
  await expect(check.locator("pre")).toContainText("routine");

  // The chat's answer length lives in the limits card.
  await row(page, "Conversa").getByRole("button", { name: "Ajustar" }).click();
  await expect(row(page, "Conversa").getByText(/usa o tamanho máximo de resposta do cartão de limites/)).toBeVisible();
  await expect(row(page, "Conversa").getByLabel("Estilo e tarefa")).toHaveValue(/^Personality: you are warm/);

  await expectAccessible(page, "agentes");
  expect(await tooSmallControls(page), "every control of the agents card is a 44 px target").toEqual([]);
  await expect(card).toBeVisible();
});

test("adjusts an agent: refuses what can't be saved on the spot, saves a version and goes back", async ({ page }) => {
  await openAgents(page);
  const before = await newest(page, "summary");
  const summary = row(page, "Resumo da conversa");
  await summary.getByRole("button", { name: "Ajustar" }).click();
  const temperature = summary.getByRole("spinbutton", { name: "Temperatura" });
  const prompt = summary.getByLabel("Estilo e tarefa");
  await expect(temperature).toHaveValue("0.2");

  // Off the grid and a bracket in the layer: refused before any request.
  let sent = false;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ai/agents/summary") && r.method() === "PUT") sent = true;
  });
  await temperature.fill("0.33");
  await prompt.fill("Resuma em <tópicos>.");
  await expect(prompt).toHaveAttribute("aria-invalid", "true");
  await expect(summary.getByText("Até 2.000 caracteres, sem < nem > e sem caracteres invisíveis.")).toBeVisible();
  await summary.getByRole("button", { name: "Salvar" }).click();
  await expect(temperature).toHaveAttribute("aria-invalid", "true");
  await expect(summary.getByText("Use um valor de 0 a 1,5, em passos de 0,05.")).toBeVisible();
  expect(sent).toBe(false);

  // Fixed: saved as a new version, which the next call uses.
  await temperature.fill("0.35");
  await prompt.fill("Resuma em tópicos curtos.");
  await expect(summary.getByText("25 de 2.000 caracteres")).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/ai/agents/summary") && r.request().method() === "PUT");
  await summary.getByRole("button", { name: "Salvar" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Ajustes salvos. Valem a partir da próxima resposta." })).toBeVisible();
  await expect(summary.getByRole("heading")).toContainText(`Ajustado, versão ${before + 1}`);
  await expect(summary).toContainText("Temperatura 0,35");
  await expect(summary.getByText(new RegExp(`Marca do prompt em uso: summary\\.[0-9a-z]+\\+${before + 1}`))).toBeVisible();

  // The same again changes nothing.
  await summary.getByRole("button", { name: "Salvar" }).click();
  await expect(summary.getByText("Nada mudou.")).toBeVisible();

  // Kept after a reload.
  await page.reload();
  await row(page, "Resumo da conversa").getByRole("button", { name: "Ajustar" }).click();
  await expect(row(page, "Resumo da conversa").getByLabel("Estilo e tarefa")).toHaveValue("Resuma em tópicos curtos.");

  // Back to the default, then back to the saved version, from the list of versions.
  const card = row(page, "Resumo da conversa");
  await card.getByRole("button", { name: "Voltar ao padrão" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Voltou ao padrão." })).toBeVisible();
  await expect(card.getByRole("heading")).toContainText("Padrão");
  // Already the default: the button stays where the focus is, and going back again changes nothing.
  await expect(card.getByRole("button", { name: "Voltar ao padrão" })).toBeFocused();
  await card.getByRole("button", { name: "Voltar ao padrão" }).click();
  await expect(card.getByText("Nada mudou.")).toBeVisible();
  await expect(card.getByLabel("Estilo e tarefa")).toHaveValue(/^Keep facts, decisions/);
  await card.getByRole("button", { name: "Versões" }).click();
  await expect(card.getByText("Em uso")).toBeVisible();
  await card.getByRole("button", { name: `Voltar para esta, a versão ${before + 1}` }).click();
  await expect(page.getByRole("status").filter({ hasText: `Voltou para a versão ${before + 1}.` })).toBeVisible();
  await expect(card.getByRole("heading")).toContainText(`Ajustado, versão ${before + 3}`);
  await expect(card).toContainText("Temperatura 0,35");
  await expectAccessible(page, "agentes editor");
});

test("asks for the password again when it was typed too long ago, then saves", async ({ page }) => {
  await openAgents(page);
  let puts = 0;
  await page.route("**/api/ai/agents/summary", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    puts += 1;
    if (puts === 1) return route.fulfill({ status: 403, json: { code: "RECENT_AUTH_REQUIRED", message: "Digite a sua senha de novo para continuar." } });
    return route.continue();
  });
  const summary = row(page, "Resumo da conversa");
  await summary.getByRole("button", { name: "Ajustar" }).click();
  await summary.getByLabel("Estilo e tarefa").fill("Resuma em uma frase.");
  await summary.getByRole("button", { name: "Salvar" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirme que é você" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ajustes salvos. Valem a partir da próxima resposta." })).toBeVisible();
  expect(puts).toBe(2);
});

test("a failed list shows an error with a retry", async ({ page }) => {
  let fail = true;
  await page.route("**/api/ai/agents", async (route) => {
    if (fail) return route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE", message: "Serviço indisponível. Tente de novo em instantes." } });
    return route.continue();
  });
  await page.goto("/configuracoes/ia");
  await signIn(page);
  const card = page.getByRole("region", { name: "Agentes" });
  await expect(card.getByText("Serviço indisponível. Tente de novo em instantes.")).toBeVisible();
  fail = false;
  await card.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(row(page, "Conversa")).toHaveCount(1);
});
