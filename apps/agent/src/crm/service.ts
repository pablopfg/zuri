import {
  birthdayMonthDay,
  CRM_BIRTHDAY_TIME,
  CRM_LIMITS,
  type CrmClientDetail,
  type CrmClientPage,
  type CrmClientSummary,
  type CrmFollowUpFilter,
  type CrmHistoryEntry,
  type CrmHistoryKind,
  type CrmSettings,
  type CrmStage,
  type CrmSummary,
  type Locale,
  localDayBounds,
  nextRun,
  phoneDigits,
  t,
  zonedParts,
} from "@zuri/shared";
import { recordActivity } from "../db/activity.ts";
import { now as isoNow, type Database, type SqlValue } from "../db/database.ts";
import { dayKeys, searchText } from "../google/contacts.ts";
import { cleanText } from "../google/events.ts";
import { AppError } from "../http/errors.ts";

/**
 * The internal CRM (step 22b): the owner's clients, the funnel's stages, the
 * history and the follow-ups, in Zuri's own database. The screen, the chat
 * (add_client, update_client) and n8n's signed events all write through
 * here, so the limits and the history hold whoever writes. Clients' data may
 * be sensitive: nothing here logs a name, a phone, an e-mail or a text.
 */

export type CrmNotice =
  | { kind: "crm.followUp"; clientId: string; name: string; note: string }
  | { kind: "crm.followUps"; count: number }
  | { kind: "crm.birthdays"; names: string; more: number; day: string }
  | { kind: "crm.newClient"; clientId: string; name: string };

export interface CrmDeps {
  db: Database;
  timeZone: () => string;
  locale: () => Locale;
  notify: (notice: CrmNotice) => void;
  clock?: () => number;
  /** The database's byte ceiling, as notes and tasks use it: throws STORAGE_LIMIT_REACHED when full. */
  assertBytes?: () => void;
}

/** Who made a change: the history says it the same way, but a client from n8n is marked so. */
export type CrmWriter = "app" | "chat" | "n8n";

export interface ClientInput {
  name: string;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  birthday?: string | null | undefined;
  stageId?: string | undefined;
  tags?: string[] | undefined;
  notes?: string | undefined;
  followUp?: { at: string; note: string } | null | undefined;
}

export type ClientPatch = Partial<Omit<ClientInput, "name">> & {
  name?: string | undefined;
  tagsAdd?: string[] | undefined;
  tagsRemove?: string[] | undefined;
};

interface ClientRow {
  id: string;
  ref: string | null;
  name: string;
  search_name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  stage_id: string;
  notes: string;
  follow_up_at: string | null;
  follow_up_note: string;
  source: "app" | "n8n";
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SettingsRow {
  events_key: string | null;
  last_event_at: string | null;
  follow_ups: number;
  birthdays: number;
  new_clients: number;
  next_reminder: number | null;
  reminder_time: string;
  new_client_notices: number;
  events_per_hour: number;
  events_per_day: number;
  /** The owner's day ("2026-11-11") of the last birthday notice's turn: a time changed later the same day doesn't tell it twice. */
  reminded_day: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The stored time, or 9 h when the row holds something a clock can't show. */
function reminderTime(row: SettingsRow): string {
  return HHMM.test(row.reminder_time) ? row.reminder_time : CRM_BIRTHDAY_TIME;
}

/** Events n8n may send per UTC hour and day, inside the ceilings whatever the row holds; the hour's never passes the day's. */
export function eventLimits(row: Pick<SettingsRow, "events_per_hour" | "events_per_day">): { eventsPerHour: number; eventsPerDay: number } {
  const within = (value: number, min: number, max: number) => (Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : max);
  const eventsPerDay = within(row.events_per_day, CRM_LIMITS.eventsPerDayMin, CRM_LIMITS.eventsPerDay);
  return { eventsPerHour: Math.min(eventsPerDay, within(row.events_per_hour, CRM_LIMITS.eventsPerHourMin, CRM_LIMITS.eventsPerHour)), eventsPerDay };
}

/** The stored number inside its limits, whatever the row holds. */
function noticesPerDay(row: SettingsRow): number {
  const n = Number.isInteger(row.new_client_notices) ? row.new_client_notices : CRM_LIMITS.newClientNoticesPerDay;
  return Math.min(CRM_LIMITS.newClientNoticesPerDay, Math.max(CRM_LIMITS.newClientNoticesMin, n));
}

const COLUMNS = "id, ref, name, search_name, phone, email, birthday, stage_id, notes, follow_up_at, follow_up_note, source, last_activity_at, created_at, updated_at";
const DEFAULT_STAGES = ["crm.stage.new", "crm.stage.talking", "crm.stage.scheduled", "crm.stage.client", "crm.stage.inactive"] as const;
const DAY_MS = 86_400_000;

export class CrmService {
  private readonly clock: () => number;
  /** The stages exist (made once, in the owner's language, on first use). */
  private ready = false;

  constructor(private readonly deps: CrmDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  private get db(): Database {
    return this.deps.db;
  }

  private depth = 0;

  /** Runs `fn` in one transaction; inside another (an event applied whole), it joins that one. */
  atomic<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    try {
      return this.db.transaction(fn);
    } finally {
      this.depth--;
    }
  }

  private nowIso(): string {
    return this.deps.clock ? new Date(this.clock()).toISOString() : isoNow();
  }

  /** The funnel's default stages, in the owner's language, the first time the CRM is used. */
  private ensure(): void {
    if (this.ready) return;
    const any = this.db.one(`SELECT 1 AS found FROM zur_crm_stages LIMIT 1`);
    if (!any) {
      const locale = this.deps.locale();
      this.atomic(() => {
        DEFAULT_STAGES.forEach((key, position) => {
          this.db.run(`INSERT INTO zur_crm_stages (id, name, position) VALUES (?, ?, ?)`, crypto.randomUUID(), t(locale, key), position);
        });
      });
    }
    this.ready = true;
  }

  // ---------- The funnel ----------

  stages(): CrmStage[] {
    this.ensure();
    return this.db
      .all<{ id: string; name: string; clients: number }>(`SELECT id, name, clients FROM zur_crm_stages ORDER BY position, id`)
      .map((row) => ({ id: row.id, name: row.name, count: row.clients }));
  }

  private firstStage(): string {
    this.ensure();
    const row = this.db.one<{ id: string }>(`SELECT id FROM zur_crm_stages ORDER BY position, id LIMIT 1`);
    if (!row) throw new AppError("INTERNAL_ERROR");
    return row.id;
  }

  private stageName(id: string): string {
    return this.db.one<{ name: string }>(`SELECT name FROM zur_crm_stages WHERE id = ?`, id)?.name ?? "";
  }

  /** A stage by its name, any case and accents; null when none matches. */
  stageByName(name: string): string | null {
    const wanted = searchText(name);
    return this.stages().find((stage) => searchText(stage.name) === wanted)?.id ?? null;
  }

  /**
   * The whole funnel, in order. A stage with an id keeps its clients (renamed
   * or moved); one left out goes, and its clients move to the first stage.
   */
  setStages(input: { id?: string | undefined; name: string }[]): CrmStage[] {
    this.ensure();
    const known = new Set(this.db.all<{ id: string }>(`SELECT id FROM zur_crm_stages`).map((row) => row.id));
    for (const stage of input) {
      if (stage.id && !known.has(stage.id)) throw new AppError("NOT_FOUND", "error.crmStageNotFound");
    }
    this.atomic(() => {
      const kept = input.map((stage, position) => {
        const id = stage.id ?? crypto.randomUUID();
        this.db.run(
          `INSERT INTO zur_crm_stages (id, name, position) VALUES (?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, position = excluded.position`,
          id,
          stage.name,
          position,
        );
        return id;
      });
      const first = kept[0] as string;
      const gone = [...known].filter((id) => !kept.includes(id));
      for (const id of gone) {
        this.db.run(`UPDATE zur_crm_clients SET stage_id = ?, updated_at = ? WHERE stage_id = ?`, first, this.nowIso(), id);
        this.db.run(`DELETE FROM zur_crm_stages WHERE id = ?`, id);
      }
    });
    return this.stages();
  }

  // ---------- Clients ----------

  /** Clients kept now (one row, kept by triggers). */
  count(): number {
    return this.db.one<{ n: number }>(`SELECT n FROM zur_counts WHERE kind = 'crm_clients'`)?.n ?? 0;
  }

  private row(id: string): ClientRow | null {
    return this.db.one<ClientRow>(`SELECT ${COLUMNS} FROM zur_crm_clients WHERE id = ?`, id);
  }

  /** A client by n8n's id for it. */
  byRef(ref: string): ClientRow | null {
    return this.db.one<ClientRow>(`SELECT ${COLUMNS} FROM zur_crm_clients WHERE ref = ?`, ref);
  }

  private tagsOf(id: string): string[] {
    return this.db.all<{ tag: string }>(`SELECT tag FROM zur_crm_tags WHERE client_id = ? ORDER BY tag`, id).map((row) => row.tag);
  }

  private summaryOf(row: ClientRow): CrmClientSummary {
    return {
      id: row.id,
      name: row.name,
      stageId: row.stage_id,
      tags: this.tagsOf(row.id),
      phone: row.phone,
      email: row.email,
      followUp: row.follow_up_at ? { at: row.follow_up_at, note: row.follow_up_note } : null,
      source: row.source,
      lastActivityAt: row.last_activity_at,
      updatedAt: row.updated_at,
    };
  }

  get(id: string, historyLimit: number = CRM_LIMITS.historyPerClient): CrmClientDetail | null {
    const row = this.row(id);
    if (!row) return null;
    const history = this.db.all<CrmHistoryEntry>(`SELECT id, kind, text, at FROM zur_crm_history WHERE client_id = ? ORDER BY at DESC, id DESC LIMIT ?`, id, historyLimit);
    return { ...this.summaryOf(row), ref: row.ref, birthday: row.birthday, notes: row.notes, history, createdAt: row.created_at };
  }

  /** Tags in use, by name (at most the 200 distinct ones allowed). */
  tags(): string[] {
    return this.db.all<{ tag: string }>(`SELECT tag FROM zur_crm_tag_counts WHERE n > 0 ORDER BY tag LIMIT ?`, CRM_LIMITS.distinctTags).map((row) => row.tag);
  }

  /** New tags must keep the distinct ones within 200. */
  private checkTags(tags: string[]): void {
    if (tags.length === 0) return;
    const fresh = tags.filter((tag) => !this.db.one(`SELECT 1 AS found FROM zur_crm_tag_counts WHERE tag = ? AND n > 0`, tag));
    if (fresh.length === 0) return;
    // Tags nobody carries any more are cleared here, so the table stays near 200 rows.
    this.db.run(`DELETE FROM zur_crm_tag_counts WHERE n <= 0`);
    const distinct = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_crm_tag_counts`)?.n ?? 0;
    if (distinct + fresh.length > CRM_LIMITS.distinctTags) throw new AppError("STORAGE_LIMIT_REACHED", "error.crmTagLimit");
  }

  /** Adds a client. `ref` only from n8n's events. */
  create(input: ClientInput, writer: CrmWriter, ref: string | null = null): CrmClientDetail {
    this.ensure();
    if (this.count() >= CRM_LIMITS.clients) throw new AppError("STORAGE_LIMIT_REACHED", "error.crmClientLimit");
    this.deps.assertBytes?.();
    const stageId = input.stageId ?? this.firstStage();
    if (!this.db.one(`SELECT 1 AS found FROM zur_crm_stages WHERE id = ?`, stageId)) throw new AppError("NOT_FOUND", "error.crmStageNotFound");
    const tags = [...new Set(input.tags ?? [])].slice(0, CRM_LIMITS.tagsPerClient);
    this.checkTags(tags);
    const id = crypto.randomUUID();
    const at = this.nowIso();
    this.atomic(() => {
      this.db.run(
        `INSERT INTO zur_crm_clients (id, ref, name, search_name, phone, phone_digits, email, birthday, birthday_md, stage_id, notes, follow_up_at, follow_up_note, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        ref,
        input.name,
        searchText(input.name),
        input.phone ?? null,
        phoneDigits(input.phone),
        input.email ?? null,
        input.birthday ?? null,
        birthdayMonthDay(input.birthday),
        stageId,
        input.notes ?? "",
        input.followUp?.at ?? null,
        input.followUp?.note ?? "",
        writer === "n8n" ? "n8n" : "app",
        at,
        at,
      );
      for (const tag of tags) this.db.run(`INSERT INTO zur_crm_tags (client_id, tag) VALUES (?, ?)`, id, tag);
      this.history(id, "created", "", at);
    });
    return this.get(id) as CrmClientDetail;
  }

  /**
   * The CRM part of a backup (step 23), inside the import's transaction (the
   * caller holds it, so nothing here opens one). Stages match the current
   * ones by name; a new name becomes a stage while there is room (12), and a
   * client of a stage with no room goes to the first stage. A client whose n8n
   * `ref` is already here is that client: it is skipped, never duplicated.
   * Throws STORAGE_LIMIT_REACHED past 5,000 clients or 200 distinct tags.
   */
  restore(data: {
    stages: { id: string; name: string }[];
    clients: (Omit<ClientInput, "followUp" | "stageId" | "tags"> & {
      ref: string | null;
      stageId: string;
      tags: string[];
      followUpAt: string | null;
      followUpNote: string;
      source: "app" | "n8n";
      lastActivityAt: string | null;
      createdAt: string;
      updatedAt: string;
      history: { kind: CrmHistoryKind; text: string; at: string }[];
    })[];
  }): { clients: number; skipped: number } {
    const current = this.db.all<{ id: string; name: string }>(`SELECT id, name FROM zur_crm_stages ORDER BY position, id`);
    if (current.length === 0) throw new AppError("INTERNAL_ERROR");
    const byName = new Map(current.map((stage) => [searchText(stage.name), stage.id]));
    let position = current.length;
    const stageOf = new Map<string, string>();
    for (const stage of data.stages) {
      const key = searchText(stage.name);
      let local = byName.get(key);
      if (!local && position < CRM_LIMITS.stagesMax) {
        local = crypto.randomUUID();
        this.db.run(`INSERT INTO zur_crm_stages (id, name, position) VALUES (?, ?, ?)`, local, stage.name, position++);
        byName.set(key, local);
      }
      stageOf.set(stage.id, local ?? (current[0] as { id: string }).id);
    }
    let added = 0;
    let skipped = 0;
    for (const client of data.clients) {
      if (client.ref !== null && this.byRef(client.ref)) {
        skipped++;
        continue;
      }
      const id = crypto.randomUUID();
      this.db.run(
        `INSERT INTO zur_crm_clients (id, ref, name, search_name, phone, phone_digits, email, birthday, birthday_md, stage_id, notes, follow_up_at, follow_up_note, follow_up_noticed, source, last_activity_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        client.ref,
        client.name,
        searchText(client.name),
        client.phone ?? null,
        phoneDigits(client.phone),
        client.email ?? null,
        client.birthday ?? null,
        birthdayMonthDay(client.birthday),
        stageOf.get(client.stageId) ?? (current[0] as { id: string }).id,
        client.notes ?? "",
        client.followUpAt,
        client.followUpNote,
        // A follow-up already past when the backup was made isn't told again as new.
        client.followUpAt !== null && client.followUpAt <= this.nowIso() ? 1 : 0,
        client.source,
        client.lastActivityAt,
        client.createdAt,
        client.updatedAt,
      );
      for (const tag of new Set(client.tags)) this.db.run(`INSERT INTO zur_crm_tags (client_id, tag) VALUES (?, ?)`, id, tag);
      for (const entry of client.history.slice(-CRM_LIMITS.historyPerClient)) {
        this.db.run(`INSERT INTO zur_crm_history (id, client_id, kind, text, at) VALUES (?, ?, ?, ?, ?)`, crypto.randomUUID(), id, entry.kind, entry.text, entry.at);
      }
      added++;
    }
    if (this.count() > CRM_LIMITS.clients) throw new AppError("STORAGE_LIMIT_REACHED", "error.crmClientLimit");
    this.db.run(`DELETE FROM zur_crm_tag_counts WHERE n <= 0`);
    const distinct = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_crm_tag_counts`)?.n ?? 0;
    if (distinct > CRM_LIMITS.distinctTags) throw new AppError("STORAGE_LIMIT_REACHED", "error.crmTagLimit");
    return { clients: added, skipped };
  }

  /** Changes a client; each change of stage, tags and follow-up goes to the history. */
  update(id: string, patch: ClientPatch): CrmClientDetail {
    const row = this.row(id);
    if (!row) throw new AppError("NOT_FOUND", "error.crmClientNotFound");
    // Only text that grows meets the ceiling: a full database can still be trimmed.
    if (patch.notes !== undefined && patch.notes.length > row.notes.length) this.deps.assertBytes?.();
    if (patch.stageId !== undefined && !this.db.one(`SELECT 1 AS found FROM zur_crm_stages WHERE id = ?`, patch.stageId)) {
      throw new AppError("NOT_FOUND", "error.crmStageNotFound");
    }
    const before = this.tagsOf(id);
    let after = before;
    if (patch.tags !== undefined) after = [...new Set(patch.tags)];
    if (patch.tagsAdd?.length) after = [...new Set([...after, ...patch.tagsAdd])];
    if (patch.tagsRemove?.length) after = after.filter((tag) => !patch.tagsRemove?.includes(tag));
    after.sort();
    if (after.length > CRM_LIMITS.tagsPerClient) throw new AppError("VALIDATION_FAILED", undefined, { fields: ["tags"] });
    const added = after.filter((tag) => !before.includes(tag));
    const removed = before.filter((tag) => !after.includes(tag));
    this.checkTags(added);
    const at = this.nowIso();
    const sets: string[] = [];
    const params: SqlValue[] = [];
    const set = (column: string, value: SqlValue) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (patch.name !== undefined && patch.name !== row.name) {
      set("name", patch.name);
      set("search_name", searchText(patch.name));
    }
    if (patch.phone !== undefined && patch.phone !== row.phone) {
      set("phone", patch.phone);
      set("phone_digits", phoneDigits(patch.phone));
    }
    if (patch.email !== undefined && patch.email !== row.email) set("email", patch.email);
    if (patch.birthday !== undefined && patch.birthday !== row.birthday) {
      set("birthday", patch.birthday);
      set("birthday_md", birthdayMonthDay(patch.birthday));
    }
    if (patch.notes !== undefined && patch.notes !== row.notes) set("notes", patch.notes);
    const stageMoved = patch.stageId !== undefined && patch.stageId !== row.stage_id;
    if (stageMoved) set("stage_id", patch.stageId as string);
    const followUp = patch.followUp;
    const followUpChanged = followUp !== undefined && ((followUp?.at ?? null) !== row.follow_up_at || (followUp?.note ?? "") !== row.follow_up_note);
    if (followUpChanged) {
      set("follow_up_at", followUp?.at ?? null);
      set("follow_up_note", followUp?.note ?? "");
      set("follow_up_noticed", 0);
    }
    const tagsChanged = added.length > 0 || removed.length > 0;
    if (sets.length === 0 && !tagsChanged) return this.get(id) as CrmClientDetail;
    set("updated_at", at);
    this.atomic(() => {
      this.db.run(`UPDATE zur_crm_clients SET ${sets.join(", ")} WHERE id = ?`, ...params, id);
      for (const tag of added) this.db.run(`INSERT INTO zur_crm_tags (client_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING`, id, tag);
      for (const tag of removed) this.db.run(`DELETE FROM zur_crm_tags WHERE client_id = ? AND tag = ?`, id, tag);
      if (stageMoved) this.history(id, "stage", `${this.stageName(row.stage_id)} → ${this.stageName(patch.stageId as string)}`, at);
      if (tagsChanged) this.history(id, "tags", [...added.map((tag) => `+${tag}`), ...removed.map((tag) => `−${tag}`)].join(" "), at);
      if (followUpChanged) this.history(id, "follow_up", followUp ? `${followUp.at}${followUp.note ? ` · ${followUp.note}` : ""}` : "", at);
    });
    return this.get(id) as CrmClientDetail;
  }

  /** Deletes a client with its tags and history (a trigger takes those). */
  remove(id: string): void {
    if (!this.row(id)) throw new AppError("NOT_FOUND", "error.crmClientNotFound");
    // The tags and the history go with the client, in one transaction.
    this.atomic(() => {
      this.db.run(`DELETE FROM zur_crm_tags WHERE client_id = ?`, id);
      this.db.run(`DELETE FROM zur_crm_history WHERE client_id = ?`, id);
      this.db.run(`DELETE FROM zur_crm_clients WHERE id = ?`, id);
    });
  }

  /** A line in a client's history; `touch` moves the last activity (an event from n8n). */
  note(id: string, kind: CrmHistoryKind, text: string, touch = false): CrmHistoryEntry {
    const row = this.row(id);
    if (!row) throw new AppError("NOT_FOUND", "error.crmClientNotFound");
    this.deps.assertBytes?.();
    const at = this.nowIso();
    const clean = cleanText(text, CRM_LIMITS.historyText);
    let entry: CrmHistoryEntry | undefined;
    this.atomic(() => {
      entry = this.history(id, kind, clean, at);
      this.db.run(`UPDATE zur_crm_clients SET updated_at = ?${touch ? ", last_activity_at = ?" : ""} WHERE id = ?`, at, ...(touch ? [at] : []), id);
    });
    return entry as CrmHistoryEntry;
  }

  /** Writes one history line and keeps only the newest 100 of the client. */
  private history(clientId: string, kind: CrmHistoryKind, text: string, at: string): CrmHistoryEntry {
    const id = crypto.randomUUID();
    this.db.run(`INSERT INTO zur_crm_history (id, client_id, kind, text, at) VALUES (?, ?, ?, ?, ?)`, id, clientId, kind, text, at);
    this.db.run(
      `DELETE FROM zur_crm_history WHERE id IN (
         SELECT id FROM zur_crm_history WHERE client_id = ? ORDER BY at DESC, id DESC LIMIT -1 OFFSET ?
       )`,
      clientId,
      CRM_LIMITS.historyPerClient,
    );
    return { id, kind, text, at };
  }

  /** The owner's day and the next 7, as UTC instants. */
  private dayWindow(): { start: string; end: string; weekEnd: string } {
    const { start, end } = localDayBounds(this.deps.timeZone(), new Date(this.clock()));
    const weekEnd = new Date(Date.parse(end) + 6 * DAY_MS).toISOString();
    return { start, end, weekEnd };
  }

  /**
   * The list, by name: words match the name, the e-mail or any piece of the
   * phone; filters by stage, tag and follow-up; `after` continues a page.
   */
  list(input: { q?: string | undefined; stage?: string | undefined; tag?: string | undefined; followUp?: CrmFollowUpFilter | undefined; after?: string | undefined; limit?: number }): CrmClientPage {
    const limit = input.limit ?? CRM_LIMITS.page;
    const where: string[] = [];
    const params: SqlValue[] = [];
    const q = (input.q ?? "").trim();
    if (q) {
      const words = searchText(q);
      const digits = phoneDigits(q);
      // instr, not LIKE: SQLite refuses a LIKE pattern over 50 bytes, and % and _ stay plain characters.
      const parts = [`instr(search_name, ?) > 0`, `instr(lower(email), ?) > 0`];
      params.push(words, q.toLowerCase());
      if (digits.length >= 3) {
        parts.push(`instr(phone_digits, ?) > 0`);
        params.push(digits);
      }
      where.push(`(${parts.join(" OR ")})`);
    }
    if (input.stage) {
      where.push(`stage_id = ?`);
      params.push(input.stage);
    }
    if (input.tag) {
      where.push(`id IN (SELECT client_id FROM zur_crm_tags WHERE tag = ?)`);
      params.push(input.tag.trim().toLowerCase());
    }
    if (input.followUp) {
      const { start, end, weekEnd } = this.dayWindow();
      where.push(`follow_up_at IS NOT NULL`);
      if (input.followUp === "overdue") {
        where.push(`follow_up_at < ?`);
        params.push(new Date(this.clock()).toISOString());
      } else if (input.followUp === "today") {
        where.push(`follow_up_at >= ? AND follow_up_at < ?`);
        params.push(start, end);
      } else if (input.followUp === "week") {
        where.push(`follow_up_at >= ? AND follow_up_at < ?`);
        params.push(start, weekEnd);
      }
    }
    if (input.after) {
      const [name, id] = input.after.split("\n") as [string, string];
      where.push(`(search_name > ? OR (search_name = ? AND id > ?))`);
      params.push(name, name, id);
    }
    const rows = this.db.all<ClientRow>(
      `SELECT ${COLUMNS} FROM zur_crm_clients ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY search_name, id LIMIT ?`,
      ...params,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { clients: page.map((row) => this.summaryOf(row)), next: rows.length > limit && last ? `${last.search_name}\n${last.id}` : null };
  }

  summary(): CrmSummary {
    const { start, end, weekEnd } = this.dayWindow();
    const nowIso = new Date(this.clock()).toISOString();
    const n = (query: string, ...params: SqlValue[]) => this.db.one<{ n: number }>(query, ...params)?.n ?? 0;
    return {
      total: this.count(),
      overdue: n(`SELECT count(*) AS n FROM zur_crm_clients WHERE follow_up_at IS NOT NULL AND follow_up_at < ?`, nowIso),
      today: n(`SELECT count(*) AS n FROM zur_crm_clients WHERE follow_up_at IS NOT NULL AND follow_up_at >= ? AND follow_up_at < ?`, start, end),
      week: n(`SELECT count(*) AS n FROM zur_crm_clients WHERE follow_up_at IS NOT NULL AND follow_up_at >= ? AND follow_up_at < ?`, start, weekEnd),
      newThisWeek: n(`SELECT count(*) AS n FROM zur_crm_clients WHERE created_at >= ?`, new Date(this.clock() - 7 * DAY_MS).toISOString()),
    };
  }

  // ---------- Settings and notices ----------

  settingsRow(): SettingsRow {
    return (
      this.db.one<SettingsRow>(`SELECT events_key, last_event_at, follow_ups, birthdays, new_clients, next_reminder, reminder_time, new_client_notices, events_per_hour, events_per_day, reminded_day FROM zur_crm_settings WHERE id = 1`) ?? {
        events_key: null,
        last_event_at: null,
        follow_ups: 1,
        birthdays: 1,
        new_clients: 1,
        next_reminder: null,
        reminder_time: CRM_BIRTHDAY_TIME,
        new_client_notices: CRM_LIMITS.newClientNoticesPerDay,
        events_per_hour: CRM_LIMITS.eventsPerHour,
        events_per_day: CRM_LIMITS.eventsPerDay,
        reminded_day: null,
      }
    );
  }

  settings(): CrmSettings {
    const row = this.settingsRow();
    return {
      followUps: row.follow_ups === 1,
      birthdays: row.birthdays === 1,
      newClients: row.new_clients === 1,
      birthdayTime: reminderTime(row),
      newClientNoticesPerDay: noticesPerDay(row),
      ...eventLimits(row),
    };
  }

  updateSettings(patch: { [K in keyof CrmSettings]?: CrmSettings[K] | undefined }): CrmSettings {
    const before = this.settingsRow();
    // Checked before anything is written: an hour that takes more than the day would promise what the day refuses.
    const limits = eventLimits(before);
    const perHour = patch.eventsPerHour ?? limits.eventsPerHour;
    const perDay = patch.eventsPerDay ?? limits.eventsPerDay;
    if (perHour > perDay) throw new AppError("VALIDATION_FAILED", "error.crmEventLimits", { fields: [patch.eventsPerHour !== undefined ? "eventsPerHour" : "eventsPerDay"] });
    const map = [
      ["followUps", "follow_ups"],
      ["birthdays", "birthdays"],
      ["newClients", "new_clients"],
    ] as const;
    const changed: string[] = [];
    for (const [key, column] of map) {
      const value = patch[key];
      if (value === undefined) continue;
      this.db.run(`UPDATE zur_crm_settings SET ${column} = ? WHERE id = 1`, value ? 1 : 0);
      if ((before[column] === 1) !== value) changed.push(key);
    }
    // The same value writes nothing: the screen saves on every "Salvar".
    if (patch.birthdayTime !== undefined && patch.birthdayTime !== before.reminder_time) {
      this.db.run(`UPDATE zur_crm_settings SET reminder_time = ? WHERE id = 1`, patch.birthdayTime);
      changed.push("birthdayTime");
    }
    if (patch.newClientNoticesPerDay !== undefined && patch.newClientNoticesPerDay !== before.new_client_notices) {
      this.db.run(`UPDATE zur_crm_settings SET new_client_notices = ? WHERE id = 1`, patch.newClientNoticesPerDay);
      changed.push("newClientNoticesPerDay");
    }
    if (perHour !== before.events_per_hour || perDay !== before.events_per_day) {
      this.db.run(`UPDATE zur_crm_settings SET events_per_hour = ?, events_per_day = ? WHERE id = 1`, perHour, perDay);
      changed.push("eventLimits");
    }
    // SEC-A1-01: no password here, so a change leaves a trace the owner can read.
    if (changed.length > 0) recordActivity(this.db, "crm.settings", { fields: changed });
    this.planReminder();
    return this.settings();
  }

  /**
   * The next birthday notice, at the owner's time (9 h until they pick another) in their zone; none while
   * they are off. A day gets one notice whatever the owner does to the time: after today's, the new time
   * starts tomorrow; before it, a time moved to earlier than now leaves today's where it was.
   */
  planReminder(): void {
    const row = this.settingsRow();
    const now = this.clock();
    const schedule = { type: "daily", time: reminderTime(row) } as const;
    let at = row.birthdays === 1 ? nextRun(schedule, this.deps.timeZone(), new Date(now)) : null;
    if (at) {
      const today = this.localDay(now);
      const pendingToday = row.next_reminder !== null && row.next_reminder > now && this.localDay(row.next_reminder) === today;
      if (this.localDay(at.getTime()) === today) {
        if (row.reminded_day === today) at = nextRun(schedule, this.deps.timeZone(), at);
      } else if (pendingToday && row.reminded_day !== today) {
        at = new Date(row.next_reminder as number);
      }
    }
    const value = at ? at.getTime() : null;
    if (value !== row.next_reminder) this.db.run(`UPDATE zur_crm_settings SET next_reminder = ? WHERE id = 1`, value);
  }

  /**
   * When the alarm has CRM work (ms), or null: the soonest follow-up not yet
   * told and the birthday notice, the latter only while some client has a birthday.
   */
  nextDue(): number | null {
    const row = this.settingsRow();
    const due: number[] = [];
    if (row.follow_ups === 1) {
      const next = this.db.one<{ at: string }>(
        `SELECT follow_up_at AS at FROM zur_crm_clients WHERE follow_up_noticed = 0 AND follow_up_at IS NOT NULL ORDER BY follow_up_noticed, follow_up_at LIMIT 1`,
      );
      if (next) due.push(Date.parse(next.at));
    }
    if (row.birthdays === 1 && this.db.one(`SELECT 1 AS found FROM zur_crm_clients WHERE birthday_md IS NOT NULL LIMIT 1`)) {
      // None planned, or one left from an earlier day (the alarm didn't wake then): 9 h of the next day it fits.
      const now = this.clock();
      if (row.next_reminder === null || (row.next_reminder < now && !this.sameLocalDay(row.next_reminder, now))) {
        this.planReminder();
        const planned = this.settingsRow().next_reminder;
        if (planned !== null) due.push(planned);
      } else {
        due.push(row.next_reminder);
      }
    }
    return due.length ? Math.min(...due) : null;
  }

  /** From the alarm: the follow-ups that came due, then the birthdays of the day. True when the times moved. */
  tick(): boolean {
    const row = this.settingsRow();
    const nowMs = this.clock();
    const nowIso = new Date(nowMs).toISOString();
    let moved = false;
    if (row.follow_ups === 1) {
      const due = this.db.all<{ id: string; name: string; follow_up_note: string }>(
        `SELECT id, name, follow_up_note FROM zur_crm_clients WHERE follow_up_noticed = 0 AND follow_up_at IS NOT NULL AND follow_up_at <= ?
         ORDER BY follow_up_noticed, follow_up_at LIMIT ?`,
        nowIso,
        CRM_LIMITS.followUpsPerWake + 1,
      );
      if (due.length) {
        const total = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_crm_clients WHERE follow_up_noticed = 0 AND follow_up_at IS NOT NULL AND follow_up_at <= ?`, nowIso)?.n ?? 0;
        const shown = total > CRM_LIMITS.followUpsPerWake ? due.slice(0, CRM_LIMITS.followUpsPerWake - 1) : due;
        for (const client of shown) {
          this.deps.notify({ kind: "crm.followUp", clientId: client.id, name: cleanText(client.name, 60), note: cleanText(client.follow_up_note, CRM_LIMITS.followUpNote) });
        }
        if (total > shown.length) this.deps.notify({ kind: "crm.followUps", count: total - shown.length });
        this.db.run(`UPDATE zur_crm_clients SET follow_up_noticed = 1 WHERE follow_up_noticed = 0 AND follow_up_at IS NOT NULL AND follow_up_at <= ?`, nowIso);
        moved = true;
      }
    }
    if (row.next_reminder !== null && row.next_reminder <= nowMs) {
      // Only on the day it was planned for: a notice late past midnight would name the wrong day's birthdays at the wrong hour.
      if (row.birthdays === 1 && this.sameLocalDay(row.next_reminder, nowMs)) {
        this.remindBirthdays();
        this.db.run(`UPDATE zur_crm_settings SET reminded_day = ? WHERE id = 1`, this.localDay(nowMs));
      }
      this.planReminder();
      moved = true;
    }
    return moved;
  }

  private localDay(ms: number): string {
    const parts = zonedParts(new Date(ms), this.deps.timeZone());
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  private sameLocalDay(a: number, b: number): boolean {
    return this.localDay(a) === this.localDay(b);
  }

  private remindBirthdays(): void {
    const parts = zonedParts(new Date(this.clock()), this.deps.timeZone());
    const today = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    const keys = dayKeys(today);
    const marks = keys.map(() => "?").join(",");
    const people = this.db.all<{ name: string }>(`SELECT name FROM zur_crm_clients WHERE birthday_md IN (${marks}) ORDER BY search_name LIMIT ?`, ...keys, CRM_LIMITS.namesPerNotice + 1);
    if (!people.length) return;
    const total = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_crm_clients WHERE birthday_md IN (${marks})`, ...keys)?.n ?? 0;
    const shown = people.slice(0, CRM_LIMITS.namesPerNotice).map((person) => cleanText(person.name, 60));
    this.deps.notify({ kind: "crm.birthdays", names: shown.join(", "), more: Math.max(0, total - shown.length), day: today });
  }

  /** A client n8n added: a notice, at most the owner's number a day (20 unless they picked fewer), while they want them. */
  announceNew(client: { id: string; name: string }): void {
    if (this.settingsRow().new_clients !== 1) return;
    // The owner's day, not UTC's: in São Paulo the count would start over at 21 h.
    const parts = zonedParts(new Date(this.clock()), this.deps.timeZone());
    const bucket = `n:${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    const n = this.db.one<{ n: number }>(`SELECT n FROM zur_crm_counts WHERE bucket = ?`, bucket)?.n ?? 0;
    if (n >= noticesPerDay(this.settingsRow())) return;
    this.db.run(`INSERT INTO zur_crm_counts (bucket, n) VALUES (?, 1) ON CONFLICT (bucket) DO UPDATE SET n = n + 1`, bucket);
    this.deps.notify({ kind: "crm.newClient", clientId: client.id, name: cleanText(client.name, 60) });
  }
}
