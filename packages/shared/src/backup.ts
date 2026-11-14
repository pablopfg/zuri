// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";
import { AUTOMATION_KINDS, AUTOMATION_LIMITS, AUTOMATION_PRIORITIES, scheduleSchema } from "./automations.ts";
import { CONVERSATION_TITLE_MAX } from "./chat.ts";
import { CRM_HISTORY_KINDS, CRM_LIMITS } from "./crm.ts";
import { birthdaySchema, crmEmailSchema, crmPhoneSchema, crmTagSchema } from "./crm-schemas.ts";
import { instantSchema, isValidCalendarDate } from "./dates.ts";
import { isCountry, PATIENT_EMAIL } from "./countries.ts";
import { EVENT_PAYMENTS, GOOGLE_LIMITS, MEET_URL, PATIENT_LIMITS } from "./google.ts";
import { MEMORY_AUTHORS, MEMORY_CATEGORIES, MEMORY_CONTENT_MAX, MEMORY_ORIGINS, MEMORY_STATUSES } from "./memory.ts";
import {
  hasControlCharacter,
  line,
  NOTE_CONTENT_MAX,
  NOTE_TITLE_MAX,
  nfc,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  PROJECT_STATUSES,
  RECORD_ID,
  STORAGE_LIMITS,
  type StorageKind,
  TASK_DESCRIPTION_MAX,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TITLE_MAX,
  text,
  wellFormed,
} from "./productivity.ts";
import { settingsSchema } from "./settings.ts";

/**
 * The portable backup (step 23): plain JSON, readable without anything from
 * Cloudflare. A file to import is untrusted input (spec rule 8): every object
 * is strict, so a field this format doesn't know (an MCP server, a switched-on
 * automation, an AI setting) refuses the whole file instead of being ignored.
 * What never goes in is decided by what is listed here: there is no "all
 * columns" anywhere.
 */

export const BACKUP_FORMAT = "zuri-backup";
export const BACKUP_VERSION = 1;
/** The biggest file the import reads (spec rule 8). */
export const BACKUP_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
/** Field paths a refused import names at most. */
export const BACKUP_ERROR_FIELDS_MAX = 20;
/** Messages are written by the assistant too: longer than what the owner may type. */
export const BACKUP_MESSAGE_MAX = 64_000;
/** The import path, the only API route that reads more than a note (gates/body.ts). */
export const BACKUP_IMPORT_PATH = "/api/backup/import";

/**
 * The owner's settings a backup carries and may set again. Left out on
 * purpose: the AI's model and limits and the session limits (cost and how long
 * a stolen session lasts) and which categories Telegram shows in full (privacy).
 */
export const BACKUP_SETTINGS = [
  "language",
  "timeZone",
  "memoryConflictReview",
  "ownerName",
  "digestEnabled",
  "digestTime",
  "watchersEnabled",
  "alertRoutes",
  "alertPerHour",
  "alertPerDay",
  "alertLearning",
  "agenda",
  "sounds",
] as const;
export type BackupSetting = (typeof BACKUP_SETTINGS)[number];

/** The record of the day in a backup: up to 20 years of days, and the 200 events one day's reading takes. */
export const AGENDA_RECORD_DAYS_MAX = 7_300;
export const AGENDA_RECORD_DAY_MAX = 200;

const id = /* @__PURE__ */ z.string().regex(RECORD_ID);
const at = instantSchema;
const optionalAt = /* @__PURE__ */ instantSchema.nullable();
/** A date the owner stated for a memory: "2024", "2024-06" or "2024-06-01". */
const statedDate = /* @__PURE__ */ z
  .string()
  .max(10)
  .refine((value) => {
    const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
    if (!match) return false;
    return isValidCalendarDate(Number(match[1]), Number(match[2] ?? "1"), Number(match[3] ?? "1"));
  })
  .nullable();
/** Text that may be empty but not only a line break: a stored message, a key-like label. */
const plain = (max: number) => text(max);
const short = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !hasControlCharacter(value, true))
    .refine(wellFormed)
    .transform(nfc);

const settings = /* @__PURE__ */ settingsSchema
  .pick(Object.fromEntries(BACKUP_SETTINGS.map((key) => [key, true])) as { [K in BackupSetting]: true })
  .partial()
  .strict();

const project = /* @__PURE__ */ z
  .object({
    id,
    name: line(PROJECT_NAME_MAX),
    description: text(PROJECT_DESCRIPTION_MAX),
    status: z.enum(PROJECT_STATUSES),
    createdAt: at,
    updatedAt: at,
  })
  .strict();

const task = /* @__PURE__ */ z
  .object({
    id,
    title: line(TASK_TITLE_MAX),
    description: text(TASK_DESCRIPTION_MAX),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    dueAt: optionalAt,
    projectId: id.nullable(),
    createdAt: at,
    updatedAt: at,
    completedAt: optionalAt,
  })
  .strict();

const note = /* @__PURE__ */ z
  .object({
    id,
    title: line(NOTE_TITLE_MAX),
    content: text(NOTE_CONTENT_MAX),
    projectId: id.nullable(),
    localOnly: z.boolean(),
    createdAt: at,
    updatedAt: at,
  })
  .strict();

const memoryContent = /* @__PURE__ */ z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_CONTENT_MAX)
  .refine((value) => !hasControlCharacter(value, false))
  .refine(wellFormed)
  .transform(nfc);

const memory = /* @__PURE__ */ z
  .object({
    id,
    content: memoryContent,
    category: z.enum(MEMORY_CATEGORIES),
    origin: z.enum(MEMORY_ORIGINS),
    author: z.enum(MEMORY_AUTHORS),
    status: z.enum(MEMORY_STATUSES),
    supersededBy: id.nullable(),
    validFrom: statedDate,
    validUntil: statedDate,
    localOnly: z.boolean(),
    createdAt: at,
    updatedAt: at,
  })
  .strict();

const message = /* @__PURE__ */ z
  .object({
    role: z.enum(["user", "assistant"]),
    content: plain(BACKUP_MESSAGE_MAX),
    status: z.enum(["complete", "cancelled", "error"]),
    fallback: z.boolean(),
    createdAt: at,
  })
  .strict();

const conversation = /* @__PURE__ */ z
  .object({
    title: line(CONVERSATION_TITLE_MAX),
    createdAt: at,
    updatedAt: at,
    messages: z.array(message).max(STORAGE_LIMITS.messages),
  })
  .strict();

const automation = /* @__PURE__ */ z
  .object({
    name: line(AUTOMATION_LIMITS.name),
    kind: z.enum(AUTOMATION_KINDS),
    message: text(AUTOMATION_LIMITS.message),
    schedule: scheduleSchema,
    sentinel: z.boolean(),
    priority: z.enum(AUTOMATION_PRIORITIES),
    /** Always true: an automation travels paused, and a file that says otherwise was changed by hand. */
    paused: z.literal(true),
    createdAt: at,
  })
  .strict();

const alertLearning = /* @__PURE__ */ z
  .object({
    key: short(200).refine((value) => value.length > 0),
    shift: z.number().int().min(-2).max(2),
    label: short(300),
    changedAt: at,
  })
  .strict();

const crmStage = /* @__PURE__ */ z.object({ id, name: line(CRM_LIMITS.stage) }).strict();

const crmClient = /* @__PURE__ */ z
  .object({
    ref: short(CRM_LIMITS.ref).refine((value) => value.length > 0).nullable(),
    name: line(CRM_LIMITS.name),
    phone: crmPhoneSchema.nullable(),
    email: crmEmailSchema.nullable(),
    birthday: birthdaySchema.nullable(),
    stageId: id,
    notes: text(CRM_LIMITS.notes),
    followUpAt: optionalAt,
    followUpNote: text(CRM_LIMITS.followUpNote),
    source: z.enum(["app", "n8n"]),
    lastActivityAt: optionalAt,
    createdAt: at,
    updatedAt: at,
    tags: z.array(crmTagSchema).max(CRM_LIMITS.tagsPerClient),
    history: z
      .array(z.object({ kind: z.enum(CRM_HISTORY_KINDS), text: text(CRM_LIMITS.historyText), at }).strict())
      .max(CRM_LIMITS.historyPerClient),
  })
  .strict();

const crm = /* @__PURE__ */ z
  .object({
    stages: z.array(crmStage).max(CRM_LIMITS.stagesMax),
    clients: z.array(crmClient).max(CRM_LIMITS.clients),
    // The last two came later (11/11/2026): a backup of before has neither, and the restore keeps what is set.
    settings: z
      .object({
        followUps: z.boolean(),
        birthdays: z.boolean(),
        newClients: z.boolean(),
        birthdayTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/**
 * One closed day of the Agenda's record (13/11/2026): the events as the Zuri
 * copied them at 0:00. A restore never changes a day already closed here.
 */
const isDay = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!match && isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
};
/** An event's time as the Agenda reads it: a real day for an all-day event, an instant for the rest (SEC-E5b-04: a bad one broke the screen). */
const eventTime = (allDay: boolean, value: string) => (allDay ? isDay(value) : /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)));
const agendaDay = /* @__PURE__ */ z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isDay),
    closedAt: at,
    events: z
      .array(
        z
          .object({
            id: short(1024).refine((value) => value.length > 0),
            calendarId: short(1024).refine((value) => value.length > 0),
            title: short(GOOGLE_LIMITS.titleMax),
            start: short(40),
            end: short(40),
            allDay: z.boolean(),
            location: short(GOOGLE_LIMITS.locationMax),
            description: z.string().max(GOOGLE_LIMITS.descriptionMax * 2),
            etag: short(200),
            recurring: z.boolean(),
            guests: z.number().int().min(0).max(100_000),
            colorId: short(2),
            shared: z.boolean(),
            // The patient's fields of an appointment (E5e), as readEvent checks them: the record keeps them.
            country: z.string().refine(isCountry).optional(),
            phone: z.string().regex(/^\d{6,15}$/).optional(),
            email: z.string().max(PATIENT_LIMITS.emailMax).regex(PATIENT_EMAIL).optional(),
            payment: z.enum(EVENT_PAYMENTS).optional(),
            meet: z.string().refine((value) => MEET_URL.test(value) || value === "pending" || value === "failed").optional(),
          })
          .strict()
          .refine((event) => eventTime(event.allDay, event.start) && eventTime(event.allDay, event.end) && event.start <= event.end),
      )
      .max(AGENDA_RECORD_DAY_MAX),
  })
  .strict();

/** Each record's schema: the export runs every row through it, so what it writes always reads back. */
export const backupItemSchemas = { project, task, note, memory, conversation, automation, alertLearning, crmStage, crmClient, agendaDay };

const unique = (items: readonly { id: string }[]) => new Set(items.map((item) => item.id)).size === items.length;

const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max).default([]);

export const backupSchema = /* @__PURE__ */ z
  .object({
    format: z.literal(BACKUP_FORMAT),
    /** The format's version; a newer one is refused with its own message. */
    version: z.number().int().min(1),
    /** The last migration of the database that wrote it: for whoever reads it elsewhere. */
    schema: z.number().int().min(0).max(100_000),
    exportedAt: at,
    data: z
      .object({
        settings: settings.default({}),
        projects: list(project, STORAGE_LIMITS.projects),
        tasks: list(task, STORAGE_LIMITS.tasks),
        notes: list(note, STORAGE_LIMITS.notes),
        memories: list(memory, STORAGE_LIMITS.memories),
        conversations: list(conversation, STORAGE_LIMITS.conversations),
        automations: list(automation, STORAGE_LIMITS.automations),
        alertLearning: list(alertLearning, 500),
        crm: crm.nullable().default(null),
        // Came later (13/11/2026): a backup of before has none.
        agendaRecord: list(agendaDay, AGENDA_RECORD_DAYS_MAX),
      })
      .strict()
      .refine((data) => data.conversations.reduce((sum, item) => sum + item.messages.length, 0) <= STORAGE_LIMITS.messages, {
        message: "too many messages",
        path: ["conversations"],
      })
      // Links inside the file follow these ids: two records with one id would share a new id (and a link).
      .refine((data) => unique(data.projects), { message: "repeated id", path: ["projects"] })
      .refine((data) => unique(data.tasks), { message: "repeated id", path: ["tasks"] })
      .refine((data) => unique(data.notes), { message: "repeated id", path: ["notes"] })
      .refine((data) => unique(data.memories), { message: "repeated id", path: ["memories"] })
      .refine((data) => !data.crm || unique(data.crm.stages), { message: "repeated id", path: ["crm", "stages"] }),
  })
  .strict();

export type Backup = z.infer<typeof backupSchema>;
export type BackupInput = z.input<typeof backupSchema>;

/** What an import added, by kind; `skipped` are clients already here (same n8n ref). */
export interface BackupImportSummary {
  projects: number;
  tasks: number;
  notes: number;
  memories: number;
  conversations: number;
  messages: number;
  automations: number;
  /** AI routines among the automations: they wait for the owner's approval. */
  routinesToApprove: number;
  clients: number;
  clientsSkipped: number;
  settings: number;
}

/** Settings › Data › Storage use: the counters against the limits, and the database's size. */
export const STORAGE_USE_KINDS = [...(Object.keys(STORAGE_LIMITS) as StorageKind[]), "crm_clients"] as const;
export type StorageUseKind = (typeof STORAGE_USE_KINDS)[number];
export interface StorageUse {
  kinds: { kind: StorageUseKind; count: number; limit: number }[];
  bytes: number;
  maxBytes: number;
}

/** The automatic backup (step 23b): copies kept in the bucket, newest first. */
export const BACKUP_COPIES_KEPT = 7;
/** The day's copy starts at this local hour or later. */
export const BACKUP_HOUR = 3;
/** Tries in one day; after them, the next day's copy. */
export const BACKUP_TRIES_PER_DAY = 3;
/** The last download (screen, copy or Telegram) older than this: the bot says so. */
export const BACKUP_STALE_DAYS = 30;
/** Below the Bot API's 50 MB for a file a bot sends, leaving room for the request and the memory of the alarm; above it the month's message goes without the file. */
export const BACKUP_TELEGRAM_MAX_BYTES = 40 * 1000 * 1000;
/** A copy's name in the API: its local day and 8 random hex digits, nothing about the owner. */
export const BACKUP_COPY_NAME = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/;

/** The public key the browser made (raw P-256, base64url) and its short id. */
export const backupKeyInputSchema = /* @__PURE__ */ z
  .object({
    key: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    publicKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  })
  .strict();
export type BackupKeyInput = z.infer<typeof backupKeyInputSchema>;

/** Settings › Data › Automatic backup. */
export interface BackupAutoStatus {
  /** The installation has the bucket (BACKUP_BUCKET); without it nothing runs. */
  available: boolean;
  key: { id: string; createdAt: string } | null;
  /** The copies in the bucket, newest first; empty when it couldn't be read. */
  copies: { name: string; size: number; at: string }[];
  /** The bucket couldn't be listed this time: an empty `copies` says nothing. */
  listFailed: boolean;
  last: { at: string; size: number } | null;
  /** The last failed try, while no copy has worked since. */
  failure: { at: string } | null;
  nextAt: string | null;
  /** The last backup the owner took out (the file, a copy or Telegram's). */
  downloadedAt: string | null;
}
