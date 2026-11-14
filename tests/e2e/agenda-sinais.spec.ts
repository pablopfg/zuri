import { expect, type Page, test } from "./fixtures.ts";
import { expectAccessible, signIn, tooSmallControls } from "./ui-helpers.ts";

/** The form names its fields by what is being booked: an appointment or a plain event (E5e). */
const NAME = /^(Nome completo do paciente|Título)$/;
const DAY = /^(Data da consulta|Data)$/;

// The sync signal of the Agenda (docs/planos/agenda-sinais-da-sincronizacao.md, E5d, protótipo v51 item 4):
// one button says where the Agenda stands with Google, and its panel says what happened, what to do,
// the visit's last changes and what each signal means. Google is answered here.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

/** Wednesday, 18/11/2026, 10:20 in São Paulo. */
const NOW = new Date("2026-11-18T10:20:00-03:00");
const iso = (local: string) => new Date(`${local}:00-03:00`).toISOString();

// An invented patient, on today, so a phone (which opens on the day) shows her too.
const HELENA = {
  id: "e0",
  calendarId: "main",
  title: "Helena Duarte Prado",
  allDay: false,
  start: iso("2026-11-18T14:00"),
  end: iso("2026-11-18T15:00"),
  location: "",
  description: "Consulta | Consultório",
  etag: '"v1"',
  recurring: false,
  guests: 0,
  colorId: "",
};

type Reply = "ok" | "network" | { status: number; code: string; message: string };

/** Google connected with Helena; each PATCH and each reading answers as the test says, in order, then "ok". */
async function routeAgenda(page: Page, { patches = [] as Reply[], reads = [] as Reply[], problem = { after: Number.POSITIVE_INFINITY } } = {}) {
  let event = { ...HELENA };
  const sent = { patches: 0, statuses: 0, revoked: false };
  const calendars = [{ id: "main", name: "Consultório", accessRole: "owner", primary: true, mode: "write", writable: true, color: "#4f7cff" }];
  await page.route("**/api/google", (route) => {
    sent.statuses++;
    const revoked = sent.revoked || sent.patches >= problem.after;
    return route.fulfill({
      json: { configured: true, connected: true, account: "dono@exemplo.com.br", status: revoked ? "error" : "connected", problem: revoked ? "revoked" : null, connectedAt: iso("2026-11-10T10:00"), calendars },
    });
  });
  const answer = (reply: Reply | undefined, ok: () => Promise<void>) => (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    if (reply === "network") return route.abort("internetdisconnected");
    if (reply && reply !== "ok") return route.fulfill({ status: reply.status, json: { code: reply.code, message: reply.message } });
    return ok();
  };
  await page.route("**/api/google/events?*", (route) => answer(reads.shift(), () => route.fulfill({ json: { more: false, calendars, events: [event] } }))(route));
  await page.route("**/api/google/events", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    sent.patches++;
    const body = route.request().postDataJSON() as { title?: string; etag?: string };
    // As Google does: a change named after an old version is refused.
    if (body.etag !== event.etag) return route.fulfill({ status: 409, json: { code: "TARGET_CHANGED", message: "O evento mudou no Google." } });
    return answer(patches.shift(), () => {
      event = { ...event, ...(typeof body.title === "string" ? { title: body.title } : {}), etag: `"v${sent.patches + 1}"` };
      return route.fulfill({ json: { event } });
    })(route);
  });
  return sent;
}

async function openAgenda(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto("/agenda");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
}

const signal = (page: Page) => page.getByRole("main").locator("[data-sync]");
const panel = (page: Page) => page.getByRole("dialog", { name: "Sincronização com o Google" });

/** Renames Helena by the form: one PATCH through the Agenda's changes. */
async function rename(page: Page, title: string) {
  await page.getByRole("main").getByRole("button", { name: /^Helena Duarte Prado/ }).click();
  await page.getByRole("dialog", { name: "Helena Duarte Prado" }).getByRole("button", { name: "Editar" }).click();
  const form = page.getByRole("dialog", { name: "Editar evento" });
  await form.getByLabel(NAME).fill(title);
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(form).toHaveCount(0);
}

test("in step, the signal opens the panel with the check time, no changes yet and what each signal means @mobile", async ({ page }) => {
  await routeAgenda(page);
  await openAgenda(page);
  await expect(signal(page)).toHaveText("Sincronizado");
  await expect(signal(page)).toHaveAccessibleName("Sincronização com o Google: Sincronizado. Ver detalhes");
  await signal(page).click();
  await expect(panel(page).getByRole("status")).toContainText("Tudo igual ao Google Agenda. Conferido às 10:20.");
  await expect(panel(page).getByText("Nenhuma mudança feita nesta visita.")).toBeVisible();
  await panel(page).getByText("O que cada sinal quer dizer").click();
  for (const name of ["Sincronizado", "Salvando…", "Salvo no Google", "Atualizando…", "Sem internet", "Falha ao salvar", "Mudou no Google", "Em pausa", "Desatualizada", "Conexão expirou", "Só leitura"]) {
    await expect(panel(page).getByRole("listitem").filter({ hasText: `${name}:` })).toHaveCount(1);
  }
  await expectAccessible(page, "agenda-sinais-painel");
  expect(await tooSmallControls(page), "every control of the panel is a 44 px target").toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(signal(page)).toBeFocused();
});

test("a saved change says Salvo no Google and goes into Últimas mudanças", async ({ page }) => {
  await routeAgenda(page);
  await openAgenda(page);
  await rename(page, "Helena Duarte Prado Souza");
  await expect(signal(page)).toHaveText("Salvo no Google");
  await signal(page).click();
  const line = panel(page).getByRole("listitem").filter({ hasText: "“Helena Duarte Prado Souza” atualizado." });
  await expect(line).toContainText("10:20");
  await expect(line).toContainText("Chegou ao Google:");
});

test("without internet the event goes back, the signal says Sem internet and Tentar de novo sends it again", async ({ page }) => {
  const sent = await routeAgenda(page, { patches: ["network"] });
  await openAgenda(page);
  await rename(page, "Helena Duarte Prado Souza");
  await expect(signal(page)).toHaveText("Sem internet");
  await expect(page.getByRole("main").getByRole("button", { name: /^Helena Duarte Prado(?! Souza)/ })).toBeVisible();
  await signal(page).click();
  await expect(panel(page).getByRole("status")).toContainText("A mudança de “Helena Duarte Prado” não chegou ao Google por falta de internet. O evento voltou ao que era.");
  await expect(panel(page).getByRole("listitem").filter({ hasText: "Não chegou ao Google:" })).toHaveCount(1);
  await expectAccessible(page, "agenda-sinais-sem-internet");
  await panel(page).getByRole("button", { name: "Tentar de novo" }).click();
  await expect(signal(page)).toHaveText("Salvo no Google");
  expect(sent.patches).toBe(2);
  // The toast's own "Tentar de novo" went with it: it cannot send the old version a second time.
  await expect(page.getByText("Não deu para salvar no Google. O evento voltou para onde estava.")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button", { name: /^Helena Duarte Prado Souza/ })).toBeVisible();
});

test("a change Google refuses says Falha ao salvar with the reason, and Ver o evento opens it", async ({ page }) => {
  await routeAgenda(page, { patches: [{ status: 400, code: "VALIDATION_FAILED", message: "O Google não aceitou os valores enviados." }] });
  await openAgenda(page);
  await rename(page, "Helena Duarte Prado Souza");
  await expect(signal(page)).toHaveText("Falha ao salvar");
  await signal(page).click();
  await expect(panel(page).getByRole("status")).toContainText("O Google recusou a mudança de “Helena Duarte Prado”. O Google não aceitou os valores enviados. O evento voltou ao que era.");
  await panel(page).getByRole("button", { name: "Ver o evento" }).click();
  await expect(page.getByRole("dialog", { name: "Helena Duarte Prado" })).toBeVisible();
});

test("an event changed at Google says Mudou no Google; a pause (429) says Em pausa and Tentar de novo goes through", async ({ page }) => {
  await routeAgenda(page, {
    patches: [
      { status: 409, code: "TARGET_CHANGED", message: "O evento mudou no Google." },
      { status: 429, code: "RATE_LIMITED", message: "O Google pediu um intervalo." },
    ],
  });
  await openAgenda(page);
  await rename(page, "Helena Duarte Prado Souza");
  await expect(signal(page)).toHaveText("Mudou no Google");
  await signal(page).click();
  await expect(panel(page).getByRole("status")).toContainText("“Helena Duarte Prado” foi mudado no Google enquanto você mexia aqui.");
  await expect(panel(page).getByRole("button", { name: "Ver o evento" })).toBeVisible();
  await page.keyboard.press("Escape");
  await rename(page, "Helena Duarte Prado Souza");
  await expect(signal(page)).toHaveText("Em pausa");
  await signal(page).click();
  await expect(panel(page).getByRole("status")).toContainText("Tente de novo em 1 minuto.");
  await panel(page).getByRole("button", { name: "Tentar de novo" }).click();
  await expect(signal(page)).toHaveText("Salvo no Google");
});

// A 429 is not tried again by the screen: the reading fails at once.
test("a reading that fails says Desatualizada, and Atualizar agora brings it back in step", async ({ page }) => {
  await routeAgenda(page, { reads: ["ok", { status: 429, code: "RATE_LIMITED", message: "O Google pediu um intervalo." }] });
  await openAgenda(page);
  await signal(page).click();
  await panel(page).getByRole("button", { name: "Atualizar agora" }).click();
  await expect(signal(page)).toHaveText("Desatualizada");
  await signal(page).click();
  await expect(panel(page).getByRole("status")).toContainText("Sem notícias do Google desde 10:20. Algum evento pode estar diferente lá.");
  await panel(page).getByRole("button", { name: "Atualizar agora" }).click();
  await expect(signal(page)).toHaveText("Sincronizado");
});

test("losing the access to Google in the middle of a visit puts Conectar de novo on the screen", async ({ page }) => {
  const sent = await routeAgenda(page, { patches: [{ status: 409, code: "CONFLICT", message: "A Zuri perdeu o acesso ao Google." }], problem: { after: 1 } });
  await openAgenda(page);
  const before = sent.statuses;
  await rename(page, "Helena Duarte Prado Souza");
  await expect(page.getByText("A Zuri perdeu o acesso ao Google. Conecte de novo em Integrações para ver a agenda.")).toBeVisible();
  expect(sent.statuses).toBeGreaterThan(before);
});

test("in English the signal and the panel speak English", async ({ page }) => {
  await routeAgenda(page);
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...((await response.json()) as object), language: "en" } });
  });
  await page.clock.setFixedTime(NOW);
  await page.goto("/agenda");
  await signIn(page);
  await expect(signal(page)).toHaveAccessibleName("Sync with Google: In sync. See details");
  await signal(page).click();
  await expect(page.getByRole("dialog", { name: "Sync with Google" }).getByRole("status")).toContainText("Everything matches Google Calendar. Checked at 10:20.");
});

test("the first reading never shows Desatualizada while it comes", async ({ page }) => {
  await routeAgenda(page);
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/google/events?*", async (route) => {
    await held;
    return route.fallback();
  });
  const seen: string[] = [];
  await page.exposeFunction("zuriSignal", (kind: string) => seen.push(kind));
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const kind = document.querySelector("[data-sync]")?.getAttribute("data-sync");
      if (kind) (window as unknown as { zuriSignal: (kind: string) => void }).zuriSignal(kind);
    }).observe(document, { subtree: true, attributes: true, childList: true });
  });
  await page.clock.setFixedTime(NOW);
  await page.goto("/agenda");
  await signIn(page);
  await expect(signal(page)).toHaveText("Atualizando…");
  release();
  await expect(signal(page)).toHaveText("Sincronizado");
  expect(seen).not.toContain("stale");
});

test("an event deleted at Google offers no Ver o evento", async ({ page }) => {
  await routeAgenda(page, { patches: [{ status: 404, code: "NOT_FOUND", message: "O evento não existe mais no Google." }] });
  await openAgenda(page);
  // The reading after the refusal no longer has Helena.
  await page.route("**/api/google/events?*", (route) => route.fulfill({ json: { more: false, calendars: [], events: [] } }));
  await rename(page, "Helena Duarte Prado Souza");
  await expect(signal(page)).toHaveText("Mudou no Google");
  await expect(page.getByRole("main").getByRole("button", { name: /^Helena Duarte Prado/ })).toHaveCount(0);
  await signal(page).click();
  await expect(panel(page).getByRole("button", { name: "Ver o evento" })).toHaveCount(0);
});

test("a reading refused because the access was lost puts Conectar de novo on the screen", async ({ page }) => {
  const sent = await routeAgenda(page, { reads: ["ok", { status: 409, code: "CONFLICT", message: "A Zuri perdeu o acesso ao Google." }] });
  await openAgenda(page);
  sent.revoked = true;
  await signal(page).click();
  await panel(page).getByRole("button", { name: "Atualizar agora" }).click();
  await expect(page.getByText("A Zuri perdeu o acesso ao Google. Conecte de novo em Integrações para ver a agenda.")).toBeVisible();
});

test("fifteen minutes without word from Google turn the signal to Desatualizada", async ({ page }) => {
  await routeAgenda(page);
  await page.clock.install({ time: NOW });
  await page.goto("/agenda");
  await signIn(page);
  await expect(signal(page)).toHaveText("Sincronizado");
  await page.clock.fastForward("15:31");
  await expect(signal(page)).toHaveText("Desatualizada");
  await signal(page).click();
  await expect(panel(page).getByRole("status")).toContainText("Sem notícias do Google desde 10:20.");
});
