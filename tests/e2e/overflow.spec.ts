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
  "/rotinas",
  "/crm",
  "/crm/fluxos",
  "/crm/credenciais",
  "/crm/envios",
  "/avaliacoes",
  "/avaliacoes/lista",
  "/avaliacoes/ajustes",
  "/avaliacoes/ajustes/responder",
  "/memoria",
  "/acessos",
  "/configuracoes/conta",
  "/configuracoes/seguranca",
  "/configuracoes/ia",
  "/configuracoes/modelos",
  "/configuracoes/agenda",
  "/configuracoes/avisos",
  "/configuracoes/integracoes",
  "/configuracoes/dados",
  "/configuracoes/diagnostico",
  "/configuracoes/assistente",
  "/configuracoes/sobre",
];

test("no screen scrolls sideways, from a small phone to a wide or a short window", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await signIn(page);
  const wide: string[] = [];
  // Each size opens the screen anew: a window resized after the screen is drawn would be measured
  // halfway, before the screen swaps its phone and computer arrangements.
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const path of SCREENS) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      // The lists and cards arrive after the title: measure the screen once it is whole.
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main .zuri-skeleton")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      // The page itself and the content area: either one wider than the window hides something.
      const found = await page.evaluate(() => {
        const main = document.querySelector("main");
        const extra = Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, main ? main.scrollWidth - main.clientWidth : 0);
        if (extra <= 0) return null;
        // Names the element that reaches farthest to the right, so the failure says where to look.
        let worst: Element | null = null;
        let right = 0;
        for (const el of (main ?? document.body).querySelectorAll("*")) {
          const edge = el.getBoundingClientRect().right;
          // Inside a box that scrolls or clips by itself, the element is not what widens the page.
          let clipped = false;
          for (let up = el.parentElement; up && up !== main; up = up.parentElement) if (getComputedStyle(up).overflowX !== "visible") clipped = true;
          if (!clipped && edge > right && el.getBoundingClientRect().width > 1) {
            right = edge;
            worst = el;
          }
        }
        return `${extra}px, at <${worst?.tagName.toLowerCase()} class="${String(worst?.getAttribute("class")).slice(0, 80)}"> "${(worst?.textContent ?? "").trim().slice(0, 40)}"`;
      });
      if (found) wide.push(`${path} at ${size.width}x${size.height}: ${found}`);
    }
  }
  expect(wide).toEqual([]);
});
