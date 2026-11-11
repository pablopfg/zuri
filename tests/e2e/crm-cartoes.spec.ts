import { createHmac } from "node:crypto";
import { expect, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// The two controls of the internal CRM that outlived the Clients tab (Sinal, S10), on the CRM
// screen against the real Worker: which notices it sends, and the door n8n's signed events come in by.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

// The CRM is one per installation: every test leaves it empty, with the events off.
test.afterEach(async ({ page }) => {
  const list = (await (await page.request.get("/api/crm/clients", { headers: CSRF })).json()) as { clients?: { id: string }[] };
  for (const client of list.clients ?? []) await page.request.delete(`/api/crm/clients/${client.id}`, { headers: CSRF });
  await page.request.delete("/api/crm/events-key", { headers: CSRF });
  await page.request.patch("/api/crm/settings", { headers: CSRF, data: { birthdayTime: "09:00" } });
});

test("the owner picks the time of the birthday notice, kept after a reload @mobile", async ({ page }) => {
  await page.goto("/crm");
  await signIn(page);
  const card = page.getByRole("region", { name: "Avisos do CRM" });
  const time = card.getByLabel("Hora do aviso de aniversários");
  const save = card.getByRole("button", { name: "Salvar hora" });
  await expect(time).toHaveValue("09:00");
  // Nothing changed, or no time at all: nothing to save.
  await expect(save).toBeDisabled();
  await time.fill("");
  await expect(save).toBeDisabled();
  await time.fill("07:30");
  await expectAccessible(page, "crm-avisos-hora");
  expect(await tooSmallControls(page), "every control of the CRM cards is a 44 px target").toEqual([]);
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Hora salva" })).toBeVisible();
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(card.getByLabel("Hora do aviso de aniversários")).toHaveValue("07:30");
});

test("a CRM notice turned off stays off after a reload; the cards are accessible @mobile", async ({ page }) => {
  await page.goto("/crm");
  await signIn(page);
  const notice = page.getByRole("switch", { name: "Aniversários de clientes", exact: true });
  await expect(notice).toBeVisible();
  const before = await notice.isChecked();
  await expectAccessible(page, "crm-cartoes");
  expect(await tooSmallControls(page), "every control of the CRM cards is a 44 px target").toEqual([]);
  try {
    await notice.click();
    await expect(notice).toBeChecked({ checked: !before });
    await page.reload();
    await expect(page.getByRole("switch", { name: "Aniversários de clientes", exact: true })).toBeChecked({ checked: !before });
    // The others kept their place.
    await expect(page.getByRole("switch", { name: "Quando chegar a hora de um retorno" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Cliente novo vindo do n8n (até 20 por dia)" })).toBeVisible();
  } finally {
    const back = await page.request.patch("/api/crm/settings", { headers: CSRF, data: { birthdays: before } });
    expect(back.ok()).toBe(true);
  }
});

test("turns n8n's events on, shows the secret once, and a signed event brings a client", async ({ page }) => {
  await page.goto("/crm");
  await signIn(page);
  await page.getByRole("button", { name: "Ligar eventos" }).click();
  const shown = page.getByRole("dialog", { name: "Endereço e segredo do n8n" });
  await expect(shown.getByText("Guarde agora: o segredo não aparece de novo.", { exact: false })).toBeVisible();
  const url = ((await shown.locator("code").nth(0).textContent()) ?? "").trim();
  const secret = ((await shown.locator("code").nth(1).textContent()) ?? "").trim();
  await expect(shown.getByRole("button", { name: "Copiar segredo" })).toBeVisible();
  expect(url).toMatch(/\/api\/crm\/events\/[A-Za-z0-9_-]{22}$/);
  expect(secret).toMatch(/^zcrm_/);
  await expectAccessible(page, "crm-segredo");
  await shown.getByRole("button", { name: "Já guardei" }).click();
  await expect(page.getByRole("button", { name: "Trocar segredo" })).toBeVisible();
  // The secret is nowhere on the page any more.
  await expect(page.locator("body")).not.toContainText(secret);

  const body = JSON.stringify({ id: "evt-e2e-1", type: "client.upsert", data: { ref: "cw-42", name: "Eva Lima", tagsAdd: ["lead"] } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
  const path = new URL(url).pathname;
  const signed = { "content-type": "application/json", "x-zuri-timestamp": timestamp, "x-zuri-signature": signature };
  const unsigned = await page.request.post(path, { headers: { "content-type": "application/json" }, data: body });
  expect(unsigned.status()).toBe(401);
  expect((await page.request.post(path, { headers: signed, data: body })).status()).toBe(200);
  // The client is kept, though its list has no screen until the CRM's own arrive.
  const clients = (await (await page.request.get("/api/crm/clients", { headers: CSRF })).json()) as { clients: { name: string }[] };
  expect(clients.clients.map((client) => client.name)).toEqual(["Eva Lima"]);

  await page.getByRole("button", { name: "Desligar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Eventos do n8n desligados" })).toBeVisible();
  expect((await page.request.post(path, { headers: signed, data: body })).status()).toBe(404);
  await expect(page.getByRole("button", { name: "Ligar eventos" })).toBeVisible();
});
