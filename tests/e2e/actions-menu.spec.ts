import { expect, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn } from "./ui-helpers.ts";

// The "⋯ Mais opções" menu of a row (stage 26c): the danger item last, apart
// and in red; every item really on top (a list with overflow-hidden must not
// cut it, even at the last row); arrows, Home and End; Esc, Tab and a click
// outside close it; Esc gives the focus back to the button; the button says
// when the row's action is running.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

test("the row menu floats over the list, keeps Apagar last and answers the keyboard @mobile", async ({ page }) => {
  await page.goto("/automacoes");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Automações" })).toBeVisible();
  const name = `Menu ${test.info().project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/automations", {
    headers: CSRF,
    data: { name, kind: "reminder", message: "Conferir o menu", schedule: { type: "daily", time: "06:00" } },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { automation: { id: string } }).automation.id;
  try {
    await page.reload();
    const row = page.getByRole("listitem").filter({ hasText: name });
    const more = row.getByRole("button", { name: `Mais opções para “${name}”` });
    await more.scrollIntoViewIfNeeded();
    await more.click();
    const menu = page.getByRole("menu", { name: `Mais opções para “${name}”` });
    const items = menu.getByRole("menuitem");
    await expect(items).toHaveText(["Rodar agora", "Editar", "Apagar"]);
    await expect(items.first()).toBeFocused();
    // Apagar comes after a rule, in the danger color.
    await expect(menu.locator("hr")).toHaveCount(1);
    expect(await items.last().evaluate((element) => element.className)).toContain("text-danger");
    // Each item is what a tap at its center hits: nothing cuts the menu.
    for (const item of await items.all()) {
      const onTop = await item.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return box.bottom <= window.innerHeight && box.top >= 0 && !!hit && (hit === element || element.contains(hit));
      });
      expect(onTop).toBe(true);
    }
    await expectAccessible(page, "menu da linha");

    await page.keyboard.press("End");
    await expect(items.last()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(items.last()).toBeFocused();
    await page.keyboard.press("Home");
    await expect(items.first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();

    await more.click();
    await expect(menu).toBeVisible();
    await page.getByRole("heading", { level: 1, name: "Automações" }).click();
    await expect(menu).toHaveCount(0);

    await more.click();
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(menu).toHaveCount(0);

    // While "Rodar agora" runs, the button says so (a slow answer, held back here).
    await page.route("**/api/automations/*/run", async (route) => {
      await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });
    await more.click();
    await items.first().click();
    await expect(more).toHaveAttribute("aria-busy", "true");
    await expect(more).not.toHaveAttribute("aria-busy", "true", { timeout: 10_000 });
    await page.unroute("**/api/automations/*/run");
  } finally {
    await page.request.delete(`/api/automations/${id}`, { headers: CSRF });
  }
});
