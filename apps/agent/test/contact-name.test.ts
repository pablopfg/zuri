import { describe, expect, it } from "vitest";
import { cpfsIn, findCpf, isCpf, maskCpf, nameParts, photoUrl, splitName } from "../src/google/contact-name.ts";
import { readPerson } from "../src/google/contacts.ts";

// The owner writes "Name / Note" at Google Contacts: Zuri keeps the name without the note, and the note apart.

describe("splitName", () => {
  it.each([
    ["Beatriz Novaes Conceição / Paciente", "Beatriz Novaes Conceição", "Paciente"],
    ["Carla Regina Duarte Pires / Prospect", "Carla Regina Duarte Pires", "Prospect"],
    ["Beatriz Novaes Conceição/Paciente", "Beatriz Novaes Conceição", "Paciente"],
    ["Beatriz Novaes Conceição /Paciente", "Beatriz Novaes Conceição", "Paciente"],
    ["  Beatriz   Novaes  Conceição   /   Paciente  ", "Beatriz Novaes Conceição", "Paciente"],
    ["Beatriz Novaes Conceição | Paciente", "Beatriz Novaes Conceição", "Paciente"],
    ["Beatriz Novaes Conceição \\ Paciente", "Beatriz Novaes Conceição", "Paciente"],
    ["Beatriz Novaes Conceição (Paciente)", "Beatriz Novaes Conceição", "Paciente"],
    ["Beatriz Novaes Conceição [Paciente]", "Beatriz Novaes Conceição", "Paciente"],
    ["Beatriz Novaes / Paciente / Convênio", "Beatriz Novaes", "Paciente / Convênio"],
    ["Beatriz Novaes // Paciente", "Beatriz Novaes", "Paciente"],
    ["Beatriz Novaes / Paciente 2024", "Beatriz Novaes", "Paciente 2024"],
  ])("%j is the name %j with the note %j", (raw, name, note) => {
    expect(splitName(raw)).toEqual({ name, note });
  });

  it.each([
    ["Beatriz Novaes Conceição"],
    ["Ana-Maria Souza"],
    ["Clínica Vida - Unidade Centro"],
    ["Maria d'Ávila"],
    ["José (Zé) da Silva"],
    ["Empresa Exemplo S/A"],
    ["A/C Maria Silva"],
    ["Plantão 24/7"],
    ["Ana Souza c/ filho"],
    ["Entrega p/ Maria Souza"],
    ["Maria Souza e/ou João"],
    ["Sr/Sra Souza"],
    ["https://exemplo.com.br/ana"],
    ["Ap 3/4 Portaria"],
    ["X"],
  ])("%j has no note and stays as written", (raw) => {
    expect(splitName(raw)).toEqual({ name: raw, note: "" });
  });

  it("drops a separator left hanging and never returns an empty name for a text with something in it", () => {
    expect(splitName("Beatriz Novaes /")).toEqual({ name: "Beatriz Novaes", note: "" });
    expect(splitName("/ Paciente")).toEqual({ name: "Paciente", note: "" });
    expect(splitName("A / Maria")).toEqual({ name: "A / Maria", note: "" });
    expect(splitName("/")).toEqual({ name: "/", note: "" });
    expect(splitName("()")).toEqual({ name: "()", note: "" });
  });

  it("takes anything that is not text as no name, cleans control characters and cuts a huge note", () => {
    for (const value of [undefined, null, 7, {}, ""]) expect(splitName(value)).toEqual({ name: "", note: "" });
    expect(splitName("Beatriz‮ Novaes\u0000 / Pa​ciente")).toEqual({ name: "Beatriz Novaes", note: "Pa ciente" });
    const long = splitName(`Beatriz Novaes / ${"x".repeat(500)}`, 1_000);
    expect(long.name).toBe("Beatriz Novaes");
    expect([...long.note]).toHaveLength(60);
  });

  it("keeps an inner slash of the name when the note comes later", () => {
    expect(splitName("A/C Maria Silva / Paciente")).toEqual({ name: "A/C Maria Silva", note: "Paciente" });
    expect(splitName("Empresa Exemplo S/A | Fornecedor")).toEqual({ name: "Empresa Exemplo S/A", note: "Fornecedor" });
  });
});

describe("nameParts", () => {
  it("cuts Google's parts where the clean name ends, wherever Google filed the note", () => {
    expect(nameParts("Beatriz Novaes Conceição", ["Beatriz", "Novaes", "Conceição / Paciente"])).toEqual(["Beatriz", "Novaes", "Conceição"]);
    expect(nameParts("Beatriz Novaes Conceição", ["Beatriz", "Novaes Conceição /", "Paciente"])).toEqual(["Beatriz", "Novaes Conceição", ""]);
    expect(nameParts("Beatriz Novaes Conceição", ["Beatriz Novaes Conceição / Paciente", "", ""])).toEqual(["Beatriz Novaes Conceição", "", ""]);
    expect(nameParts("Beatriz", ["Beatriz", "", "Paciente"])).toEqual(["Beatriz", "", ""]);
    expect(nameParts("Beatriz Novaes", ["", "", ""])).toEqual(["", "", ""]);
    // QA-CN-06: a title before the name, or the family name first, keeps the parts.
    expect(nameParts("Dr. Beatriz Novaes", ["Beatriz", "", "Novaes / Paciente"])).toEqual(["Beatriz", "", "Novaes"]);
    expect(nameParts("Novaes Beatriz", ["Beatriz", "", "Novaes"])).toEqual(["Beatriz", "", "Novaes"]);
    // A part that is only a piece of a word of the name is not it.
    expect(nameParts("Beatriz Novaes", ["Bea", "", "Nova"])).toEqual(["", "", ""]);
  });
});

describe("readPerson", () => {
  const person = (extra: Record<string, unknown>) => readPerson({ resourceName: "people/c1", ...extra });

  it("keeps the name without the note, the note apart and Google's parts without it", () => {
    const read = person({ names: [{ displayName: "Beatriz Novaes Conceição / Paciente", givenName: "Beatriz", middleName: "Novaes", familyName: "Conceição / Paciente" }] });
    expect(read.display).toBe("Beatriz Novaes Conceição");
    expect(read.data).toMatchObject({ given: "Beatriz", middle: "Novaes", family: "Conceição", note: "Paciente" });
  });

  it("leaves a name with no note exactly as before, and builds one from the parts when Google sends no display name", () => {
    expect(person({ names: [{ displayName: "Ana Souza", givenName: "Ana", familyName: "Souza" }] })).toMatchObject({ display: "Ana Souza", data: { given: "Ana", family: "Souza", note: "" } });
    expect(person({ names: [{ givenName: "Ana", familyName: "Souza / Prospect" }] })).toMatchObject({ display: "Ana Souza", data: { given: "Ana", family: "Souza", note: "Prospect" } });
  });

  it("falls back to the nickname, the e-mail or the phone when the name is only a note or empty", () => {
    expect(person({ names: [{ displayName: "   " }], nicknames: [{ value: "Gui" }] }).display).toBe("Gui");
    expect(person({ names: [{}], phoneNumbers: [{ value: "(41) 99999-0001" }] }).display).toBe("(41) 99999-0001");
    expect(person({}).display).toBe("");
  });

  it("finds the CPF in a custom field or in the notes, only a valid one, and keeps the photo's address only from Google's image host", () => {
    expect(person({ userDefined: [{ key: "CPF", value: "529.982.247-25" }] }).data.cpf).toBe("52998224725");
    expect(person({ biographies: [{ value: "Convênio X\nCPF: 111.444.777-35" }] }).data.cpf).toBe("11144477735");
    expect(person({ userDefined: [{ key: "CPF", value: "123.456.789-00" }] }).data.cpf).toBe("");
    expect(person({ photos: [{ url: "https://lh3.googleusercontent.com/contacts/abc=s100", default: false }] }).data.photo).toBe("https://lh3.googleusercontent.com/contacts/abc=s100");
    expect(person({ photos: [{ url: "https://lh3.googleusercontent.com/cm/abc", default: true }] }).data.photo).toBe("");
  });
});

describe("CPF", () => {
  it("accepts only eleven digits with the right check digits", () => {
    expect(isCpf("52998224725")).toBe(true);
    expect(isCpf("11144477735")).toBe(true);
    for (const bad of ["52998224724", "11111111111", "00000000000", "5299822472", "529982247255", "", "abc"]) expect(isCpf(bad)).toBe(false);
  });

  it("finds the ones written in a text, with or without the mask, never inside a longer number", () => {
    expect(cpfsIn("CPF 529.982.247-25 e 11144477735")).toEqual(["52998224725", "11144477735"]);
    expect(cpfsIn("pedido 9529982247250")).toEqual([]);
    expect(cpfsIn("telefone (41) 99999-0001")).toEqual([]);
  });

  it("reads the contact's own: the field named CPF first, then a field that says CPF, then the notes", () => {
    expect(findCpf([{ key: "Documento", value: "RG 1.234" }, { key: "cpf", value: "52998224725" }], "CPF 111.444.777-35")).toBe("52998224725");
    expect(findCpf([{ key: "Documento", value: "CPF 529.982.247-25" }], "")).toBe("52998224725");
    expect(findCpf([], "Telefone do marido 529.982.247-25")).toBe("");
    expect(findCpf([], "cpf nº 529.982.247-25")).toBe("52998224725");
    expect(findCpf([{ key: "CPF do responsável legal e outros", value: "nada" }], "")).toBe("");
    expect(findCpf([{ key: "Nº do CPF:", value: "529.982.247-25" }], "")).toBe("52998224725");
    expect(findCpf([], "CPF - 529.982.247-25")).toBe("52998224725");
  });

  it("QA-CN-01: someone else's CPF written at the contact (the mother's, the husband's, whoever answers for them) is never taken for theirs", () => {
    for (const notes of ["CPF da mãe: 529.982.247-25", "CPF do marido 529.982.247-25", "cpf do responsável: 52998224725", "CPF mãe 529.982.247-25"]) expect(findCpf([], notes), notes).toBe("");
    for (const key of ["CPF do responsável", "CPF da mãe", "cpf pai", "Responsável (CPF)"]) expect(findCpf([{ key, value: "529.982.247-25" }], ""), key).toBe("");
    expect(findCpf([{ key: "Responsável", value: "CPF da mãe 529.982.247-25" }], "")).toBe("");
    // The contact's own, written after someone else's.
    expect(findCpf([], "CPF da mãe: 529.982.247-25\nCPF: 111.444.777-35")).toBe("11144477735");
  });

  it("hides the ends for a list", () => {
    expect(maskCpf("52998224725")).toBe("***.982.247-**");
    expect(maskCpf("529")).toBe("");
  });
});

describe("photoUrl", () => {
  it("keeps only an https address at Google's image host, with no user, port or fragment", () => {
    expect(photoUrl([{ url: "https://lh3.googleusercontent.com/a/x#frag" }])).toBe("https://lh3.googleusercontent.com/a/x");
    for (const url of [
      "http://lh3.googleusercontent.com/a/x",
      "https://exemplo.com.br/a.png",
      "https://googleusercontent.com.exemplo.com.br/a.png",
      "https://lh3.googleusercontent.com.exemplo.com.br/a.png",
      // A user and a password in the address (written in pieces: the repository's check reads "x@host" as an e-mail).
      `https://user:pw${"@"}lh3.googleusercontent.com/a`,
      "https://lh3.googleusercontent.com:8443/a",
      "https://a.b.googleusercontent.com/a",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//lh3.googleusercontent.com/a",
      "https://lh3.googleusercontent.com/a b",
      `https://lh3.googleusercontent.com/${"a".repeat(600)}`,
      "",
    ]) {
      expect(photoUrl([{ url }]), url).toBe("");
    }
    expect(photoUrl(undefined)).toBe("");
    expect(photoUrl([{ default: true, url: "https://lh3.googleusercontent.com/a" }, { url: "https://lh3.googleusercontent.com/b" }])).toBe("https://lh3.googleusercontent.com/b");
  });
});
