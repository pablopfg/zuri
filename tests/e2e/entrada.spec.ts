import { expect, HUMAN_TOKEN, type Page, test } from "./fixtures.ts";
import { EMAIL, expectAccessible, PASSWORD, tooSmallControls } from "./ui-helpers.ts";

// The entry screens of the Sinal (S03 of docs/planos/implementacao-frontend-sinal.md):
// the six states of the security check's line, the sign-in's fields and the
// frame the screens outside the app share.

test.use({ locale: "pt-BR" });

const refusal = (code: string, message: string, details?: Record<string, unknown>, status = 400) => ({
  status,
  json: { code, message, ...(details ? { details } : {}) },
});

/**
 * A stand-in for the widget that does nothing by itself: the test plays the
 * service through `window.zuriCheck` (the options of the last widget drawn).
 */
async function manualCheck(page: Page) {
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.zuriDrawn = 0; window.turnstile = {
        render(container, options) {
          window.zuriCheck = options; window.zuriDrawn += 1;
          const box = document.createElement("div");
          box.dataset.testid = "turnstile";
          container.append(box);
          return "w" + window.zuriDrawn;
        },
        remove() {},
      };`,
    }),
  );
}
type Played = { zuriCheck?: Record<string, (arg?: string) => void>; zuriDrawn: number };
/** Plays one of the service's events on the widget on screen, once it is drawn. */
async function play(page: Page, event: string, value?: string) {
  await page.waitForFunction(() => (window as unknown as Played).zuriCheck !== undefined);
  await page.evaluate(([name, arg]) => (window as unknown as Played).zuriCheck?.[name as string]?.(arg), [event, value]);
}
const drawn = (page: Page) => page.evaluate(() => (window as unknown as Played).zuriDrawn);

async function fill(page: Page) {
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
}
const home = (page: Page) => page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ });

test("checking, then done: a try before the check ends is held back and says why @mobile", async ({ page }) => {
  await manualCheck(page);
  let tries = 0;
  await page.route("**/api/auth/login", (route) => {
    tries += 1;
    return route.continue();
  });
  await page.goto("/entrar");
  const line = page.locator(".zuri-human");
  await expect(line).toHaveText("Fazendo a verificação de segurança…");
  await expect(line).toHaveAttribute("role", "status");
  await expectAccessible(page, "entrar, conferindo");
  await fill(page);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Fazendo a verificação de segurança… Mais um instante.");
  expect(tries).toBe(0);

  await play(page, "callback", HUMAN_TOKEN);
  await expect(page.getByRole("status")).toHaveText("Verificação de segurança concluída");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expectAccessible(page, "entrar, concluída");
  expect(await tooSmallControls(page)).toEqual([]);
  // A token that ran out is asked again by the service: the line goes back to checking.
  await play(page, "expired-callback");
  await expect(line).toHaveText("Fazendo a verificação de segurança…");
  await play(page, "callback", HUMAN_TOKEN);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(home(page)).toBeVisible();
  expect(tries).toBe(1);
});

test("asks for a click: the line says so, and a try before it points at the box", async ({ page }) => {
  await manualCheck(page);
  let tries = 0;
  await page.route("**/api/auth/login", (route) => {
    tries += 1;
    return route.continue();
  });
  await page.goto("/entrar");
  await fill(page);
  await play(page, "before-interactive-callback");
  await expect(page.getByRole("status")).toHaveText("Confirme que é você para continuar.");
  await expect(page.getByTestId("turnstile")).toBeAttached();
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Marque a caixa da verificação para continuar.");
  // A second try says it again: a new node, so a screen reader repeats it.
  const first = await page.getByRole("alert").elementHandle();
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect.poll(async () => first?.evaluate((el) => el.isConnected)).toBe(false);
  await expect(page.getByRole("alert")).toHaveText("Marque a caixa da verificação para continuar.");
  expect(tries).toBe(0);
  await expectAccessible(page, "entrar, pedir clique");

  await play(page, "callback", HUMAN_TOKEN);
  await play(page, "after-interactive-callback");
  await expect(page.getByRole("status")).toHaveText("Verificação de segurança concluída");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(home(page)).toBeVisible();
});

test("didn't load: the line says so and reloads only the check, keeping what was typed @mobile", async ({ page }) => {
  await manualCheck(page);
  await page.goto("/entrar");
  await fill(page);
  await play(page, "error-callback");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("A verificação de segurança não carregou.");
  await expectAccessible(page, "entrar, não carregou");
  expect(await tooSmallControls(page)).toEqual([]);
  const before = await drawn(page);
  await alert.getByRole("button", { name: "Recarregar a verificação" }).click();
  expect(await drawn(page)).toBe(before + 1);
  await expect(page.locator(".zuri-human")).toHaveText("Fazendo a verificação de segurança…");
  await expect(page.getByLabel("E-mail")).toHaveValue(EMAIL);
  await expect(page.getByLabel("Senha", { exact: true })).toHaveValue(PASSWORD);
  await play(page, "callback", HUMAN_TOKEN);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(home(page)).toBeVisible();
});

test("didn't pass: a check the server refuses stops there until the owner reloads it", async ({ page }) => {
  await manualCheck(page);
  const sent: string[] = [];
  await page.route("**/api/auth/login", (route) => {
    sent.push(route.request().postDataJSON().turnstileToken ?? "none");
    if (sent.length === 1) return route.fulfill(refusal("TURNSTILE_REQUIRED", "A verificação de segurança não passou. Tente de novo.", { turnstileSiteKey: "1x00000000000000000000AA" }));
    return route.continue();
  });
  await page.goto("/entrar");
  await fill(page);
  await play(page, "callback", "forjado");
  await page.getByRole("button", { name: "Entrar" }).click();
  // Said once, on the line (not again as the form's error), with the way out beside it.
  const alert = page.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText("A verificação de segurança não passou. Tente de novo.");
  await expect(page.getByTestId("turnstile")).toHaveCount(0);
  // The widget drawn for the next try left the screen: an answer of its that arrives late changes nothing.
  await play(page, "callback", HUMAN_TOKEN);
  await expect(alert).toContainText("A verificação de segurança não passou. Tente de novo.");
  await expect(page.getByLabel("E-mail")).toHaveValue(EMAIL);
  await expectAccessible(page, "entrar, não passou");
  // No new check runs by itself, and a try sends nothing.
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  expect(sent).toEqual(["forjado"]);

  await page.getByRole("button", { name: "Recarregar a verificação" }).click();
  await expect(page.locator(".zuri-human")).toHaveText("Fazendo a verificação de segurança…");
  await play(page, "callback", HUMAN_TOKEN);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(home(page)).toBeVisible();
  expect(sent).toEqual(["forjado", HUMAN_TOKEN]);
});

test("a refusal that brings another key: reloading the check draws it with the new key", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.zuriKeys = []; window.turnstile = {
        render(container, options) { window.zuriKeys.push(options.sitekey); setTimeout(() => options.callback("${HUMAN_TOKEN}"), 20); return "w"; },
        remove() {},
      };`,
    }),
  );
  await page.route("**/api/auth/login", (route) =>
    route.fulfill(refusal("TURNSTILE_REQUIRED", "A verificação de segurança não passou. Tente de novo.", { turnstileSiteKey: "2x00000000000000000000AB" })),
  );
  await page.goto("/entrar");
  await fill(page);
  await expect(page.getByRole("status")).toHaveText("Verificação de segurança concluída");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.getByRole("button", { name: "Recarregar a verificação" }).click();
  await expect(page.getByRole("status")).toHaveText("Verificação de segurança concluída");
  const keys = await page.evaluate(() => (window as unknown as { zuriKeys: string[] }).zuriKeys);
  expect(keys[0]).toBe("1x00000000000000000000AA");
  expect(keys.at(-1)).toBe("2x00000000000000000000AB");
});

test("a wait of a day shows its hours, never minutes past sixty", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-10T12:00:00Z") });
  await page.route("**/api/auth/login", (route) => route.fulfill(refusal("RATE_LIMITED", "Muitas tentativas. Espere um pouco e tente de novo.", { retryAfter: 86_400 }, 429)));
  await page.goto("/entrar");
  await fill(page);
  await page.locator('[data-testid="turnstile"][data-solved="true"]').waitFor();
  await page.clock.pauseAt(new Date("2026-11-10T12:05:00Z"));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".zuri-human")).toHaveText("Muitas tentativas seguidas. Tente de novo em 24:00:00.");
  await page.clock.runFor(1000);
  await expect(page.getByRole("button", { name: "Espere 23:59:59" })).toBeDisabled();
});

test("a box asked for, then a check that broke: reloading goes back to checking, with no box asked", async ({ page }) => {
  await manualCheck(page);
  await page.goto("/entrar");
  await play(page, "before-interactive-callback");
  await expect(page.getByRole("status")).toHaveText("Confirme que é você para continuar.");
  await play(page, "error-callback");
  await page.getByRole("button", { name: "Recarregar a verificação" }).click();
  const line = page.locator(".zuri-human");
  await expect(line).toHaveText("Fazendo a verificação de segurança…");
  await expect(line).toHaveAttribute("role", "status");
});

test("a wait: the line and the button count the pause down, then the form opens again @mobile", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-10T12:00:00Z") });
  let tries = 0;
  await page.route("**/api/auth/login", (route) => {
    tries += 1;
    return route.fulfill(refusal("RATE_LIMITED", "Muitas tentativas. Espere um pouco e tente de novo.", { retryAfter: 892 }, 429));
  });
  await page.goto("/entrar");
  await fill(page);
  await page.locator('[data-testid="turnstile"][data-solved="true"]').waitFor();
  // From here the page's clock only moves when the test says so.
  await page.clock.pauseAt(new Date("2026-11-10T12:05:00Z"));
  await page.getByRole("button", { name: "Entrar" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("Muitas tentativas seguidas. Tente de novo em 14:52.");
  await expect(alert).toHaveCount(1);
  const button = page.getByRole("button", { name: "Espere 14:52" });
  await expect(button).toBeDisabled();
  await page.clock.runFor(51_000);
  await expect(page.getByRole("button", { name: "Espere 14:01" })).toBeDisabled();
  // The line on screen counts down in silence: what is said out loud is said once, with the first time.
  const line = page.locator(".zuri-human");
  await expect(line).toHaveText("Muitas tentativas seguidas. Tente de novo em 14:01.");
  await expect(line).not.toHaveAttribute("role");
  await expect(alert).toHaveText("Muitas tentativas seguidas. Tente de novo em 14:52.");
  await page.clock.runFor(841_000);
  await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled();
  await expect(alert).toHaveCount(0);
  expect(tries).toBe(1);
});

test("the wait passes the accessibility check and keeps the touch targets @mobile", async ({ page }) => {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill(refusal("RATE_LIMITED", "Muitas tentativas. Espere um pouco e tente de novo.", { retryAfter: 892 }, 429)),
  );
  await page.goto("/entrar");
  await fill(page);
  await page.locator('[data-testid="turnstile"][data-solved="true"]').waitFor();
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("button", { name: /^Espere 14:\d\d$/ })).toBeDisabled();
  await expectAccessible(page, "entrar, espera");
  expect(await tooSmallControls(page)).toEqual([]);
});

test("the e-mail field has its label, no example inside, and says which part is missing @mobile", async ({ page }) => {
  let tries = 0;
  await page.route("**/api/auth/login", (route) => {
    tries += 1;
    return route.continue();
  });
  await page.goto("/entrar");
  const email = page.getByLabel("E-mail");
  for (const [name, value] of [
    // An e-mail field already brings the keyboard with "@" and types no capital by itself.
    ["type", "email"],
    ["autocomplete", "username"],
  ] as const)
    await expect(email).toHaveAttribute(name, value);
  expect(await email.getAttribute("placeholder")).toBeNull();
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  for (const wrong of ["dono", "dono@exemplo", "dono @exemplo.com.br", "@exemplo.com.br"]) {
    await email.fill(wrong);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(email).toHaveAccessibleDescription("Confira o e-mail: falta alguma parte.");
    await expect(email).toBeFocused();
  }
  expect(tries).toBe(0);
  await email.fill(EMAIL);
  await expect(email).not.toHaveAttribute("aria-invalid", "true");
});

test("Esqueci minha senha sits on the password's line and opens the recovery, with the same check @mobile", async ({ page }) => {
  await page.route("**/api/auth/recover", (route) => route.fulfill({ json: { available: true } }));
  await page.goto("/entrar");
  const link = page.getByRole("link", { name: "Esqueci minha senha" });
  const label = page.locator("label", { hasText: "Senha" });
  const [linkBox, labelBox, fieldBox] = await Promise.all([link.boundingBox(), label.boundingBox(), page.getByLabel("Senha", { exact: true }).boundingBox()]);
  if (!linkBox || !labelBox || !fieldBox) throw new Error("the password field is not laid out");
  // Same line as the label, at the far end, above the field.
  expect(Math.abs(linkBox.y + linkBox.height / 2 - (labelBox.y + labelBox.height / 2))).toBeLessThan(6);
  expect(Math.abs(linkBox.x + linkBox.width - (fieldBox.x + fieldBox.width))).toBeLessThan(2);
  expect(linkBox.height).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page).toHaveURL(/\/recuperar-senha$/);
  await expect(page.getByRole("heading", { level: 1, name: "Criar uma senha nova" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Verificação de segurança concluída");
  await expectAccessible(page, "recuperar senha");
  await page.getByRole("link", { name: "Voltar para entrar" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
});

test("no entry screen names the infrastructure, in any state of the check @mobile", async ({ page }) => {
  await manualCheck(page);
  await page.route("**/api/auth/recover", (route) => route.fulfill({ json: { available: true } }));
  const clean = async () => {
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const name of ["cloudflare", "turnstile", "worker", "wrangler", "durable", "robô", "captcha"]) expect(text).not.toContain(name);
  };
  for (const path of ["/entrar", "/recuperar-senha"]) {
    await page.goto(path);
    await expect(page.locator(".zuri-human")).toBeVisible();
    await clean();
    for (const event of ["before-interactive-callback", "error-callback"]) {
      await play(page, event);
      await clean();
    }
    await play(page, "callback", HUMAN_TOKEN);
    await expect(page.getByRole("status")).toHaveText("Verificação de segurança concluída");
    await clean();
  }
});

test("nothing is cut off at any width, nor in a short window", async ({ page }) => {
  await page.route("**/api/auth/recover", (route) => route.fulfill({ json: { available: true } }));
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [820, 1180],
    [1024, 768],
    [1440, 900],
    [1440, 600],
    [844, 390],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const path of ["/entrar", "/recuperar-senha", "/aprovar"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        const wide = [...document.querySelectorAll<HTMLElement>("main *")].filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && !el.closest(".zuri-entry-art") && (box.right > root.clientWidth + 1 || box.left < -1);
        });
        return { sideways: root.scrollWidth > root.clientWidth, wide: wide.map((el) => `${el.tagName}.${el.className}`) };
      });
      expect(overflow, `${path} at ${width}x${height}`).toEqual({ sideways: false, wide: [] });
      // The whole content can be reached: the title is on screen or the page scrolls to it.
      await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
    }
  }
});
