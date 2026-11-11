import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, expectFits, rowAction, signIn, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// Memory and its history against the real Worker (step 7): save, duplicate,
// review a conflict, update a fact, history, restore and delete. pt-BR.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

async function openMemory(page: Page) {
  await page.goto("/memoria");
  await signIn(page);
  await expect(page).toHaveURL(/\/memoria$/);
  await expect(page.getByRole("heading", { level: 1, name: "Memória" })).toBeVisible();
}

/** The panel of the chosen memory: beside the list on a computer, in its place on a phone. */
const panel = (page: Page) => page.getByRole("complementary", { name: "Memória escolhida" });

/** Picks a memory on the list; its text becomes the panel's heading. */
async function openRow(page: Page, text: string) {
  await page.getByRole("region", { name: "Suas memórias" }).getByRole("button", { name: text }).click();
  await expect(panel(page).getByRole("heading", { level: 2, name: text })).toBeVisible();
}

/** On a phone, back to the list ("Voltar"); on a computer the list never left. */
async function backToList(page: Page) {
  const back = panel(page).getByRole("button", { name: "Voltar" });
  if (await back.isVisible()) await back.click();
}

/** "Nova memória" in the header opens a dialog (stage 26c); saving closes it. */
async function save(page: Page, text: string) {
  await page.getByRole("button", { name: "Nova memória" }).click();
  const form = page.getByRole("dialog", { name: "Nova memória" });
  await expect(form.getByLabel("Memória")).toBeFocused();
  await form.getByLabel("Memória").fill(text);
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/memories") && r.request().method() === "POST");
  await form.getByRole("button", { name: "Guardar" }).click();
  await saved;
  await expect(form).toBeHidden();
}

test("memories: save, duplicate, review a conflict, history, restore, update and delete @mobile", async ({ page }) => {
  // A word of its own per run: the database keeps what earlier runs and the other project saved.
  const tag = uniqueTag(test.info().project.name);
  await openMemory(page);
  const list = page.getByRole("region", { name: "Suas memórias" });

  // No form above the list: "Nova memória" opens a dialog, and Cancelar leaves without saving.
  await expect(page.getByLabel("Memória", { exact: true })).toHaveCount(0);
  const add = page.getByRole("button", { name: "Nova memória" });
  await add.click();
  const draft = page.getByRole("dialog", { name: "Nova memória" });
  await draft.getByLabel("Memória").fill(`Rascunho ${tag}`);
  await expectAccessible(page, "nova memória");
  await draft.getByRole("button", { name: "Cancelar" }).click();
  await expect(draft).toBeHidden();
  await expect(add).toBeFocused();
  await expect(list.getByText(`Rascunho ${tag}`)).toHaveCount(0);

  await save(page, `Eu dirijo um Volkswagen ${tag}`);
  await expect(page.getByRole("status").filter({ hasText: "Memória guardada" })).toBeVisible();
  await expect(list.getByText(`Eu dirijo um Volkswagen ${tag}`)).toBeVisible();

  // The same fact again: nothing new.
  await save(page, `eu dirijo um VOLKSWAGEN ${tag}`);
  await expect(page.getByRole("status").filter({ hasText: "Essa memória já estava guardada." })).toBeVisible();
  await expect(list.getByText(new RegExp(`dirijo um Volkswagen ${tag}`, "i"))).toHaveCount(1);

  // A change: both stay, and the review waits on top.
  await save(page, `Vendi meu Volkswagen ${tag} e comprei um Tesla`);
  // The other project's run left memories in the same database: count at least this one.
  await expect(page.getByRole("status").filter({ hasText: /possíve(l|is) conflitos? espera(m)? a sua revisão/ })).toBeVisible();
  // The review waits in a strip that opens when asked.
  const reviews = page.getByRole("region", { name: "Para revisar" });
  await expect(reviews.getByRole("heading", { name: /memórias? para revisar/ })).toBeVisible();
  const open = reviews.getByRole("button", { name: "Revisar" });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  const item = reviews
    .getByRole("listitem")
    .filter({ hasText: `Eu dirijo um Volkswagen ${tag}` })
    .filter({ hasText: `Vendi meu Volkswagen ${tag} e comprei um Tesla` });
  await expect(item.getByText("Possível atualização")).toBeVisible();
  await expect(item.getByText("A mais recente diz que algo da antiga mudou.")).toBeVisible();
  await expectAccessible(page, "memória com revisão");
  expect(await tooSmallControls(page), "every control of the memory page is a 44 px target").toEqual([]);

  await item.getByRole("button", { name: "Marcar a antiga como passado" }).click();
  await expect(page.getByRole("status").filter({ hasText: "A memória antiga agora é passado." })).toBeVisible();
  await expect(item).toHaveCount(0);

  // Only the past one under "Passadas", with its history.
  await page.getByRole("button", { name: /^Passadas/ }).click();
  const past = list.getByRole("listitem").filter({ hasText: `Eu dirijo um Volkswagen ${tag}` });
  await expect(past.getByText("Passado", { exact: true })).toBeVisible();
  // The actions live in the panel of the chosen memory.
  await openRow(page, `Eu dirijo um Volkswagen ${tag}`);
  await expect(panel(page).getByText("Fato · Passado")).toBeVisible();
  await rowAction(panel(page), page, "Histórico");
  const history = page.getByRole("dialog", { name: "Histórico da memória" });
  await expect(history.getByText("Depois")).toBeVisible();
  await expect(history.getByText(`Vendi meu Volkswagen ${tag} e comprei um Tesla`)).toBeVisible();
  await expectAccessible(page, "histórico");
  await history.getByRole("button", { name: "Fechar" }).click();

  // Restore as current.
  await rowAction(panel(page), page, "Restaurar como atual");
  await expect(panel(page).getByText("Fato · Atual")).toBeVisible();
  await backToList(page);
  await expect(list.getByText(`Eu dirijo um Volkswagen ${tag}`)).toHaveCount(0);
  await page.getByRole("button", { name: /^Atuais/ }).click();
  const current = list.getByRole("listitem").filter({ hasText: `Eu dirijo um Volkswagen ${tag}` });
  await expect(current).toBeVisible();

  // Update this fact: the old one becomes the past.
  await openRow(page, `Eu dirijo um Volkswagen ${tag}`);
  await rowAction(panel(page), page, "Atualizar este fato");
  const dialog = page.getByRole("dialog", { name: "Atualizar este fato" });
  await dialog.getByLabel("Como é agora").fill(`Eu dirijo uma bicicleta ${tag}`);
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "a anterior ficou no histórico" })).toBeVisible();
  await backToList(page);
  await expect(list.getByText(`Eu dirijo uma bicicleta ${tag}`)).toBeVisible();

  // Delete for good, after a confirmation.
  const bike = list.getByRole("listitem").filter({ hasText: `Eu dirijo uma bicicleta ${tag}` });
  await expect(bike).toBeVisible();
  await openRow(page, `Eu dirijo uma bicicleta ${tag}`);
  await rowAction(panel(page), page, "Apagar");
  const confirm = page.getByRole("dialog", { name: "Apagar esta memória?" });
  await expect(confirm.getByText("Não vai para a lixeira")).toBeVisible();
  await confirm.getByRole("button", { name: "Apagar de vez" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Memória apagada" })).toBeVisible();
  // The panel closes with the memory, and the list is back, also on a phone.
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Atuais/ })).toBeVisible();
  await expect(list.getByText(`Eu dirijo uma bicicleta ${tag}`)).toHaveCount(0);
});

test("memory: search, empty filter, the conflict review switch and keyboard only", async ({ page }) => {
  await openMemory(page);
  const list = page.getByRole("region", { name: "Suas memórias" });
  await page.getByRole("button", { name: /^Incertas/ }).click();
  await expect(list.getByText("Nenhuma memória neste filtro.")).toBeVisible();
  await page.getByRole("button", { name: /^Todas/ }).click();

  await page.getByLabel("Buscar nas memórias").fill("zzz-nada-assim");
  await expect(list.getByText("Nenhuma memória com essas palavras.")).toBeVisible();
  await page.getByLabel("Buscar nas memórias").fill("");

  // Stored text is shown as text, never as markup.
  await save(page, "<img src=x onerror=alert(1)> **negrito** <script>x</script>");
  await expect(list.getByText("<img src=x onerror=alert(1)> **negrito** <script>x</script>")).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);

  // The switch, by keyboard.
  const toggle = page.getByRole("switch", { name: "Revisão de conflitos" });
  await expect(toggle).toBeChecked();
  await toggle.focus();
  const press = async (expected: boolean) => {
    const patched = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "PATCH");
    await page.keyboard.press("Space");
    expect(((await (await patched).json()) as { memoryConflictReview: boolean }).memoryConflictReview).toBe(expected);
    await expect(toggle).toBeChecked({ checked: expected });
    // Saving keeps the focus on the switch.
    await expect(toggle).toBeFocused();
    await expect(toggle).not.toHaveAttribute("aria-busy");
  };
  await press(false);
  await press(true);

  // A new memory from the keyboard alone: the header button, the dialog's field, then Tipo, Cancelar and Guardar.
  await page.getByRole("button", { name: "Nova memória" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Nova memória" }).getByLabel("Memória")).toBeFocused();
  await page.keyboard.type("Prefiro reuniões pela manhã");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("dialog", { name: "Nova memória" }).getByRole("button", { name: "Guardar" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(list.getByText("Prefiro reuniões pela manhã")).toBeVisible();
});

test("memory: a failure shows an error with a retry", async ({ page }) => {
  await openMemory(page);
  await page.route("**/api/memories?**", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/memories?**");
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("memory in English: a conflict, replacing the older and discarding the newer, each after a confirmation", async ({ page }) => {
  const tag = uniqueTag("en");
  await page.goto("/configuracoes/conta");
  await signIn(page);
  try {
    await page.getByLabel("Idioma", { exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("link", { name: "Memory" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Memory" })).toBeVisible();
    const form = page.getByRole("dialog", { name: "New memory" });
    const saveEn = async (text: string) => {
      await page.getByRole("button", { name: "New memory" }).click();
      await form.getByLabel("Memory").fill(text);
      const saved = page.waitForResponse((r) => r.url().endsWith("/api/memories") && r.request().method() === "POST");
      await form.getByRole("button", { name: "Save" }).click();
      await saved;
      await expect(form).toBeHidden();
    };
    const reviews = page.getByRole("region", { name: "To review" });
    const list = page.getByRole("region", { name: "Your memories" });

    // Replace the older: the confirmation is a dialog, accessible, and only then the older one goes.
    await saveEn(`I live in London ${tag}`);
    await saveEn(`I live in Paris ${tag}`);
    await reviews.getByRole("button", { name: "Review" }).click();
    const first = reviews.getByRole("listitem").filter({ hasText: `I live in London ${tag}` }).filter({ hasText: `I live in Paris ${tag}` });
    await expect(first.getByText("Possible conflict")).toBeVisible();
    await expect(first.getByText("Both are about where you live, and it's unclear which one holds now.")).toBeVisible();
    await first.getByRole("button", { name: "Replace the older" }).click();
    const replace = page.getByRole("dialog", { name: "Delete the older memory?" });
    await expect(replace).toBeVisible();
    await expectAccessible(page, "confirmation dialog open");
    await replace.getByRole("button", { name: "Cancel" }).click();
    await expect(first).toBeVisible();
    await first.getByRole("button", { name: "Replace the older" }).click();
    await replace.getByRole("button", { name: "Delete for good" }).click();
    await expect(page.getByRole("status").filter({ hasText: "The older memory was deleted." })).toBeVisible();
    await expect(page.getByText(`I live in London ${tag}`)).toHaveCount(0);
    await expect(list.getByText(`I live in Paris ${tag}`)).toBeVisible();

    // Discard the newer: the newer one goes, the older stays current.
    await saveEn(`I live in Rome ${tag}`);
    const second = reviews.getByRole("listitem").filter({ hasText: `I live in Rome ${tag}` }).filter({ hasText: `I live in Paris ${tag}` });
    await second.getByRole("button", { name: "Discard the newer" }).click();
    await page.getByRole("dialog", { name: "Delete the newer memory?" }).getByRole("button", { name: "Delete for good" }).click();
    await expect(page.getByRole("status").filter({ hasText: "The newer memory was deleted." })).toBeVisible();
    await expect(page.getByText(`I live in Rome ${tag}`)).toHaveCount(0);
    await expect(list.getByText(`I live in Paris ${tag}`)).toBeVisible();
  } finally {
    const back = await page.request.patch("/api/settings", { headers: CSRF, data: { language: "pt-BR" } });
    expect(back.status()).toBe(200);
  }
});

test("never send out: a memory and a note marked stay on the account, and the mark is kept @mobile", async ({ page }) => {
  const tag = uniqueTag(test.info().project.name);
  await openMemory(page);
  await save(page, `O código do portão é ${tag}`);
  const row = page.getByRole("listitem").filter({ hasText: `O código do portão é ${tag}` });
  // The mark lives in the "Mais opções" menu of the chosen memory, as an item that reads out its state.
  await openRow(page, `O código do portão é ${tag}`);
  const more = panel(page).getByRole("button", { name: /^Mais opções/ });
  await more.click();
  const mark = page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Nunca enviar para fora" });
  // Opening focuses the first item; the arrow keys walk the rest.
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Atualizar este fato" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(mark).toBeFocused();
  await expect(mark).toHaveAttribute("aria-checked", "false");
  await expectAccessible(page, "menu mais opções");
  const marked = page.waitForResponse((r) => r.url().endsWith("/local-only") && r.request().method() === "POST");
  await mark.click();
  expect((await marked).status()).toBe(200);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await expect(page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Nunca enviar para fora" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(panel(page).getByText("Só na sua conta")).toBeVisible();
  await backToList(page);
  await expect(row.getByText("Só na sua conta")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: `O código do portão é ${tag}` }).getByText("Só na sua conta")).toBeVisible();
  await expectAccessible(page, "memoria-nunca-enviar");
  expect(await tooSmallControls(page)).toEqual([]);

  // A note: the switch saves at once and leaves the text being edited alone.
  const created = await page.request.post("/api/notes", { headers: CSRF, data: { title: `Cofre ${tag}`, content: "Combinação guardada" } });
  expect(created.status()).toBe(201);
  const { note } = (await created.json()) as { note: { id: string } };
  await page.goto(`/notas/${note.id}`);
  const toggle = page.getByRole("switch", { name: "Nunca enviar para fora" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "A nota agora fica só na sua conta." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Nunca enviar para fora" })).toBeChecked();
  await expectAccessible(page, "nota-nunca-enviar");
});

// ---------- Sinal, S06: the panel of links and the map ----------

/** A folder, a task, a note and three memories about the same move, plus one about something else. */
async function seedMove(page: Page, tag: string) {
  const post = async <T>(path: string, data: unknown): Promise<T> => {
    const res = await page.request.post(`/api${path}`, { headers: CSRF, data });
    expect(res.status(), path).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const folder = await post<{ project: { id: string } }>("/projects", { name: `Mudança ${tag}` });
  await post("/tasks", { title: `Encaixotar os livros da mudança ${tag}` });
  const note = await post<{ note: { id: string } }>("/notes", { title: `Lista da mudança ${tag}`, content: "Caixas, fita e etiquetas" });
  await post("/memories", { content: `Está cuidando da mudança ${tag} para o apartamento novo`, category: "project" });
  await post("/memories", { content: `Quer terminar a mudança ${tag} até o dia 20`, category: "goal" });
  await post("/memories", { content: `Prefere chá ${tag}`, category: "preference" });
  return { folder: folder.project.id, note: note.note.id };
}

test("memory: the panel shows what a memory is linked to, and each link opens @mobile", async ({ page }) => {
  const tag = uniqueTag(test.info().project.name);
  await openMemory(page);
  const { note } = await seedMove(page, tag);
  await page.reload();
  const list = page.getByRole("region", { name: "Suas memórias" });
  const center = `Está cuidando da mudança ${tag} para o apartamento novo`;

  // The list is grouped by type, each group with its name and how many it shows.
  await expect(list.getByRole("heading", { level: 2, name: /^Projeto \d+$/ })).toBeVisible();
  await expect(list.getByRole("heading", { level: 2, name: /^Objetivo \d+$/ })).toBeVisible();
  // The type filter is a row of buttons; one type at a time.
  await page.getByRole("button", { name: "Preferência", exact: true }).click();
  await expect(list.getByText(`Prefere chá ${tag}`)).toBeVisible();
  await expect(list.getByText(center)).toHaveCount(0);
  await page.getByRole("button", { name: "Todos os tipos" }).click();

  const row = list.getByRole("button", { name: center });
  await row.focus();
  await page.keyboard.press("Enter");
  const side = panel(page);
  await expect(side.getByRole("heading", { level: 2, name: center })).toBeVisible();
  await expect(side.getByText("Projeto · Atual")).toBeVisible();
  await expect(side.getByRole("heading", { level: 3, name: "Ligada a" })).toBeVisible();
  await expect(side.getByRole("link", { name: `Pasta “Mudança ${tag}”` })).toHaveAttribute("href", "/tarefas");
  await expect(side.getByRole("heading", { level: 3, name: "Aparece em" })).toBeVisible();
  await expect(side.getByRole("link", { name: `Tarefa “Encaixotar os livros da mudança ${tag}”` })).toBeVisible();
  await expect(side.getByRole("link", { name: `Nota “Lista da mudança ${tag}”` })).toHaveAttribute("href", `/notas/${note}`);
  await expect(side.getByRole("heading", { level: 3, name: "Memórias próximas" })).toBeVisible();
  await expect(side.getByText("A Zuri liga pelo nome da pasta e pelas palavras em comum, sem IA.")).toBeVisible();
  await expectAccessible(page, "memória com painel");
  expect(await tooSmallControls(page), "every control of the panel is a 44 px target").toEqual([]);

  // On a phone the panel took the list's place and has the focus; "Voltar" gives both back.
  const phone = await side.getByRole("button", { name: "Voltar" }).isVisible();
  if (phone) {
    await expect(side.getByRole("heading", { level: 2, name: center })).toBeFocused();
    await expect(list).toBeHidden();
    await side.getByRole("button", { name: "Voltar" }).click();
    await expect(row).toBeFocused();
    await row.click();
  } else {
    // On a computer the list stays, with the chosen row marked.
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await expect(row).toBeFocused();
  }

  // A nearby memory opens in the same panel; one with nothing in common says so.
  const near = `Quer terminar a mudança ${tag} até o dia 20`;
  await side.getByRole("button", { name: near }).click();
  await expect(side.getByRole("heading", { level: 2, name: near })).toBeVisible();
  await expect(side.getByText("Objetivo · Atual")).toBeVisible();
  await backToList(page);
  await openRow(page, `Prefere chá ${tag}`);
  await expect(side.getByText("Nada ligado a esta memória por enquanto.", { exact: false })).toBeVisible();
  await expect(side.getByRole("heading", { level: 3 })).toHaveCount(0);

  // A link leaves for the record's own screen.
  await backToList(page);
  await openRow(page, center);
  await side.getByRole("link", { name: `Nota “Lista da mudança ${tag}”` }).click();
  await expect(page).toHaveURL(new RegExp(`/notas/${note}$`));
});

test("memory: the map draws the same memories as points, by pointer and by keyboard @mobile", async ({ page }) => {
  const tag = uniqueTag(test.info().project.name);
  await openMemory(page);
  await seedMove(page, tag);
  await page.reload();
  const center = `Está cuidando da mudança ${tag} para o apartamento novo`;
  const side = panel(page);

  const asMap = page.getByRole("button", { name: "Mapa", exact: true });
  await expect(asMap).toHaveAttribute("aria-pressed", "false");
  const loaded = page.waitForResponse((r) => r.url().endsWith("/api/memories/graph"));
  await asMap.click();
  await loaded;
  await expect(asMap).toHaveAttribute("aria-pressed", "true");
  const map = page.getByRole("group", { name: "Mapa das memórias" });
  await expect(map).toBeVisible();
  // Every point is a button with a name: the memory's text, or the kind and the title.
  const point = map.getByRole("button", { name: center });
  const folder = map.getByRole("button", { name: `Pasta “Mudança ${tag}”` });
  await expect(point).toBeVisible();
  await expect(folder).toBeVisible();
  await expect(map.getByRole("button", { name: `Nota “Lista da mudança ${tag}”` })).toBeVisible();
  // The names are SVG text, never markup.
  expect(await map.locator("foreignObject").count()).toBe(0);
  await expectAccessible(page, "mapa da memória");
  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `mapa da memória (${scheme})`);
  }
  await expectFits(page, "mapa da memória");
  expect(await tooSmallControls(page), "the map's buttons are 44 px targets").toEqual([]);

  // The keyboard: one Tab stop on the map, arrows between the points, Enter picks.
  const stops = await map.locator('[role="button"][tabindex="0"]').count();
  expect(stops).toBe(1);
  await folder.focus();
  await page.keyboard.press("ArrowRight");
  await expect(map.locator('[role="button"]:focus')).not.toHaveAttribute("data-node", await folder.getAttribute("data-node").then(String));
  await page.keyboard.press("ArrowLeft");
  await expect(folder).toBeFocused();
  await page.keyboard.press("Enter");
  // A folder: what it is and the memories that name it.
  await expect(side.getByRole("heading", { level: 2, name: `Mudança ${tag}` })).toBeVisible();
  // On a computer the map stays beside the panel, with the point marked; on a phone the panel took its place.
  if (await map.isVisible()) await expect(folder).toHaveAttribute("aria-pressed", "true");
  else await expect(side.getByRole("heading", { level: 2, name: `Mudança ${tag}` })).toBeFocused();
  await expect(side.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", "/tarefas");
  await expect(side.getByRole("heading", { level: 3, name: "Memórias ligadas" })).toBeVisible();
  await side.getByRole("button", { name: center }).click();
  await expect(side.getByRole("heading", { level: 2, name: center })).toBeVisible();
  await expect(side.getByRole("link", { name: `Pasta “Mudança ${tag}”` })).toBeVisible();
  await backToList(page);
  await expect(map).toBeVisible();

  // The pointer picks a point too.
  await point.locator(".dot").click();
  await expect(side.getByRole("heading", { level: 2, name: center })).toBeVisible();
  await backToList(page);

  // Zoom, fit and the names.
  const sheet = map.locator("> g");
  const before = await sheet.getAttribute("transform");
  await page.getByRole("button", { name: "Aproximar" }).click();
  await expect(sheet).not.toHaveAttribute("transform", String(before));
  await page.getByRole("button", { name: "Afastar" }).click();
  await page.getByRole("button", { name: "Enquadrar tudo" }).click();
  await expect(sheet).toHaveAttribute("transform", "translate(0 0) scale(1)");
  const names = page.getByRole("button", { name: "Mostrar os nomes" });
  await names.click();
  await expect(names).toHaveAttribute("aria-pressed", "true");
  await expect(map.locator("text", { hasText: "Prefere chá" }).first()).toBeVisible();

  // A filter fades what it leaves out, without redrawing the map.
  await page.getByRole("button", { name: "Preferência", exact: true }).click();
  await expect(point).toHaveAttribute("data-off", "true");
  await page.getByRole("button", { name: "Todos os tipos" }).click();
  await expect(point).not.toHaveAttribute("data-off", "true");

  // Back to the list: the same memories.
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page.getByRole("region", { name: "Suas memórias" }).getByRole("button", { name: center })).toBeVisible();
});

test("memory map: a point can be dragged, a failure offers a retry, and too many memories are said", async ({ page }) => {
  const tag = uniqueTag("mapa");
  await openMemory(page);
  await seedMove(page, tag);

  // A failure first.
  await page.route("**/api/memories/graph", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.getByRole("button", { name: "Mapa", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/memories/graph");
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  const map = page.getByRole("group", { name: "Mapa das memórias" });
  await expect(map).toBeVisible();

  // Dragging moves the point and picks nothing.
  const point = map.getByRole("button", { name: `Prefere chá ${tag}` });
  await point.locator(".dot").scrollIntoViewIfNeeded();
  const from = await point.locator(".dot").boundingBox();
  if (!from) throw new Error("the point has no box");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 60, from.y + from.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const to = await point.locator(".dot").boundingBox();
  expect(Math.round((to?.x ?? 0) - from.x)).toBeGreaterThan(40);
  await expect(point).toHaveAttribute("aria-pressed", "false");

  // More memories than the map draws: it says so, and with one chosen it shows that one and its links.
  await page.route("**/api/memories/graph", async (route) => {
    const body = (await (await route.fetch()).json()) as { truncated: boolean };
    await route.fulfill({ json: { ...body, truncated: true } });
  });
  await page.reload();
  await page.getByRole("button", { name: "Mapa", exact: true }).click();
  await expect(page.getByText("O mapa mostra as 160 memórias mais recentes. Escolha uma na Lista para ver só as ligações dela.")).toBeVisible();
  await page.getByRole("group", { name: "Mapa das memórias" }).getByRole("button", { name: `Está cuidando da mudança ${tag} para o apartamento novo` }).locator(".dot").click();
  await expect(page.getByText("O mapa mostra a memória escolhida e o que se liga a ela.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Mapa das memórias" }).getByRole("button", { name: `Prefere chá ${tag}` })).toHaveCount(0);
});
