import { APP_VERSION } from "@zuri/shared";
import { expect, type Page, test } from "./fixtures.ts";
import { expectAccessible, openAccountMenu, signIn, tooSmallControls } from "./ui-helpers.ts";

// The shell of the Sinal interface (docs/planos/implementacao-frontend-sinal.md, S02).
// On a computer: the side menu with the mark, the bell and the toggle on top,
// "Nova conversa", the search, the places in areas and the account at
// the foot; it collapses to a rail of icons (remembered on this device, every
// control keeps its name and shows it on hover and keyboard focus). On a phone:
// a top bar that leaves while the content scrolls down, a bottom bar with four
// places and "Mais". The account and the notices open as a panel, a sheet on a
// phone. Only the content scrolls. The areas' titles ("Meu dia",
// "Relacionamento", "Assistente") are buttons that close and open their group,
// remembered on this device; a closed group still shows the place in view, and
// the rail shows every place. "Mais" lists its places under the same areas.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const PLACES = ["Início", "Conversa", "Tarefas", "Agenda", "Notas", "Contatos", "Avaliações", "CRM", "Memória", "Rotinas"];
/** A place as its link reads: Tarefas may carry today's count. */
const asLink = (place: string) => (place === "Tarefas" ? /^Tarefas( \d+)?$/ : place);

const sidebar = (page: Page) => page.locator("aside");

async function openHome(page: Page) {
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
}

test("the side menu holds Nova conversa, the search, the ten places in four areas and the account", async ({ page }) => {
  await openHome(page);
  const aside = sidebar(page);
  await expect(aside.getByRole("link", { name: "Nova conversa" })).toHaveAttribute("href", "/conversa");
  await expect(aside.getByRole("button", { name: "Buscar" })).toBeVisible();
  await expect(aside.getByRole("button", { name: /^Abrir avisos/ })).toBeVisible();
  const nav = aside.getByRole("navigation", { name: "Navegação principal" });
  await expect(nav.getByRole("link")).toHaveText(PLACES.map(asLink));
  // Four areas: the first has no title, the others are lists named by theirs.
  // Consultório only comes with its first screen.
  await expect(nav.getByRole("list")).toHaveCount(4);
  await expect(nav.getByRole("list", { name: "Meu dia" }).getByRole("link")).toHaveText([asLink("Tarefas"), "Agenda", "Notas"]);
  await expect(nav.getByRole("list", { name: "Relacionamento" }).getByRole("link")).toHaveText(["Contatos", "Avaliações", "CRM"]);
  await expect(nav.getByRole("list", { name: "Assistente" }).getByRole("link")).toHaveText(["Memória", "Rotinas"]);
  await expect(nav.getByText("Consultório")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  // Settings and sign-out live in the account panel, never loose in the menu.
  await expect(aside.getByRole("link", { name: "Configurações" })).toHaveCount(0);
  await expect(aside.getByRole("button", { name: "Sair" })).toHaveCount(0);
  await expectAccessible(page, "menu lateral");
  expect(await tooSmallControls(page)).toEqual([]);
});

test("the account panel has the ways into the settings, the version, the theme and Sair", async ({ page }) => {
  await openHome(page);
  const account = sidebar(page).getByRole("button", { name: /^Menu da conta:/ });
  const panel = await openAccountMenu(page);
  await expect(panel).toBeVisible();
  await expect(account).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("link")).toHaveText(["Conta e perfil", "Segurança", "Avisos", "Configurações"]);
  // Opening puts the focus on the first choice.
  await expect(panel.getByRole("link", { name: "Conta e perfil" })).toBeFocused();
  await expect(panel.getByRole("listitem").filter({ hasText: "Versão" })).toHaveText(`Versão${APP_VERSION}`);
  await expect(panel.getByRole("group", { name: "Tema" }).getByRole("radio")).toHaveCount(3);
  await expect(panel.getByRole("button", { name: "Sair", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Fechar" })).toBeVisible();
  // The panel sits above the account, whole, and the menu stays where it was.
  await expect(panel).toBeInViewport({ ratio: 1 });
  await expectAccessible(page, "painel da conta");
  expect(await tooSmallControls(page)).toEqual([]);

  // Tab never leaves the panel: after its last control comes the first one again.
  await panel.getByRole("button", { name: "Fechar" }).focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("aside, main"))).toBe(false);

  // Escape closes it and gives the focus back; a click on the page around it closes it too.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(account).toHaveAttribute("aria-expanded", "false");
  await expect(account).toBeFocused();
  await account.click();
  await page.mouse.click(900, 500);
  await expect(panel).toHaveCount(0);
  await account.click();
  await panel.getByRole("button", { name: "Fechar" }).click();
  await expect(panel).toHaveCount(0);

  // Each way in is an address; picking one closes the panel.
  for (const [name, address] of [
    ["Segurança", /\/configuracoes\/seguranca$/],
    ["Avisos", /\/configuracoes\/avisos$/],
    ["Conta e perfil", /\/configuracoes\/conta$/],
    ["Configurações", /\/configuracoes\/conta$/],
  ] as const) {
    await account.click();
    await panel.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(address);
    await expect(panel).toHaveCount(0);
  }
});

test("the account panel switches the theme of this device", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openHome(page);
  const panel = await openAccountMenu(page);
  const theme = panel.getByRole("group", { name: "Tema" });
  await expect(theme.getByRole("radio", { name: "Como o sistema" })).toBeChecked();
  await theme.getByRole("radio", { name: "Escuro" }).check({ force: true });
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("zuri.theme"))).toBe("dark");
  await expectAccessible(page, "painel da conta (escuro)");
  await theme.getByRole("radio", { name: "Claro" }).check({ force: true });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("zuri.theme"))).toBe("light");
});

test("Ctrl Shift O opens a new conversation from anywhere, never over another dialog", async ({ page }) => {
  await openHome(page);
  await page.keyboard.press("Control+Shift+O");
  await expect(page).toHaveURL(/\/conversa$/);
  await page.goto("/tarefas");
  await page.getByRole("button", { name: /^Abrir avisos/ }).click();
  await page.keyboard.press("Control+Shift+O");
  await expect(page).toHaveURL(/\/tarefas$/);
});

test("only the content scrolls: the window stays still and the menu never leaves", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openHome(page);
  await page.goto("/configuracoes/seguranca");
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
  const main = page.locator("main");
  await expect.poll(() => main.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
  const account = sidebar(page).getByRole("button", { name: /^Menu da conta:/ });
  const before = await account.boundingBox();
  await main.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeGreaterThan(200);
  expect(await page.evaluate(() => [window.scrollY, document.documentElement.scrollHeight - window.innerHeight])).toEqual([0, 0]);
  expect(await account.boundingBox()).toEqual(before);
  await expect(account).toBeInViewport({ ratio: 1 });
});

test("the palette goes to the same places as the menu, in the same order", async ({ page }) => {
  await openHome(page);
  const places = await sidebar(page).getByRole("navigation", { name: "Navegação principal" }).getByRole("link").allInnerTexts();
  await page.keyboard.press("Control+k");
  const options = page.getByRole("dialog", { name: "Buscar e ir para" }).getByRole("group", { name: "Ir para" }).getByRole("option");
  await expect(options.first()).toBeVisible();
  const listed = (await options.allInnerTexts()).slice(0, places.length);
  expect(listed).toEqual(places.map((place) => place.replace(/\s+\d+$/, "").trim()));
});

test("collapsing keeps every control named, remembers the choice and expands again", async ({ page }) => {
  await openHome(page);
  const aside = sidebar(page);
  const wide = (await aside.boundingBox())?.width ?? 0;
  expect(wide).toBeGreaterThan(200);

  await expect(aside.getByRole("button", { name: "Recolher menu" })).toHaveAttribute("aria-expanded", "true");
  await aside.getByRole("button", { name: "Recolher menu" }).click();
  await expect(aside).toHaveAttribute("data-collapsed", "true");
  await expect(aside.getByRole("button", { name: "Expandir menu" })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await aside.boundingBox())?.width).toBeLessThanOrEqual(72);

  // Labels leave the screen but stay as accessible names.
  for (const place of PLACES) await expect(aside.getByRole("link", { name: asLink(place), exact: true })).toBeVisible();
  await expect(aside.getByRole("link", { name: "Nova conversa" })).toBeVisible();
  await expect(aside.getByRole("button", { name: "Buscar" })).toBeVisible();
  await expect(aside.getByRole("button", { name: /^Abrir avisos/ })).toBeVisible();
  await expect(aside.getByRole("button", { name: /^Menu da conta:/ })).toBeVisible();
  await expect(aside.getByRole("link", { name: "Início" }).getByText("Início", { exact: true })).toHaveClass(/sr-only/);
  await expect(page.locator("main")).toBeInViewport();
  expect(await tooSmallControls(page)).toEqual([]);
  // The account panel opens beside the rail, whole.
  const panel = await openAccountMenu(page);
  await expect(panel).toBeInViewport({ ratio: 1 });
  expect((await panel.boundingBox())?.x).toBeGreaterThanOrEqual(72);
  await page.keyboard.press("Escape");
  // So do the notices.
  await aside.getByRole("button", { name: /^Abrir avisos/ }).click();
  const notices = page.getByRole("dialog", { name: "Avisos" });
  await expect(notices).toBeInViewport({ ratio: 1 });
  expect((await notices.boundingBox())?.x).toBeGreaterThanOrEqual(72);
  await page.keyboard.press("Escape");

  // Still collapsed after a reload: a look remembered on this device.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  await expect(aside).toHaveAttribute("data-collapsed", "true");
  expect(await page.evaluate(() => localStorage.getItem("zuri.sidebar"))).toBe("collapsed");

  await aside.getByRole("button", { name: "Expandir menu" }).click();
  await expect(aside).toHaveAttribute("data-collapsed", "false");
  await expect(aside.getByText("Início", { exact: true })).toBeVisible();
  await page.reload();
  await expect(aside.getByRole("button", { name: "Recolher menu" })).toBeVisible();
});

test("on the rail the keyboard reaches every control, each icon shows its name on hover and focus, and Escape hides it", async ({ page }) => {
  await openHome(page);
  const aside = sidebar(page);
  await aside.getByRole("button", { name: "Recolher menu" }).click();
  const tip = (name: string) => aside.locator('.zuri-tip > [aria-hidden="true"]', { hasText: new RegExp(`^${name}$`) });

  await expect(tip("Tarefas")).toBeHidden();
  await aside.getByRole("link", { name: asLink("Tarefas") }).hover();
  await expect(tip("Tarefas")).toBeVisible();
  // The name sits beside the rail, whole, never cut by the menu's own scroll area.
  await expect(tip("Tarefas").locator("span")).toBeInViewport({ ratio: 1 });
  expect((await tip("Tarefas").locator("span").boundingBox())?.x).toBeGreaterThanOrEqual(((await aside.boundingBox())?.width ?? 0) - 2);
  // The pointer can move onto the name without losing it (WCAG 1.4.13).
  await tip("Tarefas").locator("span").hover();
  await expect(tip("Tarefas")).toBeVisible();
  await page.mouse.move(900, 400);
  await expect(tip("Tarefas")).toBeHidden();

  // Keyboard: from the toggle, Tab walks Nova conversa, the search, the ten places and the account, in this order.
  await aside.getByRole("button", { name: "Expandir menu" }).focus();
  await page.keyboard.press("Tab");
  await expect(aside.getByRole("link", { name: "Nova conversa" })).toBeFocused();
  await expect(tip("Nova conversa")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip("Nova conversa")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(aside.getByRole("button", { name: "Buscar" })).toBeFocused();
  await expect(tip("Buscar")).toBeVisible();
  for (const place of PLACES) {
    await page.keyboard.press("Tab");
    await expect(aside.getByRole("link", { name: asLink(place), exact: true })).toBeFocused();
    await expect(tip(place)).toBeVisible();
  }
  await page.keyboard.press("Tab");
  await expect(aside.getByRole("button", { name: /^Menu da conta:/ })).toBeFocused();
  // Enter on a place opens it.
  await aside.getByRole("link", { name: "Rotinas" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/rotinas$/);

  // Enter on the toggle expands the menu; no names beside the icons once labels show.
  await aside.getByRole("button", { name: "Expandir menu" }).focus();
  await page.keyboard.press("Enter");
  await expect(aside).toHaveAttribute("data-collapsed", "false");
  await expect(aside.getByRole("button", { name: "Recolher menu" })).toBeFocused();
  await expect(aside.locator('.zuri-tip > [aria-hidden="true"]')).toHaveCount(0);
});

const MY_DAY = ["Tarefas", "Agenda", "Notas"];
const RELATIONS = ["Contatos", "Avaliações", "CRM"];
const ASSISTANT = ["Memória", "Rotinas"];
const group = (page: Page, name: string) => sidebar(page).getByRole("button", { name, exact: true });
const place = (page: Page, name: string) => sidebar(page).getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: asLink(name), exact: true });
/** The height a place takes in the menu: its list item (by tag: a folded one has no role left), which a closed group folds to nothing. */
const rowHeight = (page: Page, to: string) =>
  sidebar(page)
    .locator("li")
    .filter({ has: page.locator(`a[href="${to}"]`) })
    .evaluate((item) => item.getBoundingClientRect().height);

test("a group's title closes and opens the group, by pointer and by keyboard, and the choice is remembered", async ({ page }) => {
  await openHome(page);
  const nav = sidebar(page).getByRole("navigation", { name: "Navegação principal" });
  // Only the groups with a title can close: Início and Conversa are always there.
  await expect(nav.getByRole("button")).toHaveText(["Meu dia", "Relacionamento", "Assistente"]);
  await expect(group(page, "Meu dia")).toHaveAttribute("aria-expanded", "true");
  await expect(group(page, "Relacionamento")).toHaveAttribute("aria-expanded", "true");
  const before = (await group(page, "Relacionamento").boundingBox())?.y ?? 0;

  await group(page, "Meu dia").click();
  await expect(group(page, "Meu dia")).toHaveAttribute("aria-expanded", "false");
  for (const name of MY_DAY) await expect(place(page, name)).toBeHidden();
  for (const name of ["Início", "Conversa", ...RELATIONS, ...ASSISTANT]) await expect(place(page, name)).toBeVisible();
  // The places fold to nothing: the next group moves up to the title.
  await expect.poll(() => rowHeight(page, "/tarefas")).toBe(0);
  await expect.poll(async () => (await group(page, "Relacionamento").boundingBox())?.y).toBeLessThan(before - 100);
  // Folded places leave the keyboard's way too: Tab goes from one title to the next.
  await group(page, "Meu dia").focus();
  await page.keyboard.press("Tab");
  await expect(group(page, "Relacionamento")).toBeFocused();
  // The list keeps its name for screen readers, and the menu its target sizes.
  await expect(nav.getByRole("list", { name: "Relacionamento" }).getByRole("link")).toHaveText(RELATIONS);
  expect(await tooSmallControls(page)).toEqual([]);

  // Remembered on this device, apart from the rail's choice.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  await expect(group(page, "Meu dia")).toHaveAttribute("aria-expanded", "false");
  await expect(place(page, "Tarefas")).toBeHidden();
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "false");

  // The keyboard opens it again, and closes the other one with the space bar.
  await group(page, "Meu dia").focus();
  await page.keyboard.press("Enter");
  await expect(group(page, "Meu dia")).toHaveAttribute("aria-expanded", "true");
  for (const name of MY_DAY) await expect(place(page, name)).toBeVisible();
  await expect.poll(() => rowHeight(page, "/tarefas")).toBe(44);
  await page.keyboard.press("Tab");
  await expect(place(page, "Tarefas")).toBeFocused();
  await group(page, "Relacionamento").focus();
  await page.keyboard.press("Space");
  await expect(group(page, "Relacionamento")).toHaveAttribute("aria-expanded", "false");
  for (const name of RELATIONS) await expect(place(page, name)).toBeHidden();
  for (const name of [...MY_DAY, ...ASSISTANT]) await expect(place(page, name)).toBeVisible();
  await group(page, "Relacionamento").click();
  for (const name of PLACES) await expect(place(page, name)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("zuri.sidebar.groups"))).toBe("");
});

test("a closed group still shows the place in view, and only it", async ({ page }) => {
  await openHome(page);
  await place(page, "Agenda").click();
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
  await group(page, "Meu dia").click();
  await expect(place(page, "Agenda")).toBeVisible();
  await expect(place(page, "Agenda")).toHaveAttribute("aria-current", "page");
  for (const name of MY_DAY.filter((other) => other !== "Agenda")) await expect(place(page, name)).toBeHidden();
  await expect.poll(() => rowHeight(page, "/agenda")).toBe(44);
  await expect.poll(() => rowHeight(page, "/notas")).toBe(0);
  await expect(place(page, "Agenda")).toBeInViewport({ ratio: 1 });

  // Leaving the group folds it whole; the place now in view shows in its own closed group.
  await place(page, "Contatos").click();
  await expect(page.getByRole("heading", { level: 1, name: "Contatos" })).toBeVisible();
  for (const name of MY_DAY) await expect(place(page, name)).toBeHidden();
  await group(page, "Relacionamento").click();
  await expect(place(page, "Contatos")).toBeVisible();
  await expect(place(page, "Avaliações")).toBeHidden();
  await expect(place(page, "CRM")).toBeHidden();

  // Arriving another way (the palette) at a place of a closed group shows it there too.
  await page.keyboard.press("Control+K");
  await page.getByRole("dialog").getByRole("combobox").fill("Notas");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notas$/);
  await expect(place(page, "Notas")).toBeVisible();
  await expect(place(page, "Contatos")).toBeHidden();
  // A sub-address counts as the place.
  await page.goto("/crm/credenciais");
  await expect(place(page, "CRM")).toBeVisible();
  await expect(place(page, "Notas")).toBeHidden();

  // The last area folds the same way, and keeps the place in view after a reload.
  await place(page, "Rotinas").click();
  await expect(page).toHaveURL(/\/rotinas$/);
  await group(page, "Assistente").click();
  await expect(group(page, "Assistente")).toHaveAttribute("aria-expanded", "false");
  await expect(place(page, "Memória")).toBeHidden();
  await page.reload();
  await expect(group(page, "Assistente")).toHaveAttribute("aria-expanded", "false");
  await expect(place(page, "Rotinas")).toHaveAttribute("aria-current", "page");
  await expect(place(page, "Memória")).toBeHidden();
});

test("the rail shows every place whatever group is closed, and the wide menu gets the choice back", async ({ page }) => {
  await openHome(page);
  await group(page, "Meu dia").click();
  await group(page, "Relacionamento").click();
  await expect(place(page, "Tarefas")).toBeHidden();
  await sidebar(page).getByRole("button", { name: "Recolher menu" }).click();
  await expect(sidebar(page)).toHaveAttribute("data-collapsed", "true");
  for (const name of PLACES) await expect(place(page, name)).toBeVisible();
  await expect.poll(() => rowHeight(page, "/tarefas")).toBe(44);
  // No title to click on the rail, for the pointer or for a screen reader; the lists keep their names.
  await expect(sidebar(page).getByRole("button", { name: "Meu dia", exact: true })).toHaveCount(0);
  await expect(sidebar(page).getByRole("list", { name: "Meu dia" }).getByRole("link")).toHaveCount(3);
  expect(await tooSmallControls(page)).toEqual([]);

  await sidebar(page).getByRole("button", { name: "Expandir menu" }).click();
  await expect(group(page, "Meu dia")).toHaveAttribute("aria-expanded", "false");
  await expect(group(page, "Relacionamento")).toHaveAttribute("aria-expanded", "false");
  for (const name of [...MY_DAY, ...RELATIONS]) await expect(place(page, name)).toBeHidden();
  for (const name of ASSISTANT) await expect(place(page, name)).toBeVisible();
});

test("another tab follows a group closed here", async ({ page, context }) => {
  await openHome(page);
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  await group(page, "Relacionamento").click();
  await expect(group(other, "Relacionamento")).toHaveAttribute("aria-expanded", "false");
  await expect(place(other, "Contatos")).toBeHidden();
  await expect(group(other, "Meu dia")).toHaveAttribute("aria-expanded", "true");
  await group(page, "Relacionamento").click();
  await expect(place(other, "Contatos")).toBeVisible();
});

test("anything else stored as the closed groups opens them all and runs nothing, the groups of the old menu too", async ({ page }) => {
  await page.goto("/entrar");
  // "web.nav.groupOrganize" is a group the menu had before the areas.
  await page.evaluate(() => localStorage.setItem("zuri.sidebar.groups", '"><img src=x onerror="window.pwned=1">,web.nav.groupweb.nav.groupOrganize'));
  await openHome(page);
  for (const name of PLACES) await expect(place(page, name)).toBeVisible();
  expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
  await expect(sidebar(page).locator("img")).toHaveCount(0);
  // And the titles still work from there.
  await group(page, "Meu dia").click();
  await expect(place(page, "Tarefas")).toBeHidden();
});

test("the groups fold with a short transition, and with none for who asks for less motion", async ({ page }) => {
  await openHome(page);
  const durations = () =>
    sidebar(page)
      .locator("li, button[aria-expanded] > svg")
      .evaluateAll((items) => [...new Set(items.filter((item) => item.closest("nav")).map((item) => getComputedStyle(item).transitionDuration))]);
  expect(await durations()).toEqual(["0.2s"]);
  // What moves is the row's height, with the place leaving sight at the end of it.
  expect(await sidebar(page).locator("nav li").first().evaluate((item) => getComputedStyle(item).transitionProperty)).toBe("grid-template-rows, visibility");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await durations()).toEqual(["0s"]);
  await group(page, "Meu dia").click();
  // No waiting: the places are gone at once.
  expect(await rowHeight(page, "/tarefas")).toBe(0);
  await expect(place(page, "Tarefas")).toBeHidden();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the menu with a group closed has no serious violation (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/entrar");
    await page.evaluate(() => localStorage.setItem("zuri.sidebar.groups", "web.nav.groupMyDay"));
    await page.goto("/agenda");
    await signIn(page);
    await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
    await expect(place(page, "Agenda")).toBeVisible();
    await expect(place(page, "Notas")).toBeHidden();
    await expectAccessible(page, `menu com grupo recolhido (${scheme})`);
    await group(page, "Meu dia").focus();
    await expectAccessible(page, `título do grupo com foco (${scheme})`);
    expect(await tooSmallControls(page)).toEqual([]);
  });
}

test("on a phone nothing folds: Mais lists every place under the same areas, even with groups closed on a computer before @mobile", async ({ page }) => {
  await page.goto("/entrar");
  await page.evaluate(() => localStorage.setItem("zuri.sidebar.groups", "web.nav.groupMyDayweb.nav.groupRelationsweb.nav.groupAssistant"));
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  const bar = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(bar.getByRole("link")).toHaveText(["Início", "Conversa", asLink("Tarefas"), "Agenda"]);
  await bar.getByRole("button", { name: "Mais", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Mais" });
  await expect(sheet.getByRole("link")).toHaveText(["Notas", "Contatos", "Avaliações", "CRM", "Memória", "Rotinas", "Configurações"]);
  // The areas of the menu, each a list named by its title; the bar's places are left out, so is an area left empty.
  await expect(sheet.getByRole("heading", { level: 3 })).toHaveText(["Meu dia", "Relacionamento", "Assistente", "Sistema"]);
  await expect(sheet.getByRole("list", { name: "Meu dia" }).getByRole("link")).toHaveText(["Notas"]);
  await expect(sheet.getByRole("list", { name: "Relacionamento" }).getByRole("link")).toHaveText(RELATIONS);
  await expect(sheet.getByRole("list", { name: "Assistente" }).getByRole("link")).toHaveText(ASSISTANT);
  await expect(sheet.getByRole("list", { name: "Sistema" }).getByRole("link")).toHaveText(["Configurações"]);
  await expect(page.getByRole("button", { name: /^(Meu dia|Relacionamento|Assistente)$/ })).toHaveCount(0);
  await expectAccessible(page, "Mais por áreas");
  expect(await tooSmallControls(page)).toEqual([]);
});

test("another tab follows the change", async ({ page, context }) => {
  await openHome(page);
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Recolher menu" }).click();
  await expect(sidebar(other)).toHaveAttribute("data-collapsed", "true");
});

for (const scheme of ["light", "dark"] as const) {
  test(`the collapsed rail and the panels beside it have no serious violation (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openHome(page);
    await sidebar(page).getByRole("button", { name: "Recolher menu" }).click();
    await sidebar(page).getByRole("link", { name: asLink("Tarefas") }).hover();
    await expectAccessible(page, `menu recolhido (${scheme})`);
    await sidebar(page).getByRole("button", { name: /^Abrir avisos/ }).click();
    await expect(page.getByRole("dialog", { name: "Avisos" }).getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
    await expectAccessible(page, `avisos ao lado do menu recolhido (${scheme})`);
    expect(await tooSmallControls(page)).toEqual([]);
    // The browser's back closes the panel with the page it was opened on.
    await page.keyboard.press("Escape");
    await page.goto("/tarefas");
    await sidebar(page).getByRole("button", { name: /^Abrir avisos/ }).click();
    await expect(page.getByRole("dialog", { name: "Avisos" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog", { name: "Avisos" })).toHaveCount(0);
  });

  test(`the phone's shell, its sheets and the bottom bar have no serious violation (${scheme}) @mobile`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    await openHome(page);
    await expectAccessible(page, `casca no celular (${scheme})`);
    expect(await tooSmallControls(page)).toEqual([]);
    await page.getByRole("button", { name: "Mais", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Mais" })).toBeVisible();
    await expectAccessible(page, `folha Mais (${scheme})`);
    expect(await tooSmallControls(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await openAccountMenu(page);
    await expectAccessible(page, `folha da conta (${scheme})`);
    expect(await tooSmallControls(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Abrir avisos/ }).click();
    await expect(page.getByRole("dialog", { name: "Avisos" }).getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
    await expectAccessible(page, `folha de avisos (${scheme})`);
    expect(await tooSmallControls(page)).toEqual([]);
  });
}

test("on a phone: a top bar, a bottom bar with four places and Mais, and no side menu, even when collapsed before @mobile", async ({ page }) => {
  await page.goto("/entrar");
  await page.evaluate(() => localStorage.setItem("zuri.sidebar", "collapsed"));
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await expect(sidebar(page)).toBeHidden();
  const banner = page.getByRole("banner");
  await expect(banner.getByText("Zuri", { exact: true })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Buscar" })).toBeVisible();
  await expect(banner.getByRole("button", { name: /^Abrir avisos/ })).toBeVisible();
  await expect(banner.getByRole("button", { name: /^Menu da conta:/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Recolher|Expandir) menu$/ })).toHaveCount(0);

  const bar = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(bar.getByRole("link")).toHaveText(["Início", "Conversa", asLink("Tarefas"), "Agenda"]);
  await expect(bar.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  const more = bar.getByRole("button", { name: "Mais", exact: true });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  // The bar is the last thing on the screen, whole.
  await expect(bar).toBeInViewport({ ratio: 1 });
  const box = await bar.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);

  // "Mais": the other places from the same list, by area, and the settings.
  await more.click();
  const sheet = page.getByRole("dialog", { name: "Mais" });
  await expect(sheet).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(sheet.getByRole("link")).toHaveText(["Notas", "Contatos", "Avaliações", "CRM", "Memória", "Rotinas", "Configurações"]);
  await expect(sheet.getByRole("link", { name: "Notas" })).toBeFocused();
  // Tab stays inside the sheet.
  await sheet.getByRole("button", { name: "Fechar" }).focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("main, header, nav.zuri-tab-bar"))).toBe(false);
  // Escape closes it and gives the focus back to "Mais".
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(more).toBeFocused();
  // A tap on the shaded page closes it too, and so does the X.
  await more.click();
  await page.mouse.click(195, 60);
  await expect(sheet).toHaveCount(0);
  await more.click();
  await sheet.getByRole("button", { name: "Fechar" }).click();
  await expect(sheet).toHaveCount(0);
  // A place picked closes it, and "Mais" stays lit while the place is one of its own.
  await more.click();
  await sheet.getByRole("link", { name: "Rotinas" }).click();
  await expect(page).toHaveURL(/\/rotinas$/);
  await expect(sheet).toHaveCount(0);
  await expect(more).toHaveAttribute("aria-current", "true");
  await expect(bar.getByRole("link", { name: "Início" })).not.toHaveAttribute("aria-current", "page");
  await bar.getByRole("link", { name: asLink("Tarefas") }).click();
  await expect(page).toHaveURL(/\/tarefas$/);
  await expect(more).not.toHaveAttribute("aria-current", "true");
});

test("on a phone the account opens as a sheet from the top bar @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  const account = page.getByRole("banner").getByRole("button", { name: /^Menu da conta:/ });
  const sheet = await openAccountMenu(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link")).toHaveText(["Conta e perfil", "Segurança", "Avisos", "Configurações"]);
  await expect(sheet.getByRole("listitem").filter({ hasText: "Versão" })).toHaveText(`Versão${APP_VERSION}`);
  // A sheet: as wide as the screen, resting on its bottom edge.
  const box = await sheet.boundingBox();
  expect(box?.width).toBe(390);
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(account).toBeFocused();
  await account.click();
  await sheet.getByRole("link", { name: "Segurança" }).click();
  await expect(page).toHaveURL(/\/configuracoes\/seguranca$/);
  await expect(sheet).toHaveCount(0);
});

test("on a phone the top bar leaves while the content scrolls down and returns on the way up; the bottom bar stays @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await page.goto("/configuracoes/seguranca");
  await expect(page.getByRole("heading", { level: 1, name: "Segurança" })).toBeVisible();
  const main = page.locator("main");
  await expect.poll(() => main.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(900);
  const banner = page.getByRole("banner");
  const bar = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(banner).toBeInViewport({ ratio: 1 });

  // The owner's scroll, step by step, as a finger would.
  const scrollBy = async (step: number, times: number) => {
    for (let i = 0; i < times; i++) {
      await main.evaluate((el, by) => el.scrollBy(0, by), step);
      await page.waitForTimeout(40);
    }
  };
  await scrollBy(60, 8);
  await expect(banner).toHaveAttribute("data-off", "true");
  await expect(banner).not.toBeInViewport();
  await expect(bar).toBeInViewport({ ratio: 1 });
  // The window itself never scrolls.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // The bar's own coming and going moves the content: wait it out, as the shell does.
  await page.waitForTimeout(400);
  await scrollBy(-40, 4);
  await expect(banner).toHaveAttribute("data-off", "false");
  await expect(banner).toBeInViewport({ ratio: 1 });

  // Away again; another place brings it back.
  await page.waitForTimeout(400);
  await scrollBy(60, 8);
  await expect(banner).toHaveAttribute("data-off", "true");
  await bar.getByRole("link", { name: "Agenda" }).click();
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(banner).toHaveAttribute("data-off", "false");
  await expect(banner).toBeInViewport({ ratio: 1 });
});
