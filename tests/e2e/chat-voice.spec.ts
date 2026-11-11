import { expect, test } from "./fixtures.ts";
import { CSRF, signIn } from "./ui-helpers.ts";

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
  await expect(page.getByText(/Gravando: \d+ s de 60 s/)).toBeVisible();
  await expect(page.getByText(/Gravando: [12] s de 60 s/)).toBeVisible();
  const transcribed = page.waitForResponse((r) => r.url().endsWith("/api/transcribe"));
  await page.getByRole("button", { name: "Parar e transcrever" }).click();
  expect((await transcribed).status()).toBe(200);
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toHaveValue(/^\(Transcrição simulada\) Áudio de \d+ s\.$/);
  // Nothing was sent: the owner reads it first.
  await expect(page).toHaveURL(/\/conversa$/);
});

test("the Início has the same microphone: what is said lands in the field, after what is written", async ({ page }) => {
  await page.goto("/");
  await signIn(page);
  const field = page.getByRole("textbox", { name: "Escreva para a Zuri" });
  await field.fill("Anote aí:");
  await page.getByRole("button", { name: "Falar em vez de digitar" }).click();
  // A second of sound, so the fake microphone has something recorded.
  await expect(page.getByText(/Gravando: [12] s de 60 s/)).toBeVisible();
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
  await expect(page.getByText(/Gravando: [12] s de 60 s/)).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/notes/${note.id}`) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Parar e transcrever" }).click();
  await expect(text).toHaveValue(/^Primeira linha\.\n\nSegunda linha\.\n\n\(Transcrição simulada\) Áudio de \d+ s\.$/);
  await expect(page.getByText("Texto ditado no fim da nota. Confira antes de sair: o áudio não fica guardado.")).toBeVisible();
  expect(((await saved).request().postDataJSON() as { content: string }).content).toMatch(/Segunda linha\.\n\n\(Transcrição simulada\)/);
  await expect(page.getByText(/^Salva às \d{2}:\d{2}$/)).toBeVisible();
});
