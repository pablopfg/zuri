import { expect, test } from "./fixtures.ts";
import { signIn } from "./ui-helpers.ts";

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

// Nothing hidden (docs/planos/implementacao-frontend-sinal.md, section 10): no screen grows a
// sideways scroll, from a small phone to a wide and a short window, with the interface's own
// font already loaded (its letters are wider than some system fonts').
const SIZES = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
  { width: 1440, height: 600 },
];
const SCREENS = [
  "/",
  "/conversa",
  "/tarefas",
  "/notas",
  "/agenda",
  "/contatos",
  "/automacoes",
  "/automacoes/fluxos",
  "/memoria",
  "/acessos",
  "/configuracoes/conta",
  "/configuracoes/seguranca",
  "/configuracoes/ia",
  "/configuracoes/modelos",
  "/configuracoes/avisos",
  "/configuracoes/integracoes",
  "/configuracoes/dados",
  "/configuracoes/diagnostico",
];

test("no screen scrolls sideways, from a small phone to a wide or a short window", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await signIn(page);
  const wide: string[] = [];
  for (const path of SCREENS) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      // The page itself and the content area: either one wider than the window hides something.
      const extra = await page.evaluate(() => {
        const main = document.querySelector("main");
        return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, main ? main.scrollWidth - main.clientWidth : 0);
      });
      if (extra > 0) wide.push(`${path} at ${size.width}x${size.height}: ${extra}px`);
    }
  }
  expect(wide).toEqual([]);
});
