import { describe, expect, it } from "vitest";
import { appointmentConfirmation, MAILS_PER_RUN } from "../src/crm/automations/appointment-confirmation.ts";
import { OutboxRefused } from "../src/crm/outbox.ts";
import { type AutomationContext, manifestSchema, optionsFor } from "../src/crm/automations/manifest.ts";
import type { EveItem } from "../src/google/confirm-links.ts";

// E7c3a (plano link-de-confirmacao.md, seção 18): the automation that sends the confirmation on the working eve.

const ITEM: EveItem = { key: "abc:2099-12-14T12:00:00.000Z", label: "Ana Souza", phone: "+5541999990000", text: "Olá, Ana!", notAfter: "2099-12-14T11:00:00.000Z", email: false };

/** One run at a moment of São Paulo (UTC-3), with the eve's list and what went to the outbox. */
async function runAt(utc: string, mode: "rehearsal" | "live" = "live", hour = "07:00") {
  const asked: { day: string; make: boolean }[] = [];
  const sent: Parameters<AutomationContext["send"]>[0][] = [];
  const module = appointmentConfirmation(async (day, make) => {
    asked.push({ day, make });
    return [ITEM];
  });
  const ctx = {
    mode,
    options: { hour },
    day: "2099-12-11",
    timeZone: "America/Sao_Paulo",
    now: Date.parse(utc),
    read: async () => null,
    effect: async () => "done" as const,
    stillOn: () => true,
    send: async (input: Parameters<AutomationContext["send"]>[0]) => {
      sent.push(input);
      return "queued" as const;
    },
  } satisfies AutomationContext;
  await module.run(ctx);
  return { asked, sent };
}

describe("E7c3a: the appointment confirmation automation", () => {
  it("declares a Chatwoot automation on working days, with its hour from 07:00 to 20:00, 30 a day and no AI", () => {
    const { manifest } = appointmentConfirmation(async () => []);
    expect(manifestSchema.parse(manifest)).toEqual(manifest);
    expect(manifest).toMatchObject({
      id: "appointment-confirmation",
      connection: "chatwoot",
      writesToContacts: true,
      calls: [],
      effects: ["message"],
      trigger: { kind: "every", minutes: 30, workingDays: true },
      options: [
        { key: "hour", kind: "time", min: "07:00", max: "20:00", default: "07:00" },
        { key: "mail", kind: "switch", default: 1 },
      ],
      caps: { effectsPerDay: 30, neuronsPerRun: 0 },
    });
  });

  it("sends from the chosen hour until 21:00 (n-1, n, a late alarm, 20:59, 21:00)", async () => {
    expect((await runAt("2099-12-11T09:59:59Z")).asked).toEqual([]);
    expect((await runAt("2099-12-11T10:00:00Z")).asked).toEqual([{ day: "2099-12-11", make: true }]);
    // QA: a run that failed at 07:00, or an alarm a moment late, is made up by the next one.
    expect((await runAt("2099-12-11T10:30:00.100Z")).asked).toHaveLength(1);
    expect((await runAt("2099-12-11T23:59:59Z")).asked).toHaveLength(1);
    expect((await runAt("2099-12-12T00:00:00Z")).asked).toEqual([]);
    expect((await runAt("2099-12-11T16:10:00Z", "live", "13:00")).asked).toHaveLength(1);
  });

  it("live, each one goes to the outbox as a bulk message that doesn't go after the link expires", async () => {
    const { sent } = await runAt("2099-12-11T10:05:00Z");
    expect(sent).toEqual([{ key: ITEM.key, label: "Ana Souza", phone: "+5541999990000", text: "Olá, Ana!", bulk: true, notAfter: ITEM.notAfter }]);
  });

  it("SEC-E7c3a-02: one the outbox refuses doesn't stop the others; any other failure does", async () => {
    const items = [ITEM, { ...ITEM, key: "def:2099-12-14T13:00:00.000Z" }];
    const sent: string[] = [];
    const ctxFor = (failure: Error) =>
      ({
        mode: "live",
        options: { hour: "07:00" },
        day: "2099-12-11",
        timeZone: "America/Sao_Paulo",
        now: Date.parse("2099-12-11T10:05:00Z"),
        read: async () => null,
        effect: async () => "done" as const,
        stillOn: () => true,
        send: async (input: Parameters<AutomationContext["send"]>[0]) => {
          if (input.key === ITEM.key) throw failure;
          sent.push(input.key);
          return "queued" as const;
        },
      }) satisfies AutomationContext;
    const module = appointmentConfirmation(async (_day, _make, max) => {
      expect(max).toBe(30);
      return items;
    });
    await module.run(ctxFor(new OutboxRefused("text")));
    expect(sent).toEqual(["def:2099-12-14T13:00:00.000Z"]);
    await expect(module.run(ctxFor(new Error("boom")))).rejects.toThrow("boom");
  });

  it("E7c3b: the e-mail switch is on by default and passes to the list; live, each e-mail goes, one with only an e-mail skips Chatwoot; a rehearsal sends none", async () => {
    const { manifest } = appointmentConfirmation(async () => []);
    expect(manifest.options).toContainEqual({ key: "mail", kind: "switch", default: 1 });
    expect(optionsFor(manifest.options, {})).toEqual({ hour: "07:00", mail: 1 });
    for (const bad of [2, -1, "1"]) expect(optionsFor(manifest.options, { mail: bad as number })).toEqual({ invalid: "mail" });
    for (const mode of ["live", "rehearsal"] as const) {
      for (const mail of [1, 0]) {
        const asked: boolean[] = [];
        const mailed: string[] = [];
        const sent: string[] = [];
        const items: EveItem[] = [
          {
            ...ITEM,
            email: true,
            mail: async () => {
              mailed.push("both");
              return "sent";
            },
          },
          {
            ...ITEM,
            key: "only:x",
            phone: "",
            email: true,
            mail: async () => {
              mailed.push("only");
              return { problem: "unreachable" };
            },
          },
        ];
        const module = appointmentConfirmation(async (_day, _make, _max, withMail) => {
          asked.push(withMail);
          return items;
        });
        await module.run({
          mode,
          options: { hour: "07:00", mail },
          day: "2099-12-11",
          timeZone: "America/Sao_Paulo",
          now: Date.parse("2099-12-11T10:05:00Z"),
          read: async () => null,
          effect: async () => "done",
          stillOn: () => true,
          send: async (input) => {
            sent.push(input.key);
            return mode === "live" ? "queued" : "would";
          },
        });
        expect(asked, `${mode} ${mail}`).toEqual([mail === 1]);
        expect(sent, `${mode} ${mail}`).toEqual([ITEM.key]);
        expect(mailed, `${mode} ${mail}`).toEqual(mode === "live" && mail === 1 ? ["both", "only"] : []);
      }
    }
  });

  it("E7c3b (P9): at most 10 e-mails a run (n-1, n, n+1), the rest by the next run; Chatwoot still gets every one", async () => {
    for (const count of [9, 10, 11]) {
      const mailed: number[] = [];
      const sent: string[] = [];
      const items: EveItem[] = Array.from({ length: count }, (_, index) => ({
        ...ITEM,
        key: `k${index}:x`,
        email: true,
        mail: async () => {
          mailed.push(index);
          return "sent" as const;
        },
      }));
      await appointmentConfirmation(async () => items).run({
        mode: "live",
        options: { hour: "07:00", mail: 1 },
        day: "2099-12-11",
        timeZone: "America/Sao_Paulo",
        now: Date.parse("2099-12-11T10:05:00Z"),
        read: async () => null,
        effect: async () => "done",
        stillOn: () => true,
        send: async (input) => {
          sent.push(input.key);
          return "queued";
        },
      });
      expect(mailed, String(count)).toHaveLength(Math.min(count, MAILS_PER_RUN));
      expect(sent, String(count)).toHaveLength(count);
    }
    expect(MAILS_PER_RUN).toBe(10);
  });

  it("E7c3b (SEC-E7c3b-01, 02, 04): the first e-mail that doesn't go ends the run's e-mails, one that throws stops nothing else, and a run that was turned off sends no more", async () => {
    const run = async (answers: (() => Promise<"sent" | "already" | { problem: string }>)[], on: () => boolean = () => true) => {
      const mailed: number[] = [];
      const sent: string[] = [];
      const items: EveItem[] = answers.map((answer, index) => ({
        ...ITEM,
        key: `k${index}:x`,
        email: true,
        mail: async () => {
          mailed.push(index);
          return answer();
        },
      }));
      await appointmentConfirmation(async () => items).run({
        mode: "live",
        options: { hour: "07:00", mail: 1 },
        day: "2099-12-11",
        timeZone: "America/Sao_Paulo",
        now: Date.parse("2099-12-11T10:05:00Z"),
        read: async () => null,
        effect: async () => "done",
        stillOn: on,
        send: async (input) => {
          sent.push(input.key);
          return "queued";
        },
      });
      return { mailed, sent };
    };
    const ok = async () => "sent" as const;
    // "already" is no failure: the next one still goes.
    expect((await run([async () => "already" as const, ok])).mailed).toEqual([0, 1]);
    for (const problem of ["budget", "unreachable", "refused", "daily_limit"]) {
      const result = await run([ok, async () => ({ problem }), ok]);
      expect(result.mailed, problem).toEqual([0, 1]);
      // Chatwoot still gets every one.
      expect(result.sent, problem).toHaveLength(3);
    }
    const thrown = await run([
      async () => {
        throw new Error("database");
      },
      ok,
    ]);
    expect(thrown.mailed).toEqual([0]);
    expect(thrown.sent).toHaveLength(2);
    // Turned off (or the lockdown) in the middle of the run: no e-mail after it.
    let checks = 0;
    expect((await run([ok, ok, ok], () => ++checks < 2)).mailed).toEqual([0]);
  });

  it("a rehearsal asks the list without links", async () => {
    expect((await runAt("2099-12-11T10:05:00Z", "rehearsal")).asked).toEqual([{ day: "2099-12-11", make: false }]);
  });
});
