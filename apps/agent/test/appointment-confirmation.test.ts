import { describe, expect, it } from "vitest";
import { appointmentConfirmation } from "../src/crm/automations/appointment-confirmation.ts";
import { OutboxRefused } from "../src/crm/outbox.ts";
import { type AutomationContext, manifestSchema } from "../src/crm/automations/manifest.ts";
import type { EveItem } from "../src/google/confirm-links.ts";

// E7c3a (plano link-de-confirmacao.md, seção 18): the automation that sends the confirmation on the working eve.

const ITEM: EveItem = { key: "abc:2099-12-14T12:00:00.000Z", label: "Ana Souza", phone: "+5541999990000", text: "Olá, Ana!", notAfter: "2099-12-14T11:00:00.000Z" };

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
      options: [{ key: "hour", kind: "time", min: "07:00", max: "20:00", default: "07:00" }],
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

  it("a rehearsal asks the list without links", async () => {
    expect((await runAt("2099-12-11T10:05:00Z", "rehearsal")).asked).toEqual([{ day: "2099-12-11", make: false }]);
  });
});
