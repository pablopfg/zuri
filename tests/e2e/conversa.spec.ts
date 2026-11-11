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

/** Answers the reads of the conversations as if `id` had been made and last used `days` days ago. */
async function age(page: Page, id: string, days: number) {
  const older = (iso: string) => new Date(Date.parse(iso) - days * DAY).toISOString();
  const aged = <T extends { id: string; createdAt: string; updatedAt: string }>(conversation: T): T =>
    conversation.id === id ? { ...conversation, createdAt: older(conversation.createdAt), updatedAt: older(conversation.updatedAt) } : conversation;
  await page.route(/\/api\/conversations(\/[0-9a-f-]{36})?(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    if (body.conversations) body.conversations = body.conversations.map(aged);
    if (body.conversation) {
      body.conversation = aged(body.conversation);
      if (body.conversation.id === id) body.messages = body.messages.map((message: { createdAt: string }) => ({ ...message, createdAt: older(message.createdAt) }));
    }
    await route.fulfill({ response, json: body });
  });
}

test("each row shows when the conversation was used and renames by keyboard, the open one or another", async ({ page }) => {
  const word = tag();
  await openChat(page);
  const other = await converse(page, `Outra ${word}`);
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

  // Esc gives up on a rename: nothing is saved.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");
  await expect(rename).toBeHidden();
  await expect(row(page, `Renomeada ${word}`)).toHaveCount(1);

  // The open conversation renames from its own menu, at the top: title, tab and row follow.
  // Two menus carry its name: the row's, in the list, and the one beside the title, after it.
  await page.getByRole("button", { name: `Mais opções para “Aberta ${word}”` }).last().click();
  await page.getByRole("menuitem", { name: "Renomear" }).click();
  await rename.getByLabel("Nome da conversa").fill(`Título novo ${word}`);
  await rename.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Título novo ${word}` })).toBeVisible();
  await expect(page).toHaveTitle(`Título novo ${word} · Zuri`);
  await expect(row(page, `Título novo ${word}`).getByRole("link")).toHaveAttribute("aria-current", "page");
  expect(other).not.toBe(open);
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
    if (route.request().method() !== "GET") return route.fallback();
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

test("the list's search, empty and error states", async ({ page }) => {
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
