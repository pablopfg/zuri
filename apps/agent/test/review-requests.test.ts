import { REVIEW_REQUEST_LIMITS, reviewLinkProblem } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { inWake, WakeBudget } from "../src/agent/wake-budget.ts";
import { isPreviewAgent, reviewLinkCode } from "../src/gates/review-link.ts";
import { GoogleError } from "../src/google/service.ts";
import { maskEmail, ReviewMatches } from "../src/reviews/matches.ts";
import { nameKey, namePrints, shortKey } from "../src/reviews/names.ts";
import { addDays, drawCode, dueDay, fillMessage, firstNameFor, nextWorking, workingDay } from "../src/reviews/requests.ts";
import { testEnv } from "./helpers.ts";
import { contactId, DAY, LABEL, match, person, type ReviewsWorld, review, setUp, visit, WEDNESDAY_9, withReviewsWorld } from "./reviews-world.ts";

// PR S20: review requests with one tap and the link (docs/planos/s20-pedido-de-avaliacao.md):
// which contact left a review, the day's list from the calendar, the send and the short address.

describe("names, days and the message", () => {
  it("compares names without title, accents, case or the note after them, and keeps only HMAC prints", async () => {
    expect(nameKey("Dra. Lúcia  Ferraz")).toBe("lucia ferraz");
    expect(nameKey("Prof. Sr. JOÃO da Silva / Paciente")).toBe("joao da silva");
    expect(nameKey("  ")).toBe("");
    expect(shortKey("joao da silva")).toBe("joao silva");
    expect(shortKey("joao")).toBeNull();
    const a = await namePrints(testEnv.PASSWORD_PEPPER, "João da Silva");
    const b = await namePrints(testEnv.PASSWORD_PEPPER, "joao  DA silva");
    expect(a).toEqual(b);
    expect(a?.full).toMatch(/^[0-9a-f]{64}$/);
    expect(a?.full).not.toContain("joao");
    expect(await namePrints("outra-chave-0123456789abcdefghijklmnop", "João da Silva")).not.toEqual(a);
    expect(await namePrints(testEnv.PASSWORD_PEPPER, "Dr.")).toBeNull();
    expect((await namePrints(testEnv.PASSWORD_PEPPER, "Ana"))?.short).toBeNull();
  });

  it("counts working days from Monday to Friday without the national holidays", () => {
    expect(workingDay("2026-11-04")).toBe(true);
    expect(workingDay("2026-11-07")).toBe(false);
    expect(workingDay("2026-11-02")).toBe(false);
    expect(nextWorking("2026-11-20")).toBe("2026-11-23");
    expect(dueDay("2026-10-27", 8)).toBe("2026-11-04");
    expect(dueDay("2026-11-12", 8)).toBe("2026-11-23");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("fills the first name only with letters, and drops the greeting's comma without one", () => {
    expect(firstNameFor("", "Ana Souza")).toBe("Ana");
    expect(firstNameFor("Maria-Clara", "x")).toBe("Maria-Clara");
    expect(firstNameFor("", "<b>Ana</b>")).toBe("");
    expect(firstNameFor("", "Ana1 Souza")).toBe("");
    expect(firstNameFor("", "Aaaaaaaaaaaaaaaaaaaaa")).toBe("");
    expect(fillMessage("Oi, {primeiro_nome}! Veja: {link}", "Ana", "https://x/a/1")).toBe("Oi, Ana! Veja: https://x/a/1");
    expect(fillMessage("Oi, {primeiro_nome}! Veja: {link}", "", "https://x/a/1")).toBe("Oi! Veja: https://x/a/1");
  });

  it("draws codes of 10 letters and digits of the alphabet, and the Worker takes only those", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = drawCode();
      expect(code).toMatch(new RegExp(`^[${REVIEW_REQUEST_LIMITS.codeAlphabet}]{10}$`));
      seen.add(code);
    }
    expect(seen.size).toBe(200);
    expect(reviewLinkCode(`/a/${drawCode()}`)).not.toBeNull();
    for (const path of ["/a/", "/a/abc", "/a/k7Q2mX9pAB/", "/a/k7Q2mX9pA0", "/a/k7Q2mX9pAl", "/b/k7Q2mX9pAB", "/a/../api/x"]) expect(reviewLinkCode(path), path).toBeNull();
  });

  it("tells preview robots apart, and masks an e-mail", () => {
    expect(isPreviewAgent("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(isPreviewAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isPreviewAgent("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isPreviewAgent("")).toBe(true);
    expect(isPreviewAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36")).toBe(false);
    expect(maskEmail("ana@exemplo.com.br")).toBe("an•••@exemplo.com.br");
    expect(maskEmail("a@exemplo.com.br")).toBe("a•••@exemplo.com.br");
    expect(maskEmail("sem-arroba")).toBe("");
  });

  it("takes only an https link of Google's review hosts", () => {
    expect(reviewLinkProblem("https://g.page/r/exemplo/review")).toBeNull();
    expect(reviewLinkProblem("https://search.google.com/local/writereview?placeid=x")).toBeNull();
    expect(reviewLinkProblem("https://www.google.com/maps/place/Exemplo")).toBeNull();
    // Google's redirectors never pass for a review page.
    expect(reviewLinkProblem("https://www.google.com/url?q=https://exemplo.com.br")).toBe("host");
    expect(reviewLinkProblem("https://search.google.com/url?q=https://exemplo.com.br")).toBe("host");
    expect(reviewLinkProblem("http://g.page/r/exemplo/review")).toBe("invalid");
    expect(reviewLinkProblem("https://g.page.exemplo.com.br/r")).toBe("host");
    expect(reviewLinkProblem(`https://user:pw${"@"}g.page/r`)).toBe("invalid");
    expect(reviewLinkProblem("https://g.page:8443/r")).toBe("invalid");
    expect(reviewLinkProblem("javascript:alert(1)")).toBe("invalid");
    expect(reviewLinkProblem(`https://g.page/${"r".repeat(300)}`)).toBe("invalid");
  });
});

describe("which contact left a review", () => {
  it("links the whole name of one contact by itself, and never twice", () =>
    withReviewsWorld(async (world) => {
      await setUp(world, () => person(world, "c1", "Ana Souza", { phoneNumbers: [{ value: "(11) 99999-0001" }] }));
      const [ana] = contactId(world, "Ana Souza");
      const first = await review(world, "r1", "Ana Souza");
      expect(match(world, first)).toMatchObject({ kind: "auto", contact_id: ana });
      // A second review of the same name: the contact already has one, so the owner confirms.
      const second = await review(world, "r2", "Ana Souza");
      expect(match(world, second)).toMatchObject({ kind: "guess", contact_id: null, candidates: JSON.stringify([ana]) });
      expect(world.matches.counts()).toMatchObject({ linked: 1, pending: 1 });
      // The card shows the link and the candidate, with the clue.
      const card = await world.reviews.review(first);
      expect(card?.match).toMatchObject({ kind: "auto", contact: { id: ana, name: "Ana Souza" } });
    }));

  it("never links two contacts of one name: the owner picks, once, and a contact already linked is refused", () =>
    withReviewsWorld(async (world) => {
      await setUp(world, () => {
        person(world, "c1", "Marcos Vieira Lopes", { phoneNumbers: [{ value: "(41) 97777-0112" }], emailAddresses: [{ value: "marcos@exemplo.com.br" }] });
        person(world, "c2", "Marcos Vieira Lopes", { phoneNumbers: [{ value: "(41) 96666-0113" }] });
      });
      const [one, two] = contactId(world, "Marcos Vieira Lopes") as [string, string];
      const id = await review(world, "r1", "Marcos Vieira Lopes");
      expect(match(world, id)?.kind).toBe("twins");
      const card = await world.reviews.review(id);
      // Same names sort by the contact's id (random): the order is steady, never the test's.
      expect(card?.match?.candidates.map((c) => [c.id, c.phoneEnd, c.email]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
        [one, "0112", "ma•••@exemplo.com.br"],
        [two, "0113", ""],
      ]);
      expect(card?.match?.candidates.some((c) => c.best)).toBe(false);
      expect(world.matches.waiting(one)).toBe(true);
      expect(() => world.matches.decide(id, "00000000-0000-4000-8000-000000000000")).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED", messageKey: "error.reviewMatchContact" }));
      world.matches.decide(id, one);
      expect(match(world, id)).toMatchObject({ kind: "confirmed", contact_id: one, candidates: "[]" });
      expect(world.matches.waiting(two)).toBe(false);
      // Decided once: no other choice, and the confirmed link stays.
      expect(() => world.matches.decide(id, two)).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED", messageKey: "error.reviewMatchContact" }));
      expect(() => world.matches.decide(id, null)).toThrow(expect.objectContaining({ code: "CONFLICT", messageKey: "error.reviewMatchGone" }));
      const other = await review(world, "r2", "Marcos Vieira Lopes");
      expect(() => world.matches.decide(other, one)).toThrow(expect.objectContaining({ code: "CONFLICT", messageKey: "error.reviewMatchTaken" }));
      world.matches.decide(other, null);
      expect(match(world, other)?.kind).toBe("none");
      expect(await world.reviews.review(other)).toMatchObject({ match: null });
    }));

  it("takes only the first and last name, or no name with one link opened just before, for a guess", () =>
    withReviewsWorld(async (world) => {
      await setUp(world, () => person(world, "c1", "Carla Regina Pires", { phoneNumbers: [{ value: "(41) 98888-0111" }] }));
      const [carla] = contactId(world, "Carla Regina Pires");
      expect(match(world, await review(world, "r1", "Carla Pires"))).toMatchObject({ kind: "guess", candidates: JSON.stringify([carla]) });
      // Anonymous, nobody opened a link: nothing.
      expect(match(world, await review(world, "r2", "", 5, { anonymous: true }))).toBeNull();
      expect(match(world, await review(world, "r3", "Fulano Qualquer"))).toBeNull();
    }));

  it("never links by itself a name another contact shares with a title, or with the same first and last name", () =>
    withReviewsWorld(async (world) => {
      await setUp(world, () => {
        person(world, "c1", "Ana Souza");
        person(world, "c2", "Dra. Ana Souza");
        person(world, "c3", "Bruna Lima");
        person(world, "c4", "Bruna Teixeira Lima");
      });
      expect(match(world, await review(world, "r1", "Ana Souza"))?.kind).toBe("twins");
      const bruna = match(world, await review(world, "r2", "Bruna Lima"));
      expect(bruna?.kind).toBe("guess");
      expect((JSON.parse(bruna?.candidates ?? "[]") as string[]).sort()).toEqual([...contactId(world, "Bruna Lima"), ...contactId(world, "Bruna Teixeira Lima")].sort());
    }));

  it("never links by itself when more contacts share the first name than are read", () =>
    withReviewsWorld(async (world) => {
      await setUp(world, () => {
        // Sorted before her: the read stops before the other Maria of the same first and last name.
        for (let i = 0; i < REVIEW_REQUEST_LIMITS.candidatesRead - 1; i++) person(world, `m${i}`, `Maria Abreu ${String(i).padStart(3, "0")}`);
        person(world, "m-souza", "Maria Souza");
        person(world, "m-teixeira", "Maria Teixeira Souza");
      });
      expect(world.db.one(`SELECT count(*) AS n FROM zur_contacts`)).toEqual({ n: REVIEW_REQUEST_LIMITS.candidatesRead + 1 });
      expect(match(world, await review(world, "r1", "Maria Souza"))).toMatchObject({ kind: "guess", candidates: JSON.stringify(contactId(world, "Maria Souza")) });
    }));

  it("turns a review of a name nobody had into a guess when that person comes to the contacts, before anyone asks them", () =>
    withReviewsWorld(async (world) => {
      await setUp(world, () => person(world, "c1", "Beatriz Novaes", { phoneNumbers: [{ value: "(41) 99999-0110" }] }));
      const id = await review(world, "r1", "Paula Mendes");
      expect(match(world, id)).toBeNull();
      person(world, "c2", "Paula Mendes", { phoneNumbers: [{ value: "(41) 98888-0120" }] });
      expect(await world.contacts.sync("owner")).toBe("ok");
      const [paula] = contactId(world, "Paula Mendes") as [string];
      visit(world, "Paula Mendes", 8);
      world.clock.now = WEDNESDAY_9;
      expect(await world.requests_.tick()).toBe(true);
      expect(match(world, id)).toMatchObject({ kind: "guess", candidates: JSON.stringify([paula]) });
      expect(world.requests_.list().items.find((item) => item.contactId === paula)?.state).toBe("pending");
    }));

  it("forgets the links of the reviews of an unticked profile only, and reads a broken list of candidates as none", () =>
    withReviewsWorld(async (world) => {
      await setUp(world, () => {
        person(world, "c1", "Ana Souza");
        person(world, "c2", "Bruna Lima");
        person(world, "c3", "Bruna Lima");
      });
      const ana = await review(world, "r1", "Ana Souza");
      const bruna = await review(world, "r2", "Bruna Lima");
      ReviewMatches.forget(world.db, [ana]);
      expect(match(world, ana)).toBeNull();
      expect(match(world, bruna)?.kind).toBe("twins");
      expect(world.matches.counts()).toMatchObject({ linked: 0, pending: 1 });
      world.db.run(`UPDATE zur_review_matches SET candidates = 'not json' WHERE review_id = ?`, bruna);
      expect(world.matches.forReview(bruna, Date.now())).toMatchObject({ kind: "twins", candidates: [] });
      expect(() => world.matches.decide("00000000-0000-4000-8000-000000000000", null)).toThrow(expect.objectContaining({ code: "CONFLICT", messageKey: "error.reviewMatchGone" }));
    }));

  it("forgets the links and candidates of a review that goes, and the owner's undoing of a link sticks", () =>
    withReviewsWorld(async (world) => {
      await setUp(world, () => person(world, "c1", "Ana Souza"));
      const id = await review(world, "r1", "Ana Souza");
      world.matches.decide(id, null);
      expect(match(world, id)?.kind).toBe("none");
      world.reviews.disable();
      expect(world.db.all(`SELECT * FROM zur_review_matches`)).toEqual([]);
      expect(world.db.all(`SELECT * FROM zur_review_match_candidates`)).toEqual([]);
    }));
});

describe("the day's requests", () => {
  async function ready(world: ReviewsWorld) {
    await setUp(world, () => {
      person(world, "c1", "Beatriz Novaes", { phoneNumbers: [{ value: "(41) 99999-0110" }], names: [{ displayName: "Beatriz Novaes", givenName: "Beatriz" }] });
      person(world, "c2", "Diego Rocha", { phoneNumbers: [{ value: "(41) 3333-0008" }] });
      person(world, "c3", "Marcos Vieira Lopes", { phoneNumbers: [{ value: "(41) 97777-0112" }], userDefined: [{ key: "CPF", value: "529.982.247-25" }] });
      person(world, "c4", "Marcos Vieira Lopes", { phoneNumbers: [{ value: "(41) 96666-0113" }] });
      person(world, "c5", "Elisa Prado", { phoneNumbers: [{ value: "(41) 95555-0115" }] });
    });
    visit(world, "Beatriz Novaes", 8);
    visit(world, "Diego Rocha", 9);
    // Two contacts of one name: only the event with the CPF of one of them counts.
    visit(world, "Marcos Vieira Lopes", 10, { description: "Consulta | Consultório\nCPF 529.982.247-25" });
    visit(world, "Marcos Vieira Lopes", 9);
    // Ahead of today's list: Elisa's appointment was yesterday.
    visit(world, "Elisa Prado", 1);
    // Cancelled, and a stranger's name: nothing.
    visit(world, "Fulano de Tal", 8);
  }

  it("is made once a day at the owner's hour, one request per contact, and tells the owner", () =>
    withReviewsWorld(async (world) => {
      await ready(world);
      world.clock.now = WEDNESDAY_9 - 60_000;
      expect(world.requests_.due()).toBe(false);
      world.clock.now = WEDNESDAY_9;
      expect(world.requests_.nextDue()).toBe(WEDNESDAY_9);
      expect(await world.requests_.tick()).toBe(true);
      // Once a day.
      expect(await world.requests_.tick()).toBe(false);
      expect(world.requests_.nextDue()).toBe(WEDNESDAY_9 + DAY);
      const page = world.requests_.list();
      expect(page.blocked).toBeNull();
      const byName = Object.fromEntries(page.items.map((item) => [item.name, item]));
      expect(Object.keys(byName).sort()).toEqual(["Beatriz Novaes", "Diego Rocha", "Elisa Prado", "Marcos Vieira Lopes"]);
      expect(byName["Beatriz Novaes"]).toMatchObject({ state: "today", appointmentDay: "2026-10-27", dueDay: "2026-11-04" });
      // A landline has no WhatsApp.
      expect(byName["Diego Rocha"]?.state).toBe("no_phone");
      expect(byName["Elisa Prado"]).toMatchObject({ state: "scheduled", dueDay: "2026-11-11" });
      expect(byName["Marcos Vieira Lopes"]?.contactId).toBe(contactId(world, "Marcos Vieira Lopes")[0]);
      expect(page.counts).toMatchObject({ today: 2, scheduled: 1, off: 1 });
      expect(world.requestNotices).toEqual([{ kind: "reviews.requests", count: 2 }]);
      // Built again the next day: nobody twice, and the owner is told again only with someone due.
      world.clock.now += DAY;
      expect(await world.requests_.tick()).toBe(true);
      expect(world.db.one(`SELECT count(*) AS n FROM zur_review_requests`)).toEqual({ n: 4 });
      expect(world.requestNotices).toHaveLength(2);
    }));

  it("finds each request's person again when the contacts are copied anew, and makes that day's list again", () =>
    withReviewsWorld(async (world) => {
      await ready(world);
      world.clock.now = WEDNESDAY_9;
      expect(await world.requests_.tick()).toBe(true);
      const [beatriz] = contactId(world, "Beatriz Novaes") as [string];
      const before = world.requests_.list().items.find((item) => item.name === "Beatriz Novaes");
      await world.requests_.send(before?.id as string);
      // Contacts off and on again: a new copy, with new ids for the same people.
      world.contacts.disable();
      expect(world.requests_.list().items).toEqual([]);
      world.contacts.enable();
      expect(await world.contacts.sync("owner")).toBe("ok");
      world.contacts.select([LABEL]);
      expect(await world.contacts.sync("owner")).toBe("ok");
      const [again] = contactId(world, "Beatriz Novaes") as [string];
      expect(again).not.toBe(beatriz);
      // Opening Pedidos makes the day's list again, the same day: Beatriz keeps her request, already sent.
      await world.requests_.firstBuild();
      expect(world.db.one(`SELECT count(*) AS n FROM zur_review_requests`)).toEqual({ n: 4 });
      const after = world.requests_.list().items.find((item) => item.name === "Beatriz Novaes");
      expect(after).toMatchObject({ id: before?.id, contactId: again, state: "waiting" });
      expect(world.requests_.list().items.map((item) => item.name).sort()).toEqual(["Beatriz Novaes", "Diego Rocha", "Elisa Prado", "Marcos Vieira Lopes"]);
      // Disconnecting Google forgets them with the copies: the link already sent answers nothing from then on.
      const code = world.db.one<{ code: string }>(`SELECT code FROM zur_review_links`)?.code as string;
      await world.google.disconnect();
      expect(world.db.all(`SELECT id FROM zur_review_requests`)).toEqual([]);
      expect(world.db.all(`SELECT code FROM zur_review_links`)).toEqual([]);
      expect(await world.requests_.open(code, "net", false)).toEqual({ kind: "missing" });
      expect(world.requests_.update({}).days).toBe(8);
    }));

  it("makes the first list when Pedidos opens, before the hour and only once; asking the hour writes nothing", () =>
    withReviewsWorld(async (world) => {
      // An owner who never turned the area on keeps no row: the alarm asks this on every wake.
      world.db.run(`DELETE FROM zur_review_settings`);
      const before = world.db.usage.rowsWritten;
      expect(world.requests_.nextDue()).toBeNull();
      expect(world.requests_.due()).toBe(false);
      await world.requests_.firstBuild();
      expect(world.db.usage.rowsWritten).toBe(before);
      await ready(world);
      world.clock.now = WEDNESDAY_9 - 3 * 3_600_000;
      expect(world.requests_.due()).toBe(false);
      await world.requests_.firstBuild();
      expect(world.db.one(`SELECT count(*) AS n FROM zur_review_requests`)).toEqual({ n: 4 });
      expect(world.requestNotices).toEqual([{ kind: "reviews.requests", count: 2 }]);
      // Today is marked: the alarm's hour waits for tomorrow, and opening again builds nothing.
      expect(world.requests_.nextDue()).toBe(WEDNESDAY_9 + DAY);
      const calls = world.sim.seen.length;
      await world.requests_.firstBuild();
      expect(world.sim.seen.length).toBe(calls);
    }));

  it("waits for a wake with calls to spare, and keeps the day marked when Google fails halfway", () =>
    withReviewsWorld(async (world) => {
      await ready(world);
      world.clock.now = WEDNESDAY_9;
      // A wake with no calls left: nothing read, the day not marked, the next wake tries.
      const spent = new WakeBudget(4, 0);
      spent.take(4);
      expect(await inWake(spent, () => world.requests_.tick())).toBe(true);
      expect(world.requests_.nextDue()).toBe(WEDNESDAY_9);
      // Google fails: the day is marked all the same (tomorrow's hour, never every minute) and nothing is half kept.
      const api = world.google.api.bind(world.google);
      world.google.api = (async () => {
        throw new GoogleError("unavailable", 503);
      }) as typeof api;
      expect(await world.requests_.tick()).toBe(true);
      world.google.api = api;
      expect(world.requests_.nextDue()).toBe(WEDNESDAY_9 + DAY);
      expect(world.db.one(`SELECT count(*) AS n FROM zur_review_requests`)).toEqual({ n: 0 });
    }));

  it("counts two taps at once as one send, with one link", () =>
    withReviewsWorld(async (world) => {
      await ready(world);
      await world.requests_.tick();
      const beatriz = world.requests_.list().items.find((item) => item.name === "Beatriz Novaes");
      const both = await Promise.allSettled([world.requests_.send(beatriz?.id as string), world.requests_.send(beatriz?.id as string)]);
      expect(both.filter((one) => one.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
      expect(world.db.one(`SELECT attempts FROM zur_review_requests WHERE id = ?`, beatriz?.id as string)).toEqual({ attempts: 1 });
      expect(world.db.one(`SELECT count(*) AS n FROM zur_review_links`)).toEqual({ n: 1 });
    }));

  it("takes an anonymous review for a guess when one link alone was opened in the 48 hours before, the clue marked; two say nothing", () =>
    withReviewsWorld(async (world) => {
      await ready(world);
      await world.requests_.tick();
      const today = world.requests_.list().items.filter((item) => item.state === "today");
      expect(today.length).toBeGreaterThanOrEqual(2);
      const [first, second] = today as [(typeof today)[0], (typeof today)[0]];
      const codeOf = async (id: string) => /\/a\/(\w{10})$/.exec((await world.requests_.send(id)).text)?.[1] as string;
      expect((await world.requests_.open(await codeOf(first.id), "203.0.113.30", false)).kind).toBe("go");
      const guessed = await review(world, "anon-1", "", 5, { anonymous: true });
      expect(match(world, guessed)).toMatchObject({ kind: "guess", candidates: JSON.stringify([first.contactId]) });
      expect((await world.reviews.review(guessed))?.match?.candidates).toMatchObject([{ id: first.contactId, opened: true, best: true }]);
      // A second link opened: two people could have written it, so nothing.
      expect((await world.requests_.open(await codeOf(second.id), "203.0.113.31", false)).kind).toBe("go");
      expect(match(world, await review(world, "anon-2", "", 5, { anonymous: true }))).toBeNull();
      // Past the 48 hours, the openings say nothing either.
      world.clock.now += REVIEW_REQUEST_LIMITS.guessWindowMs;
      expect(match(world, await review(world, "anon-3", "", 5, { anonymous: true }))).toBeNull();
    }));

  it("keeps no reviewer's whole name in the database, only the prints and the first name", () =>
    withReviewsWorld(async (world) => {
      await setUp(world, () => person(world, "c1", "Ana Souza"));
      await review(world, "r1", "Ana Teixeira Souza");
      for (const table of ["zur_reviews", "zur_review_matches", "zur_review_events", "zur_review_match_candidates"]) {
        expect(JSON.stringify(world.db.all(`SELECT * FROM ${table}`)), table).not.toMatch(/Teixeira|Souza/i);
      }
    }));

  it("sends through the owner's WhatsApp: the text, the number and a link of the person's own, checked on the server", () =>
    withReviewsWorld(async (world) => {
      await ready(world);
      await world.requests_.tick();
      const beatriz = world.requests_.list().items.find((item) => item.name === "Beatriz Novaes");
      if (!beatriz) throw new Error("no request");
      const sent = await world.requests_.send(beatriz.id);
      expect(sent.phone).toBe("5541999990110");
      const link = /https:\/\/zuri\.exemplo\.com\.br\/a\/([A-Za-z0-9]{10})$/.exec(sent.text);
      expect(link).not.toBeNull();
      expect(sent.text).toContain("Oi, Beatriz!");
      expect(sent.item).toMatchObject({ state: "waiting", reminderDay: "2026-11-11" });
      // Tapped again within 10 minutes (WhatsApp didn't open): the same link, nothing counted twice.
      world.clock.now += 5 * 60_000;
      expect((await world.requests_.send(beatriz.id)).text).toBe(sent.text);
      expect(world.db.one(`SELECT attempts FROM zur_review_requests WHERE id = ?`, beatriz.id)).toEqual({ attempts: 1 });
      world.clock.now += 6 * 60_000;
      await expect(world.requests_.send(beatriz.id)).rejects.toMatchObject({ code: "CONFLICT" });
      // A landline can't be sent to; an unknown request is a 404.
      const diego = world.requests_.list().items.find((item) => item.name === "Diego Rocha");
      await expect(world.requests_.send(diego?.id as string)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(world.requests_.send("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });

      // The patient opens it: on to the profile's review page, the first opening noted.
      const code = link?.[1] as string;
      expect(await world.requests_.open(code, "198.51.100.7", true)).toEqual({ kind: "go", location: "https://g.page/r/exemplo-consultorio/review" });
      expect(world.db.one(`SELECT opened_at FROM zur_review_requests WHERE id = ?`, beatriz.id)).toEqual({ opened_at: null });
      const opened = world.clock.now;
      expect((await world.requests_.open(code, "198.51.100.7", false)).kind).toBe("go");
      world.clock.now += 60_000;
      await world.requests_.open(code, "198.51.100.7", false);
      expect(world.db.one(`SELECT opened_at FROM zur_review_requests WHERE id = ?`, beatriz.id)).toEqual({ opened_at: opened });
      expect(await world.requests_.open("AAAAAAAAAA", "198.51.100.7", false)).toEqual({ kind: "missing" });
      expect(await world.requests_.open("../x", "198.51.100.7", false)).toEqual({ kind: "missing" });

      // A week later, on a working day: one reminder, then nothing more.
      world.clock.now = WEDNESDAY_9 + 7 * DAY;
      expect(world.requests_.list().items.find((item) => item.id === beatriz.id)?.state).toBe("reminder");
      const reminded = await world.requests_.send(beatriz.id);
      expect(reminded.item.state).toBe("reminded");
      expect(reminded.text).not.toContain(code);
      world.clock.now += DAY;
      await expect(world.requests_.send(beatriz.id)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(world.reviews.metrics("30d").requests).toEqual({ sent: 1, opened: 1, reviewed: 0 });
    }));

  it("limits openings by network, and a code past its days still leads to the page without a note", () =>
    withReviewsWorld(async (world) => {
      await ready(world);
      await world.requests_.tick();
      const beatriz = world.requests_.list().items.find((item) => item.name === "Beatriz Novaes");
      const code = /\/a\/(\w{10})$/.exec((await world.requests_.send(beatriz?.id as string)).text)?.[1] as string;
      for (let i = 0; i < REVIEW_REQUEST_LIMITS.hitsPerMinute; i++) expect((await world.requests_.open("BBBBBBBBBB", "203.0.113.9", false)).kind).toBe("missing");
      expect((await world.requests_.open(code, "203.0.113.9", false)).kind).toBe("limited");
      // Another network isn't held, and the counts carry only an HMAC of the address.
      expect((await world.requests_.open(code, "203.0.113.10", true)).kind).toBe("go");
      world.clock.now += (REVIEW_REQUEST_LIMITS.linkValidDays + 1) * DAY;
      expect((await world.requests_.open(code, "203.0.113.11", false)).kind).toBe("go");
      expect(world.db.one(`SELECT opened_at FROM zur_review_requests WHERE id = ?`, beatriz?.id as string)).toEqual({ opened_at: null });
    }));

  it("S20-1: a stranger's openings write nothing, and a block of addresses changing at each one is held by everyone's limit", () =>
    withReviewsWorld(async (world) => {
      await ready(world);
      await world.requests_.tick();
      const before = world.db.usage.rowsWritten;
      let held = 0;
      for (let i = 0; i < REVIEW_REQUEST_LIMITS.hitsAllPerMinute + 5; i++) {
        if ((await world.requests_.open("BBBBBBBBBB", `2001:db8:${i.toString(16)}::1`, false)).kind === "limited") held += 1;
      }
      expect(held).toBe(5);
      expect(world.db.usage.rowsWritten - before).toBe(0);
      // A new minute starts the counts again.
      world.clock.now += 60_000;
      expect((await world.requests_.open("BBBBBBBBBB", "2001:db8:ffff::1", false)).kind).toBe("missing");
    }));

  it("leaves out a contact with a review linked or waiting, and a review that arrives after the request", () =>
    withReviewsWorld(async (world) => {
      await ready(world);
      const marcos = await review(world, "r1", "Marcos Vieira Lopes");
      world.clock.now = WEDNESDAY_9;
      await world.requests_.tick();
      const page = world.requests_.list();
      expect(page.items.find((item) => item.name === "Marcos Vieira Lopes")?.state).toBe("pending");
      expect(page.matches.pending).toBe(1);
      const [first] = contactId(world, "Marcos Vieira Lopes") as [string];
      world.matches.decide(marcos, first);
      const after = world.requests_.list().items.find((item) => item.name === "Marcos Vieira Lopes");
      expect(after).toMatchObject({ state: "reviewed", rating: 5, reviewId: marcos });
      await expect(world.requests_.send(after?.id as string)).rejects.toMatchObject({ code: "CONFLICT" });
    }));

  it("stops with the reason when something it needs is off, and reads nobody's name then", () =>
    withReviewsWorld(async (world) => {
      expect(world.requests_.list()).toMatchObject({ blocked: "reviews", items: [] });
      expect(world.requests_.nextDue()).toBeNull();
      await ready(world);
      world.db.run(`UPDATE zur_review_locations SET review_uri = NULL`);
      expect(world.requests_.blocked()).toBe("link");
      // Nothing for the alarm to wake for while it is blocked, and a tick reads nothing.
      expect(world.requests_.nextDue()).toBeNull();
      expect(await world.requests_.tick()).toBe(false);
      expect(world.db.all(`SELECT * FROM zur_review_requests`)).toEqual([]);
      // The owner's link wins over Google's, checked again whatever the database holds.
      expect(() => world.requests_.setLink("https://g.page/r/outro/review")).not.toThrow();
      expect(world.requests_.blocked()).toBeNull();
      expect(world.requests_.link()).toBe("https://g.page/r/outro/review");
      world.db.run(`UPDATE zur_review_locations SET review_uri_manual = 'https://exemplo.com.br/x'`);
      expect(world.requests_.link()).toBeNull();
      world.requests_.setLink(null);
      world.db.run(`UPDATE zur_review_locations SET review_uri = 'https://g.page/r/exemplo-consultorio/review'`);
      expect(world.requests_.settings().link).toMatchObject({ manual: null, google: "https://g.page/r/exemplo-consultorio/review", location: "Exemplo Centro" });
    }));

  it("keeps the owner's message and \"Quando pedir\", moves the days of the requests not sent, and writes nothing for the same values", () =>
    withReviewsWorld(async (world) => {
      await ready(world);
      await world.requests_.tick();
      const settings = world.requests_.update({ message: "Olá, {primeiro_nome}. {link}", days: 10, hour: "10:30", reminder: false });
      expect(settings).toMatchObject({ message: "Olá, {primeiro_nome}. {link}", days: 10, hour: "10:30", reminder: false, shortBase: "zuri.exemplo.com.br/a/" });
      expect(world.requests_.list().items.find((item) => item.name === "Beatriz Novaes")?.dueDay).toBe("2026-11-06");
      const before = world.db.usage.rowsWritten;
      world.requests_.update({ days: 10, hour: "10:30" });
      expect(world.db.usage.rowsWritten - before).toBe(0);
      world.clock.now += 2 * DAY;
      const beatriz = world.requests_.list().items.find((item) => item.name === "Beatriz Novaes");
      expect((await world.requests_.send(beatriz?.id as string)).text).toMatch(/^Olá, Beatriz\. https:/);
    }));
});
