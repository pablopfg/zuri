import { expect, test } from "./fixtures.ts";
import { CSRF, listenToSounds, SOUND_NOTES, signIn, soundsHeard } from "./ui-helpers.ts";

// Voice input in the chat (step 9), with Chromium's fake microphone and the
// simulated transcription of local development. A file of its own: the fake
// device needs launch options, which force a browser of their own.

test.use({
  locale: "pt-BR",
  permissions: ["microphone"],
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

test("records, shows the time, and puts the transcription in the composer for the owner to send", async ({ page }) => {
  await page.goto("/conversa");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Conversa" })).toBeVisible();
  await page.getByRole("button", { name: "Falar em vez de digitar" }).click();
  await expect(page.getByText(/Gravando: 0:\d\d de 2:00/)).toBeVisible();
  await expect(page.getByText(/Gravando: 0:0[12] de 2:00/)).toBeVisible();
  const transcribed = page.waitForResponse((r) => r.url().endsWith("/api/transcribe"));
  await page.getByRole("button", { name: "Parar e transcrever" }).click();
  expect((await transcribed).status()).toBe(200);
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toHaveValue(/^\(Transcrição simulada\) Áudio de \d+ s\.$/);
  // Nothing was sent: the owner reads it first.
  await expect(page).toHaveURL(/\/conversa$/);
});

test("CA4: a short sound when the recording starts and another when it ends; the switch in Avisos turns both off", async ({ page }) => {
  await listenToSounds(page);
  await page.goto("/conversa");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Conversa" })).toBeVisible();
  const sounds = (recording: boolean) => page.request.patch("/api/settings", { headers: CSRF, data: { sounds: { notice: true, pick: "sino", recording } } });
  await sounds(true);
  try {
    await page.reload();
    await page.getByRole("button", { name: "Falar em vez de digitar" }).click();
    await expect(page.getByText(/Gravando: 0:0[12] de 2:00/)).toBeVisible();
    expect(await soundsHeard(page)).toEqual(SOUND_NOTES.start);
    await page.getByRole("button", { name: "Parar e transcrever" }).click();
    await expect(page.getByRole("textbox", { name: "Mensagem" })).toHaveValue(/Transcrição simulada/);
    expect(await soundsHeard(page)).toEqual([...SOUND_NOTES.start, ...SOUND_NOTES.stop]);

    await sounds(false);
    // The switch reaches the page with its settings: wait for them before recording.
    const settings = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "GET");
    await page.reload();
    await settings;
    await page.getByRole("button", { name: "Falar em vez de digitar" }).click();
    await expect(page.getByText(/Gravando: 0:0[12] de 2:00/)).toBeVisible();
    await page.getByRole("button", { name: "Parar e transcrever" }).click();
    await expect(page.getByRole("textbox", { name: "Mensagem" })).toHaveValue(/Transcrição simulada/);
    expect(await soundsHeard(page)).toEqual([]);

    // Leaving the screen while it records drops the recording: no ending sound for what was not sent.
    await sounds(true);
    const again = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "GET");
    await page.reload();
    await again;
    await page.getByRole("button", { name: "Falar em vez de digitar" }).click();
    await expect(page.getByText(/Gravando: 0:0[12] de 2:00/)).toBeVisible();
    await page.getByRole("link", { name: "Tarefas" }).filter({ visible: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Tarefas" })).toBeVisible();
    expect(await soundsHeard(page)).toEqual(SOUND_NOTES.start);
  } finally {
    await sounds(true);
  }
});

test("CA3: at 120 s the recording stops by itself and what was said is transcribed", async ({ page }) => {
  await listenToSounds(page);
  await page.clock.install();
  await page.goto("/conversa");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Conversa" })).toBeVisible();
  await page.getByRole("button", { name: "Falar em vez de digitar" }).click();
  await expect(page.getByText("Gravando: 0:00 de 2:00")).toBeVisible();
  // One second short of the limit it is still recording.
  await page.clock.runFor(119_000);
  await expect(page.getByText("Gravando: 1:59 de 2:00")).toBeVisible();
  const transcribed = page.waitForRequest((r) => r.url().endsWith("/api/transcribe"));
  await page.clock.runFor(1_000);
  expect(((await transcribed).postDataJSON() as { seconds: number }).seconds).toBe(120);
  // The fake clock ran two minutes in a blink, so the simulated transcription measures a short file.
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toHaveValue(/^\(Transcrição simulada\) Áudio de \d+ s\.$/);
  await expect(page.getByRole("button", { name: "Falar em vez de digitar" })).toBeVisible();
  // It ended with the ending sound, like a recording the owner stops.
  expect(await soundsHeard(page)).toEqual([...SOUND_NOTES.start, ...SOUND_NOTES.stop]);
});

test("the Início has the same microphone: what is said lands in the field, after what is written", async ({ page }) => {
  await page.goto("/");
  await signIn(page);
  const field = page.getByRole("textbox", { name: "Escreva para a Zuri" });
  await field.fill("Anote aí:");
  await page.getByRole("button", { name: "Falar em vez de digitar" }).click();
  // A second of sound, so the fake microphone has something recorded.
  await expect(page.getByText(/Gravando: 0:0[12] de 2:00/)).toBeVisible();
  await page.getByRole("button", { name: "Parar e transcrever" }).click();
  await expect(field).toHaveValue(/^Anote aí: \(Transcrição simulada\) Áudio de \d+ s\.$/);
  // Nothing was sent: the owner reads it first.
  await expect(page).toHaveURL(/\/$/);
});

test("a note takes dictation at the end of its text, wherever the cursor is, and saves it", async ({ page }) => {
  await page.goto("/notas");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Notas" })).toBeVisible();
  const made = await page.request.post("/api/notes", { headers: CSRF, data: { title: `Ditado ${Date.now()}`, content: "Primeira linha.\n\nSegunda linha.\n\n" } });
  const { note } = (await made.json()) as { note: { id: string } };
  await page.goto(`/notas/${note.id}`);
  const text = page.getByLabel("Texto da nota");
  await expect(text).toHaveValue(/Segunda linha/);
  // The cursor in the middle of the first line, and the preview open: the text still goes to the end.
  await text.focus();
  await text.evaluate((box: HTMLTextAreaElement) => box.setSelectionRange(3, 3));
  await page.getByRole("tab", { name: "Prévia" }).click();
  // One microphone in the note, in its bar: the title has none (decision of 10/11).
  await expect(page.getByRole("button", { name: "Ditar na nota" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Falar em vez de digitar" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ditar na nota" }).click();
  await expect(page.getByText(/Gravando: 0:0[12] de 2:00/)).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/notes/${note.id}`) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Parar e transcrever" }).click();
  await expect(text).toHaveValue(/^Primeira linha\.\n\nSegunda linha\.\n\n\(Transcrição simulada\) Áudio de \d+ s\.$/);
  await expect(page.getByText("Texto ditado no fim da nota. Confira antes de sair: o áudio não fica guardado.")).toBeVisible();
  expect(((await saved).request().postDataJSON() as { content: string }).content).toMatch(/Segunda linha\.\n\n\(Transcrição simulada\)/);
  await expect(page.getByText(/^Salva às \d{2}:\d{2}$/)).toBeVisible();
});

test("a dictation that ends after the owner left the note is dropped: nothing is saved behind their back", async ({ page }) => {
  await page.goto("/notas");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Notas" })).toBeVisible();
  const made = await page.request.post("/api/notes", { headers: CSRF, data: { title: `Ditado tardio ${Date.now()}`, content: "Só isto." } });
  const { note } = (await made.json()) as { note: { id: string } };
  await page.goto(`/notas/${note.id}`);
  await expect(page.getByLabel("Texto da nota")).toHaveValue("Só isto.");
  // The transcription is held until the owner is on another screen.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/transcribe", async (route) => {
    await held;
    await route.fallback();
  });
  let saves = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith(`/api/notes/${note.id}`)) saves += 1;
  });
  await page.getByRole("button", { name: "Ditar na nota" }).click();
  await expect(page.getByText(/Gravando: 0:0[12] de 2:00/)).toBeVisible();
  await page.getByRole("button", { name: "Parar e transcrever" }).click();
  await expect(page.getByText("Transcrevendo")).toBeVisible();
  // Inside the app (a reload would cancel the request by itself).
  await page.getByRole("link", { name: "Tarefas" }).filter({ visible: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Tarefas" })).toBeVisible();
  const transcribed = page.waitForResponse((r) => r.url().endsWith("/api/transcribe")).catch(() => null);
  release();
  await transcribed;
  await page.waitForTimeout(4_000);
  expect(saves).toBe(0);
  await expect(page).toHaveURL(/\/tarefas$/);
  const kept = (await (await page.request.get(`/api/notes/${note.id}`, { headers: CSRF })).json()) as { note: { content: string } };
  expect(kept.note.content).toBe("Só isto.");
});
