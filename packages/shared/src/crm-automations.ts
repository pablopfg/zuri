// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";
import type { FlowConnectionKind } from "./flows.ts";
import { line, RECORD_ID } from "./productivity.ts";

/**
 * The CRM's automations (PR S18; docs/planos/s18-automacoes-do-crm.md): the
 * n8n workflows written again in Zuri's code, one at a time. Each one is a
 * fixed piece of code with a manifest; the screen only turns it on, picks the
 * credential and the options the manifest allows, and follows the rehearsal.
 * "Módulo" is only the code's word; the screen says "Automação".
 */

/** The order they arrive in, as in the approved prototype (CRM › Automações). */
export const CRM_AUTOMATION_IDS = [
  "review-request",
  "review-link",
  "appointment-confirmation",
  "plan-ready",
  "message-report",
  "chatwoot-mirror",
  "google-posts",
  "birthday",
  "win-back",
  "plan-follow-up",
] as const;
export type CrmAutomationId = (typeof CRM_AUTOMATION_IDS)[number];

/** Off, rehearsing (runs at the real hour but changes nothing outside), on for real, or paused by its breaker. */
export const CRM_AUTOMATION_STATES = ["off", "rehearsal", "live", "paused"] as const;
export type CrmAutomationState = (typeof CRM_AUTOMATION_STATES)[number];

/** `ready`: its code is here. `next`: the first one still on its way. `development`: the ones after it. */
export type CrmAutomationAvailability = "ready" | "next" | "development";

/** Why the breaker paused one: two failures in a row, a credential refused or gone, an answer out of shape. */
export const CRM_AUTOMATION_PAUSES = ["failures", "credential", "bad_answer"] as const;
export type CrmAutomationPause = (typeof CRM_AUTOMATION_PAUSES)[number];

export const CRM_AUTOMATION_LIMITS = {
  /** Rehearsing or on at the same time. */
  active: 10,
  /** Working days in a row checked as matching before "Ligar de verdade" without taking the risk. */
  rehearsalDays: 3,
  /** The reason of a day that differs. */
  note: 280,
  /** A label of an effect on the screen ("Thiago Moura · consulta em 30/10"). */
  label: 120,
  /** An effect's unique key, inside its automation. */
  key: 120,
  /** Rows of the activity panel: runs and effects, newest first. */
  activity: 50,
  /** Days shown for checking, newest first. */
  days: 14,
  runsKeepDays: 90,
  effectsKeepDays: 180,
} as const;

/** An option the manifest lets the owner change: a whole number or a time of day, with its range. */
export type CrmAutomationOption =
  | { key: string; kind: "number"; min: number; max: number; default: number }
  | { key: string; kind: "time"; min: string; max: string; default: string };

export type CrmAutomationOptions = Record<string, number | string>;

export interface CrmAutomation {
  id: CrmAutomationId | string;
  /** 1 for the first to arrive. */
  position: number;
  availability: CrmAutomationAvailability;
  state: CrmAutomationState;
  /** It writes to the owner's contacts (patients): each one takes the owner's "yes" when its code arrives. */
  writesToContacts: boolean;
  /** The kind of credential it calls with, or none. */
  connectionKind: FlowConnectionKind | null;
  connectionId: string | null;
  options: CrmAutomationOptions;
  optionDefs: CrmAutomationOption[];
  pausedReason: CrmAutomationPause | null;
  rehearsalSince: string | null;
  liveSince: string | null;
  /** "Avisar quando chegar". */
  watch: boolean;
  /** Working days in a row checked as matching, the days needed, and whether going live needs no risk taken. */
  rehearsal: { matched: number; required: number; ready: boolean };
}

/** The base every automation stands on, each with its real state on the screen. */
export type CrmAutomationBase = Record<"calendar" | "queue" | "identity", "ready" | "coming">;

export interface CrmAutomationList {
  automations: CrmAutomation[];
  base: CrmAutomationBase;
  limits: { active: number; rehearsalDays: number };
}

export type CrmAutomationVerdict = "match" | "differs";

export interface CrmAutomationDay {
  /** YYYY-MM-DD in the owner's time zone, a working day since the rehearsal began. */
  day: string;
  /** What Zuri would have done that day (rehearsal effects). */
  would: number;
  /** Whether the rehearsal ran that day: only then can the owner check it. */
  ran: boolean;
  verdict: CrmAutomationVerdict | null;
  note: string | null;
}

export interface CrmAutomationEffect {
  /** Its mode and unique key: one line per effect. */
  id: string;
  at: string;
  mode: "rehearsal" | "live";
  status: "would" | "pending" | "done" | "failed";
  label: string;
}

export interface CrmAutomationRun {
  startedAt: string;
  mode: "rehearsal" | "live";
  outcome: "ok" | "failed" | "cap" | "skipped";
  calls: number;
  effects: number;
}

export interface CrmAutomationActivity {
  runs: CrmAutomationRun[];
  effects: CrmAutomationEffect[];
  days: CrmAutomationDay[];
}

const optionValue = /* @__PURE__ */ (() => z.union([z.number().int().min(-1_000_000).max(1_000_000), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]))();

/** The credential and the options; each option is checked again against the manifest's range. */
export const crmAutomationConfigSchema = /* @__PURE__ */ (() =>
  z
    .object({
      connectionId: z.string().regex(RECORD_ID).nullable(),
      options: z.record(z.string().regex(/^[a-z][A-Za-z0-9]{0,31}$/), optionValue).refine((value) => Object.keys(value).length <= 20),
    })
    .strict())();

/** "Salvar e começar o ensaio", "Ligar de verdade" (taking the risk before the days), "Desligar". */
export const crmAutomationModeSchema = /* @__PURE__ */ (() => z.object({ mode: z.enum(["rehearsal", "live", "off"]), acceptRisk: z.boolean().optional() }).strict())();

/** A day of the rehearsal checked by the owner: "Está certo" (match) or "Tem erro" (differs), which says why. */
export const crmAutomationDaySchema = /* @__PURE__ */ (() =>
  z
    .object({ verdict: z.enum(["match", "differs"]), note: line(CRM_AUTOMATION_LIMITS.note).optional() })
    .strict()
    .refine((value) => value.verdict === "match" || (value.note?.length ?? 0) > 0, { path: ["note"] }))();

export const crmAutomationWatchSchema = /* @__PURE__ */ (() => z.object({ watch: z.boolean() }).strict())();

export const CRM_AUTOMATION_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
