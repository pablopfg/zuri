import { CHAT_MESSAGE_MAX } from "@zuri/shared";
import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// The new interface, part 1 (docs/planos/nova-ui.md): the home page with the
// field to write to Zuri (its day is in inicio.spec.ts), the recent conversations by day
// with their own search, the palette's new options and the loading look.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/** A word of its own per run: the database keeps what earlier runs and the other project saved. */
const tag = () => uniqueTag(test.info().project.name);

async function openHome(page: Page) {
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
}

test("the home page sends what is written to a new conversation, once @mobile", async ({ page }) => {
  const word = tag();
  await openHome(page);
  const field = page.getByRole("textbox", { name: "Escreva para a Zuri" });
  await expect(page.getByRole("button", { name: "Enviar para a Zuri" })).toBeDisabled();
  expect(await tooSmallControls(page)).toEqual([]);
  await field.fill(`Oi ${word}`);
  const sent = page.waitForResponse((r) => r.url().endsWith("/api/chat") && r.request().method() === "POST");
  await field.press("Enter");
  expect((await sent).status()).toBe(200);
  await expect(page).toHaveURL(/\/conversa\/[0-9a-f-]{36}$/);
  const log = page.getByRole("log");
  await expect(log.getByText(`(IA simulada) Você disse: “Oi ${word}”.`, { exact: false })).toBeVisible();
  // A reload or going back never sends it again.
  let again = 0;
  page.on("request", (r) => r.url().endsWith("/api/chat") && r.method() === "POST" && again++);
  await page.reload();
  await expect(log.getByText(`Oi ${word}`, { exact: true })).toHaveCount(1);
  await page.goBack();
  await page.goForward();
  await expect(log.getByText(`Oi ${word}`, { exact: true })).toHaveCount(1);
  expect(again).toBe(0);
});

test("a suggestion from the day fills the field and sends nothing @mobile", async ({ page }) => {
  let sent = 0;
  page.on("request", (r) => r.url().endsWith("/api/chat") && r.method() === "POST" && sent++);
  await openHome(page);
  const ideas = page.getByRole("list", { name: "Sugestões a partir do seu dia" });
  const buttons = ideas.getByRole("button");
  await expect(buttons.first()).toBeVisible();
  expect(await buttons.count()).toBeLessThanOrEqual(3);
  // Whatever the server's hour, one of the hour's kinds is always there.
  await expect(ideas.getByRole("button", { name: /^(O que tenho hoje\?|O que falta para hoje\?|O que tenho amanhã\?)$/ })).toBeVisible();
  expect(await tooSmallControls(page)).toEqual([]);
  const first = (await buttons.first().textContent()) ?? "";
  const counted = page.waitForResponse((r) => /\/api\/home\/suggestions\/[a-z]+\/used$/.test(r.url()));
  await buttons.first().click();
  expect((await counted).status()).toBe(204);
  const field = page.getByRole("textbox", { name: "Escreva para a Zuri" });
  await expect(field).toHaveValue(first);
  await expect(field).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
  expect(sent).toBe(0);
  await expectAccessible(page, "início com sugestões");
});

test("a suggestion's blanks come from the server as data, never as markup", async ({ page }) => {
  await page.route("**/api/home/suggestions", (route) =>
    route.fulfill({
      json: {
        suggestions: [
          { id: "bill", name: "a luz", time: "17:30" },
          { id: "review", name: "<img src=x>" },
          { id: "late" },
        ],
      },
    }),
  );
  await page.route("**/api/home/suggestions/*/used", (route) => route.fulfill({ status: 204 }));
  await openHome(page);
  const ideas = page.getByRole("list", { name: "Sugestões a partir do seu dia" });
  await expect(ideas.getByRole("button")).toHaveText(["Me lembre de pagar a luz às 17:30", "Responder a avaliação de <img src=x>", "Reagendar o que atrasou"]);
  await expect(ideas.locator("img")).toHaveCount(0);
  // What was already written stays, with the suggestion after it.
  const field = page.getByRole("textbox", { name: "Escreva para a Zuri" });
  await field.fill("Oi,");
  await ideas.getByRole("button", { name: "Reagendar o que atrasou" }).click();
  await expect(field).toHaveValue("Oi, Reagendar o que atrasou");
});

test("a review without a name reads as the new review", async ({ page }) => {
  await page.route("**/api/home/suggestions", (route) => route.fulfill({ json: { suggestions: [{ id: "review" }] } }));
  await openHome(page);
  await expect(page.getByRole("list", { name: "Sugestões a partir do seu dia" }).getByRole("button")).toHaveText(["Responder a avaliação nova"]);
});

test("the home page shows no suggestions when the server has none or fails", async ({ page }) => {
  await page.route("**/api/home/suggestions", (route) => route.fulfill({ status: 500, json: { code: "INTERNAL_ERROR", message: "x" } }));
  await openHome(page);
  await expect(page.getByRole("heading", { name: "Seu dia" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Sugestões a partir do seu dia" })).toHaveCount(0);
});

test("recent conversations come by day and the list has its own search", async ({ page }) => {
  const word = tag();
  await page.goto("/conversa");
  await signIn(page);
  const box = page.getByRole("textbox", { name: "Mensagem" });
  await box.fill(`Orçamento ${word}`);
  await box.press("Enter");
  await expect(page).toHaveURL(/\/conversa\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: "Parar" })).toHaveCount(0);

  const list = page.getByRole("complementary", { name: "Conversas" });
  const today = list.getByRole("region", { name: "Hoje" });
  await expect(today.getByRole("link", { name: `Orçamento ${word}` })).toHaveAttribute("aria-current", "page");
  const search = list.getByRole("searchbox", { name: "Buscar conversas" });
  // Without accents or case, by every word.
  await search.fill(`orcamento ${word.toUpperCase()}`);
  await expect(list.getByRole("link", { name: `Orçamento ${word}` })).toBeVisible();
  await expect(list.getByRole("navigation").getByRole("link").filter({ hasNotText: word })).toHaveCount(1); // only "Nova conversa"
  await search.fill(`nada-disso-${word}`);
  await expect(list.getByRole("status")).toHaveText("Nenhuma conversa com esse nome. Tente outra palavra.");
  await search.fill("");
  await expect(today.getByRole("link", { name: `Orçamento ${word}` })).toBeVisible();
  await expectAccessible(page, "conversa com recentes");
});

test("the palette opens a new conversation and asks Zuri a typed sentence", async ({ page }) => {
  const word = tag();
  await page.goto("/tarefas");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Tarefas" })).toBeVisible();
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Buscar e ir para" });
  await palette.getByRole("combobox").fill("nova conversa");
  await palette.getByRole("option", { name: "Nova conversa", exact: true }).click();
  await expect(page).toHaveURL(/\/conversa$/);

  await page.keyboard.press("Control+K");
  await palette.getByRole("combobox").fill(`qual é ${word}`);
  const ask = palette.getByRole("option", { name: `Perguntar à Zuri: “qual é ${word}”` });
  await expect(ask).toBeVisible();
  await ask.click();
  await expect(page).toHaveURL(/\/conversa\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("log").getByText(`qual é ${word}`, { exact: true })).toBeVisible();
});

test("loading shows nothing for 300 ms, then gray lines and the green line; the shine stops with reduce motion", async ({ page }) => {
  await page.goto("/configuracoes/conta");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
  // A slow answer for the tasks list.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tasks?*", async (route) => {
    await held;
    await route.continue();
  });
  await (page.locator("aside").getByRole("link", { name: "Tarefas" })).click();
  const status = page.getByRole("main").getByRole("status").filter({ hasText: "Carregando…" }).first();
  await expect(status).toBeAttached();
  const rows = status.locator(".zuri-wait").first();
  // The delay is a 300 ms zero-length animation: held at its start, nothing shows.
  expect(await rows.evaluate((el) => getComputedStyle(el).animationDelay)).toBe("0.3s");
  expect(
    await rows.evaluate((el) => {
      const [wait] = el.getAnimations();
      wait?.pause();
      if (wait) wait.currentTime = 0;
      const opacity = getComputedStyle(el).opacity;
      wait?.play();
      return opacity;
    }),
  ).toBe("0");
  await expect.poll(() => rows.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  expect(await status.locator(".zuri-skeleton").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("zuri-shine");
  // The thin green line on top, while the screen's code downloads (the tasks page, the first time here).
  const line = page.locator(".zuri-progress");
  const lineMotion = () => line.evaluate((el) => getComputedStyle(el, "::before").animationName);
  if ((await line.count()) > 0) expect(await lineMotion()).toBe("zuri-slide");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await status.locator(".zuri-skeleton").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  release();
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: "Carregando…" })).toHaveCount(0);
});

test("Zuri thinking shows her mark and the line, in a bubble", async ({ page }) => {
  await page.goto("/conversa");
  await signIn(page);
  // Hold the request, so the turn waits for its first word.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    await held;
    await route.continue();
  });
  const box = page.getByRole("textbox", { name: "Mensagem" });
  await box.fill(`Pensa ${tag()}`);
  await box.press("Enter");
  const bubble = page.getByRole("log").getByText("A Zuri está pensando");
  await expect(bubble).toBeVisible();
  await expect(bubble.locator("svg")).toBeVisible();
  release();
  await expect(bubble).toHaveCount(0);
});

test("the green line runs on top while a screen downloads, and stands still with reduce motion", async ({ page }) => {
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  // Hold the Memória screen's code, so its loading stays on screen.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/MemoryPage-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.locator("aside").getByRole("link", { name: "Memória" }).click();
  const line = page.locator(".zuri-progress");
  await expect(line).toBeAttached();
  await expect.poll(() => line.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  expect(await line.evaluate((el) => getComputedStyle(el, "::before").animationName)).toBe("zuri-slide");
  expect(await line.evaluate((el) => getComputedStyle(el, "::before").backgroundColor)).toBe("rgb(21, 128, 61)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await line.evaluate((el) => getComputedStyle(el, "::before").animationName)).toBe("none");
  release();
  await expect(page.getByRole("heading", { level: 1, name: "Memória" })).toBeVisible();
  await expect(line).toHaveCount(0);
});

test("a question from the palette inside an open conversation starts a new one too", async ({ page }) => {
  const word = tag();
  await page.goto("/conversa");
  await signIn(page);
  const box = page.getByRole("textbox", { name: "Mensagem" });
  await box.fill(`Primeira ${word}`);
  await box.press("Enter");
  await expect(page).toHaveURL(/\/conversa\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: "Parar" })).toHaveCount(0);
  const first = page.url();
  for (const n of ["segunda", "terceira"]) {
    await page.keyboard.press("Control+K");
    await page.getByRole("dialog", { name: "Buscar e ir para" }).getByRole("combobox").fill(`pergunta ${n} ${word}`);
    const sent = page.waitForResponse((r) => r.url().endsWith("/api/chat") && r.request().method() === "POST");
    await page.getByRole("option", { name: `Perguntar à Zuri: “pergunta ${n} ${word}”` }).click();
    expect((await sent).status()).toBe(200);
    await expect(page.getByRole("log").getByText(`pergunta ${n} ${word}`, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/conversa\/[0-9a-f-]{36}$/);
    expect(page.url()).not.toBe(first);
    await expect(page.getByRole("button", { name: "Parar" })).toHaveCount(0);
  }
});

test("from the home page, a message at the chat's limit is sent and one character more waits in the composer", async ({ page }) => {
  await openHome(page);
  let posts = 0;
  page.on("request", (r) => r.url().endsWith("/api/chat") && r.method() === "POST" && posts++);
  const field = page.getByRole("textbox", { name: "Escreva para a Zuri" });
  await field.fill("a".repeat(CHAT_MESSAGE_MAX + 1));
  await field.press("Enter");
  await expect(page).toHaveURL(/\/conversa$/);
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toHaveValue("a".repeat(CHAT_MESSAGE_MAX + 1));
  expect(posts).toBe(0);
  await page.goto("/");
  await field.fill("b".repeat(CHAT_MESSAGE_MAX));
  const sent = page.waitForResponse((r) => r.url().endsWith("/api/chat") && r.request().method() === "POST");
  await field.press("Enter");
  expect((await sent).status()).toBe(200);
  await expect(page).toHaveURL(/\/conversa\/[0-9a-f-]{36}$/);
});

test("the Mais sheet left open closes when the screen widens, and the page stays usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await page.getByRole("button", { name: "Mais", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Mais" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("dialog", { name: "Mais" })).toHaveCount(0);
  await page.locator("aside").getByRole("link", { name: "Notas" }).click();
  await expect(page).toHaveURL(/\/notas$/);
});

test("the bell over 99 unread says 99+ in its name, and shows the dot @mobile", async ({ page }) => {
  await openHome(page);
  await page.route("**/api/auth/session", async (route) => {
    const res = await route.fetch();
    if (!res.ok()) return route.fulfill({ response: res });
    return route.fulfill({ response: res, json: { ...(await res.json()), unreadNotices: 150 } });
  });
  await page.reload();
  // The greeting fades in after the reload: axe checks it once it has arrived.
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  const bell = page.getByRole("button", { name: "Abrir avisos, 99+ sem ler" });
  await expect(bell).toBeVisible();
  await expect(bell.locator("[data-unread]")).toBeVisible();
  await expectAccessible(page, "sino-99");
});
