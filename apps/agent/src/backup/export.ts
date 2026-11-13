import { BACKUP_FORMAT, BACKUP_MESSAGE_MAX, BACKUP_SETTINGS, BACKUP_VERSION, backupItemSchemas, type Settings } from "@zuri/shared";
import type { z } from "zod";
import type { Database, SqlValue } from "../db/database.ts";
import { LATEST_SCHEMA_VERSION } from "../db/migrations.ts";
import { log } from "../log.ts";

/** Rows read per query: one page in memory at a time, whatever the size of the database. */
const PAGE = 500;

export interface ExportDeps {
  db: Database;
  settings(): Settings;
  /** The export's clock, replaceable in tests. */
  now?(): Date;
}

/**
 * A stored message as the import takes it. The assistant's text is stored as
 * the model wrote it, and may carry a terminal code or run past the limit; one
 * such message must not leave its whole conversation out of the file.
 */
export function portable(content: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point.
  const clean = content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  return (clean.length > BACKUP_MESSAGE_MAX ? clean.slice(0, BACKUP_MESSAGE_MAX) : clean).toWellFormed();
}

/**
 * The backup as JSON text, piece by piece (step 23): each table is read in
 * pages by rowid, so a big database never sits in memory whole. Every record
 * goes through the same schema the import uses, so a file this writes can
 * always be read back; a stored row that no longer passes (written by an
 * older version, say) is left out and counted in the log, never the file.
 *
 * Only the columns named here go out: the list is positive, so a secret
 * column added later never leaks by default.
 */
export function* exportBackup(deps: ExportDeps): Generator<string> {
  const { db } = deps;
  const skipped: Record<string, number> = {};
  const all = deps.settings();
  const settings = Object.fromEntries(BACKUP_SETTINGS.map((key) => [key, all[key]]));
  yield `{"format":${JSON.stringify(BACKUP_FORMAT)},"version":${BACKUP_VERSION},"schema":${LATEST_SCHEMA_VERSION},"exportedAt":${JSON.stringify((deps.now?.() ?? new Date()).toISOString())},"data":{`;
  yield `"settings":${JSON.stringify(settings)}`;

  const section = function* <T extends z.ZodType>(name: string, schema: T, rows: Iterable<unknown>): Generator<string> {
    yield `,${JSON.stringify(name)}:[`;
    let first = true;
    for (const row of rows) {
      const parsed = schema.safeParse(row);
      if (!parsed.success) {
        skipped[name] = (skipped[name] ?? 0) + 1;
        continue;
      }
      yield (first ? "" : ",") + JSON.stringify(parsed.data);
      first = false;
    }
    yield "]";
  };

  yield* section(
    "projects",
    backupItemSchemas.project,
    pages(db, `SELECT rowid AS _r, id, name, description, status, created_at, updated_at FROM zur_projects`, (r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  );
  yield* section(
    "tasks",
    backupItemSchemas.task,
    pages(db, `SELECT rowid AS _r, id, title, description, status, priority, due_at, project_id, created_at, updated_at, completed_at FROM zur_tasks`, (r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      dueAt: r.due_at,
      projectId: r.project_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at,
    })),
  );
  yield* section(
    "notes",
    backupItemSchemas.note,
    pages(db, `SELECT rowid AS _r, id, title, content, project_id, local_only, created_at, updated_at FROM zur_notes`, (r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      projectId: r.project_id,
      localOnly: r.local_only === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  );
  yield* section(
    "memories",
    backupItemSchemas.memory,
    pages(
      db,
      `SELECT rowid AS _r, id, content, category, origin, author, status, superseded_by, valid_from, valid_until, local_only, created_at, updated_at FROM zur_memories`,
      (r) => ({
        id: r.id,
        content: r.content,
        category: r.category,
        origin: r.origin,
        author: r.author,
        status: r.status,
        supersededBy: r.superseded_by,
        validFrom: r.valid_from,
        validUntil: r.valid_until,
        localOnly: r.local_only === 1,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }),
    ),
  );
  // Without the summary (model text the owner never saw), the tools (proposals of this installation) and quotes.
  yield* section(
    "conversations",
    backupItemSchemas.conversation,
    pages(db, `SELECT rowid AS _r, id, title, created_at, updated_at FROM zur_conversations`, (r) => ({
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messages: db
        .all<{ role: string; content: string; status: string; fallback: number; created_at: string }>(
          `SELECT role, content, status, fallback, created_at FROM zur_messages WHERE conversation_id = ? ORDER BY seq`,
          r.id as string,
        )
        .map((m) => ({ role: m.role, content: portable(m.content), status: m.status, fallback: m.fallback === 1, createdAt: m.created_at })),
    })),
  );
  yield* section(
    "automations",
    backupItemSchemas.automation,
    pages(db, `SELECT rowid AS _r, name, kind, message, schedule, sentinel, priority, created_at FROM zur_automations`, (r) => ({
      name: r.name,
      kind: r.kind,
      message: r.message,
      schedule: json(r.schedule ?? null),
      sentinel: r.sentinel === 1,
      priority: r.priority,
      paused: true,
      createdAt: r.created_at,
    })),
  );
  yield* section(
    "alertLearning",
    backupItemSchemas.alertLearning,
    pages(db, `SELECT rowid AS _r, key, shift, label, changed_at FROM zur_alert_learning`, (r) => ({ key: r.key, shift: r.shift, label: r.label, changedAt: r.changed_at })),
  );

  // The CRM: the funnel in order, every client with its tags and history, and the notices' switches (never the events key).
  const stages = db.all<{ id: string; name: string }>(`SELECT id, name FROM zur_crm_stages ORDER BY position`);
  const crmSettings = db.one<{ follow_ups: number; birthdays: number; new_clients: number; reminder_time: string }>(
    `SELECT follow_ups, birthdays, new_clients, reminder_time FROM zur_crm_settings WHERE id = 1`,
  );
  yield `,"crm":{"stages":${JSON.stringify(stages.filter((stage) => backupItemSchemas.crmStage.safeParse(stage).success))}`;
  yield* section(
    "clients",
    backupItemSchemas.crmClient,
    pages(
      db,
      `SELECT rowid AS _r, id, ref, name, phone, email, birthday, stage_id, notes, follow_up_at, follow_up_note, source, last_activity_at, created_at, updated_at FROM zur_crm_clients`,
      (r) => ({
        ref: r.ref,
        name: r.name,
        phone: r.phone,
        email: r.email,
        birthday: r.birthday,
        stageId: r.stage_id,
        notes: r.notes,
        followUpAt: r.follow_up_at,
        followUpNote: r.follow_up_note,
        source: r.source,
        lastActivityAt: r.last_activity_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        tags: db.all<{ tag: string }>(`SELECT tag FROM zur_crm_tags WHERE client_id = ? ORDER BY tag`, r.id as string).map((t) => t.tag),
        history: db.all<{ kind: string; text: string; at: string }>(`SELECT kind, text, at FROM zur_crm_history WHERE client_id = ? ORDER BY at, id`, r.id as string),
      }),
    ),
  );
  yield `,"settings":${JSON.stringify(
    crmSettings
      ? {
          followUps: crmSettings.follow_ups === 1,
          birthdays: crmSettings.birthdays === 1,
          newClients: crmSettings.new_clients === 1,
          // A time a clock can't show is left out: the import refuses the whole file on one bad field.
          ...(/^([01]\d|2[0-3]):[0-5]\d$/.test(crmSettings.reminder_time) ? { birthdayTime: crmSettings.reminder_time } : {}),
        }
      : null,
  )}}`;
  // The record of the day (13/11/2026): every closed day with the events copied at 0:00, oldest first.
  yield* section("agendaRecord", backupItemSchemas.agendaDay, recordDays(db));
  yield "}}";
  for (const [kind, count] of Object.entries(skipped)) log("warn", "backup_export_skipped", { kind, count });
}

/** The closed days of the Agenda's record, PAGE at a time by day (the tables have no rowid), each with its events. */
function* recordDays(db: Database): Generator<unknown> {
  let after = "";
  for (;;) {
    const days = db.all<{ day: string; closed_at: string }>(`SELECT day, closed_at FROM zur_agenda_closed_days WHERE day > ? ORDER BY day LIMIT ${PAGE}`, after);
    for (const { day, closed_at } of days) {
      const events = db.all<{ data: string }>(`SELECT data FROM zur_agenda_record WHERE day = ? ORDER BY calendar_id, event_id`, day).map((row) => json(row.data));
      yield { day, closedAt: closed_at, events };
    }
    if (days.length < PAGE) return;
    after = days.at(-1)?.day ?? after;
  }
}

/** Every row of `select` (which names `rowid AS _r`), PAGE at a time in rowid order, mapped. */
function* pages(db: Database, select: string, map: (row: Record<string, SqlValue>) => unknown): Generator<unknown> {
  let after = 0;
  for (;;) {
    const rows = db.all<Record<string, SqlValue>>(`${select} WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`, after);
    for (const row of rows) yield map(row);
    if (rows.length < PAGE) return;
    after = rows.at(-1)?._r as number;
  }
}

function json(value: SqlValue): unknown {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/** The export as a byte stream for a Response: one piece per pull, so the reader sets the pace. */
export function exportStream(deps: ExportDeps): ReadableStream<Uint8Array> {
  const pieces = exportBackup(deps);
  const encoder = new TextEncoder();
  return new ReadableStream({
    pull(controller) {
      // Several small pieces per pull: one per row would make a pull per message.
      let chunk = "";
      while (chunk.length < 64 * 1024) {
        const next = pieces.next();
        if (next.done) {
          if (chunk) controller.enqueue(encoder.encode(chunk));
          controller.close();
          return;
        }
        chunk += next.value;
      }
      controller.enqueue(encoder.encode(chunk));
    },
    cancel() {
      pieces.return(undefined);
    },
  });
}
