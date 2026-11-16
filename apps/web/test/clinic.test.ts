import { type AgendaPrefs, DEFAULT_AGENDA_PREFS, type MessageKey, t as translate } from "@zuri/shared";

type Params = Record<string, string | number>;
import { describe, expect, it } from "vitest";
import { clinicPhoneMask, hoursSummary } from "../src/pages/settings/ClinicTab.tsx";

// E6a: Configurações › Consultório's WhatsApp mask and the line of the office hours.

const pt = (key: MessageKey, params?: Params) => translate("pt-BR", key, params);
const en = (key: MessageKey, params?: Params) => translate("en", key, params);

describe("E6a: the team WhatsApp's mask", () => {
  it("shapes a landline and a mobile as they are typed, and stops at 11 digits", () => {
    expect(clinicPhoneMask("")).toBe("");
    expect(clinicPhoneMask("4")).toBe("(4");
    expect(clinicPhoneMask("41")).toBe("(41");
    expect(clinicPhoneMask("413")).toBe("(41) 3");
    expect(clinicPhoneMask("41333300")).toBe("(41) 3333-00");
    expect(clinicPhoneMask("4133330000")).toBe("(41) 3333-0000");
    expect(clinicPhoneMask("41933330000")).toBe("(41) 93333-0000");
    expect(clinicPhoneMask("419333300001")).toBe("(41) 93333-0000");
    // Pasted with its own marks.
    expect(clinicPhoneMask("+55 (41) 3333-0000")).toBe("(41) 3333-0000");
    expect(clinicPhoneMask("+55 41 93333-0000")).toBe("(41) 93333-0000");
    expect(clinicPhoneMask("(41) 3333-0000")).toBe("(41) 3333-0000");
    // QA-E6a-04: 55 is an area code too; a key too many never takes it for the country.
    expect(clinicPhoneMask("(55) 99999-88887")).toBe("(55) 99999-8888");
    expect(clinicPhoneMask("55999998888")).toBe("(55) 99999-8888");
  });
});

describe("E6a: the office hours in one line", () => {
  it("reads a run of days, the hours and the lunch", () => {
    expect(hoursSummary(DEFAULT_AGENDA_PREFS, pt, "pt-BR")).toBe("Segunda a sexta, das 08:00 às 18:00, almoço das 12:00 às 14:00");
    expect(hoursSummary(DEFAULT_AGENDA_PREFS, en, "en")).toBe("Monday to Friday, 08:00 to 18:00, lunch 12:00 to 14:00");
  });

  it("lists days that are no run, says when there is no lunch and when there is no day", () => {
    const prefs = { ...DEFAULT_AGENDA_PREFS, workDays: [1, 3, 5], lunch: null, from: 7, to: 13 };
    expect(hoursSummary(prefs, pt, "pt-BR")).toBe("Segunda, quarta e sexta, das 07:00 às 13:00");
    // Two days in a row are a list, not a run.
    expect(hoursSummary({ ...prefs, workDays: [2, 3] }, pt, "pt-BR")).toBe("Terça e quarta, das 07:00 às 13:00");
    expect(hoursSummary({ ...prefs, workDays: [] }, pt, "pt-BR")).toBe("Nenhum dia de atendimento");
  });

  it("follows the week's start: Sunday to Tuesday is a run when the week starts on Sunday", () => {
    const prefs: AgendaPrefs = { ...DEFAULT_AGENDA_PREFS, weekStart: 0, workDays: [0, 1, 2], lunch: { from: 750, to: 810 } };
    expect(hoursSummary(prefs, pt, "pt-BR")).toBe("Domingo a terça, das 08:00 às 18:00, almoço das 12:30 às 13:30");
    // From Monday, the same days wrap the week: a list.
    expect(hoursSummary({ ...prefs, weekStart: 1 }, pt, "pt-BR")).toBe("Segunda, terça e domingo, das 08:00 às 18:00, almoço das 12:30 às 13:30");
  });
});
