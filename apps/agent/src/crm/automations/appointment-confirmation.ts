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
 * E-mails per run (P9): each is a request to Gmail or to the SMTP server, on top of the calendar's read, and
 * a wake stops before 45. The rest go in the next runs of the day, half an hour apart.
 */
export const MAILS_PER_RUN = 10;

/**
 * "Confirmação de consulta" (E7c3a; docs/planos/link-de-confirmacao.md, section 18): on the working day
 * before, at the hour chosen in CRM › Automações, the message of the WhatsApp button, with the link,
 * goes to whoever still has to confirm, through the outbox (one at a time, the credential's gap apart).
 * The list comes from ConfirmLinks.eve(): never twice for the same start, by any channel. A rehearsal
 * makes no link and only notes who would receive it.
 */
export function appointmentConfirmation(eve: (day: string, make: boolean, max: number, mail: boolean) => Promise<EveItem[]>): AutomationModule {
  return {
    manifest: {
      id: CONFIRM_AUTOMATION,
      version: 2,
      // 2 (E7c3b): the e-mail goes along; a live one goes back to the rehearsal.
      effectsVersion: 2,
      trigger: { kind: "every", minutes: EVERY_MINUTES, workingDays: true },
      connection: "chatwoot",
      writesToContacts: true,
      calls: [],
      // E7c3b: "Também por e-mail, na mesma hora", on as in the prototype.
      options: [
        { key: "hour", kind: "time", min: "07:00", max: "20:00", default: "07:00" },
        { key: "mail", kind: "switch", default: 1 },
      ],
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
      let mails = 0;
      let mailing = ctx.mode === "live" && ctx.options.mail === 1;
      for (const item of await eve(ctx.day, ctx.mode === "live", EFFECTS_PER_DAY, ctx.options.mail === 1)) {
        if (item.phone) {
          try {
            await ctx.send({ key: item.key, label: item.label, phone: item.phone, text: item.text, bulk: true, notAfter: item.notAfter });
          } catch (error) {
            // SEC-E7c3a-02: one the queue refuses is left to the buttons; the others still go.
            if (!(error instanceof OutboxRefused)) throw error;
          }
        }
        // E7c3b: live only, the e-mail at the same time, once per start whoever sent it; a rehearsal sends
        // none. The first one that doesn't go ends the run's e-mails (the way out down, the wake's room spent:
        // each try spends the day's cap) and is tried again by the next run, unless its address was refused.
        if (mailing && item.mail && mails < MAILS_PER_RUN && ctx.stillOn()) {
          mails++;
          const sent = await item.mail().catch(() => ({ problem: "unreachable" }));
          if (sent !== "sent" && sent !== "already") mailing = false;
        }
      }
    },
  };
}
