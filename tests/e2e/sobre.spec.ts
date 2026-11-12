import { APP_VERSION } from "@zuri/shared";
import { expect, test } from "./fixtures.ts";
import { expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// Settings > Sobre a Zuri (PR S16): the screen's version against the server's, and what's new.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

test("Sobre a Zuri says both sides run the same version, lists what's new and leads to every version and the code @mobile", async ({ page }) => {
  await page.goto("/configuracoes/sobre");
  await signIn(page);
  const version = page.getByRole("region", { name: "Versão", exact: true });
  await expect(version.getByText(`Zuri ${APP_VERSION}`, { exact: true })).toBeVisible();
  await expect(version.getByText("Tudo na mesma versão")).toBeVisible();
  await expect(version.getByText(`A tela e o servidor estão na ${APP_VERSION}.`)).toBeVisible();
  await expect(version.getByRole("button", { name: "Recarregar" })).toHaveCount(0);
  // "Conferir de novo" asks the server again.
  const asked = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/version");
  await version.getByRole("button", { name: "Conferir de novo" }).click();
  expect((await asked).status()).toBe(200);

  // The notes of the newest version in CHANGELOG.md, as plain text.
  const notes = page.getByRole("region", { name: /^Novidades da versão \d+\.\d+\.\d+$/ });
  await expect(notes.getByRole("listitem").first()).toBeVisible();
  await expect(notes.getByRole("listitem")).not.toHaveCount(0);
  await expect(notes.locator("a, strong, code")).toHaveCount(1);
  const all = notes.getByRole("link", { name: "Ver todas as versões (abre em outra aba)" });
  await expect(all).toHaveAttribute("href", "https://github.com/pablopfg/Zuri/releases");
  await expect(all).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByRole("link", { name: "Ver o código (abre em outra aba)" })).toHaveAttribute("href", "https://github.com/pablopfg/Zuri");
  await expectAccessible(page, "sobre a zuri");
  expect(await tooSmallControls(page), "every control of Sobre a Zuri is a 44 px target").toEqual([]);
});

test("Sobre a Zuri asks for a reload when the server moved on, and says when it couldn't check", async ({ page }) => {
  let answer: { status: number; json?: unknown } = { status: 200, json: { version: "999.0.0" } };
  await page.route("**/api/version", (route) => route.fulfill(answer.json ? { status: answer.status, json: answer.json } : { status: answer.status, json: { code: "INTERNAL_ERROR", message: "x" } }));
  await page.goto("/configuracoes/sobre");
  await signIn(page);
  const version = page.getByRole("region", { name: "Versão", exact: true });
  await expect(version.getByText("A tela e o servidor estão em versões diferentes")).toBeVisible();
  await expect(version.getByText(`A tela está na ${APP_VERSION} e o servidor na 999.0.0. Recarregue a página para usar a versão do servidor.`)).toBeVisible();
  await expect(version.getByRole("button", { name: "Recarregar" })).toBeVisible();
  await expectAccessible(page, "sobre a zuri, versões diferentes");
  // Anything but a version number is not shown as one.
  answer = { status: 200, json: { version: "<b>1</b>", release: "abc" } };
  await version.getByRole("button", { name: "Conferir de novo" }).click();
  await expect(version.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await expect(version).not.toContainText("<b>1</b>");
  answer = { status: 200, json: { version: APP_VERSION } };
  await version.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(version.getByText("Tudo na mesma versão")).toBeVisible();
});
