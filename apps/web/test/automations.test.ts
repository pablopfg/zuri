import { describe, expect, it } from "vitest";
import type { Schedule } from "@zuri/shared";
import { createTranslator, type MessageKey, ptBRCore, ptBRSchedule, t } from "../../../packages/shared/i18n/index.ts";
import { DAY_SHORT } from "../src/pages/automations/labels.ts";
import { AUTOMATION_LIMITS, FLOW_LIMITS } from "@zuri/shared";
import { automationAnchor, copyName, describeSchedule, draftOf, emptyDraft, joinList, scheduleOf, stepReady, suggestName, wizardSteps, zoneLabel } from "../src/lib/automations.ts";

const SP = "America/Sao_Paulo";
const pt = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => t("pt-BR", key, params);
const en = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => t("en", key, params);
const iso = (date: Date) => date.toISOString();
const describePt = (schedule: Parameters<typeof describeSchedule>[0]) => describeSchedule(schedule, pt, SP, iso);

describe("how a schedule reads", () => {
  it("names the common weeks and joins the rest in the language", () => {
    expect(describePt({ type: "daily", time: "08:00" })).toBe("Todo dia às 08:00");
    expect(describePt({ type: "weekly", days: [5, 1, 2, 3, 4], time: "07:30" })).toBe("De segunda a sexta às 07:30");
    expect(describePt({ type: "weekly", days: [0, 6], time: "10:00" })).toBe("Sábado e domingo às 10:00");
    expect(describePt({ type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "06:00" })).toBe("Todo dia às 06:00");
    // Monday first, Sunday last, as a calendar reads.
    expect(describePt({ type: "weekly", days: [0, 1, 3], time: "09:00" })).toBe("Segunda, quarta e domingo, às 09:00");
    expect(describePt({ type: "weekly", days: [5], time: "17:00" })).toBe("Sexta, às 17:00");
    expect(describeSchedule({ type: "weekly", days: [1, 3, 5], time: "08:30" }, en, SP, iso)).toBe("Monday, Wednesday and Friday at 08:30");
  });

  it("warns that days 29 to 31 fall back to the month's last day, and words the hours", () => {
    expect(describePt({ type: "monthly", day: 28, time: "18:00" })).toBe("Todo dia 28 às 18:00");
    expect(describePt({ type: "monthly", day: 29, time: "18:00" })).toBe("Todo dia 29 às 18:00 (ou no último dia do mês)");
    expect(describePt({ type: "monthly", day: 31, time: "18:00" })).toContain("último dia");
    expect(describePt({ type: "interval", minutes: 60 })).toBe("A cada hora");
    expect(describePt({ type: "interval", minutes: 180 })).toBe("A cada 3 horas");
  });

  it("shows a one-time moment as the instant it is in the owner's zone", () => {
    expect(describePt({ type: "once", at: "2026-12-24T20:00" })).toBe("Uma vez, em 2026-12-24T23:00:00.000Z");
    // A moment that never happens there (the clock skipped it) still reads, never crashes.
    expect(describeSchedule({ type: "once", at: "2018-11-04T00:30" }, pt, SP, iso)).toMatch(/^Uma vez, em /);
  });

  it("joins lists of one, two and more", () => {
    expect(joinList([], pt)).toBe("");
    expect(joinList(["a"], pt)).toBe("a");
    expect(joinList(["a", "b"], pt)).toBe("a e b");
    expect(joinList(["a", "b", "c"], pt)).toBe("a, b e c");
  });
});

describe("the words of a schedule outside the Automations screen (#297)", () => {
  // What the CRM's flows have loaded for a schedule: the first bundle's texts and the schedule part, without the Automations screen's.
  const texts: Record<string, string> = { ...ptBRCore, ...ptBRSchedule };
  const only = createTranslator<string>({ "pt-BR": texts, en: texts });
  const lean = (key: MessageKey, params?: Record<string, string | number>) => only.t("pt-BR", key, params);

  it("every kind of schedule reads with the schedule part alone", () => {
    const schedules: Schedule[] = [
      { type: "once", at: "2026-12-24T20:00" },
      { type: "daily", time: "08:00" },
      { type: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" },
      { type: "weekly", days: [0, 6], time: "10:00" },
      { type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "06:00" },
      { type: "weekly", days: [2, 4, 6], time: "11:00" },
      { type: "monthly", day: 5, time: "18:00" },
      { type: "monthly", day: 31, time: "18:00" },
      { type: "interval", minutes: 60 },
      { type: "interval", minutes: 180 },
    ];
    for (const schedule of schedules) {
      const text = describeSchedule(schedule, lean, SP, iso);
      expect(text, JSON.stringify(schedule)).toBe(describePt(schedule));
      expect(text, JSON.stringify(schedule)).not.toContain("web.");
    }
  });

  it("the days of the week, short and long, are in the schedule part", () => {
    expect(DAY_SHORT.map((key) => lean(key))).toEqual(["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]);
    expect([0, 1, 2, 3, 4, 5, 6].map((day) => describeSchedule({ type: "weekly", days: [day], time: "08:00" }, lean, SP, iso))).toEqual(
      ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((day) => `${day}, às 08:00`),
    );
  });
});

describe("the form's schedule", () => {
  const now = new Date("2026-10-31T23:30:00Z"); // 20:30 on the 31st in São Paulo

  it("starts with tomorrow in the owner's zone (not UTC's tomorrow) and today's day of the month", () => {
    expect(emptyDraft(SP, now)).toMatchObject({ type: "daily", date: "2026-11-01", time: "09:00", days: [1, 2, 3, 4, 5], day: "31", hours: "2" });
  });

  it("turns the fields into a schedule only when every one is valid", () => {
    const base = emptyDraft(SP, now);
    expect(scheduleOf({ ...base, type: "once", date: "2026-11-02", time: "07:15" })).toEqual({ type: "once", at: "2026-11-02T07:15" });
    expect(scheduleOf({ ...base, type: "once", date: "", time: "07:15" })).toBeNull();
    expect(scheduleOf({ ...base, type: "daily", time: "24:00" })).toBeNull();
    expect(scheduleOf({ ...base, type: "daily", time: "23:59:30" })).toEqual({ type: "daily", time: "23:59" });
    expect(scheduleOf({ ...base, type: "weekly", days: [] })).toBeNull();
    expect(scheduleOf({ ...base, type: "weekly", days: [5, 1, 5, 9], time: "08:00" })).toEqual({ type: "weekly", days: [1, 5], time: "08:00" });
    for (const [day, ok] of [["0", false], ["1", true], ["31", true], ["32", false], ["1.5", false], ["", false]] as const) {
      expect(scheduleOf({ ...base, type: "monthly", day }) !== null, day).toBe(ok);
    }
  });

  it("repeats at least once an hour and at most once a month (n-1, n, n+1)", () => {
    const base = emptyDraft(SP, now);
    expect(scheduleOf({ ...base, type: "interval", hours: "0" })).toBeNull();
    expect(scheduleOf({ ...base, type: "interval", hours: "1" })).toEqual({ type: "interval", minutes: 60 });
    expect(scheduleOf({ ...base, type: "interval", hours: "2" })).toEqual({ type: "interval", minutes: 120 });
    expect(scheduleOf({ ...base, type: "interval", hours: "744" })).toEqual({ type: "interval", minutes: 44_640 });
    expect(scheduleOf({ ...base, type: "interval", hours: "745" })).toBeNull();
    expect(scheduleOf({ ...base, type: "interval", hours: "1.5" })).toBeNull();
    expect(scheduleOf({ ...base, type: "interval", hours: "-1" })).toBeNull();
  });

  it("opens an existing schedule with its own fields and keeps it as it was", () => {
    for (const schedule of [
      { type: "once", at: "2026-12-24T20:00" },
      { type: "daily", time: "08:00" },
      { type: "weekly", days: [0, 6], time: "10:00" },
      { type: "monthly", day: 31, time: "18:00" },
      { type: "interval", minutes: 180 },
    ] satisfies Schedule[]) {
      expect(scheduleOf(draftOf(schedule, SP, now))).toEqual(schedule);
    }
  });

  it("anchors an automation the way the chat links to it", () => {
    expect(automationAnchor("abc")).toBe("automacao-abc");
  });
});

/** The first half of an emoji with its second half cut off. */
const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

describe("the steps of “Criar rotina”", () => {
  const daily: Schedule = { type: "daily", time: "08:00" };

  it("has five steps to create and four to edit: the kind of a routine never changes", () => {
    expect(wizardSteps(false)).toEqual(["kind", "when", "what", "notify", "review"]);
    expect(wizardSteps(true)).toEqual(["when", "what", "notify", "review"]);
  });

  it("lets a step go on only with what it asks for", () => {
    const base = { kind: "reminder", name: "", message: "", schedule: daily } as const;
    // A flow is made in its own editor: the wizard never goes past the first step with it.
    expect(stepReady("kind", { ...base, kind: "flow" })).toBe(false);
    expect(stepReady("kind", base)).toBe(true);
    expect(stepReady("when", { ...base, schedule: null })).toBe(false);
    expect(stepReady("when", base)).toBe(true);
    // A reminder and a routine need their text; the digest's note is optional.
    expect(stepReady("what", base)).toBe(false);
    expect(stepReady("what", { ...base, message: "   " })).toBe(false);
    expect(stepReady("what", { ...base, message: "Tomar o remédio" })).toBe(true);
    expect(stepReady("what", { ...base, kind: "agent_prompt" })).toBe(false);
    expect(stepReady("what", { ...base, kind: "task_digest" })).toBe(true);
    expect(stepReady("notify", base)).toBe(true);
    expect(stepReady("review", { ...base, message: "x" })).toBe(false);
    expect(stepReady("review", { ...base, message: "x", name: " \n" })).toBe(false);
    expect(stepReady("review", { ...base, message: "x", name: "Remédio" })).toBe(true);
    // The last step answers for the earlier ones too: nothing is sent half filled.
    expect(stepReady("review", { ...base, name: "Remédio" })).toBe(false);
    expect(stepReady("review", { ...base, name: "Remédio", message: "x", schedule: null })).toBe(false);
  });

  it("suggests a name: the reminder's first line, the digest's kind, nothing for a routine", () => {
    expect(suggestName("reminder", "  Tomar o remédio\nda pressão", "Resumo das tarefas")).toBe("Tomar o remédio");
    expect(suggestName("task_digest", "Bom dia", "Resumo das tarefas")).toBe("Resumo das tarefas");
    expect(suggestName("agent_prompt", "Veja minhas tarefas", "Resumo das tarefas")).toBe("");
    const long = "a".repeat(AUTOMATION_LIMITS.name + 1);
    expect(suggestName("reminder", long, "")).toHaveLength(AUTOMATION_LIMITS.name);
    expect(suggestName("reminder", "a".repeat(AUTOMATION_LIMITS.name), "")).toHaveLength(AUTOMATION_LIMITS.name);
    // An emoji (two units) across the cut is left out whole, never split into a broken half.
    for (const before of [AUTOMATION_LIMITS.name - 2, AUTOMATION_LIMITS.name - 1, AUTOMATION_LIMITS.name]) {
      const name = suggestName("reminder", `${"a".repeat(before)}💊b`, "");
      expect(name).not.toMatch(LONE_HALF);
      expect(name.length).toBeLessThanOrEqual(AUTOMATION_LIMITS.name);
      expect(name).toBe(before === AUTOMATION_LIMITS.name - 2 ? `${"a".repeat(before)}💊` : "a".repeat(before));
    }
  });

  it("names a copy within the limit of a name", () => {
    expect(copyName("Remédio", (name) => `${name} (cópia)`)).toBe("Remédio (cópia)");
    const full = "b".repeat(AUTOMATION_LIMITS.name);
    const copy = copyName(full, (name) => `${name} (cópia)`);
    expect(copy).toHaveLength(AUTOMATION_LIMITS.name);
    expect(copy.endsWith(" (cópia)")).toBe(true);
    const emoji = copyName(`${"b".repeat(AUTOMATION_LIMITS.name - 9)}💊`, (name) => `${name} (cópia)`);
    expect(emoji).not.toMatch(LONE_HALF);
    expect(emoji).toBe(`${"b".repeat(AUTOMATION_LIMITS.name - 9)} (cópia)`);
  });

  it("names the copy of a flow within the shorter limit of a flow's name (S15)", () => {
    const mark = (name: string) => `${name} (cópia)`;
    // One under the room, exactly the room, one over and a full name: never past the limit.
    for (const length of [FLOW_LIMITS.name - 9, FLOW_LIMITS.name - 8, FLOW_LIMITS.name - 7, FLOW_LIMITS.name]) {
      const copy = copyName("f".repeat(length), mark, FLOW_LIMITS.name);
      expect(copy, String(length)).toHaveLength(Math.min(length + 8, FLOW_LIMITS.name));
      expect(copy.endsWith(" (cópia)"), String(length)).toBe(true);
    }
    expect(copyName(`${"f".repeat(FLOW_LIMITS.name - 9)}💊`, mark, FLOW_LIMITS.name)).not.toMatch(LONE_HALF);
    // The limit of a routine's name is longer: without the flow's own, the server would refuse the copy.
    expect(FLOW_LIMITS.name).toBeLessThan(AUTOMATION_LIMITS.name);
  });

  it("shows the owner's zone as a city and its distance from UTC", () => {
    expect(zoneLabel(SP, new Date("2026-11-12T12:00:00Z"), "pt-BR")).toBe("Sao Paulo (GMT-3)");
    expect(zoneLabel("America/Argentina/Buenos_Aires", new Date("2026-11-12T12:00:00Z"), "pt-BR")).toBe("Buenos Aires (GMT-3)");
    // Daylight saving moves the distance with the date.
    expect(zoneLabel("Europe/Lisbon", new Date("2026-07-01T12:00:00Z"), "pt-BR")).toBe("Lisbon (GMT+1)");
    // The engine writes zero as "GMT" or "GMT+0"; either is right.
    expect(zoneLabel("Europe/Lisbon", new Date("2026-01-01T12:00:00Z"), "pt-BR")).toMatch(/^Lisbon \(GMT(\+0)?\)$/);
    // A zone with no city is its own name.
    expect(zoneLabel("UTC", new Date("2026-01-01T12:00:00Z"), "en")).toMatch(/^UTC \(/);
  });
});
