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
  await page.request.patch("/api/settings", { headers: CSRF, data: { clinic: EMPTY, confirmMessage: "" } });
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
  // QA-E7c3a-10: the automation's line loads on its own; its "Mudar" is measured too.
  await expect(section(page).getByRole("link", { name: "Mudar a confirmação automática em CRM › Automações" })).toBeVisible();
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
  await expect(page.getByText("Automatic, through Chatwoot")).toBeVisible();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
});

// E7c1 (plano link-de-confirmacao.md, seção 16): the confirmation message, its variables and its preview.
test("@mobile the confirmation message starts at the default, takes a variable at the cursor, previews in bold and saves", async ({ page }) => {
  await open(page);
  expect((await page.request.patch("/api/settings", { headers: CSRF, data: { clinic: { name: "Consultório Exemplo", whatsapp: "4133330000", address: "Rua das Flores, 120", city: "Curitiba, PR" } } })).status()).toBe(200);
  await page.reload();
  const box = section(page);
  const text = box.getByLabel("Mensagem", { exact: true });
  await expect(text).toHaveValue(/^Olá, \{nome\}! Sua \*\{tipo\}\* no \*\{consultorio\}\*/);
  const preview = box.getByText(/^Olá, Érica! Sua consulta no Consultório Exemplo está marcada para quinta-feira, 19 de novembro, às 14:00\./);
  await expect(preview).toBeVisible();
  // *texto* is bold, as WhatsApp shows it.
  await expect(preview.locator("b").first()).toHaveText("consulta");
  await expect(preview).toContainText("Endereço: Rua das Flores, 120, Curitiba, PR.");
  await expect(preview).toContainText("(41) 3333-0000");
  const save = box.getByRole("button", { name: "Salvar a mensagem" });
  await expect(save).toBeDisabled();
  await expect(box.getByRole("button", { name: "Voltar ao modelo padrão" })).toBeDisabled();
  await expectAccessible(page, "consultorio-mensagem");
  expect(await tooSmallControls(page)).toEqual([]);

  // A variable goes where the cursor is.
  await text.fill("Oi  ");
  await text.press("End");
  await text.press("ArrowLeft");
  await box.getByRole("group", { name: "Variáveis" }).getByRole("button", { name: "{nome}" }).click();
  await expect(text).toHaveValue("Oi {nome} ");
  await expect(text).toBeFocused();
  // No {link}: said before sending, and nothing goes.
  let patches = 0;
  page.on("request", (request) => request.url().endsWith("/api/settings") && request.method() === "PATCH" && patches++);
  await save.click();
  await expect(box.getByText("A mensagem precisa ter {link}, senão o paciente não tem como confirmar.")).toBeVisible();
  await text.fill("Oi {nome}, {data}: {link}");
  await save.click();
  await expect(box.getByText("Não conheço {data}. Use só as variáveis da lista.")).toBeVisible();
  expect(patches).toBe(0);
  await text.fill("Oi {nome}: {link} <img src=x onerror=alert(1)>");
  await expect(box.getByText(/^Oi Érica: http.*\/c\/AbCdEfGhIjKlMnOpQrStUv <img src=x onerror=alert\(1\)>$/)).toBeVisible();
  await expect(box.locator("img")).toHaveCount(0);
  await expect(box.getByText("46 de 1000")).toBeVisible();
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/settings") && request.method() === "PATCH");
  await save.click();
  expect((await sent).postDataJSON()).toEqual({ confirmMessage: "Oi {nome}: {link} <img src=x onerror=alert(1)>" });
  await expect(page.getByRole("status").getByText("Mensagem salva")).toBeVisible();
  await page.reload();
  await expect(section(page).getByLabel("Mensagem", { exact: true })).toHaveValue("Oi {nome}: {link} <img src=x onerror=alert(1)>");
  // Back to the default: kept as "", so a new version of the default follows.
  await section(page).getByRole("button", { name: "Voltar ao modelo padrão" }).click();
  const reset = page.waitForRequest((request) => request.url().endsWith("/api/settings") && request.method() === "PATCH");
  await section(page).getByRole("button", { name: "Salvar a mensagem" }).click();
  expect((await reset).postDataJSON()).toEqual({ confirmMessage: "" });
  await expect(section(page).getByText("Sempre disponível")).toBeVisible();
});

// E7c3a (plano link-de-confirmacao.md, seção 18): the automatic confirmation is turned on in CRM › Automações; here it only shows.
test("the automatic confirmation shows its state and Mudar opens CRM › Automações", async ({ page }) => {
  await open(page);
  const send = section(page).getByRole("region", { name: "Como a confirmação sai" });
  await expect(send.getByText("Automático, pelo Chatwoot")).toBeVisible();
  await expect(send.getByText("Desligado", { exact: true })).toBeVisible();
  // Each state as CRM › Automações has it; a live one says its hour.
  let state = "rehearsal";
  await page.route("**/api/crm/automations", async (route) => {
    const list = (await (await route.fetch()).json()) as { automations: { id: string; state: string; options: Record<string, unknown> }[] };
    for (const item of list.automations) if (item.id === "appointment-confirmation") Object.assign(item, { state, options: { hour: "08:30" } });
    return route.fulfill({ json: list });
  });
  for (const [next, text] of [
    ["rehearsal", "Em ensaio"],
    ["paused", "Pausado"],
    ["live", "Ligado, às 08:30"],
  ] as const) {
    state = next;
    await page.reload();
    await expect(send.getByText(text, { exact: true })).toBeVisible();
  }
  await send.getByRole("link", { name: "Mudar a confirmação automática em CRM › Automações" }).click();
  await expect(page).toHaveURL(/\/crm$/);
});

