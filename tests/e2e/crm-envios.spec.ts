import { expect, type Page, test } from "./fixtures.ts";
import { CSRF, expectAccessible, signIn, tooSmallControls, uniqueTag } from "./ui-helpers.ts";

// CRM › Envios (PR S19). The real Worker answers the empty queue and the
// pause; the states a fresh base can't reach (stopped, slow, a history with
// rows, a failed send) come from fixed answers of the same shape. pt-BR.

test.use({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

async function openOutbox(page: Page) {
  await page.goto("/crm/envios");
  await signIn(page);
  await expect(page).toHaveURL(/\/crm\/envios$/);
  await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Carregando" })).toHaveCount(0);
}

/** A status answer: the queue running with two waiting, unless the test changes it. */
function status(over: Record<string, unknown> = {}) {
  return {
    state: "running",
    lockdown: false,
    stopReason: null,
    since: null,
    lastAt: "2026-11-13T13:02:00.000Z",
    nextAt: "2026-11-13T13:02:41.000Z",
    waiting: 2,
    averageMs: 700,
    connection: { id: "con_e2e", name: "Chatwoot do consultório", bulkGap: { min: 30, max: 60 } },
    queue: [
      { id: "obx_1", label: "Pessoa de exemplo 1", automationId: "appointment-confirmation", at: "2026-11-13T13:02:41.000Z" },
      { id: "obx_2", label: "Pessoa de exemplo 2", automationId: "review-request", at: "2026-11-13T13:03:30.000Z" },
    ],
    ...over,
  };
}

const json = (body: unknown) => ({ contentType: "application/json", body: JSON.stringify(body) });

// Not on the phone too: the two projects share one server, and a pause in one would show in the other.
test("the empty queue, paused and resumed on the real server", async ({ page }) => {
  await openOutbox(page);
  // A pause left by an earlier run would hide the "Pausar" button.
  await page.request.post("/api/outbox/resume", { headers: CSRF });
  await page.reload();
  const parts = page.getByRole("navigation", { name: "Partes do CRM" });
  await expect(parts.getByRole("link", { name: /^Envios \d+$/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/Sai uma por vez, com a espera da credencial/)).toBeVisible();
  const card = page.getByRole("region", { name: "Situação do envio" });
  await expect(card).toContainText("Enviando");
  await expect(page.getByRole("region", { name: "Na fila agora" })).toContainText("Nenhuma mensagem esperando.");
  await expect(page.getByRole("region", { name: "Se algo der errado" }).getByRole("listitem")).toHaveCount(5);
  const history = page.getByRole("region", { name: "Histórico" });
  await expect(history.getByRole("button", { name: "Hoje" })).toHaveAttribute("aria-pressed", "true");
  await expect(history).toContainText("Nenhum envio com esse filtro neste período.");
  await expect(history).toContainText("O texto da mensagem não fica no histórico.");
  await expect(page.getByText(/\bweb\.[a-z]+\./i)).toHaveCount(0);
  await expectAccessible(page, "crm envios");
  expect(await tooSmallControls(page), "every control of Envios is a 44 px target").toEqual([]);

  await card.getByRole("button", { name: "Pausar envios" }).click();
  await expect(toast(page, "Envios pausados")).toBeVisible();
  await expect(card).toContainText("Pausada por você");
  await expect(card).toContainText("Nenhuma mensagem sai até você retomar.");
  // The pause holds after a reload: it lives on the server.
  await page.reload();
  await expect(card).toContainText("Pausada por você");
  await card.getByRole("button", { name: "Retomar envios" }).click();
  await expect(toast(page, "Envios retomados")).toBeVisible();
  await expect(card).toContainText("Enviando");
});

test("stopped after failures: the credential's test and the resume", async ({ page }) => {
  let resumed = false;
  let tested = "";
  await page.route("**/api/outbox/status", (route) => route.fulfill(json(resumed ? status() : status({ state: "stopped", stopReason: "failures", since: "2026-11-13T13:04:00.000Z", nextAt: null }))));
  await page.route("**/api/outbox/resume", (route) => {
    resumed = true;
    return route.fulfill(json({ ok: true }));
  });
  await page.route("**/api/flows/connections/*/test", (route) => {
    tested = route.request().url();
    return route.fulfill(json({ test: { ok: true, ms: 120, inboxes: [{ id: 7, name: "WhatsApp" }] } }));
  });
  await openOutbox(page);
  const card = page.getByRole("region", { name: "Situação do envio" });
  // In the owner's time zone: 13:04 UTC is 10:04 in São Paulo.
  await expect(card).toContainText("Parada desde 10:04");
  await expect(card).toContainText("Duas mensagens seguidas falharam.");
  await expect(card).toContainText("2 esperando");
  await expect(card.getByRole("button", { name: "Pausar envios" })).toHaveCount(0);
  // Stopped, nothing in the queue has a time: it shows "Esperando".
  const queue = page.getByRole("region", { name: "Na fila agora" });
  await expect(queue.getByRole("listitem")).toHaveCount(2);
  await expect(queue.getByRole("listitem").first()).toContainText("Esperando");
  await card.getByRole("button", { name: "Testar a credencial" }).click();
  await expect(toast(page, /Conectou/)).toBeVisible();
  expect(tested).toContain("/api/flows/connections/con_e2e/test");
  await expectAccessible(page, "envios parados");
  await card.getByRole("button", { name: "Retomar envios" }).click();
  await expect(toast(page, "Envios retomados")).toBeVisible();
  await expect(card).toContainText("Enviando");
  await expect(card).toContainText("Uma mensagem por vez, de 30 a 60 s entre elas.");
  await expect(card).toContainText("Última às 10:02:00 · próxima às 10:02:41 · 2 esperando");
  // Running, the first one is next and has its time.
  await expect(queue.getByRole("listitem").first()).toContainText("10:02");
  await expect(queue.getByRole("listitem").first()).toContainText("Próxima");
  await expect(queue.getByRole("listitem").first()).toContainText("Confirmação de consulta");
});

test("slow, and paused by the lockdown", async ({ page }) => {
  let answer = status({ state: "slow", averageMs: 6200 });
  await page.route("**/api/outbox/status", (route) => route.fulfill(json(answer)));
  await openOutbox(page);
  const card = page.getByRole("region", { name: "Situação do envio" });
  await expect(card).toContainText("Lenta");
  await expect(card).toContainText("Média de 6,2 s nas últimas 5 mensagens.");
  await expect(card.getByRole("button", { name: "Pausar envios" })).toBeVisible();
  answer = status({ state: "paused", lockdown: true, since: "2026-11-13T13:00:00.000Z" });
  await page.reload();
  await expect(card).toContainText("Pausada pelo bloqueio");
  // Only leaving the lockdown sends again: no button here.
  await expect(card.getByRole("button")).toHaveCount(0);
});

test("the history: period, filter, a send's steps and trying again @mobile", async ({ page }) => {
  const asked: string[] = [];
  let retried = "";
  await page.route("**/api/outbox/status", (route) => route.fulfill(json(status())));
  await page.route(/\/api\/outbox\?/, (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    const older = url.searchParams.get("cursor") !== null;
    const failed = url.searchParams.get("filter") === "failed";
    const rows = older
      ? [{ id: "obx_old", at: "2026-11-10T12:00:00.000Z", label: "Pessoa de exemplo 9", automationId: "birthday", status: "sent", attempts: 1 }]
      : [
          { id: "obx_fail", at: "2026-11-13T12:20:00.000Z", label: "Pessoa de exemplo 3", automationId: "review-request", status: "failed", attempts: 3 },
          ...(failed ? [] : [{ id: "obx_ok", at: "2026-11-13T12:10:00.000Z", label: "Pessoa de exemplo 4", automationId: "appointment-confirmation", status: "sent", attempts: 2 }]),
        ];
    return route.fulfill(json({ rows, counts: { sent: 12, delivered: 0, failed: 1, skipped: 2, averageMs: 700 }, cursor: older || failed ? null : "2026-11-13T12:10:00.000Z~obx_ok" }));
  });
  await page.route("**/api/outbox/obx_fail", (route) =>
    route.fulfill(
      json({
        id: "obx_fail",
        at: "2026-11-13T12:20:00.000Z",
        label: "Pessoa de exemplo 3",
        automationId: "review-request",
        status: "failed",
        attempts: 3,
        canRetry: true,
        steps: [
          { at: "2026-11-13T12:20:00.000Z", kind: "queued", attempt: null, ms: null, problem: null },
          { at: "2026-11-13T12:21:00.000Z", kind: "failed_try", attempt: 1, ms: 10000, problem: "timeout" },
          { at: "2026-11-13T12:23:00.000Z", kind: "uncertain", attempt: 2, ms: null, problem: "http" },
          { at: "2026-11-13T12:27:00.000Z", kind: "failed_try", attempt: 3, ms: null, problem: "network" },
          { at: "2026-11-13T12:27:00.000Z", kind: "gave_up", attempt: 3, ms: null, problem: null },
        ],
      }),
    ),
  );
  await page.route("**/api/outbox/obx_fail/retry", (route) => {
    retried = route.request().method();
    return route.fulfill(json({ ok: true }));
  });
  // "Today" is the page's: the rows of 13/11 show the clock alone, older ones the day too.
  await page.clock.setFixedTime(new Date("2026-11-13T15:00:00.000Z"));
  await openOutbox(page);
  const history = page.getByRole("region", { name: "Histórico" });
  await expect(history.getByText("Enviadas", { exact: true }).first()).toBeVisible();
  await expect(history).toContainText("12");
  await expect(history).toContainText("Resposta do Chatwoot: 0,7 s em média");
  await expect(history).toContainText("Confirmadas pelo WhatsApp");
  const rows = history.getByRole("list", { name: "Histórico" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("09:20");
  await expect(rows.first()).toContainText("Pedido de avaliação · 3 tentativas");
  await expect(rows.first()).toContainText("Falhou");
  await expect(rows.nth(1)).toContainText("Enviada");
  // Older pages by the cursor, never by an offset.
  await history.getByRole("button", { name: "Ver mais antigas" }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("10/11 · 09:00");
  expect(asked.at(-1)).toContain("cursor=2026-11-13T12%3A10%3A00.000Z%7Eobx_ok");
  await expect(history.getByRole("button", { name: "Ver mais antigas" })).toHaveCount(0);
  // Period and filter go to the server.
  await history.getByRole("button", { name: "7 dias" }).click();
  await expect(history.getByRole("button", { name: "7 dias" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => asked.at(-1)).toContain("period=7d");
  await history.getByRole("button", { name: "Com falha" }).click();
  await expect.poll(() => asked.at(-1)).toContain("filter=failed");
  await expect(rows).toHaveCount(1);

  await history.getByRole("button", { name: "Ver o envio para “Pessoa de exemplo 3”" }).click();
  const dialog = page.getByRole("dialog", { name: "Pedido de avaliação · Pessoa de exemplo 3" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Entrou na fila.");
  await expect(dialog).toContainText("1ª tentativa: o Chatwoot não respondeu em 10 s.");
  await expect(dialog).toContainText("2ª tentativa: o Chatwoot respondeu com erro. A Zuri confere na conversa antes de tentar de novo.");
  await expect(dialog).toContainText("A Zuri parou de tentar e avisou você.");
  await expect(dialog).toContainText("O texto da mensagem não fica guardado aqui");
  await expectAccessible(page, "envio com falha");
  await dialog.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(toast(page, "Voltou para a fila")).toBeVisible();
  expect(retried).toBe("POST");
  await expect(dialog).toHaveCount(0);
});

test("the screen's error, and a retry", async ({ page }) => {
  let fail = true;
  await page.route("**/api/outbox/status", (route) => (fail ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL", message: "Algo deu errado." }) }) : route.continue()));
  await openOutbox(page);
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.getByRole("region", { name: "Situação do envio" })).toBeVisible();
});

test("Credenciais shows the queue on the Chatwoot row, with the way to Envios", async ({ page }) => {
  await page.goto("/crm/credenciais");
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "CRM" })).toBeVisible();
  const name = `Chatwoot ${uniqueTag(test.info().project.name)}`;
  const created = await page.request.post("/api/flows/connections", {
    headers: CSRF,
    data: { kind: "chatwoot", name, origin: "https://chat.exemplo.com.br", accountId: 1, credential: "chave-do-agente-de-exemplo-4d2e" },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { connection: { id: string } }).connection.id;
  try {
    await page.reload();
    const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name }) });
    await expect(row).toContainText("Fila de envio");
    await expect(row).toContainText(/esperando · de \d+ a \d+ s entre uma mensagem e outra\./);
    await row.getByRole("link", { name: "Abrir Envios" }).click();
    await expect(page).toHaveURL(/\/crm\/envios$/);
    await expect(page.getByRole("region", { name: "Situação do envio" })).toBeVisible();
  } finally {
    await page.request.delete(`/api/flows/connections/${id}`, { headers: CSRF });
  }
});
