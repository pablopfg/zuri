import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, openPlace, settingsTitle, signIn, signOutFromMenu, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// Tasks, notes, folders ("projects" in the code) and the trash against the real Worker (step 6):
// create, edit, complete, delete and restore. pt-BR, the owner in São Paulo.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

async function openSignedIn(page: Page, path: string) {
  await page.goto(path);
  await signIn(page);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

test("a task: create with a deadline and a folder, edit, complete, delete and restore @mobile", async ({ page }) => {
  const title = `Pagar o condomínio ${test.info().project.name}`;
  await openSignedIn(page, "/tarefas");
  await expect(page.getByRole("heading", { level: 1, name: "Tarefas" })).toBeVisible();

  // A folder for it, from the folders dialog.
  await page.getByRole("button", { name: "Pastas" }).click();
  const projects = page.getByRole("dialog", { name: "Pastas" });
  await projects.getByLabel("Nome da pasta").fill(`Casa ${test.info().project.name}`);
  await projects.getByRole("button", { name: "Criar" }).click();
  await expect(projects.getByText(`Casa ${test.info().project.name}`)).toBeVisible();
  await projects.getByRole("button", { name: "Fechar" }).click();

  // Quick add: the title in view, the rest behind "Prazo, pasta e prioridade".
  const form = page.getByRole("region", { name: "Nova tarefa" });

  // In the Today view, a title alone is due today by the end of the day (23:59 in São Paulo).
  // The page's "now" is frozen at this test's "now", so "today" is the same day on
  // both sides even when the test runs across midnight in São Paulo.
  const now = new Date();
  await page.clock.setFixedTime(now);
  await form.getByLabel("Adicionar tarefa para hoje").fill(`${title} hoje`);
  const quick = page.waitForResponse((r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST");
  await form.getByLabel("Adicionar tarefa para hoje").press("Enter");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  const tomorrowUtc = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  expect(((await (await quick).json()) as { task: { dueAt: string } }).task.dueAt).toBe(`${tomorrowUtc}T02:59:00.000Z`);
  await expect(page.getByRole("region", { name: "Lista de tarefas" }).getByRole("button", { name: `${title} hoje` })).toBeVisible();
  expect(await tooSmallControls(page), "a task row is a 44 px target").toEqual([]);

  await form.getByLabel("Adicionar tarefa para hoje").fill(title);
  await form.getByRole("button", { name: "Prazo, pasta e prioridade" }).click();
  await form.getByLabel("Prazo").fill("2099-12-10");
  await form.getByLabel("Hora").fill("18:30");
  await form.getByLabel("Pasta").selectOption({ label: `Casa ${test.info().project.name}` });
  await form.getByLabel("Prioridade").selectOption({ label: "Alta" });
  const created = page.waitForResponse((r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST");
  await form.getByRole("button", { name: "Adicionar tarefa" }).click();
  const body = (await (await created).json()) as { task: { dueAt: string } };
  // 18:30 in São Paulo (UTC-3).
  expect(body.task.dueAt).toBe("2099-12-10T21:30:00.000Z");

  await page.getByRole("button", { name: /^Próximas \d+$/ }).click();
  const list = page.getByRole("region", { name: "Lista de tarefas" });
  await expect(list.getByRole("button", { name: title })).toBeVisible();
  await expect(list.getByText("10/12/2099 às 18:30")).toBeVisible();
  // The list comes under its headings, with the folder and the priority on the row (Sinal, PR S07).
  await expect(list.getByRole("heading", { level: 2, name: /^Próximas \d+$/ })).toBeVisible();
  const row = list.getByRole("listitem").filter({ hasText: title });
  await expect(row.getByText(`Casa ${test.info().project.name}`)).toBeVisible();
  await expect(row.getByText("Prioridade: Alta")).toBeVisible();
  await expectAccessible(page, "tarefas com itens");

  // Edit: new title, no time (the end of the day).
  await list.getByRole("button", { name: title }).click();
  const dialog = page.getByRole("dialog", { name: "Editar tarefa" });
  await dialog.getByLabel("Título").fill(`${title} de dezembro`);
  await dialog.getByLabel("Hora").fill("");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(list.getByText("10/12/2099", { exact: true })).toBeVisible();

  // Complete, find it among the completed ones, reopen.
  await list.getByRole("checkbox", { name: `Concluir "${title} de dezembro"` }).click();
  await expect(list.getByRole("button", { name: `${title} de dezembro` })).toBeHidden();
  await page.getByRole("button", { name: "Concluídas" }).click();
  await expect(list.getByRole("checkbox", { name: `Reabrir "${title} de dezembro"` })).toBeChecked();

  // Delete, undo, delete again, and restore from Settings › Data.
  await list.getByRole("button", { name: `${title} de dezembro` }).click();
  await page.getByRole("dialog", { name: "Editar tarefa" }).getByRole("button", { name: "Mover para a lixeira" }).click();
  await expect(page.getByText("Tarefa movida para a lixeira.")).toBeVisible();
  await expect(list.getByRole("button", { name: `${title} de dezembro` })).toBeHidden();
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(list.getByRole("button", { name: `${title} de dezembro` })).toBeVisible();

  await list.getByRole("button", { name: `${title} de dezembro` }).click();
  await page.getByRole("dialog", { name: "Editar tarefa" }).getByRole("button", { name: "Mover para a lixeira" }).click();
  await page.getByRole("link", { name: "Lixeira" }).click();
  // From Tasks the trash opens with only the tasks, the way back and "Ver tudo" (stage 26c).
  await expect(page).toHaveURL(/\/configuracoes\/dados\?tipo=tarefas$/);
  await expect(page.getByText("Só as tarefas apagadas.")).toBeVisible();
  // The trash leads the section, above the storage cards that load after it (the side menu's group titles come before it in the page).
  await expect(settingsTitle(page, "Dados").getByRole("heading", { level: 2 }).first()).toHaveText("Lixeira");
  await expect(page.getByRole("link", { name: "Voltar para Tarefas" })).toHaveAttribute("href", "/tarefas");
  // Emptying takes every kind, so it waits for "Ver tudo".
  await expect(page.getByRole("button", { name: "Esvaziar a lixeira" })).toHaveCount(0);
  const trashKinds = await page.getByRole("button", { name: /^Restaurar / }).count();
  await expect(page.getByText(/^Nota · /)).toHaveCount(0);
  // The count is the tasks' own: notes in the trash never make it say there are more to see (stage 25).
  await expect(page.getByText(/^Mostrando os /)).toHaveCount(0);
  await expectAccessible(page, "lixeira filtrada");
  // Notes' trash: the other kind, its way back.
  await page.goto("/configuracoes/dados?tipo=notas");
  await expect(page.getByText("Só as notas apagadas.")).toBeVisible();
  await expect(page.getByText(/^Tarefa · /)).toHaveCount(0);
  await expect(page.getByText(/^Mostrando os /)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Voltar para Notas" })).toHaveAttribute("href", "/notas");
  // An unknown kind shows the whole trash.
  await page.goto("/configuracoes/dados?tipo=outra");
  await expect(page.getByText(/^Só as /)).toHaveCount(0);
  await page.goto("/configuracoes/dados?tipo=tarefas");
  await page.getByRole("button", { name: "Ver tudo" }).click();
  await expect(page).toHaveURL(/\/configuracoes\/dados$/);
  await expect(page.getByText("Só as tarefas apagadas.")).toHaveCount(0);
  // The whole trash is its own list: it loads after the filtered one.
  await expect(page.getByRole("button", { name: `Restaurar ${title} de dezembro` })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
  expect(await page.getByRole("button", { name: /^Restaurar / }).count()).toBeGreaterThanOrEqual(trashKinds);
  await page.getByRole("button", { name: `Restaurar ${title} de dezembro` }).click();
  // The confirmation is a toast: spoken once by the status region, shown at the foot of the screen.
  await expect(page.getByRole("status").filter({ hasText: `"${title} de dezembro" voltou para o lugar` })).toHaveCount(1);
  await expect(page.getByText(`"${title} de dezembro" voltou para o lugar`).last()).toBeVisible();

  await page.goto("/tarefas");
  await page.getByRole("button", { name: "Concluídas" }).click();
  await expect(page.getByRole("button", { name: `${title} de dezembro` })).toBeVisible();
});

const SAVED = /^Salva às \d{2}:\d{2}$/;
const savedNote = (page: Page) => page.waitForResponse((r) => /\/api\/notes(\/[0-9a-f-]{36})?$/.test(r.url()) && ["POST", "PATCH"].includes(r.request().method()));
const noteMenu = (page: Page) => page.getByRole("button", { name: /^Mais opções para / });

test("a note: write Markdown, it saves itself, preview it safely, search, delete and restore @mobile", async ({ page }) => {
  // Wide screens keep the list beside the editor; phones take turns between them.
  const narrow = test.info().project.name === "mobile";
  // One title per run, so --repeat-each (how a flaky step is proven fixed) never finds an earlier copy.
  const title = `Receita ${test.info().repeatEachIndex} de bolo ${test.info().project.name}`;
  await openSignedIn(page, "/notas");
  await expect(page.getByRole("heading", { level: 1, name: "Notas" })).toBeVisible();
  // One "Nova nota", in the header (stage 26c: one main action per screen).
  await expect(page.getByRole("link", { name: "Nova nota" })).toHaveCount(1);
  await page.getByRole("link", { name: "Nova nota" }).click();
  await expect(page.getByText("Rascunho: salva sozinha enquanto você escreve")).toBeVisible();
  // No button to save: the note has none (Sinal, PR S07).
  await expect(page.getByRole("button", { name: "Salvar" })).toHaveCount(0);
  const created = savedNote(page);
  await page.getByLabel("Título").fill(title);
  await expect(page.getByText("Salvando…")).toBeVisible();
  expect((await created).request().method()).toBe("POST");
  // The note got its address and the same editor: the cursor is still in the title.
  await expect(page).toHaveURL(/\/notas\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Título")).toBeFocused();
  await expect(page.getByText(SAVED)).toBeVisible();

  const typed = savedNote(page);
  await page
    .getByLabel("Texto da nota")
    .fill('# Bolo de laranja\n\n- 3 ovos\n- [ ] comprar fermento\n\n<img src=x onerror="alert(1)">\n\n[link](javascript:alert(1))');
  // Only what changed goes: the text, not the title.
  expect((await typed).request().postDataJSON()).toEqual({ content: expect.stringContaining("Bolo de laranja"), ifUpdatedAt: expect.any(String) });
  await expect(page.getByText(SAVED)).toBeVisible();

  await page.getByRole("tab", { name: "Prévia" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "Bolo de laranja" })).toBeVisible();
  await expect(panel.locator("img")).toHaveCount(0);
  await expect(panel.getByRole("link")).toHaveCount(0);
  await expectAccessible(page, "nota visualizada");

  // The habit of saving with the keyboard saves at once.
  await page.getByRole("tab", { name: "Escrever" }).click();
  await page.getByLabel("Texto da nota").press("End");
  const byKey = savedNote(page);
  await page.getByLabel("Texto da nota").pressSequentially("\n- açúcar");
  await page.getByLabel("Texto da nota").press("ControlOrMeta+s");
  expect((await byKey).status()).toBe(200);
  await expect(page.getByText(SAVED)).toBeVisible();
  expect(await tooSmallControls(page), "the editor's controls are 44 px targets").toEqual([]);
  await expectAccessible(page, "nota aberta");

  // Leaving right after typing saves first and never asks.
  await page.getByLabel("Texto da nota").pressSequentially("\n- canela");
  const leaving = savedNote(page);
  await page.getByRole("link", { name: narrow ? "Todas as notas" : "Nova nota" }).click();
  expect((await leaving).request().postDataJSON()).toEqual({ content: expect.stringContaining("- canela"), ifUpdatedAt: expect.any(String) });
  await expect(page).toHaveURL(narrow ? /\/notas$/ : /\/notas\/nova$/);
  await expect(page.getByRole("dialog", { name: "Sair sem salvar?" })).toHaveCount(0);

  // Full-text search without the accent finds it; the row shows the hour it was saved and the start of the text.
  const row = page.getByRole("link", { name: new RegExp(title) });
  await expect(row).toContainText(/\d{2}:\d{2}/);
  await expect(row).toContainText("Bolo de laranja");
  await page.getByLabel("Buscar notas").fill("canela acucar");
  await expect(row).toBeVisible();
  await page.getByLabel("Buscar notas").fill('"fermento OR');
  await expect(row).toBeVisible();
  await page.getByLabel("Buscar notas").fill("abacaxi");
  await expect(page.getByText("Nenhuma nota encontrada")).toBeVisible();

  // The file of the note, then the trash and the undo from the list.
  await page.getByLabel("Buscar notas").fill("");
  await row.click();
  if (!narrow) await expect(row).toHaveAttribute("aria-current", "page");
  await noteMenu(page).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Baixar em Markdown" }).click();
  expect((await download).suggestedFilename()).toMatch(/^receita-\d+-de-bolo-[a-z]+\.md$/);
  await noteMenu(page).click();
  await page.getByRole("menuitem", { name: "Mover para a lixeira" }).click();
  await expect(page).toHaveURL(/\/notas$/);
  await expect(page.getByText("Nota movida para a lixeira.")).toBeVisible();
  await expect(row).toBeHidden();
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(row).toBeVisible();
});

test("a new note with only text is saved under a plain title, in the folder chosen, and nothing is created while it is empty", async ({ page }) => {
  const folder = `Pasta ${test.info().repeatEachIndex} das notas`;
  await openSignedIn(page, "/notas");
  expect((await page.request.post("/api/projects", { headers: CSRF, data: { name: folder } })).status()).toBe(201);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/notes")) posts.push(request.url());
  });
  await page.getByRole("link", { name: "Nova nota" }).click();
  // Typed and erased: there is nothing to keep.
  await page.getByLabel("Texto da nota").fill("x");
  await page.getByLabel("Texto da nota").fill("");
  await expect(page.getByText("Rascunho: salva sozinha enquanto você escreve")).toBeVisible();
  await page.locator("aside").getByRole("link", { name: "Tarefas" }).click();
  await expect(page).toHaveURL(/\/tarefas$/);
  expect(posts).toEqual([]);

  await page.goto("/notas/nova");
  const text = `só o texto ${test.info().repeatEachIndex} ${Date.now()}`;
  const created = savedNote(page);
  await page.getByLabel("Texto da nota").fill(text);
  await page.getByLabel("Pasta").selectOption({ label: folder });
  const body = (await created).request().postDataJSON() as { title: string; projectId: string | null };
  expect(body.title).toBe("Nota sem título");
  await expect(page).toHaveURL(/\/notas\/[0-9a-f-]{36}$/);
  // The field stays as the owner left it; the list shows the plain title and the folder.
  await expect(page.getByRole("textbox", { name: "Título" })).toHaveValue("");
  await expect(page.getByText(SAVED)).toBeVisible();
  const row = page.getByRole("list", { name: "Suas notas" }).getByRole("link").filter({ hasText: text });
  await expect(row).toContainText("Nota sem título");
  await expect(row).toContainText(folder);
  expect(posts).toHaveLength(1);
});

test("a note that could not be saved says so, keeps the text, asks before leaving and saves on the next try", async ({ page }) => {
  const title = `Sem rede ${test.info().repeatEachIndex} ${test.info().project.name}`;
  await openSignedIn(page, "/notas");
  const made = await page.request.post("/api/notes", { headers: CSRF, data: { title, content: "salvo antes" } });
  const { note } = (await made.json()) as { note: { id: string } };
  // Opened from the list, so the browser's back has an app page to return to.
  await page.reload();
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByLabel("Texto da nota")).toHaveValue("salvo antes");
  const noteUrl = page.url();

  // The network drops: every save of this note fails.
  await page.route(`**/api/notes/${note.id}`, (route) => (route.request().method() === "PATCH" ? route.abort() : route.fallback()));
  await page.getByLabel("Texto da nota").fill("ideia que ainda não foi salva");
  await page.getByLabel("Texto da nota").press("ControlOrMeta+s");
  const failed = page.getByRole("alert").filter({ hasText: "A nota não foi salva." });
  await expect(failed).toBeVisible();
  await expectAccessible(page, "nota que não salvou");
  const leave = page.getByRole("dialog", { name: "Sair sem salvar?" });

  // The sidebar: the save is tried again, fails, and the question shows. Staying keeps the text and the address.
  await page.locator("aside").getByRole("link", { name: "Tarefas" }).click();
  await expect(leave).toBeVisible();
  await expect(leave).toContainText("Não deu para salvar as últimas alterações desta nota.");
  await leave.getByRole("button", { name: "Continuar editando" }).click();
  await expect(leave).toBeHidden();
  expect(page.url()).toBe(noteUrl);
  await expect(page.getByLabel("Texto da nota")).toHaveValue("ideia que ainda não foi salva");

  // The browser's back: Escape also means stay.
  await page.goBack();
  await expect(leave).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(leave).toBeHidden();
  expect(page.url()).toBe(noteUrl);
  await expect(page.getByLabel("Texto da nota")).toHaveValue("ideia que ainda não foi salva");
  // Failing is not a loop: nothing is sent again until the owner types, leaves or asks.
  let tries = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH") tries += 1;
  });
  await page.clock.install();
  await page.clock.fastForward(120_000);
  expect(tries).toBe(0);

  // The network is back: "Tentar de novo" saves what is on the screen.
  await page.unroute(`**/api/notes/${note.id}`);
  const retried = savedNote(page);
  await failed.getByRole("button", { name: "Tentar de novo" }).click();
  expect((await retried).request().postDataJSON()).toEqual({ content: "ideia que ainda não foi salva", ifUpdatedAt: expect.any(String) });
  await expect(failed).toHaveCount(0);
  await expect(page.getByText(SAVED)).toBeVisible();

  // Discarding goes where the owner clicked; the server keeps the last version it got.
  await page.route(`**/api/notes/${note.id}`, (route) => (route.request().method() === "PATCH" ? route.abort() : route.fallback()));
  await page.getByLabel("Texto da nota").fill("isto se perde");
  await page.locator("aside").getByRole("link", { name: "Tarefas" }).click();
  await expect(leave).toBeVisible();
  // The network is back before the choice: thrown away means no last try when the editor closes.
  await page.unroute(`**/api/notes/${note.id}`);
  let late = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith(`/api/notes/${note.id}`)) late += 1;
  });
  await leave.getByRole("button", { name: "Sair sem salvar" }).click();
  await expect(page).toHaveURL(/\/tarefas$/);
  await page.clock.runFor(35_000);
  expect(late).toBe(0);
  const kept = (await (await page.request.get(`/api/notes/${note.id}`, { headers: CSRF })).json()) as { note: { content: string } };
  expect(kept.note.content).toBe("ideia que ainda não foi salva");
});

test("text typed a moment ago never holds back signing out", async ({ page }) => {
  await openSignedIn(page, "/notas/nova");
  await page.getByLabel("Título").fill("texto que vai embora com a sessão");
  await expect(page.getByText("Salvando…")).toBeVisible();
  await signOutFromMenu(page);
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByRole("dialog", { name: "Sair sem salvar?" })).toHaveCount(0);
});

test("leaving right after typing saves the note first, by the main navigation and by the browser's back @mobile", async ({ page }) => {
  const title = `Rascunho móvel ${test.info().repeatEachIndex} ${test.info().project.name}`;
  // From the list, so the browser's back has an app page to return to.
  await openSignedIn(page, "/notas");
  await page.getByRole("link", { name: "Nova nota" }).click();
  // A new note, left before the pause that saves it: it is created on the way out.
  const created = savedNote(page);
  await page.getByLabel("Título").fill(title);
  await openPlace(page, "Início");
  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("dialog", { name: "Sair sem salvar?" })).toHaveCount(0);

  await page.goto("/notas");
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page).toHaveURL(/\/notas\/[0-9a-f-]{36}$/);
  const noteUrl = page.url();
  const typed = savedNote(page);
  await page.getByLabel("Texto da nota").fill("escrito e já saindo");
  await page.goBack();
  expect((await typed).status()).toBe(200);
  await expect(page).toHaveURL(/\/notas$/);
  await page.goto(noteUrl);
  await expect(page.getByLabel("Texto da nota")).toHaveValue("escrito e já saindo");
});

test("moving a note to the trash right after typing keeps the text in the trash and does not ask about leaving", async ({ page }) => {
  const title = `Para a lixeira ${test.info().repeatEachIndex} ${test.info().project.name}`;
  await openSignedIn(page, "/notas/nova");
  await page.getByLabel("Título").fill(title);
  await expect(page).toHaveURL(/\/notas\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").at(-1);
  await page.getByLabel("Texto da nota").fill("texto que vai junto");
  await noteMenu(page).click();
  await page.getByRole("menuitem", { name: "Mover para a lixeira" }).click();
  await expect(page).toHaveURL(/\/notas$/);
  await expect(page.getByText("Nota movida para a lixeira.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Sair sem salvar?" })).toHaveCount(0);
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  const restored = (await (await page.request.get(`/api/notes/${id}`, { headers: CSRF })).json()) as { note: { content: string } };
  expect(restored.note.content).toBe("texto que vai junto");
});

test("the trash: purge one item and empty the rest, each after a confirmation", async ({ page }) => {
  await openSignedIn(page, "/configuracoes/dados");
  for (const title of ["lixo um", "lixo dois"]) {
    const res = await page.request.post("/api/tasks", { headers: CSRF, data: { title } });
    const { task } = (await res.json()) as { task: { id: string } };
    expect((await page.request.delete(`/api/tasks/${task.id}`, { headers: CSRF })).status()).toBe(200);
  }
  await page.reload();
  await expect(page.getByText("lixo dois")).toBeVisible();
  await expectAccessible(page, "lixeira com itens");
  await page.getByRole("button", { name: "Apagar de vez: lixo um" }).click();
  const confirm = page.getByRole("dialog", { name: "Apagar de vez?" });
  await confirm.getByRole("button", { name: "Apagar de vez" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Apagado de vez." })).toHaveCount(1);
  await expect(page.getByText("Apagado de vez.").last()).toBeVisible();
  await expect(page.getByText("lixo um")).toBeHidden();

  await page.getByRole("button", { name: "Esvaziar a lixeira" }).click();
  await page.getByRole("dialog", { name: "Esvaziar a lixeira?" }).getByRole("button", { name: "Esvaziar a lixeira" }).click();
  await expect(page.getByText("A lixeira está vazia")).toBeVisible();
});

test("the API refuses an impossible deadline even with an explicit zone", async ({ page }) => {
  await openSignedIn(page, "/tarefas");
  for (const dueAt of ["2026-02-29T10:00:00-03:00", "2026-04-31T10:00:00+09:00"]) {
    const res = await page.request.post("/api/tasks", { headers: CSRF, data: { title: "impossível", dueAt } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["dueAt"] } });
  }
});

test.describe("a device in another zone than the owner's", () => {
  // The device says Tokyo (UTC+9); the owner's setting says São Paulo (UTC-3).
  // Deadlines are typed and read in the owner's zone, never the device's.
  test.use({ timezoneId: "Asia/Tokyo" });

  test("a deadline typed in is read in the owner's zone", async ({ page }) => {
    // The owner's settings (the zone the form uses) arrive right after signing in.
    const settings = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "GET");
    await openSignedIn(page, "/tarefas");
    expect((await settings).status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Tarefas" })).toBeVisible();
    const form = page.getByRole("region", { name: "Nova tarefa" });
    const title = "Prazo no fuso do dono";
    await form.getByLabel("Adicionar tarefa para hoje").fill(title);
    await form.getByRole("button", { name: "Prazo, pasta e prioridade" }).click();
    await form.getByLabel("Prazo").fill("2099-12-10");
    await form.getByLabel("Hora").fill("18:30");
    const created = page.waitForResponse((r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST");
    await form.getByRole("button", { name: "Adicionar tarefa" }).click();
    const { task } = (await (await created).json()) as { task: { id: string; dueAt: string } };
    expect(task.dueAt).toBe("2099-12-10T21:30:00.000Z");

    await page.getByRole("button", { name: /^Próximas \d+$/ }).click();
    await expect(page.getByRole("region", { name: "Lista de tarefas" }).getByText("10/12/2099 às 18:30")).toBeVisible();
    expect((await page.request.delete(`/api/tasks/${task.id}`, { headers: CSRF })).status()).toBe(200);
  });

  test("S08: a deadline around today reads Ontem, Hoje or Amanhã by the owner's day, and the date beyond that", async ({ page }) => {
    // Frozen at the instant the days are counted from: the device (Tokyo) may already be on the next day.
    const now = new Date();
    await page.clock.setFixedTime(now);
    const SP = "America/Sao_Paulo";
    const day = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: SP }).format(new Date(now.getTime() + days * 86_400_000));
    const tag = uniqueTag("prazo");
    await openSignedIn(page, "/tarefas");
    const ids: string[] = [];
    try {
      for (const [name, dueAt] of [
        ["ontem", `${day(-1)}T18:00:00-03:00`],
        ["hoje", `${day(0)}T23:59:00-03:00`],
        ["amanha", `${day(1)}T09:30:00-03:00`],
        ["depois", `${day(2)}T09:30:00-03:00`],
      ] as const) {
        const res = await page.request.post("/api/tasks", { headers: CSRF, data: { title: `${tag} ${name}`, dueAt } });
        expect(res.status()).toBe(201);
        ids.push(((await res.json()) as { task: { id: string } }).task.id);
      }
      await page.reload();
      await page.getByRole("button", { name: /^Todas \d+$/ }).click();
      const row = (name: string) => page.getByRole("region", { name: "Lista de tarefas" }).getByRole("listitem").filter({ hasText: `${tag} ${name}` });
      await expect(row("ontem")).toContainText("Ontem, 18:00");
      // A deadline of the day alone (23:59) is the day alone.
      await expect(row("hoje")).toContainText(/Hoje(?!,)/);
      await expect(row("amanha")).toContainText("Amanhã, 09:30");
      const [, month, date] = day(2).split("-");
      await expect(row("depois")).toContainText(`${date}/${month}`);
      await expect(row("depois")).not.toContainText(/Amanhã|Hoje|Ontem/);
    } finally {
      for (const id of ids) await page.request.delete(`/api/tasks/${id}`, { headers: CSRF });
    }
  });
});
