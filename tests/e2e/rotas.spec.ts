import { readFileSync } from "node:fs";
import { MOVED_PAGES, NOTICE_LINKS } from "@zuri/shared";
import { expect, test } from "./fixtures.ts";
import { signIn } from "./ui-helpers.ts";

// The addresses of the Sinal shell (docs/planos/implementacao-frontend-sinal.md,
// section 7 "Rotas"). The places that changed name keep answering at the old
// address for good: notices saved before the change, old Telegram messages and
// the owner's bookmarks still carry it. And every address the server writes
// (notices, push, e-mail, Telegram, the agent's links) opens a real screen.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const NOT_FOUND = "Página não encontrada";

async function enter(page: import("@playwright/test").Page) {
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
}

test("the new places answer at their addresses, each with its title @mobile", async ({ page }) => {
  await enter(page);
  for (const [path, heading] of [
    ["/rotinas", "Rotinas"],
    ["/crm", "CRM"],
    ["/crm/fluxos", "CRM"],
    ["/crm/credenciais", "CRM"],
    ["/avaliacoes", "Avaliações"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true }), path).toBeVisible();
    expect(new URL(page.url()).pathname, path).toBe(path);
  }
  // A part of the CRM or a tab of the reviews that doesn't exist goes back to the place's first screen.
  await page.goto("/crm/nada");
  await expect(page).toHaveURL(/\/crm$/);
  await page.goto("/avaliacoes/nada");
  await expect(page).toHaveURL(/\/avaliacoes$/);
  // The reviews' own parts open, and what cannot follow one of them goes to that part.
  for (const [from, to] of [
    ["/avaliacoes/lista", "/avaliacoes/lista"],
    ["/avaliacoes/ajustes/responder", "/avaliacoes/ajustes/responder"],
    ["/avaliacoes/ajustes/agente", "/avaliacoes/ajustes"],
    ["/avaliacoes/lista/nada", "/avaliacoes/lista"],
    // A slash hidden in the last part is another address altogether: it never leaves the area.
    ["/avaliacoes/lista/..%2Fentrar", "/avaliacoes"],
    ["/avaliacoes/nada/responder", "/avaliacoes"],
  ] as const) {
    await page.goto(from);
    await expect.poll(() => new URL(page.url()).pathname, { message: from }).toBe(to);
    await expect(page.getByRole("heading", { level: 1, name: "Avaliações" })).toBeVisible();
  }
});

test("every address that changed name sends to the new one, for good, keeping what came after it @mobile", async ({ page }) => {
  await enter(page);
  for (const [from, to] of Object.entries(MOVED_PAGES)) {
    await page.goto(from);
    await expect.poll(() => new URL(page.url()).pathname, { message: from }).toBe(to);
    await expect(page.getByRole("heading", { name: NOT_FOUND }), from).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 }).first(), from).toBeVisible();
  }
  // What came after the address goes along: the routine a notice points at, a search, a trailing slash.
  const id = "00000000-0000-4000-8000-000000000001";
  await page.goto(`/automacoes#automacao-${id}`);
  await expect(page).toHaveURL(new RegExp(`/rotinas#automacao-${id}$`));
  await page.goto("/automacoes/fluxos?de=aviso#novo");
  await expect(page).toHaveURL(/\/crm\/fluxos\?de=aviso#novo$/);
  await page.goto("/contatos/avaliacoes/");
  await expect(page).toHaveURL(/\/avaliacoes$/);
  // An old tab that never existed still lands on Rotinas, never on the 404.
  await page.goto("/automacoes/outra");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/rotinas");
  await expect(page.getByRole("heading", { level: 1, name: "Rotinas" })).toBeVisible();
  // The router minds no case, and neither does the old name.
  await page.goto("/Automacoes/Fluxos");
  await expect.poll(() => new URL(page.url()).pathname).toBe("/crm/fluxos");
  await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();

  // For good: the old address leaves the history, so the browser's back doesn't bounce.
  await page.goto("/tarefas");
  await expect(page.getByRole("heading", { level: 1, name: "Tarefas" })).toBeVisible();
  await page.evaluate(() => {
    history.pushState(null, "", "/automacoes");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/rotinas$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/tarefas$/);
});

test("a redirect never leaves the app: only the fixed pairs, never an address read from the link", async ({ page }) => {
  await enter(page);
  for (const hostile of ["/automacoes//exemplo.com.br", "/automacoes/%2F%2Fexemplo.com.br", "/automacoes/..%2F..%2Fentrar", "/contatos/avaliacoes//exemplo.com.br"]) {
    await page.goto(hostile);
    await expect(page.getByRole("heading", { level: 1 }).first(), hostile).toBeVisible();
    expect(new URL(page.url()).hostname, hostile).toBe("127.0.0.1");
  }
});

test("every address the server writes opens a screen, never the 404", async ({ page }) => {
  test.setTimeout(120_000);
  await enter(page);
  // What the server's code writes: the notices' list and every literal address in the places that build links.
  const sources = ["alerts/service.ts", "alerts/watchers.ts", "alerts/automations.ts", "agent/zuri-agent.ts", "telegram/channel.ts", "email/channel.ts", "push/channel.ts"];
  const written = new Set<string>(NOTICE_LINKS);
  for (const source of sources) {
    const code = readFileSync(new URL(`../../apps/agent/src/${source}`, import.meta.url), "utf8");
    for (const match of code.matchAll(/(?:link|url|to|page):\s*"(\/[a-z][a-z/-]*)"/g)) if (match[1]) written.add(match[1]);
  }
  // The old names too: notices saved before the change carry them.
  for (const old of Object.keys(MOVED_PAGES)) written.add(old);
  // A conversation's own address, as the agent's links and the push write it (one the owner has, when there is any).
  const list = (await (await page.request.get("/api/conversations", { headers: { "x-zuri-request": "1" } })).json()) as { conversations: { id: string }[] };
  written.add(`/conversa/${list.conversations[0]?.id ?? "00000000-0000-4000-8000-000000000001"}`);
  expect(written.size).toBeGreaterThanOrEqual(NOTICE_LINKS.length + Object.keys(MOVED_PAGES).length);

  const missing: string[] = [];
  for (const address of written) {
    await page.goto(address);
    await expect(page.getByRole("heading", { level: 1 }).first(), address).toBeVisible();
    if (await page.getByRole("heading", { name: NOT_FOUND }).count()) missing.push(address);
  }
  expect(missing).toEqual([]);
});
