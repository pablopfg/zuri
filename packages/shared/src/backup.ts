// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";
import { AUTOMATION_KINDS, AUTOMATION_LIMITS, AUTOMATION_PRIORITIES, scheduleSchema } from "./automations.ts";
import { CONVERSATION_TITLE_MAX } from "./chat.ts";
import { CRM_HISTORY_KINDS, CRM_LIMITS } from "./crm.ts";
import { birthdaySchema, crmEmailSchema, crmPhoneSchema, crmTagSchema } from "./crm-schemas.ts";
import { instantSchema, isValidCalendarDate } from "./dates.ts";
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
] as const;
export type BackupSetting = (typeof BACKUP_SETTINGS)[number];

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
    settings: z.object({ followUps: z.boolean(), birthdays: z.boolean(), newClients: z.boolean() }).strict().nullable(),
  })
  .strict();

/** Each record's schema: the export runs every row through it, so what it writes always reads back. */
export const backupItemSchemas = { project, task, note, memory, conversation, automation, alertLearning, crmStage, crmClient };

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
