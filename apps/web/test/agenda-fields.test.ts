import type { AgendaEvent } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { applyChanges, canUndo, reverseChanges } from "../src/lib/agenda-edit.ts";
import {
  dateOf,
  dateText,
  emailFits,
  kindList,
  kindOf,
  maskDate,
  maskPhone,
  maskTime,
  patientBody,
  patientChanges,
  phoneFits,
  phoneText,
  placeOf,
  timeOf,
  typeOf,
} from "../src/lib/agenda-fields.ts";

// The appointment's fields as the owner types them (E5e, docs/planos/agenda-campos-do-agendamento.md).

describe("dates and hours of 24 hours, whatever the device's language", () => {
  it("masks a date and an hour as they are typed", () => {
    expect(["1", "12", "121", "1211", "12112", "12112026", "121120261", "12/11/2026"].map(maskDate)).toEqual([
      "1",
      "12",
      "12/1",
      "12/11",
      "12/11/2",
      "12/11/2026",
      "12/11/2026",
      "12/11/2026",
    ]);
    expect(["1", "14", "143", "1430", "14301", "14:30", "2 pm"].map(maskTime)).toEqual(["1", "14", "14:3", "14:30", "14:30", "14:30", "2"]);
  });

  it("reads only a real day and an hour from 00:00 to 23:59", () => {
    expect(dateOf("12/11/2026")).toBe("2026-11-12");
    expect(dateOf("29/02/2028")).toBe("2028-02-29");
    for (const text of ["29/02/2027", "31/04/2026", "00/11/2026", "12/13/2026", "12/11/26", "12/11/1899", ""]) expect(dateOf(text), text).toBeNull();
    expect(dateText("2026-11-12")).toBe("12/11/2026");
    expect(dateText("")).toBe("");
    expect(["00:00", "23:59", "09:05"].map(timeOf)).toEqual(["00:00", "23:59", "09:05"]);
    for (const text of ["24:00", "23:60", "9:05", "12:3", "2:30 PM"]) expect(timeOf(text), text).toBeNull();
  });
});

describe("the patient's phone and e-mail", () => {
  it("shapes a Brazilian phone, and a +55 pasted in front goes", () => {
    expect(["4", "41", "419", "419999", "4199999", "4133330000", "41999990000", "419999900001"].map((v) => maskPhone(v, "BR"))).toEqual([
      "(4",
      "(41",
      "(41) 9",
      "(41) 9999",
      "(41) 9999-9",
      "(41) 3333-0000",
      "(41) 99999-0000",
      "(41) 99999-0000",
    ]);
    expect(maskPhone("+55 41 99999-0000", "BR")).toBe("(41) 99999-0000");
    expect(maskPhone("", "BR")).toBe("");
  });

  it("shapes a phone of another country in blocks of three, the last with up to four digits", () => {
    expect(maskPhone("1234", "PT")).toBe("1234");
    expect(maskPhone("12345", "PT")).toBe("123 45");
    expect(maskPhone("912345678", "PT")).toBe("912 345 678");
    expect(maskPhone("1234567890123456789", "US")).toBe("123 456 789 012 345");
    expect(phoneText("BR", "41999990000")).toBe("+55 (41) 99999-0000");
    expect(phoneText("PT", "912345678")).toBe("+351 912 345 678");
    expect(phoneText("??", "41999990000")).toBe("+55 (41) 99999-0000");
  });

  it("checks the phone with its country and the e-mail; both may stay empty", () => {
    expect(phoneFits("BR", "")).toBe(true);
    expect(phoneFits("BR", "(41) 99999-0000")).toBe(true);
    expect(phoneFits("BR", "(41) 3333-0000")).toBe(true);
    expect(phoneFits("BR", "(41) 9999-000")).toBe(false);
    expect(phoneFits("PT", "123 45")).toBe(false);
    expect(phoneFits("PT", "123 456")).toBe(true);
    expect(emailFits("")).toBe(true);
    expect(emailFits(" a@exemplo.com.br ")).toBe(true);
    for (const value of ["a", "a@b", "a b@exemplo.com.br", `${"a".repeat(243)}@exemplo.com`]) expect(emailFits(value), value).toBe(false);
    expect(emailFits(`${"a".repeat(242)}@exemplo.com`)).toBe(true);
    // QA-E5e-02: the rule the server keeps (PATIENT_EMAIL), so what the form takes is never refused there.
    expect(emailFits("a@b.c")).toBe(true);
  });

  it("sends the digits, says the field to fix, and changes the phone with its country", () => {
    const form = { country: "BR", phone: "(41) 99999-0000", email: " a@exemplo.com.br ", payment: "unpaid" as const };
    expect(patientBody(form)).toEqual({ country: "BR", phone: "41999990000", email: "a@exemplo.com.br", payment: "unpaid" });
    expect(patientBody({ ...form, phone: "(41) 9" })).toBe("phone");
    expect(patientBody({ ...form, email: "a@" })).toBe("email");
    const before = { country: "BR", phone: "41999990000", email: "a@exemplo.com.br", payment: "unpaid" as const };
    expect(patientChanges(before, before)).toEqual({});
    expect(patientChanges(before, { ...before, payment: "paid" })).toEqual({ payment: "paid" });
    expect(patientChanges(before, { ...before, country: "PT" })).toEqual({ country: "PT", phone: "41999990000" });
    expect(patientChanges(before, { ...before, phone: "", email: "" })).toEqual({ country: "BR", phone: "", email: "" });
  });
});

describe("the type and the place", () => {
  it("writes the type line Kind | Place and reads it back", () => {
    expect(typeOf("Consulta", "Online")).toBe("Consulta | Online");
    expect(typeOf("  Bio | impedância  ", "Consultório")).toBe("Bio impedância | Consultório");
    expect(typeOf("", "Online")).toBe("");
    expect(typeOf("x".repeat(70), "Online")).toBe(`${"x".repeat(60)} | Online`);
    expect(kindOf("Avaliação física | Consultório")).toBe("Avaliação física");
    expect(kindOf("Consulta")).toBe("Consulta");
    expect(kindOf("")).toBe("");
    expect(placeOf("Consulta | Online")).toBe("Online");
    expect(placeOf("Consulta | online ")).toBe("Online");
    expect(placeOf("Consulta | Consultório")).toBe("Consultório");
    expect(placeOf("Consulta")).toBe("Consultório");
  });

  it("lists the fixed kinds first, then the calendar's own, each once", () => {
    expect(kindList(["Consulta | Consultório", "Retorno | Online", "Bioimpedância | Consultório"], "Reunião | Online")).toEqual([
      "Consulta",
      "Retorno",
      "Avaliação física",
      "Bioimpedância",
      "Reunião",
    ]);
    expect(kindList([], "")).toEqual(["Consulta", "Retorno", "Avaliação física"]);
  });
});

describe("a change of the patient's fields on the screen, and its undo", () => {
  const event = {
    id: "e",
    calendarId: "c",
    title: "Helena",
    start: "2026-11-30T17:00:00.000Z",
    end: "2026-11-30T18:00:00.000Z",
    allDay: false,
    location: "",
    description: "Consulta | Online",
    etag: '"1"',
    recurring: false,
    guests: 0,
    colorId: "",
    country: "BR",
    phone: "41999990000",
    payment: "unpaid",
    meet: "https://meet.google.com/abc-defg-hij",
  } satisfies AgendaEvent;
  const zone = "America/Sao_Paulo";
  const { meet: _call, ...noCall } = event;

  it("shows the change at once: a field cleared goes, a call asked for is on its way", () => {
    const next = applyChanges(event, { phone: "", email: "a@exemplo.com.br", payment: "paid", meet: false }, zone);
    expect(next).not.toHaveProperty("phone");
    expect(next).not.toHaveProperty("meet");
    expect(next).toMatchObject({ email: "a@exemplo.com.br", payment: "paid", country: "BR" });
    expect(applyChanges(noCall, { meet: true }, zone).meet).toBe("pending");
    expect(applyChanges(event, { country: "PT" }, zone).country).toBe("PT");
  });

  it("undoes the fields as they were, and never offers to undo taking a call off", () => {
    expect(reverseChanges(event, { phone: "", email: "a@exemplo.com.br", payment: "paid" }, zone)).toEqual({ phone: "41999990000", email: "", payment: "unpaid" });
    expect(reverseChanges(noCall, { meet: true }, zone)).toEqual({ meet: false });
    expect(canUndo(event, { meet: false })).toBe(false);
    expect(canUndo(noCall, { meet: false })).toBe(true);
    expect(canUndo(event, { meet: true, payment: "paid" })).toBe(true);
  });
});
