/**
 * The internal CRM (step 22b): the owner's clients with tags, a stage of the
 * funnel, notes, a history and a follow-up, fed by the screen and the chat.
 * No Zod here: the interface imports this file
 * and Zod stays out of its first load (rule P11); the schemas are in
 * crm-schemas.ts.
 *
 * Clients' data may be sensitive (health, under the LGPD): it never goes to a
 * log, reaches the model only inside `<data source="crm">`, and Zuri never
 * sends a client anything (the owner's decision of 02/11/2026).
 */

export const CRM_LIMITS = {
  /** Clients kept; one more is refused (screen and chat alike). */
  clients: 5_000,
  name: 120,
  phone: 32,
  email: 254,
  notes: 4_000,
  /** Tags on one client, and their length. */
  tagsPerClient: 20,
  tag: 40,
  /** Different tags across all clients. */
  distinctTags: 200,
  /** Stages of the funnel. */
  stagesMin: 2,
  stagesMax: 12,
  stage: 40,
  /** The newest history entries kept per client; older ones go. */
  historyPerClient: 100,
  historyText: 500,
  followUpNote: 200,
  /** A client's id in another system: only kept by clients that came from outside (a backup brings it back). */
  ref: 100,
  /** A page of the clients' list. */
  page: 50,
  query: 100,
  /** Follow-up notices per wake of the alarm; the rest go in one notice. */
  followUpsPerWake: 10,
  /** Names in one birthday notice. */
  namesPerNotice: 5,
  /** Results of search_clients and history entries get_client shows. */
  toolResults: 10,
  toolHistory: 10,
  /** Flow drafts the chat may leave, and how long they last. */
  drafts: 5,
  draftMs: 7 * 24 * 3_600_000,
} as const;

/** What fills a client's history. */
export const CRM_HISTORY_KINDS = [
  "created",
  "note",
  "stage",
  "tags",
  "follow_up",
  "message_in",
  "message_out",
  "conversation_opened",
  "conversation_closed",
  "appointment",
] as const;
export type CrmHistoryKind = (typeof CRM_HISTORY_KINDS)[number];

export const CRM_FOLLOW_UP_FILTERS = ["overdue", "today", "week", "any"] as const;
export type CrmFollowUpFilter = (typeof CRM_FOLLOW_UP_FILTERS)[number];

export interface CrmStage {
  id: string;
  name: string;
  /** Clients in this stage now. */
  count: number;
}

export interface CrmFollowUp {
  /** ISO instant. */
  at: string;
  note: string;
}

export interface CrmClientSummary {
  id: string;
  name: string;
  stageId: string;
  tags: string[];
  phone: string | null;
  email: string | null;
  followUp: CrmFollowUp | null;
  /** Who made it. "n8n" only on clients kept from before 11/11/2026, when Zuri still took n8n's events. */
  source: "app" | "n8n";
  lastActivityAt: string | null;
  updatedAt: string;
}

export interface CrmHistoryEntry {
  id: string;
  kind: CrmHistoryKind;
  text: string;
  at: string;
}

export interface CrmClientDetail extends CrmClientSummary {
  ref: string | null;
  /** "MM-DD" or "YYYY-MM-DD". */
  birthday: string | null;
  notes: string;
  history: CrmHistoryEntry[];
  createdAt: string;
}

export interface CrmClientPage {
  clients: CrmClientSummary[];
  /** Cursor of the next page, or null. */
  next: string | null;
}

export interface CrmSummary {
  total: number;
  overdue: number;
  today: number;
  week: number;
  /** Clients made in the last 7 days. */
  newThisWeek: number;
}

export interface CrmSettings {
  /** Notices of follow-ups that come due. */
  followUps: boolean;
  birthdays: boolean;
  /** When the day's birthdays are told, "HH:MM" in the owner's time zone. */
  birthdayTime: string;
}

/** The birthday notice's time until the owner picks another. */
export const CRM_BIRTHDAY_TIME = "09:00";

export interface CrmOverview {
  stages: CrmStage[];
  tags: string[];
  summary: CrmSummary;
  settings: CrmSettings;
  limits: { clients: number };
}

/** A flow the chat suggested (step 22b), waiting for the owner on the Flows tab. */
export interface FlowDraft {
  id: string;
  name: string;
  /** A flow definition, valid when it was saved (flowDefinitionSchema). */
  definition: unknown;
  createdAt: string;
  expiresAt: string;
}

/** "MM-DD" of a birthday ("MM-DD" or "YYYY-MM-DD"), or null. */
export function birthdayMonthDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[1]}-${match[2]}` : null;
}

/** A phone's digits, for searching by any piece of it. */
export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}
