import {
  OUTBOX_LIMITS,
  OUTBOX_PRIORITY,
  type OutboxCounts,
  type OutboxDetail,
  type OutboxFilter,
  type OutboxGroup,
  type OutboxList,
  type OutboxPeriod,
  type OutboxProblem,
  type OutboxRow,
  type OutboxState,
  type OutboxStatus,
  type OutboxStatusInfo,
  type OutboxStep,
  type OutboxStepKind,
  type OutboxStopReason,
  zonedParts,
  zonedTimeToUtc,
} from "@zuri/shared";
import { recordActivity } from "../db/activity.ts";
import type { Database } from "../db/database.ts";
import { chatwootConversation, chatwootCreateContact, chatwootFindContact, chatwootFindSent, chatwootSend } from "../flows/chatwoot.ts";
import { type CallDeps, type ConnectionRow, chatwootSettings, type FlowConnections, FlowStepError, knownKind } from "../flows/connections.ts";
import { AppError } from "../http/errors.ts";

/**
 * The outbox (PR S19; docs/planos/s19-envios.md): the only way out to a
 * contact. An automation writes what to send under a unique key (`enqueue`);
 * the shared alarm sends at most one message per wake (`tick`), one at a time
 * per Chatwoot credential, the credential's gap apart. Nothing goes twice:
 *
 * - the key is unique per automation, so the same message is never queued twice;
 * - the credential's next free time is written only if it is still the one read,
 *   and the row only moves to "sending" if it is still waiting (conditional
 *   updates): two wakes or a retry at the same time, and only one goes;
 * - a send that may have left (no answer, a 5xx after the POST, an object that
 *   stopped mid-call) is "checking": the next try first looks for the same text
 *   in the conversation and, if it is there, marks it sent without sending again.
 *
 * The text and the phone stay only while the message may still go out; the
 * routes never return them.
 */

export type OutboxNotice =
  | { kind: "stopped"; connectionId: string; name: string; reason: OutboxStopReason }
  | { kind: "failed"; automationId: string }
  | { kind: "stalled" };

export interface OutboxDeps {
  db: Database;
  connections: Pick<FlowConnections, "find" | "fixed">;
  /** The calls of one send, inside the wake's one count (FlowService.automationCallDeps). */
  callDeps: (calls: number) => CallDeps;
  timeZone: () => string;
  lockdown: () => boolean;
  notify: (notice: OutboxNotice) => void;
  clock?: () => number;
  /** A number in [0, 1) for the gap's draw; crypto by default. */
  random?: () => number;
}

/** What an automation asks the queue to send (crm/automations/service.ts, `ctx.send`). */
export interface OutboxInput {
  automationId: string;
  connectionId: string;
  key: string;
  /** The contact's name: the history's line and the name of a contact the Chatwoot doesn't have yet. */
  label: string;
  /** E.164 (+5511987654321). */
  phone: string;
  text: string;
  /** A bulk message waits the credential's bulk gap; a message to one person, the shorter one. */
  bulk: boolean;
  notBefore?: string;
  /** It doesn't go after this (a confirmation after the appointment): it becomes "Não saiu". */
  notAfter?: string;
}

/** An automation asked for something the queue never takes: a bug of its code, never sent. */
export class OutboxRefused extends Error {
  constructor(readonly what: string) {
    super(`outbox: ${what}`);
    this.name = "OutboxRefused";
  }
}

interface Job {
  id: string;
  automation_id: string;
  key: string;
  connection_id: string;
  priority: number;
  bulk: number;
  label: string;
  phone: string | null;
  text: string | null;
  status: OutboxStatus;
  grp: OutboxGroup;
  attempts: number;
  available_at: string;
  expires_at: string | null;
  sending_at: string | null;
  contact_id: number | null;
  conversation_id: number | null;
  message_id: number | null;
  day: string;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

interface Queue {
  connection_id: string;
  next_free_at: string | null;
  stopped_at: string | null;
  stopped_reason: OutboxStopReason | null;
  failed_streak: number;
  last_failed_id: string | null;
  recent_ms: string;
  last_sent_at: string | null;
  stall_told: number;
}

const PHONE = /^\+[1-9]\d{7,14}$/;
const MINUTE = 60_000;
const DAY_MS = 86_400_000;
/** 6 calls at most (find and create the contact, find and create the conversation, look for the last try, send) and the 2 DNS lookups of the host. */
const CALLS_PER_SEND = 8;
const WAITING = `status IN ('queued', 'sending', 'checking')`;
const DUE = `status IN ('queued', 'checking')`;
/** Problems raised before the request left: nothing reached the Chatwoot. */
const BEFORE_REQUEST = new Set(["calls_limit", "dns", "private_address", "blocked", "credential", "kind_not_allowed", "path_not_allowed", "connection_missing"]);

export class Outbox {
  #prunedDay = "";

  constructor(private readonly deps: OutboxDeps) {}

  private get db(): Database {
    return this.deps.db;
  }

  private now(): number {
    return this.deps.clock?.() ?? Date.now();
  }

  private iso(at = this.now()): string {
    return new Date(at).toISOString();
  }

  private dayOf(at: number): string {
    const p = zonedParts(new Date(at), this.deps.timeZone());
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  }

  /** The instant the owner's day begins. */
  private startOf(day: string): string {
    const parts = { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)), hour: 0, minute: 0 };
    return zonedTimeToUtc(parts, this.deps.timeZone())?.toISOString() ?? `${day}T00:00:00.000Z`;
  }

  private paused(): boolean {
    return this.db.one<{ paused_at: string | null }>(`SELECT paused_at FROM zur_outbox_state WHERE id = 1`)?.paused_at != null;
  }

  private count(day: string, column: "queued" | "sent" | "delivered" | "failed" | "skipped", by = 1, ms?: number): void {
    this.db.run(`INSERT INTO zur_outbox_days (day) VALUES (?) ON CONFLICT (day) DO NOTHING`, day);
    if (ms === undefined) this.db.run(`UPDATE zur_outbox_days SET ${column} = max(0, ${column} + ?) WHERE day = ?`, by, day);
    else this.db.run(`UPDATE zur_outbox_days SET ${column} = ${column} + ?, ms_total = ms_total + ?, ms_n = ms_n + 1 WHERE day = ?`, by, ms, day);
  }

  private step(id: string, kind: OutboxStepKind, extra: { attempt?: number; ms?: number; problem?: OutboxProblem } = {}): void {
    this.db.run(`INSERT INTO zur_outbox_steps (outbox_id, at, kind, attempt, ms, problem) VALUES (?, ?, ?, ?, ?, ?)`, id, this.iso(), kind, extra.attempt ?? null, extra.ms ?? null, extra.problem ?? null);
  }

  // ---------- In ----------

  /**
   * Queues one message. "skipped": that key was already there (sent, waiting or ended), so nothing new;
   * "cap": the day's ceiling for all automations together is reached, and it may come back tomorrow.
   */
  enqueue(input: OutboxInput): "queued" | "skipped" | "cap" {
    const text = input.text.trim();
    if (!PHONE.test(input.phone)) throw new OutboxRefused("phone");
    if (text.length === 0 || [...text].length > OUTBOX_LIMITS.text) throw new OutboxRefused("text");
    if (input.key.length === 0 || input.key.length > OUTBOX_LIMITS.key) throw new OutboxRefused("key");
    const label = cleanLabel(input.label);
    if (label.length === 0) throw new OutboxRefused("label");
    const at = this.now();
    const notBefore = input.notBefore ? Date.parse(input.notBefore) : at;
    const notAfter = input.notAfter ? Date.parse(input.notAfter) : null;
    if (Number.isNaN(notBefore) || (notAfter !== null && (Number.isNaN(notAfter) || notAfter <= Math.max(at, notBefore)))) throw new OutboxRefused("window");
    const day = this.dayOf(at);
    if (this.db.one(`SELECT 1 AS hit FROM zur_outbox WHERE automation_id = ? AND key = ?`, input.automationId, input.key)) return "skipped";
    const queued = this.db.one<{ queued: number }>(`SELECT queued FROM zur_outbox_days WHERE day = ?`, day)?.queued ?? 0;
    if (queued >= OUTBOX_LIMITS.perDay) return "cap";
    const priority = (OUTBOX_PRIORITY as readonly string[]).indexOf(input.automationId);
    const id = crypto.randomUUID();
    const when = this.iso(at);
    return this.db.transaction(() => {
      const { rowsWritten } = this.db.run(
        `INSERT OR IGNORE INTO zur_outbox (id, automation_id, key, connection_id, priority, bulk, label, phone, text, status, grp, available_at, expires_at, day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'waiting', ?, ?, ?, ?, ?)`,
        id,
        input.automationId,
        input.key,
        input.connectionId,
        priority < 0 ? OUTBOX_PRIORITY.length : priority,
        input.bulk ? 1 : 0,
        label,
        input.phone,
        text,
        this.iso(notBefore),
        notAfter === null ? null : this.iso(notAfter),
        day,
        when,
        when,
      );
      if (rowsWritten === 0) return "skipped";
      this.count(day, "queued");
      this.step(id, "queued");
      this.db.run(`INSERT INTO zur_outbox_queues (connection_id, updated_at) VALUES (?, ?) ON CONFLICT (connection_id) DO NOTHING`, input.connectionId, when);
      return "queued";
    });
  }

  // ---------- Running ----------

  /** The next time the alarm has work here; none while paused or locked down (nothing would happen). */
  nextDue(): string | null {
    // Nothing waiting (most wakes): one indexed row read, nothing else.
    if (this.deps.lockdown() || !this.anyWaiting() || this.paused()) return null;
    const times: string[] = [];
    for (const queue of this.queues()) {
      if (queue.stopped_at) continue;
      const first = this.db.one<{ at: string | null }>(`SELECT min(available_at) AS at FROM zur_outbox WHERE connection_id = ? AND ${DUE}`, queue.connection_id)?.at;
      if (first) times.push(queue.next_free_at && queue.next_free_at > first ? queue.next_free_at : first);
    }
    const orphan = this.db.one<{ at: string | null }>(`SELECT min(sending_at) AS at FROM zur_outbox WHERE status = 'sending'`)?.at;
    if (orphan) times.push(this.iso(Date.parse(orphan) + OUTBOX_LIMITS.orphanMinutes * MINUTE));
    const expiry = this.db.one<{ at: string | null }>(`SELECT min(expires_at) AS at FROM zur_outbox WHERE ${DUE} AND expires_at IS NOT NULL`)?.at;
    if (expiry) times.push(expiry);
    return times.sort()[0] ?? null;
  }

  private anyWaiting(): boolean {
    return this.db.one(`SELECT 1 AS hit FROM zur_outbox WHERE ${WAITING} LIMIT 1`) !== null;
  }

  private queues(): Queue[] {
    return this.db.all<Queue>(`SELECT * FROM zur_outbox_queues LIMIT ?`, 50);
  }

  /** On the shared alarm, after the automations: at most one message out per wake. True when something moved. */
  async tick(): Promise<boolean> {
    if (this.deps.lockdown()) return false;
    this.prune();
    if (!this.anyWaiting() || this.paused()) return false;
    const now = this.now();
    let changed = false;
    // An object that stopped mid-call: the message may have left, so it is checked before any new try.
    for (const { id } of this.db.all<{ id: string }>(`SELECT id FROM zur_outbox WHERE status = 'sending' AND sending_at < ? LIMIT ?`, this.iso(now - OUTBOX_LIMITS.orphanMinutes * MINUTE), 20)) {
      if (this.db.run(`UPDATE zur_outbox SET status = 'checking', updated_at = ? WHERE id = ? AND status = 'sending'`, this.iso(now), id).rowsWritten > 0) {
        this.step(id, "uncertain", { problem: "other" });
        changed = true;
      }
    }
    // Past its hour: never late, it becomes "Não saiu".
    for (const { id } of this.db.all<{ id: string }>(`SELECT id FROM zur_outbox WHERE ${DUE} AND expires_at IS NOT NULL AND expires_at <= ? LIMIT ?`, this.iso(now), 50)) {
      changed = this.end(id, "expired") || changed;
    }
    this.stalls(now);
    for (const queue of this.queues()) {
      if (queue.stopped_at || (queue.next_free_at && queue.next_free_at > this.iso(now))) continue;
      const job = this.db.one<Job>(
        `SELECT * FROM zur_outbox WHERE connection_id = ? AND ${DUE} AND available_at <= ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY priority, available_at LIMIT 1`,
        queue.connection_id,
        this.iso(now),
        this.iso(now),
      );
      if (!job) continue;
      await this.send(queue, job);
      return true;
    }
    return changed;
  }

  /** A due message waiting 15 minutes with nothing going out: one notice, until the next message leaves. */
  private stalls(now: number): void {
    const limit = this.iso(now - OUTBOX_LIMITS.stallMinutes * MINUTE);
    for (const queue of this.queues()) {
      if (queue.stopped_at || queue.stall_told === 1 || (queue.last_sent_at && queue.last_sent_at > limit)) continue;
      const late = this.db.one(`SELECT 1 AS hit FROM zur_outbox WHERE connection_id = ? AND ${DUE} AND available_at <= ? AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`, queue.connection_id, limit, this.iso(now));
      if (!late) continue;
      if (this.db.run(`UPDATE zur_outbox_queues SET stall_told = 1 WHERE connection_id = ? AND stall_told = 0`, queue.connection_id).rowsWritten > 0) {
        this.deps.notify({ kind: "stalled" });
      }
    }
  }

  private gapMs(row: ConnectionRow, bulk: boolean, slow: boolean): number {
    const { bulkGap, oneGap } = chatwootSettings(row);
    const gap = bulk ? bulkGap : oneGap;
    const random = this.deps.random?.() ?? crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
    const seconds = gap.min + Math.floor(random * (gap.max - gap.min + 1));
    return seconds * 1000 * (slow ? 2 : 1);
  }

  private async send(queue: Queue, job: Job): Promise<void> {
    const row = this.deps.connections.find(job.connection_id);
    if (!row || knownKind(row.kind) !== "chatwoot") {
      this.stop(queue.connection_id, row?.name ?? "", "credential");
      return;
    }
    const at = this.now();
    const recent = parseMs(queue.recent_ms);
    const slow = isSlow(recent);
    // The reservation: only if the next free time is still the one read. Two wakes at once: one wins.
    const reserved = this.db.run(
      `UPDATE zur_outbox_queues SET next_free_at = ?, updated_at = ? WHERE connection_id = ? AND next_free_at IS ? AND stopped_at IS NULL`,
      this.iso(at + this.gapMs(row, job.bulk === 1, slow)),
      this.iso(at),
      queue.connection_id,
      queue.next_free_at,
    );
    if (reserved.rowsWritten === 0) return;
    const checking = job.status === "checking";
    const taken = this.db.run(`UPDATE zur_outbox SET status = 'sending', attempts = attempts + ?, sending_at = ?, updated_at = ? WHERE id = ? AND status = ?`, checking ? 0 : 1, this.iso(at), this.iso(at), job.id, job.status);
    if (taken.rowsWritten === 0) return;
    let attempt = checking ? job.attempts : job.attempts + 1;
    const deps = this.deps.callDeps(CALLS_PER_SEND);
    let posting = false;
    let started = at;
    try {
      if (!job.phone || !job.text) throw new OutboxRefused("gone");
      let contactId = job.contact_id;
      if (contactId === null) {
        const found = await chatwootFindContact(this.deps.connections as FlowConnections, row, deps, job.phone);
        if (found?.blocked) {
          this.end(job.id, "blocked");
          return;
        }
        contactId = found?.id ?? (await chatwootCreateContact(this.deps.connections as FlowConnections, row, deps, { name: job.label, e164: job.phone }));
        this.db.run(`UPDATE zur_outbox SET contact_id = ? WHERE id = ?`, contactId, job.id);
      }
      let conversationId = job.conversation_id;
      if (conversationId === null) {
        conversationId = await chatwootConversation(this.deps.connections as FlowConnections, row, deps, contactId);
        this.db.run(`UPDATE zur_outbox SET conversation_id = ? WHERE id = ?`, conversationId, job.id);
      }
      if (checking) {
        // It may have left on the last try: look before sending again.
        const found = await chatwootFindSent(this.deps.connections as FlowConnections, row, deps, conversationId, job.text, Date.parse(job.sending_at ?? job.created_at));
        if (found !== null) {
          this.sent(job, found, null, "found_sent");
          return;
        }
        if (attempt >= OUTBOX_LIMITS.attempts) {
          this.giveUp(job.id, job.automation_id, attempt);
          return;
        }
        // Not there: sending it now is a new try.
        attempt++;
        this.db.run(`UPDATE zur_outbox SET attempts = ? WHERE id = ?`, attempt, job.id);
      }
      posting = true;
      started = this.now();
      const messageId = await chatwootSend(this.deps.connections as FlowConnections, row, deps, conversationId, job.text);
      this.sent(job, messageId, Math.max(0, this.now() - started), "sent");
    } catch (error) {
      this.failed(queue, row, job, attempt, posting, error, posting ? Math.max(0, this.now() - started) : null);
    }
  }

  private sent(job: Job, messageId: number, ms: number | null, kind: "sent" | "found_sent"): void {
    const at = this.now();
    this.db.transaction(() => {
      this.db.run(
        `UPDATE zur_outbox SET status = 'sent', grp = 'sent', message_id = ?, phone = NULL, text = NULL, sending_at = NULL, done_at = ?, updated_at = ? WHERE id = ?`,
        messageId,
        this.iso(at),
        this.iso(at),
        job.id,
      );
      this.step(job.id, kind, ms === null ? {} : { ms });
      this.count(this.dayOf(at), "sent", 1, ms ?? undefined);
      const queue = this.db.one<Queue>(`SELECT * FROM zur_outbox_queues WHERE connection_id = ?`, job.connection_id);
      const recent = ms === null ? parseMs(queue?.recent_ms ?? "[]") : [...parseMs(queue?.recent_ms ?? "[]"), ms].slice(-OUTBOX_LIMITS.slowWindow);
      this.db.run(
        `UPDATE zur_outbox_queues SET failed_streak = 0, last_failed_id = NULL, recent_ms = ?, last_sent_at = ?, stall_told = 0, updated_at = ? WHERE connection_id = ?`,
        JSON.stringify(recent),
        this.iso(at),
        this.iso(at),
        job.connection_id,
      );
    });
  }

  private failed(queue: Queue, row: ConnectionRow, job: Job, attempt: number, posting: boolean, error: unknown, ms: number | null): void {
    const at = this.now();
    const problem = problemOf(error);
    const beforeRequest = error instanceof FlowStepError && BEFORE_REQUEST.has(error.problem);
    const refused = error instanceof FlowStepError && error.problem === "http_error" && error.httpStatus !== null && error.httpStatus < 500;
    // Did it maybe leave? Only a POST of the message that didn't come back with a clear "no".
    const uncertain = posting && !beforeRequest && !refused;
    // The wake's share ran out before the request: nothing happened, it waits as it was.
    if ((error instanceof FlowStepError && error.problem === "calls_limit") || (error instanceof Error && error.message === "budget")) {
      this.db.run(`UPDATE zur_outbox SET status = ?, attempts = ?, updated_at = ? WHERE id = ? AND status = 'sending'`, job.status, job.attempts, this.iso(at), job.id);
      return;
    }
    const stop: OutboxStopReason | null = problem === "credential" ? "credential" : problem === "bad_answer" ? "bad_answer" : null;
    if (stop) {
      // Not the message's fault: the try doesn't count, and the message waits for "Retomar envios".
      this.db.run(`UPDATE zur_outbox SET status = ?, attempts = ?, updated_at = ? WHERE id = ? AND status = 'sending'`, uncertain ? "checking" : job.status, job.attempts, this.iso(at), job.id);
      this.step(job.id, uncertain ? "uncertain" : "failed_try", { attempt, problem, ...(ms === null ? {} : { ms }) });
      this.stop(queue.connection_id, row.name, stop);
      return;
    }
    if (attempt >= OUTBOX_LIMITS.attempts && !uncertain) {
      this.step(job.id, "failed_try", { attempt, problem, ...(ms === null ? {} : { ms }) });
      this.giveUp(job.id, job.automation_id, attempt);
    } else {
      const wait = OUTBOX_LIMITS.retryMinutes[Math.min(attempt, OUTBOX_LIMITS.retryMinutes.length) - 1] ?? OUTBOX_LIMITS.retryMinutes.at(-1) ?? 4;
      this.db.run(
        `UPDATE zur_outbox SET status = ?, available_at = ?, updated_at = ? WHERE id = ? AND status = 'sending'`,
        uncertain ? "checking" : "queued",
        this.iso(at + wait * MINUTE),
        this.iso(at),
        job.id,
      );
      this.step(job.id, uncertain ? "uncertain" : "failed_try", { attempt, problem, ...(ms === null ? {} : { ms }) });
    }
    // The breaker counts different messages failing in a row, not the tries of one.
    const current = this.db.one<Queue>(`SELECT * FROM zur_outbox_queues WHERE connection_id = ?`, queue.connection_id);
    if (!current || current.last_failed_id === job.id) return;
    const streak = current.failed_streak + 1;
    this.db.run(`UPDATE zur_outbox_queues SET failed_streak = ?, last_failed_id = ?, updated_at = ? WHERE connection_id = ?`, streak, job.id, this.iso(at), queue.connection_id);
    if (streak >= 2) this.stop(queue.connection_id, row.name, "failures");
  }

  private giveUp(id: string, automationId: string, attempt: number): void {
    if (this.end(id, "failed", attempt)) this.deps.notify({ kind: "failed", automationId });
  }

  /** The end of a message that didn't go: failed (keeps its text a few days, for "Tentar de novo"), expired or blocked. */
  private end(id: string, status: "failed" | "expired" | "blocked", attempt?: number): boolean {
    const at = this.iso();
    const grp = status === "failed" ? "failed" : "skipped";
    const keep = status === "failed";
    const { rowsWritten } = this.db.run(
      `UPDATE zur_outbox SET status = ?, grp = ?, ${keep ? "" : "phone = NULL, text = NULL, "}sending_at = NULL, done_at = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'sending', 'checking')`,
      status,
      grp,
      at,
      at,
      id,
    );
    if (rowsWritten === 0) return false;
    this.step(id, status === "failed" ? "gave_up" : status, attempt === undefined ? {} : { attempt });
    this.count(this.dayOf(this.now()), grp);
    return true;
  }

  private stop(connectionId: string, name: string, reason: OutboxStopReason): void {
    const at = this.iso();
    this.db.run(`INSERT INTO zur_outbox_queues (connection_id, updated_at) VALUES (?, ?) ON CONFLICT (connection_id) DO NOTHING`, connectionId, at);
    const { rowsWritten } = this.db.run(`UPDATE zur_outbox_queues SET stopped_at = ?, stopped_reason = ?, updated_at = ? WHERE connection_id = ? AND stopped_at IS NULL`, at, reason, at, connectionId);
    if (rowsWritten > 0) this.deps.notify({ kind: "stopped", connectionId, name, reason });
  }

  // ---------- The owner ----------

  /** "Pausar envios": nothing goes until "Retomar envios". */
  pause(): void {
    const { rowsWritten } = this.db.run(`UPDATE zur_outbox_state SET paused_at = ? WHERE id = 1 AND paused_at IS NULL`, this.iso());
    if (rowsWritten > 0) recordActivity(this.db, "crm.outbox_paused");
  }

  /** Whether resuming takes the password: a queue stopped by its breaker (a failure, not the owner's pause). */
  stopped(): boolean {
    return this.db.one(`SELECT 1 AS hit FROM zur_outbox_queues WHERE stopped_at IS NOT NULL LIMIT 1`) !== null;
  }

  /**
   * "Retomar envios": the pause and every stop end. The first message still waits the smallest bulk gap,
   * so nothing piled up goes out at once; what lost its hour meanwhile becomes "Não saiu" on the next wake.
   */
  resume(): void {
    const at = this.now();
    const wasStopped = this.stopped();
    this.db.transaction(() => {
      this.db.run(`UPDATE zur_outbox_state SET paused_at = NULL WHERE id = 1 AND paused_at IS NOT NULL`);
      for (const queue of this.queues()) {
        const row = this.deps.connections.find(queue.connection_id);
        const first = this.iso(at + (row ? chatwootSettings(row).bulkGap.min : 0) * 1000);
        this.db.run(
          `UPDATE zur_outbox_queues SET stopped_at = NULL, stopped_reason = NULL, failed_streak = 0, last_failed_id = NULL, stall_told = 0, next_free_at = ?, updated_at = ? WHERE connection_id = ?`,
          queue.next_free_at && queue.next_free_at > first ? queue.next_free_at : first,
          this.iso(at),
          queue.connection_id,
        );
      }
    });
    recordActivity(this.db, "crm.outbox_resumed", wasStopped ? { stopped: true } : {});
  }

  /** "Tentar de novo" on a failed one: back in the queue with the same key, in turn, the credential's gap apart. */
  retry(id: string): void {
    const job = this.db.one<Job>(`SELECT * FROM zur_outbox WHERE id = ?`, id);
    if (!job) throw new AppError("NOT_FOUND", "error.outboxNotFound");
    if (!this.canRetry(job)) throw new AppError("CONFLICT", "error.outboxNoRetry");
    const at = this.iso();
    const { rowsWritten } = this.db.run(
      `UPDATE zur_outbox SET status = 'queued', grp = 'waiting', attempts = 0, available_at = ?, done_at = NULL, updated_at = ? WHERE id = ? AND status = 'failed'`,
      at,
      at,
      id,
    );
    if (rowsWritten === 0) throw new AppError("CONFLICT", "error.outboxNoRetry");
    this.count(this.dayOf(Date.parse(job.done_at ?? job.created_at)), "failed", -1);
    this.step(id, "retried");
    recordActivity(this.db, "crm.outbox_retried", { automation: job.automation_id });
  }

  private canRetry(job: Job): boolean {
    return job.status === "failed" && job.text !== null && job.phone !== null && (job.expires_at === null || job.expires_at > this.iso());
  }

  // ---------- Reading ----------

  private waitingCount(): number {
    return this.db.one<{ n: number }>(`SELECT count(*) AS n FROM (SELECT 1 FROM zur_outbox WHERE ${WAITING} LIMIT 1000)`)?.n ?? 0;
  }

  status(): OutboxStatusInfo {
    const lockdown = this.deps.lockdown();
    const pausedAt = this.db.one<{ paused_at: string | null }>(`SELECT paused_at FROM zur_outbox_state WHERE id = 1`)?.paused_at ?? null;
    const queues = this.queues();
    const shown = queues.find((queue) => queue.stopped_at) ?? queues[0] ?? null;
    const row = shown ? this.deps.connections.find(shown.connection_id) : null;
    const recent = parseMs(shown?.recent_ms ?? "[]");
    const averageMs = recent.length > 0 ? Math.round(recent.reduce((sum, ms) => sum + ms, 0) / recent.length) : null;
    const state: OutboxState = pausedAt || lockdown ? "paused" : shown?.stopped_at ? "stopped" : isSlow(recent) ? "slow" : "running";
    const free = new Map(queues.map((queue) => [queue.connection_id, queue.next_free_at]));
    const waiting = this.db
      .all<{ id: string; label: string; automation_id: string; available_at: string; connection_id: string; priority: number }>(
        `SELECT id, label, automation_id, available_at, connection_id, priority FROM zur_outbox WHERE ${WAITING} ORDER BY available_at LIMIT ?`,
        OUTBOX_LIMITS.waitingShown,
      )
      .sort((a, b) => a.priority - b.priority || a.available_at.localeCompare(b.available_at))
      .map((item) => {
        const next = free.get(item.connection_id);
        return { id: item.id, label: item.label, automationId: item.automation_id, at: next && next > item.available_at ? next : item.available_at };
      });
    const lastAt = queues.reduce<string | null>((last, queue) => (queue.last_sent_at && (!last || queue.last_sent_at > last) ? queue.last_sent_at : last), null);
    const settings = row && knownKind(row.kind) === "chatwoot" ? chatwootSettings(row) : null;
    return {
      state,
      lockdown,
      stopReason: state === "stopped" ? (shown?.stopped_reason ?? "failures") : null,
      since: state === "paused" ? (pausedAt ?? null) : state === "stopped" ? (shown?.stopped_at ?? null) : null,
      lastAt,
      nextAt: state === "running" || state === "slow" ? (waiting.map((item) => item.at).sort()[0] ?? null) : null,
      waiting: this.waitingCount(),
      averageMs,
      connection: row && settings ? { id: row.id, name: row.name, bulkGap: settings.bulkGap } : null,
      queue: waiting,
    };
  }

  list(input: { period: OutboxPeriod; filter: OutboxFilter; cursor?: string | undefined }): OutboxList {
    const today = this.dayOf(this.now());
    const back = input.period === "today" ? 0 : input.period === "7d" ? 6 : 29;
    const firstDay = this.dayOf(this.now() - back * DAY_MS);
    const from = this.startOf(firstDay);
    const params: (string | number)[] = [from];
    let where = `created_at >= ?`;
    if (input.filter !== "all") {
      where = `grp = ? AND ${where}`;
      params.unshift(input.filter);
    }
    if (input.cursor) {
      const [at, id] = input.cursor.split("~") as [string, string];
      where += ` AND (created_at < ? OR (created_at = ? AND id < ?))`;
      params.push(at, at, id);
    }
    const rows = this.db.all<Job>(
      `SELECT id, label, automation_id, status, attempts, created_at, done_at FROM zur_outbox WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
      ...params,
      OUTBOX_LIMITS.page + 1,
    );
    const page = rows.slice(0, OUTBOX_LIMITS.page);
    const last = page.at(-1);
    const sums = this.db.one<{ sent: number | null; delivered: number | null; failed: number | null; skipped: number | null; ms_total: number | null; ms_n: number | null }>(
      `SELECT sum(sent) AS sent, sum(delivered) AS delivered, sum(failed) AS failed, sum(skipped) AS skipped, sum(ms_total) AS ms_total, sum(ms_n) AS ms_n FROM zur_outbox_days WHERE day >= ? AND day <= ?`,
      firstDay,
      today,
    );
    const counts: OutboxCounts = {
      sent: sums?.sent ?? 0,
      delivered: sums?.delivered ?? 0,
      failed: sums?.failed ?? 0,
      skipped: sums?.skipped ?? 0,
      averageMs: sums?.ms_n ? Math.round((sums.ms_total ?? 0) / sums.ms_n) : null,
    };
    return { rows: page.map(present), counts, cursor: rows.length > OUTBOX_LIMITS.page && last ? `${last.created_at}~${last.id}` : null };
  }

  detail(id: string): OutboxDetail {
    const job = this.db.one<Job>(`SELECT * FROM zur_outbox WHERE id = ?`, id);
    if (!job) throw new AppError("NOT_FOUND", "error.outboxNotFound");
    const steps: OutboxStep[] = this.db
      .all<{ at: string; kind: OutboxStepKind; attempt: number | null; ms: number | null; problem: OutboxProblem | null }>(
        `SELECT at, kind, attempt, ms, problem FROM zur_outbox_steps WHERE outbox_id = ? ORDER BY id LIMIT ?`,
        id,
        30,
      )
      .map((step) => ({ at: step.at, kind: step.kind, attempt: step.attempt, ms: step.ms, problem: step.problem }));
    return { ...present(job), steps, canRetry: this.canRetry(job) };
  }

  /** Once a day: rows after 180 days, the days' counts after 400, a failed message's text after 7. */
  private prune(): void {
    const today = this.iso().slice(0, 10);
    if (this.#prunedDay === today) return;
    this.#prunedDay = today;
    const before = (days: number) => this.iso(this.now() - days * DAY_MS);
    // The timeline first, by the rows that go (its index is by row): nothing is left without its row.
    this.db.run(`DELETE FROM zur_outbox_steps WHERE outbox_id IN (SELECT id FROM zur_outbox WHERE created_at < ? AND grp != 'waiting')`, before(OUTBOX_LIMITS.keepDays));
    this.db.run(`DELETE FROM zur_outbox WHERE created_at < ? AND grp != 'waiting'`, before(OUTBOX_LIMITS.keepDays));
    this.db.run(`DELETE FROM zur_outbox_days WHERE day < ?`, before(OUTBOX_LIMITS.daysKeepDays).slice(0, 10));
    this.db.run(`UPDATE zur_outbox SET phone = NULL, text = NULL WHERE grp = 'failed' AND created_at < ? AND text IS NOT NULL`, before(OUTBOX_LIMITS.failedTextDays));
  }
}

function present(job: Pick<Job, "id" | "label" | "automation_id" | "status" | "attempts" | "created_at" | "done_at">): OutboxRow {
  return { id: job.id, at: job.done_at ?? job.created_at, label: job.label, automationId: job.automation_id, status: job.status, attempts: job.attempts };
}

function parseMs(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0).slice(-OUTBOX_LIMITS.slowWindow) : [];
  } catch {
    return [];
  }
}

/** Slow: a full window of answers averaging above the limit. */
function isSlow(recent: number[]): boolean {
  return recent.length >= OUTBOX_LIMITS.slowWindow && recent.reduce((sum, ms) => sum + ms, 0) / recent.length > OUTBOX_LIMITS.slowMs;
}

function problemOf(error: unknown): OutboxProblem {
  if (error instanceof FlowStepError) {
    if (error.problem === "credential" || error.problem === "connection_missing" || error.httpStatus === 401 || error.httpStatus === 403) return "credential";
    if (error.problem === "bad_answer" || error.problem === "not_json") return "bad_answer";
    if (error.problem === "timeout") return "timeout";
    if (error.problem === "http_error") return error.httpStatus !== null && error.httpStatus < 500 ? "refused" : "http";
    return "network";
  }
  return "other";
}

/** A contact's name for the history: one line, no control characters, cut by characters. */
function cleanLabel(value: string): string {
  return [...value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()].slice(0, OUTBOX_LIMITS.label).join("");
}
