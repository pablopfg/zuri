import { expect, test } from "./fixtures.ts";
import { expectAccessible, signIn } from "./ui-helpers.ts";

// The house dialog (stage 26b): the X in the top right corner, named "Fechar",
// in every dialog; no "Fechar" button in text at the foot; Esc closes; opening
// focuses the first field, not the X; and the X stays in view while a long
// dialog scrolls.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

test("a dialog closes from the X in the corner or with Esc, and opens on its first field @mobile", async ({ page }) => {
  await page.goto("/tarefas");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Tarefas" })).toBeVisible();

  await page.getByRole("button", { name: "Pastas" }).click();
  const dialog = page.getByRole("dialog", { name: "Pastas" });
  await expect(dialog.getByLabel("Nome da pasta")).toBeFocused();

  // One close button, an icon with its name, in the top right corner.
  const close = dialog.getByRole("button", { name: "Fechar" });
  await expect(close).toHaveCount(1);
  await expect(close).toHaveText("");
  const box = await dialog.boundingBox();
  const corner = await close.boundingBox();
  if (!box || !corner) throw new Error("dialog not laid out");
  expect(corner.y - box.y).toBeLessThan(24);
  expect(box.x + box.width - (corner.x + corner.width)).toBeLessThan(24);
  expect(corner.width).toBeGreaterThanOrEqual(44);
  expect(corner.height).toBeGreaterThanOrEqual(44);
  await expectAccessible(page, "diálogo com X");

  await close.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Pastas" })).toBeFocused();

  await page.getByRole("button", { name: "Pastas" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the X stays in view while a long dialog scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  await page.goto("/tarefas");
  await signIn(page);
  await page.getByRole("button", { name: "Pastas" }).click();
  const dialog = page.getByRole("dialog", { name: "Pastas" });
  // Enough projects that the list runs past the short screen.
  const name = dialog.getByLabel("Nome da pasta");
  for (let i = 1; i <= 6; i++) {
    await name.fill(`Rolagem ${test.info().project.name} ${i}`);
    await dialog.getByRole("button", { name: "Criar" }).click();
    await expect(dialog.getByText(`Rolagem ${test.info().project.name} ${i}`)).toBeVisible();
  }
  await dialog.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  expect(await dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(dialog.getByRole("button", { name: "Fechar" })).toBeInViewport();
  await expect(dialog.getByRole("heading", { name: "Pastas" })).toBeInViewport();
  // In view is not enough: nothing that scrolled under them may paint on top.
  for (const target of [dialog.getByRole("heading", { name: "Pastas" }), dialog.getByRole("button", { name: "Fechar" })]) {
    const covered = await target.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return !(top && (top === element || element.contains(top)));
    });
    expect(covered).toBe(false);
  }
});
