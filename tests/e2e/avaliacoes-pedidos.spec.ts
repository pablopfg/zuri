import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// Avaliações › Pedidos (Sinal, S20) against the real Worker. Over loopback the Worker answers Google itself
// (apps/agent/src/google/dev-google.ts): the patients' label with Beatriz and two people called Marcos Vieira
// Lopes, their appointments in the office's calendar, and a review of a Marcos that nobody may link alone.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

// The account is one per installation: every test leaves it disconnected (which forgets the copy too).
test.afterEach(async ({ page }) => {
  await page.request.delete("/api/google", { headers: CSRF });
});

const call = async (page: Page, method: "post" | "patch", path: string, data: unknown = {}) => {
  const res = await page.request[method](`/api${path}`, { headers: CSRF, data });
  expect(res.ok(), `${path}: ${res.status()}`).toBe(true);
  return (await res.json()) as Record<string, unknown>;
};

/** Signs in and turns on everything the requests need, without the screens other tests walk. */
async function turnOn(page: Page) {
  await page.goto("/avaliacoes");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Avaliações" })).toBeVisible();
  // The simulated consent grants every scope at once: the calendar, the contacts and the Business Profile.
  for (const path of ["/google/connect", "/google/contacts/connect"]) {
    const consent = new URL((await call(page, "post", path)).url as string);
    await call(page, "post", "/google/callback", { state: consent.searchParams.get("state") ?? "", code: `dev.${consent.searchParams.get("code_challenge") ?? ""}` });
  }
  await call(page, "post", "/google/contacts/sync");
  await call(page, "patch", "/google/contacts/labels", { selected: ["contactGroups/pacientes"] });
  await call(page, "post", "/google/contacts/sync");
  await call(page, "patch", `/google/calendars/${encodeURIComponent("consultorio@exemplo.com.br")}`, { mode: "read" });
  expect((await page.request.get("/api/reviews/locations", { headers: CSRF })).ok()).toBe(true);
  await call(page, "patch", "/reviews/settings", {
    locations: ["accounts/101/locations/201"],
    signature: "Equipe Exemplo",
    tone: "close",
    templates: [
      "Muito obrigado pela sua avaliação, ficamos felizes com o seu carinho.",
      "Agradecemos de coração pela avaliação e esperamos ver você de novo em breve.",
      "Que alegria receber a sua avaliação, obrigado pela confiança de sempre.",
    ],
    banned: [],
    level: "approve",
  });
}

test("Pedidos: the first list, a send through WhatsApp with a link of its own, the opening counted and the settings; accessible @mobile", async ({ page }) => {
  await turnOn(page);
  // Opening Pedidos makes the first list at once: no waiting for tomorrow's hour.
  await page.goto("/avaliacoes/pedidos");
  const parts = page.getByRole("navigation", { name: "Partes de Avaliações" });
  await expect(parts.getByRole("link", { name: "Pedidos" })).toHaveAttribute("aria-current", "page");
  const list = page.getByRole("region", { name: "Pedidos de avaliação" });
  const today = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Para enviar hoje" }) });
  const off = list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Não recebem" }) });
  await expect(today.getByRole("link", { name: /Beatriz Novaes Conceição/ })).toBeVisible();
  // Two people called Marcos and a review of a Marcos nobody linked: he waits for the owner's choice.
  await expect(off.getByRole("link", { name: /Marcos Vieira Lopes.*Para confirmar/ })).toBeVisible();
  await expect(page.getByText("1 para hoje", { exact: true })).toBeVisible();
  await expectAccessible(page, "avaliacoes-pedidos");
  expect(await tooSmallControls(page)).toEqual([]);

  // "Como funciona o link": a dialog, closed by its X.
  await page.getByRole("button", { name: "Como funciona o link" }).click();
  const how = page.getByRole("dialog", { name: "Como funciona o link" });
  await expect(how).toBeVisible();
  await expectAccessible(page, "avaliacoes-pedidos-como-funciona");
  await how.getByRole("button", { name: "Fechar" }).click();
  await expect(how).toBeHidden();

  // The send: the owner's WhatsApp opens with the text and a link of Beatriz's own; Zuri sends nothing itself.
  await page.context().route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>WhatsApp</title>" }));
  await today.getByRole("link", { name: /Beatriz Novaes Conceição/ }).click();
  await expect(page).toHaveURL(/\/avaliacoes\/pedidos\/[0-9a-f-]{36}$/);
  const detail = page.getByRole("region", { name: "Pedido aberto" });
  await expect(detail.getByRole("heading", { level: 2, name: "Beatriz Novaes Conceição" })).toBeVisible();
  const [popup] = await Promise.all([page.waitForEvent("popup"), detail.getByRole("button", { name: "Enviar link de avaliação" }).click()]);
  await popup.waitForURL(/^https:\/\/wa\.me\//);
  const whatsApp = new URL(popup.url());
  expect(whatsApp.pathname).toBe("/5541999990110");
  const text = whatsApp.searchParams.get("text") ?? "";
  expect(text).toMatch(/^Oi, Beatriz! Obrigada pela consulta\./);
  const short = text.match(/https?:\/\/\S+\/a\/([A-Za-z0-9]{10})$/);
  expect(short, text).not.toBeNull();
  await popup.close();
  await expect(page.getByRole("status").filter({ hasText: "WhatsApp aberto. Confira e envie." })).toBeVisible();
  await expect(detail.getByText("Recebeu o link")).toBeVisible();

  // The patient's link: straight to the profile's review page, the opening noted once.
  const opened = await page.request.get(`/a/${short?.[1]}`, { maxRedirects: 0 });
  expect(opened.status()).toBe(302);
  expect(opened.headers().location).toBe("https://g.page/r/exemplo-consultorio/review");
  await page.reload();
  await expect(detail.getByText("Abriu o link")).toBeVisible();
  // Sent: she waits under "Sem resposta" (on a phone the list comes back in place of the request).
  await page.goto("/avaliacoes/pedidos");
  await expect(list.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Sem resposta" }) }).getByRole("link", { name: /Beatriz/ })).toBeVisible();
  // The overview's funnel counts it.
  await parts.getByRole("link", { name: "Visão geral" }).click();
  const funnel = page.getByRole("region", { name: "Pedidos de avaliação" });
  await expect(funnel.getByText("Receberam o link")).toBeVisible();
  await expect(funnel.getByText("Abriram o link")).toBeVisible();

  // The settings of the requests live in Ajustes › Pedidos e link.
  await page.goto("/avaliacoes/pedidos");
  await page.getByRole("link", { name: "Ajustar pedidos e link" }).click();
  await expect(page).toHaveURL(/\/avaliacoes\/ajustes\/pedidos$/);
  await expect(page.getByRole("heading", { name: "Link de avaliação" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mensagem do pedido" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quando pedir" })).toBeVisible();
  await expectAccessible(page, "avaliacoes-pedidos-ajustes");
  expect(await tooSmallControls(page)).toEqual([]);
});

test("a review of a name two contacts share waits for the owner, who picks one on the review's card @mobile", async ({ page }) => {
  await turnOn(page);
  await page.goto("/avaliacoes/lista");
  const reviews = page.getByRole("region", { name: "Lista de avaliações" });
  // Ten days old, so the first read kept it as history: it is under "Todas".
  await reviews.getByRole("combobox", { name: "Filtrar avaliações" }).selectOption("all");
  const review = reviews.getByRole("link", { name: /^Marcos Gostei muito do retorno/ });
  await review.click();
  const detail = page.getByRole("region", { name: "Avaliação aberta" });
  const twins = detail.getByRole("region", { name: "2 pessoas nos seus contatos se chamam Marcos Vieira Lopes" });
  await expect(twins).toBeVisible();
  // Nothing tells them apart by itself: no "best" badge, only what the owner knows.
  await expect(twins.getByText("Mais provável")).toHaveCount(0);
  await expectAccessible(page, "avaliacoes-vinculo-homonimos");
  await twins.getByRole("button", { name: "É esta: Marcos Vieira Lopes 1" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Escolha salva" })).toBeVisible();
  await expect(detail.getByText("Ligada ao contato")).toBeVisible();
  await expect(twins).toBeHidden();
});
