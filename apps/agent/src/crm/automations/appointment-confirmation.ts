import { zonedParts } from "@zuri/shared";
import { CONFIRM_AUTOMATION, type EveItem } from "../../google/confirm-links.ts";
import { OutboxRefused } from "../outbox.ts";
import type { AutomationModule } from "./manifest.ts";

/** Runs every 30 minutes. */
const EVERY_MINUTES = 30;
/**
 * From the chosen hour until 21:00 every run of the eve sends what is still due: one that failed or a late
 * alarm is made up by the next, an appointment booked during the day still goes, and the queue's key keeps
 * each one to a single message. Nothing goes to a patient later in the evening.
 */
const LAST_HOUR = 21;
/** 30 a day, as the n8n's window guaranteed (P1 of modulos-crm.md). */
const EFFECTS_PER_DAY = 30;

/**
 * "Confirmação de consulta" (E7c3a; docs/planos/link-de-confirmacao.md, section 18): on the working day
 * before, at the hour chosen in CRM › Automações, the message of the WhatsApp button, with the link,
 * goes to whoever still has to confirm, through the outbox (one at a time, the credential's gap apart).
 * The list comes from ConfirmLinks.eve(): never twice for the same start, by any channel. A rehearsal
 * makes no link and only notes who would receive it.
 */
export function appointmentConfirmation(eve: (day: string, make: boolean, max: number) => Promise<EveItem[]>): AutomationModule {
  return {
    manifest: {
      id: CONFIRM_AUTOMATION,
      version: 1,
      effectsVersion: 1,
      trigger: { kind: "every", minutes: EVERY_MINUTES, workingDays: true },
      connection: "chatwoot",
      writesToContacts: true,
      calls: [],
      options: [{ key: "hour", kind: "time", min: "07:00", max: "20:00", default: "07:00" }],
      effects: ["message"],
      // 30 a day, as the n8n's window guaranteed (P1 of modulos-crm.md); no AI.
      caps: { runsPerDay: 48, callsPerRun: 0, effectsPerDay: EFFECTS_PER_DAY, neuronsPerRun: 0 },
    },
    async run(ctx) {
      const [hour, minute] = String(ctx.options.hour).split(":").map(Number) as [number, number];
      const parts = zonedParts(new Date(ctx.now), ctx.timeZone);
      const since = parts.hour * 60 + parts.minute - (hour * 60 + minute);
      if (since < 0 || parts.hour >= LAST_HOUR) return;
      // SEC-E7c3a-06: links only for as many as the day's ceiling lets go.
      for (const item of await eve(ctx.day, ctx.mode === "live", EFFECTS_PER_DAY)) {
        try {
          await ctx.send({ key: item.key, label: item.label, phone: item.phone, text: item.text, bulk: true, notAfter: item.notAfter });
        } catch (error) {
          // SEC-E7c3a-02: one the queue refuses is left to the buttons; the others still go.
          if (!(error instanceof OutboxRefused)) throw error;
        }
      }
    },
  };
}
