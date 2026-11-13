import { REVIEW_REQUEST_LIMITS, type ReviewMatch, type ReviewMatchCandidate, type ReviewMatchKind } from "@zuri/shared";
import type { Database } from "../db/database.ts";
import type { GoogleContacts } from "../google/contacts.ts";
import { AppError } from "../http/errors.ts";
import { NAME_TITLES, nameKey, shortKey } from "./names.ts";

/**
 * Which contact left a review (PR S20; docs/planos/sinal-refinado-funcionalidades.md 8.1 and 8.1b).
 * Google gives only the name a person shows, so the name decides, with a rule that errs on the side
 * of asking nobody: the whole name of one contact alone, with nobody else of that first and last
 * name, links by itself (the owner may undo it). Two or more contacts with the name never link by
 * themselves: the owner picks. The first and last name only, or no name and one personal link opened
 * in the 48 hours before, is a guess the owner confirms. A contact with a review linked or waiting
 * is left out of the requests. A decision is kept for ever and made only once per review: a new
 * contact with the name inherits nothing.
 */

const DAY = 86_400_000;

export interface MatchesDeps {
  db: Database;
  contacts: () => GoogleContacts;
  clock?: () => number;
}

interface MatchRow {
  review_id: string;
  contact_id: string | null;
  kind: ReviewMatchKind | "none";
  candidates: string;
}

export class ReviewMatches {
  constructor(private readonly deps: MatchesDeps) {}

  private get db(): Database {
    return this.deps.db;
  }

  private now(): number {
    return this.deps.clock?.() ?? Date.now();
  }

  /**
   * The contacts of this name (as the prints are made, a title in the contacts left out too: "Dra.
   * Ana Souza" is "ana souza") and those of the same first and last name, whatever comes between.
   * Read by the first name's ranges, at most `candidatesRead` each: `more` says some were left out,
   * and then nothing links by itself (one of them could share the name).
   */
  private people(key: string): { whole: string[]; ends: string[]; more: boolean } {
    const first = key.split(" ")[0] ?? "";
    const short = shortKey(key);
    const contacts = this.deps.contacts();
    const whole = new Set<string>();
    const ends = new Set<string>();
    let more = false;
    for (const title of ["", ...NAME_TITLES]) {
      // The first name alone, with its note or with more words ("!" sorts right after the space): never "Anabela" for "Ana".
      const read = contacts.inNameRange(`${title}${first}`, `${title}${first}!`, REVIEW_REQUEST_LIMITS.candidatesRead);
      more ||= read.more;
      for (const contact of read.items) {
        const name = nameKey(contact.name);
        if (name === key) whole.add(contact.id);
        else if (short && shortKey(name) === short) ends.add(contact.id);
      }
    }
    return { whole: [...whole], ends: [...ends], more };
  }

  private linked(contactId: string): boolean {
    return this.db.one(`SELECT 1 AS yes FROM zur_review_matches WHERE contact_id = ? AND kind IN ('auto', 'confirmed') LIMIT 1`, contactId) !== null;
  }

  /**
   * A review's link, worked out once when it is first kept (or when its name's prints are first
   * made): the name in memory, never stored. Inside the caller's transaction.
   */
  assign(reviewId: string, rawName: string, anonymous: boolean, createdAt: number): void {
    if (this.db.one(`SELECT 1 AS yes FROM zur_review_matches WHERE review_id = ?`, reviewId)) return;
    if (!this.deps.contacts().enabled()) return;
    const key = anonymous ? "" : nameKey(rawName);
    if (key) {
      const { whole, ends, more } = this.people(key);
      let kind: ReviewMatchKind | null = null;
      if (whole.length === 1 && ends.length === 0 && !more && !this.linked(whole[0] as string)) kind = "auto";
      else if (whole.length >= 2) kind = "twins";
      // One contact of the whole name with another of the same ends, one already linked to its own review (one review each), or more contacts of the first name than were read.
      else if (whole.length === 1 || ends.length > 0) kind = "guess";
      if (kind) {
        this.write(reviewId, kind, kind === "auto" ? (whole[0] as string) : null, kind === "auto" ? [] : kind === "twins" ? whole : [...whole, ...ends]);
        return;
      }
    }
    // No name to go by: one personal link opened just before is a guess; two or more say nothing.
    const opened = this.db.all<{ contact_id: string }>(
      `SELECT DISTINCT r.contact_id FROM zur_review_links l JOIN zur_review_requests r ON r.id = l.request_id
       WHERE l.opened_at IS NOT NULL AND l.opened_at >= ? AND l.opened_at <= ? LIMIT 2`,
      createdAt - REVIEW_REQUEST_LIMITS.guessWindowMs,
      createdAt,
    );
    if (opened.length === 1 && !this.linked(opened[0]?.contact_id as string)) this.write(reviewId, "guess", null, [opened[0]?.contact_id as string]);
  }

  private write(reviewId: string, kind: ReviewMatchKind, contactId: string | null, candidates: string[]): void {
    const list = [...new Set(candidates)].slice(0, REVIEW_REQUEST_LIMITS.candidatesMax);
    this.db.run(
      `INSERT INTO zur_review_matches (review_id, contact_id, kind, candidates, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (review_id) DO NOTHING`,
      reviewId,
      contactId,
      kind,
      JSON.stringify(list),
      this.now(),
    );
    for (const id of list) this.db.run(`INSERT INTO zur_review_match_candidates (contact_id, review_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, id, reviewId);
  }

  /**
   * A contact about to enter the requests whose name's prints equal those of a review no link was
   * worked out for (the contact came to the copy after the review): it becomes a guess, so the
   * owner decides before anyone is asked. True when the contact has a review linked or waiting.
   */
  flagged(contactId: string, prints: { full: string; short: string | null } | null): boolean {
    if (this.linked(contactId) || this.waiting(contactId)) return true;
    if (!prints) return false;
    const reviews = this.db.all<{ id: string }>(
      `SELECT r.id FROM zur_reviews r WHERE (r.name_fp = ? OR (? IS NOT NULL AND r.short_fp = ?))
         AND NOT EXISTS (SELECT 1 FROM zur_review_matches m WHERE m.review_id = r.id) LIMIT 5`,
      prints.full,
      prints.short,
      prints.short,
    );
    for (const review of reviews) this.write(review.id, "guess", null, [contactId]);
    return reviews.length > 0;
  }

  /** A review is waiting for the owner's choice among its candidates. */
  waiting(contactId: string): boolean {
    return this.db.one(`SELECT 1 AS yes FROM zur_review_match_candidates WHERE contact_id = ? LIMIT 1`, contactId) !== null;
  }

  /**
   * The owner's word: a contact among the candidates ("É esta", "É ele"), or null ("Nenhuma das
   * duas", "Não é", or undoing a link made by itself). Kept for ever.
   */
  decide(reviewId: string, contactId: string | null): void {
    const row = this.db.one<MatchRow>(`SELECT * FROM zur_review_matches WHERE review_id = ?`, reviewId);
    if (!row || row.kind === "none") throw new AppError("CONFLICT", "error.reviewMatchGone");
    if (contactId !== null) {
      const candidates = parseList(row.candidates);
      if ((row.kind !== "twins" && row.kind !== "guess") || !candidates.includes(contactId)) throw new AppError("VALIDATION_FAILED", "error.reviewMatchContact");
      // One review each: a contact already linked to another review is someone else.
      if (this.linked(contactId)) throw new AppError("CONFLICT", "error.reviewMatchTaken");
    } else if (row.kind === "confirmed") {
      throw new AppError("CONFLICT", "error.reviewMatchGone");
    }
    this.db.transaction(() => {
      this.db.run(
        `UPDATE zur_review_matches SET kind = ?, contact_id = ?, candidates = '[]', at = ? WHERE review_id = ?`,
        contactId === null ? "none" : "confirmed",
        contactId,
        this.now(),
        reviewId,
      );
      this.db.run(`DELETE FROM zur_review_match_candidates WHERE review_id = ?`, reviewId);
    });
  }

  /** A review's link as its card shows it; null without one (or after "Nenhuma"). */
  forReview(reviewId: string, createdAt: number): ReviewMatch | null {
    const row = this.db.one<MatchRow>(`SELECT * FROM zur_review_matches WHERE review_id = ?`, reviewId);
    if (!row || row.kind === "none") return null;
    const contacts = this.deps.contacts();
    if (row.contact_id) {
      const reach = contacts.reach(row.contact_id);
      return { kind: row.kind, contact: reach ? { id: row.contact_id, name: reach.name } : null, candidates: [] };
    }
    const candidates: (ReviewMatchCandidate & { score: number })[] = [];
    for (const id of parseList(row.candidates)) {
      const reach = contacts.reach(id);
      if (!reach) continue;
      const request = this.db.one<{ sent_at: number | null; appointment_day: string; id: string }>(`SELECT id, sent_at, appointment_day FROM zur_review_requests WHERE contact_id = ?`, id);
      const opened = request
        ? this.db.one(`SELECT 1 AS yes FROM zur_review_links WHERE request_id = ? AND opened_at >= ? AND opened_at <= ? LIMIT 1`, request.id, createdAt - 7 * DAY, createdAt) !== null
        : false;
      const requested = request?.sent_at != null && request.sent_at >= createdAt - 30 * DAY && request.sent_at <= createdAt;
      const seen = request ? Date.parse(`${request.appointment_day}T12:00:00Z`) >= createdAt - 60 * DAY && Date.parse(`${request.appointment_day}T00:00:00Z`) <= createdAt : false;
      const mobile = reach.phones.find((phone) => /^\+55\d{2}9\d{8}$/.test(phone)) ?? reach.phones[0] ?? "";
      candidates.push({
        id,
        name: reach.name,
        phoneEnd: mobile.length >= 8 ? mobile.slice(-4) : "",
        email: maskEmail(reach.emails[0] ?? ""),
        requestedAt: request?.sent_at != null ? new Date(request.sent_at).toISOString() : null,
        opened,
        best: false,
        // The strongest clue first: the link opened, then the request, then the appointment (8.1b).
        score: opened ? 3 : requested ? 2 : seen ? 1 : 0,
      });
    }
    const top = Math.max(0, ...candidates.map((item) => item.score));
    const leaders = candidates.filter((item) => item.score === top);
    if (top > 0 && leaders.length === 1 && leaders[0]) leaders[0].best = true;
    return { kind: row.kind, contact: null, candidates: candidates.map(({ score: _score, ...item }) => item) };
  }

  /** The cards' numbers of Avaliações › Pedidos: reviews read, linked, waiting for the owner and without a contact. */
  counts(): { read: number; linked: number; pending: number; none: number } {
    const rows = this.db.all<{ kind: string; n: number }>(`SELECT kind, n FROM zur_counts WHERE kind IN ('reviews', 'review_matches_linked', 'review_matches_pending')`);
    const of = (kind: string) => Math.max(0, rows.find((row) => row.kind === kind)?.n ?? 0);
    const read = of("reviews");
    const linked = of("review_matches_linked");
    const pending = of("review_matches_pending");
    return { read, linked, pending, none: Math.max(0, read - linked - pending) };
  }

  /** A review that is gone (an unticked profile, the module off): its link and candidates go too. */
  static forget(db: Database, reviewIds?: readonly string[]): void {
    if (!reviewIds) {
      db.run(`DELETE FROM zur_review_match_candidates`);
      db.run(`DELETE FROM zur_review_matches`);
      return;
    }
    for (const id of reviewIds) {
      db.run(`DELETE FROM zur_review_match_candidates WHERE review_id = ?`, id);
      db.run(`DELETE FROM zur_review_matches WHERE review_id = ?`, id);
    }
  }
}

function parseList(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && /^[0-9a-f-]{36}$/.test(item)) : [];
  } catch {
    return [];
  }
}

/** "ana@exemplo.com.br" as "an•••@exemplo.com.br": enough to tell two people apart, not to read it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "";
  const user = email.slice(0, at);
  return `${[...user].slice(0, Math.min(2, user.length - 1) || 1).join("")}•••${email.slice(at)}`;
}
