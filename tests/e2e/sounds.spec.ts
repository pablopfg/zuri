import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, listenToSounds, SOUND_NOTES, signIn, soundsHeard, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// The sounds of the open app (12/11/2026) against the real Worker: the card in
// Settings > Avisos and the sound of a notice that arrives. The test hears by
// the notes the page asks the browser to play (listenToSounds). pt-BR.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const STANDARD = { notice: true, pick: "sino", recording: true };
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const save = (page: Page, sounds: object) => page.request.patch("/api/settings", { headers: CSRF, data: { sounds } });
const savedSounds = async (page: Page) => ((await (await page.request.get("/api/settings", { headers: CSRF })).json()) as { sounds: unknown }).sounds;
const close = (a: number, b: number) => Math.abs(a - b) < 0.01;
/** The notes heard, compared with a small tolerance (a product like 783.99 × 4 is not exact). */
async function expectHeard(page: Page, notes: readonly number[], label: string) {
  await expect.poll(async () => (await soundsHeard(page)).length, { message: label }).toBe(notes.length);
  const heard = await soundsHeard(page);
  expect(heard.every((value, index) => close(value, notes[index] ?? -1)), `${label}: ${JSON.stringify(heard)}`).toBe(true);
}

/** Signed in, with the shell up: the API calls a test makes right after carry the session. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await signIn(page);
  await expect(page.getByRole("button", { name: /^Abrir avisos/ }).first()).toBeVisible();
  expect((await save(page, STANDARD)).status()).toBe(200);
  await page.reload();
}

// The base is shared by every test: each one leaves the sounds as an installation starts.
test.afterEach(async ({ page }) => {
  await save(page, STANDARD);
});

test("CA2: Settings > Avisos shows the three sounds to hear and choose, and the two switches @mobile", async ({ page }) => {
  await listenToSounds(page);
  await open(page, "/configuracoes/avisos");
  const card = page.getByRole("region", { name: "Som dos avisos" });
  await expect(card.getByText("Toca quando chega um aviso e a Zuri está aberta. Com ela fechada, vale o som de notificação do seu aparelho.")).toBeVisible();
  const sounds = card.getByRole("radiogroup", { name: "Som do aviso" });
  await expect(sounds.getByRole("radio")).toHaveCount(3);
  await expect(sounds.getByRole("radio", { name: "Sino" })).toBeChecked();
  await expect(sounds.getByRole("radio", { name: "Sino" })).toHaveAccessibleDescription("Duas notas suaves, como um sino pequeno.");
  await expect(card.getByRole("switch", { name: "Tocar um som quando chegar um aviso" })).toBeChecked();
  await expect(card.getByRole("switch", { name: "Som ao começar e ao terminar de gravar um áudio" })).toBeChecked();
  await expectAccessible(page, "som dos avisos");
  // On the narrowest phone nothing of the card is cut off (the card alone: the channels table further down is another matter).
  const before = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 });
  const cut = await card.evaluate((el) =>
    [el, ...el.querySelectorAll<HTMLElement>("*")]
      .filter((each) => {
        const box = each.getBoundingClientRect();
        return box.width > 0 && !each.closest(".sr-only") && (box.right > document.documentElement.clientWidth + 1 || box.left < -1);
      })
      .map((each) => `${each.tagName}.${each.textContent?.slice(0, 30)}`),
  );
  expect(cut, "the card at 320 px").toEqual([]);
  if (before) await page.setViewportSize(before);
  expect(await tooSmallControls(page), "every control of the card is a 44 px target").toEqual([]);

  // "Ouvir" plays and saves nothing.
  await card.getByRole("button", { name: "Ouvir o som Marimba" }).click();
  await expectHeard(page, SOUND_NOTES.marimba, "Ouvir Marimba");
  expect(await savedSounds(page)).toEqual(STANDARD);

  // Choosing plays the sound and saves it.
  await card.getByText("Um toque curto e discreto.").click();
  await expectHeard(page, [...SOUND_NOTES.marimba, ...SOUND_NOTES.gota], "choosing Gota");
  await expect(toast(page, "Avisos salvos")).toBeVisible();
  await expect(sounds.getByRole("radio", { name: "Gota" })).toBeChecked();
  expect(await savedSounds(page)).toEqual({ ...STANDARD, pick: "gota" });

  // It is still chosen after the page loads again; the test plays it.
  await page.reload();
  await expect(sounds.getByRole("radio", { name: "Gota" })).toBeChecked();
  await card.getByRole("button", { name: "Testar um aviso agora" }).click();
  await expect(toast(page, "É assim que um aviso novo toca.")).toBeVisible();
  await expectHeard(page, SOUND_NOTES.gota, "Testar with Gota");

  // The recording's two sounds, one after the other.
  await card.getByRole("button", { name: "Ouvir o som da gravação" }).click();
  await expectHeard(page, [...SOUND_NOTES.gota, ...SOUND_NOTES.start, ...SOUND_NOTES.stop], "Ouvir the recording");
});

test("CA2: the sounds are chosen by keyboard, and with the switch off nothing can be chosen or tested", async ({ page }) => {
  await listenToSounds(page);
  await open(page, "/configuracoes/avisos");
  const card = page.getByRole("region", { name: "Som dos avisos" });
  const sounds = card.getByRole("radiogroup", { name: "Som do aviso" });
  await sounds.getByRole("radio", { name: "Sino" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(sounds.getByRole("radio", { name: "Gota" })).toBeChecked();
  await expect(sounds.getByRole("radio", { name: "Gota" })).toBeFocused();
  await expectHeard(page, SOUND_NOTES.gota, "arrow down to Gota");
  await expect.poll(() => savedSounds(page)).toEqual({ ...STANDARD, pick: "gota" });

  await card.getByRole("switch", { name: "Tocar um som quando chegar um aviso" }).press("Space");
  await expect(card.getByRole("switch", { name: "Tocar um som quando chegar um aviso" })).not.toBeChecked();
  await expect.poll(() => savedSounds(page)).toEqual({ notice: false, pick: "gota", recording: true });
  for (const radio of await sounds.getByRole("radio").all()) await expect(radio).toBeDisabled();
  await card.getByRole("button", { name: "Testar um aviso agora" }).click();
  await expect(toast(page, "O som dos avisos está desligado.")).toBeVisible();
  // Each sound can still be heard, to choose before turning it on.
  await card.getByRole("button", { name: "Ouvir o som Sino" }).click();
  await expectHeard(page, [...SOUND_NOTES.gota, ...SOUND_NOTES.sino], "only Ouvir played, never the test");
  await expectAccessible(page, "som dos avisos desligado");

  await card.getByRole("switch", { name: "Som ao começar e ao terminar de gravar um áudio" }).press("Space");
  await expect.poll(() => savedSounds(page)).toEqual({ notice: false, pick: "gota", recording: false });
});

test("a refused save says so and the card keeps what is stored", async ({ page }) => {
  await open(page, "/configuracoes/avisos");
  const card = page.getByRole("region", { name: "Som dos avisos" });
  await expect(card.getByRole("radio", { name: "Sino" })).toBeChecked();
  await page.route("**/api/settings", (route) => (route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE", message: "Serviço indisponível. Tente de novo em instantes." } }) : route.fallback()));
  await card.getByText("Três notas que sobem, mais fácil de notar.").click();
  await expect(card.getByRole("alert")).toHaveText("Serviço indisponível. Tente de novo em instantes.");
  await expect(card.getByRole("radio", { name: "Sino" })).toBeChecked();
  expect(await savedSounds(page)).toEqual(STANDARD);
});

test("a second choice made before the first is saved keeps both", async ({ page }) => {
  await open(page, "/configuracoes/avisos");
  const card = page.getByRole("region", { name: "Som dos avisos" });
  await expect(card.getByRole("radio", { name: "Sino" })).toBeChecked();
  // The save is slow: the owner turns the recording sound off and picks another sound right after.
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PATCH") await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fallback();
  });
  await card.getByRole("switch", { name: "Som ao começar e ao terminar de gravar um áudio" }).press("Space");
  await card.getByText("Um toque curto e discreto.").click();
  await expect.poll(() => savedSounds(page)).toEqual({ notice: true, pick: "gota", recording: false });
  await expect(card.getByRole("radio", { name: "Gota" })).toBeChecked();
  await expect(card.getByRole("switch", { name: "Som ao começar e ao terminar de gravar um áudio" })).not.toBeChecked();
});

test("in English the card reads in English", async ({ page }) => {
  await open(page, "/configuracoes/avisos");
  try {
    expect((await page.request.patch("/api/settings", { headers: CSRF, data: { language: "en" } })).status()).toBe(200);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const card = page.getByRole("region", { name: "Notification sound" });
    await expect(card.getByRole("radio", { name: "Bell" })).toHaveAccessibleDescription("Two soft notes, like a small bell.");
    await expect(card.getByRole("switch", { name: "Sound when an audio recording starts and ends" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Listen to the Marimba sound" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Test a notification now" })).toBeVisible();
  } finally {
    await page.request.patch("/api/settings", { headers: CSRF, data: { language: "pt-BR" } });
  }
});

/** A reminder run now: its text becomes a notice under the bell. */
async function newNotice(page: Page, name: string) {
  const created = await page.request.post("/api/automations", { headers: CSRF, data: { name, kind: "reminder", message: "Beber um copo de água", schedule: { type: "daily", time: "06:00" } } });
  expect(created.status(), await created.text()).toBe(201);
  const { automation } = (await created.json()) as { automation: { id: string } };
  expect((await page.request.post(`/api/automations/${automation.id}/run`, { headers: CSRF })).status()).toBe(200);
  await page.request.delete(`/api/automations/${automation.id}`, { headers: CSRF });
}

/**
 * The bell's count arrives as when the owner comes back to the tab: the session is checked again.
 * Returns once the bell shows the count the server sent, so the page has taken the answer in
 * (a sound, if one is due, was asked for by then).
 */
async function sessionChecked(page: Page) {
  const checked = page.waitForResponse((r) => r.url().endsWith("/api/auth/session") && r.status() === 200);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const { unreadNotices } = (await (await checked).json()) as { unreadNotices: number };
  await expect(page.getByRole("button", { name: `Abrir avisos, ${unreadNotices > 99 ? "99+" : unreadNotices} sem ler` }).first()).toBeVisible();
  return unreadNotices;
}

test("CA1: a notice that arrives with the Zuri open plays the chosen sound once; with the sound off, nothing @mobile", async ({ page }) => {
  const tag = uniqueTag(test.info().project.name);
  await listenToSounds(page);
  await open(page, "/");
  await newNotice(page, `Som ${tag} 0`);
  // Opening the Zuri with a notice already waiting plays nothing: only what arrives after.
  await page.reload();
  await expect(page.getByRole("button", { name: /^Abrir avisos, \d+\+? sem ler$/ }).first()).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await sessionChecked(page);
  expect(await soundsHeard(page)).toEqual([]);

  // Two arrive together: one sound, the Sino.
  await newNotice(page, `Som ${tag} 1`);
  await newNotice(page, `Som ${tag} 2`);
  await sessionChecked(page);
  await expectHeard(page, SOUND_NOTES.sino, "the Sino, once");
  // The same count again is not a new notice.
  await sessionChecked(page);
  expect(await soundsHeard(page)).toHaveLength(4);

  // Another sound chosen: the next notice plays it (the settings in memory follow the card).
  await page.goto("/configuracoes/avisos");
  const card = page.getByRole("region", { name: "Som dos avisos" });
  await card.getByRole("switch", { name: "Tocar um som quando chegar um aviso" }).press("Space");
  await expect.poll(() => savedSounds(page)).toEqual({ ...STANDARD, notice: false });
  const before = await sessionChecked(page);
  await newNotice(page, `Som ${tag} 3`);
  expect(await sessionChecked(page), "the notice did arrive").toBe(before + 1);
  expect(await soundsHeard(page), "sound off: nothing plays").toEqual([]);
  // Back on, the next one sounds on this same page: it was the switch that kept it quiet.
  await card.getByRole("switch", { name: "Tocar um som quando chegar um aviso" }).press("Space");
  await expect.poll(() => savedSounds(page)).toEqual(STANDARD);
  await page.waitForTimeout(3_000);
  await newNotice(page, `Som ${tag} 4`);
  await sessionChecked(page);
  await expectHeard(page, SOUND_NOTES.sino, "sound back on");
});
