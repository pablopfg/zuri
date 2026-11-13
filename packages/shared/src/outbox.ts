// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";

/**
 * The outbox (PR S19; docs/planos/s19-envios.md): the only way a message
 * reaches a contact. The CRM's automations only write what to send, with a
 * unique key; the queue sends one at a time per Chatwoot credential, waiting
 * the credential's gap between them, and never sends a key twice. CRM ›
 * Envios follows it. No text and no phone number ever leave in an answer.
 */

export const OUTBOX_LIMITS = {
  /** Tries of one message; the waits before the 2nd and the 3rd, in minutes. */
  attempts: 3,
  retryMinutes: [2, 4],
  /** "Enviando" this long without an end: the object stopped mid-call, the message is checked before any new try. */
  orphanMinutes: 2,
  /** Slow: an average above this over the last calls; the gap then doubles. */
  slowMs: 5_000,
  slowWindow: 5,
  /** A due message waiting this long without anything going out: one notice. */
  stallMinutes: 15,
  /** New messages per day, all automations together (plano dos módulos: teto geral). */
  perDay: 60,
  text: 1_000,
  label: 120,
  key: 120,
  /** History rows per page; waiting rows on the status. */
  page: 50,
  waitingShown: 20,
  keepDays: 180,
  daysKeepDays: 400,
  /** A failed message keeps its text this long, for "Tentar de novo". */
  failedTextDays: 7,
  /** A message without its own last hour waits at most this long, so a stopped queue never keeps a phone forever. */
  maxWaitDays: 7,
} as const;

/** The order messages leave in when several wait: what can't wait goes first (plano dos módulos, passo 7). */
export const OUTBOX_PRIORITY = ["appointment-confirmation", "plan-ready", "birthday", "review-request", "plan-follow-up", "win-back"] as const;

/** A row's life: waiting (queued, being sent, being checked), then one of the ends. */
export const OUTBOX_STATUSES = ["queued", "sending", "checking", "sent", "delivered", "failed", "expired", "blocked", "optout"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** The history's groups: what the screen filters by and counts. */
export type OutboxGroup = "waiting" | "sent" | "failed" | "skipped";

/** Running, slow (the gap doubled), stopped by its breaker, paused by the owner or by the lockdown. */
export type OutboxState = "running" | "slow" | "stopped" | "paused";
export type OutboxStopReason = "failures" | "credential" | "bad_answer";

/** One step of a message's timeline; never its text. */
export type OutboxStepKind = "queued" | "failed_try" | "uncertain" | "found_sent" | "sent" | "gave_up" | "expired" | "blocked" | "retried";
export type OutboxProblem = "timeout" | "network" | "http" | "refused" | "bad_answer" | "credential" | "other";

export interface OutboxWaiting {
  id: string;
  label: string;
  automationId: string;
  /** When it may leave: the later of its own time and the credential's next free time. */
  at: string;
}

export interface OutboxStatusInfo {
  state: OutboxState;
  /** Paused by the lockdown, not by the owner: only leaving the lockdown sends again. */
  lockdown: boolean;
  stopReason: OutboxStopReason | null;
  /** When it stopped or was paused. */
  since: string | null;
  lastAt: string | null;
  nextAt: string | null;
  waiting: number;
  /** Average answer of the last calls, in ms (null before any). */
  averageMs: number | null;
  /** The credential the screen talks about (the first one stopped, or the first one). */
  connection: { id: string; name: string; bulkGap: { min: number; max: number } } | null;
  queue: OutboxWaiting[];
}

export interface OutboxRow {
  id: string;
  at: string;
  label: string;
  automationId: string;
  status: OutboxStatus;
  attempts: number;
}

export interface OutboxCounts {
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
  averageMs: number | null;
}

export interface OutboxList {
  rows: OutboxRow[];
  counts: OutboxCounts;
  /** The next page, or null. */
  cursor: string | null;
}

export interface OutboxStep {
  at: string;
  kind: OutboxStepKind;
  /** Which try (1 to 3), when it was one. */
  attempt: number | null;
  ms: number | null;
  problem: OutboxProblem | null;
}

export interface OutboxDetail extends OutboxRow {
  steps: OutboxStep[];
  /** "Tentar de novo" is possible (failed, still in time, text still kept). */
  canRetry: boolean;
}

export const OUTBOX_PERIODS = ["today", "7d", "30d"] as const;
export type OutboxPeriod = (typeof OUTBOX_PERIODS)[number];
export const OUTBOX_FILTERS = ["all", "sent", "failed", "skipped"] as const;
export type OutboxFilter = (typeof OUTBOX_FILTERS)[number];

/** The history's query: a period, a group and the page's cursor (from the answer, opaque to the screen). */
export const outboxListQuerySchema = /* @__PURE__ */ (() =>
  z
    .object({
      period: z.enum(OUTBOX_PERIODS).default("today"),
      filter: z.enum(OUTBOX_FILTERS).default("all"),
      cursor: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z~[A-Za-z0-9_-]{1,40}$/)
        .optional(),
    })
    .strict())();

/** An outbox row's id, as the routes take it. */
export const OUTBOX_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** What a contact search of the Chatwoot answers (`GET …/contacts/search`); unknown fields are ignored. */
export const chatwootContactsSchema = /* @__PURE__ */ (() =>
  z.object({
    payload: z
      .array(
        z.object({
          id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          phone_number: z.string().max(40).nullable().optional(),
          custom_attributes: z.record(z.string(), z.unknown()).nullable().optional(),
        }),
      )
      .max(1_000),
  }))();

/** A new contact: newer versions answer `payload.contact`, older ones `payload` itself. */
export const chatwootNewContactSchema = /* @__PURE__ */ (() =>
  z.object({
    payload: z.union([
      /* @__PURE__ */ z.object({ contact: z.object({ id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }) }),
      /* @__PURE__ */ z.object({ id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }),
    ]),
  }))();

/** A contact's conversations (`GET …/contacts/{id}/conversations`). */
export const chatwootConversationsSchema = /* @__PURE__ */ (() =>
  z.object({
    payload: z
      .array(z.object({ id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), inbox_id: z.number().int().nullable().optional(), status: z.string().max(20).optional() }))
      .max(1_000),
  }))();

/** Something the Chatwoot created (a conversation, a message): its id is all that's kept. */
export const chatwootCreatedSchema = /* @__PURE__ */ (() => z.object({ id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }))();

/** A conversation's messages (`GET …/conversations/{id}/messages`): outgoing is 1, `created_at` in seconds. */
export const chatwootMessagesSchema = /* @__PURE__ */ (() =>
  z.object({
    payload: z
      .array(
        z.object({
          id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          content: z.string().nullable().optional(),
          message_type: z.union([/* @__PURE__ */ z.number().int(), /* @__PURE__ */ z.string().max(20)]).optional(),
          created_at: z.number().optional(),
        }),
      )
      .max(1_000),
  }))();
