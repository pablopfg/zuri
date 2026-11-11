import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// Google Contacts (step 19b) against the real Worker. Over loopback the Worker
// answers Google itself (apps/agent/src/google/dev-google.ts) with sample
// labels and contacts; only Google's consent page is played here, as in
// google-agenda.spec.ts.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

// The account is one per installation: every test leaves it disconnected (which forgets the copy too).
test.afterEach(async ({ page }) => {
  await page.request.delete("/api/google", { headers: CSRF });
});

/** Google's consent page: approves at once and sends the owner back as Google would. */
async function routeConsent(page: Page) {
  await page.route("https://accounts.google.com/**", async (route) => {
    const asked = new URL(route.request().url());
    const back = new URL(asked.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("state", asked.searchParams.get("state") ?? "");
    back.searchParams.set("code", `dev.${asked.searchParams.get("code_challenge") ?? ""}`);
    back.searchParams.set("scope", asked.searchParams.get("scope") ?? "");
    await route.fulfill({ status: 302, headers: { location: back.href } });
  });
}

/** The calendar first, then the contacts through Google's page again. */
async function turnOn(page: Page) {
  await page.goto("/configuracoes/integracoes");
  await signIn(page);
  const card = page.getByRole("region", { name: "Google Agenda e Contatos" });
  await routeConsent(page);
  await card.getByRole("button", { name: "Conectar com o Google" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Google Agenda conectada." })).toBeVisible();
  const contacts = card.getByRole("region", { name: "Contatos" });
  await expect(contacts.getByText("Copie para a Zuri os contatos das etiquetas que você escolher")).toBeVisible();
  await contacts.getByRole("button", { name: "Ligar contatos" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Contatos ligados." })).toBeVisible();
  // The code never stays in the address or the history.
  await expect(page).toHaveURL(/\/configuracoes\/integracoes$/);
  await contacts.getByRole("button", { name: "Sincronizar agora" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Contatos sincronizados" })).toBeVisible();
  return contacts;
}

test("turns the contacts on, copies one label and searches the copy on the Contacts screen; accessible @mobile", async ({ page }) => {
  const contacts = await turnOn(page);
  // Google's own groups ("myContacts") are never offered; nothing is copied before a label is chosen.
  await expect(contacts.getByRole("checkbox")).toHaveCount(4);
  await expect(contacts.getByText("myContacts")).toHaveCount(0);
  await expect(contacts.getByText(/· nenhum contato copiado ainda$/)).toBeVisible();
  await contacts.getByRole("checkbox", { name: /^Clientes/ }).check();
  await contacts.getByRole("button", { name: "Salvar etiquetas" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Etiquetas salvas" })).toBeVisible();
  await contacts.getByRole("button", { name: "Sincronizar agora" }).click();
  await expect(contacts.getByText(/· 4 contatos$/)).toBeVisible();
  await expectAccessible(page, "integracoes-contatos");

  await contacts.getByRole("link", { name: "Abrir Contatos" }).click();
  await expect(page).toHaveURL(/\/contatos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Contatos" })).toBeVisible();
  const list = page.getByRole("region", { name: "Lista de contatos" });
  await expect(list.locator("[data-contact]")).toHaveCount(4);
  // A contact of a label left out never reaches Zuri.
  await expect(page.getByText("Conceição Alves")).toHaveCount(0);

  // By a piece of the phone, typed the way the owner writes it. The screen itself is walked in contatos.spec.ts.
  await page.getByRole("searchbox", { name: "Buscar por nome, telefone ou e-mail" }).fill("99999");
  await expect(list.locator("[data-contact]")).toHaveCount(1);
  await list.getByRole("link", { name: /Ana Souza/ }).click();
  await expect(page.getByRole("region", { name: "Contato", exact: true }).getByRole("heading", { level: 2, name: "Ana Souza" })).toBeVisible();
});

test("\"Sync now\" waits for the labels being saved, then copies the new choice (issue #264)", async ({ page }) => {
  const contacts = await turnOn(page);
  // The save is held on its way: a sync sent now would reach the server first and copy the old choice.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/google/contacts/labels", async (route) => {
    await held;
    await route.continue();
  });
  const syncs: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/google/contacts/sync")) syncs.push(request.method());
  });
  await contacts.getByRole("checkbox", { name: /^Família/ }).check();
  await contacts.getByRole("button", { name: "Salvar etiquetas" }).click();
  const sync = contacts.getByRole("button", { name: "Sincronizar agora" });
  await expect(sync).toBeDisabled();
  release();
  await expect(page.getByRole("status").filter({ hasText: "Etiquetas salvas" })).toBeVisible();
  await expect(sync).toBeEnabled();
  await sync.click();
  await expect(contacts.getByText(/· 2 contatos$/)).toBeVisible();
  expect(syncs).toEqual(["POST"]);
});

test("turning the contacts off forgets the copy and keeps the calendar", async ({ page }) => {
  const contacts = await turnOn(page);
  await contacts.getByRole("checkbox", { name: /^Família/ }).check();
  await contacts.getByRole("button", { name: "Salvar etiquetas" }).click();
  // The click waits for the button, which stays off until the labels are saved.
  await contacts.getByRole("button", { name: "Sincronizar agora" }).click();
  await expect(contacts.getByText(/· 2 contatos$/)).toBeVisible();
  await contacts.getByRole("button", { name: "Desligar contatos" }).click();
  const confirm = page.getByRole("dialog", { name: "Desligar os contatos?" });
  await confirm.getByRole("button", { name: "Desligar contatos" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Contatos desligados e cópia apagada" })).toBeVisible();
  await expect(contacts.getByRole("button", { name: "Ligar contatos" })).toBeVisible();
  await expect(page.getByText("Conectado como dono@exemplo.com.br")).toBeVisible();
  await page.goto("/contatos");
  await expect(page.getByText("Ligue os contatos do Google")).toBeVisible();
});
