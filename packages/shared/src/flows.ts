import type { FlowDraft } from "./crm.ts";
import type { Schedule } from "./schedule.ts";

/**
 * Flows (step 22a, docs/planos/etapa-22a-motor-de-fluxos.md): a trigger and up
 * to 20 steps from a closed catalog, set up only on the screen, run by the
 * object's one alarm. No code step and no free HTTP: a request goes only to a
 * connection the owner registered. The interface uses the types and limits
 * here; the schemas run on the server (flows-schemas.ts, rule P11).
 */

export const FLOW_LIMITS = {
  flows: 20,
  nodes: 20,
  connections: 20,
  /** Sites watched, all monitors together (the specification's 10 addresses). */
  sites: 10,
  siteQuery: 200,
  siteUrl: 500,
  /** The shortest interval until the owner picks another, from 5 minutes (the alarm's own pace) to an hour. */
  minIntervalMinutes: 15,
  minIntervalFloor: 5,
  minIntervalCeiling: 60,
  /** A flow with an AI step: the same floor as the AI routines; the owner picks from half an hour to a day. */
  aiMinIntervalMinutes: 60,
  aiMinIntervalFloor: 30,
  aiMinIntervalCeiling: 1_440,
  /**
   * Scheduled times a day, all the flows turned on together: 20 flows every 15 minutes, the most there
   * could be before the owner set the shortest interval. A shorter interval never costs more than that:
   * what doesn't fit isn't turned on.
   */
  slotsPerDay: 2_000,
  /** External calls of one run, every step and every wake together: the most, and what holds until the owner picks fewer. */
  callsPerRun: 40,
  callsPerRunMin: 5,
  /** Subrequests the flows may make in one wake of the alarm, DNS included; the rest waits a minute. */
  subrequestsPerWake: 20,
  runsPerWake: 3,
  /** Time the flows may take in one wake; a run past it goes on in the next one. */
  wakeMs: 60_000,
  items: 200,
  /** A waiting run's state (its items and position), JSON. */
  stateBytes: 256 * 1024,
  responseBytes: 256 * 1024,
  /** What the monitor reads of a page before it stops reading (nothing of it is kept). */
  monitorBytes: 64 * 1024,
  requestTimeoutMs: 10_000,
  /** Tries of a request that failed for a passing reason, and the waits between them. */
  attempts: 3,
  attemptsMin: 1,
  retryMinutes: [1, 5],
  /** The monitor's own tries before a site counts as down. */
  siteRetryMinutes: [1, 5],
  /** Runs a day, all flows together: the most there is, and what holds until the owner picks fewer. */
  runsPerDay: 500,
  runsPerDayMin: 10,
  /** The flows' share of the day's Neurons: the most, and what holds until the owner picks fewer. */
  neuronsPerDay: 3_000,
  neuronsPerDayMin: 100,
  waitMinutesMax: 30 * 24 * 60,
  noticesPerRun: 10,
  runsKept: 2_000,
  runsPruneBatch: 100,
  runsPage: 30,
  /** Failures in a row that turn a flow off (and tell the owner); the owner picks from 2 to 10. */
  failuresToPause: 5,
  failuresToPauseMin: 2,
  failuresToPauseMax: 10,
  name: 80,
  path: 500,
  fieldPath: 100,
  rules: 10,
  fields: 20,
  value: 500,
  ruleValue: 200,
  title: 120,
  body: 1_000,
  instruction: 2_000,
  aiOutputTokens: 512,
  /** Items an AI step sends to the model; the rest is counted. */
  aiItems: 50,
  connectionPaths: 10,
  connectionPath: 200,
  credential: 4_096,
  headerName: 64,
  /** Calendar steps (step 22c). Events one read gives, at most. */
  calendarEvents: 100,
  /** The read's window: it starts this many days from today (back or ahead) and lasts up to 31 days. */
  calendarStartMin: -30,
  calendarStartMax: 365,
  calendarDays: 31,
  calendarQuery: 100,
  /** Calendars one read covers ("every open one" stops here); each is one Google call, plus a token renewal. */
  calendarsPerRead: 10,
  /** Events one run creates, all its "create event" steps together; more items and none is created. */
  eventsPerRun: 10,
  eventMinutesMin: 5,
  eventMinutesMax: 1_440,
  eventTitle: 200,
  eventKey: 200,
  /** Text of an event that goes into an item (descriptions are cut to it). */
  eventDescription: 500,
  /** Contacts one search gives. */
  contacts: 100,
  contactsQuery: 200,
} as const;

export const FLOW_NODE_TYPES = ["request", "filter", "set", "wait", "notify", "ai", "monitor", "calendar", "calendar_create", "contacts"] as const;
export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

/** DELETE is not offered (step 22a): a flow never erases anything at a service. */
export const FLOW_METHODS = ["GET", "POST", "PUT", "PATCH"] as const;
export type FlowMethod = (typeof FLOW_METHODS)[number];

export const FLOW_FILTER_OPS = ["eq", "neq", "contains", "gt", "lt", "exists", "missing"] as const;
export type FlowFilterOp = (typeof FLOW_FILTER_OPS)[number];

export const FLOW_TRANSFORMS = ["none", "trim", "lower", "upper", "number", "text"] as const;
export type FlowTransform = (typeof FLOW_TRANSFORMS)[number];

export const FLOW_PRIORITIES = ["low", "normal", "high"] as const;
export type FlowPriority = (typeof FLOW_PRIORITIES)[number];

export const FLOW_AUTH_TYPES = ["none", "bearer", "header"] as const;
export type FlowAuthType = (typeof FLOW_AUTH_TYPES)[number];

/**
 * The kinds of credential (PR S17). `http` is what flows call; every other kind
 * is used only by the fixed client written for it in the code (a flow never
 * calls one). A kind added later goes at the end of the list and gets its
 * entry in the server's registry (apps/agent/src/flows/kinds.ts).
 */
export const FLOW_CONNECTION_KINDS = ["http", "chatwoot"] as const;
export type FlowConnectionKind = (typeof FLOW_CONNECTION_KINDS)[number];

/** A wait drawn between two messages, in seconds. */
export interface FlowGap {
  min: number;
  max: number;
}

/**
 * The Chatwoot credential's numbers (decisions of 10/11 and 12/11/2026): the
 * wait between messages of a bulk send and the shorter one before a message to
 * one person, both in seconds and drawn at each send.
 */
export const CHATWOOT_LIMITS = {
  accountMax: 999_999_999,
  bulkGap: { floor: 5, ceiling: 600, min: 30, max: 60 },
  oneGap: { floor: 1, ceiling: 30, min: 2, max: 5 },
  /** Inboxes a test shows, and the length of a name kept. */
  inboxes: 50,
  inboxName: 80,
} as const;

/** The waits a Chatwoot credential may keep: each within its range, "from" up to "to", one person's below the bulk "from". */
export function chatwootGapsProblem(bulk: FlowGap, one: FlowGap): "bulkGap" | "oneGap" | null {
  const inRange = (gap: FlowGap, floor: number, ceiling: number) =>
    Number.isInteger(gap.min) && Number.isInteger(gap.max) && gap.min >= floor && gap.max <= ceiling && gap.min <= gap.max;
  if (!inRange(bulk, CHATWOOT_LIMITS.bulkGap.floor, CHATWOOT_LIMITS.bulkGap.ceiling)) return "bulkGap";
  if (!inRange(one, CHATWOOT_LIMITS.oneGap.floor, CHATWOOT_LIMITS.oneGap.ceiling) || one.max >= bulk.min) return "oneGap";
  return null;
}

/** What a Chatwoot credential keeps besides its address and key. */
export interface ChatwootSettings {
  accountId: number;
  /** The inbox the messages go through, picked after a test; null until then. */
  inboxId: number | null;
  inboxName: string | null;
  bulkGap: FlowGap;
  oneGap: FlowGap;
}

/** An inbox the Chatwoot key sees. `api`: the kind of inbox the messages go through (WhatsApp by API). */
export interface ChatwootInbox {
  id: number;
  name: string;
  api: boolean;
}

/** What "Testar" found: only reads. A refusal says why, in the flows' words. */
export type FlowConnectionTest =
  | { ok: true; ms: number; status: number | null; inboxes: ChatwootInbox[] | null }
  | { ok: false; problem: FlowRunProblem; status: number | null };

export type FlowNode =
  | {
      type: "request";
      connection: string;
      method: FlowMethod;
      /** From the connection's origin; `{{field}}` takes a value of the item, encoded. */
      path: string;
      /** "item": the item goes as the JSON body (not with GET). */
      body: "none" | "item";
      /** One call per item (the loop, within the 40 calls); off: one call for the run. */
      each: boolean;
      /** Where the list of items is in the answer; empty: the answer is one item. */
      itemsPath: string;
    }
  | { type: "filter"; match: "all" | "any"; rules: { field: string; op: FlowFilterOp; value: string }[] }
  | { type: "set"; keep: boolean; fields: { name: string; value: string; transform: FlowTransform }[] }
  | { type: "wait"; minutes: number }
  | { type: "notify"; title: string; body: string; priority: FlowPriority; each: boolean }
  | { type: "ai"; instruction: string; output: string }
  | { type: "monitor"; sites: string[] }
  /**
   * Reads the events of one open calendar ("" = every open one) from `startDays`
   * after today (owner's zone) for `days` days; each event is an item (step 22c).
   */
  | { type: "calendar"; calendar: string; startDays: number; days: number; query: string }
  /**
   * One event per item on a calendar open for writing: no guests, nobody told.
   * `start` filled from the item is "YYYY-MM-DD" (all day), "YYYY-MM-DDTHH:mm"
   * (owner's zone) or an ISO instant. With a `key`, the same key never makes a second event.
   */
  | { type: "calendar_create"; calendar: string; title: string; start: string; minutes: number; description: string; key: string }
  /**
   * Searches Zuri's copy of the Google contacts (no call to Google). `each`: every
   * item gets `contact`, the first one found for its query (or null).
   */
  | { type: "contacts"; query: string; label: string; birthday: "" | "today" | "week"; limit: number; each: boolean };

export type FlowTrigger = { type: "manual" } | { type: "schedule"; schedule: Schedule };

export interface FlowDefinition {
  version: 1;
  trigger: FlowTrigger;
  nodes: FlowNode[];
}

export const FLOW_RUN_STATUSES = ["running", "waiting", "success", "error", "skipped"] as const;
export type FlowRunStatus = (typeof FLOW_RUN_STATUSES)[number];

export const FLOW_RUN_TRIGGERS = ["schedule", "catch_up", "manual"] as const;
export type FlowRunTrigger = (typeof FLOW_RUN_TRIGGERS)[number];

/** Why a run stopped, stable and in English; the interface words it. Never an exception's text. */
export const FLOW_RUN_PROBLEMS = [
  "missed",
  "busy",
  "lockdown",
  "runs_limit",
  "calls_limit",
  "items_limit",
  "too_large",
  "ai_limit",
  "ai_unavailable",
  "connection_missing",
  "method_not_allowed",
  "path_not_allowed",
  "credential",
  "blocked",
  "private_address",
  "dns",
  "redirect",
  "timeout",
  "unavailable",
  "http_error",
  "not_json",
  "interrupted",
  "failed",
  // Step 22c: the Google steps.
  "google_access",
  "calendar_missing",
  "contacts_off",
  "invalid_date",
  "events_limit",
  // The fixed check of an AI step's answer (guardrails, 04/11/2026).
  "ai_check",
  // PR S17: a flow never calls a credential of another kind (a Chatwoot one, say).
  "kind_not_allowed",
  // PR S17: a fixed client (the Chatwoot's) got an answer it doesn't know.
  "bad_answer",
] as const;
export type FlowRunProblem = (typeof FLOW_RUN_PROBLEMS)[number];

export type FlowSiteState = "up" | "down" | "unknown";

export interface FlowSite {
  url: string;
  host: string;
  state: FlowSiteState;
  /** The last HTTP status, or null when nothing answered. */
  status: number | null;
  ms: number | null;
  since: string | null;
  checkedAt: string | null;
}

export interface Flow {
  id: string;
  name: string;
  definition: FlowDefinition;
  enabled: boolean;
  usesAi: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: FlowRunStatus | null;
  lastProblem: FlowRunProblem | null;
  failures: number;
  /** The monitor steps' sites and how each one is. */
  sites: FlowSite[];
  createdAt: string;
  updatedAt: string;
}

export interface FlowConnection {
  id: string;
  kind: FlowConnectionKind;
  name: string;
  origin: string;
  methods: FlowMethod[];
  paths: string[];
  auth: FlowAuthType;
  headerName: string | null;
  /** Whether a credential is kept; the credential itself never leaves the server. */
  hasCredential: boolean;
  /** Its last 4 characters, only for a key of 12 or more; null otherwise. */
  keyEnd: string | null;
  /** The Chatwoot's own settings; null for the other kinds. */
  chatwoot: ChatwootSettings | null;
  /** Names of the flows that call it. */
  usedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FlowRun {
  id: string;
  flowId: string;
  flowName: string;
  trigger: FlowRunTrigger;
  status: FlowRunStatus;
  problem: FlowRunProblem | null;
  /** The step it stopped at (from 1), when it failed or waits. */
  node: number | null;
  /** The HTTP status of a request that failed with one. */
  httpStatus: number | null;
  calls: number;
  items: number;
  neurons: number;
  resumeAt: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface FlowRunPage {
  runs: FlowRun[];
  nextCursor: string | null;
}

/** What the editor offers to the Google steps (step 22c): the calendars open to Zuri and the contacts' labels. */
export interface FlowGoogleInfo {
  connected: boolean;
  calendars: { id: string; name: string; writable: boolean }[];
  /** The copy of the contacts is on. */
  contacts: boolean;
  labels: { id: string; name: string }[];
}

/** What the owner sets for every flow at once (CRM screen). */
export interface FlowSettings {
  /** Failures in a row that turn a flow off. */
  failuresToPause: number;
  /** Runs a day, all flows together. */
  runsPerDay: number;
  /** The shortest interval a flow may be saved or turned on with, in minutes. */
  minIntervalMinutes: number;
  /** The same for a flow with an AI step. */
  aiMinIntervalMinutes: number;
  /** External calls of one run. */
  callsPerRun: number;
  /** Neurons a day, all flows together. */
  neuronsPerDay: number;
  /** Tries of a call that failed for a passing reason (1 is no retry). */
  attempts: number;
}

/** What each field of the flows' settings starts at, and its limits: one table for the schema, the service, the database's CHECKs and the screen. */
export const FLOW_SETTING_RANGES = {
  failuresToPause: { min: FLOW_LIMITS.failuresToPauseMin, max: FLOW_LIMITS.failuresToPauseMax, initial: FLOW_LIMITS.failuresToPause },
  runsPerDay: { min: FLOW_LIMITS.runsPerDayMin, max: FLOW_LIMITS.runsPerDay, initial: FLOW_LIMITS.runsPerDay },
  minIntervalMinutes: { min: FLOW_LIMITS.minIntervalFloor, max: FLOW_LIMITS.minIntervalCeiling, initial: FLOW_LIMITS.minIntervalMinutes },
  aiMinIntervalMinutes: { min: FLOW_LIMITS.aiMinIntervalFloor, max: FLOW_LIMITS.aiMinIntervalCeiling, initial: FLOW_LIMITS.aiMinIntervalMinutes },
  callsPerRun: { min: FLOW_LIMITS.callsPerRunMin, max: FLOW_LIMITS.callsPerRun, initial: FLOW_LIMITS.callsPerRun },
  neuronsPerDay: { min: FLOW_LIMITS.neuronsPerDayMin, max: FLOW_LIMITS.neuronsPerDay, initial: FLOW_LIMITS.neuronsPerDay },
  attempts: { min: FLOW_LIMITS.attemptsMin, max: FLOW_LIMITS.attempts, initial: FLOW_LIMITS.attempts },
} as const satisfies Record<keyof FlowSettings, { min: number; max: number; initial: number }>;

export const FLOW_SETTING_KEYS = Object.keys(FLOW_SETTING_RANGES) as (keyof FlowSettings)[];

/**
 * One count for everything the alarm runs by the clock, so a read of Google every minute (the owner's call
 * of 11/11/2026) never makes the worst day cost more rows than it did. A read of Google weighs 3 and a
 * flow's scheduled time 2: a wake of its own writes about 19 rows, a flow's time about 13 (the budget test).
 * The whole is what there was before: the flows' 2,000 times and the two reads at five minutes each (576).
 */
export const DAY_BUDGET = { units: 5_728, perSync: 3, perFlow: 2 } as const;

/** Scheduled times a day of a read of Google that runs every `minutes`. */
export function syncSlotsPerDay(minutes: number): number {
  return Math.ceil(1_440 / minutes);
}

/** Scheduled times a day a flow takes while on: an interval's share of the day, one for a daily, weekly or monthly time, none by hand. */
export function flowSlotsPerDay(definition: Pick<FlowDefinition, "trigger">): number {
  const { trigger } = definition;
  if (trigger.type !== "schedule") return 0;
  return trigger.schedule.type === "interval" ? Math.ceil(1_440 / trigger.schedule.minutes) : 1;
}

export interface FlowList {
  flows: Flow[];
  settings: FlowSettings;
  connections: FlowConnection[];
  /** `slots`: scheduled times a day of the flows turned on, of `slotsLimit` (FLOW_LIMITS.slotsPerDay, or what the reads of Google leave of DAY_BUDGET). */
  counts: { flows: number; enabled: number; connections: number; sites: number; runsToday: number; neuronsToday: number; slots: number; slotsLimit: number };
  /** False without MCP_CREDENTIAL_KEY: connections can't keep a credential. */
  credentialsAvailable: boolean;
  /** Flows the chat suggested (step 22b), newest first, until saved or dropped. */
  drafts: FlowDraft[];
  google: FlowGoogleInfo;
}

/** True when a step calls the model: the flow then runs at most hourly. */
export function flowUsesAi(definition: Pick<FlowDefinition, "nodes">): boolean {
  return definition.nodes.some((node) => node.type === "ai");
}

/** The host of a site address, for the list and the notices; the address itself when it doesn't parse. */
export function siteHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * A site address the monitor accepts (specification, step 22), normalized; null
 * when it can't be used: not https, a user or password in it, a fragment, a
 * port other than 443, an IP literal, a name with no dot, or a query past 200
 * characters. The server also refuses Zuri's own host and private names.
 */
export function siteUrl(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > FLOW_LIMITS.siteUrl) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port !== "") return null;
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  // The parser turns 2130706433 and 0x7f.1 into dotted IPv4 too.
  if (host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes(".")) return null;
  if (url.search.length > FLOW_LIMITS.siteQuery + 1) return null;
  return url.href;
}
