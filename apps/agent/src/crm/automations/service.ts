import {
  CRM_AUTOMATION_LIMITS,
  type CrmAutomation,
  type CrmAutomationActivity,
  type CrmAutomationAvailability,
  type CrmAutomationDay,
  type CrmAutomationEffect,
  type CrmAutomationList,
  type CrmAutomationPause,
  type CrmAutomationRun,
  type CrmAutomationState,
  type CrmAutomationVerdict,
  nationalHoliday,
  zonedParts,
  zonedTimeToUtc,
} from "@zuri/shared";
import { recordActivity } from "../../db/activity.ts";
import type { Database } from "../../db/database.ts";
import { type CallDeps, type ConnectionRow, chatwootSettings, type FlowConnections, FlowStepError, knownKind } from "../../flows/connections.ts";
import type { Json } from "../../flows/paths.ts";
import { AppError } from "../../http/errors.ts";
import { type AutomationContext, cleanLabel, type ManifestCall, optionsFor } from "./manifest.ts";
import { AUTOMATION_BASE, type CatalogEntry } from "./registry.ts";

export type AutomationNotice =
  | { kind: "paused"; id: string; reason: CrmAutomationPause }
  | { kind: "rehearsal"; id: string }
  | { kind: "arrived"; id: string };

export interface CrmAutomationDeps {
  db: Database;
  connections: Pick<FlowConnections, "find" | "fixed">;
  /** The calls of one run, inside the wake's one count (FlowService.automationCallDeps). */
  callDeps: (calls: number) => CallDeps;
  timeZone: () => string;
  lockdown: () => boolean;
  notify: (notice: AutomationNotice) => void;
  catalog: readonly CatalogEntry[];
  clock?: () => number;
}

interface Row {
  id: string;
  effects_version: number;
  state: CrmAutomationState;
  options: string;
  connection_id: string | null;
  paused_reason: string | null;
  failures: number;
  rehearsal_since: string | null;
  live_since: string | null;
  next_run_at: string | null;
  watch: number;
  watch_told: number;
}

/** An automation asked for something its manifest doesn't allow: a bug of its code, never sent. */
export class ManifestViolation extends Error {
  constructor(readonly what: string) {
    super(`manifest: ${what}`);
    this.name = "ManifestViolation";
  }
}

/** The run's own ceilings: what's left waits for the next run (or the next day). */
class CapReached extends Error {}

/** Turned off, sent to another mode or locked down during the run: nothing else goes out, and it isn't a failure. */
class Stopped extends Error {}

const PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_MS = 86_400_000;
const FAILURES_TO_PAUSE = 2;

/**
 * The CRM's automations (PR S18; docs/planos/s18-automacoes-do-crm.md): their
 * states, the rehearsal and its check by the owner, and the runtime that runs
 * one on the shared alarm. An automation's code only reaches the world through
 * `read` (GET calls of its manifest) and `effect` (the other calls); in a
 * rehearsal an effect is a note and its call is never made.
 */
export class CrmAutomations {
  #started = false;
  #prunedDay = "";

  constructor(private readonly deps: CrmAutomationDeps) {}

  private get db(): Database {
    return this.deps.db;
  }

  private now(): number {
    return this.deps.clock?.() ?? Date.now();
  }

  private iso(at = this.now()): string {
    return new Date(at).toISOString();
  }

  // ---------- Days ----------

  /** The owner's date of an instant, YYYY-MM-DD. */
  private dayOf(at: number): string {
    const p = zonedParts(new Date(at), this.deps.timeZone());
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  }

  /** Monday to Friday, not a national holiday. The office's days off join with the calendar of E5. */
  static workingDay(day: string): boolean {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    return weekday !== 0 && weekday !== 6 && nationalHoliday(day) === null;
  }

  private static previousDay(day: string): string {
    return new Date(Date.parse(`${day}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  }

  /** The working days of a rehearsal, newest first, from today back to the day it began. */
  private rehearsalDays(since: string, limit: number): string[] {
    const first = this.dayOf(Date.parse(since));
    const days: string[] = [];
    for (let day = this.dayOf(this.now()); day >= first && days.length < limit; day = CrmAutomations.previousDay(day)) {
      if (CrmAutomations.workingDay(day)) days.push(day);
    }
    return days;
  }

  /** The instants where the owner's day begins and the next one does. */
  private dayBounds(day: string): [string, string] {
    const at = (date: string) => zonedTimeToUtc({ ...dayParts(date), hour: 0, minute: 0 }, this.deps.timeZone())?.toISOString() ?? `${date}T00:00:00.000Z`;
    return [at(day), at(nextDay(day))];
  }

  /** Whether the rehearsal ran on that day: only a day it ran can be checked. */
  private ranOn(id: string, day: string): boolean {
    const [from, to] = this.dayBounds(day);
    return (
      this.db.one(`SELECT 1 AS ran FROM zur_crm_automation_runs WHERE automation_id = ? AND started_at >= ? AND started_at < ? AND mode = 'rehearsal' LIMIT 1`, id, from, to) !== null
    );
  }

  /** The first working day after this one, at 00:01 of the owner's time zone. */
  private nextWorkingStart(day: string, fallback: string): string {
    let next = nextDay(day);
    for (let i = 0; i < 14 && !CrmAutomations.workingDay(next); i++) next = nextDay(next);
    return zonedTimeToUtc({ ...dayParts(next), hour: 0, minute: 1 }, this.deps.timeZone())?.toISOString() ?? fallback;
  }

  /** Working days in a row checked as right, from the newest one checked; today may still be open. */
  private matched(row: Row): number {
    if (!row.rehearsal_since || row.live_since) return 0;
    const days = this.rehearsalDays(row.rehearsal_since, CRM_AUTOMATION_LIMITS.days);
    if (days.length === 0) return 0;
    const verdicts = new Map(
      this.db
        .all<{ day: string; verdict: CrmAutomationVerdict }>(`SELECT day, verdict FROM zur_crm_automation_days WHERE automation_id = ? AND day >= ? ORDER BY day DESC LIMIT ?`, row.id, days.at(-1) as string, CRM_AUTOMATION_LIMITS.days)
        .map((entry) => [entry.day, entry.verdict]),
    );
    const today = this.dayOf(this.now());
    let count = 0;
    for (const day of days) {
      const verdict = verdicts.get(day);
      // Only today may stay open: a past day left unchecked breaks the row, whatever the weekday.
      if (verdict === undefined && day === today) continue;
      if (verdict !== "match") break;
      count++;
    }
    return count;
  }

  // ---------- Reading ----------

  private rows(): Map<string, Row> {
    return new Map(this.db.all<Row>(`SELECT * FROM zur_crm_automations LIMIT ?`, 100).map((row) => [row.id, row]));
  }

  private entry(id: string): CatalogEntry {
    const entry = this.deps.catalog.find((item) => item.id === id);
    if (!entry) throw new AppError("NOT_FOUND", "error.crmAutomationNotFound");
    return entry;
  }

  private ready(id: string): Required<CatalogEntry> & { module: NonNullable<CatalogEntry["module"]> } {
    const entry = this.entry(id);
    if (!entry.module) throw new AppError("CONFLICT", "error.crmAutomationNotReady");
    return entry as Required<CatalogEntry> & { module: NonNullable<CatalogEntry["module"]> };
  }

  private row(id: string): Row | null {
    return this.db.one<Row>(`SELECT * FROM zur_crm_automations WHERE id = ?`, id);
  }

  list(): CrmAutomationList {
    const rows = this.rows();
    const firstPlanned = this.deps.catalog.findIndex((entry) => !entry.module);
    const automations = this.deps.catalog.map((entry, index) => {
      const availability: CrmAutomationAvailability = entry.module ? "ready" : index === firstPlanned ? "next" : "development";
      return this.present(entry, rows.get(entry.id) ?? null, index + 1, availability);
    });
    return { automations, base: AUTOMATION_BASE, limits: { active: CRM_AUTOMATION_LIMITS.active, rehearsalDays: CRM_AUTOMATION_LIMITS.rehearsalDays } };
  }

  private present(entry: CatalogEntry, row: Row | null, position: number, availability: CrmAutomationAvailability): CrmAutomation {
    const manifest = entry.module?.manifest;
    const defs = manifest?.options ?? [];
    const stored = row ? parseOptions(row.options) : {};
    const options = optionsFor(defs, stored);
    const state: CrmAutomationState = entry.module && row ? row.state : "off";
    const matched = row && state !== "off" ? this.matched(row) : 0;
    return {
      id: entry.id,
      position,
      availability,
      state,
      writesToContacts: entry.writesToContacts,
      connectionKind: entry.connection,
      connectionId: entry.module ? (row?.connection_id ?? null) : null,
      options: "invalid" in options ? optionsFor(defs, {}) as Record<string, number | string> : options,
      optionDefs: defs,
      pausedReason: state === "paused" ? ((row?.paused_reason ?? "failures") as CrmAutomationPause) : null,
      rehearsalSince: state === "off" ? null : (row?.rehearsal_since ?? null),
      liveSince: state === "live" ? (row?.live_since ?? null) : null,
      watch: !entry.module && row?.watch === 1,
      rehearsal: { matched, required: CRM_AUTOMATION_LIMITS.rehearsalDays, ready: matched >= CRM_AUTOMATION_LIMITS.rehearsalDays },
    };
  }

  /**
   * The credential's users by id, for "Usada por" and for refusing to remove one in use: the ones on (rehearsal,
   * live or paused). One turned off only remembers the pick; starting it again checks the credential once more.
   */
  users(connectionId: string): string[] {
    return this.db.all<{ id: string }>(`SELECT id FROM zur_crm_automations WHERE connection_id = ? AND state != 'off' LIMIT 100`, connectionId).map((row) => row.id);
  }

  activity(id: string): CrmAutomationActivity {
    this.entry(id);
    const row = this.row(id);
    const runs = this.db
      .all<{ started_at: string; mode: CrmAutomationRun["mode"]; outcome: CrmAutomationRun["outcome"]; calls: number; effects: number }>(
        `SELECT started_at, mode, outcome, calls, effects FROM zur_crm_automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?`,
        id,
        CRM_AUTOMATION_LIMITS.activity,
      )
      .map((run) => ({ startedAt: run.started_at, mode: run.mode, outcome: run.outcome, calls: run.calls, effects: run.effects }));
    const effects: CrmAutomationEffect[] = this.db
      .all<{ key: string; created_at: string; mode: CrmAutomationEffect["mode"]; status: CrmAutomationEffect["status"]; label: string }>(
        `SELECT key, created_at, mode, status, label FROM zur_crm_automation_effects WHERE automation_id = ? ORDER BY created_at DESC LIMIT ?`,
        id,
        CRM_AUTOMATION_LIMITS.activity,
      )
      .map((effect) => ({ id: `${effect.mode}:${effect.key}`, at: effect.created_at, mode: effect.mode, status: effect.status, label: effect.label }));
    let days: CrmAutomationDay[] = [];
    if (row?.rehearsal_since && !row.live_since && row.state !== "off") {
      const list = this.rehearsalDays(row.rehearsal_since, CRM_AUTOMATION_LIMITS.days);
      const oldest = list.at(-1);
      if (oldest) {
        const would = new Map(
          this.db
            .all<{ day: string; n: number }>(`SELECT day, count(*) AS n FROM zur_crm_automation_effects WHERE automation_id = ? AND mode = 'rehearsal' AND day >= ? GROUP BY day`, id, oldest)
            .map((entry) => [entry.day, entry.n]),
        );
        const checked = new Map(
          this.db
            .all<{ day: string; verdict: CrmAutomationVerdict; note: string | null }>(`SELECT day, verdict, note FROM zur_crm_automation_days WHERE automation_id = ? AND day >= ? ORDER BY day DESC LIMIT ?`, id, oldest, CRM_AUTOMATION_LIMITS.days)
            .map((entry) => [entry.day, entry]),
        );
        const today = this.dayOf(this.now());
        days = list.map((day) => ({ day, would: would.get(day) ?? 0, ran: this.ranOn(id, day), today: day === today, verdict: checked.get(day)?.verdict ?? null, note: checked.get(day)?.note ?? null }));
      }
    }
    return { runs, effects, days };
  }

  // ---------- Changing ----------

  /** The credential (of the kind the manifest asks for) and the options, inside their ranges. */
  configure(id: string, input: { connectionId: string | null; options: Record<string, number | string> }): void {
    const { module } = this.ready(id);
    // Another credential or other limits are another rehearsal: only while it is off.
    const current = this.row(id)?.state;
    if (current !== undefined && current !== "off") throw new AppError("CONFLICT", "error.crmAutomationTurnOffFirst");
    const manifest = module.manifest;
    this.checkConnection(manifest.connection, input.connectionId);
    const options = optionsFor(manifest.options, input.options);
    if ("invalid" in options) throw new AppError("VALIDATION_FAILED", "error.crmAutomationOption", { fields: [`options.${options.invalid}`] });
    this.db.run(
      `INSERT INTO zur_crm_automations (id, effects_version, options, connection_id, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET options = excluded.options, connection_id = excluded.connection_id, updated_at = excluded.updated_at`,
      id,
      manifest.effectsVersion,
      JSON.stringify(options),
      input.connectionId,
      this.iso(),
    );
    recordActivity(this.db, "crm.automation_config", { automation: id });
  }

  private checkConnection(kind: CatalogEntry["connection"], connectionId: string | null): ConnectionRow | null {
    if (kind === null) {
      if (connectionId !== null) throw new AppError("VALIDATION_FAILED", "error.crmAutomationConnection", { fields: ["connectionId"] });
      return null;
    }
    const row = connectionId ? this.deps.connections.find(connectionId) : null;
    if (!row || knownKind(row.kind) !== kind) throw new AppError("VALIDATION_FAILED", "error.crmAutomationConnection", { fields: ["connectionId"] });
    return row;
  }

  /**
   * Rehearsal, live or off (the route asks for the password before the first two).
   * Going live takes the working days checked as right, or the owner taking the risk.
   */
  setMode(id: string, mode: "rehearsal" | "live" | "off", acceptRisk = false): void {
    if (mode === "off") {
      this.entry(id);
      const row = this.row(id);
      if (!row || row.state === "off") return;
      this.db.run(
        `UPDATE zur_crm_automations SET state = 'off', next_run_at = NULL, paused_reason = NULL, failures = 0, rehearsal_since = NULL, live_since = NULL, updated_at = ? WHERE id = ?`,
        this.iso(),
        id,
      );
      recordActivity(this.db, "crm.automation_mode", { automation: id, mode });
      return;
    }
    const { module } = this.ready(id);
    const row = this.row(id);
    if (!row) throw new AppError("CONFLICT", "error.crmAutomationNotConfigured");
    this.checkConnection(module.manifest.connection, row.connection_id);
    const active = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_crm_automations WHERE state IN ('rehearsal', 'live', 'paused') AND id != ?`, id)?.n ?? 0;
    if (row.state === "off" && active >= CRM_AUTOMATION_LIMITS.active) throw new AppError("CONFLICT", "error.crmAutomationActiveLimit", { limit: CRM_AUTOMATION_LIMITS.active });
    const at = this.iso();
    if (mode === "rehearsal") {
      // Back from a pause in the same rehearsal, its days still count; anything else starts again.
      const keep = (row.state === "rehearsal" || row.state === "paused") && row.rehearsal_since && !row.live_since;
      this.db.run(
        `UPDATE zur_crm_automations SET state = 'rehearsal', effects_version = ?, rehearsal_since = ?, live_since = NULL, paused_reason = NULL, failures = 0, next_run_at = ?, updated_at = ? WHERE id = ?`,
        module.manifest.effectsVersion,
        keep ? row.rehearsal_since : at,
        at,
        at,
        id,
      );
    } else {
      if (row.state === "off") throw new AppError("CONFLICT", "error.crmAutomationRehearsalFirst");
      if (row.state !== "live" && !(row.state === "paused" && row.live_since)) {
        if (!acceptRisk && this.matched(row) < CRM_AUTOMATION_LIMITS.rehearsalDays) {
          throw new AppError("CONFLICT", "error.crmAutomationRehearsalDays", { days: CRM_AUTOMATION_LIMITS.rehearsalDays });
        }
      }
      this.db.run(
        `UPDATE zur_crm_automations SET state = 'live', effects_version = ?, live_since = COALESCE(live_since, ?), paused_reason = NULL, failures = 0, next_run_at = ?, updated_at = ? WHERE id = ?`,
        module.manifest.effectsVersion,
        at,
        at,
        at,
        id,
      );
    }
    recordActivity(this.db, "crm.automation_mode", { automation: id, mode, ...(mode === "live" && acceptRisk ? { risk: true } : {}) });
  }

  /** The owner's check of a working day of the rehearsal: right, or wrong with the reason. */
  checkDay(id: string, day: string, input: { verdict: CrmAutomationVerdict; note?: string | undefined }): void {
    this.ready(id);
    const row = this.row(id);
    if (!row?.rehearsal_since || row.live_since || (row.state !== "rehearsal" && row.state !== "paused")) throw new AppError("CONFLICT", "error.crmAutomationNotRehearsing");
    // Only a past working day of the rehearsal on which it ran: a day can't be called right before it ends.
    if (day >= this.dayOf(this.now()) || !this.rehearsalDays(row.rehearsal_since, 366).includes(day) || !this.ranOn(id, day)) throw new AppError("VALIDATION_FAILED", "error.crmAutomationDay", { fields: ["day"] });
    this.db.run(
      `INSERT INTO zur_crm_automation_days (automation_id, day, verdict, note, decided_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(automation_id, day) DO UPDATE SET verdict = excluded.verdict, note = excluded.note, decided_at = excluded.decided_at`,
      id,
      day,
      input.verdict,
      input.verdict === "differs" ? (input.note ?? "") : null,
      this.iso(),
    );
  }

  /** "Avisar quando chegar": only for one whose code isn't here yet; told once, when it arrives. */
  watch(id: string, watch: boolean): void {
    const entry = this.entry(id);
    if (entry.module) throw new AppError("CONFLICT", "error.crmAutomationAlreadyHere");
    this.db.run(
      `INSERT INTO zur_crm_automations (id, watch, watch_told, updated_at) VALUES (?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET watch = excluded.watch, watch_told = 0, updated_at = excluded.updated_at`,
      id,
      watch ? 1 : 0,
      this.iso(),
    );
  }

  // ---------- Running ----------

  /** The next run due, for the shared alarm. */
  nextDue(): string | null {
    return this.db.one<{ at: string }>(`SELECT next_run_at AS at FROM zur_crm_automations WHERE next_run_at IS NOT NULL ORDER BY next_run_at LIMIT 1`)?.at ?? null;
  }

  /**
   * Once per start of the object (new code comes only with a deploy): tells the
   * owner of an awaited automation that arrived, sends back to rehearsal a live
   * one whose effects changed, and stops one whose code left.
   */
  private start(): boolean {
    if (this.#started) return false;
    let changed = false;
    for (const row of this.rows().values()) {
      const entry = this.deps.catalog.find((item) => item.id === row.id);
      const module = entry?.module;
      if (!module) {
        // Its code left: it turns off, so it neither runs nor holds its credential nor counts among the 10.
        if (row.state !== "off") {
          this.db.run(`UPDATE zur_crm_automations SET state = 'off', next_run_at = NULL, paused_reason = NULL, failures = 0, rehearsal_since = NULL, live_since = NULL, updated_at = ? WHERE id = ?`, this.iso(), row.id);
          changed = true;
        }
        continue;
      }
      if (row.state === "live" || row.state === "paused") {
        // A live effect left 'pending' by an object that stopped mid-call (a deploy): never sent again, marked failed.
        // Its key keeps it from going twice; only the last days can hold one.
        const { rowsWritten } = this.db.run(
          `UPDATE zur_crm_automation_effects SET status = 'failed', updated_at = ? WHERE automation_id = ? AND mode = 'live' AND day >= ? AND status = 'pending'`,
          this.iso(),
          row.id,
          CrmAutomations.previousDay(this.dayOf(this.now())),
        );
        changed ||= rowsWritten > 0;
      }
      if (row.watch === 1 && row.watch_told === 0) {
        this.db.run(`UPDATE zur_crm_automations SET watch_told = 1 WHERE id = ?`, row.id);
        this.deps.notify({ kind: "arrived", id: row.id });
      }
      if (row.state === "off" || row.effects_version >= module.manifest.effectsVersion) continue;
      if (row.state === "live" || (row.state === "paused" && row.live_since)) {
        const at = this.iso();
        this.db.run(
          `UPDATE zur_crm_automations SET state = 'rehearsal', effects_version = ?, rehearsal_since = ?, live_since = NULL, paused_reason = NULL, failures = 0, next_run_at = ?, updated_at = ? WHERE id = ?`,
          module.manifest.effectsVersion,
          at,
          at,
          at,
          row.id,
        );
        this.deps.notify({ kind: "rehearsal", id: row.id });
        changed = true;
      } else {
        // In rehearsal (or paused in it): the days checked were of the old effects, so the rehearsal starts over.
        const at = this.iso();
        this.db.run(`UPDATE zur_crm_automations SET effects_version = ?, rehearsal_since = ?, updated_at = ? WHERE id = ?`, module.manifest.effectsVersion, at, at, row.id);
        this.deps.notify({ kind: "rehearsal", id: row.id });
        changed = true;
      }
    }
    // Marked after the loop: an error halfway leaves the rest for the next wake.
    this.#started = true;
    return changed;
  }

  /** Runs on the shared alarm: at most one automation per wake. True when the alarm must be set again. */
  async tick(): Promise<boolean> {
    if (this.deps.lockdown()) return this.holdForLockdown();
    const changed = this.start();
    this.prune();
    const due = this.db.one<Row>(`SELECT * FROM zur_crm_automations WHERE next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 1`, this.iso());
    if (!due) return changed;
    const entry = this.deps.catalog.find((item) => item.id === due.id);
    if (!entry?.module || (due.state !== "rehearsal" && due.state !== "live")) {
      this.db.run(`UPDATE zur_crm_automations SET next_run_at = NULL WHERE id = ?`, due.id);
      return true;
    }
    await this.run(entry as CatalogEntry & { module: NonNullable<CatalogEntry["module"]> }, due);
    return true;
  }

  /**
   * Lockdown: nothing runs, and what was due moves on to its next time, as a flow's run does (it would
   * otherwise wake the object every minute for as long as the lockdown lasts).
   */
  private holdForLockdown(): boolean {
    const due = this.db.all<{ id: string }>(`SELECT id FROM zur_crm_automations WHERE next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?`, this.iso(), 100);
    for (const { id } of due) {
      const minutes = this.deps.catalog.find((item) => item.id === id)?.module?.manifest.trigger.minutes ?? 60;
      this.db.run(`UPDATE zur_crm_automations SET next_run_at = ? WHERE id = ?`, this.iso(this.now() + minutes * 60_000), id);
    }
    return due.length > 0;
  }

  /** Still the same state it started the run in, and no lockdown: one read by the key before each call. */
  private stillOn(id: string, state: CrmAutomationState): void {
    if (this.deps.lockdown() || this.db.one<{ state: string }>(`SELECT state FROM zur_crm_automations WHERE id = ?`, id)?.state !== state) throw new Stopped();
  }

  private async run(entry: CatalogEntry & { module: NonNullable<CatalogEntry["module"]> }, row: Row): Promise<void> {
    const manifest = entry.module.manifest;
    const at = this.now();
    const day = this.dayOf(at);
    const next = this.iso(at + manifest.trigger.minutes * 60_000);
    if (manifest.trigger.workingDays && !CrmAutomations.workingDay(day)) {
      // A weekend or a holiday: straight to the next working day, not a wake every few minutes to skip.
      this.db.run(`UPDATE zur_crm_automations SET next_run_at = ? WHERE id = ? AND state = ?`, this.nextWorkingStart(day, next), row.id, row.state);
      return;
    }
    const mode = row.state === "live" ? "live" : "rehearsal";
    const startOfDay = zonedTimeToUtc({ ...dayParts(day), hour: 0, minute: 0 }, this.deps.timeZone())?.toISOString() ?? this.iso(at - DAY_MS);
    const runsToday = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_crm_automation_runs WHERE automation_id = ? AND started_at >= ?`, row.id, startOfDay)?.n ?? 0;
    if (runsToday >= manifest.caps.runsPerDay) {
      // The day's runs are spent: the next one tomorrow, after the owner's midnight.
      const tomorrow = zonedTimeToUtc({ ...dayParts(nextDay(day)), hour: 0, minute: 1 }, this.deps.timeZone())?.toISOString() ?? next;
      this.db.run(`UPDATE zur_crm_automations SET next_run_at = ? WHERE id = ? AND state = ?`, tomorrow, row.id, row.state);
      return;
    }
    let calls = 0;
    let effects = 0;
    let outcome: CrmAutomationRun["outcome"] = "ok";
    let pause: CrmAutomationPause | null = null;
    let failures = row.failures;
    let effectsLeft = manifest.caps.effectsPerDay - (this.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_crm_automation_effects WHERE automation_id = ? AND mode = ? AND day = ?`, row.id, mode, day)?.n ?? 0);
    const connection = manifest.connection ? this.deps.connections.find(row.connection_id ?? "") : null;
    if (manifest.connection && (!connection || knownKind(connection.kind) !== manifest.connection)) {
      this.pause(row.id, row.state, "credential");
      return;
    }
    // The run counts its own calls; the meter also counts the 2 DNS lookups of the credential's host (once per run).
    const callDeps = this.deps.callDeps(manifest.caps.callsPerRun + 2);
    const call = async (name: string, wantRead: boolean, params: Record<string, string | number> = {}, body?: unknown): Promise<unknown> => {
      const found: ManifestCall | undefined = manifest.calls.find((item) => item.name === name);
      if (!found || (found.method === "GET") !== wantRead) throw new ManifestViolation(`call ${name}`);
      if (!connection || !manifest.connection) throw new ManifestViolation("connection");
      if (calls >= manifest.caps.callsPerRun) throw new CapReached();
      // The account is the credential's own: a module never picks another one on the same server.
      if (manifest.connection === "chatwoot" && "account" in params) throw new ManifestViolation("param account");
      const filled: Record<string, string | number> = { ...params, ...(manifest.connection === "chatwoot" ? { account: chatwootSettings(connection).accountId } : {}) };
      const path = found.path.replace(/\{([a-z][A-Za-z0-9]*)\}/g, (_hole, key: string) => {
        const value = filled[key];
        if (value === undefined || !PARAM.test(String(value))) throw new ManifestViolation(`param ${key}`);
        return String(value);
      });
      this.stillOn(row.id, row.state);
      calls++;
      try {
        const answer = await this.deps.connections.fixed(connection, manifest.connection, { method: found.method, path, ...(body === undefined ? {} : { body: body as Json }) }, callDeps);
        return answer.body;
      } catch (error) {
        // The wake's share ran out before the request left (the flows took it): what's left waits, it isn't a failure.
        if ((error instanceof Error && error.message === "budget") || (error instanceof FlowStepError && error.problem === "calls_limit")) {
          calls--;
          throw new CapReached();
        }
        throw error;
      }
    };
    const ctx: AutomationContext = {
      mode,
      options: (() => {
        const options = optionsFor(manifest.options, parseOptions(row.options));
        return "invalid" in options ? (optionsFor(manifest.options, {}) as Record<string, number | string>) : options;
      })(),
      day,
      timeZone: this.deps.timeZone(),
      now: at,
      read: (name, params) => call(name, true, params),
      effect: async (input) => {
        if (!manifest.effects.includes(input.effect)) throw new ManifestViolation(`effect ${input.effect}`);
        const found = manifest.calls.find((item) => item.name === input.call);
        if (!found || found.method === "GET") throw new ManifestViolation(`call ${input.call}`);
        if (input.key.length === 0 || input.key.length > CRM_AUTOMATION_LIMITS.key) throw new ManifestViolation("key");
        if (effectsLeft <= 0) throw new CapReached();
        this.stillOn(row.id, row.state);
        const label = cleanLabel(input.label);
        const when = this.iso();
        const status = mode === "rehearsal" ? "would" : "pending";
        const { rowsWritten } = this.db.run(
          `INSERT OR IGNORE INTO zur_crm_automation_effects (automation_id, key, mode, day, status, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id,
          input.key,
          mode,
          day,
          status,
          label,
          when,
          when,
        );
        if (rowsWritten === 0) return "skipped";
        effectsLeft--;
        // The rehearsal's promise: its call is never made.
        if (mode === "rehearsal") {
          effects++;
          return "would";
        }
        try {
          await call(input.call, false, input.params, input.body);
        } catch (error) {
          if (error instanceof CapReached || error instanceof Stopped || error instanceof ManifestViolation) {
            // Nothing left for the service: the key is free again for a later run.
            this.db.run(`DELETE FROM zur_crm_automation_effects WHERE automation_id = ? AND mode = 'live' AND key = ? AND status = 'pending'`, row.id, input.key);
            effectsLeft++;
          } else {
            this.db.run(`UPDATE zur_crm_automation_effects SET status = 'failed', updated_at = ? WHERE automation_id = ? AND mode = 'live' AND key = ?`, this.iso(), row.id, input.key);
          }
          throw error;
        }
        this.db.run(`UPDATE zur_crm_automation_effects SET status = 'done', updated_at = ? WHERE automation_id = ? AND mode = 'live' AND key = ?`, this.iso(), row.id, input.key);
        effects++;
        return "done";
      },
    };
    try {
      await entry.module.run(ctx);
      failures = 0;
    } catch (error) {
      if (error instanceof CapReached) {
        outcome = "cap";
      } else if (error instanceof Stopped) {
        outcome = "skipped";
      } else {
        outcome = "failed";
        if (error instanceof FlowStepError && (error.problem === "credential" || error.httpStatus === 401 || error.httpStatus === 403)) pause = "credential";
        else if (error instanceof FlowStepError && error.problem === "bad_answer") pause = "bad_answer";
        else if (++failures >= FAILURES_TO_PAUSE) pause = "failures";
      }
    }
    this.db.run(
      `INSERT INTO zur_crm_automation_runs (automation_id, started_at, mode, outcome, calls, effects) VALUES (?, ?, ?, ?, ?, ?)`,
      row.id,
      this.iso(at),
      mode,
      outcome,
      calls,
      effects,
    );
    // Only on the state the run began in: a "Desligar" or another mode during the run stays as the owner left it.
    if (pause) this.pause(row.id, row.state, pause);
    else this.db.run(`UPDATE zur_crm_automations SET next_run_at = ?, failures = ? WHERE id = ? AND state = ?`, next, failures, row.id, row.state);
  }

  private pause(id: string, from: CrmAutomationState, reason: CrmAutomationPause): void {
    const { rowsWritten } = this.db.run(
      `UPDATE zur_crm_automations SET state = 'paused', paused_reason = ?, next_run_at = NULL, failures = 0, updated_at = ? WHERE id = ? AND state = ?`,
      reason,
      this.iso(),
      id,
      from,
    );
    if (rowsWritten > 0) this.deps.notify({ kind: "paused", id, reason });
  }

  /** Once a day: runs after 90 days, effects and checked days after 180. */
  private prune(): void {
    const today = this.iso().slice(0, 10);
    if (this.#prunedDay === today) return;
    this.#prunedDay = today;
    const before = (days: number) => this.iso(this.now() - days * DAY_MS);
    this.db.run(`DELETE FROM zur_crm_automation_runs WHERE started_at < ?`, before(CRM_AUTOMATION_LIMITS.runsKeepDays));
    this.db.run(`DELETE FROM zur_crm_automation_effects WHERE created_at < ?`, before(CRM_AUTOMATION_LIMITS.effectsKeepDays));
    // By the key (automation, day), one automation at a time: no index on decided_at to keep up.
    const oldDay = before(CRM_AUTOMATION_LIMITS.effectsKeepDays).slice(0, 10);
    for (const { id } of this.db.all<{ id: string }>(`SELECT id FROM zur_crm_automations LIMIT ?`, 100)) {
      this.db.run(`DELETE FROM zur_crm_automation_days WHERE automation_id = ? AND day < ?`, id, oldDay);
    }
  }
}

function parseOptions(value: string): Record<string, number | string> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number | string] => typeof entry[1] === "number" || typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function dayParts(day: string): { year: number; month: number; day: number } {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)) };
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}
