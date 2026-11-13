/**
 * Screenshots for a pull request (.claude/rules/capturas.md): the screens the PR
 * created or changed, light and dark, computer and phone, with sample data.
 *
 * Needs the e2e server running on an empty database (wrangler dev on
 * 127.0.0.1:4173, the webServer command of playwright.config.ts).
 *
 * Usage:
 *   node scripts/capturas-da-interface.ts <output dir> [--exemplos] [name=/path ...]
 *
 * - `name=/path`: one screen per pair, saved as <name>-<device>-<scheme>.png.
 *   `entrar` is the sign-in screen, shot before signing in. Without pairs the
 *   script shoots the sign-in screen and home.
 * - `entrar-<estado>=/entrar` (conferindo, pedir-clique, nao-carregou, nao-passou, espera): the
 *   sign-in with the security check's line in that state.
 * - `recuperar-senha=/recuperar-senha` and `aprovar=/aprovar`: shot signed out, like the sign-in
 *   (the recovery as an installation with e-mail set up shows it).
 * - `name=/path>Region name`: the same, with that region (role region) scrolled to the top first.
 * - `painel-de-avisos=/`: the notice center, opened from the bell on that page.
 * - `painel-da-conta=/`: the account panel (a sheet on a phone), opened on that page.
 * - `folha-mais=/`: the "Mais" sheet of the phone's bottom bar (phone only).
 * - `menu-recolhido=/`: the side menu as a rail of icons, with one name showing (computer only).
 * - `menu-grupo-fechado=/…`: the side menu with the area "Meu dia" closed by its title
 *   (computer only); at an address inside the group, the place in view stays.
 * - `conversa-aberta=/conversa`: the sample conversation ("Organizar a mudança"), open.
 * - `conversa-anterior=/conversa`: the same, as if it had last been used yesterday (the notice under its messages).
 * - `memoria-painel=/memoria`: a sample memory chosen, with its links in the panel.
 * - `memoria-mapa=/memoria`: the map (on a computer, with the same memory chosen).
 * - `nota-aberta=/notas`: the sample note ("Lista da mudança de apartamento"), open in the editor.
 * - `contatos=/contatos`, `contato-ficha=/contatos`, `contato-homonimo=/contatos` and `contatos-etiquetas=/contatos`:
 *   the list with the sample contacts copied, the card of one of them (Beatriz, with her appointments), the card of
 *   one of two people with the same name, and the label filter open (need --exemplos).
 * - `integracoes-sem-etiqueta=/configuracoes/integracoes>Contatos`: the contacts just turned on, with the labels
 *   to choose and nobody copied yet (needs --exemplos; run it apart, on a database of its own: it empties the copy).
 * - `rotinas-criar-<1 a 5>=/rotinas`: "Criar rotina" open on that step, as a "Rotina da Zuri" from the
 *   template "Fechamento do dia".
 * - `conversa-menu=/conversa`: the same, with the "Mais opções" menu of its row open (computer only).
 * - `conversas=/conversa`: the list of conversations as the phone shows it (phone only).
 * - `agenda-dia=/agenda` and `agenda-mes=/agenda`: the Agenda in that view (plain `agenda=/agenda` is the
 *   week on a computer and the day on a phone, as it opens).
 * - `agenda-evento=/agenda`: the Agenda with the details of a sample event open (its status and its color at Google;
 *   needs --exemplos).
 * - `agenda-editar=/agenda`: the form of that event ("Dura", "Tipo", "Situação"); `agenda-movido=/agenda`: the
 *   Agenda right after the event moved, with the notice that offers "Desfazer" (both need --exemplos).
 * - `agenda-hora-fechada=/agenda`: the notice of a click on today's lunch, "Consulta não entra neste horário"
 *   (computer only: a phone's day has no grid to click; run it with `--relogio` before noon).
 * - `configuracoes-agenda-feriados=/configuracoes/agenda`: Configurações › Agenda scrolled to the national
 *   holidays and the days off.
 * - `credencial-chatwoot=/crm/credenciais`: the sample Chatwoot credential open in "Editar", with its
 *   inboxes found (needs --exemplos).
 * - `automacao-ensaio=/crm`: the example automation in rehearsal with the sample Chatwoot credential,
 *   its follow-up open (needs --exemplos; local development only).
 * - `--relogio=HH:MM`: the signed-in screens see that hour of today in São Paulo (the home
 *   page's day and its line of now come out the same at any hour the script runs).
 * - `--exemplos`: fills the empty database with the sample data of
 *   dados-de-exemplo.ts first, so lists are not empty.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "@playwright/test";
import { routeFakeTurnstile } from "../tests/e2e/fixtures.ts";
import { CSRF, signIn } from "../tests/e2e/ui-helpers.ts";
import { seed, seedContacts } from "./dados-de-exemplo.ts";

const BASE = "http://127.0.0.1:4173";
const args = process.argv.slice(2);
const out = args.find((arg) => !arg.startsWith("--") && !arg.includes("="));
if (!out) {
  console.error("Usage: node scripts/capturas-da-interface.ts <output dir> [--exemplos] [name=/path ...]");
  process.exit(1);
}
const withSamples = args.includes("--exemplos");
const clock = args.find((arg) => /^--relogio=\d\d:\d\d$/.test(arg))?.slice(10);
const pairs = args.filter((arg) => arg.includes("=") && !arg.startsWith("--"));
const screens = (pairs.length > 0 ? pairs : ["entrar=/entrar", "inicio=/"]).map((pair) => {
  // Split at the first "=" only: a path may carry a query (`lixeira=/configuracoes/dados?tipo=tarefas`).
  const at = pair.indexOf("=");
  const name = pair.slice(0, at);
  const target = pair.slice(at + 1);
  // `name=/path>Region name` scrolls that region (role region, by its name) to the top before the shot.
  const [path = "", region] = target.split(">", 2);
  // The name becomes a file name: keep it to a plain slug.
  if (!/^[a-z0-9-]+$/.test(name) || !path.startsWith("/")) throw new Error(`Invalid screen "${pair}": use name=/path`);
  return { name, path, region };
});
/** The screens outside the app: the sign-in (and the states of its security check), the recovery and the bot's confirmation. */
const signedOut = (screen: { name: string }) => /^(entrar(-[a-z-]+)?|recuperar-senha|aprovar)$/.test(screen.name);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
);
let seeded = !withSamples;
for (const [device, options] of [
  ["computador", { viewport: { width: 1280, height: 800 } }],
  // Scale 2 keeps the phone shots sharp and the repository light.
  ["celular", { ...devices["Pixel 7"], deviceScaleFactor: 2 }],
] as const) {
  for (const scheme of ["claro", "escuro"] as const) {
    const context = await browser.newContext({
      ...options,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      colorScheme: scheme === "claro" ? "light" : "dark",
    });
    await routeFakeTurnstile(context);
    // The 2FA reminder would cover the top of every screen: snooze it, as the owner can.
    await context.addInitScript(() => localStorage.setItem("zuri.mfaReminderSnoozedUntil", String(Date.now() + 9e9)));
    const page = await context.newPage();
    const shot = async (name: string) => {
      await page.waitForLoadState("networkidle");
      // Lets entrance animations end and the fonts settle.
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `${name}-${device}-${scheme}.png`) });
    };

    // The screens outside the app, shot before signing in.
    for (const screen of screens.filter(signedOut)) {
      const state = screen.name.startsWith("entrar-") ? screen.name.slice(7) : "";
      await page.unrouteAll({ behavior: "wait" });
      // The check as the test plays it: silent, or with the event of the state asked for.
      const event = { "pedir-clique": "before-interactive-callback", "nao-carregou": "error-callback" }[state];
      const silent = state === "conferindo" || event !== undefined;
      if (silent)
        await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
          route.fulfill({
            contentType: "text/javascript",
            body: `window.turnstile = { render(box, options) { ${event ? `setTimeout(() => options["${event}"](), 20);` : ""} return "w"; }, remove() {} };`,
          }),
        );
      if (state === "nao-passou" || state === "espera")
        await page.route("**/api/auth/login", (route) =>
          route.fulfill({
            status: state === "espera" ? 429 : 400,
            json: { code: state === "espera" ? "RATE_LIMITED" : "TURNSTILE_REQUIRED", message: "A verificação de segurança não passou. Tente de novo.", details: state === "espera" ? { retryAfter: 892 } : {} },
          }),
        );
      await page.route("**/api/auth/recover", (route) => route.fulfill({ json: { available: true } }));
      await page.goto(BASE + screen.path);
      await page.getByRole("heading", { level: 1 }).waitFor();
      // The real check passes unseen (interaction-only); the fake one prints its key, so it leaves the shot.
      if (!silent && screen.name !== "aprovar") await page.locator('[data-testid="turnstile"][data-solved="true"]').waitFor({ state: "attached" });
      if (state === "nao-passou" || state === "espera") {
        await page.getByLabel("E-mail").fill("dono@exemplo.com.br");
        await page.getByLabel("Senha", { exact: true }).fill("senha de exemplo");
        await page.getByRole("button", { name: "Entrar" }).click();
        await page.getByRole("alert").waitFor();
      }
      // Through the element's own style: the page's policy takes no style sheet from outside its address.
      await page.locator('[data-testid="turnstile"]').evaluateAll((boxes: HTMLElement[]) => {
        for (const box of boxes) box.style.display = "none";
      });
      await shot(screen.name);
    }
    await page.unrouteAll({ behavior: "wait" });
    await page.goto(`${BASE}/entrar`);
    await page.getByRole("button", { name: "Entrar" }).waitFor();
    const signedIn = screens.filter((screen) => !signedOut(screen));
    if (signedIn.length > 0) {
      await signIn(page);
      await page.waitForURL((url) => !url.pathname.startsWith("/entrar"));
      if (!seeded) {
        await seed(page, BASE);
        seeded = true;
      }
    }
    // São Paulo is UTC-3 all year. Set after signing in: the session's own clocks started on the real hour.
    if (clock && signedIn.length > 0) await page.clock.setFixedTime(new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })}T${clock}:00-03:00`));
    for (const screen of signedIn) {
      // Shots that exist on one size only.
      if (screen.name === "folha-mais" && device !== "celular") continue;
      if (/^menu-(recolhido|grupo-fechado)/.test(screen.name) && device !== "computador") continue;
      if (screen.name === "conversas" && device !== "celular") continue;
      let path = screen.path;
      if (screen.name === "conversa-menu" && device !== "computador") continue;
      if (/^conversa-(aberta|anterior|menu)$/.test(screen.name)) {
        const list = (await (await page.request.get(`${BASE}/api/conversations`, { headers: CSRF })).json()) as { conversations: { id: string; title: string }[] };
        const sample = list.conversations.find((conversation) => conversation.title === "Organizar a mudança");
        if (!sample) throw new Error("conversa-aberta needs --exemplos");
        path = `/conversa/${sample.id}`;
        if (screen.name === "conversa-anterior")
          // Only the answers change: the server still has it as today's.
          await page.route(/\/api\/conversations(\/[0-9a-f-]{36})?$/, async (route) => {
            if (route.request().method() !== "GET") return route.fallback();
            const response = await route.fetch();
            const yesterday = (iso: string) => new Date(Date.parse(iso) - 86_400_000).toISOString();
            const aged = <T extends { createdAt: string; updatedAt?: string }>(item: T): T => ({ ...item, createdAt: yesterday(item.createdAt), ...(item.updatedAt ? { updatedAt: yesterday(item.updatedAt) } : {}) });
            const body = await response.json();
            await route.fulfill({
              response,
              json: { ...body, ...(body.conversations ? { conversations: body.conversations.map(aged) } : {}), ...(body.conversation ? { conversation: aged(body.conversation), messages: body.messages.map(aged) } : {}) },
            });
          });
      }
      if (screen.name === "nota-aberta") {
        const list = (await (await page.request.get(`${BASE}/api/notes`, { headers: CSRF })).json()) as { notes: { id: string; title: string }[] };
        const sample = list.notes.find((note) => note.title === "Lista da mudança de apartamento");
        if (!sample) throw new Error("nota-aberta needs --exemplos");
        path = `/notas/${sample.id}`;
      }
      if (screen.name === "automacao-ensaio") {
        // The example automation (local development only) in rehearsal with the sample Chatwoot credential, once.
        const list = (await (await page.request.get(`${BASE}/api/crm/automations`, { headers: CSRF })).json()) as { automations: { id: string; state: string }[] };
        if (list.automations.find((item) => item.id === "example")?.state === "off") {
          const flows = (await (await page.request.get(`${BASE}/api/flows`, { headers: CSRF })).json()) as { connections: { id: string; kind: string }[] };
          const chatwoot = flows.connections.find((item) => item.kind === "chatwoot");
          if (!chatwoot) throw new Error("automacao-ensaio needs --exemplos");
          await page.request.put(`${BASE}/api/crm/automations/example/config`, { headers: CSRF, data: { connectionId: chatwoot.id, options: { perDay: 3 } } });
          await page.request.post(`${BASE}/api/crm/automations/example/mode`, { headers: CSRF, data: { mode: "rehearsal" } });
        }
        // The first run comes on the alarm (up to a minute or so): wait for what it noted.
        for (let n = 0; n < 360; n++) {
          const activity = (await (await page.request.get(`${BASE}/api/crm/automations/example/activity`, { headers: CSRF })).json()) as { effects: unknown[] };
          if (activity.effects.length > 0) break;
          await page.waitForTimeout(250);
        }
      }
      if (/^contatos?(-|$)/.test(screen.name)) {
        await seedContacts(page, BASE);
        // "contato-ficha": Beatriz, with the note after her name and her appointments; "contato-homonimo": one of the two Marcos.
        const who = screen.name === "contato-ficha" ? "Beatriz" : screen.name === "contato-homonimo" ? "Marcos" : "";
        if (who) {
          const found = (await (await page.request.get(`${BASE}/api/contacts?q=${who}`, { headers: CSRF })).json()) as { contacts: { id: string }[] };
          if (!found.contacts[0]) throw new Error(`${screen.name} needs --exemplos`);
          path = `/contatos/${found.contacts[0].id}`;
        }
      }
      if (screen.name === "integracoes-sem-etiqueta") {
        // The first setup: the contacts on, the labels read and none chosen yet (shoot it apart: it empties the copy).
        await seedContacts(page, BASE);
        const status = (await (await page.request.get(`${BASE}/api/google/contacts`, { headers: CSRF })).json()) as { labels: { selected: boolean }[] };
        if (status.labels.some((label) => label.selected)) {
          const none = await page.request.patch(`${BASE}/api/google/contacts/labels`, { headers: CSRF, data: { selected: [] } });
          if (!none.ok()) throw new Error(`/api/google/contacts/labels: ${none.status()}`);
        }
      }
      await page.goto(BASE + path);
      await page.getByRole("heading", { level: 1 }).or(page.getByRole("heading", { level: 2 })).first().waitFor();
      if (/^contato-(ficha|homonimo)$/.test(screen.name)) await page.getByRole("region", { name: "Atendimentos" }).locator("dl").waitFor();
      if (screen.name === "contatos-etiquetas") {
        await page.getByRole("button", { name: "Filtrar por etiqueta" }).click();
        await page.getByRole("dialog", { name: "Filtrar por etiqueta" }).getByText("Todas as etiquetas").waitFor();
      }
      if (screen.name === "painel-de-avisos") {
        await page.getByRole("button", { name: /^Abrir avisos/ }).first().click();
        await page.getByRole("dialog", { name: "Avisos" }).getByRole("list").or(page.getByRole("dialog", { name: "Avisos" }).getByText("Nenhum aviso")).first().waitFor();
      }
      if (screen.name === "painel-da-conta") {
        await page.getByRole("button", { name: /^Menu da conta:/ }).click();
        await page.getByRole("dialog", { name: "Sua conta" }).getByRole("button", { name: "Sair", exact: true }).waitFor();
      }
      if (screen.name === "folha-mais") {
        await page.getByRole("button", { name: "Mais", exact: true }).click();
        await page.getByRole("dialog", { name: "Mais" }).waitFor();
      }
      if (screen.name === "menu-recolhido") {
        await page.getByRole("button", { name: "Recolher menu" }).click();
        await page.locator("aside").getByRole("link", { name: "Agenda", exact: true }).hover();
      }
      const group = page.locator("aside").getByRole("button", { name: "Meu dia", exact: true });
      if (screen.name.startsWith("menu-grupo-fechado")) {
        await group.click();
        await page.locator("aside").getByRole("link", { name: "Notas", exact: true }).waitFor({ state: "hidden" });
      }
      if (/^memoria-(painel|mapa)$/.test(screen.name)) {
        const sample = "Está organizando a mudança para um apartamento novo.";
        // On a phone the panel takes the map's place: there the map is shown with nothing chosen.
        if (screen.name === "memoria-painel" || device === "computador") {
          await page.getByRole("region", { name: "Suas memórias" }).getByRole("button", { name: sample }).click();
          await page.getByRole("complementary", { name: "Memória escolhida" }).getByRole("heading", { level: 2, name: sample }).waitFor();
        }
        if (screen.name === "memoria-mapa") {
          await page.getByRole("button", { name: "Mapa", exact: true }).click();
          await page.getByRole("group", { name: "Mapa das memórias" }).getByRole("button", { name: sample }).waitFor();
        }
      }
      if (/^agenda-(dia|mes)$/.test(screen.name)) {
        const view = screen.name === "agenda-dia" ? "Dia" : "Mês";
        await page.getByRole("group", { name: "Ver por" }).getByText(view, { exact: true }).click();
        await page.getByRole("radio", { name: view }).and(page.locator(":checked")).waitFor({ state: "attached" });
      }
      if (screen.name === "credencial-chatwoot") {
        const row = page.getByRole("list", { name: "Credenciais" }).getByRole("listitem").filter({ hasText: "Chatwoot do consultório" });
        await row.getByRole("button", { name: /^Mais opções/ }).click();
        await page.getByRole("menuitem", { name: "Editar" }).click();
        const dialog = page.getByRole("dialog", { name: "Editar credencial" });
        await dialog.getByRole("button", { name: "Buscar caixas" }).click();
        await dialog.getByText("2 caixas encontradas").waitFor();
      }
      if (screen.name === "automacao-ensaio") {
        const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /^\d+ Automação de exemplo$/ }) });
        await row.getByRole("button", { name: "Acompanhar" }).click();
        await row.getByRole("button", { name: "Desligar" }).scrollIntoViewIfNeeded();
      }
      if (screen.name === "agenda-evento") {
        await page.getByRole("main").getByRole("button", { name: /^Café com a Ana/ }).click();
        await page.getByRole("dialog", { name: "Café com a Ana" }).getByRole("group", { name: "Situação" }).waitFor();
      }
      if (screen.name === "agenda-editar") {
        await page.getByRole("main").getByRole("button", { name: /^Café com a Ana/ }).click();
        await page.getByRole("dialog", { name: "Café com a Ana" }).getByRole("button", { name: "Editar" }).click();
        await page.getByRole("dialog", { name: "Editar evento" }).getByLabel("Dura").waitFor();
      }
      if (screen.name === "agenda-movido") {
        const event = page.getByRole("main").getByRole("button", { name: /^Café com a Ana/ });
        if (device === "computador") {
          // The keyboard's way of dragging: a quarter of an hour later, sent when Alt is let go.
          await event.focus();
          await page.keyboard.down("Alt");
          await page.keyboard.press("ArrowDown");
          await page.keyboard.up("Alt");
        } else {
          // A phone has no dragging: the same change by "Editar".
          await event.click();
          await page.getByRole("dialog", { name: "Café com a Ana" }).getByRole("button", { name: "Editar" }).click();
          const form = page.getByRole("dialog", { name: "Editar evento" });
          // Another length than the one it has: the run before (the other theme) already changed it.
          const length = form.getByLabel("Dura");
          await length.selectOption((await length.inputValue()) === "90" ? "60" : "90");
          await form.getByRole("button", { name: "Salvar" }).click();
        }
        await page.getByRole("button", { name: "Desfazer" }).waitFor();
      }
      if (screen.name === "agenda-hora-fechada" && device === "computador") {
        // Today's lunch, a quarter past noon: the last striped hour of the week is today's or a later day's.
        const lunch = page.getByRole("main").locator("[data-lunch]").last();
        const box = await lunch.boundingBox();
        if (!box) throw new Error("agenda-hora-fechada needs a working day with lunch in the week");
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 4);
        await page.getByRole("dialog", { name: "Consulta não entra neste horário" }).waitFor();
      }
      if (screen.name === "configuracoes-agenda-feriados") {
        await page.getByText("Feriados nacionais", { exact: true }).evaluate((title) => title.scrollIntoView({ block: "start" }));
      }
      if (screen.name === "conversa-menu") await page.getByRole("complementary", { name: "Conversas" }).getByRole("button", { name: /^Mais opções/ }).click();
      if (screen.name === "conversas") {
        await page.getByRole("button", { name: "Ver conversas" }).click();
        await page.getByRole("link", { name: /Organizar a mudança/ }).waitFor();
      }
      if (screen.name.startsWith("rotinas-criar-")) {
        const step = Number(screen.name.slice(14));
        await page.getByRole("button", { name: "Criar rotina" }).click();
        const wizard = page.getByRole("dialog", { name: "Criar rotina" });
        await wizard.getByRole("radio", { name: "Rotina da Zuri" }).check();
        for (let at = 1; at <= step; at++) {
          if (at === 3) await wizard.getByRole("button", { name: "Fechamento do dia" }).click();
          if (at < step) await wizard.getByRole("button", { name: "Continuar" }).click();
        }
        await wizard.getByText(`Passo ${step} de 5`).waitFor();
      }
      if (screen.region) {
        const region = page.getByRole("region", { name: screen.region, exact: true });
        await region.waitFor();
        await region.evaluate((box: HTMLElement) => box.scrollIntoView({ block: "start" }));
      }
      await shot(screen.name);
      if (screen.name === "conversa-anterior") await page.unrouteAll({ behavior: "wait" });
      // The rail is remembered on the device: the next shots get the wide menu back.
      if (screen.name === "menu-recolhido") await page.getByRole("button", { name: "Expandir menu" }).click();
      if (screen.name.startsWith("menu-grupo-fechado")) await group.click();
    }
    await context.close();
  }
}
await browser.close();
console.log(`Screenshots in ${out}`);
