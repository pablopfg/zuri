import { CRM_AUTOMATION_LIMITS, type CrmAutomationOption, FLOW_CONNECTION_KINDS, FLOW_METHODS } from "@zuri/shared";
import { z } from "zod";
import { WAKE_NOTICE_RESERVE, WAKE_SUBREQUESTS } from "../../agent/wake-budget.ts";

/**
 * The manifest every CRM automation declares (PR S18; docs/planos/modulos.md,
 * "O manifesto"). Checked by Zod in the tests and again when the registry is
 * built, so an automation that asks for more than it says never starts.
 */

/** The calls of one run fit the areas' share of a wake, with the 2 DNS lookups of the credential's host. */
export const MAX_CALLS_PER_RUN = WAKE_SUBREQUESTS - WAKE_NOTICE_RESERVE - 2;

const NAME = /^[a-z][A-Za-z0-9]{0,31}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A path written in the code, with `{param}` holes; never a host, a query typed by the screen or `..`. */
const PATH = /^\/(?:[A-Za-z0-9_-]+|\{[a-z][A-Za-z0-9]{0,31}\})(?:\/(?:[A-Za-z0-9_-]+|\{[a-z][A-Za-z0-9]{0,31}\}))*$/;

const optionSchema = z.discriminatedUnion("kind", [
  z
    .object({ key: z.string().regex(NAME), kind: z.literal("number"), min: z.number().int(), max: z.number().int(), default: z.number().int() })
    .strict()
    .refine((value) => value.min <= value.default && value.default <= value.max),
  z
    .object({ key: z.string().regex(NAME), kind: z.literal("time"), min: z.string().regex(TIME), max: z.string().regex(TIME), default: z.string().regex(TIME) })
    .strict()
    .refine((value) => value.min <= value.default && value.default <= value.max),
]);

const callSchema = z
  .object({ name: z.string().regex(NAME), method: z.enum(FLOW_METHODS), path: z.string().max(200).regex(PATH) })
  .strict();

export const manifestSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
    /** The code's version; a change that touches only texts or limits keeps a live automation live. */
    version: z.number().int().min(1),
    /** Moves when what goes out changes: a live automation goes back to rehearsal. */
    effectsVersion: z.number().int().min(1),
    /** Runs every so many minutes on the shared alarm; `workingDays` skips weekends and national holidays. */
    trigger: z.object({ kind: z.literal("every"), minutes: z.number().int().min(15).max(1440), workingDays: z.boolean() }).strict(),
    connection: z.enum(FLOW_CONNECTION_KINDS).nullable(),
    writesToContacts: z.boolean(),
    /** The closed list of calls: GET ones are reads; any other method is only made inside an effect. */
    calls: z.array(callSchema).max(10),
    options: z.array(optionSchema).max(20),
    /** What changes outside (send a message, create a contact): the only things a rehearsal turns into notes. */
    effects: z.array(z.string().regex(NAME)).max(10),
    caps: z
      .object({
        runsPerDay: z.number().int().min(1).max(96),
        callsPerRun: z.number().int().min(0).max(MAX_CALLS_PER_RUN),
        effectsPerDay: z.number().int().min(0).max(60),
        // No automation calls the AI yet: one that does raises this with the daily ceiling (rule P7).
        neuronsPerRun: z.number().int().min(0).max(0),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const names = new Set<string>();
    for (const call of value.calls) {
      if (names.has(call.name)) ctx.addIssue({ code: "custom", path: ["calls"], message: "duplicate call" });
      names.add(call.name);
    }
    if (value.calls.length > 0 && value.connection === null) ctx.addIssue({ code: "custom", path: ["connection"], message: "calls need a connection" });
    if (new Set(value.options.map((option) => option.key)).size !== value.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "duplicate option" });
  });

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestCall = Manifest["calls"][number];

/** What an automation's code sees of the world: reads and effects, through the runtime only. */
export interface AutomationContext {
  mode: "rehearsal" | "live";
  options: Record<string, number | string>;
  /** The owner's day (YYYY-MM-DD) and time zone. */
  day: string;
  timeZone: string;
  now: number;
  /** A GET call of the manifest; anything else is refused. */
  read(call: string, params?: Record<string, string | number>): Promise<unknown>;
  /**
   * An effect: in rehearsal only a note ("would"); live, the key is written as pending, the call is made and
   * the key marked done. The same key never goes out twice: "skipped" when it was already there. The key
   * carries the date or the event's id (an appointment): an effect's row is removed after 180 days.
   */
  effect(input: {
    effect: string;
    key: string;
    label: string;
    call: string;
    params?: Record<string, string | number>;
    body?: unknown;
  }): Promise<"would" | "done" | "skipped">;
}

export interface AutomationModule {
  manifest: Manifest;
  run(ctx: AutomationContext): Promise<void>;
}

/** The option values the screen sent, checked against the manifest's ranges; the defaults fill the rest. */
export function optionsFor(defs: readonly CrmAutomationOption[], input: Record<string, number | string>): Record<string, number | string> | { invalid: string } {
  const out: Record<string, number | string> = {};
  for (const key of Object.keys(input)) if (!defs.some((def) => def.key === key)) return { invalid: key };
  for (const def of defs) {
    const value = input[def.key] ?? def.default;
    if (def.kind === "number") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < def.min || value > def.max) return { invalid: def.key };
    } else if (typeof value !== "string" || !TIME.test(value) || value < def.min || value > def.max) return { invalid: def.key };
    out[def.key] = value;
  }
  return out;
}

/** The longest label an effect keeps: short, one line, no control characters. */
export function cleanLabel(value: string): string {
  return [...value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()].slice(0, CRM_AUTOMATION_LIMITS.label).join("");
}
