import { CRM_AUTOMATION_IDS, type CrmAutomationBase, type FlowConnectionKind } from "@zuri/shared";
import { type AutomationModule, manifestSchema } from "./manifest.ts";

/**
 * The CRM's automations in the order they arrive (PR S18): the approved
 * prototype's list. An entry without a module has no code yet: the screen
 * shows it as on its way, with "Avisar quando chegar". Each module is imported
 * here, statically; nothing is ever loaded from outside. A module that writes
 * to patients enters only with the owner's "yes" for it (decision of 09/11).
 */
export interface CatalogEntry {
  id: string;
  /** What it will write and call with, shown before its code arrives. */
  writesToContacts: boolean;
  connection: FlowConnectionKind | null;
  module: AutomationModule | null;
}

const PLANNED: Record<(typeof CRM_AUTOMATION_IDS)[number], Omit<CatalogEntry, "id" | "module">> = {
  "review-request": { writesToContacts: true, connection: "chatwoot" },
  "review-link": { writesToContacts: false, connection: null },
  "appointment-confirmation": { writesToContacts: true, connection: "chatwoot" },
  "plan-ready": { writesToContacts: true, connection: "chatwoot" },
  "message-report": { writesToContacts: false, connection: null },
  "chatwoot-mirror": { writesToContacts: false, connection: "chatwoot" },
  "google-posts": { writesToContacts: false, connection: null },
  birthday: { writesToContacts: true, connection: "chatwoot" },
  "win-back": { writesToContacts: true, connection: "chatwoot" },
  "plan-follow-up": { writesToContacts: true, connection: "chatwoot" },
};

/** The modules with code, by id. None yet: the review request is the first (S20). */
const MODULES: Partial<Record<string, AutomationModule>> = {};

/** What every automation stands on, with its real state (the queue arrived with S19; the patient's contact comes after it). */
export const AUTOMATION_BASE: CrmAutomationBase = { calendar: "ready", queue: "ready", identity: "coming" };

/** The catalog; `extra` adds modules only the tests and local development register (example.ts). */
export function buildCatalog(extra: readonly AutomationModule[] = []): CatalogEntry[] {
  const entries: CatalogEntry[] = CRM_AUTOMATION_IDS.map((id) => ({ id, ...PLANNED[id], module: MODULES[id] ?? null }));
  for (const module of extra) {
    const at = entries.findIndex((entry) => entry.id === module.manifest.id);
    const entry = { id: module.manifest.id, writesToContacts: module.manifest.writesToContacts, connection: module.manifest.connection, module };
    if (at >= 0) entries[at] = entry;
    else entries.push(entry);
  }
  for (const entry of entries) {
    if (!entry.module) continue;
    // A manifest out of shape or under another id never starts: a wrong one is a bug, found by the tests.
    const manifest = manifestSchema.parse(entry.module.manifest);
    if (manifest.id !== entry.id) throw new Error(`manifest id ${manifest.id} under ${entry.id}`);
  }
  return entries;
}
