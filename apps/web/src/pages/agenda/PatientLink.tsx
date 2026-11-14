import type { AgendaEvent, BookingPage, BookingPerson, ContactDetail } from "@zuri/shared";
import { HOME_COUNTRY } from "@zuri/shared";
import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { Link } from "react-router";
import { Button, TextField } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { phoneText } from "../../lib/agenda-fields.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { useDebounced } from "../../lib/lists.tsx";

/**
 * The link of an appointment to a person of Contacts (E5f, plano agenda-vinculo-com-contatos.md): the
 * name field looks in Zuri's copy of Contacts, never at Google, and nothing links on its own. Homonyms
 * are different people (12/11/2026): with two or more of one name, the owner picks the right one or
 * says it is someone else, and then the phone is what tells them apart.
 */

/** Lower case without accents, as the server folds a name (`searchText`). */
export const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const PEOPLE_KEY = "agenda-people";

/** The people of a name, as typed: from two letters on, a moment after the last key (rule P11). */
export function usePeople(name: string, enabled: boolean) {
  const typed = useDebounced(fold(name), 200);
  return useQuery({
    queryKey: [PEOPLE_KEY, typed],
    queryFn: ({ signal }) => api<BookingPage>(`/contacts?for=booking&q=${encodeURIComponent(typed)}`, { signal }),
    enabled: enabled && typed.length >= 2,
    staleTime: 30_000,
  });
}

/** "nasc. 02/09/1995", "nasc. 02/09" without the year, or "sem data de nascimento". */
export function useBirth() {
  const { t } = useI18n();
  return (birthday: string | null | undefined) => {
    const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday ?? "");
    if (full) return t("web.agenda.link.birth", { date: `${full[3]}/${full[2]}/${full[1]}` });
    const part = /^(\d{2})-(\d{2})$/.exec(birthday ?? "");
    return part ? t("web.agenda.link.birth", { date: `${part[2]}/${part[1]}` }) : t("web.agenda.link.noBirth");
  };
}

const dayMonth = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** The person a link shows: from the list just picked, or from the contact's card. */
export type LinkedPerson = Pick<BookingPerson, "name" | "phone" | "email" | "birthday">;

export function linkedOf(contact: ContactDetail): LinkedPerson {
  return { name: contact.name, phone: contact.phones[0]?.value ?? "", email: contact.emails[0]?.value ?? "", birthday: contact.birthdayFull ?? "" };
}

/**
 * The name of an appointment, as a combobox: the list offers the people of Contacts and, last, "Agendar
 * “nome” sem vínculo". Arrows move, Enter picks, Esc closes the list (and not the dialog).
 */
export function PatientNameField({
  label,
  value,
  error,
  page,
  startOpen,
  onType,
  onPick,
  children,
}: {
  label: string;
  value: string;
  error: string | null;
  page: BookingPage | undefined;
  /** "Vincular" in the details: the form opens with the list. */
  startOpen: boolean;
  onType: (text: string) => void;
  onPick: (person: BookingPerson) => void;
  /** The line under the field: one contact of this name, or homonyms. */
  children?: ReactNode;
}) {
  const { t, plural } = useI18n();
  const birth = useBirth();
  const listId = useId();
  const [open, setOpen] = useState(startOpen);
  const [active, setActive] = useState(-1);
  const people = page?.people ?? [];
  const shown = open && value.trim().length >= 2 && page !== undefined;
  // The options: each person, then "sem vínculo" (index people.length).
  const count = people.length + 1;
  const optionId = (index: number) => `${listId}-${index}`;
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!shown) {
      if (e.key === "ArrowDown" && value.trim().length >= 2) {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((old) => (e.key === "ArrowDown" ? (old + 1) % count : old <= 0 ? count - 1 : old - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      // The list closes; the dialog stays.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };
  const choose = (index: number) => {
    const person = people[index];
    setOpen(false);
    setActive(-1);
    if (person) onPick(person);
  };
  return (
    <div className="relative space-y-1.5">
      <TextField
        data-field="name"
        label={label}
        value={value}
        maxLength={200}
        required
        autoFocus
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
        error={error}
        onKeyDown={keys}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onType(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
      />
      {shown && (
          <div
            id={listId}
            role="listbox"
            aria-label={t("web.agenda.link.list")}
            className="absolute inset-x-0 z-20 mt-1 max-h-80 overflow-auto rounded-lg border border-border bg-raised p-1 shadow-lg"
          >
            {people.map((person, index) => (
              <div
                key={person.id}
                id={optionId(index)}
                role="option"
                tabIndex={-1}
                aria-selected={active === index}
                className={`min-h-11 cursor-pointer rounded-md px-3 py-2 text-sm ${active === index ? "bg-accent-soft" : "hover:bg-subtle"}`}
                // Picked before the field's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(index);
                }}
              >
                <span className="block font-medium">{person.name}</span>
                <span className="block text-xs text-fg-muted tabular-nums">
                  {[person.phone || t("web.agenda.link.noPhone"), birth(person.birthday), person.lastVisit ? t("web.agenda.link.last", { date: dayMonth(person.lastVisit) }) : ""].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))}
            <div
              id={optionId(people.length)}
              role="option"
              tabIndex={-1}
              aria-selected={active === people.length}
              className={`flex min-h-11 cursor-pointer items-center rounded-md px-3 py-2 text-sm text-fg-muted ${active === people.length ? "bg-accent-soft" : "hover:bg-subtle"}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(people.length);
              }}
            >
              {t("web.agenda.link.none", { name: value.trim() })}
            </div>
          </div>
      )}
      {/* Always there, so a screen reader hears the first count too (QA-E5f-09). */}
      <p className="sr-only" aria-live="polite">
        {shown ? plural("web.agenda.link.results", people.length) : ""}
      </p>
      {children}
    </div>
  );
}

/** A linked patient in the form: the contact's data, only to read, with "Remover vínculo". */
export function LinkedPatient({ person, onRemove }: { person: LinkedPerson; onRemove: () => void }) {
  const { t } = useI18n();
  const birth = useBirth();
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm" data-linked>
      <p className="font-medium">{t("web.agenda.link.linked", { name: person.name, birth: birth(person.birthday) })}</p>
      {(person.phone || person.email) && (
        <p className="text-fg-muted">
          {person.phone && <span className="block tabular-nums">{person.phone}</span>}
          {person.email && <span className="block break-all">{person.email}</span>}
        </p>
      )}
      <p className="text-xs text-fg-muted">{t("web.agenda.link.fromContacts")}</p>
      <Button variant="secondary" onClick={onRemove}>
        {t("web.agenda.link.remove")}
      </Button>
    </div>
  );
}

/** Under the name: one contact of this very name ("Vincular"), or homonyms ("É outra pessoa"). Nothing links on its own. */
export function NameHint({ name, page, other, onLink, onOther }: { name: string; page: BookingPage | undefined; other: boolean; onLink: (person: BookingPerson) => void; onOther: () => void }) {
  const { t } = useI18n();
  if (!page || name.trim().length < 2) return null;
  const typed = fold(name);
  if (page.same >= 2) {
    return (
      <div className="space-y-2 rounded-lg bg-warning-soft p-3 text-sm" role="status">
        <p>{other ? t("web.agenda.link.otherSet", { count: page.same }) : t("web.agenda.link.twins", { count: page.same, name: name.trim() })}</p>
        {!other && (
          <Button variant="secondary" onClick={onOther}>
            {t("web.agenda.link.other")}
          </Button>
        )}
      </div>
    );
  }
  const only = page.same === 1 ? page.people.find((person) => fold(person.name) === typed) : undefined;
  if (!only) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
      <span>{t("web.agenda.link.one", { name: only.name })}</span>
      <Button variant="secondary" onClick={() => onLink(only)}>
        {t("web.agenda.link.link")}
      </Button>
    </div>
  );
}

/** The patient in the details: the linked contact, with "Homônimo" and "Abrir em Contatos", or the event's own data with "Vincular". */
export function PatientLine({ event, onLink }: { event: AgendaEvent; onLink: (() => void) | undefined }) {
  const { t } = useI18n();
  const birth = useBirth();
  const contact = useQuery({
    queryKey: ["contact", event.contactId],
    queryFn: ({ signal }) => api<{ contact: ContactDetail }>(`/contacts/${encodeURIComponent(event.contactId ?? "")}`, { signal }),
    enabled: !!event.contactId,
    staleTime: 30_000,
  });
  const people = usePeople(event.title, !event.contactId);
  const linked = contact.data?.contact;
  if (event.contactId) {
    if (!linked) return <span className="text-fg-muted">{contact.isError ? t("web.agenda.event.contactGone") : "…"}</span>;
    const person = linkedOf(linked);
    return (
      <>
        <span>{t("web.agenda.event.linked", { name: person.name, birth: birth(person.birthday) })}</span>
        {linked.sameName > 0 && <span className="ml-2 rounded bg-subtle px-1.5 py-0.5 text-xs">{t("web.agenda.event.homonym")}</span>}
        {person.phone && <span className="block text-fg-muted tabular-nums">{person.phone}</span>}
        {person.email && <span className="block break-all text-fg-muted">{person.email}</span>}
        <Link to={`/contatos/${encodeURIComponent(linked.id)}`} className="mt-1 inline-flex min-h-11 items-center text-accent-text underline-offset-2 hover:underline">
          {t("web.agenda.event.openContact")}
        </Link>
      </>
    );
  }
  const same = people.data?.same ?? 0;
  return (
    <>
      <span>{event.contact ? t("web.agenda.event.contactGone") : same >= 2 ? t("web.agenda.event.newSameName", { count: same }) : t("web.agenda.event.unlinked")}</span>
      {event.phone && <span className="block text-fg-muted">{phoneText(event.country ?? HOME_COUNTRY, event.phone)}</span>}
      {event.email && <span className="block break-all text-fg-muted">{event.email}</span>}
      {onLink && (
        <Button variant="secondary" className="mt-2" onClick={onLink}>
          {t("web.agenda.link.link")}
        </Button>
      )}
    </>
  );
}
