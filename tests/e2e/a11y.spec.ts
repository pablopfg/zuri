import { expect, test } from "./fixtures.ts";
import { expectAccessible, PASSWORD, settingsTitle, signIn, tooSmallControls } from "./ui-helpers.ts";

// axe (WCAG 2.1 A and AA) on every screen of the shell, in both themes. Serious
// and critical violations fail; the Lighthouse score is in the PR.

test.use({ locale: "pt-BR" });

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    // One test per group of screens (#241): together they ran about 28 s of a 30 s budget, with an axe pass on each of 24 screens.
    test(`sign-in, first access and approval have no serious violation (${scheme}) @mobile`, async ({ page }) => {
      await page.goto("/entrar");
      await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
      await expect(page.locator("html")).toHaveClass(scheme === "dark" ? /dark/ : /^(?!.*dark).*$/);
      await expectAccessible(page, "entrar");

      // The first access of an installation that has its owner: only the recovery is left.
      await page.goto("/primeiro-acesso");
      await expect(page.getByRole("heading", { level: 1, name: "Recuperar o acesso" })).toBeVisible();
      await expectAccessible(page, "primeiro-acesso");
      expect(await tooSmallControls(page)).toEqual([]);
      // The bot's confirmation page (step 15a), without a token: nothing is asked of the server.
      await page.goto("/aprovar");
      await expect(page.getByRole("heading", { name: "Este link não serve mais" })).toBeVisible();
      await expectAccessible(page, "aprovar");
      expect(await tooSmallControls(page)).toEqual([]);
    });

    test(`home and the notices panel have no serious violation (${scheme}) @mobile`, async ({ page }) => {
      await page.goto("/entrar");
      await signIn(page);
      await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
      await expect(page.locator("html")).toHaveClass(scheme === "dark" ? /dark/ : /^(?!.*dark).*$/);
      await expectAccessible(page, "inicio");

      await page.getByRole("button", { name: "Abrir avisos" }).click();
      await expect(page.getByRole("dialog", { name: "Avisos" })).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Avisos" }).getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
      await expectAccessible(page, "avisos");
      await page.keyboard.press("Escape");
    });

    test(`every settings section has no serious violation (${scheme}) @mobile`, async ({ page }) => {
      await page.goto("/configuracoes/conta");
      await signIn(page);
      for (const [tab, title] of [
        ["conta", "Conta"],
        ["seguranca", "Segurança"],
        ["assistente", "Assistente"],
        ["ia", "Uso da IA"],
        ["modelos", "Modelos e limites"],
        ["avisos", "Avisos"],
        ["integracoes", "Integrações"],
        ["chatwoot", "Chatwoot"],
        ["dados", "Dados"],
        ["diagnostico", "Diagnóstico"],
        ["sobre", "Sobre a Zuri"],
      ] as const) {
        await page.goto(`/configuracoes/${tab}`);
        await expect(settingsTitle(page, title)).toBeVisible();
        await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
        await expectAccessible(page, tab);
      }
    });

    test(`the main screens, their dialogs and the 404 have no serious violation (${scheme}) @mobile`, async ({ page }) => {
      await page.goto("/conversa");
      await signIn(page);
      for (const [path, heading] of [
        ["/conversa", "Conversa"],
        ["/tarefas", "Tarefas"],
        ["/notas", "Notas"],
        ["/rotinas", "Rotinas"],
        ["/memoria", "Memória"],
        ["/acessos", "Acessos"],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
        await expectAccessible(page, path);
      }
      await page.goto("/tarefas");
      await page.getByRole("button", { name: "Pastas" }).click();
      await expect(page.getByRole("dialog", { name: "Pastas" })).toBeVisible();
      await expectAccessible(page, "pastas");
      await page.keyboard.press("Escape");
      await page.goto("/notas/nova");
      await expect(page.getByLabel("Texto da nota")).toBeVisible();
      await expectAccessible(page, "nova nota");

      await page.goto("/nada-aqui");
      await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
      await expectAccessible(page, "404");
    });

    // A test of its own, so each group above keeps its time on a phone.
    test(`the three parts of the CRM have no serious violation (${scheme}) @mobile`, async ({ page }) => {
      await page.goto("/crm/fluxos");
      await signIn(page);
      for (const address of ["/crm", "/crm/fluxos", "/crm/credenciais", "/crm/envios"]) {
        await page.goto(address);
        await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();
        await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
        await expectAccessible(page, address);
        expect(await tooSmallControls(page), address).toEqual([]);
      }
    });

    // The screens of steps 19, 19b and 22b, in both themes (stage 25).
    test(`the Agenda and Contacts screens have no serious violation (${scheme}) @mobile`, async ({ page }) => {
      await page.goto("/agenda");
      await signIn(page);
      for (const [path, heading] of [
        ["/agenda", "Agenda"],
        ["/contatos", "Contatos"],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
        await expectAccessible(page, path);
      }
    });

    test(`the Reviews screen, off, has no serious violation (${scheme}) @mobile`, async ({ page }) => {
      await page.goto("/avaliacoes");
      await signIn(page);
      await expect(page.getByText("Avaliações desligadas", { exact: true })).toBeVisible();
      await expectAccessible(page, "/avaliacoes");
      expect(await tooSmallControls(page)).toEqual([]);
      // The settings are where it gets turned on: the connection's steps, each with its state.
      await page.getByRole("link", { name: "Escolher perfil" }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Conexão com o Perfil da Empresa" })).toBeVisible();
      await expectAccessible(page, "/avaliacoes/ajustes");
      expect(await tooSmallControls(page)).toEqual([]);
    });
  });
}

test("the two-step setup and the confirmation dialog have no serious violation", async ({ page }) => {
  await page.goto("/configuracoes/seguranca");
  await signIn(page);
  await page.getByRole("button", { name: "Ligar a verificação em duas etapas" }).click();
  const dialog = page.getByRole("dialog", { name: "Antes de ligar, confirme que é você" });
  await expect(dialog.getByLabel("Senha", { exact: true })).toBeFocused();
  await expectAccessible(page, "senha antes de ligar o 2FA");
  await dialog.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("img", { name: "QR code para o aplicativo autenticador" })).toBeVisible();
  await expectAccessible(page, "configurar 2FA");
  await page.getByRole("button", { name: "Cancelar" }).click();
});

test("every control is at least 44 px tall on a phone @mobile", async ({ page }) => {
  const tooSmall = () => tooSmallControls(page);
  await page.goto("/entrar");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  expect(await tooSmall()).toEqual([]);
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  expect(await tooSmall()).toEqual([]);
  await page.goto("/configuracoes/conta");
  await expect(page.getByLabel("Idioma", { exact: true })).toBeVisible();
  expect(await tooSmall()).toEqual([]);
  await page.goto("/configuracoes/seguranca");
  await expect(page.getByRole("heading", { name: "Atividade de acesso" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
  expect(await tooSmall()).toEqual([]);
  for (const path of ["/tarefas", "/notas", "/notas/nova", "/memoria", "/configuracoes/dados"]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
    expect(await tooSmall(), path).toEqual([]);
  }
});
