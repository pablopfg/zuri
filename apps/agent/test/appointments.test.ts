import { describe, expect, it } from "vitest";
import { carries, contactAppointments, kindOf, plainLines, readAppointment, readType, titleNames } from "../src/google/appointments.ts";
import type { ContactIdentity, ContactProof } from "../src/google/contacts.ts";
import { type GoogleCalendar, GoogleError, GoogleMeter } from "../src/google/service.ts";

// The card's "last appointment" and "return": the scheduling system writes the person's full name as the
// event's title and the type in the description ("Consulta | Consultório").

const ZONE = "America/Sao_Paulo";
const NOW = Date.parse("2026-11-11T15:00:00Z"); // 12:00 in São Paulo
const nobody: ContactProof = { phones: [], emails: [], cpf: "", birthday: "" };
const beatriz = (over: Partial<ContactIdentity> = {}): ContactIdentity => ({ name: "Beatriz Novaes Conceição", proof: nobody, others: [], ...over });
const event = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  status: "confirmed",
  summary: "Beatriz Novaes Conceição",
  description: "Consulta | Consultório",
  start: { dateTime: "2026-11-01T10:00:00-03:00" },
  end: { dateTime: "2026-11-01T11:00:00-03:00" },
  ...over,
});

describe("readType", () => {
  it.each([
    ["Consulta | Consultório", "Consulta", "Consultório"],
    ["Retorno | Consultório", "Retorno", "Consultório"],
    ["  retorno|online  ", "retorno", "online"],
    ["Tipo: Consulta | Consultório", "Consulta", "Consultório"],
    ["Paciente novo\nRetorno | Consultório\nObs: jejum", "Retorno", "Consultório"],
    ["<b>Consulta | Consultório</b><br>Convênio X", "Consulta", "Consultório"],
    ["<p>Convênio</p><p>Retorno&nbsp;|&nbsp;Consultório</p>", "Retorno", "Consultório"],
    ["Consulta | Consultório | Sala 2", "Consulta", "Consultório"],
    ["Consulta |", "Consulta", ""],
    ["Retorno", "Retorno", ""],
    ["consulta de rotina", "Consulta", ""],
    // QA-CN-09: another line with a "|" before the type's own line.
    ["Obs: ligar antes | urgente\nRetorno | Consultório", "Retorno", "Consultório"],
    ["https://exemplo.com.br/a|b\nConsulta | Online", "Consulta", "Online"],
    ["Exame | Laboratório", "Exame", "Laboratório"],
  ])("%j is the type %j at %j", (description, type, place) => {
    expect(readType(description)).toEqual({ type, place });
  });

  it("gives nothing for a description with no type, empty, huge or not a text", () => {
    for (const description of ["", "Levar exames", " | Consultório", "| |", "https://exemplo.com.br/a|b", undefined, null, 5, {}]) expect(readType(description)).toEqual({ type: "", place: "" });
    const huge = readType(`${"x".repeat(8_192)}\nRetorno | Consultório`);
    expect(huge).toEqual({ type: "", place: "" });
    expect(readType(`${"T".repeat(79)} | ${"P".repeat(119)}`).type.length).toBeLessThanOrEqual(40);
  });

  it("reads the kind by the first word, whatever the case or the accents", () => {
    expect(kindOf("Retorno")).toBe("return");
    expect(kindOf("RETORNO online")).toBe("return");
    expect(kindOf("Consulta")).toBe("consultation");
    expect(kindOf("Primeira consulta")).toBe("consultation");
    expect(kindOf("Avaliação")).toBe("consultation");
    expect(kindOf("Exame")).toBe("other");
    expect(kindOf("")).toBe("other");
    expect(kindOf("Retornou a ligação")).toBe("other");
  });

  it("turns a pasted description into plain lines without tags or control characters", () => {
    expect(plainLines("<div>a</div><div>b‮</div>\r\n\r\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("titleNames", () => {
  it.each([
    "Beatriz Novaes Conceição",
    "beatriz novaes conceicao",
    "BEATRIZ NOVAES CONCEIÇÃO",
    "  Beatriz  Novaes   Conceição ",
    "Beatriz Novaes Conceição / Paciente",
    "Beatriz Novaes Conceição (Paciente)",
    "Beatriz Novaes Conceição - Retorno",
    "Retorno - Beatriz Novaes Conceição",
    "Consulta: Beatriz Novaes Conceição",
    "Retorno Beatriz Novaes Conceição",
    "Consulta com Beatriz Novaes Conceição",
  ])("%j names Beatriz Novaes Conceição", (title) => {
    expect(titleNames(title, "Beatriz Novaes Conceição")).not.toBeNull();
  });

  it("tells the title that is the name itself from the one that only holds it as a piece", () => {
    expect(titleNames("Beatriz Novaes Conceição / Paciente", "Beatriz Novaes Conceição")).toBe("whole");
    expect(titleNames("Aniversário: Beatriz Novaes Conceição", "Beatriz Novaes Conceição")).toBe("piece");
    expect(titleNames("José (Zé) da Silva - Retorno", "José (Zé) da Silva")).toBe("piece");
    expect(titleNames("Empresa Exemplo S/A - Retorno", "Empresa Exemplo S/A")).toBe("piece");
  });

  it.each(["Beatriz Novaes", "Beatriz Novaes Conceição Filha", "Maria Beatriz Novaes Conceição", "Ligar para Beatriz Novaes Conceição", "Beatriz", "", "Reunião"])("%j does not", (title) => {
    expect(titleNames(title, "Beatriz Novaes Conceição")).toBeNull();
  });

  it("never finds a short name inside a longer one, keeps a hyphen of the name and refuses an empty name", () => {
    expect(titleNames("Carla Regina Duarte Pires", "Carla Regina")).toBeNull();
    expect(titleNames("Ana-Maria Souza", "Ana-Maria Souza")).toBe("whole");
    expect(titleNames("Ana-Maria Souza", "Maria Souza")).toBeNull();
    expect(titleNames("qualquer", "")).toBeNull();
  });
});

describe("carries", () => {
  const proof: ContactProof = { phones: ["5541999990110"], emails: ["beatriz@exemplo.com.br"], cpf: "52998224725", birthday: "1988-05-20" };
  it("finds a phone (by its last eight digits), an e-mail, the CPF or the birthday in the text or the guests", () => {
    expect(carries(proof, "Tel (41) 99999-0110", [])).toBe(true);
    expect(carries(proof, "whats +55 41 9 9999 0110", [])).toBe(true);
    expect(carries(proof, "Contato: BEATRIZ@exemplo.com.br", [])).toBe(true);
    expect(carries(proof, "", ["beatriz@exemplo.com.br"])).toBe(true);
    expect(carries(proof, "CPF 529.982.247-25", [])).toBe(true);
    expect(carries(proof, "Nasc. 20/05/1988", [])).toBe(true);
    expect(carries(proof, "nasc 1988-05-20", [])).toBe(true);
  });
  it("finds nothing in a text of someone else, and nothing at all for a contact with no data", () => {
    expect(carries(proof, "Tel (41) 98888-0111, CPF 111.444.777-35, nasc. 20/05/1989", ["outra@exemplo.com.br"])).toBe(false);
    expect(carries(proof, "0110", [])).toBe(false);
  });
  it("SEC-CN-03: an e-mail counts whole and a phone with its area code", () => {
    const ana: ContactProof = { ...nobody, emails: ["ana@exemplo.com.br"], phones: ["41999990110"] };
    expect(carries(ana, "contato: mariana@exemplo.com.br", ["mariana@exemplo.com.br"])).toBe(false);
    expect(carries(ana, "contato: <ana@exemplo.com.br>.", [])).toBe(true);
    // The same number in another city is another phone; written without the area code, the last eight digits serve.
    expect(carries(ana, "Tel (11) 99999-0110", [])).toBe(false);
    expect(carries(ana, "Tel +55 (41) 99999-0110", [])).toBe(true);
    expect(carries(ana, "Tel 041 99999-0110", [])).toBe(true);
    expect(carries(ana, "Tel 99999-0110", [])).toBe(true);
    // An old landline-length mobile (without the ninth digit) of the same area.
    expect(carries(ana, "Tel (41) 9999-0110", [])).toBe(true);
    expect(carries(nobody, "Tel (41) 99999-0110 beatriz@exemplo.com.br", ["beatriz@exemplo.com.br"])).toBe(false);
  });
});

describe("readAppointment", () => {
  it("reads a timed event and an all-day one, in the owner's zone", () => {
    expect(readAppointment(event(), beatriz(), ZONE)).toEqual({ start: "2026-11-01T13:00:00.000Z", allDay: false, kind: "consultation", type: "Consulta", place: "Consultório", certain: true, at: Date.parse("2026-11-01T13:00:00Z") });
    expect(readAppointment(event({ start: { date: "2026-11-20" }, end: { date: "2026-11-21" }, description: "Retorno | Consultório" }), beatriz(), ZONE)).toMatchObject({
      start: "2026-11-20",
      allDay: true,
      kind: "return",
      at: Date.parse("2026-11-20T03:00:00Z"),
    });
  });

  it("keeps an event with no type as an appointment of another kind", () => {
    expect(readAppointment(event({ description: undefined }), beatriz(), ZONE)).toMatchObject({ kind: "other", type: "", place: "" });
  });

  it("leaves out what is not an appointment of this person", () => {
    for (const over of [
      { status: "cancelled" },
      { summary: "CANCELADO - Beatriz Novaes Conceição" },
      { summary: "Beatriz Novaes Conceição (desmarcado)" },
      { description: "Consulta cancelada | Consultório" },
      { summary: "Beatriz Novaes" },
      { summary: undefined },
      { start: undefined },
      { start: { dateTime: "ontem" } },
      { start: { date: "2026-13-45" } },
      { start: { date: 20261101 } },
      { attendees: [{ self: true, responseStatus: "declined" }] },
      // SEC-CN-02: an invitation somebody else sent and the owner never answered.
      { organizer: { email: "outro@exemplo.com.br" }, attendees: [{ self: true, responseStatus: "needsAction" }] },
      { organizer: { email: "outro@exemplo.com.br" }, attendees: [{ self: true }] },
      // QA-CN-09: the name is only a piece of the title and nothing says it is an appointment.
      { summary: "Aniversário: Beatriz Novaes Conceição", description: "Levar bolo" },
      { summary: "Pagamento - Beatriz Novaes Conceição", description: undefined },
      { summary: "Beatriz Novaes Conceição - faltou" },
      { summary: "Beatriz Novaes Conceição (remarcado)" },
    ]) {
      expect(readAppointment(event(over), beatriz(), ZONE), JSON.stringify(over)).toBeNull();
    }
    for (const item of [null, undefined, "x", 3, []]) expect(readAppointment(item, beatriz(), ZONE)).toBeNull();
  });

  it("keeps the owner's own events with guests and the invitations they accepted; a \"maybe\" is never certain", () => {
    expect(readAppointment(event({ organizer: { self: true }, attendees: [{ self: true, responseStatus: "needsAction" }, { email: "beatriz@exemplo.com.br" }] }), beatriz(), ZONE)).toMatchObject({ certain: true });
    expect(readAppointment(event({ organizer: { email: "outro@exemplo.com.br" }, attendees: [{ self: true, responseStatus: "accepted" }] }), beatriz(), ZONE)).toMatchObject({ certain: true });
    expect(readAppointment(event({ organizer: { email: "outro@exemplo.com.br" }, attendees: [{ self: true, responseStatus: "tentative" }] }), beatriz(), ZONE)).toMatchObject({ certain: false });
    expect(readAppointment(event({ summary: "Retorno - Beatriz Novaes Conceição" }), beatriz(), ZONE)).toMatchObject({ kind: "consultation" });
  });

  it("SEC-CN-04: a description of nothing but \"<\" is read in a blink", () => {
    const started = Date.now();
    for (let i = 0; i < 50; i++) readAppointment(event({ description: "<".repeat(8_192) }), beatriz(), ZONE);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("an all-day event falls on its day where the day has 23 or 25 hours, or no midnight at all", () => {
    for (const [zone, date] of [["America/New_York", "2026-03-08"], ["America/New_York", "2026-11-01"], ["America/Santiago", "2026-09-06"], ["Africa/Cairo", "2026-04-24"], ["America/Havana", "2026-03-08"]] as const) {
      const read = readAppointment(event({ start: { date }, end: { date } }), beatriz(), zone);
      expect(read, `${zone} ${date}`).toMatchObject({ start: date, allDay: true });
      expect(new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date((read?.at ?? 0) + 3_600_000)), `${zone} ${date}`).toBe(date);
    }
  });

  it("tells two people with one name apart by what the event carries, and says so when it carries nothing", () => {
    const me: ContactProof = { phones: ["41977770112"], emails: [], cpf: "52998224725", birthday: "1979-02-11" };
    const other: ContactProof = { phones: ["41966660113"], emails: ["marcos2@exemplo.com.br"], cpf: "11144477735", birthday: "1994-09-03" };
    const who: ContactIdentity = { name: "Marcos Vieira Lopes", proof: me, others: [other] };
    const visit = (extra: Record<string, unknown>) => readAppointment(event({ summary: "Marcos Vieira Lopes", ...extra }), who, ZONE);
    expect(visit({ description: "Consulta | Consultório\nCPF 529.982.247-25" })).toMatchObject({ certain: true });
    expect(visit({ description: "Consulta | Consultório\nTel (41) 97777-0112" })).toMatchObject({ certain: true });
    expect(visit({ description: "Consulta | Consultório\nCPF 111.444.777-35" })).toBeNull();
    expect(visit({ description: "Consulta | Consultório", attendees: [{ email: "Marcos2@exemplo.com.br" }] })).toBeNull();
    expect(visit({ description: "Consulta | Consultório", location: "Tel 41 96666-0113" })).toBeNull();
    expect(visit({ description: "Consulta | Consultório" })).toMatchObject({ certain: false });
    // By the e-mail alone (the owner's own event, with the patient as a guest), and never certain with something of both.
    const mailed: ContactIdentity = { name: "Marcos Vieira Lopes", proof: { ...nobody, emails: ["marcos1@exemplo.com.br"] }, others: [other] };
    const own = { organizer: { self: true } };
    expect(readAppointment(event({ summary: "Marcos Vieira Lopes", ...own, attendees: [{ email: "marcos1@exemplo.com.br" }] }), mailed, ZONE)).toMatchObject({ certain: true });
    expect(readAppointment(event({ summary: "Marcos Vieira Lopes", description: "Consulta | Consultório\nmarcos1@exemplo.com.br" }), mailed, ZONE)).toMatchObject({ certain: true });
    expect(readAppointment(event({ summary: "Marcos Vieira Lopes", ...own, attendees: [{ email: "marcos2@exemplo.com.br" }] }), mailed, ZONE)).toBeNull();
    expect(readAppointment(event({ summary: "Marcos Vieira Lopes", ...own, attendees: [{ email: "marcos1@exemplo.com.br" }, { email: "marcos2@exemplo.com.br" }] }), mailed, ZONE)).toMatchObject({ certain: false });
  });

  it("leaves out an event with someone else's CPF even when no other contact has the name", () => {
    const who = beatriz({ proof: { ...nobody, cpf: "52998224725" } });
    expect(readAppointment(event({ description: "Consulta | Consultório\nCPF 111.444.777-35" }), who, ZONE)).toBeNull();
    expect(readAppointment(event({ description: "Consulta | Consultório\nCPF 529.982.247-25" }), who, ZONE)).toMatchObject({ certain: true });
    // A contact with no CPF at Google can't be told from the event's: it stays.
    expect(readAppointment(event({ description: "Consulta | Consultório\nCPF 111.444.777-35" }), beatriz(), ZONE)).toMatchObject({ certain: true });
  });
});

describe("contactAppointments", () => {
  interface Fake {
    calls: { calendar: string; query: Record<string, string> }[];
    google: GoogleCalendar;
  }
  /** A calendar that answers as Google does: the events of the window asked, oldest first, in pages of `size`. */
  const fake = (calendars: Record<string, unknown[]>, options: { usable?: boolean; size?: number; fail?: GoogleError } = {}): Fake => {
    const calls: Fake["calls"] = [];
    const startOf = (item: unknown) => {
      const start = (item as { start: { date?: string; dateTime?: string } }).start;
      return Date.parse(start.dateTime ?? `${start.date}T03:00:00Z`);
    };
    const google = {
      usable: () => options.usable ?? true,
      readable: () => Object.keys(calendars).map((id) => ({ id })),
      api: async (path: string, meter: GoogleMeter, init: { query: Record<string, string> }) => {
        meter.take();
        if (options.fail) throw options.fail;
        const calendar = decodeURIComponent(/^\/calendars\/([^/]+)\/events$/.exec(path)?.[1] ?? "");
        calls.push({ calendar, query: init.query });
        const size = options.size ?? 250;
        const inWindow = (calendars[calendar] ?? [])
          .filter((item) => startOf(item) >= Date.parse(init.query.timeMin ?? "") && startOf(item) < Date.parse(init.query.timeMax ?? ""))
          .sort((a, b) => startOf(a) - startOf(b));
        const index = Number(init.query.pageToken ?? "0");
        return { items: inWindow.slice(index * size, (index + 1) * size), ...((index + 1) * size < inWindow.length ? { nextPageToken: String(index + 1) } : {}) };
      },
    } as unknown as GoogleCalendar;
    return { calls, google };
  };
  const visit = (id: string, start: string, description: string, over: Record<string, unknown> = {}) => event({ id, start: start.length === 10 ? { date: start } : { dateTime: start }, description, ...over });
  const run = (f: Fake, who = beatriz(), budget = 24) => contactAppointments(f.google, who, ZONE, new GoogleMeter(budget), NOW);
  const DAY = 86_400_000;

  it("says the calendar is not there when it is not connected or no calendar is open", async () => {
    expect(await run(fake({ a: [event()] }, { usable: false }))).toEqual({ available: false, last: null, next: null, more: false });
    expect(await run(fake({}))).toEqual({ available: false, last: null, next: null, more: false });
  });

  it("gives the last appointment that began and the next one ahead, whatever their type, across calendars", async () => {
    const f = fake({
      a: [visit("1", "2026-09-09T10:00:00-03:00", "Consulta | Consultório"), visit("2", "2026-11-25T09:00:00-03:00", "Consulta | Online")],
      b: [visit("3", "2026-10-14T15:00:00-03:00", "Retorno | Consultório"), visit("4", "2026-12-02T14:00:00-03:00", "Retorno | Consultório")],
    });
    expect(await run(f)).toEqual({
      available: true,
      last: { start: "2026-10-14T18:00:00.000Z", allDay: false, kind: "return", type: "Retorno", place: "Consultório", certain: true },
      // The consultation of the 25th comes before the return of 2 December: the next one is whichever is first.
      next: { start: "2026-11-25T12:00:00.000Z", allDay: false, kind: "consultation", type: "Consulta", place: "Online", certain: true },
      more: false,
    });
    // What is ahead of every calendar first, then the last months; the older years are not asked.
    expect(f.calls.map((call) => [call.calendar, Math.round((Date.parse(call.query.timeMin ?? "") - NOW) / DAY), Math.round((Date.parse(call.query.timeMax ?? "") - NOW) / DAY)])).toEqual([
      ["a", -2, 366],
      ["b", -2, 366],
      ["a", -180, -2],
      ["b", -180, -2],
    ]);
    expect(f.calls[0]?.query).toMatchObject({ q: "Beatriz Novaes Conceição", singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  });

  it("goes back three years only when the last months have nothing", async () => {
    const f = fake({ a: [visit("1", "2024-03-10T10:00:00-03:00", "Consulta | Antiga"), visit("0", "2023-01-10T10:00:00-03:00", "Consulta | Fora da janela")] });
    expect(await run(f)).toMatchObject({ last: { place: "Antiga" }, next: null, more: false });
    expect(f.calls.map((call) => Math.round((Date.parse(call.query.timeMin ?? "") - NOW) / DAY))).toEqual([-2, -180, -1_095]);
  });

  it("gives only what there is: nothing ahead, nothing behind, nothing at all", async () => {
    expect(await run(fake({ a: [visit("1", "2026-11-25T09:00:00-03:00", "Consulta | Online")] }))).toMatchObject({ last: null, next: { kind: "consultation" } });
    expect(await run(fake({ a: [visit("1", "2026-10-25T09:00:00-03:00", "Retorno | Online")] }))).toMatchObject({ last: { kind: "return" }, next: null });
    expect(await run(fake({ a: [] }))).toEqual({ available: true, last: null, next: null, more: false });
  });

  it("splits past and future at this very minute for a timed event and at the owner's day for an all-day one", async () => {
    const at = (ms: number) => new Date(ms).toISOString();
    const timed = await run(fake({ a: [visit("1", at(NOW), "Consulta | A"), visit("2", at(NOW + 60_000), "Retorno | B")] }));
    expect(timed.last?.place).toBe("A");
    expect(timed.next?.place).toBe("B");
    const days = await run(fake({ a: [visit("1", "2026-11-10", "Consulta | Ontem"), visit("2", "2026-11-11", "Consulta | Hoje"), visit("3", "2026-11-12", "Retorno | Amanhã")] }));
    expect(days.last).toMatchObject({ start: "2026-11-11", allDay: true, place: "Hoje" });
    expect(days.next).toMatchObject({ start: "2026-11-12", allDay: true, place: "Amanhã" });
    // 01:00 UTC on the 12th is still the 11th in São Paulo: an all-day event of the 12th is ahead.
    const late = await contactAppointments(fake({ a: [visit("1", "2026-11-12", "Retorno | Amanhã")] }).google, beatriz(), ZONE, new GoogleMeter(24), Date.parse("2026-11-12T01:00:00Z"));
    expect(late).toMatchObject({ last: null, next: { start: "2026-11-12" } });
  });

  it("QA-CN-04: hundreds of old events with the name never hide the last visit nor the next one", async () => {
    // One event a day for three years, most of them of other people Google also found by the word.
    const noise = Array.from({ length: 900 }, (_, i) => visit(`n${i}`, new Date(NOW - (i + 200) * DAY).toISOString(), "Consulta | Outra", { summary: "Beatriz Lima" }));
    const f = fake({ a: [...noise, visit("old", new Date(NOW - 400 * DAY).toISOString(), "Consulta | Antiga"), visit("last", "2026-10-20T10:00:00-03:00", "Consulta | Recente"), visit("next", "2026-11-30T10:00:00-03:00", "Retorno | Marcado")] });
    expect(await run(f)).toMatchObject({ last: { place: "Recente" }, next: { place: "Marcado" }, more: false });
  });

  it("reads a second page, says when there is more than it read, and counts an event once", async () => {
    const past = (n: number) => Array.from({ length: n }, (_, i) => visit(`p${i}`, new Date(NOW - (170 - i) * DAY).toISOString(), `Consulta | ${i}`));
    const two = await run(fake({ a: past(4) }, { size: 2 }));
    expect(two).toMatchObject({ last: { place: "3" }, more: false });
    const five = await run(fake({ a: past(5) }, { size: 2 }));
    expect(five).toMatchObject({ last: { place: "3" }, more: true });
    // An event that is going on is in both windows asked: it is one event.
    const going = fake({ a: [visit("x", new Date(NOW - DAY).toISOString(), "Consulta | Ontem")] });
    expect(await run(going)).toMatchObject({ last: { place: "Ontem" }, next: null });
  });

  it("asks once more without the accents when the name with them finds nothing", async () => {
    const f = fake({ a: [] });
    await run(f);
    expect(f.calls.map((call) => call.query.q)).toEqual([...Array(3).fill("Beatriz Novaes Conceição"), ...Array(3).fill("Beatriz Novaes Conceicao")]);
    const plain = fake({ a: [] });
    await run(plain, beatriz({ name: "Ana Souza" }));
    expect(plain.calls).toHaveLength(3);
    // With no room left for every calendar once more, it is not asked.
    const tight = fake({ a: [], b: [] });
    await run(tight, beatriz(), 7);
    expect(tight.calls).toHaveLength(6);
  });

  it("stops at the budget with what it read, and fails when Google does", async () => {
    const f = fake({ a: [visit("1", "2026-11-25T10:00:00-03:00", "Consulta | A")], b: [visit("2", "2026-11-20T10:00:00-03:00", "Consulta | B")] });
    expect(await run(f, beatriz(), 1)).toMatchObject({ available: true, next: { place: "A" }, more: true });
    await expect(run(fake({ a: [] }, { fail: new GoogleError("unavailable") }))).rejects.toBeInstanceOf(GoogleError);
    await expect(run(fake({ a: [] }), beatriz(), 0)).rejects.toMatchObject({ kind: "budget" });
  });

  it("reads at most ten calendars, and both sides of all ten fit the route's calls", async () => {
    const calendars = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`c${i}`, [visit(`${i}`, "2026-09-09T10:00:00-03:00", "Consulta | A"), visit(`f${i}`, "2026-12-09T10:00:00-03:00", "Retorno | B")]]));
    const f = fake(calendars);
    expect(await run(f)).toMatchObject({ last: { place: "A" }, next: { place: "B" }, more: false });
    expect(f.calls).toHaveLength(20);
    expect(new Set(f.calls.map((call) => call.calendar)).size).toBe(10);
  });
});
