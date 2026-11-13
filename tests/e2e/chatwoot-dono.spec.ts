import { expect, type Page, test } from "./fixtures.ts";
import { expectAccessible, openSettingsSection, signIn, tooSmallControls } from "./ui-helpers.ts";

// Settings › Chatwoot (docs/planos/zuri-no-chatwoot.md) against the real Worker: over loopback the
// agent answers for chat.exemplo.com.br itself (src/chatwoot/dev-chatwoot-owner.ts), with the
// administrator "Ana Martins" (agent 7), and that owner answers the link code on their own.
// One inbox per installation, so the flow runs on the computer only and forgets at the end.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

async function fill(page: Page, key: string) {
  const dialog = page.getByRole("dialog", { name: "Configurar o Chatwoot" });
  await dialog.getByLabel("Endereço do Chatwoot").fill("https://chat.exemplo.com.br");
  await dialog.getByLabel("Número da conta").fill("1");
  await dialog.getByLabel("Sua chave de acesso", { exact: true }).fill(key);
  await dialog.getByRole("button", { name: "Continuar" }).click();
}

test("Settings › Chatwoot: the owner sets up the inbox, confirms the account, tests, pauses and forgets", async ({ page }) => {
  await page.goto("/configuracoes");
  await signIn(page);
  await openSettingsSection(page, "Chatwoot");
  const card = page.getByRole("region", { name: "Conversar com a Zuri pelo Chatwoot" });
  await expect(card.getByText("O que a Zuri faz sozinha")).toBeVisible();
  await expect(page.getByRole("region", { name: "O que cada chave do Chatwoot pode" })).toBeVisible();
  await expectAccessible(page, "chatwoot desligado");
  expect(await tooSmallControls(page), "every control of the page is a 44 px target").toEqual([]);

  // The form checks the address before anything goes out.
  await card.getByRole("button", { name: "Configurar" }).click();
  const dialog = page.getByRole("dialog", { name: "Configurar o Chatwoot" });
  await dialog.getByLabel("Endereço do Chatwoot").fill("http://chat.exemplo.com.br");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(dialog.getByText("Use o endereço com https://, só o domínio, sem caminho.", { exact: false })).toBeVisible();
  // A refused key and an agent's key say why, in the dialog.
  await fill(page, "chave-recusada-exemplo");
  await expect(dialog.getByRole("alert")).toHaveText("O Chatwoot recusou a chave (401). Confira se copiou inteira, em Perfil › Chave de acesso.");
  await fill(page, "chave-atendente-exemplo");
  await expect(dialog.getByRole("alert")).toHaveText("Esta chave é de Ana Martins, com papel de atendente na conta 1. Para criar a caixa, use a chave de um administrador.");
  await expectAccessible(page, "chatwoot chave recusada");

  await fill(page, "chave-admin-exemplo");
  const isYou = page.getByRole("dialog", { name: "Esta conta é você?" });
  await expect(isYou.getByText("Ana Martins")).toBeVisible();
  await expect(isYou.getByText("ana@exemplo.com.br · atendente nº 7 · administrador da conta 1")).toBeVisible();
  await expectAccessible(page, "chatwoot esta conta é você");
  await isYou.getByRole("button", { name: "Sou eu, criar a caixa" }).click();
  const done = page.getByRole("dialog", { name: "Caixa criada" });
  await expect(done.getByText(/^Responda [A-HJ-NP-Z2-9]{8} na conversa “Zuri” do Chatwoot\.$/)).toBeVisible();
  await expect(done.getByText("Use a sua conta (Ana Martins). Depois, confirme aqui no app.")).toBeVisible();
  await done.getByRole("button", { name: "Entendi" }).click();

  // The simulated owner answers the code; the app confirms it.
  await expect(async () => {
    await page.reload();
    await expect(card.getByText("Falta confirmar")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await expect(card.getByText("O código veio da conta Ana Martins (atendente nº 7).", { exact: false })).toBeVisible();
  await expectAccessible(page, "chatwoot falta confirmar");
  await card.getByRole("button", { name: "Confirmar esta conta" }).click();
  await expect(toast(page, "Pronto. A Zuri responde só a você")).toBeVisible();
  await expect(card.getByRole("switch", { name: "Conversar com a Zuri por aqui" })).toBeChecked();
  await expect(card.getByText("Ana Martins · atendente nº 7")).toBeVisible();
  // The read lock, as the bot's: open after the confirmation, for the bot's hours.
  await expect(card.getByRole("term").filter({ hasText: "Trava de leitura" })).toContainText("Aberta");
  await expect(card.getByText(/^Aberta até .+\. Trava depois de 12 h sem uso, como no Telegram\.$/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Quando algo some ou muda" })).toBeVisible();
  await expectAccessible(page, "chatwoot ligado");
  expect(await tooSmallControls(page), "every control of the linked page is a 44 px target").toEqual([]);

  // The quick test sends "Teste da configuração" and waits for the signed notice.
  await card.getByRole("button", { name: "Testar configuração" }).click();
  const test1 = page.getByRole("dialog", { name: "Teste da configuração" });
  await expect(test1.getByText("Tudo certo. A Zuri só responde a você.")).toBeVisible({ timeout: 15_000 });
  await expect(test1.getByText("Assinatura do retorno")).toBeVisible();
  await expectAccessible(page, "chatwoot teste");
  // The full test asks the key again.
  await test1.getByRole("button", { name: "Teste completo" }).click();
  const full = page.getByRole("dialog", { name: "Teste completo" });
  await full.getByRole("button", { name: "Continuar" }).click();
  await expect(full.getByText("Cole a chave para continuar.")).toBeVisible();
  await full.getByLabel("Sua chave de acesso de administrador").fill("chave-admin-exemplo");
  await full.getByRole("button", { name: "Continuar" }).click();
  await expect(full.getByText("Rafael Souza: administrador vê todas as caixas. A Zuri não responde a eles.")).toBeVisible({ timeout: 15_000 });
  await full.getByRole("button", { name: "Pronto" }).click();
  await expect(card.getByText(/^Rafael Souza: administrador do Chatwoot vê todas as caixas/)).toBeVisible();

  // The switch pauses and turns back on.
  await card.getByRole("switch", { name: "Conversar com a Zuri por aqui" }).click();
  await expect(toast(page, "Pausado. A Zuri não responde nada na caixa")).toBeVisible();
  await card.getByRole("switch", { name: "Conversar com a Zuri por aqui" }).click();
  await expect(toast(page, "A Zuri voltou a responder na conversa “Zuri”")).toBeVisible();

  // Integrações shows the state and leads here.
  await openSettingsSection(page, "Integrações");
  const shortcut = page.getByRole("region", { name: "Chatwoot", exact: true });
  await expect(shortcut.getByText("Ligado: responde só a Ana Martins")).toBeVisible();
  await shortcut.getByRole("link", { name: "Abrir" }).click();
  await expect(card.getByRole("button", { name: "Desligar e esquecer" })).toBeVisible();

  // Forgetting keeps nothing.
  await card.getByRole("button", { name: "Desligar e esquecer" }).click();
  const forget = page.getByRole("dialog", { name: "Desligar e esquecer o Chatwoot?" });
  await expectAccessible(page, "chatwoot esquecer");
  await forget.getByRole("button", { name: "Desligar e esquecer" }).click();
  await expect(toast(page, "Chatwoot desligado. Nada da caixa ficou guardado")).toBeVisible();
  await expect(card.getByRole("button", { name: "Configurar" })).toBeVisible();
});

test("Settings › Chatwoot on a phone: the keys are blocks, nothing scrolls sideways @mobile", async ({ page }) => {
  await page.goto("/configuracoes/chatwoot");
  await signIn(page);
  // The table from md up, the blocks below: only one of the two shows.
  const shown = page.getByRole("region", { name: "O que cada chave do Chatwoot pode" }).getByText("Chave de plataforma (Super Admin)").filter({ visible: true });
  await expect(shown).toHaveCount(1);
  const phone = (page.viewportSize()?.width ?? 0) < 768;
  await expect(shown).toHaveJSProperty("tagName", phone ? "P" : "TH");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectAccessible(page, "chatwoot no celular");
});
