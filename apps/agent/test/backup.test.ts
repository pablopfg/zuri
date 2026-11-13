import { AGENT_INSTANCE_NAME, BACKUP_FORMAT, BACKUP_IMPORT_MAX_BYTES, BACKUP_VERSION, type BackupImportSummary, type StorageUse } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { exportBackup, portable } from "../src/backup/export.ts";
import { BACKUP_CONTAINERS_MAX, BACKUP_DEPTH_MAX } from "../src/backup/import.ts";
import { InternalState } from "../src/db/internal-state.ts";
import { LATEST_SCHEMA_VERSION } from "../src/db/migrations.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// Step 23: the portable backup. Export, import into an empty database and compare;
// a malicious file is refused whole; export and import are sensitive routes.

const IP = "192.0.2.231";
let cookie = "";
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));

const session = (method: string, path: string, body?: unknown, raw?: string) =>
  call(`${ORIGIN}/api${path}`, {
    method,
    headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, cookie },
    ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const fresh = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now()));
const stale = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));

/** Everything a backup carries, wiped (what the import of an "empty database" starts from). */
const DATA_TABLES = [
  "zur_tasks",
  "zur_notes",
  "zur_projects",
  "zur_memories",
  "zur_memory_reviews",
  "zur_messages",
  "zur_conversations",
  "zur_automations",
  "zur_alert_learning",
  "zur_crm_tags",
  "zur_crm_history",
  "zur_crm_clients",
  "zur_trash",
  "zur_agenda_record",
  "zur_agenda_closed_days",
];

const wipe = () =>
  inOwner(async (agent) => {
    const { db } = agent.store;
    for (const table of DATA_TABLES) db.run(`DELETE FROM ${table}`);
    db.run(`DELETE FROM zur_crm_tag_counts`);
    await agent.store.automations.rearm();
  });

const exported = () => inOwner((agent) => [...exportBackup({ db: agent.store.db, settings: () => agent.store.settings.get() })].join(""));

async function signIn(): Promise<void> {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
}

beforeAll(signIn);
beforeEach(fresh);
afterEach(async () => {
  await inOwner(async (agent) => {
    await agent.store.alerts.settled();
    agent.store.db.run(`DELETE FROM zur_auth_events`);
    agent.store.db.run(`DELETE FROM zur_notices`);
    // The event ids start again after the delete: an alert key left here would hide the next alert.
    agent.store.db.run(`DELETE FROM zur_alert_keys`);
    const state = new InternalState(agent.store.db);
    for (const key of ["lockdown_until", "lockdown_source"] as const) state.delete(key);
  });
  await wipe();
});

const ok = async <T>(res: Response | Promise<Response>): Promise<T> => {
  const r = await res;
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as T;
};

/** A little of everything, through the same routes the screens use (and the chat's tables, written as the runner does). */
async function seed(): Promise<void> {
  const { project } = await ok<{ project: { id: string } }>(session("POST", "/projects", { name: "Casa nova", description: "Mudança em março" }));
  await ok(session("POST", "/tasks", { title: "Pintar a sala", projectId: project.id, priority: "high", dueAt: "2026-12-01T12:00:00.000Z" }));
  const { task: done } = await ok<{ task: { id: string } }>(session("POST", "/tasks", { title: "Comprar tinta" }));
  await ok(session("PATCH", `/tasks/${done.id}`, { status: "done" }));
  const { note } = await ok<{ note: { id: string } }>(session("POST", "/notes", { title: "Senha do Wi-Fi da obra", content: "Só minha\n**importante**", projectId: project.id }));
  await ok(session("POST", `/notes/${note.id}/local-only`, { localOnly: true }));
  await ok(session("POST", "/notes", { title: "Lista do mercado", content: "pão, café" }));
  const { memory } = await ok<{ memory: { id: string } }>(session("POST", "/memories", { content: "Moro em Curitiba", category: "fact" }));
  await ok(session("POST", `/memories/${memory.id}/correct`, { content: "Moro em Florianópolis desde 2025" }));
  const { memory: secret } = await ok<{ memory: { id: string } }>(session("POST", "/memories", { content: "Meu médico é o Dr. Silva", category: "person" }));
  await ok(session("POST", `/memories/${secret.id}/local-only`, { localOnly: true }));
  await ok(session("POST", "/automations", { name: "Tomar remédio", kind: "reminder", message: "Remédio das 8h", schedule: { type: "daily", time: "08:00" } }));
  await ok(session("POST", "/automations", { name: "Resumo do dia", kind: "agent_prompt", message: "Resuma minhas tarefas", schedule: { type: "daily", time: "19:00" } }));
  await ok(session("POST", "/crm/clients", { name: "Ana Souza", phone: "+55 48 99999-0000", tags: ["vip", "retorno"], birthday: "1990-05-04", followUp: { at: "2027-01-10T12:00:00.000Z", note: "ligar" } }));
  await inOwner((agent) => {
    const { db } = agent.store;
    const id = crypto.randomUUID();
    db.run(`INSERT INTO zur_conversations (id, title, created_at, updated_at) VALUES (?, 'Viagem', '2026-11-01T10:00:00.000Z', '2026-11-01T10:05:00.000Z')`, id);
    db.run(`INSERT INTO zur_messages (id, conversation_id, role, content, tools, created_at) VALUES (?, ?, 'user', 'Qual a previsão?', '[{"name":"x"}]', '2026-11-01T10:00:00.000Z')`, crypto.randomUUID(), id);
    db.run(`INSERT INTO zur_messages (id, conversation_id, role, content, fallback, created_at) VALUES (?, ?, 'assistant', 'Sol o dia todo.', 1, '2026-11-01T10:00:05.000Z')`, crypto.randomUUID(), id);
    db.run(`INSERT INTO zur_alert_learning (key, shift, label, changed_at) VALUES ('watcher.overdue', -1, 'Tarefas atrasadas', '2026-11-02T00:00:00.000Z')`);
  });
}

/** The file without ids (each UUID becomes its order of appearance) and with the import's own marks. */
function comparable(text: string): unknown {
  const ids = new Map<string, number>();
  const body = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
    if (!ids.has(id)) ids.set(id, ids.size);
    return `#${ids.get(id)}`;
  });
  const parsed = JSON.parse(body) as { exportedAt: string; data: { memories: { origin: string }[] } };
  parsed.exportedAt = "";
  for (const m of parsed.data.memories) m.origin = "-";
  return parsed;
}

describe("export", () => {
  it("writes the versioned format with the last migration and every section", async () => {
    await seed();
    const file = JSON.parse(await exported());
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.schema).toBe(LATEST_SCHEMA_VERSION);
    expect(Object.keys(file.data)).toEqual(["settings", "projects", "tasks", "notes", "memories", "conversations", "automations", "alertLearning", "crm", "agendaRecord"]);
    expect(file.data.tasks).toHaveLength(2);
    expect(file.data.notes.find((n: { title: string }) => n.title.startsWith("Senha")).localOnly).toBe(true);
    expect(file.data.memories.find((m: { content: string }) => m.content.startsWith("Meu médico")).localOnly).toBe(true);
    expect(file.data.memories.find((m: { status: string }) => m.status === "historical").supersededBy).toMatch(/^[0-9a-f-]{36}$/);
    expect(file.data.automations.every((a: { paused: boolean }) => a.paused)).toBe(true);
    expect(file.data.conversations[0].messages).toHaveLength(2);
    expect(file.data.crm.clients[0].tags).toEqual(["retorno", "vip"]);
    expect(file.data.crm.clients[0].history.length).toBeGreaterThan(0);
  });

  it("never carries a secret, a session, a credential nor the server's own state", async () => {
    await seed();
    const text = await exported();
    const secrets = await inOwner((agent) => {
      const { db } = agent.store;
      return [
        ...db.all<{ value: string }>(`SELECT value FROM zur_settings WHERE key IN ('auth_password_hash', 'auth_secret_fingerprint', 'owner_email')`).map((r) => r.value),
        ...db.all<{ id: string }>(`SELECT id FROM zur_sessions`).map((r) => r.id),
      ];
    });
    expect(secrets.length).toBeGreaterThan(0);
    for (const secret of secrets) expect(text).not.toContain(JSON.parse(JSON.stringify(secret)).replaceAll('"', ""));
    expect(text).not.toContain(TEST_EMAIL);
    // No key anywhere in the file names a secret or a setting that stays out.
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key.toLowerCase());
          walk(inner);
        }
      }
    };
    walk(JSON.parse(text));
    for (const word of ["password", "passkey", "totp", "credential", "token", "session", "aimodel", "telegram", "mcp", "summary", "key_", "eventskey", "alertfulltext", "quoted", "tools", "secret"]) {
      expect([...keys].filter((key) => key.includes(word))).toEqual([]);
    }
  });

  it("never carries a Google contact nor a review, whatever is stored (steps 19b and 19c)", async () => {
    await seed();
    await inOwner((agent) => {
      const { db } = agent.store;
      db.run(
        `INSERT INTO zur_contacts (id, resource_name, etag, display_name, search_name, data, synced_at) VALUES ('contato-backup', 'people/backup-1', 'e', 'Contato Fora do Backup', 'contato fora do backup', '{"emails":["contato.fora@exemplo.com.br"]}', 1)`,
      );
      db.run(
        `INSERT INTO zur_reviews (id, location, google_name, rating, first_name, comment, created_at, updated_at, state, seen_at) VALUES ('avaliacao-backup', 'accounts/1/locations/2', 'accounts/1/locations/2/reviews/backup', 5, 'Avaliadora', 'Avaliação fora do backup', 'x', 'x', 'new', 1)`,
      );
    });
    const text = await exported();
    for (const value of ["Contato Fora do Backup", "contato.fora@exemplo.com.br", "people/backup-1", "Avaliação fora do backup", "reviews/backup", "Avaliadora"]) {
      expect(text, value).not.toContain(value);
    }
    await inOwner((agent) => {
      agent.store.db.run(`DELETE FROM zur_contacts WHERE id = 'contato-backup'`);
      agent.store.db.run(`DELETE FROM zur_reviews WHERE id = 'avaliacao-backup'`);
    });
  });

  it("leaves out a stored row that no longer passes the schema, so the file always reads back", async () => {
    await inOwner((agent) => {
      agent.store.db.run(`INSERT INTO zur_projects (id, name, description, status, created_at, updated_at) VALUES (?, 'Bom', '', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`, crypto.randomUUID());
      agent.store.db.run(`INSERT INTO zur_projects (id, name, description, status, created_at, updated_at) VALUES (?, ?, '', 'active', 'ontem', '2026-01-01T00:00:00.000Z')`, crypto.randomUUID(), "Ruim\u0000");
    });
    const file = JSON.parse(await exported());
    expect(file.data.projects.map((p: { name: string }) => p.name)).toEqual(["Bom"]);
  });

  it("pages through more than one page of rows", async () => {
    await inOwner((agent) => {
      for (let i = 0; i < 1_201; i++) {
        agent.store.db.run(`INSERT INTO zur_tasks (id, title, created_at, updated_at) VALUES (?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`, crypto.randomUUID(), `t${i}`);
      }
    });
    const file = JSON.parse(await exported());
    expect(file.data.tasks).toHaveLength(1_201);
    expect(file.data.tasks.at(-1).title).toBe("t1200");
  });
});

describe("import", () => {
  it("round trip: export, import into an empty database and export again gives the same content", async () => {
    await seed();
    const first = await exported();
    await wipe();
    const { summary } = await ok<{ summary: BackupImportSummary }>(session("POST", "/backup/import", undefined, first));
    expect(summary).toMatchObject({ projects: 1, tasks: 2, notes: 2, memories: 3, conversations: 1, messages: 2, automations: 2, routinesToApprove: 1, clients: 1, clientsSkipped: 0 });
    const second = await exported();
    expect(comparable(second)).toEqual(comparable(first));
  });

  it("gives every record a new id, marks memories and messages as imported, and turns nothing on", async () => {
    await seed();
    const first = JSON.parse(await exported());
    await wipe();
    await ok(session("POST", "/backup/import", first));
    const rows = await inOwner((agent) => {
      const { db } = agent.store;
      return {
        projects: db.all<{ id: string }>(`SELECT id FROM zur_projects`).map((r) => r.id),
        automations: db.all<{ kind: string; status: string; next_run: string | null }>(`SELECT kind, status, next_run FROM zur_automations ORDER BY kind`),
        memories: db.all<{ origin: string }>(`SELECT DISTINCT origin FROM zur_memories`),
        messages: db.all<{ source: string; tools: string }>(`SELECT DISTINCT source, tools FROM zur_messages`),
        summaries: db.all<{ summary: string | null }>(`SELECT summary FROM zur_conversations`),
      };
    });
    expect(rows.projects).not.toContain(first.data.projects[0].id);
    expect(rows.automations).toEqual([
      { kind: "agent_prompt", status: "pending_approval", next_run: null },
      { kind: "reminder", status: "paused", next_run: null },
    ]);
    expect(rows.memories).toEqual([{ origin: "import" }]);
    expect(rows.messages).toEqual([{ source: "import", tools: "[]" }]);
    expect(rows.summaries).toEqual([{ summary: null }]);
  });

  it("merges next to what is here: importing twice doubles the records, and the same n8n client is not repeated", async () => {
    await seed();
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_crm_clients SET ref = 'chatwoot-42'`));
    const file = await exported();
    await ok(session("POST", "/backup/import", undefined, file));
    const { summary } = await ok<{ summary: BackupImportSummary }>(session("POST", "/backup/import", undefined, file));
    expect(summary).toMatchObject({ clients: 0, clientsSkipped: 1, tasks: 2 });
    const counts = await inOwner((agent) => agent.store.db.one<{ t: number; c: number }>(`SELECT (SELECT count(*) FROM zur_tasks) AS t, (SELECT count(*) FROM zur_crm_clients) AS c`));
    expect(counts).toEqual({ t: 6, c: 1 });
  });

  it("carries the time of the CRM's birthday notice, and a file of before it leaves the time as it is", async () => {
    await seed();
    const time = () => inOwner((agent) => agent.store.db.one(`SELECT reminder_time FROM zur_crm_settings WHERE id = 1`));
    try {
      await ok(session("PATCH", "/crm/settings", { birthdayTime: "07:30" }));
      const file = await exported();
      expect(JSON.parse(file).data.crm.settings).toEqual({ followUps: true, birthdays: true, newClients: true, birthdayTime: "07:30" });
      await ok(session("PATCH", "/crm/settings", { birthdayTime: "10:00" }));
      await ok(session("POST", "/backup/import", undefined, file));
      expect(await time()).toEqual({ reminder_time: "07:30" });
      const older = JSON.parse(file);
      older.data.crm.settings = { followUps: true, birthdays: true, newClients: true };
      await ok(session("PATCH", "/crm/settings", { birthdayTime: "11:00" }));
      await ok(session("POST", "/backup/import", undefined, JSON.stringify(older)));
      expect(await time()).toEqual({ reminder_time: "11:00" });
      // A file with a time no clock shows, or a field the copy never had, imports nothing.
      for (const settings of [{ birthdayTime: "25:00" }, { newClientNoticesPerDay: 5 }]) {
        const bad = JSON.parse(file);
        Object.assign(bad.data.crm.settings, settings);
        expect((await session("POST", "/backup/import", undefined, JSON.stringify(bad))).status, JSON.stringify(settings)).toBe(400);
      }
      expect(await time()).toEqual({ reminder_time: "11:00" });
    } finally {
      await inOwner((agent) => agent.store.db.run(`UPDATE zur_crm_settings SET reminder_time = '09:00', reminded_day = NULL, next_reminder = NULL`));
    }
  });

  it("drops links to records missing from the file and a loop of replaced memories", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const memory = (id: string, supersededBy: string | null) => ({
      id,
      content: `fato ${id.slice(0, 4)}`,
      category: "fact",
      origin: "app",
      author: "owner",
      status: "historical",
      supersededBy,
      validFrom: null,
      validUntil: null,
      localOnly: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const file = backup({
      memories: [memory(a, b), memory(b, a)],
      tasks: [{ ...TASK, projectId: crypto.randomUUID() }],
    });
    await ok(session("POST", "/backup/import", file));
    const rows = await inOwner((agent) => agent.store.db.all<{ superseded_by: string | null }>(`SELECT superseded_by FROM zur_memories ORDER BY content`));
    expect(rows.filter((r) => r.superseded_by === null)).toHaveLength(1);
    const task = await inOwner((agent) => agent.store.db.one<{ project_id: string | null }>(`SELECT project_id FROM zur_tasks`));
    expect(task?.project_id).toBeNull();
  });

  it("the sounds go in the file and come back, an older file without them changes nothing, and a bad one is refused whole", async () => {
    const sounds = { notice: false, pick: "gota", recording: false } as const;
    const before = await inOwner((agent) => agent.store.settings.get().sounds);
    try {
      await inOwner((agent) => agent.store.settings.update({ sounds }));
      expect((JSON.parse(await exported()) as { data: { settings: { sounds: unknown } } }).data.settings.sounds).toEqual(sounds);
      await inOwner((agent) => agent.store.settings.update({ sounds: before }));
      await ok(session("POST", "/backup/import", backup({ settings: { sounds } })));
      expect(await inOwner((agent) => agent.store.settings.get().sounds)).toEqual(sounds);
      // A file made before the sounds existed.
      await ok(session("POST", "/backup/import", backup({ settings: { language: "pt-BR" } })));
      expect(await inOwner((agent) => agent.store.settings.get().sounds)).toEqual(sounds);
      const bad = await session("POST", "/backup/import", backup({ settings: { sounds: { ...sounds, pick: "sirene" } } }));
      expect(bad.status).toBe(400);
      expect(await inOwner((agent) => agent.store.settings.get().sounds)).toEqual(sounds);
    } finally {
      await inOwner((agent) => agent.store.settings.update({ sounds: before }));
    }
  });

  it("SEC-S08-01: the Agenda's preferences go in the file and come back, and a bad one is refused whole", async () => {
    const agenda = { from: 7, to: 20, view: "day", weekStart: 0, workDays: [1, 2, 3], daysOff: false, outside: false, lunch: { from: 720, to: 810 }, closed: [{ from: "2026-12-24", to: "2027-01-03", reason: "Recesso" }] };
    const before = await inOwner((agent) => agent.store.settings.get().agenda);
    try {
      await inOwner((agent) => agent.store.settings.update({ agenda: agenda as unknown as typeof before }));
      expect((JSON.parse(await exported()) as { data: { settings: { agenda: unknown } } }).data.settings.agenda).toEqual(agenda);
      await inOwner((agent) => agent.store.settings.update({ agenda: before }));
      await ok(session("POST", "/backup/import", backup({ settings: { agenda } })));
      expect(await inOwner((agent) => agent.store.settings.get().agenda)).toEqual(agenda);
      const bad = await session("POST", "/backup/import", backup({ settings: { agenda: { ...agenda, from: 20, to: 7 } } }));
      expect(bad.status).toBe(400);
      expect(await inOwner((agent) => agent.store.settings.get().agenda)).toEqual(agenda);
    } finally {
      await inOwner((agent) => agent.store.settings.update({ agenda: before }));
    }
  });

  it("the record of the day goes in the file and comes back, and a day already closed here is never changed", async () => {
    const event = (title: string) => ({ id: "ev1", calendarId: "dono@exemplo.com.br", title, start: "2026-10-30T13:00:00.000Z", end: "2026-10-30T14:00:00.000Z", allDay: false, location: "", description: "Consulta | Consultório", etag: '"ev1-1"', recurring: false, guests: 0, colorId: "", shared: false });
    const close = (day: string, title: string) =>
      inOwner((agent) => {
        const { db } = agent.store;
        db.run(`INSERT INTO zur_agenda_closed_days (day, closed_at, events) VALUES (?, ?, 1)`, day, `${day}T03:00:05.000Z`);
        db.run(`INSERT INTO zur_agenda_record (day, calendar_id, event_id, etag, data) VALUES (?, 'dono@exemplo.com.br', 'ev1', '"ev1-1"', ?)`, day, JSON.stringify(event(title)));
      });
    await close("2026-10-30", "Ana Souza");
    await inOwner((agent) => agent.store.db.run(`INSERT INTO zur_agenda_closed_days (day, closed_at, events) VALUES ('2026-10-31', '2026-11-01T03:00:05.000Z', 0)`));
    const file = JSON.parse(await exported());
    expect(file.data.agendaRecord).toEqual([
      { day: "2026-10-30", closedAt: "2026-10-30T03:00:05.000Z", events: [event("Ana Souza")] },
      { day: "2026-10-31", closedAt: "2026-11-01T03:00:05.000Z", events: [] },
    ]);
    await wipe();
    // Here 30/10 closed with another copy: it stays; 31/10 comes back from the file.
    await close("2026-10-30", "Bruno Lima");
    // SEC-E5b-03: a day of today or later in the file is no closed day: it is left out.
    await ok(session("POST", "/backup/import", { ...file, data: { ...file.data, agendaRecord: [...file.data.agendaRecord, { day: "2099-12-31", closedAt: "2026-10-30T03:00:05.000Z", events: [event("Inventado")] }] } }));
    const rows = await inOwner((agent) => ({
      days: agent.store.db.all<{ day: string; events: number }>(`SELECT day, events FROM zur_agenda_closed_days ORDER BY day`),
      titles: agent.store.db.all<{ data: string }>(`SELECT data FROM zur_agenda_record`).map((row) => (JSON.parse(row.data) as { title: string }).title),
    }));
    expect(rows).toEqual({ days: [{ day: "2026-10-30", events: 1 }, { day: "2026-10-31", events: 0 }], titles: ["Bruno Lima"] });
    // A bad day refuses the whole file.
    const bad = { ...file, data: { ...file.data, agendaRecord: [{ day: "30/10/2026", closedAt: "2026-10-30T03:00:05.000Z", events: [] }] } };
    expect((await session("POST", "/backup/import", bad)).status).toBe(400);
    // SEC-E5b-04: a copy whose time the Agenda can't read refuses the whole file too.
    for (const start of ["x", "2026-02-30", "2026-10-30T25:00:00.000Z"]) {
      const broken = { ...file, data: { ...file.data, agendaRecord: [{ day: "2026-10-29", closedAt: "2026-10-30T03:00:05.000Z", events: [{ ...event("Ana Souza"), start }] }] } };
      expect((await session("POST", "/backup/import", broken)).status, start).toBe(400);
    }
  });

  it("sets only the safe settings", async () => {
    await ok(session("POST", "/backup/import", backup({ settings: { ownerName: "Pablo", digestTime: "07:30" } })));
    const settings = await ok<{ ownerName: string; digestTime: string }>(session("GET", "/settings"));
    expect(settings).toMatchObject({ ownerName: "Pablo", digestTime: "07:30" });
  });
});

const TASK = {
  id: "0b8f8a52-5b2c-4c55-9a4c-2f1f3e1f4a10",
  title: "Tarefa",
  description: "",
  status: "todo",
  priority: "medium",
  dueAt: null,
  projectId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
};

function backup(data: Record<string, unknown>, top: Record<string, unknown> = {}) {
  return { format: BACKUP_FORMAT, version: 1, schema: LATEST_SCHEMA_VERSION, exportedAt: "2026-11-09T00:00:00.000Z", data, ...top };
}

const tableCounts = () =>
  inOwner((agent) =>
    Object.fromEntries(DATA_TABLES.map((table) => [table, agent.store.db.one<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)?.n ?? 0])),
  );

describe("a malicious backup is refused whole, writing nothing", () => {
  const reminder = { name: "Lembrete", kind: "reminder", message: "oi", schedule: { type: "daily", time: "08:00" }, sentinel: false, priority: "normal", createdAt: "2026-01-01T00:00:00.000Z" };
  const cases: [string, unknown, number, string][] = [
    ["a switched-on automation", backup({ tasks: [TASK], automations: [{ ...reminder, paused: false }] }), 400, "VALIDATION_FAILED"],
    ["an MCP server", backup({ tasks: [TASK], mcp: [{ url: "https://exemplo.com.br/mcp" }] }), 400, "VALIDATION_FAILED"],
    ["an AI setting", backup({ tasks: [TASK], settings: { aiModel: "@cf/openai/gpt-oss-120b" } }), 400, "VALIDATION_FAILED"],
    ["an unknown field on a record", backup({ tasks: [{ ...TASK, enabled: true }] }), 400, "VALIDATION_FAILED"],
    ["a control character in a title", backup({ tasks: [{ ...TASK, title: "a\u0007b" }] }), 400, "VALIDATION_FAILED"],
    ["another format", backup({ tasks: [TASK] }, { format: "talorys-backup" }), 400, "VALIDATION_FAILED"],
    ["a newer version", backup({ tasks: [TASK] }, { version: 2 }), 400, "VALIDATION_FAILED"],
  ];
  for (const [name, file, status, code] of cases) {
    it(`refuses ${name}`, async () => {
      const before = await tableCounts();
      const res = await session("POST", "/backup/import", file);
      expect(res.status).toBe(status);
      expect((await errorBody(res)).code).toBe(code);
      expect(await tableCounts()).toEqual(before);
    });
  }

  it("says a newer version is newer, and names the fields of a bad file without their values", async () => {
    const newer = await errorBody(await session("POST", "/backup/import", backup({}, { version: 2 })));
    expect(newer.message).toMatch(/versão mais nova/);
    const bad = (await (await session("POST", "/backup/import", backup({ tasks: [{ ...TASK, title: "segredo\u0007" }] }))).json()) as { details: { fields: string[] } };
    expect(bad.details.fields).toEqual(["data.tasks.0.title"]);
    expect(JSON.stringify(bad)).not.toContain("segredo");
  });

  it("refuses 10,001 memories and takes 10,000", async () => {
    const memories = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: crypto.randomUUID(),
        content: `m${i}`,
        category: "other",
        origin: "app",
        author: "owner",
        status: "active",
        supersededBy: null,
        validFrom: null,
        validUntil: null,
        localOnly: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }));
    const over = await session("POST", "/backup/import", backup({ memories: memories(10_001) }));
    expect(over.status).toBe(400);
    expect(await tableCounts()).toMatchObject({ zur_memories: 0 });
    const { summary } = await ok<{ summary: BackupImportSummary }>(session("POST", "/backup/import", backup({ memories: memories(10_000) })));
    expect(summary.memories).toBe(10_000);
  }, 60_000);

  it("refuses a file over 10 MB before the object reads it, and takes one of exactly 10 MB", async () => {
    const base = JSON.stringify(backup({ tasks: [TASK] }));
    const pad = (size: number) => `${base.slice(0, -1)}${" ".repeat(size - base.length)}}`;
    const over = await session("POST", "/backup/import", undefined, pad(BACKUP_IMPORT_MAX_BYTES + 1));
    expect(over.status).toBe(400);
    expect((await errorBody(over)).code).toBe("VALIDATION_FAILED");
    expect(await tableCounts()).toMatchObject({ zur_tasks: 0 });
    const exact = await session("POST", "/backup/import", undefined, pad(BACKUP_IMPORT_MAX_BYTES));
    expect(exact.status).toBe(200);
  });

  it("undoes everything when the existing plus the imported pass a limit", async () => {
    await inOwner((agent) => {
      agent.store.productivity.storage.limits.projects = 2;
    });
    try {
      await ok(session("POST", "/projects", { name: "Já existe" }));
      const project = { id: crypto.randomUUID(), name: "P", description: "", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
      const before = await tableCounts();
      const res = await session("POST", "/backup/import", backup({ tasks: [TASK], projects: [project, { ...project, id: crypto.randomUUID() }] }));
      expect(res.status).toBe(507);
      expect((await errorBody(res)).code).toBe("STORAGE_LIMIT_REACHED");
      expect(await tableCounts()).toEqual(before);
    } finally {
      await inOwner((agent) => {
        agent.store.productivity.storage.limits.projects = 1_000;
      });
    }
  });

  it("undoes everything when the database ceiling is passed mid-import", async () => {
    await inOwner((agent) => {
      agent.store.productivity.storage.maxBytes = agent.store.db.size() + 1;
    });
    try {
      const notes = Array.from({ length: 20 }, () => ({
        id: crypto.randomUUID(),
        title: "Grande",
        content: "x".repeat(100_000),
        projectId: null,
        localOnly: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }));
      const res = await session("POST", "/backup/import", backup({ tasks: [TASK], notes }));
      expect(res.status).toBe(507);
      expect(await tableCounts()).toMatchObject({ zur_tasks: 0, zur_notes: 0 });
    } finally {
      await inOwner((agent) => {
        agent.store.productivity.storage.maxBytes = 900 * 1024 ** 2;
      });
    }
  });

  it("refuses a body that is not JSON or not UTF-8", async () => {
    expect((await session("POST", "/backup/import", undefined, "{nope")).status).toBe(400);
    const latin = await call(`${ORIGIN}/api/backup/import`, {
      method: "POST",
      headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, cookie },
      body: new Uint8Array([0x7b, 0x22, 0xe9, 0x22, 0x7d]),
    });
    expect(latin.status).toBe(400);
  });
});

describe("routes", () => {
  it("asks for the password typed recently to export and to import, and alerts on both", async () => {
    await stale();
    expect((await errorBody(await session("GET", "/backup/export"))).code).toBe("RECENT_AUTH_REQUIRED");
    expect((await errorBody(await session("POST", "/backup/import", backup({})))).code).toBe("RECENT_AUTH_REQUIRED");
    await fresh();
    const res = await session("GET", "/backup/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="zuri-backup-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const file = await res.json();
    await ok(session("POST", "/backup/import", file));
    const events = await inOwner((agent) => agent.store.db.all<{ kind: string; alert_pending: number }>(`SELECT kind, alert_pending FROM zur_auth_events WHERE kind LIKE 'backup_%' ORDER BY id`));
    expect(events.map((e) => e.kind)).toEqual(["backup_exported", "backup_imported"]);
    // Both become a security alert on every channel.
    const alerts = await inOwner(async (agent) => {
      await agent.store.alerts.settled();
      return agent.store.db.all<{ params: string }>(`SELECT params FROM zur_notices WHERE kind = 'security'`).map((n) => JSON.parse(n.params).event);
    });
    expect(alerts).toEqual(expect.arrayContaining(["backup_exported", "backup_imported"]));
  });

  it("answers 423 during a lockdown", async () => {
    await inOwner((agent) => agent.store.auth.lockdown.mark("telegram:test"));
    for (const [method, path] of [["GET", "/backup/export"], ["POST", "/backup/import"], ["GET", "/storage"]] as const) {
      expect((await errorBody(await session(method, path, method === "POST" ? backup({}) : undefined))).code).toBe("LOCKDOWN_ACTIVE");
    }
  });

  it("shows the storage use from the counters and the database size", async () => {
    await seed();
    const use = await ok<StorageUse>(session("GET", "/storage"));
    expect(use.maxBytes).toBe(900 * 1024 ** 2);
    expect(use.bytes).toBeGreaterThan(0);
    expect(use.kinds.find((k) => k.kind === "tasks")).toEqual({ kind: "tasks", count: 2, limit: 20_000 });
    expect(use.kinds.find((k) => k.kind === "crm_clients")).toEqual({ kind: "crm_clients", count: 1, limit: 5_000 });
    expect(use.kinds.map((k) => k.kind)).toEqual(["tasks", "notes", "projects", "memories", "conversations", "messages", "automations", "crm_clients"]);
  });
});

describe("review fixes", () => {
  it("SEC-A13-01: refuses a file shaped to swell in memory before parsing it", async () => {
    const before = await tableCounts();
    const many = `{"x":[${"{},".repeat(BACKUP_CONTAINERS_MAX)}{}]}`;
    const deep = `${"[".repeat(BACKUP_DEPTH_MAX + 1)}${"]".repeat(BACKUP_DEPTH_MAX + 1)}`;
    for (const body of [many, deep]) {
      const res = await session("POST", "/backup/import", undefined, body);
      expect(res.status).toBe(400);
      expect((await errorBody(res)).message).toMatch(/não é um backup válido/);
    }
    // Brackets inside strings don't count: a note full of them still imports.
    const note = { id: crypto.randomUUID(), title: "Colchetes", content: `${"[{".repeat(50)} \\" ]`, projectId: null, localOnly: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    expect(await tableCounts()).toEqual(before);
    await ok(session("POST", "/backup/import", backup({ notes: [note] })));
  });

  it("refuses a file that repeats an id inside a section, writing nothing", async () => {
    const before = await tableCounts();
    const res = await session("POST", "/backup/import", backup({ tasks: [TASK, TASK] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { details: { fields: string[] } }).details.fields).toEqual(["data.tasks"]);
    expect(await tableCounts()).toEqual(before);
  });

  it("keeps a conversation whose assistant text has a terminal code or runs past the limit, cleaned", async () => {
    expect(portable("a\u001b[31mb\fc\n\td")).toBe("a[31mbc\n\td");
    expect(portable("x".repeat(64_001))).toHaveLength(64_000);
    expect(portable(`${"x".repeat(63_999)}\u{1F600}`)).toBe(`${"x".repeat(63_999)}\uFFFD`);
    await inOwner((agent) => {
      const { db } = agent.store;
      const id = crypto.randomUUID();
      db.run(`INSERT INTO zur_conversations (id, title, created_at, updated_at) VALUES (?, 'Cores', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')`, id);
      db.run(`INSERT INTO zur_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, '2026-11-01T10:00:05.000Z')`, crypto.randomUUID(), id, "verde\u001b[0m");
    });
    const file = JSON.parse(await exported()) as { data: { conversations: { title: string; messages: { content: string }[] }[] } };
    expect(file.data.conversations).toEqual([expect.objectContaining({ title: "Cores", messages: [expect.objectContaining({ content: "verde[0m" })] })]);
  });

  it("undoes everything when the CRM's distinct tags pass 200", async () => {
    const stage = { id: crypto.randomUUID(), name: "Contato" };
    const client = (i: number) => ({
      ref: null,
      name: `Cliente ${i}`,
      phone: null,
      email: null,
      birthday: null,
      stageId: stage.id,
      notes: "",
      followUpAt: null,
      followUpNote: "",
      source: "app",
      lastActivityAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      tags: Array.from({ length: 20 }, (_, t) => `t${i}x${t}`),
      history: [],
    });
    const before = await tableCounts();
    const res = await session("POST", "/backup/import", backup({ tasks: [TASK], crm: { stages: [stage], clients: Array.from({ length: 11 }, (_, i) => client(i)), settings: null } }));
    expect(res.status).toBe(507);
    expect((await errorBody(res)).code).toBe("STORAGE_LIMIT_REACHED");
    expect(await tableCounts()).toEqual(before);
  });

  it("applies an imported time zone", async () => {
    const zone = await inOwner((agent) => agent.store.settings.get().timeZone);
    try {
      const { summary } = await ok<{ summary: BackupImportSummary }>(session("POST", "/backup/import", backup({ settings: { timeZone: "Europe/Lisbon" } })));
      expect(summary.settings).toBe(1);
      expect(await inOwner((agent) => agent.store.settings.get().timeZone)).toBe("Europe/Lisbon");
    } finally {
      await inOwner((agent) => agent.store.settings.update({ timeZone: zone }));
    }
  });
});
