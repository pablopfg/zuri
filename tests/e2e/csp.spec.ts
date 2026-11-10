import { readFileSync } from "node:fs";
import { expect, type Page, test } from "./fixtures.ts";
import { settingsHasTabs, signIn } from "./ui-helpers.ts";

// The CSP is strict (no inline script, no eval). A violation means code that
// tries something the policy forbids: it either breaks a feature or, at best,
// files a report on every load. No page may cause one.

test.use({ locale: "pt-BR" });

async function watchViolations(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeFunction("__zuriCspViolation", (v: string) => seen.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __zuriCspViolation: (v: string) => void }).__zuriCspViolation(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
    });
  });
  return seen;
}

test("no page breaks the Content Security Policy @mobile", async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto("/primeiro-acesso");
  await expect(page.getByRole("heading", { level: 1, name: "Recuperar o acesso" })).toBeVisible();
  await page.goto("/aprovar");
  await expect(page.getByRole("heading", { level: 1, name: "Confirmar pelo Telegram" })).toBeVisible();
  await page.goto("/entrar");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  const screens = [
    ["/conversa", "Conversa"],
    ["/tarefas", "Tarefas"],
    ["/notas", "Notas"],
    ["/memoria", "Memória"],
    ["/rotinas", "Rotinas"],
    // An address that moved (packages/shared/src/pages.ts) lands on its new screen.
    ["/automacoes", "Rotinas"],
    ["/crm/fluxos", "CRM"],
    ["/avaliacoes", "Avaliações"],
    ["/contatos", "Contatos"],
    ["/contatos/clientes", "Contatos"],
    ["/agenda", "Agenda"],
    ["/acessos", "Acessos"],
    ["/configuracoes/conta", settingsHasTabs(page) ? "Configurações" : "Conta"],
    ["/configuracoes/integracoes", settingsHasTabs(page) ? "Configurações" : "Integrações"],
    ["/configuracoes/seguranca", settingsHasTabs(page) ? "Configurações" : "Segurança"],
    ["/configuracoes/ia", settingsHasTabs(page) ? "Configurações" : "Uso da IA"],
    ["/configuracoes/modelos", settingsHasTabs(page) ? "Configurações" : "Modelos e limites"],
    ["/configuracoes/dados", settingsHasTabs(page) ? "Configurações" : "Dados"],
    ["/configuracoes/avisos", settingsHasTabs(page) ? "Configurações" : "Avisos"],
    ["/configuracoes/diagnostico", settingsHasTabs(page) ? "Configurações" : "Diagnóstico"],
  ] as const;
  // Every page of the interface is here (stage 25): a new one can't skip the policy check.
  const pages = [...readFileSync(new URL("../../apps/web/src/App.tsx", import.meta.url), "utf8").matchAll(/path="([a-z-]+)/g)].map((m) => `/${m[1]}`);
  expect(pages.length).toBeGreaterThanOrEqual(9);
  for (const route of pages) expect(screens.some(([path]) => path === route || path.startsWith(`${route}/`)), route).toBe(true);
  for (const [path, heading] of screens) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
  }
  expect(violations).toEqual([]);
});
