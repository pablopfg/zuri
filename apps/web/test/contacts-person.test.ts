import type { ContactDetail } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { byLetter, countdown, dayText, dialNumber, emptyGroups, fileLetter, initials, isContactId, isNamed, shownName, siteHref, siteText, whatsappNumber, whatsappOf } from "../src/pages/contacts/person.ts";

const contact = (over: Partial<ContactDetail> = {}): ContactDetail => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: "",
  labels: [],
  phone: null,
  email: null,
  birthday: null,
  given: "",
  middle: "",
  family: "",
  nickname: "",
  phones: [],
  emails: [],
  birthdayFull: null,
  dates: [],
  organization: "",
  jobTitle: "",
  notes: "",
  fields: [],
  addresses: [],
  urls: [],
  relations: [],
  chats: [],
  more: {},
  googleUrl: "https://contacts.google.com/person/c1",
  ...over,
});

describe("a contact with no name at Google", () => {
  it("is told by the e-mail or the phone the server sends in the name's place", () => {
    expect(isNamed({ name: "Ana Souza", phone: "(11) 99999-0001", email: "ana@exemplo.com.br" })).toBe(true);
    expect(isNamed({ name: "(41) 99999-0117", phone: "(41) 99999-0117", email: null })).toBe(false);
    expect(isNamed({ name: "so@exemplo.com.br", phone: "(41) 99999-0117", email: "so@exemplo.com.br" })).toBe(false);
    expect(isNamed({ name: " ", phone: null, email: null })).toBe(false);
    // A nickname alone is a name.
    expect(isNamed({ name: "Bia", phone: null, email: null })).toBe(true);
  });

  it("shows the phone first, then the e-mail", () => {
    expect(shownName({ name: "Ana Souza", phone: "(11) 99999-0001", email: "ana@exemplo.com.br" })).toBe("Ana Souza");
    expect(shownName({ name: "x@exemplo.com.br", phone: "(41) 99999-0117", email: "x@exemplo.com.br" })).toBe("(41) 99999-0117");
    expect(shownName({ name: "so@exemplo.com.br", phone: null, email: "so@exemplo.com.br" })).toBe("so@exemplo.com.br");
    expect(shownName({ name: "", phone: null, email: null })).toBe("");
  });
});

describe("initials and the letter of the list", () => {
  it("takes the first and the last word", () => {
    expect(initials("Bia Martins")).toBe("BM");
    expect(initials("Dra. Helena de Souza Prado")).toBe("DP");
    expect(initials("Mãe")).toBe("M");
    expect(initials("élio")).toBe("É");
    expect(initials("")).toBe("");
    expect(initials("(41) 9")).toBe("49");
  });

  it("files accents under the plain letter and anything else under #", () => {
    expect(fileLetter("Élio")).toBe("E");
    expect(fileLetter(" ana")).toBe("A");
    expect(fileLetter("Çağla")).toBe("C");
    expect(fileLetter("3M do Brasil")).toBe("#");
    expect(fileLetter("")).toBe("#");
    expect(fileLetter("Жанна")).toBe("#");
  });

  it("groups in the order received and leaves # for last, with whoever has no name", () => {
    const person = (name: string, email: string | null = null) => ({ name, phone: null, email });
    const groups = byLetter([person("3M"), person("Ana"), person("Álvaro"), person("Bia"), person("so@exemplo.com.br", "so@exemplo.com.br")]);
    expect(groups.map((g) => [g.letter, g.contacts.length])).toEqual([
      ["A", 2],
      ["B", 1],
      ["#", 2],
    ]);
    expect(byLetter([])).toEqual([]);
  });
});

describe("phone links", () => {
  it("dials digits only, keeping the plus", () => {
    expect(dialNumber("(11) 99999-0001")).toBe("11999990001");
    expect(dialNumber(" +55 11 96666-0005")).toBe("+5511966660005");
    expect(dialNumber("ramal")).toBeNull();
    // An extension written after the number is not dialled with it, and a word with a digit is no number.
    expect(dialNumber("(11) 3333-0001 ramal 12")).toBe("1133330001");
    expect(dialNumber("casa 2")).toBeNull();
    expect(dialNumber("190")).toBe("190");
    expect(dialNumber("")).toBeNull();
  });

  it("opens WhatsApp only for a Brazilian mobile, with or without the country code", () => {
    expect(whatsappNumber("(11) 99999-0001")).toBe("5511999990001");
    expect(whatsappNumber("+55 11 96666-0005")).toBe("5511966660005");
    expect(whatsappNumber("011 99999-0001")).toBe("5511999990001");
    // A landline, a number with eight digits, a foreign one and a short one.
    expect(whatsappNumber("(11) 3333-0001")).toBeNull();
    expect(whatsappNumber("(11) 8999-0001")).toBeNull();
    expect(whatsappNumber("+1 415 555 0100")).toBeNull();
    // A foreign number whose own digits look like a Brazilian mobile is still foreign.
    expect(whatsappNumber("+7 999 123-45-67")).toBeNull();
    expect(whatsappNumber("+49 9131 12345")).toBeNull();
    // Area code 55 (Rio Grande do Sul), with and without the country's 55.
    expect(whatsappNumber("(55) 99999-0001")).toBe("5555999990001");
    expect(whatsappNumber("+55 55 99999-0001")).toBe("5555999990001");
    expect(whatsappNumber("99999-0001")).toBeNull();
    // Ten and twelve digits: one short and one long of the eleven.
    expect(whatsappNumber("1199999000")).toBeNull();
    expect(whatsappNumber("119999900011")).toBeNull();
    // An area code never has a zero.
    expect(whatsappNumber("(10) 99999-0001")).toBeNull();
    expect(whatsappNumber("javascript:alert(1)")).toBeNull();
  });

  it("takes the first number of the contact that is a mobile", () => {
    expect(whatsappOf([{ value: "(11) 3333-0001" }, { value: "(11) 99999-0001" }])).toBe("5511999990001");
    expect(whatsappOf([{ value: "(11) 3333-0001" }])).toBeNull();
    expect(whatsappOf([])).toBeNull();
  });
});

describe("siteHref", () => {
  it("only lets http and https become a link", () => {
    expect(siteHref("https://padaria.exemplo.com.br")).toBe("https://padaria.exemplo.com.br/");
    expect(siteHref("http://exemplo.com.br/a?b=1")).toBe("http://exemplo.com.br/a?b=1");
    for (const hostile of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "//exemplo.com.br", "exemplo.com.br", "", "https://", "https://dono:senha@exemplo.com.br", " javascript:alert(1)"]) {
      expect(siteHref(hostile), hostile).toBeNull();
    }
  });

  it("shows the site without the scheme", () => {
    expect(siteText("https://exemplo.com.br/")).toBe("exemplo.com.br");
    expect(siteText("http://exemplo.com.br/bia")).toBe("exemplo.com.br/bia");
  });
});

describe("emptyGroups", () => {
  it("names every group of a contact that has only a phone", () => {
    expect(emptyGroups(contact({ phones: [{ label: "Celular", value: "(41) 99999-0117" }], labels: ["Consultório"] }))).toEqual([
      "name",
      "emails",
      "addresses",
      "birthday",
      "dates",
      "relations",
      "company",
      "urls",
      "chats",
      "fields",
      "notes",
    ]);
  });

  it("counts a group with any of its parts", () => {
    const full = contact({
      nickname: "Bia",
      phones: [{ label: "", value: "1" }],
      emails: [{ label: "", value: "a@exemplo.com.br" }],
      addresses: [{ label: "", value: "Rua Exemplo, 1" }],
      birthdayFull: "12-02",
      dates: [{ label: "Casamento", date: "03-14" }],
      relations: [{ label: "Marido", value: "João" }],
      jobTitle: "Arquiteta",
      urls: [{ label: "", value: "https://exemplo.com.br" }],
      chats: [{ label: "Telegram", value: "bia" }],
      labels: ["Família"],
      fields: [{ label: "Tamanho", value: "M" }],
      notes: "Prefere mensagem.",
    });
    expect(emptyGroups(full)).toEqual([]);
  });
});

describe("countdown", () => {
  it("counts minutes and seconds, never below zero", () => {
    expect(countdown(252_000)).toBe("4:12");
    expect(countdown(251_001)).toBe("4:12");
    expect(countdown(59_000)).toBe("0:59");
    expect(countdown(1)).toBe("0:01");
    expect(countdown(0)).toBe("0:00");
    expect(countdown(-5_000)).toBe("0:00");
    expect(countdown(3_852_000)).toBe("1:04:12");
  });
});

describe("isContactId", () => {
  it("accepts only the id's own shape", () => {
    expect(isContactId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    expect(isContactId("clientes")).toBe(false);
    expect(isContactId("0f8fad5b-d9cb-469f-a165-70867728950e/../x")).toBe(false);
    expect(isContactId("")).toBe(false);
  });

  it("writes a date in the owner's language, with the year only when Google has one", () => {
    expect(dayText("02-29", "pt-BR")).toBe("29 de fevereiro");
    expect(dayText("1990-12-31", "pt-BR")).toBe("31 de dezembro de 1990");
    expect(dayText("1990-12-31", "en")).toBe("December 31, 1990");
    // What the calendar cannot hold stays as it came, and takes nothing down.
    expect(dayText("999999999-01-01", "pt-BR")).toBe("999999999-01-01");
    expect(dayText("", "pt-BR")).toBe("");
  });

  it("an hour that is no hour counts as due", () => {
    expect(countdown(Number.NaN)).toBe("0:00");
  });

  it("a contact with no name, phone or e-mail shows nothing, and the screen names it", () => {
    expect(shownName(contact())).toBe("");
    expect(isNamed(contact())).toBe(false);
  });
});
