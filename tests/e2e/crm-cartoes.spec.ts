import { expect, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// The control of the internal CRM that outlived the Clients tab (Sinal, S10), on the CRM
// screen against the real Worker: which notices it sends. No other system sends it anything.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

// The CRM is one per installation: every test leaves it empty.
test.afterEach(async ({ page }) => {
  const list = (await (await page.request.get("/api/crm/clients", { headers: CSRF })).json()) as { clients?: { id: string }[] };
  for (const client of list.clients ?? []) await page.request.delete(`/api/crm/clients/${client.id}`, { headers: CSRF });
});

test("a CRM notice turned off stays off after a reload; the card is accessible @mobile", async ({ page }) => {
  await page.goto("/crm");
  await signIn(page);
  const notice = page.getByRole("switch", { name: "Aniversários de clientes, às 9 h" });
  await expect(notice).toBeVisible();
  const before = await notice.isChecked();
  await expectAccessible(page, "crm-cartoes");
  expect(await tooSmallControls(page), "every control of the CRM card is a 44 px target").toEqual([]);
  try {
    await notice.click();
    await expect(notice).toBeChecked({ checked: !before });
    await page.reload();
    await expect(page.getByRole("switch", { name: "Aniversários de clientes, às 9 h" })).toBeChecked({ checked: !before });
    // The other kept its place, and the notice of clients from n8n is gone.
    await expect(page.getByRole("switch", { name: "Quando chegar a hora de um retorno" })).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(2);
  } finally {
    const back = await page.request.patch("/api/crm/settings", { headers: CSRF, data: { birthdays: before } });
    expect(back.ok()).toBe(true);
  }
});

test("the CRM has no door for other systems: no events card and no address to post to", async ({ page }) => {
  await page.goto("/crm");
  await signIn(page);
  await expect(page.getByRole("switch", { name: "Aniversários de clientes, às 9 h" })).toBeVisible();
  // Zuri takes no events from n8n (owner's decision of 11/11/2026): nothing on the screen offers them.
  await expect(page.getByText(/n8n/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /eventos|segredo/i })).toHaveCount(0);
  // And the addresses answer like any that never existed, even with the owner's session.
  const body = { id: "evt-e2e-1", type: "client.upsert", data: { ref: "cw-42", name: "Eva Lima" } };
  const signed = { ...CSRF, "x-zuri-timestamp": String(Math.floor(Date.now() / 1000)), "x-zuri-signature": `sha256=${"0".repeat(64)}` };
  expect((await page.request.post(`/api/crm/events/${"A".repeat(22)}`, { headers: signed, data: body })).status()).toBe(404);
  expect((await page.request.post("/api/crm/events-key", { headers: CSRF })).status()).toBe(404);
  const clients = (await (await page.request.get("/api/crm/clients", { headers: CSRF })).json()) as { clients: unknown[] };
  expect(clients.clients).toEqual([]);
});
