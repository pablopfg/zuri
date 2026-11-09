import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fromBase64Url, parseBackupKeyFile, sealBackup, toBase64Url } from "@zuri/shared";
import { expect, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// Step 23: Settings › Data — storage use, downloading a backup and importing one.

test.use({ locale: "pt-BR" });

const LATEST = "2026-11-09T00:00:00.000Z";

test("shows the storage use, downloads a backup and imports one with a confirmation; accessible @mobile", async ({ page }) => {
  await page.goto("/entrar");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  await page.goto("/configuracoes/dados");

  await expect(page.getByRole("heading", { name: "Uso do armazenamento" })).toBeVisible();
  await expect(page.getByRole("meter", { name: "Tarefas" })).toHaveCount(1);
  await expect(page.getByText("Espaço total")).toBeVisible();
  await expect(page.getByText("O arquivo não é cifrado. Guarde num lugar seguro.")).toBeVisible();
  await expectAccessible(page, "dados");
  expect(await tooSmallControls(page)).toEqual([]);

  // Signed in just now: no password asked again.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar backup" }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^zuri-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await readFile((await file.path()) ?? "", "utf8"));
  expect(exported).toMatchObject({ format: "zuri-backup", version: 1 });
  await expect(page.getByRole("status").filter({ hasText: "Backup baixado." })).toBeVisible();

  // A small file of its own, so the shared database gains one task, removed at the end.
  const title = `Tarefa do backup ${crypto.randomUUID().slice(0, 8)}`;
  const backup = {
    format: "zuri-backup",
    version: 1,
    schema: exported.schema,
    exportedAt: LATEST,
    data: {
      tasks: [{ id: crypto.randomUUID(), title, description: "", status: "todo", priority: "medium", dueAt: null, projectId: null, createdAt: LATEST, updatedAt: LATEST, completedAt: null }],
    },
  };
  await page.getByLabel("Arquivo do backup").setInputFiles({ name: "zuri-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  const dialog = page.getByRole("dialog", { name: "Importar este backup?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await expectAccessible(page, "importar");
  await dialog.getByRole("button", { name: "Importar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Backup importado: 1 tarefa." })).toBeVisible();

  const tasks = await (await page.request.get(`/api/tasks?q=${encodeURIComponent(title)}`, { headers: CSRF })).json();
  expect(tasks.tasks).toHaveLength(1);
  expect((await page.request.delete(`/api/tasks/${tasks.tasks[0].id}`, { headers: CSRF })).ok()).toBe(true);
});

test("refuses a bad file without saving anything, and one over 10 MB in the browser", async ({ page }) => {
  await page.goto("/entrar");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  await page.goto("/configuracoes/dados");
  const input = page.getByLabel("Arquivo do backup");

  const forged = { format: "zuri-backup", version: 1, schema: 1, exportedAt: LATEST, data: { mcp: [{ url: "https://exemplo.com.br" }] } };
  await input.setInputFiles({ name: "forjado.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(forged)) });
  await page.getByRole("dialog", { name: "Importar este backup?" }).getByRole("button", { name: "Importar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Este arquivo não é um backup válido da Zuri. Nada foi gravado." })).toBeVisible();

  await input.setInputFiles({ name: "grande.json", mimeType: "application/json", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 32) });
  await expect(page.getByRole("alert").filter({ hasText: "O arquivo passa de 10 MB e não pode ser importado." })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Importar este backup?" })).toHaveCount(0);
});

test("creates the backup key once and restores a sealed copy in the browser; accessible @mobile", async ({ page }) => {
  await page.goto("/entrar");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
  await page.goto("/configuracoes/dados");
  const card = page.getByRole("region", { name: "Backup automático" });
  await expect(card).toBeVisible();

  // Local development keeps the copies in memory: the card is on, waiting for the key (or with one from an earlier run).
  const create = card.getByRole("button", { name: /^(Criar chave do backup|Trocar a chave)$/ });
  await create.click();
  const dialog = page.getByRole("dialog", { name: /chave do backup\?$/ });
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await expectAccessible(page, "chave do backup");
  await dialog.getByRole("button", { name: "Criar a chave" }).click();
  // Two steps: the file is saved by the owner's own click, and the key only counts once confirmed.
  const use = dialog.getByRole("button", { name: "Já guardei, usar esta chave" });
  await expect(use).toBeDisabled();
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Baixar o arquivo da chave" }).click();
  const download = await downloading;
  await use.click();
  expect(download.suggestedFilename()).toBe("zuri-chave-do-backup.json");
  const key = parseBackupKeyFile(await readFile((await download.path()) ?? "", "utf8"));
  await expect(page.getByRole("status").filter({ hasText: "Chave criada. Guarde o arquivo baixado num lugar seguro." })).toBeVisible();
  await expect(card.getByText(`${key.key.slice(0, 8)}…`, { exact: false })).toBeVisible();
  await expect(card.getByRole("button", { name: "Restaurar uma cópia" })).toBeVisible();

  // A copy sealed for that key, as the server makes them: gzip of a backup with one note.
  const title = `Nota restaurada ${crypto.randomUUID().slice(0, 8)}`;
  const at = "2026-11-09T00:00:00.000Z";
  const backup = { format: "zuri-backup", version: 1, schema: 1, exportedAt: at, data: { notes: [{ id: crypto.randomUUID(), title, content: "do backup", projectId: null, localOnly: false, createdAt: at, updatedAt: at }] } };
  const publicKey = toBase64Url(new Uint8Array([4, ...fromBase64Url(key.privateKey.x), ...fromBase64Url(key.privateKey.y)]));
  const pieces: Uint8Array[] = [];
  for await (const piece of sealBackup((async function* () { yield new Uint8Array(gzipSync(JSON.stringify(backup))); })(), publicKey)) pieces.push(piece);
  const sealed = Buffer.concat(pieces);

  await card.getByRole("button", { name: "Restaurar uma cópia" }).click();
  const restore = page.getByRole("dialog", { name: "Restaurar uma cópia" });
  await expect(restore.getByRole("button", { name: "Abrir" })).toBeDisabled();
  await restore.getByLabel("Cópia do backup").setInputFiles({ name: "copia.zuri", mimeType: "application/octet-stream", buffer: sealed });
  // The wrong file in the key's place says so, and nothing leaves the browser.
  await restore.getByLabel("Arquivo da chave").setInputFiles({ name: "outra.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await restore.getByRole("button", { name: "Abrir" }).click();
  await expect(restore.getByRole("alert")).toHaveText("Esta chave não abre esta cópia. Use o arquivo da chave que valia no dia da cópia.");
  await restore.getByLabel("Arquivo da chave").setInputFiles({ name: "zuri-chave-do-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(key)) });
  await restore.getByRole("button", { name: "Abrir" }).click();
  await expect(restore.getByText("1 nota", { exact: true })).toBeVisible();
  await expectAccessible(page, "restaurar");
  await restore.getByRole("button", { name: "Importar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cópia restaurada." })).toBeVisible();

  const notes = await (await page.request.get(`/api/notes?q=${encodeURIComponent(title)}`, { headers: CSRF })).json();
  expect(notes.notes).toHaveLength(1);
  expect((await page.request.delete(`/api/notes/${notes.notes[0].id}`, { headers: CSRF })).ok()).toBe(true);
});

test.describe("dark", () => {
  test.use({ colorScheme: "dark" });
  test("the Data tab is accessible in the dark theme", async ({ page }) => {
    await page.goto("/entrar");
    await signIn(page);
    await expect(page.getByRole("heading", { level: 1, name: /^(Bom dia|Boa tarde|Boa noite)/ })).toBeVisible();
    await page.goto("/configuracoes/dados");
    await expect(page.getByRole("heading", { name: "Exportar e importar" })).toBeVisible();
    await expectAccessible(page, "dados escuro");
  });
});
