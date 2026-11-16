import {
  BACKUP_ERROR_FIELDS_MAX,
  BACKUP_VERSION,
  type Backup,
  type BackupImportSummary,
  backupSchema,
  CRM_LIMITS,
  FAMILY_LIMITS,
  FAMILY_RESPONSIBLE_ROLES,
  STORAGE_LIMITS,
  type StorageKind,
} from "@zuri/shared";
import type { CrmService } from "../crm/service.ts";
import { familyCount, familyTotal, hasResponsible } from "../google/family.ts";
import type { Database } from "../db/database.ts";
import { AppError } from "../http/errors.ts";
import { cleanImportedLinks } from "../memory/lifecycle.ts";
import { dedupeKey } from "../memory/text.ts";
import type { StorageGuard } from "../productivity/storage.ts";

export interface ImportDeps {
  db: Database;
  storage: StorageGuard;
  crm: CrmService;
  /** The owner's settings, changed after the data is in (its own transaction). */
  applySettings(patch: Backup["data"]["settings"]): number;
  /** Today in the owner's zone: a day of the record from today on is not a closed day, and is left out. */
  today: () => string;
}

/**
 * The most objects and arrays a valid file can hold: one per record, a few per
 * conversation, automation and CRM client (tags, history), and room for the rest.
 */
export const BACKUP_CONTAINERS_MAX =
  2 * (STORAGE_LIMITS.projects + STORAGE_LIMITS.tasks + STORAGE_LIMITS.notes + STORAGE_LIMITS.memories + STORAGE_LIMITS.conversations) +
  STORAGE_LIMITS.messages +
  4 * STORAGE_LIMITS.automations +
  CRM_LIMITS.clients * (3 + CRM_LIMITS.historyPerClient) +
  2_000;
/** The deepest a valid file nests (a CRM client's history entry is at 7), with room. */
export const BACKUP_DEPTH_MAX = 10;

/**
 * Parses the file's text only when its shape could be a backup. JSON.parse on
 * 10 MB of `[{},{},…]` makes millions of objects, more than the object's 128 MB
 * holds, before the schema's limits could refuse it (SEC-A13-01). One pass
 * counts objects, arrays and nesting outside strings, without building anything.
 */
export function parseBackupText(text: string): unknown {
  let containers = 0;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++;
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      if (++containers > BACKUP_CONTAINERS_MAX || ++depth > BACKUP_DEPTH_MAX) throw invalid();
    } else if (c === 0x7d || c === 0x5d) depth--;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw invalid();
  }
}

function invalid(): AppError {
  return new AppError("VALIDATION_FAILED", "error.backup.invalid", { fields: ["_body"] });
}

/**
 * Checks a backup file without writing anything: the whole file must pass the
 * strict schema, or nothing is imported. Names at most 20 field paths, never a value.
 */
export function parseBackup(raw: unknown): Backup {
  // A newer format is refused by name, before its fields are judged by this version's schema.
  if (raw && typeof raw === "object" && "version" in raw && typeof raw.version === "number" && raw.version > BACKUP_VERSION) {
    throw new AppError("VALIDATION_FAILED", "error.backup.newer", { fields: ["version"] });
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "_body"))].slice(0, BACKUP_ERROR_FIELDS_MAX);
    throw new AppError("VALIDATION_FAILED", "error.backup.invalid", { fields });
  }
  return parsed.data;
}

/**
 * Imports a backup (step 23) in one transaction: every record gets a new id,
 * next to what is already here (the contract: "mescla com ids novos"), links
 * inside the file follow the new ids, and a link to something missing from
 * the file is dropped. Passing a limit per kind, the CRM's limits or the
 * database ceiling undoes everything (spec rule 8).
 *
 * A backup is untrusted input: automations arrive paused, AI routines wait for
 * the owner's approval (as if the chat proposed them), memories come marked as
 * imported, and messages are 'import' (never retried as the owner's words,
 * without tools or proposals). Settings are only the listed safe ones.
 */
export function importBackup(deps: ImportDeps, backup: Backup): BackupImportSummary {
  const { db, storage } = deps;
  const d = backup.data;
  const messages = d.conversations.reduce((sum, c) => sum + c.messages.length, 0);
  const incoming: Record<StorageKind, number> = {
    projects: d.projects.length,
    tasks: d.tasks.length,
    notes: d.notes.length,
    memories: d.memories.length,
    conversations: d.conversations.length,
    messages,
    automations: d.automations.length,
  };
  // Before writing: a file that can't fit is refused by the same check as one more record of that kind.
  for (const kind of Object.keys(incoming) as StorageKind[]) {
    if (incoming[kind] > 0) storage.assertRoom(kind, incoming[kind]);
  }
  // The CRM's default stages exist before the transaction (made in the owner's language on first use).
  if (d.crm) deps.crm.stages();

  const summary = db.transaction((): BackupImportSummary => {
    const projects = new Map<string, string>();
    for (const p of d.projects) {
      const id = crypto.randomUUID();
      projects.set(p.id, id);
      db.run(`INSERT INTO zur_projects (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, id, p.name, p.description, p.status, p.createdAt, p.updatedAt);
    }
    const project = (old: string | null) => (old === null ? null : (projects.get(old) ?? null));
    for (const t of d.tasks) {
      db.run(
        `INSERT INTO zur_tasks (id, title, description, status, priority, due_at, project_id, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        t.title,
        t.description,
        t.status,
        t.priority,
        t.dueAt,
        project(t.projectId),
        t.createdAt,
        t.updatedAt,
        t.status === "done" ? (t.completedAt ?? t.updatedAt) : null,
      );
    }
    for (const n of d.notes) {
      db.run(
        `INSERT INTO zur_notes (id, title, content, project_id, local_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        n.title,
        n.content,
        project(n.projectId),
        n.localOnly ? 1 : 0,
        n.createdAt,
        n.updatedAt,
      );
    }

    // Memories first without links, then the links that survive (no loop, no missing target), through the new ids.
    const memories = new Map(d.memories.map((m) => [m.id, crypto.randomUUID()]));
    const links = cleanImportedLinks(d.memories);
    for (const m of d.memories) {
      db.run(
        `INSERT INTO zur_memories (id, content, category, origin, author, status, superseded_by, valid_from, valid_until, dedupe_key, local_only, created_at, updated_at)
         VALUES (?, ?, ?, 'import', ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        memories.get(m.id) as string,
        m.content,
        m.category,
        m.author,
        m.status,
        m.validFrom,
        m.validUntil,
        dedupeKey(m.content),
        m.localOnly ? 1 : 0,
        m.createdAt,
        m.updatedAt,
      );
    }
    for (const m of d.memories) {
      const target = links.get(m.id);
      if (target) db.run(`UPDATE zur_memories SET superseded_by = ? WHERE id = ?`, memories.get(target) as string, memories.get(m.id) as string);
    }

    for (const c of d.conversations) {
      const id = crypto.randomUUID();
      db.run(`INSERT INTO zur_conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`, id, c.title, c.createdAt, c.updatedAt);
      for (const m of c.messages) {
        db.run(
          `INSERT INTO zur_messages (id, conversation_id, role, content, tools, status, source, fallback, created_at) VALUES (?, ?, ?, ?, '[]', ?, 'import', ?, ?)`,
          crypto.randomUUID(),
          id,
          m.role,
          m.content,
          m.status,
          m.fallback ? 1 : 0,
          m.createdAt,
        );
      }
    }

    let routines = 0;
    for (const a of d.automations) {
      // An AI routine from a file is like one the chat proposed: nothing runs until the owner reads and approves it.
      const pending = a.kind === "agent_prompt";
      if (pending) routines++;
      db.run(
        `INSERT INTO zur_automations (id, name, kind, message, schedule, status, sentinel, priority, origin, next_run, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'app', NULL, ?, ?)`,
        crypto.randomUUID(),
        a.name,
        a.kind,
        a.message,
        JSON.stringify(a.schedule),
        pending ? "pending_approval" : "paused",
        a.sentinel && a.kind === "agent_prompt" ? 1 : 0,
        a.priority,
        a.createdAt,
        new Date().toISOString(),
      );
    }

    // What was learned here wins: a backup only fills sources this installation hasn't learned.
    for (const l of d.alertLearning) {
      db.run(`INSERT INTO zur_alert_learning (key, shift, label, changed_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO NOTHING`, l.key, l.shift, l.label, l.changedAt);
    }

    // The record of the day: a day already closed here stays as it is; only days missing here come back.
    const today = deps.today();
    for (const closed of d.agendaRecord) {
      if (closed.day >= today) continue;
      const added = db.run(`INSERT OR IGNORE INTO zur_agenda_closed_days (day, closed_at, events) VALUES (?, ?, ?)`, closed.day, closed.closedAt, closed.events.length);
      if (added.rowsWritten === 0) continue;
      for (const event of closed.events) {
        db.run(`INSERT OR IGNORE INTO zur_agenda_record (day, calendar_id, event_id, etag, data) VALUES (?, ?, ?, ?, ?)`, closed.day, event.calendarId, event.id, event.etag, JSON.stringify(event));
      }
    }

    let clients = { clients: 0, skipped: 0 };
    if (d.crm) {
      clients = deps.crm.restore(d.crm);
      if (d.crm.settings) {
        // `birthdays` and `birthdayTime` of a backup of before 16/11/2026 are read and left: no birthday notice since then.
        db.run(`UPDATE zur_crm_settings SET follow_ups = ?, new_clients = ? WHERE id = 1`, d.crm.settings.followUps ? 1 : 0, d.crm.settings.newClients ? 1 : 0);
      }
    }

    // The family links (E11b): a pair already linked here stays as it is, and the ceilings hold as in the card.
    // The counts are read once and kept here: a count per row would read the table N times (SEC-A11-01).
    let total = familyTotal(db);
    const counts = new Map<string, number>();
    const count = (who: string) => {
      let n = counts.get(who);
      if (n === undefined) {
        n = familyCount(db, who);
        counts.set(who, n);
      }
      return n;
    };
    // E11c (SEC-A9-02): the responsible comes back as it went, one a person and only a grown-up role, as in the card.
    const served = new Map<string, boolean>();
    const hasOne = (who: string) => {
      let found = served.get(who);
      if (found === undefined) {
        found = hasResponsible(db, who);
        served.set(who, found);
      }
      return found;
    };
    for (const link of d.contactFamily) {
      if (total >= FAMILY_LIMITS.total) break;
      const [a, b, roleA, roleB, kept] = link.a < link.b ? [link.a, link.b, link.roleA, link.roleB, link.responsible] : [link.b, link.a, link.roleB, link.roleA, link.responsible === 0 ? 0 : 3 - link.responsible];
      if (count(a) >= FAMILY_LIMITS.perContact || count(b) >= FAMILY_LIMITS.perContact) continue;
      // 1: a receives for b. The one who receives has to be a grown-up role, and the other has no responsible yet.
      const patient = kept === 1 ? b : a;
      const responsible = kept !== 0 && FAMILY_RESPONSIBLE_ROLES.includes(kept === 1 ? roleA : roleB) && !hasOne(patient) ? kept : 0;
      const added = db.run(
        `INSERT OR IGNORE INTO zur_contact_family (id, a, b, role_a, role_b, responsible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        a,
        b,
        roleA,
        roleB,
        responsible,
        Date.now(),
      );
      if (added.rowsWritten === 0) continue;
      if (responsible) served.set(patient, true);
      total++;
      counts.set(a, count(a) + 1);
      counts.set(b, count(b) + 1);
    }

    // Inside the transaction: a file that takes the database past its ceiling imports nothing.
    storage.assertBytes();
    return {
      projects: d.projects.length,
      tasks: d.tasks.length,
      notes: d.notes.length,
      memories: d.memories.length,
      conversations: d.conversations.length,
      messages,
      automations: d.automations.length,
      routinesToApprove: routines,
      clients: clients.clients,
      clientsSkipped: clients.skipped,
      settings: 0,
    };
  });
  // The data is in; the settings are already validated, so this can't refuse.
  summary.settings = Object.keys(d.settings).length > 0 ? deps.applySettings(d.settings) : 0;
  return summary;
}
