import type { MailStatus } from "@zuri/shared";
import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// Configurações › Integrações › E-mail para pacientes (E6c, docs/planos/email-para-pacientes.md, protótipo v56):
// the Gmail's sending allowed on Google's page, the SMTP of another provider with its app password, and the
// test to the owner. Over loopback the Worker answers Google and the example SMTP servers itself
// (apps/agent/src/google/dev-google.ts, apps/agent/src/mail/dev-mail.ts). pt-BR.
// The test is 3 in 10 minutes per installation: the specs here send at most that many, all together.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const PASSWORD = "senha-de-app-exemplo";

// The account and the way out are one per installation: every test leaves both as they were.
test.afterEach(async ({ page }) => {
  await page.request.put("/api/mail", { headers: CSRF, data: { mode: "off", name: "", replyTo: "" } });
  await page.request.delete("/api/google", { headers: CSRF });
});

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const card = (page: Page) => page.getByRole("region", { name: "E-mail para pacientes" });

/** Google's consent page: approves at once and sends the owner back as Google would. */
async function routeConsent(page: Page) {
  await page.route("https://accounts.google.com/**", async (route) => {
    const asked = new URL(route.request().url());
    const back = new URL(asked.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("state", asked.searchParams.get("state") ?? "");
    back.searchParams.set("code", `dev.${asked.searchParams.get("code_challenge") ?? ""}`);
    back.searchParams.set("scope", asked.searchParams.get("scope") ?? "");
    await route.fulfill({ status: 302, headers: { location: back.href } });
  });
}

async function connectGoogle(page: Page) {
  const begin = await page.request.post("/api/google/connect", { headers: CSRF });
  expect(begin.ok()).toBe(true);
  const consent = new URL(((await begin.json()) as { url: string }).url);
  const res = await page.request.post("/api/google/callback", {
    headers: CSRF,
    data: { state: consent.searchParams.get("state") ?? "", code: `dev.${consent.searchParams.get("code_challenge") ?? ""}` },
  });
  expect(res.ok()).toBe(true);
}

async function open(page: Page) {
  await page.goto("/configuracoes/integracoes");
  await signIn(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
}

test("the Gmail: allowed on Google's page, the sender's name saved and the test sent to the owner; accessible @mobile", async ({ page }) => {
  await open(page);
  await connectGoogle(page);
  // The grant from before the E6c, without the sending: the card offers to allow it.
  let first = true;
  await page.route("**/api/mail", async (route) => {
    if (route.request().method() !== "GET" || !first) return route.fallback();
    first = false;
    const res = await route.fetch();
    const body = (await res.json()) as MailStatus;
    await route.fulfill({ response: res, json: { ...body, gmail: { ...body.gmail, granted: false } } });
  });
  await page.reload();
  const mail = card(page);
  // The count is the installation's day: the other tests of the day sent too.
  const cap = mail.getByText(/^Por onde saem a confirmação de consulta e os outros e-mails aos pacientes\. Até 100 por dia; hoje saíram \d+\.$/);
  await expect(cap).toBeVisible();
  const before = Number(/saíram (\d+)/.exec((await cap.textContent()) ?? "")?.[1]);
  await expect(mail.getByRole("button", { name: /^Gmail/ })).toHaveAttribute("aria-pressed", "true");
  await expect(mail.getByText("Gmail não conectado")).toBeVisible();
  await expect(mail.getByRole("button", { name: "Enviar teste para você" })).toBeDisabled();
  await expectAccessible(page, "email-pacientes-gmail-desconectado");

  await routeConsent(page);
  await mail.getByRole("button", { name: "Conectar o Gmail" }).click();
  await expect(toast(page, "Envio pelo Gmail liberado.")).toBeVisible();
  await expect(page).toHaveURL(/\/configuracoes\/integracoes$/);
  // With no way out chosen yet, the Gmail became it.
  await expect(mail.getByText("Gmail conectado: dono@exemplo.com.br")).toBeVisible();
  await expect(mail.getByRole("button", { name: "Desconectar" })).toBeVisible();

  await mail.getByLabel("Nome do remetente").fill("Consultório Exemplo");
  await expect(mail.getByText("De: Consultório Exemplo <dono@exemplo.com.br>")).toBeVisible();
  await expect(mail.getByText("Salve antes de testar: o teste usa o que está salvo.")).toBeVisible();
  await mail.getByRole("button", { name: "Salvar o e-mail" }).click();
  await expect(toast(page, "E-mail salvo")).toBeVisible();
  await expect(mail.getByRole("button", { name: "Salvar o e-mail" })).toBeDisabled();

  await mail.getByRole("button", { name: "Enviar teste para você" }).click();
  await expect(mail.getByText("E-mail de teste enviado para dono@exemplo.com.br pelo Gmail.")).toBeVisible();
  await expect(mail.getByText(`hoje saíram ${before + 1}.`, { exact: false })).toBeVisible();
  await expectAccessible(page, "email-pacientes-gmail");
  expect(await tooSmallControls(page), "every control of the card is a 44 px target").toEqual([]);

  await mail.getByRole("button", { name: "Desconectar" }).click();
  await expect(toast(page, "Gmail desconectado do e-mail para pacientes")).toBeVisible();
  await expect(mail.getByRole("button", { name: "Enviar teste para você" })).toBeDisabled();
});

test("another provider: the password asked, a refused server named, saved with TLS and tested, and a new user asks for the password again", async ({ page }) => {
  await open(page);
  const mail = card(page);
  await mail.getByRole("button", { name: /^Outro provedor \(SMTP\)/ }).click();
  await expect(mail.getByRole("button", { name: /^Outro provedor \(SMTP\)/ })).toHaveAttribute("aria-pressed", "true");
  const host = mail.getByLabel("Servidor SMTP");
  const user = mail.getByLabel("Usuário");
  const password = mail.getByLabel("Senha de app");
  await host.fill("192.168.0.10");
  await user.fill("contato@exemplo.com.br");
  // No password typed: asked here, before anything goes to the server.
  await mail.getByRole("button", { name: "Salvar o e-mail" }).click();
  await expect(mail.getByText("Digite a senha de app.")).toBeVisible();
  await expect(password).toBeFocused();
  await password.fill(PASSWORD);
  await mail.getByRole("button", { name: "Salvar o e-mail" }).click();
  await expect(mail.getByText("Use o nome do servidor, como smtp.exemplo.com.br. IP e rede interna não valem.")).toBeVisible();
  await expect(host).toBeFocused();
  await expect(host).toHaveAttribute("aria-invalid", "true");

  await host.fill("smtp.exemplo.com.br");
  await mail.getByLabel("Porta e segurança").selectOption("587");
  await mail.getByRole("button", { name: "Salvar o e-mail" }).click();
  await expect(toast(page, "E-mail salvo")).toBeVisible();
  // The password never comes back: only its end.
  await expect(password).toHaveValue("");
  await expect(mail.getByText("Guardada, terminada em mplo. Em branco, fica a atual.")).toBeVisible();
  await expect(mail.getByText(/<contato@exemplo\.com\.br>/)).toBeVisible();

  await mail.getByRole("button", { name: "Enviar teste para você" }).click();
  await expect(mail.getByText("E-mail de teste enviado para dono@exemplo.com.br pelo servidor SMTP.")).toBeVisible();

  // A refusal says what to do, in the screen's words (the server's own never reach it).
  await page.route("**/api/mail/test", async (route) => {
    const status = (await (await page.request.get("/api/mail", { headers: CSRF })).json()) as MailStatus;
    await route.fulfill({ json: { test: { ok: false, problem: "auth" }, status } });
  });
  await mail.getByRole("button", { name: "Enviar teste para você" }).click();
  await expect(mail.getByText("O servidor recusou o usuário ou a senha. Confira a senha de app e salve de novo.")).toBeVisible();

  await user.fill("outro@exemplo.com.br");
  await expect(mail.getByText("Fica cifrada e nunca volta para a tela.")).toBeVisible();
  await mail.getByRole("button", { name: "Salvar o e-mail" }).click();
  await expect(mail.getByText("O servidor ou o usuário mudou: digite a senha de novo.")).toBeVisible();
  await expect(password).toBeFocused();
  await expectAccessible(page, "email-pacientes-smtp");
});
