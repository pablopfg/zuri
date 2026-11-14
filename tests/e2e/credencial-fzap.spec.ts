import { expect, type Page, test } from "./fixtures.ts";
import { expectAccessible, PASSWORD, rowAction, signIn, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// CRM › Credenciais › fzap (E6b, docs/planos/credencial-fzap.md, protótipo v52): the instance's address and
// token, "Testar" reading the session's state, and a new address asking for the token again. Over loopback the
// Worker answers the example instances itself (apps/agent/src/flows/dev-flows.ts). pt-BR.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const tag = () => uniqueTag(test.info().project.name);
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const credentials = (page: Page) => page.getByRole("list", { name: "Credenciais" });

async function openCredentials(page: Page) {
  await page.goto("/crm/credenciais");
  await signIn(page);
  await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
}

async function newFzap(page: Page, name: string, origin: string, token: string) {
  await page.getByRole("button", { name: "Nova credencial" }).click();
  await page.getByRole("dialog", { name: "Nova credencial" }).getByRole("button", { name: "fzap (Pix pelo WhatsApp)" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova credencial da fzap" });
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Endereço da instância").fill(origin);
  await dialog.getByLabel("Token da instância").fill(token);
  return dialog;
}

async function remove(page: Page, name: string) {
  const item = credentials(page).getByRole("listitem").filter({ hasText: name });
  await rowAction(item, page, "Apagar");
  await page.getByRole("dialog", { name: `Apagar a credencial ${name}?` }).getByRole("button", { name: "Apagar" }).click();
  await expect(toast(page, "Credencial apagada")).toBeVisible();
}

test("a fzap credential: made with the password, tested, and a new address asks for the token again", async ({ page }) => {
  const id = tag();
  const name = `fzap ${id}`;
  const token = `token-da-instancia-${id}`;
  await openCredentials(page);
  await page.getByRole("button", { name: "Nova credencial" }).click();
  const chooser = page.getByRole("dialog", { name: "Nova credencial" });
  await expect(chooser.getByText("Para enviar Pix pelo WhatsApp. A Zuri usa só o envio de Pix e o estado da sessão.")).toBeVisible();
  await chooser.getByRole("button", { name: "fzap (Pix pelo WhatsApp)" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova credencial da fzap" });
  // The name comes filled; without the address and the token there is nothing to save.
  await expect(dialog.getByLabel("Nome")).toHaveValue("fzap do consultório");
  await expect(dialog.getByRole("button", { name: "Criar credencial" })).toBeDisabled();
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Endereço da instância").fill("https://fzap.exemplo.com.br");
  await expect(dialog.getByRole("button", { name: "Criar credencial" })).toBeDisabled();
  const field = dialog.getByLabel("Token da instância");
  await expect(field).toHaveAttribute("type", "password");
  await field.fill(token);
  await expectAccessible(page, "nova credencial da fzap");

  // The password was typed too long ago: the server asks for it, and the save goes on after it.
  let posts = 0;
  await page.route("**/api/flows/connections", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts += 1;
    if (posts === 1) return route.fulfill({ status: 403, json: { code: "RECENT_AUTH_REQUIRED", message: "Digite a sua senha de novo para continuar." } });
    expect(route.request().postDataJSON()).toEqual({ kind: "fzap", name, origin: "https://fzap.exemplo.com.br", credential: token });
    return route.fallback();
  });
  await dialog.getByRole("button", { name: "Criar credencial" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirme que é você" });
  await confirm.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await confirm.getByRole("button", { name: "Confirmar" }).click();
  await expect(toast(page, "Credencial criada")).toBeVisible();
  expect(posts).toBe(2);
  await page.unroute("**/api/flows/connections");

  const item = credentials(page).getByRole("listitem").filter({ hasText: name });
  await expect(item.getByText("fzap", { exact: true })).toBeVisible();
  await expect(item.getByText("https://fzap.exemplo.com.br · só envia Pix e lê o estado da sessão")).toBeVisible();
  await expect(item.getByText(`Chave terminada em ${token.slice(-4)}`)).toBeVisible();
  expect(await page.content()).not.toContain(token);
  await rowAction(item, page, "Testar");
  await expect(toast(page, "Conectada. Modo WhatsApp Web: o Pix funciona.")).toBeVisible();

  // A new address without the token is not saved; the token field says why.
  await rowAction(item, page, "Editar");
  const editing = page.getByRole("dialog", { name: "Editar credencial" });
  await expect(editing.getByLabel("Token da instância")).toHaveValue("");
  await expect(editing.getByLabel("Token da instância")).toHaveAttribute("placeholder", "Em branco, fica o atual");
  await editing.getByLabel("Endereço da instância").fill("https://fzap-cloud.exemplo.com.br");
  await expect(editing.getByRole("button", { name: "Salvar" })).toBeDisabled();
  await expect(editing.getByLabel("Token da instância")).toHaveAttribute("aria-invalid", "true");
  await expect(editing.getByLabel("Token da instância")).toHaveAccessibleDescription(/O endereço mudou: cole o token da instância nova\./);
  await editing.getByLabel("Token da instância").fill(`${token}-cloud`);
  await expectAccessible(page, "editar credencial da fzap");
  await editing.getByRole("button", { name: "Salvar" }).click();
  await expect(toast(page, "Credencial salva")).toBeVisible();
  await expect(item.getByText(/^https:\/\/fzap-cloud\.exemplo\.com\.br · /)).toBeVisible();
  await rowAction(item, page, "Testar");
  await expect(toast(page, "Conectada no modo Cloud API. A fzap não envia Pix por ele: use uma instância no modo WhatsApp Web.")).toBeVisible();

  // A flow never offers it.
  await page.goto("/crm/fluxos");
  await page.getByRole("button", { name: "Novo fluxo" }).click();
  const form = page.getByRole("dialog", { name: "Novo fluxo" });
  await form.getByLabel("Tipo do passo").selectOption("request");
  await form.getByRole("button", { name: "Adicionar passo" }).click();
  await expect(form.getByLabel("Credencial").getByRole("option", { name })).toHaveCount(0);
  await form.getByRole("button", { name: "Cancelar" }).click();

  await page.goto("/crm/credenciais");
  await remove(page, name);
});

test("Testar says when the instance is off WhatsApp, and when the token is refused", async ({ page }) => {
  const id = tag();
  await openCredentials(page);
  const off = `fzap fora ${id}`;
  await (await newFzap(page, off, "https://fzap-fora.exemplo.com.br", `token-da-instancia-${id}`)).getByRole("button", { name: "Criar credencial" }).click();
  await expect(toast(page, "Credencial criada")).toBeVisible();
  await rowAction(credentials(page).getByRole("listitem").filter({ hasText: off }), page, "Testar");
  await expect(toast(page, "A instância respondeu, mas não está conectada ao WhatsApp. Conecte pelo painel da fzap e teste de novo.")).toBeVisible();

  const refused = `fzap recusada ${id}`;
  await (await newFzap(page, refused, "https://fzap.exemplo.com.br", "token-recusado-exemplo")).getByRole("button", { name: "Criar credencial" }).click();
  await expect(toast(page, "Credencial criada")).toBeVisible();
  await rowAction(credentials(page).getByRole("listitem").filter({ hasText: refused }), page, "Testar");
  await expect(toast(page, "O teste não passou: o serviço respondeu com erro.")).toBeVisible();

  // An address with a path is refused by the server and said in the dialog.
  const dialog = await newFzap(page, `fzap caminho ${id}`, "https://fzap.exemplo.com.br/session", `token-da-instancia-${id}`);
  await dialog.getByRole("button", { name: "Criar credencial" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar" }).click();

  await remove(page, off);
  await remove(page, refused);
});

test("on a phone the dialog fits and every control is a 44 px target @mobile", async ({ page }) => {
  await openCredentials(page);
  await page.getByRole("button", { name: "Nova credencial" }).click();
  await page.getByRole("dialog", { name: "Nova credencial" }).getByRole("button", { name: "fzap (Pix pelo WhatsApp)" }).click();
  await expect(page.getByRole("dialog", { name: "Nova credencial da fzap" })).toBeVisible();
  expect(await tooSmallControls(page), "every control of the dialog is a 44 px target").toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page, "nova credencial da fzap celular");
});

test("in English, the kind, the dialog and the test follow the language", async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...((await response.json()) as object), language: "en" } });
  });
  await page.goto("/crm/credenciais");
  await signIn(page);
  await page.getByRole("button", { name: "New credential" }).click();
  await page.getByRole("button", { name: "fzap (Pix by WhatsApp)" }).click();
  const dialog = page.getByRole("dialog", { name: "New fzap credential" });
  await expect(dialog.getByLabel("Instance address")).toBeVisible();
  await expect(dialog.getByLabel("Instance token")).toBeVisible();
  await expect(dialog.getByLabel("Name")).toHaveValue("Office fzap");
});
