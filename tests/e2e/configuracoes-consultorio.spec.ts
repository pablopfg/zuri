import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, openSettingsSection, settingsTitle, signIn, tooSmallControls } from "./ui-helpers.ts";

// Configurações › Consultório (E6a, docs/planos/consultorio-dados.md, protótipo v52): the office's
// details in one place, and the office hours as a line that leads to Configurações › Agenda.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const EMPTY = { name: "", whatsapp: "", address: "", city: "" };

async function open(page: Page) {
  await page.goto("/configuracoes/consultorio");
  await signIn(page);
  await expect(settingsTitle(page, "Consultório").getByRole("heading", { name: "Dados do consultório" })).toBeVisible();
}

const section = (page: Page) => settingsTitle(page, "Consultório");

test.afterEach(async ({ page }) => {
  await page.request.patch("/api/settings", { headers: CSRF, data: { clinic: EMPTY } });
});

test("the office's details save, come back after a reload and go to the server as digits", async ({ page }) => {
  await open(page);
  const box = section(page);
  const save = box.getByRole("button", { name: "Salvar os dados" });
  // Nothing changed yet: nothing to save.
  await expect(save).toBeDisabled();
  // QA-E6a-07: spaces inside are tidied as the server does, and the field shows what was stored.
  await box.getByLabel("Nome do consultório").fill("Consultório   Exemplo");
  await box.getByLabel("WhatsApp da equipe").pressSequentially("41933330000");
  await expect(box.getByLabel("WhatsApp da equipe")).toHaveValue("(41) 93333-0000");
  await box.getByLabel("Endereço").fill("Rua das Flores, 120, sala 304 · Centro");
  await box.getByLabel("Cidade e estado").fill("Curitiba, PR");
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/settings") && request.method() === "PATCH");
  await save.click();
  expect((await sent).postDataJSON()).toEqual({ clinic: { name: "Consultório Exemplo", whatsapp: "41933330000", address: "Rua das Flores, 120, sala 304 · Centro", city: "Curitiba, PR" } });
  await expect(page.getByRole("status").getByText("Dados salvos")).toBeVisible();
  await expect(box.getByLabel("Nome do consultório")).toHaveValue("Consultório Exemplo");
  await expect(save).toBeDisabled();

  await page.reload();
  await expect(section(page).getByLabel("WhatsApp da equipe")).toHaveValue("(41) 93333-0000");
  await expect(section(page).getByLabel("Endereço")).toHaveValue("Rua das Flores, 120, sala 304 · Centro");
  await expectAccessible(page, "configuracoes-consultorio");
});

test("a WhatsApp too short says how it should be and keeps the focus on it; a tag is refused by the server and shown as text", async ({ page }) => {
  await open(page);
  const box = section(page);
  const phone = box.getByLabel("WhatsApp da equipe");
  await phone.pressSequentially("41333");
  await box.getByRole("button", { name: "Salvar os dados" }).click();
  await expect(box.getByText("Confira o WhatsApp da equipe: DDD e número, por exemplo (41) 3333-0000.")).toBeVisible();
  await expect(phone).toBeFocused();
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(phone).toHaveAccessibleDescription("Confira o WhatsApp da equipe: DDD e número, por exemplo (41) 3333-0000.");
  // Typing again clears the message.
  await phone.pressSequentially("30000");
  await expect(box.getByText(/Confira o WhatsApp/)).toHaveCount(0);

  await box.getByLabel("Nome do consultório").fill("<img src=x onerror=alert(1)>");
  const answer = page.waitForResponse((response) => response.url().endsWith("/api/settings") && response.request().method() === "PATCH");
  await box.getByRole("button", { name: "Salvar os dados" }).click();
  expect((await answer).status()).toBe(400);
  await expect(box.getByRole("alert")).toBeVisible();
  await expect(box.locator("img")).toHaveCount(0);
  // Nothing was stored.
  await page.reload();
  await expect(section(page).getByLabel("Nome do consultório")).toHaveValue("");
});

test("the office hours are a line from Configurações › Agenda, and Mudar opens it", async ({ page }) => {
  await open(page);
  const box = section(page);
  await expect(box.getByText("Segunda a sexta, das 08:00 às 18:00, almoço das 12:00 às 14:00. Ele fica num lugar só, em Configurações › Agenda.")).toBeVisible();
  // No field of hours here (rule "Um ajuste, um lugar").
  await expect(box.getByLabel(/Início|Começo|Fim do expediente/)).toHaveCount(0);
  await box.getByRole("link", { name: "Mudar o horário de atendimento" }).click();
  await expect(page).toHaveURL(/\/configuracoes\/agenda$/);
  await expect(settingsTitle(page, "Agenda")).toBeVisible();
});

test("the section is in the Consultório group of the menu, a reading that fails asks again, and a save that fails says so", async ({ page }) => {
  await page.goto("/configuracoes/conta");
  await signIn(page);
  await openSettingsSection(page, "Consultório");
  await expect(page).toHaveURL(/\/configuracoes\/consultorio$/);
  const menu = page.getByRole("navigation", { name: "Seções das configurações" });
  await expect(menu.getByRole("heading", { name: "Consultório" })).toBeVisible();

  // A reading that fails says so and asks again.
  let fail = true;
  await page.route("**/api/settings", (route) => (fail && route.request().method() === "GET" ? route.fulfill({ status: 500, json: { code: "INTERNAL_ERROR", message: "Falhou." } }) : route.fallback()));
  await page.reload();
  await expect(section(page).getByRole("alert")).toBeVisible();
  fail = false;
  await section(page).getByRole("button", { name: "Tentar de novo" }).click();
  await expect(section(page).getByRole("heading", { name: "Dados do consultório" })).toBeVisible();

  // A save that fails says so and keeps what was typed.
  await page.route("**/api/settings", (route) => (route.request().method() === "PATCH" ? route.fulfill({ status: 500, json: { code: "INTERNAL_ERROR", message: "Não deu para salvar. Tente de novo." } }) : route.fallback()));
  await section(page).getByLabel("Nome do consultório").fill("Consultório Exemplo");
  await section(page).getByRole("button", { name: "Salvar os dados" }).click();
  await expect(section(page).getByRole("alert")).toHaveText("Não deu para salvar. Tente de novo.");
  await expect(section(page).getByLabel("Nome do consultório")).toHaveValue("Consultório Exemplo");
});

test("on a phone the section opens from the list and every control is a 44 px target @mobile", async ({ page }) => {
  await page.goto("/configuracoes/conta");
  await signIn(page);
  await openSettingsSection(page, "Consultório");
  await expect(section(page).getByRole("heading", { name: "Dados do consultório" })).toBeVisible();
  expect(await tooSmallControls(page), "every control of the section is a 44 px target").toEqual([]);
  await expectAccessible(page, "configuracoes-consultorio-celular");
});

test("in English, the section follows the language", async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...((await response.json()) as object), language: "en" } });
  });
  await page.goto("/configuracoes/consultorio");
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Office details" })).toBeVisible();
  await expect(page.getByText("Monday to Friday, 08:00 to 18:00, lunch 12:00 to 14:00. They live in one place, Settings › Calendar.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Change office hours" })).toBeVisible();
});
