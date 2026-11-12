import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

// Google reviews (step 19c; their own area since the Sinal S12) against the real Worker. Over loopback the Worker
// answers Google itself (apps/agent/src/google/dev-google.ts): a profile with
// two old reviews, which the first read keeps as history, and three that
// "arrive" after it. Only Google's consent page is played here.

// The device in another time zone than the owner's: the dates on the cards follow the owner's.
test.use({ locale: "pt-BR", timezoneId: "Asia/Tokyo" });

// The account is one per installation: the test leaves it disconnected (which forgets the copy too).
test.afterEach(async ({ page }) => {
  await page.request.delete("/api/google", { headers: CSRF });
});

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

/** The list on one side and the open review on the other; in a narrow window the review takes the list's place. */
function parts(page: Page) {
  const list = page.getByRole("region", { name: "Lista de avaliações" });
  const detail = page.getByRole("region", { name: "Avaliação aberta" });
  /** Back to the list when the open review hides it (one column). */
  const back = async () => {
    if (!(await list.isVisible())) await detail.getByRole("link", { name: "Avaliações" }).click();
  };
  /** Opens a reviewer's line, going back to the list first. */
  const open = async (name: string) => {
    await back();
    await list.getByRole("link", { name: new RegExp(`^${name}`) }).click();
    await expect(detail.getByRole("heading", { level: 2, name })).toBeVisible();
  };
  return { list, detail, open, back, filter: list.getByRole("combobox", { name: "Filtrar avaliações" }) };
}

test("turns the reviews on in their own area, tells the team of a negative one and publishes an approved reply only after the checker; accessible @mobile", async ({ page }) => {
  await page.goto("/configuracoes/integracoes");
  await signIn(page);
  const card = page.getByRole("region", { name: "Google Agenda e Contatos" });
  await routeConsent(page);
  await card.getByRole("button", { name: "Conectar com o Google" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Google Agenda conectada." })).toBeVisible();

  // The simulated consent page grants every scope at once, so the Business Profile comes allowed with the
  // calendar (the second trip to Google is covered by test/reviews-routes.test.ts). Integrations only points
  // at the reviews' own settings now.
  const section = card.getByRole("region", { name: "Avaliações do Google" });
  await expect(section.getByText(/O perfil e o jeito de responder ficam em Avaliações\./)).toBeVisible();
  await section.getByRole("link", { name: "Ligar em Avaliações" }).click();
  await expect(page).toHaveURL(/\/avaliacoes\/ajustes$/);
  await expect(page.getByRole("heading", { level: 1, name: "Avaliações" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Partes de Avaliações" }).getByRole("link", { name: "Ajustes" })).toHaveAttribute("aria-current", "page");

  // The connection, step by step: the account and the permission are there, the profile is still to pick.
  const steps = page.getByRole("region", { name: "Conexão com o Perfil da Empresa" }).getByRole("listitem");
  await expect(steps.filter({ hasText: "Conta do Google" })).toContainText("Pronto:");
  await expect(steps.filter({ hasText: "Permissão para gerenciar o perfil" })).toContainText("Pronto:");
  await expect(steps.filter({ hasText: "Acesso liberado pelo Google" })).toContainText("Falta:");
  await expect(steps.filter({ hasText: "Escolha o perfil que a Zuri vai ler" })).toContainText("Falta:");
  await expectAccessible(page, "avaliacoes-conexao-antes");
  // Until a profile is picked, the other parts say so and lead back here.
  await page.getByRole("link", { name: "Como responder" }).click();
  await expect(page.getByText("O jeito de responder aparece depois que você escolhe o perfil.")).toBeVisible();
  await page.getByRole("navigation", { name: "Partes de Avaliações" }).getByRole("link", { name: "Visão geral" }).click();
  await expect(page.getByText("Avaliações desligadas", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Escolher perfil" }).click();

  // The profiles come from Google; the first save asks for the signature every reply ends with.
  await page.getByRole("button", { name: "Escolher perfil" }).click();
  const pick = page.getByRole("dialog", { name: "Perfis lidos" });
  await expect(pick.getByRole("checkbox")).toHaveCount(2);
  await pick.getByRole("checkbox", { name: "Exemplo Consultório" }).check();
  await pick.getByRole("textbox", { name: "Assinatura" }).fill("Equipe Exemplo");
  await pick.getByRole("button", { name: "Salvar perfis" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Avaliações salvas" })).toBeVisible();
  await expect(pick).toBeHidden();
  // Saving made the first read: Google let Zuri in, and the profile is named.
  await expect(steps.filter({ hasText: "Acesso liberado pelo Google" })).toContainText("Pronto:");
  await expect(steps.filter({ hasText: "Exemplo Consultório. Dá para escolher até 3." })).toContainText("Pronto:");
  await expect(page.getByRole("switch", { name: "Publicar no Google as respostas que você aprova" })).toBeChecked();
  await expectAccessible(page, "avaliacoes-conexao");
  expect(await tooSmallControls(page), "every control of the connection is a 44 px target").toEqual([]);

  // How to reply: the templates start with three suggestions; publishing by itself (step 19d) stays locked until the trial.
  await page.getByRole("navigation", { name: "Partes da configuração" }).getByRole("link", { name: "Como responder" }).click();
  await expect(page).toHaveURL(/\/avaliacoes\/ajustes\/responder$/);
  await expect(page.getByRole("textbox", { name: /^Modelo \d$/ })).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "Assinatura" })).toHaveValue("Equipe Exemplo");
  await expect(page.getByRole("option", { name: "Publica sozinha as positivas (ainda bloqueado)" })).toBeDisabled();
  // The trial is the owner's and outlives turning the reviews off: another project's run may have counted one already.
  await expect(page.getByText(/Você aprovou \d de 10 rascunhos sem mudar nada\./)).toBeVisible();
  await expectAccessible(page, "avaliacoes-como-responder");
  expect(await tooSmallControls(page), "every control of the reply settings is a 44 px target").toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "avaliacoes-como-responder escuro");
  await page.emulateMedia({ colorScheme: "light" });

  // The owner's interval between two checks stays in Integrations: 0 minutes is refused on the spot, 20 is kept, then back to 10.
  await page.goto("/configuracoes/integracoes");
  const every = section.getByRole("spinbutton", { name: "Conferir a cada (minutos)" });
  const saveEvery = section.getByRole("button", { name: "Salvar intervalo" });
  await every.fill("0");
  await expect(saveEvery).toBeDisabled();
  await every.fill("20");
  await saveEvery.click();
  await expect(page.getByRole("status").filter({ hasText: "Intervalo salvo" })).toBeVisible();
  await expect(saveEvery).toBeDisabled();
  await expect(section.getByText("De 1 a 1440 minutos. Quando nada mudou no Google, nada é regravado aqui.")).toBeVisible();
  await expect(section.getByText(/^Próxima leitura: \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await expectAccessible(page, "integracoes-avaliacoes");
  await every.fill("10");
  await saveEvery.click();
  await expect(every).toHaveValue("10");
  await expect(saveEvery).toBeDisabled();

  await section.getByRole("link", { name: "Abrir Avaliações" }).click();
  await page.getByRole("navigation", { name: "Partes de Avaliações" }).getByRole("link", { name: "Visão geral" }).click();
  await expect(page).toHaveURL(/\/avaliacoes$/);
  // Saving made the first read, which keeps what exists as history; this one brings the three new reviews.
  await expect(page.getByText(/^(Nada novo|Conferido) às \d{2}:\d{2}/)).toBeVisible();
  await expect(page.getByText("Exemplo Consultório", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Conferir agora" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Avaliações conferidas|Uma parte foi conferida/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Partes de Avaliações" }).getByRole("link", { name: "Avaliações 3 esperando você" })).toBeVisible();

  // The overview: the numbers of the real copy, and the three that wait, each with its way in.
  await expect(page.getByRole("combobox", { name: "Período" })).toHaveValue("30d");
  await expect(page.getByRole("heading", { level: 2, name: "Índice de recomendação por semana" })).toBeVisible();
  const waiting = page.getByRole("region", { name: "Precisa de você" });
  await expect(waiting.getByRole("link", { name: /^Revisar a avaliação de / })).toHaveCount(3);
  // The requests' funnel has no server yet: it stays away instead of showing zeros.
  await expect(page.getByText("Pedidos de avaliação")).toHaveCount(0);
  await expectAccessible(page, "avaliacoes-visao-geral");
  expect(await tooSmallControls(page), "every control of the overview is a 44 px target").toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "avaliacoes-visao-geral escuro");
  await page.emulateMedia({ colorScheme: "light" });

  // "Revisar" opens that review in the list, among the ones that wait.
  await waiting.getByRole("link", { name: "Revisar a avaliação de Diego" }).click();
  await expect(page).toHaveURL(/\/avaliacoes\/lista\/[0-9a-f-]{36}$/);
  const { list, detail, open, back, filter } = parts(page);
  await expect(detail.getByRole("heading", { level: 2, name: "Diego" })).toBeVisible();
  await expect(detail.getByText("Com a equipe")).toBeVisible();
  await expect(detail.getByText("Nota baixa")).toBeVisible();
  await expect(detail.getByRole("img", { name: "Nota 2 de 5" })).toBeVisible();
  // Only the first name ever shows.
  await expect(page.getByText("Diego Rocha")).toHaveCount(0);

  await back();
  await expect(filter.locator("option:checked")).toHaveText("Precisa de você (3)");
  await open("Carla");
  await expect(detail.getByText("Rascunho pronto")).toBeVisible();
  const reply = detail.getByRole("textbox", { name: "Resposta" });
  await expect(reply).toHaveValue(/Equipe Exemplo$/);
  await expectAccessible(page, "avaliacoes-lista");
  expect(await tooSmallControls(page), "every control of the screen is a 44 px target").toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "avaliacoes-lista escuro");
  await page.emulateMedia({ colorScheme: "light" });
  // The keyboard reaches the draft and its main action.
  await reply.focus();
  await page.keyboard.press("Tab");
  await expect(detail.getByRole("button", { name: "Aprovar e publicar" })).toBeFocused();

  // The fixed checker refuses a promise and a missing signature, whoever wrote it.
  const draft = await reply.inputValue();
  await reply.fill("Obrigado, Carla! Na próxima visita você ganha desconto.");
  await detail.getByRole("button", { name: "Aprovar e publicar" }).click();
  const confirm = page.getByRole("dialog", { name: "Publicar esta resposta no Google?" });
  await confirm.getByRole("button", { name: "Publicar" }).click();
  const refused = detail.getByRole("alert");
  await expect(refused).toContainText("tem palavra que nunca entra");
  await expect(refused).toContainText("precisa terminar com a assinatura");

  await reply.fill(draft);
  await detail.getByRole("button", { name: "Aprovar e publicar" }).click();
  await confirm.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Resposta publicada." })).toBeVisible();
  // Answered, it leaves the ones that wait: the address goes back to the list, and "Respondidas" has it.
  await expect(page).toHaveURL(/\/avaliacoes\/lista$/);
  await expect(filter.locator("option:checked")).toHaveText("Precisa de você (2)");
  await expect(list.getByRole("link", { name: /^Carla/ })).toHaveCount(0);
  await filter.selectOption("answered");
  await open("Carla");
  await expect(detail.getByText("Resposta publicada pela Zuri", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Apagar resposta" })).toBeVisible();

  // "Handled outside Zuri" takes the negative one off the queue without sending anything.
  await back();
  await filter.selectOption("needs");
  await open("Diego");
  await detail.getByRole("button", { name: "Já resolvi fora da Zuri" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Marcada como resolvida." })).toBeVisible();
  await expect(filter.locator("option:checked")).toHaveText("Precisa de você (1)");

  // Pausing is one icon with a name; the notice says what it means.
  await page.getByRole("button", { name: "Pausar respostas" }).click();
  await expect(page.getByText(/^Respostas pausadas\. A Zuri continua lendo/)).toBeVisible();
  await page.getByRole("button", { name: "Retomar respostas" }).click();
  await expect(page.getByText(/^Respostas pausadas\. A Zuri continua lendo/)).toHaveCount(0);

  // The way of replying is saved from its own part (a save asks Google again soon, so it comes last here).
  await page.goto("/avaliacoes/ajustes/responder");
  await page.getByRole("combobox", { name: "Tom" }).selectOption("formal");
  await page.getByRole("button", { name: "Salvar avaliações" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Avaliações salvas" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Tom" })).toHaveValue("formal");
  // A template the checker refuses comes back with its number and the reason, and nothing is saved.
  await page.getByRole("textbox", { name: "Modelo 2" }).fill("Obrigado pela visita, ligue para 4002-8922 e ganhe desconto.");
  await page.getByRole("button", { name: "Salvar avaliações" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /^Modelo 2: / })).toContainText("não pode ter números");

  // Turning off forgets the copy; the calendar stays.
  await page.goto("/avaliacoes/ajustes");
  await page.getByRole("button", { name: "Desligar avaliações" }).click();
  await page.getByRole("dialog", { name: "Desligar as avaliações?" }).getByRole("button", { name: "Desligar avaliações" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Avaliações desligadas" })).toBeVisible();
  await page.goto("/avaliacoes");
  await expect(page.getByText("Avaliações desligadas", { exact: true })).toBeVisible();
  await page.goto("/configuracoes/integracoes");
  await expect(card.getByRole("button", { name: "Desconectar" }).first()).toBeVisible();
});

/** A review as the screen gets it (step 19d's fields included). */
function item(over: Record<string, unknown>) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    location: "Exemplo Consultório",
    rating: 5,
    firstName: "Elisa",
    anonymous: false,
    comment: "",
    createdAt: "2026-11-03T15:00:00.000Z",
    updatedAt: "2026-11-03T15:00:00.000Z",
    state: "replied",
    reasons: [],
    draft: "Que alegria receber a sua avaliação, obrigado pela confiança de sempre!\n\nEquipe Exemplo",
    draftSource: "template",
    fallback: [],
    reply: "Que alegria receber a sua avaliação, obrigado pela confiança de sempre!\n\nEquipe Exemplo",
    replyMine: true,
    auto: true,
    version: "0".repeat(64),
    expiresAt: null,
    ...over,
  };
}

/** The state as the server sends it, with the reviews on. */
function state(over: Record<string, unknown> = {}) {
  return {
    connected: true,
    granted: true,
    enabled: true,
    level: "approve",
    paused: false,
    problem: null,
    lastCheckAt: "2026-11-03T15:10:00.000Z",
    nextSyncAt: null as string | null,
    lastResult: "unchanged",
    syncEveryMinutes: 10,
    locations: [{ id: "accounts/101/locations/201", title: "Exemplo Consultório", selected: true }],
    pattern: { signature: "Equipe Exemplo", tone: "close", templates: [], banned: [] },
    needs: 0,
    trial: { approved: 10, needed: 10 },
    autoToday: 0,
    breaker: null as null | { reason: string; at: string },
    ...over,
  };
}

/** The overview's numbers as GET /api/reviews/metrics sends them: counts only. */
function metrics(over: Record<string, unknown> = {}) {
  return {
    period: "30d",
    from: "2026-10-13T03:00:00.000Z",
    unit: "week",
    ratings: [5, 1, 0, 1, 0],
    buckets: [
      { key: "2026-10-12", promoters: 1, neutrals: 0, detractors: 1 },
      { key: "2026-10-19", promoters: 0, neutrals: 0, detractors: 0 },
      { key: "2026-10-26", promoters: 2, neutrals: 1, detractors: 0 },
      { key: "2026-11-02", promoters: 0, neutrals: 0, detractors: 0 },
      { key: "2026-11-09", promoters: 2, neutrals: 0, detractors: 0 },
    ],
    replied: 6,
    medianReplyMinutes: 240,
    requests: null,
    partial: false,
    ...over,
  };
}

const EMPTY_PAGE = { items: [], nextCursor: null, counts: { needs: 0, answered: 0, auto: 0, all: 0 } };

test("lists the replies published by itself with Delete reply, and shows why the breaker went off; accessible @mobile", async ({ page }) => {
  // The screen alone: the server's part (trial, limits, breaker) is covered by apps/agent/test/reviews-autonomy.test.ts.
  const status = state({ level: "auto", autoToday: 1 });
  await page.route("**/api/reviews/status", (route) => route.fulfill({ json: status }));
  await page.route(/\/api\/reviews\?/, (route) => {
    const tab = new URL(route.request().url()).searchParams.get("tab");
    const items = tab === "auto" || tab === "answered" || tab === "all" ? [item({})] : [];
    return route.fulfill({ json: { items, nextCursor: null, counts: { needs: 0, answered: 1, auto: 1, all: 1 } } });
  });
  await page.goto("/avaliacoes/lista");
  await signIn(page);
  const { detail, open, filter } = parts(page);
  await expect(page.getByText("A Zuri publica sozinha as respostas às positivas: 1 de 10 hoje.")).toBeVisible();
  // Nothing waits, so the list opens with everything.
  await expect(filter.locator("option:checked")).toHaveText("Todas (1)");
  await filter.selectOption("needs");
  await expect(page.getByText("Nada esperando você", { exact: true })).toBeVisible();
  await filter.selectOption("auto");
  await expect(filter.locator("option:checked")).toHaveText("Publicadas sozinha (1)");
  await open("Elisa");
  await expect(detail.getByText("Publicada sozinha", { exact: true })).toBeVisible();
  await expect(detail.getByText("Resposta publicada pela Zuri", { exact: true })).toBeVisible();
  // C7: Zuri's own reply can be deleted at Google, after a confirmation that names what happens.
  await detail.getByRole("button", { name: "Apagar resposta" }).click();
  const confirm = page.getByRole("dialog", { name: "Apagar a resposta no Google?" });
  await expect(confirm.getByText("A resposta some do seu perfil e a avaliação volta a esperar você.")).toBeVisible();
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expectAccessible(page, "avaliacoes-sozinha");
  expect(await tooSmallControls(page), "every control of the screen is a 44 px target").toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "avaliacoes-sozinha escuro");
  await page.emulateMedia({ colorScheme: "light" });
  // Confirming asks the server to delete it and says so.
  const deletes: string[] = [];
  await page.route(/\/api\/reviews\/[0-9a-f-]{36}\/reply/, (route) => {
    deletes.push(route.request().method());
    return route.fulfill({ json: { review: item({ state: "new", reply: null, replyMine: false, auto: false }) } });
  });
  await detail.getByRole("button", { name: "Apagar resposta" }).click();
  await confirm.getByRole("button", { name: "Apagar", exact: true }).click();
  await expect(page.getByText("Resposta apagada", { exact: true }).last()).toBeVisible();
  await expect(confirm).toBeHidden();
  expect(deletes).toEqual(["DELETE"]);

  // The breaker went off: back to drafts, the reason on top, and the filter stays while something went out by itself.
  status.level = "approve";
  status.autoToday = 0;
  status.breaker = { reason: "deleted", at: "2026-11-03T16:00:00.000Z" };
  await page.goto("/avaliacoes/lista");
  await expect(page.getByText(/A Zuri voltou a pedir sua aprovação em .*: uma resposta dela foi apagada ou trocada\./)).toBeVisible();
  await expect(page.getByText(/publica sozinha as respostas/)).toHaveCount(0);
  await expect(filter.getByRole("option", { name: "Publicadas sozinha (1)" })).toBeAttached();
  await expectAccessible(page, "avaliacoes-disjuntor");
});

test("the overview works the numbers out of the server's counts, for any number of weeks, and says when there is nothing to count; accessible @mobile", async ({ page }) => {
  const asked: string[] = [];
  let answer = metrics();
  await page.route("**/api/reviews/status", (route) => route.fulfill({ json: state() }));
  await page.route(/\/api\/reviews\?/, (route) => route.fulfill({ json: EMPTY_PAGE }));
  await page.route(/\/api\/reviews\/metrics/, (route) => {
    asked.push(new URL(route.request().url()).search);
    return route.fulfill({ json: answer });
  });
  await page.goto("/avaliacoes");
  await signIn(page);

  // 30 days is the period that opens (the owner's choice), asked once.
  await expect(page.getByRole("combobox", { name: "Período" })).toHaveValue("30d");
  const tile = (name: string) => page.locator("dl > div").filter({ has: page.locator("dt", { hasText: name }) });
  await expect(tile("Índice de recomendação")).toContainText("57");
  // The change is the screen's sum: the last week with reviews (100) against the first one (0).
  await expect(tile("Índice de recomendação")).toContainText("+100 desde o começo do período");
  await expect(tile("Nota média")).toContainText("4,4");
  await expect(tile("Nota média")).toContainText("7 avaliações");
  await expect(tile("Respondidas")).toContainText("86%");
  await expect(tile("Respondidas")).toContainText("6 de 7");
  await expect(tile("Tempo até responder")).toContainText("4 h");
  await expect(tile("Tempo até responder")).toContainText("metade respondida antes disso");
  expect(asked).toEqual(["?period=30d"]);

  // The stars, with shares that never divide by zero.
  const stars = page.getByRole("region", { name: "Estrelas" });
  await expect(stars.getByText("Recomendam: 5 · Neutros: 1 · Não recomendam: 1")).toBeVisible();
  await expect(stars.getByRole("listitem").filter({ has: page.getByRole("img", { name: "5 estrelas" }) })).toContainText("5 · 71%");
  await expect(stars.getByRole("listitem").filter({ has: page.getByRole("img", { name: "3 estrelas" }) })).toContainText("0 · 0%");

  // The chart has a table for whoever cannot read bars: five weeks, the empty ones saying so.
  const chart = page.getByRole("region", { name: "Índice de recomendação por semana" });
  await chart.getByText("Ver em tabela").click();
  await expect(chart.getByRole("row")).toHaveCount(6);
  await expect(chart.getByRole("row", { name: /^12\/10/ }).getByRole("cell").first()).toHaveText("0");
  await expect(chart.getByRole("row", { name: /^19\/10/ })).toContainText("Sem avaliações");
  await expect(chart.getByRole("row", { name: /^09\/11/ })).toContainText("100");
  // No funnel while the server sends no requests; nothing waiting says so.
  await expect(page.getByText("Pedidos de avaliação")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Precisa de você" }).getByText("Quando chegar uma avaliação nova, ela aparece aqui.")).toBeVisible();
  await expectAccessible(page, "avaliacoes-visao-geral-numeros");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "avaliacoes-visao-geral-numeros escuro");
  await page.emulateMedia({ colorScheme: "light" });

  // On a Monday the server sends six weeks; replies copied before the server kept their hour have no time.
  answer = metrics({
    buckets: [...metrics().buckets, { key: "2026-11-16", promoters: 0, neutrals: 0, detractors: 1 }],
    ratings: [5, 1, 0, 1, 1],
    medianReplyMinutes: null,
    partial: true,
  });
  await page.getByRole("combobox", { name: "Período" }).selectOption("6m");
  await expect(chart.getByRole("row")).toHaveCount(7);
  await expect(tile("Índice de recomendação")).toContainText("−100 desde o começo do período");
  await expect(tile("Tempo até responder")).toContainText("A Zuri não tem a hora das respostas mais antigas");
  await expect(page.getByText("São muitas avaliações neste período: só as 5.000 mais novas entraram na conta.")).toBeVisible();
  expect(asked.at(-1)).toBe("?period=6m");

  // Twelve months come by month; a period nobody reviewed in shows no zero index.
  answer = metrics({ period: "12m", unit: "month", ratings: [0, 0, 0, 0, 0], buckets: [{ key: "2026-11", promoters: 0, neutrals: 0, detractors: 0 }], replied: 0, medianReplyMinutes: null });
  await page.getByRole("combobox", { name: "Período" }).selectOption("12m");
  await expect(page.getByRole("heading", { level: 2, name: "Índice de recomendação por mês" })).toBeVisible();
  await expect(tile("Índice de recomendação")).toContainText("Sem avaliações");
  await expect(tile("Índice de recomendação")).not.toContainText("0");
  await expect(tile("Tempo até responder")).toContainText("Nenhuma resposta no período");
  await expect(page.getByText("Nenhuma avaliação neste período.")).toBeVisible();
  await expectAccessible(page, "avaliacoes-visao-geral-vazia");

  // The server refusing the numbers leaves a way to try again, and the rest of the area stays.
  await page.unroute(/\/api\/reviews\/metrics/);
  await page.route(/\/api\/reviews\/metrics/, (route) => route.fulfill({ status: 500, json: { code: "INTERNAL", message: "x" } }));
  await page.reload();
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Precisa de você" })).toBeVisible();
});

test("the count to the next check runs by the second and what the reviewer wrote is always plain text", async ({ page }) => {
  const now = new Date("2026-11-09T11:07:00.000Z");
  await page.clock.install({ time: now });
  const hostile = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script> {{7*7}}';
  await page.route("**/api/reviews/status", (route) =>
    route.fulfill({ json: state({ needs: 1, lastCheckAt: now.toISOString(), nextSyncAt: new Date(now.getTime() + 527_000).toISOString(), locations: [{ id: "accounts/101/locations/201", title: hostile, selected: true }] }) }),
  );
  await page.route(/\/api\/reviews\?/, (route) =>
    route.fulfill({ json: { items: [item({ firstName: "<b>Ana</b>", comment: hostile, state: "new", reply: null, replyMine: false, auto: false, draft: null, draftSource: null })], nextCursor: null, counts: { needs: 1, answered: 0, auto: 0, all: 1 } } }),
  );
  await page.route(/\/api\/reviews\/metrics/, (route) => route.fulfill({ json: metrics() }));
  await page.goto("/avaliacoes");
  await signIn(page);
  // The device is in Tokyo; the hour is the owner's (São Paulo).
  await expect(page.getByText("Nada novo às 08:07")).toBeVisible();
  const count = page.locator("p", { hasText: "Próxima em" }).locator("strong");
  const before = (await count.textContent()) ?? "";
  expect(before).toMatch(/^8:\d\d$/);
  // Short jumps, a second at a time.
  await page.clock.runFor(1000);
  await page.clock.runFor(1000);
  await expect(count).not.toHaveText(before);
  // The count is never in a live region: a screen reader would say it every second.
  expect(await count.evaluate((el) => !!el.closest('[role="status"], [role="alert"], [aria-live]'))).toBe(false);

  // Google's texts (profile name, reviewer's name and words) never become markup.
  await expect(page.getByText(hostile, { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Revisar a avaliação de <b>Ana</b>" }).click();
  const detail = page.getByRole("region", { name: "Avaliação aberta" });
  await expect(detail.getByRole("heading", { level: 2, name: "<b>Ana</b>" })).toBeVisible();
  await expect(detail.locator("blockquote")).toHaveText(hostile);
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  expect(await page.locator("main img[src='x'], main script").count()).toBe(0);
});

test("a failing list stays in sight in a narrow window, and an address of a review that is not there goes back to the list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fails = true;
  await page.route("**/api/reviews/status", (route) => route.fulfill({ json: state() }));
  await page.route(/\/api\/reviews\?/, (route) =>
    fails ? route.fulfill({ status: 500, json: { code: "INTERNAL", message: "x" } }) : route.fulfill({ json: { items: [item({})], nextCursor: null, counts: { needs: 0, answered: 1, auto: 0, all: 1 } } }),
  );
  await page.route(/\/api\/reviews\/metrics/, (route) => route.fulfill({ json: metrics() }));
  // A well-formed id that no review has (a kept link to one that left the list).
  await page.goto("/avaliacoes/lista/00000000-0000-4000-8000-0000000000ff");
  await signIn(page);
  const retry = page.getByRole("button", { name: "Tentar de novo" });
  await expect(retry).toBeVisible();
  fails = false;
  await retry.click();
  await expect(page).toHaveURL(/\/avaliacoes\/lista$/);
  await expect(page.getByRole("link", { name: /^Elisa/ })).toBeVisible();
  // Opening a review moves the focus to its name, since the line it came from is hidden.
  await page.getByRole("link", { name: /^Elisa/ }).click();
  await expect(page.getByRole("region", { name: "Avaliação aberta" }).getByRole("heading", { level: 2, name: "Elisa" })).toBeFocused();
});

test("SEC-S12-01: a review that changes behind the Publish dialog is not answered unread", async ({ page }) => {
  const waiting = { state: "proposed", reply: null, replyMine: false, auto: false, draftSource: "ai" };
  let review = item({ ...waiting, comment: "Atendimento excelente.", draft: "Obrigado pela visita!" });
  await page.route("**/api/reviews/status", (route) => route.fulfill({ json: state({ needs: 1 }) }));
  await page.route(/\/api\/reviews\?/, (route) => route.fulfill({ json: { items: [review], nextCursor: null, counts: { needs: 1, answered: 0, auto: 0, all: 1 } } }));
  await page.route(/\/api\/reviews\/metrics/, (route) => route.fulfill({ json: metrics() }));
  const sent: unknown[] = [];
  await page.route(/\/api\/reviews\/[0-9a-f-]{36}\/approve/, (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { code: "TARGET_CHANGED", message: "A avaliação mudou. Leia de novo." } });
  });
  await page.goto(`/avaliacoes/lista/${review.id}`);
  await signIn(page);
  const detail = page.getByRole("region", { name: "Avaliação aberta" });
  await detail.getByRole("button", { name: "Aprovar e publicar" }).click();
  const dialog = page.getByRole("dialog", { name: "Publicar esta resposta no Google?" });
  await expect(dialog.locator("blockquote")).toHaveText("Obrigado pela visita!");

  // The reviewer rewrites the review and the screen reads the list again, behind the dialog.
  review = item({ ...waiting, rating: 1, comment: "Péssimo.", draft: "Outro texto.", version: "1".repeat(64) });
  // The news comes as it does from another tab: the numbers of the areas, with the reviews' one moved (twice, whatever it was).
  const other = await page.context().newPage();
  await other.goto("/manifest.webmanifest");
  await other.evaluate(() => {
    const channel = new BroadcastChannel("zuri-versions");
    channel.postMessage({ reviews: 900_001 });
    channel.postMessage({ reviews: 900_002 });
  });
  await expect(detail.locator("blockquote").first()).toHaveText("Péssimo.");

  // The dialog still holds what the owner read, and that is what goes out: the server refuses the old version.
  await expect(dialog.locator("blockquote")).toHaveText("Obrigado pela visita!");
  await dialog.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("A avaliação mudou. Leia de novo.").last()).toBeVisible();
  expect(sent).toEqual([{ text: "Obrigado pela visita!", version: "0".repeat(64) }]);
});

test.describe("the list and the open review share the window only with room for both", () => {
  const many = Array.from({ length: 3 }, (_, n) => item({ id: `00000000-0000-4000-8000-00000000000${n + 1}`, firstName: ["Elisa", "Otávio", "Marina"][n], comment: "Atendimento atencioso do começo ao fim.", state: "replied" }));

  async function arrive(page: Page) {
    await page.route("**/api/reviews/status", (route) => route.fulfill({ json: state() }));
    await page.route(/\/api\/reviews\?/, (route) => route.fulfill({ json: { items: many, nextCursor: null, counts: { needs: 0, answered: 3, auto: 0, all: 3 } } }));
    await page.route(/\/api\/reviews\/metrics/, (route) => route.fulfill({ json: metrics() }));
    await page.goto("/avaliacoes/lista");
    await signIn(page);
    await expect(page.getByRole("region", { name: "Lista de avaliações" }).getByRole("link")).toHaveCount(3);
    // The measures only count once the font is in.
    await page.evaluate(() => document.fonts.ready);
  }

  for (const width of [821, 1100]) {
    test(`one column at ${width} px: the open review takes the list's place`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await arrive(page);
      const { list, detail } = parts(page);
      await expect(list).toBeVisible();
      await expect(detail).toBeHidden();
      await list.getByRole("link", { name: /^Otávio/ }).click();
      await expect(detail.getByRole("heading", { level: 2, name: "Otávio" })).toBeVisible();
      await expect(list).toBeHidden();
      // Back to the list, with the focus on the line it left.
      await detail.getByRole("link", { name: "Avaliações" }).click();
      await expect(list.getByRole("link", { name: /^Otávio/ })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "nothing scrolls sideways").toBe(true);
      // The overview's two cards also stack.
      await page.goto("/avaliacoes");
      const chart = await page.getByRole("region", { name: "Índice de recomendação por semana" }).boundingBox();
      const stars = await page.getByRole("region", { name: "Estrelas" }).boundingBox();
      if (!chart || !stars) throw new Error("the overview's two cards are on the screen");
      expect(stars.y).toBeGreaterThanOrEqual(chart.y + chart.height);
    });
  }

  test("two columns from 1.101 px, and no empty band in a short window", async ({ page }) => {
    await page.setViewportSize({ width: 1101, height: 800 });
    await arrive(page);
    const { list, detail } = parts(page);
    await expect(list).toBeVisible();
    // With room for both, the first review shows before any is picked.
    await expect(detail.getByRole("heading", { level: 2, name: "Elisa" })).toBeVisible();
    const left = await list.boundingBox();
    const right = await detail.boundingBox();
    expect(right?.x ?? 0).toBeGreaterThanOrEqual((left?.x ?? 0) + (left?.width ?? 0) - 1);
    await expect(detail.getByRole("link", { name: "Avaliações" })).toBeHidden();
    await page.goto("/avaliacoes");
    const chart = await page.getByRole("region", { name: "Índice de recomendação por semana" }).boundingBox();
    const stars = await page.getByRole("region", { name: "Estrelas" }).boundingBox();
    if (!chart || !stars) throw new Error("the overview's two cards are on the screen");
    expect(stars.y).toBe(chart.y);

    // 1440 × 600: each card is as tall as what it holds, never stretched to fill the window.
    await page.setViewportSize({ width: 1440, height: 600 });
    const card = page.getByRole("region", { name: "Estrelas" });
    const box = await card.boundingBox();
    const lastRow = await card.getByRole("listitem").last().boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0) - ((lastRow?.y ?? 0) + (lastRow?.height ?? 0))).toBeLessThanOrEqual(24);
    await page.goto("/avaliacoes/lista");
    // The frame ends where the taller column's content ends, plus its padding: nothing stretches it to the window.
    const frame = await page.locator(".zuri-reviews").boundingBox();
    const text = await detail.locator("article").boundingBox();
    const row = await list.getByRole("link").last().boundingBox();
    const bottom = (box: { y: number; height: number } | null) => (box ? box.y + box.height : 0);
    // At most a padding's worth of slack; stretched to the window it would be hundreds of pixels.
    expect(bottom(frame) - Math.max(bottom(text) + 24, bottom(row) + 16)).toBeLessThanOrEqual(24);
  });
});
