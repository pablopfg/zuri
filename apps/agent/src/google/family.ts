import { type ContactFamily, FAMILY_LIMITS, FAMILY_ROLES, type FamilyLink, type FamilyRole } from "@zuri/shared";
import type { Database } from "../db/database.ts";
import { AppError } from "../http/errors.ts";
import type { GoogleContacts } from "./contacts.ts";

export interface FamilyDeps {
  db: Database;
  contacts: () => GoogleContacts;
}

interface Row {
  id: string;
  a: string;
  b: string;
  role_a: string;
  role_b: string;
  responsible: number;
}

/** Nodes the "Também no grupo familiar" walk opens at most: two small index reads each. */
const WALK_MAX = FAMILY_LIMITS.group + FAMILY_LIMITS.perContact;

const role = (value: string): FamilyRole => ((FAMILY_ROLES as readonly string[]).includes(value) ? (value as FamilyRole) : "spouse");

/**
 * The family of a contact (E11b, plano contatos-familia-e-ficha.md): links that only Zuri keeps, between two
 * contacts of the copy, by Google's `resourceName`. The copy itself stays read only: a link never changes
 * Google, and a contact that leaves the labels keeps its links for when it comes back. Homonyms are
 * different people (decisões, "Contatos"): a link is made by the copy's id the owner picked, never by a name.
 */
export class ContactFamilyService {
  constructor(private readonly deps: FamilyDeps) {}

  /** The card's "Família": the relatives, then the others of the group through someone else. */
  list(id: string): ContactFamily {
    const me = this.resource(id);
    const links = this.linksOf(me);
    const direct = links.map((row) => this.other(row, me));
    const known = this.deps.contacts().relatives([...new Set([...direct.map((link) => link.resource), ...this.walk(me, direct.map((link) => link.resource))])]);
    const out: FamilyLink[] = direct.map((link) => {
      const person = known.get(link.resource);
      return {
        id: link.id,
        role: link.role,
        contact: person ? { ...person, sameName: this.deps.contacts().hasHomonym(person.id, person.name) } : null,
      };
    });
    const directSet = new Set(direct.map((link) => link.resource));
    const group = [...known.entries()]
      .filter(([resource]) => !directSet.has(resource))
      .map(([, person]) => person.name)
      .sort((x, y) => x.localeCompare(y, "pt-BR"));
    return { links: out, group: group.slice(0, FAMILY_LIMITS.group), groupMore: Math.max(0, group.length - FAMILY_LIMITS.group) };
  }

  /**
   * Links a relative to the contact: `role` is what the relative is to the contact, `otherRole` what the
   * contact is to them (the schema already checked that they make a pair). One link per pair of people.
   */
  add(id: string, input: { relative: string; role: FamilyRole; otherRole: FamilyRole }): ContactFamily {
    const me = this.resource(id);
    const relative = this.resource(input.relative);
    if (relative === me) throw new AppError("VALIDATION_FAILED", "error.familySelf");
    const { db } = this.deps;
    db.transaction(() => {
      const [a, b] = me < relative ? [me, relative] : [relative, me];
      if (db.one(`SELECT 1 AS found FROM zur_contact_family WHERE a = ? AND b = ?`, a, b)) throw new AppError("CONFLICT", "error.familyLinked");
      if (this.count(me) >= FAMILY_LIMITS.perContact || this.count(relative) >= FAMILY_LIMITS.perContact) throw new AppError("CONFLICT", "error.familyFull");
      if (familyTotal(db) >= FAMILY_LIMITS.total) throw new AppError("CONFLICT", "error.familyFull");
      // role_a is what a is to b: the relative's role when the relative is a.
      const [roleA, roleB] = a === relative ? [input.role, input.otherRole] : [input.otherRole, input.role];
      db.run(`INSERT INTO zur_contact_family (id, a, b, role_a, role_b, responsible, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`, crypto.randomUUID(), a, b, roleA, roleB, Date.now());
    });
    return this.list(id);
  }

  /** Takes a link off; both contacts stay as they were. Only a link of this contact. */
  remove(id: string, link: string): ContactFamily {
    const me = this.resource(id);
    if (!/^[0-9a-f-]{36}$/.test(link)) throw new AppError("NOT_FOUND", "error.familyLinkNotFound");
    const gone = this.deps.db.run(`DELETE FROM zur_contact_family WHERE id = ? AND (a = ? OR b = ?)`, link, me, me);
    if (gone.rowsWritten === 0) throw new AppError("NOT_FOUND", "error.familyLinkNotFound");
    return this.list(id);
  }

  private resource(id: string): string {
    const resource = this.deps.contacts().resourceOf(id);
    if (!resource) throw new AppError("NOT_FOUND", "error.contactNotFound");
    return resource;
  }

  /** The links of one person, oldest first: two reads, each by its own index. */
  private linksOf(resource: string): Row[] {
    return this.deps.db.all<Row>(
      `SELECT id, a, b, role_a, role_b, responsible, created_at FROM zur_contact_family WHERE a = ?
       UNION ALL SELECT id, a, b, role_a, role_b, responsible, created_at FROM zur_contact_family WHERE b = ?
       ORDER BY created_at, id LIMIT ${FAMILY_LIMITS.perContact * 2}`,
      resource,
      resource,
    );
  }

  private count(resource: string): number {
    return familyCount(this.deps.db, resource);
  }

  /** The other side of a link and what that person is to `me`. */
  private other(row: Row, me: string): { id: string; resource: string; role: FamilyRole } {
    return row.a === me ? { id: row.id, resource: row.b, role: role(row.role_b) } : { id: row.id, resource: row.a, role: role(row.role_a) };
  }

  /** Everyone reached through the relatives (the sister of the daughter), WALK_MAX people opened at most. */
  private walk(me: string, direct: readonly string[]): string[] {
    const seen = new Set([me, ...direct]);
    const queue = [...direct];
    const found: string[] = [];
    let opened = 0;
    while (queue.length > 0 && opened < WALK_MAX) {
      const next = queue.shift() as string;
      opened++;
      for (const row of this.linksOf(next)) {
        const other = row.a === next ? row.b : row.a;
        if (seen.has(other)) continue;
        seen.add(other);
        found.push(other);
        queue.push(other);
      }
    }
    return found;
  }
}

/** The links of one person: two index reads, 40 rows at most. */
export function familyCount(db: Database, resource: string): number {
  return db.one<{ n: number }>(`SELECT (SELECT count(*) FROM zur_contact_family WHERE a = ?) + (SELECT count(*) FROM zur_contact_family WHERE b = ?) AS n`, resource, resource)?.n ?? 0;
}

/** All the links, from the count the triggers keep (migration 48): one row read. */
export function familyTotal(db: Database): number {
  return db.one<{ n: number }>(`SELECT n FROM zur_counts WHERE kind = 'contact_family'`)?.n ?? 0;
}
