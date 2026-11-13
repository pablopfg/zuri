import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, settingsTitle, signIn, tooSmallControls } from "./ui-helpers.ts";

// PR S21: Settings › Modelos e limites › Catálogo de modelos, against the real
// Worker. Local development reads a fixed catalog (src/ai/dev-catalog.ts): a new
// model fit for the chat, one without tools (never offered) and Llama 3.3 70B
// leaving in 60 days.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const GEMMA = "@cf/google/gemma-3-12b-it";

async function openModels(page: Page) {
  await page.goto("/configuracoes/modelos");
  await signIn(page);
  await expect(settingsTitle(page, "Modelos e limites")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
}

test("Conferir agora shows the new model and the leaving one; Pôr na lista adds it to both choices", async ({ page }) => {
  await openModels(page);
  const card = page.getByRole("region", { name: "Catálogo de modelos" });
  await expect(card).toBeVisible();
  const model = page.getByLabel("Modelo de conversa");
  // Before the owner's tap, the new model is not among the choices.
  await expect(model.locator(`option[value="${GEMMA}"]`)).toHaveCount(0);

  const checked = page.waitForResponse((r) => r.url().endsWith("/api/ai/catalog/check"));
  await card.getByRole("button", { name: "Conferir agora" }).click();
  expect((await checked).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Catálogo conferido" })).toBeVisible();
  await expect(card.getByText(/Última conferência: \d{2}\/\d{2}\/\d{4}, às \d{2}:\d{2}\./)).toBeVisible();

  const fresh = card.getByRole("listitem").filter({ hasText: "gemma-3-12b-it" });
  await expect(fresh.getByText("Novo", { exact: true })).toBeVisible();
  await expect(fresh).toContainText("contexto de 80 mil tokens");
  const leaving = card.getByRole("listitem").filter({ hasText: "Llama 3.3 70B" });
  await expect(leaving.getByText("Vai sair", { exact: true })).toBeVisible();
  await expect(leaving).toContainText(/sai do catálogo em \d{2}\/\d{2}\/\d{4}/);
  // The model without tools is never offered.
  await expect(card.getByText("sem-ferramentas")).toHaveCount(0);
  await expectAccessible(page, "catálogo de modelos");

  await fresh.getByRole("button", { name: "Pôr na lista" }).click();
  await expect(page.getByRole("status").filter({ hasText: "gemma-3-12b-it entrou na lista" })).toBeVisible();
  await expect(card.getByRole("listitem").filter({ hasText: "gemma-3-12b-it" })).toHaveCount(0);
  await expect(model.locator(`option[value="${GEMMA}"]`)).toHaveText("gemma-3-12b-it");
  await expect(page.getByLabel("Modelo reserva").locator(`option[value="${GEMMA}"]`)).toHaveCount(1);

  // Chosen and saved, the next answers come from it; the hint prices it with the catalog's numbers.
  await model.selectOption(GEMMA);
  await expect(page.getByText(/Cerca de \d[\d.]* Neurons por resposta típica/)).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Salvar limites" }).click();
  expect((await saved).status()).toBe(200);
  const report = await (await page.request.get("/api/usage", { headers: CSRF })).json();
  expect(report).toMatchObject({ model: GEMMA });

  // Twice within a minute, the server asks to wait and the card says so.
  await card.getByRole("button", { name: "Conferir agora" }).click();
  await expect(card.getByRole("alert")).toContainText("acabou de ser conferido");

  // Back to the default, for the other tests of the run.
  const reset = await page.request.patch("/api/settings", { headers: CSRF, data: { aiModel: "@cf/zai-org/glm-4.7-flash" } });
  expect(reset.status()).toBe(200);
});

test("the catalog box fits a phone, with 44 px targets @mobile", async ({ page }) => {
  await openModels(page);
  const card = page.getByRole("region", { name: "Catálogo de modelos" });
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText(/Conferido sozinho uma vez por dia/)).toBeVisible();
  expect(await tooSmallControls(page)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
