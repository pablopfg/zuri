import type { Route } from "@playwright/test";
import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, settingsTitle, signIn, tooSmallControls } from "./ui-helpers.ts";

// Settings > IA against the real Worker (step 8): today's usage with the
// simulated AI of local development, and the model and limits form. pt-BR.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/** Settings › Uso da IA ("ia") or › Modelos e limites ("modelos"): the old AI tab, split in two in stage 26c. */
async function openAiTab(page: Page, tab: "ia" | "modelos" = "ia") {
  await page.goto(`/configuracoes/${tab}`);
  await signIn(page);
  await expect(page).toHaveURL(new RegExp(`/configuracoes/${tab}$`));
  await expect(settingsTitle(page, tab === "ia" ? "Uso da IA" : "Modelos e limites")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
}

test("the AI tab shows today's usage with the simulated AI, accessible and with 44 px targets @mobile", async ({ page }) => {
  await openAiTab(page);
  const usage = page.getByRole("region", { name: "Uso de hoje" });
  await expect(usage.getByText("Provedor: IA simulada")).toBeVisible();
  await expect(usage.getByText(/vêm de um simulador, que não gasta Neurons/)).toBeVisible();
  // São Paulo is UTC−3: the counters start over at 21:00 there.
  await expect(usage.getByText(/recomeçam às 21:00/)).toBeVisible();
  await expect(usage.getByRole("meter", { name: "Neurons" })).toHaveAttribute("max", "9000");
  // The chat specs share the database and use the simulated AI too, so the
  // count today is whatever the server reports, never assumed to be zero.
  const report = (await (await page.request.get("/api/usage", { headers: CSRF })).json()) as { today: { requests: number } };
  const requests = report.today.requests;
  await expect(usage.getByRole("meter", { name: "Pedidos à IA" })).toHaveAttribute("value", String(requests));
  await expect(usage.getByRole("meter", { name: "Pedidos à IA" })).toHaveAttribute(
    "aria-valuetext",
    `${requests} de 200 · ${Math.round((requests / 200) * 100)}% usado`,
  );
  await expect(usage.getByRole("meter", { name: "Áudio transcrito" })).toHaveAttribute("max", "60");
  await expect(usage.getByText("Nenhuma chamada à IA hoje.")).toHaveCount(requests === 0 ? 1 : 0);
  await expect(usage.getByRole("link", { name: "Tabela de preços do Workers AI" })).toHaveAttribute(
    "href",
    "https://developers.cloudflare.com/workers-ai/platform/pricing/",
  );
  await expect(usage.getByText(/conferidos em 31\/10\/2026/)).toBeVisible();
  await expect(usage.getByRole("list").getByRole("listitem")).toHaveCount(7);
  await expectAccessible(page, "ia");
  expect(await tooSmallControls(page), "every control of the AI tab is a 44 px target").toEqual([]);
});

test("the model and the limits: out-of-range values are refused on the spot, the rest is saved and kept", async ({ page }) => {
  await openAiTab(page, "modelos");
  const form = page.getByRole("region", { name: "Modelo e limites" });
  // The model comes first; the nine limits and the dollar cap wait folded under "Limites avançados".
  const advanced = form.getByText("Limites avançados", { exact: true });
  await expect(form.getByLabel("Pedidos por dia")).toBeHidden();
  await advanced.click();
  const requests = form.getByLabel("Pedidos por dia");
  const neurons = form.getByLabel("Teto de Neurons por dia");
  const output = form.getByLabel("Tamanho máximo da resposta (tokens)");
  await expect(requests).toHaveValue("200");
  await expect(neurons).toHaveValue("9000");
  await expect(output).toHaveValue("1024");
  await expect(form.getByLabel("Modelo de conversa")).toHaveValue("@cf/zai-org/glm-4.7-flash");
  // The fallback: on by default, a different model, never the chosen one again.
  const fallback = form.getByLabel("Modelo reserva");
  await expect(fallback).toHaveValue("@cf/qwen/qwen3-30b-a3b-fp8");
  await expect(fallback.locator("option")).toHaveText(["Nenhum (só o modelo de conversa)", "Qwen3 30B A3B", "Llama 4 Scout 17B", "Llama 3.3 70B", "Claude Haiku 5.5 · US$\u00a00,10 / US$\u00a00,50 por milhão de tokens", "Claude Sonnet 5.5 · US$\u00a02,00 / US$\u00a010,00 por milhão de tokens", "GPT-6 Luna · US$\u00a00,10 / US$\u00a00,50 por milhão de tokens", "GPT-6.1 Terra · US$\u00a01,00 / US$\u00a05,00 por milhão de tokens"]);
  await expect(form.getByText(/Responde no lugar do modelo de conversa quando ele está ocupado/)).toBeVisible();
  await expect(form.getByText(/Cerca de 48 Neurons por resposta típica; 189 respostas/)).toBeVisible();

  // Nothing changed yet.
  await form.getByRole("button", { name: "Salvar limites" }).click();
  await expect(form.getByText("Nada mudou.")).toBeVisible();

  // One over the cap's range, and zero requests: both refused before any request.
  await neurons.fill("9001");
  await requests.fill("0");
  await expect(neurons).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByText("Use um número inteiro de 1.000 a 9.000.")).toBeVisible();
  await expect(form.getByText("Use um número inteiro de 1 a 2.000.")).toBeVisible();
  // Folded again, a refused save unfolds the limits so the mistake shows.
  await advanced.click();
  await expect(requests).toBeHidden();
  let patched = false;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/settings") && r.method() === "PATCH") patched = true;
  });
  await form.getByRole("button", { name: "Salvar limites" }).click();
  expect(patched).toBe(false);
  await expect(requests).toBeVisible();

  // Exactly on the edges: accepted.
  await neurons.fill("1000");
  await requests.fill("2000");
  await output.fill("256");
  await form.getByLabel("Modelo de conversa").selectOption({ label: "Qwen3 30B A3B" });
  await expect(form.getByText(/Cerca de 40 Neurons por resposta típica; 25 respostas/)).toBeVisible();
  // The fallback was the newly chosen model: it falls back to none, and that model leaves its list.
  await expect(fallback).toHaveValue("none");
  await expect(fallback.locator("option")).toHaveText(["Nenhum (só o modelo de conversa)", "GLM 4.7 Flash", "Llama 4 Scout 17B", "Llama 3.3 70B", "Claude Haiku 5.5 · US$\u00a00,10 / US$\u00a00,50 por milhão de tokens", "Claude Sonnet 5.5 · US$\u00a02,00 / US$\u00a010,00 por milhão de tokens", "GPT-6 Luna · US$\u00a00,10 / US$\u00a00,50 por milhão de tokens", "GPT-6.1 Terra · US$\u00a01,00 / US$\u00a05,00 por milhão de tokens"]);
  await fallback.selectOption({ label: "Llama 4 Scout 17B" });
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "PATCH");
  await form.getByRole("button", { name: "Salvar limites" }).click();
  expect((await saved).status()).toBe(200);
  // The confirmation is a toast, at the foot of the screen.
  await expect(page.getByRole("status").filter({ hasText: "Limites salvos" })).toBeVisible();
  // The usage moved to its own section, with the new limits.
  await page.goto("/configuracoes/ia");
  const usage = page.getByRole("region", { name: "Uso de hoje" });
  await expect(usage.getByText("0 de 1.000", { exact: true })).toBeVisible();
  await expect(usage.getByText("0 de 2.000", { exact: true })).toBeVisible();

  await page.goto("/configuracoes/modelos");
  await advanced.click();
  await expect(neurons).toHaveValue("1000");
  await expect(form.getByLabel("Modelo de conversa")).toHaveValue("@cf/qwen/qwen3-30b-a3b-fp8");
  await expect(fallback).toHaveValue("@cf/meta/llama-4-scout-17b-16e-instruct");

  // The server holds the same line as the form.
  const unknown = await page.request.patch("/api/settings", { headers: CSRF, data: { aiFallbackModel: "@cf/openai/gpt-pago" } });
  expect(unknown.status()).toBe(400);
  const refused = await page.request.patch("/api/settings", { headers: CSRF, data: { aiNeuronsPerDay: 9_001 } });
  expect(refused.status()).toBe(400);
  const report = await (await page.request.get("/api/usage", { headers: CSRF })).json();
  expect(report).toMatchObject({ provider: "mock", model: "@cf/qwen/qwen3-30b-a3b-fp8", limits: { neuronsPerDay: 1_000, requestsPerDay: 2_000 } });

  // Back to the defaults, for the other tests of the run.
  const reset = await page.request.patch("/api/settings", {
    headers: CSRF,
    data: {
      aiModel: "@cf/zai-org/glm-4.7-flash",
      aiFallbackModel: "@cf/qwen/qwen3-30b-a3b-fp8",
      aiRequestsPerDay: 200,
      aiNeuronsPerDay: 9_000,
      aiMaxOutputTokens: 1_024,
    },
  });
  expect(reset.status()).toBe(200);
});

test("the usage card warns near and at the limit, and a failed report shows an error with a retry", async ({ page }) => {
  // The report as the server would send it on a busy day of Workers AI, with no real calls made.
  let mode: "near" | "at" | "fail" = "near";
  const report = (requests: number, neurons: number) => ({
    day: "2026-10-31",
    resetsAt: "2026-11-01T00:00:00.000Z",
    provider: "workers-ai",
    model: "@cf/zai-org/glm-4.7-flash",
    today: {
      requests,
      errors: 2,
      aborted: 1,
      neurons,
      costUsd: (neurons * 0.011) / 1_000,
      paidUsd: 0,
      fallbacks: 3,
      audioSeconds: 90,
      models: [
        { model: "@cf/zai-org/glm-4.7-flash", kind: "chat", billable: true, calls: requests, inputTokens: 900_000, outputTokens: 40_000, estimatedTokens: 0, audioSeconds: 0, neurons, costUsd: (neurons * 0.011) / 1_000 },
      ],
    },
    limits: { requestsPerDay: 200, neuronsPerDay: 9_000, audioSecondsPerDay: 3_600, maxOutputTokens: 1_024, usdCentsPerDay: 0 },
    lastDays: [{ day: "2026-10-31", requests, neurons }],
    providers: [
      { id: "anthropic", configured: true, state: "no_credit" },
      { id: "openai", configured: false, state: "ok" },
    ],
    pricing: { asOf: "2026-10-31", sourceUrl: "https://developers.cloudflare.com/workers-ai/platform/pricing/", usdPer1000Neurons: 0.011, freeNeuronsPerDay: 10_000 },
  });
  await page.route("**/api/usage", (route) =>
    mode === "fail"
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "SERVICE_UNAVAILABLE", message: "Serviço indisponível." }) })
      : route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(mode === "near" ? report(170, 6_000) : report(200, 7_400)) }),
  );
  await openAiTab(page);
  const usage = page.getByRole("region", { name: "Uso de hoje" });
  await expect(usage.getByText("Provedor: Workers AI")).toBeVisible();
  await expect(usage.getByText(/Perto do limite/)).toBeVisible();
  await expect(usage.getByText(/Limite do dia atingido/)).toHaveCount(0);
  await expect(usage.getByRole("meter", { name: "Pedidos à IA" })).toHaveAttribute("aria-valuetext", "170 de 200 · 85% usado");
  await expect(usage.getByText("2 com erro · 1 interrompidas")).toBeVisible();
  await expect(usage.getByText("US$\u00a00,00 hoje, sem teto de gastos")).toBeVisible();
  // The paid companies, in Modelos e limites: one out of credit, one with no key.
  await page.goto("/configuracoes/modelos");
  const companies = page.getByRole("region", { name: "Modelos pagos" });
  await expect(companies.getByRole("listitem").filter({ hasText: "Anthropic" }).getByText("Sem crédito")).toBeVisible();
  await expect(companies.getByRole("listitem").filter({ hasText: "OpenAI" }).getByText("Sem chave")).toBeVisible();
  await expect(companies.getByRole("button", { name: "Já recarreguei" })).toBeVisible();

  mode = "at";
  await page.goto("/configuracoes/ia");
  await expect(usage.getByText("Limite do dia atingido. A IA volta às 21:00.")).toBeVisible();
  await expect(usage.getByText(/Perto do limite/)).toHaveCount(0);
  await expectAccessible(page, "ia-no-limite");

  mode = "fail";
  await page.reload();
  const retry = usage.getByRole("button", { name: "Tentar de novo" });
  await expect(retry).toBeVisible({ timeout: 15_000 });
  mode = "near";
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(usage.getByText(/Perto do limite/)).toBeVisible();
});

test("a paid model: the warning on what leaves comes before the save, and the spending shows up today and by period @mobile", async ({ page }) => {
  await openAiTab(page, "modelos");
  const form = page.getByRole("region", { name: "Modelo e limites" });
  const model = form.getByLabel("Modelo de conversa");
  // Local development has no keys and needs none: the paid models are simulated (src/ai/index.ts).
  await model.selectOption({ label: "Claude Haiku 5.5 · US$\u00a00,10 / US$\u00a00,50 por milhão de tokens" });
  await expect(form.getByText("Cerca de US$\u00a00,0008 por resposta comum, cobrados pela Anthropic na sua conta de lá.")).toBeVisible();

  let patched = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/settings") && r.method() === "PATCH") patched += 1;
  });
  await form.getByRole("button", { name: "Salvar limites" }).click();
  const warning = page.getByRole("dialog", { name: "Usar um modelo pago?" });
  await expect(warning).toBeVisible();
  await expect(warning.getByText(/Fica na sua conta: o que estiver marcado como “Nunca enviar para fora”/)).toBeVisible();
  await expect(warning.getByText(/guarda os dados por até 30 dias/)).toBeVisible();
  await expect(warning.getByRole("link", { name: "Ler as regras da Anthropic" })).toHaveAttribute("target", "_blank");
  await expectAccessible(page, "ia-aviso-modelo-pago");
  // Going back saves nothing.
  await warning.getByRole("button", { name: "Voltar" }).click();
  await expect(warning).toBeHidden();
  expect(patched).toBe(0);

  await form.getByRole("button", { name: "Salvar limites" }).click();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "PATCH");
  await page.getByRole("dialog", { name: "Usar um modelo pago?" }).getByRole("button", { name: "Usar o modelo pago" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Limites salvos" })).toBeVisible();

  // The ceiling: off by default, a value of the owner's, refused past the top.
  await form.getByText("Limites avançados", { exact: true }).click();
  const cap = form.getByLabel("Teto de gastos por dia (US$)");
  await expect(cap).toHaveValue("0");
  await cap.fill("2,555");
  await expect(form.getByText("Use um valor de 0 a 10.000, com até 2 casas depois da vírgula.")).toBeVisible();
  await cap.fill("2,5");
  const capSaved = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "PATCH");
  await form.getByRole("button", { name: "Salvar limites" }).click();
  expect((await capSaved).status()).toBe(200);
  await page.goto("/configuracoes/ia");
  const usage = page.getByRole("region", { name: "Uso de hoje" });
  await expect(usage.getByRole("meter", { name: "Modelos pagos hoje" })).toHaveAttribute("max", "2.5");

  // One answer on the paid model: today and the period both show what it cost.
  const chat = await page.request.post("/api/chat", { headers: CSRF, data: { message: "Oi, Zuri" } });
  expect(chat.status()).toBe(200);
  await page.reload();
  await expect(usage.getByRole("meter", { name: "Modelos pagos hoje" })).not.toHaveAttribute("value", "0");
  const panel = page.getByRole("region", { name: "Consumo por período" });
  await expect(panel.getByRole("figure", { name: "Gasto por dia com modelos pagos" }).getByText("Claude Haiku 5.5")).toBeVisible();
  await expect(panel.getByRole("table").last().getByRole("rowheader").filter({ hasText: "Claude Haiku 5.5" })).toBeVisible();
  await panel.getByRole("button", { name: "Mês" }).click();
  await expect(panel.getByRole("button", { name: "Mês" })).toHaveAttribute("aria-pressed", "true");
  // The numbers behind the bars, a row per day with use.
  await panel.getByText("Ver os números de cada dia").click();
  await expect(panel.getByRole("table").first().getByRole("row")).not.toHaveCount(1);
  // Dia: today by the hour, in the owner's time zone (São Paulo: the counters' day starts at 21:00).
  await panel.getByRole("button", { name: "Dia" }).click();
  await expect(panel.getByRole("figure", { name: "Neurons por hora" })).toBeVisible();
  await expect(panel.getByText("No seu fuso, a contagem do dia recomeça às 21:00.")).toBeVisible();
  await panel.getByText("Ver os números de cada hora").click();
  await expect(panel.getByRole("table").first().getByRole("row")).not.toHaveCount(1);
  // Ano: by the month, with the models of the last 90 days, said so.
  await panel.getByRole("button", { name: "Ano" }).click();
  await expect(panel.getByRole("figure", { name: "Neurons por mês" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Modelos mais usados nos últimos 90 dias" })).toBeVisible();
  await expect(panel.getByRole("table").last().getByRole("rowheader").filter({ hasText: "Claude Haiku 5.5" })).toBeVisible();
  await expectAccessible(page, "ia-consumo-pago");
  expect(await tooSmallControls(page), "every control of the AI tab is a 44 px target").toEqual([]);

  const reset = await page.request.patch("/api/settings", { headers: CSRF, data: { aiModel: "@cf/zai-org/glm-4.7-flash", aiUsdCentsPerDay: 0 } });
  expect(reset.status()).toBe(200);
});

test("the usage panel follows a new answer while it is open, without a reload", async ({ page }) => {
  await openAiTab(page);
  // At least one answer today, so the panel has its numbers (not the empty state).
  expect((await page.request.post("/api/chat", { headers: CSRF, data: { message: "Oi" } })).status()).toBe(200);
  await page.reload();
  const panel = page.getByRole("region", { name: "Consumo por período" });
  const requests = panel.getByText("Pedidos à IA", { exact: true }).locator("..").getByRole("definition").first();
  await expect(requests).toHaveText(/^\d[\d.]*$/);
  const before = Number((await requests.textContent())?.replace(/\D/g, ""));
  await page.evaluate(() => Object.assign(window, { __zuriMark: 1 }));
  const chat = await page.request.post("/api/chat", { headers: CSRF, data: { message: "Oi de novo" } });
  expect(chat.status()).toBe(200);
  await expect.poll(async () => Number((await requests.textContent())?.replace(/\D/g, "")), { timeout: 10_000 }).toBeGreaterThan(before);
  expect(await page.evaluate(() => (window as unknown as { __zuriMark?: number }).__zuriMark)).toBe(1);
});

test.describe("on a device in another time zone", () => {
  // The device in Tokyo, the owner in São Paulo: Dia follows the owner's zone, never the device's.
  test.use({ timezoneId: "Asia/Tokyo" });

  test("Dia counts the hours in the owner's time zone, not the device's", async ({ page }) => {
    await openAiTab(page);
    // One answer today, so the panel has its numbers.
    expect((await page.request.post("/api/chat", { headers: CSRF, data: { message: "Oi, Zuri" } })).status()).toBe(200);
    await page.reload();
    const panel = page.getByRole("region", { name: "Consumo por período" });
    await panel.getByRole("button", { name: "Dia" }).click();
    // In Tokyo the counters' day would start at 09:00; in São Paulo it starts at 21:00.
    await expect(panel.getByText("No seu fuso, a contagem do dia recomeça às 21:00.")).toBeVisible();
  });
});

test("Dia and Ano say when their numbers don't come, with a way to try again", async ({ page }) => {
  await openAiTab(page);
  expect((await page.request.post("/api/chat", { headers: CSRF, data: { message: "Oi, Zuri" } })).status()).toBe(200);
  await page.reload();
  const fail = (route: Route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL_ERROR", message: "Algo deu errado." }) });
  await page.route("**/api/usage/hours", fail);
  await page.route("**/api/usage/history?days=90", fail);
  const panel = page.getByRole("region", { name: "Consumo por período" });
  await panel.getByRole("button", { name: "Dia" }).click();
  // The query may retry on its own first.
  await expect(panel.getByRole("alert").filter({ hasText: "Algo deu errado." })).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  // Ano: the months come, the models of the last 90 days don't, and the panel says so.
  await panel.getByRole("button", { name: "Ano" }).click();
  await expect(panel.getByRole("figure", { name: "Neurons por mês" })).toBeVisible();
  await expect(panel.getByRole("alert").filter({ hasText: "Algo deu errado." })).toBeVisible({ timeout: 15_000 });
  await page.unroute("**/api/usage/history?days=90");
  await panel.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(panel.getByRole("heading", { name: "Modelos mais usados nos últimos 90 dias" })).toBeVisible();
});
