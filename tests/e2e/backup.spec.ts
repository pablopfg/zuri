import { readFile } from "node:fs/promises";
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
  await expect(page.getByText("Backup baixado.")).toBeVisible();

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
  await expect(page.getByText("Backup importado: 1 tarefa.")).toBeVisible();

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
