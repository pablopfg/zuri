import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, expectFits, signIn, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// The Conversa screen of the Sinal (PR S05): the list of conversations as a
// column with its search, groups by day and a "Mais opções" menu on every row
// (rename and delete, line C1 of the plan), the conversation with its lines
// between the days, the notice on a conversation of another day and the phone's
// list in place of the conversation. What the chat does (turns, tools, plans,
// approvals) is in chat.spec.ts.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const tag = () => uniqueTag(test.info().project.name);

/** A conversation made through the API (the simulated model answers at once); returns its id. */
async function converse(page: Page, message: string): Promise<string> {
  const res = await page.request.post("/api/chat", { headers: CSRF, data: { message } });
  expect(res.status()).toBe(200);
  const id = /"conversation":\{"id":"([0-9a-f-]{36})"/.exec(await res.text())?.[1];
  expect(id).toBeTruthy();
  return id as string;
}

async function openChat(page: Page) {
  await page.goto("/conversa");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Conversa" })).toBeVisible();
}

const list = (page: Page) => page.getByRole("complementary", { name: "Conversas" });
const row = (page: Page, title: string) => list(page).getByRole("listitem").filter({ hasText: title });
const DAY = 86_400_000;

/** Answers the reads of the conversations (and a rename, which answers with the conversation) as if `id` had been made and last used `days` days ago. */
async function age(page: Page, id: string, days: number) {
  const older = (iso: string) => new Date(Date.parse(iso) - days * DAY).toISOString();
  const aged = <T extends { id: string; createdAt: string; updatedAt: string }>(conversation: T): T =>
    conversation.id === id ? { ...conversation, createdAt: older(conversation.createdAt), updatedAt: older(conversation.updatedAt) } : conversation;
  await page.route(/\/api\/conversations(\/[0-9a-f-]{36})?(\?.*)?$/, async (route) => {
    if (!["GET", "PATCH"].includes(route.request().method())) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    if (body.conversations) body.conversations = body.conversations.map(aged);
    if (body.conversation) {
      body.conversation = aged(body.conversation);
      if (body.conversation.id === id && body.messages) body.messages = body.messages.map((message: { createdAt: string }) => ({ ...message, createdAt: older(message.createdAt) }));
    }
    await route.fulfill({ response, json: body });
  });
}

test("each row shows when the conversation was used and renames by keyboard, the open one or another", async ({ page }) => {
  const word = tag();
  await openChat(page);
  await converse(page, `Outra ${word}`);
  const open = await converse(page, `Aberta ${word}`);
  await page.goto(`/conversa/${open}`);
  await expect(page.getByRole("heading", { level: 1, name: `Aberta ${word}` })).toBeVisible();

  // The row: the name, the hour under it, and the open one marked.
  await expect(row(page, `Aberta ${word}`).getByRole("link")).toHaveAttribute("aria-current", "page");
  await expect(row(page, `Outra ${word}`).getByRole("link")).not.toHaveAttribute("aria-current", "page");
  await expect(row(page, `Outra ${word}`).locator("time")).toHaveText(/^\d\d:\d\d$/);

  // Rename another conversation without opening it, with the keyboard only.
  const more = row(page, `Outra ${word}`).getByRole("button", { name: `Mais opções para “Outra ${word}”` });
  await more.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Renomear", "Apagar conversa"]);
  await expect(menu.getByRole("menuitem", { name: "Renomear" })).toBeFocused();
  await page.keyboard.press("Enter");
  const rename = page.getByRole("dialog", { name: "Renomear" });
  await expect(rename.getByLabel("Nome da conversa")).toBeFocused();
  await expect(rename.getByLabel("Nome da conversa")).toHaveValue(`Outra ${word}`);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(`Renomeada ${word}`);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Conversa renomeada" })).toBeVisible();
  await expect(rename).toBeHidden();
  // The focus goes back to the row's menu, under its new name; the open conversation did not change.
  await expect(row(page, `Renomeada ${word}`).getByRole("button", { name: `Mais opções para “Renomeada ${word}”` })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/conversa/${open}$`));
  await expect(page.getByRole("heading", { level: 1, name: `Aberta ${word}` })).toBeVisible();
  // Renaming is not using (#272): the renamed row stays below the one used after it, also after a reload.
  const order = () => list(page).getByRole("listitem").filter({ hasText: word }).getByRole("link");
  await expect(order()).toHaveText([new RegExp(`^Aberta ${word}`), new RegExp(`^Renomeada ${word}`)]);
  await page.reload();
  await expect(order()).toHaveText([new RegExp(`^Aberta ${word}`), new RegExp(`^Renomeada ${word}`)]);
  await row(page, `Renomeada ${word}`).getByRole("button", { name: `Mais opções para “Renomeada ${word}”` }).focus();
  await expect(page.getByRole("heading", { level: 1, name: `Aberta ${word}` })).toBeVisible();

  // The menu and the dialog pass the accessibility check too, in the dark theme as well.
  await page.keyboard.press("Enter");
  await expectAccessible(page, "menu da linha");
  await page.keyboard.press("Enter");
  await expectAccessible(page, "renomear");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "renomear, escuro");
  await page.emulateMedia({ colorScheme: "light" });
  // Esc gives up on a rename: nothing leaves the browser and the name stays.
  let saves = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH") saves += 1;
  });
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");
  await expect(rename).toBeHidden();
  await expect(row(page, `Renomeada ${word}`).getByRole("link")).toHaveText(new RegExp(`^Renomeada ${word}\\d\\d:\\d\\d$`));
  expect(saves).toBe(0);

  // The open conversation renames from its own menu, at the top: title, tab and row follow.
  // The menu beside the title has no name of its own: the title is right there.
  await page.getByRole("button", { name: "Mais opções", exact: true }).click();
  await page.getByRole("menuitem", { name: "Renomear" }).click();
  await rename.getByLabel("Nome da conversa").fill(`Título novo ${word}`);
  await rename.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Título novo ${word}` })).toBeVisible();
  await expect(page).toHaveTitle(`Título novo ${word} · Zuri`);
  await expect(row(page, `Título novo ${word}`).getByRole("link")).toHaveAttribute("aria-current", "page");
});

test("deleting by keyboard: another conversation leaves the list and the open one stays; the open one leads to a new conversation", async ({ page }) => {
  const word = tag();
  await openChat(page);
  await converse(page, `Sai ${word}`);
  const open = await converse(page, `Fica ${word}`);
  await page.goto(`/conversa/${open}`);
  await expect(page.getByRole("heading", { level: 1, name: `Fica ${word}` })).toBeVisible();

  await row(page, `Sai ${word}`).getByRole("button", { name: /^Mais opções/ }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Apagar conversa" })).toBeFocused();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: "Apagar esta conversa?" });
  await expect(confirm.getByText(`“Sai ${word}”`)).toBeVisible();
  // The standard confirmation: opening focuses Cancelar, and Cancelar deletes nothing.
  await expect(confirm.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toBeHidden();
  await expect(row(page, `Sai ${word}`)).toHaveCount(1);
  await expect(row(page, `Sai ${word}`).getByRole("button", { name: /^Mais opções/ })).toBeFocused();

  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "Apagar conversa" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Conversa apagada" })).toBeVisible();
  await expect(row(page, `Sai ${word}`)).toHaveCount(0);
  // The row is gone: the focus waits on the list's search, never lost on the page.
  await expect(list(page).getByRole("searchbox", { name: "Buscar conversas" })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/conversa/${open}$`));
  await expect(page.getByRole("log").getByText(`Fica ${word}`, { exact: true })).toBeVisible();

  // Deleting the open one, from its row this time, leaves a new conversation.
  await row(page, `Fica ${word}`).getByRole("button", { name: /^Mais opções/ }).click();
  await page.getByRole("menuitem", { name: "Apagar conversa" }).click();
  await confirm.getByRole("button", { name: "Apagar conversa" }).click();
  await expect(page).toHaveURL(/\/conversa$/);
  await expect(page.getByRole("heading", { level: 1, name: "Conversa" })).toBeVisible();
  await expect(row(page, `Fica ${word}`)).toHaveCount(0);
});

test("a conversation of another day says so and points to today's; today's has no notice", async ({ page }) => {
  const word = tag();
  await openChat(page);
  const old = await converse(page, `Antiga ${word}`);
  const today = await converse(page, `De hoje ${word}`);
  await age(page, old, 1);

  await page.goto(`/conversa/${old}`);
  await expect(page.getByRole("heading", { level: 1, name: `Antiga ${word}` })).toBeVisible();
  await expect(page.getByText(/^Desde ontem, \d\d:\d\d$/)).toBeVisible();
  // The line between the days names yesterday, and the row sits under "Ontem".
  await expect(page.getByRole("log").getByRole("listitem").first()).toHaveText("Ontem");
  await expect(list(page).getByRole("region", { name: "Ontem" }).getByRole("link", { name: new RegExp(`Antiga ${word}`) })).toBeVisible();
  const notice = page.getByRole("note");
  await expect(notice).toContainText("Conversa anterior. Escrever aqui continua esta conversa.");
  // The composer still works here: the notice explains, it never blocks.
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toBeEnabled();
  await expectAccessible(page, "conversa anterior");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "conversa anterior, escuro");
  await page.emulateMedia({ colorScheme: "light" });

  // Renaming is not using (#272): the page keeps the day the server answers, so the notice and the group stay.
  await page.getByRole("button", { name: "Mais opções", exact: true }).click();
  await page.getByRole("menuitem", { name: "Renomear" }).click();
  await page.getByRole("dialog", { name: "Renomear" }).getByLabel("Nome da conversa").fill(`Velha ${word}`);
  await page.getByRole("dialog", { name: "Renomear" }).getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Velha ${word}` })).toBeVisible();
  await expect(notice).toContainText("Conversa anterior.");
  await expect(page.getByText(/^Desde ontem, \d\d:\d\d$/)).toBeVisible();
  await expect(list(page).getByRole("region", { name: "Ontem" }).getByRole("link", { name: new RegExp(`Velha ${word}`) })).toBeVisible();

  await notice.getByRole("link", { name: `A de hoje segue em “De hoje ${word}”` }).click();
  await expect(page).toHaveURL(new RegExp(`/conversa/${today}$`));
  await expect(page.getByRole("heading", { level: 1, name: `De hoje ${word}` })).toBeVisible();
  await expect(page.getByText(/^Desde hoje, \d\d:\d\d$/)).toBeVisible();
  await expect(page.getByRole("log").getByRole("listitem").first()).toHaveText("Hoje");
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a conversation of another day with none today has the notice without a link, and an older one shows its date", async ({ page }) => {
  const word = tag();
  await openChat(page);
  const old = await converse(page, `Sozinha ${word}`);
  // Every conversation of the list is older than today: nothing to point to.
  await page.route(/\/api\/conversations(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const stamp = new Date(Date.now() - 9 * DAY).toISOString();
    body.conversations = body.conversations.map((conversation: object) => ({ ...conversation, createdAt: stamp, updatedAt: stamp }));
    await route.fulfill({ response, json: body });
  });
  await page.route(new RegExp(`/api/conversations/${old}$`), async (route) => {
    if (!["GET", "PATCH"].includes(route.request().method())) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    const stamp = new Date(Date.now() - 9 * DAY).toISOString();
    body.conversation = { ...body.conversation, createdAt: stamp, updatedAt: stamp };
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/conversa/${old}`);
  await expect(page.getByRole("note")).toHaveText("Conversa anterior. Escrever aqui continua esta conversa.");
  await expect(page.getByRole("note").getByRole("link")).toHaveCount(0);
  await expect(page.getByText(/^Desde \d\d\/\d\d(\/\d{4})?, \d\d:\d\d$/)).toBeVisible();
  await expect(row(page, `Sozinha ${word}`).locator("time")).toHaveText(/^\d\d\/\d\d(\/\d{4})?$/);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a conversation that grows after it is drawn stays at the end, unless the owner went up to read (#287)", async ({ page }) => {
  const word = tag();
  await openChat(page);
  const long = Array.from({ length: 60 }, (_, line) => `linha ${line}`).join("\n");
  const id = await converse(page, `Cresce ${word}\n${long}`);
  await page.request.post("/api/chat", { headers: CSRF, data: { message: long, conversationId: id } });
  await page.goto(`/conversa/${id}`);
  await expect(page.getByRole("log").getByText(/^\(IA simulada\)/).last()).toBeVisible();
  const fromEnd = () =>
    page.evaluate(() => {
      const messages = document.querySelector("[data-chat-scroll]") as HTMLElement;
      return messages.scrollHeight - messages.clientHeight - messages.scrollTop;
    });
  await expect.poll(fromEnd).toBeLessThan(4);

  // The messages get taller without a new one arriving, as when the formatting lands late.
  const pad = (px: string) =>
    page.evaluate((value) => {
      for (const item of document.querySelectorAll<HTMLElement>("[data-chat-scroll] li")) item.style.paddingBottom = value;
    }, px);
  await pad("24px");
  await expect.poll(fromEnd).toBeLessThan(4);

  // Up reading, nothing pulls the owner back down.
  await pad("");
  await page.evaluate(() => (document.querySelector("[data-chat-scroll]") as HTMLElement).scrollTo(0, 0));
  await expect.poll(fromEnd).toBeGreaterThan(240);
  await pad("24px");
  await expect.poll(() => page.evaluate(() => (document.querySelector("[data-chat-scroll]") as HTMLElement).scrollTop)).toBe(0);
});

test("only the messages scroll: the list, the title and the field to write stay on screen", async ({ page }) => {
  const word = tag();
  await openChat(page);
  const long = Array.from({ length: 60 }, (_, line) => `linha ${line}`).join("\n");
  const id = await converse(page, `Longa ${word}\n${long}`);
  await page.request.post("/api/chat", { headers: CSRF, data: { message: long, conversationId: id } });
  await page.goto(`/conversa/${id}`);
  const log = page.getByRole("log");
  await expect(log.getByText(/^\(IA simulada\)/).last()).toBeVisible();

  // The page itself never scrolls here; the messages do, and they open at the end.
  const scroll = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement;
    const messages = document.querySelector("[data-chat-scroll]") as HTMLElement;
    return { main: main.scrollHeight - main.clientHeight, messages: messages.scrollHeight - messages.clientHeight, top: messages.scrollTop };
  });
  expect(scroll.main).toBe(0);
  expect(scroll.messages).toBeGreaterThan(200);
  await expect.poll(() => page.evaluate(() => {
    const messages = document.querySelector("[data-chat-scroll]") as HTMLElement;
    return messages.scrollHeight - messages.clientHeight - messages.scrollTop;
  })).toBeLessThan(4);

  await page.evaluate(() => (document.querySelector("[data-chat-scroll]") as HTMLElement).scrollTo(0, 0));
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toBeInViewport({ ratio: 1 });
  await expect(list(page).getByRole("link", { name: "Nova conversa" })).toBeInViewport({ ratio: 1 });
  // The messages scroll with the keyboard: the area takes the focus and has a name.
  await expect(page.getByRole("region", { name: "Mensagens" })).toHaveAttribute("tabindex", "0");

  // Each turn says who wrote and when; Zuri's has its mark and the hour in view.
  await expect(log.getByText(/^Você, \d\d:\d\d:$/).first()).toBeAttached();
  await expect(log.getByText(/^\d\d:\d\d$/).first()).toBeVisible();
  // Nothing to attach a file with: the field has the microphone (where the browser records) and Enviar.
  const composer = page.getByRole("form", { name: "Escrever para a Zuri" });
  await expect(composer.getByRole("button", { name: "Enviar" })).toBeVisible();
  await expect(composer.locator('input[type="file"]')).toHaveCount(0);
  for (const name of await composer.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))) expect(["Enviar", "Falar em vez de digitar"]).toContain(name);
  await expectFits(page, "conversa longa");
});

// A phone's size in both projects: the computer's browser at this width shows the same arrangement.
test.describe("on a narrow screen", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("on a phone the list takes the place of the conversation, and comes back to it @mobile", async ({ page }) => {
    const word = tag();
    await openChat(page);
    const first = await converse(page, `Primeira ${word}`);
    const second = await converse(page, `Segunda ${word}`);
    await page.goto(`/conversa/${second}`);
    await expect(page.getByRole("heading", { level: 1, name: `Segunda ${word}` })).toBeVisible();
    await expect(list(page)).toBeHidden();
    expect(await tooSmallControls(page)).toEqual([]);
    await expectAccessible(page, "conversa aberta no celular");

    const show = page.getByRole("button", { name: "Ver conversas" });
    await show.click();
    await expect(list(page).getByRole("heading", { level: 2, name: "Conversas" })).toBeFocused();
    // In place of the conversation, not over it.
    await expect(page.getByRole("textbox", { name: "Mensagem" })).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await tooSmallControls(page)).toEqual([]);
    await expectAccessible(page, "lista de conversas no celular");

    // Back: the same conversation, and the focus where it left.
    await list(page).getByRole("button", { name: "Voltar para a conversa" }).click();
    await expect(list(page)).toBeHidden();
    await expect(show).toBeFocused();
    await expect(page.getByRole("heading", { level: 1, name: `Segunda ${word}` })).toBeVisible();

    // Esc closes it too; picking a conversation opens it.
    await show.click();
    await page.keyboard.press("Escape");
    await expect(list(page)).toBeHidden();
    await expect(show).toBeFocused();
    await show.click();
    await list(page).getByRole("link", { name: new RegExp(`Primeira ${word}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/conversa/${first}$`));
    await expect(list(page)).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: `Primeira ${word}` })).toBeVisible();

    // The row's menu works here as well, and "Nova conversa" leaves the list.
    await show.click();
    await row(page, `Segunda ${word}`).getByRole("button", { name: /^Mais opções/ }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Renomear", "Apagar conversa"]);
    await page.keyboard.press("Escape");
    await list(page).getByRole("link", { name: "Nova conversa" }).click();
    await expect(page).toHaveURL(/\/conversa$/);
    await expect(list(page)).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Mensagem" })).toBeVisible();
    await expectFits(page, "conversa nova no celular");
  });
});

test("the list's search and its error state", async ({ page }) => {
  const word = tag();
  await openChat(page);
  await converse(page, `Achável ${word}`);
  await page.reload();
  const search = list(page).getByRole("searchbox", { name: "Buscar conversas" });
  await search.fill(`achavel ${word}`);
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await search.fill(`nada-${word}`);
  await expect(list(page).getByRole("status")).toHaveText("Nenhuma conversa com esse nome. Tente outra palavra.");

  // The list fails: it says so and tries again, and the conversation beside it still works.
  let fail = true;
  await page.route(/\/api\/conversations(\?.*)?$/, (route) => (fail ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "Não deu para carregar. Tente de novo." } }) : route.fallback()));
  await page.reload();
  await expect(list(page).getByRole("alert")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toBeEnabled();
  fail = false;
  await list(page).getByRole("button", { name: "Tentar de novo" }).click();
  await expect(row(page, `Achável ${word}`)).toHaveCount(1);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a conversation deleted somewhere else leaves the list when the owner tries to delete or rename it here", async ({ page }) => {
  const word = tag();
  await openChat(page);
  const first = await converse(page, `Sumiu ${word}`);
  const second = await converse(page, `Também ${word}`);
  await page.reload();
  await expect(row(page, `Sumiu ${word}`)).toHaveCount(1);
  // Another tab, or the bot, deleted both, and the news has not reached this list (a phone back from
  // sleep, say): its reads keep answering the old list, less what the server already told this page is gone.
  const before = (await (await page.request.get("/api/conversations", { headers: CSRF })).json()) as { conversations: { id: string }[]; nextCursor: string | null };
  const told = new Set<string>();
  page.on("response", (response) => {
    if (response.status() === 404) told.add(response.url().split("/").pop() ?? "");
  });
  await page.route(/\/api\/conversations$/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { ...before, conversations: before.conversations.filter((conversation) => !told.has(conversation.id)) } }) : route.fallback(),
  );
  for (const id of [first, second]) expect((await page.request.delete(`/api/conversations/${id}`, { headers: CSRF })).status()).toBe(204);

  await row(page, `Sumiu ${word}`).getByRole("button", { name: /^Mais opções/ }).click();
  await page.getByRole("menuitem", { name: "Apagar conversa" }).click();
  await page.getByRole("dialog", { name: "Apagar esta conversa?" }).getByRole("button", { name: "Apagar conversa" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, `Sumiu ${word}`)).toHaveCount(0);

  await expect(row(page, `Também ${word}`)).toHaveCount(1);
  await row(page, `Também ${word}`).getByRole("button", { name: /^Mais opções/ }).click();
  await page.getByRole("menuitem", { name: "Renomear" }).click();
  await page.getByRole("dialog", { name: "Renomear" }).getByLabel("Nome da conversa").fill(`Outro nome ${word}`);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, word)).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("while Zuri writes in a conversation, its rename and delete are off; another conversation's stay on", async ({ page }) => {
  const word = tag();
  await openChat(page);
  await converse(page, `Parada ${word}`);
  await page.reload();
  const box = page.getByRole("textbox", { name: "Mensagem" });
  // "slow" answers a word every 200 ms: the turn is open while the menus are checked.
  await box.fill(`slow ${word} um dois tres quatro cinco seis sete oito nove dez onze doze`);
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "Parar" })).toBeVisible();
  await page.getByRole("button", { name: "Mais opções", exact: true }).click();
  for (const name of ["Renomear", "Apagar conversa"]) await expect(page.getByRole("menuitem", { name })).toBeDisabled();
  await page.keyboard.press("Escape");
  await row(page, `Parada ${word}`).getByRole("button", { name: /^Mais opções/ }).click();
  for (const name of ["Renomear", "Apagar conversa"]) await expect(page.getByRole("menuitem", { name })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Parar" }).click();
  await expect(page.getByRole("button", { name: "Parar" })).toHaveCount(0);
});

test("older messages come in above and the place on screen stays", async ({ page }) => {
  const word = tag();
  await openChat(page);
  // A message taller than the screen: its start and its end are never in view together.
  const tall = Array.from({ length: 60 }, (_, line) => `linha ${line}`).join("\n");
  const id = await converse(page, `Comprida ${word}\n${tall}`);
  // The first page of this conversation carries its two messages; everything "older" is made up here.
  await page.route(new RegExp(`/api/conversations/${id}(\\?before=.*)?$`), async (route) => {
    if (!["GET", "PATCH"].includes(route.request().method())) return route.fallback();
    const older = route.request().url().includes("before=");
    const response = await route.fetch({ url: route.request().url().replace(/\?before=.*$/, "") });
    const body = await response.json();
    const filler = Array.from({ length: 40 }, (_, line) => ({ ...body.messages[1], id: `antiga-${line}`, content: `antiga ${line}` }));
    await route.fulfill({ response, json: older ? { ...body, messages: filler, hasMore: false } : { ...body, hasMore: true } });
  });
  await page.goto(`/conversa/${id}`);
  const start = page.getByRole("log").getByText(`Comprida ${word}`, { exact: false }).first();
  await expect(start).toBeAttached();
  // The owner goes up to read from the start and asks for what came before.
  const more = page.getByRole("button", { name: "Ver mensagens anteriores" });
  await more.scrollIntoViewIfNeeded();
  const before = await start.evaluate((node) => node.getBoundingClientRect().top);
  await more.click();
  await expect(page.getByRole("log").getByText("antiga 0", { exact: true })).toBeAttached();
  await expect(more).toHaveCount(0);
  // The older ones are above, a scroll away, and what was on screen did not move (the button that left aside).
  expect(await page.evaluate(() => (document.querySelector("[data-chat-scroll]") as HTMLElement).scrollTop)).toBeGreaterThan(200);
  const after = await start.evaluate((node) => node.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThan(80);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test.describe("a device in another zone than the owner's", () => {
  // Twelve hours ahead of São Paulo, the owner's zone: an hour read in the device's zone is never the right one.
  test.use({ timezoneId: "Asia/Tokyo" });

  test("the hours of the list and of the conversation are the owner's", async ({ page }) => {
    const word = tag();
    await openChat(page);
    const id = await converse(page, `Fuso ${word}`);
    const body = (await (await page.request.get(`/api/conversations/${id}`, { headers: CSRF })).json()) as { conversation: { createdAt: string; updatedAt: string } };
    const inSaoPaulo = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    await page.goto(`/conversa/${id}`);
    await expect(row(page, `Fuso ${word}`).locator("time")).toHaveText(inSaoPaulo(body.conversation.updatedAt));
    await expect(page.getByText(`Desde hoje, ${inSaoPaulo(body.conversation.createdAt)}`, { exact: true })).toBeVisible();
    await expect(list(page).getByRole("region", { name: "Hoje" }).getByRole("link", { name: new RegExp(`Fuso ${word}`) })).toBeVisible();
  });
});
