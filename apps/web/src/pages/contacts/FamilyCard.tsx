import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type BookingPage, type BookingPerson, type ContactFamily, FAMILY_INVERSE, FAMILY_ROLES, type FamilyRole, type MessageKey } from "@zuri/shared";
import { Plus, UsersRound, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Dialog, ErrorNotice, Loading, SelectField, TextField, cn } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { contactKey } from "../../lib/contacts.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { dayText } from "./person.ts";

/** What "Essa pessoa é" offers, in the prototype's order: "Dependente" only answers "Responsável legal". */
const FIRST: readonly FamilyRole[] = FAMILY_ROLES.filter((role) => role !== "dependent");

/** Each role's name, by its code: the catalog's lint finds every key written out. */
const ROLE: Record<FamilyRole, MessageKey> = {
  mother: "web.contacts.family.role.mother",
  father: "web.contacts.family.role.father",
  daughter: "web.contacts.family.role.daughter",
  son: "web.contacts.family.role.son",
  sister: "web.contacts.family.role.sister",
  brother: "web.contacts.family.role.brother",
  grandmother: "web.contacts.family.role.grandmother",
  grandfather: "web.contacts.family.role.grandfather",
  granddaughter: "web.contacts.family.role.granddaughter",
  grandson: "web.contacts.family.role.grandson",
  aunt: "web.contacts.family.role.aunt",
  uncle: "web.contacts.family.role.uncle",
  niece: "web.contacts.family.role.niece",
  nephew: "web.contacts.family.role.nephew",
  cousinF: "web.contacts.family.role.cousinF",
  cousinM: "web.contacts.family.role.cousinM",
  spouse: "web.contacts.family.role.spouse",
  guardian: "web.contacts.family.role.guardian",
  dependent: "web.contacts.family.role.dependent",
};
const roleKey = (role: FamilyRole) => ROLE[role];

/**
 * The card's "Família" (E11b, protótipo v51 item 10): relatives the owner linked, each with what they are to
 * this contact, and who else is in the family through them. The links live only in Zuri; Google Contacts
 * never changes. Homonyms are different people: the birthday tells them apart where two share a name.
 */
export function FamilyCard({ id, name }: { id: string; name: string }) {
  const { t, plural, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const key = [...contactKey(id), "family"];
  const family = useQuery({ queryKey: key, queryFn: ({ signal }) => api<ContactFamily>(`/contacts/${encodeURIComponent(id)}/family`, { signal }) });
  const first = name.split(" ")[0] || name;
  const addButton = `zuri-family-add-${id}`;
  const remove = (link: string, other: string) =>
    void api<ContactFamily>(`/contacts/${encodeURIComponent(id)}/family/${encodeURIComponent(link)}`, { method: "DELETE" })
      .then((next) => {
        qc.setQueryData(key, next);
        toast(t("web.contacts.family.removed", { nome: other }));
        document.getElementById(addButton)?.focus();
      })
      .catch((error: unknown) => {
        toast(errorMessage(error));
        void qc.invalidateQueries({ queryKey: key });
      });
  const data = family.data;
  return (
    <section className="zuri-contact-box space-y-3" aria-labelledby="zuri-contact-family" aria-busy={family.isPending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="zuri-contact-family" className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{t("web.contacts.family.title")}</h3>
        <Button id={addButton} variant="ghost" className="-mr-2 px-3" onClick={() => setOpen(true)} disabled={!data}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("web.contacts.family.add")}
        </Button>
      </div>
      {family.isPending ? (
        <Loading rows={1} />
      ) : !data ? (
        <ErrorNotice error={family.error} onRetry={() => void family.refetch()} />
      ) : (
        <>
          {data.links.length === 0 ? (
            <p className="text-sm leading-6 text-fg-muted">{t("web.contacts.family.none")}</p>
          ) : (
            <ul className="space-y-1">
              {data.links.map((link) => {
                const other = link.contact?.name ?? t("web.contacts.family.away");
                // Two relatives out of the labels would share one name: the role tells their buttons apart.
                const label = link.contact ? t("web.contacts.family.remove", { nome: link.contact.name }) : t("web.contacts.family.removeAway", { papel: t(roleKey(link.role)).toLowerCase() });
                return (
                  <li key={link.id} className="flex items-center gap-2">
                    <UsersRound className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                    <span className="grid min-w-0 flex-1 justify-items-start">
                      {link.contact ? (
                        <Link to={`/contatos/${encodeURIComponent(link.contact.id)}`} className="inline-flex min-h-11 items-center font-semibold break-words underline-offset-2 hover:underline">
                          {link.contact.name}
                        </Link>
                      ) : (
                        <span className="inline-flex min-h-11 items-center text-fg-muted">{other}</span>
                      )}
                      <span className="-mt-2 text-sm text-fg-muted">
                        {[t(roleKey(link.role)), link.contact?.sameName && link.contact.birthday && t("web.contacts.born", { data: dayText(link.contact.birthday, locale) })].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <button type="button" className="zuri-icon-button" aria-label={label} title={label} onClick={() => remove(link.id, other)}>
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {data.group.length > 0 && (
            <p className="text-sm text-fg-muted">
              {t("web.contacts.family.group", { nomes: data.group.join(", ") })}
              {data.groupMore > 0 && ` ${plural("web.contacts.family.groupMore", data.groupMore)}`}
            </p>
          )}
        </>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t("web.contacts.family.dialog", { nome: first })}>
        {data && (
          <LinkForm
            id={id}
            first={first}
            linked={data.links.map((link) => link.contact?.id ?? "")}
            onDone={(next, relative, role) => {
              qc.setQueryData(key, next);
              setOpen(false);
              toast(t("web.contacts.family.added", { nome: relative, papel: t(roleKey(role)).toLowerCase(), contato: name }));
              document.getElementById(addButton)?.focus();
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </Dialog>
    </section>
  );
}

/** "Ligar um parente": the relative, found by name (with phone and birthday to tell homonyms apart), and the two roles. */
function LinkForm({ id, first, linked, onDone, onCancel }: { id: string; first: string; linked: string[]; onDone: (next: ContactFamily, relative: string, role: FamilyRole) => void; onCancel: () => void }) {
  const { t, locale } = useI18n();
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<BookingPerson | null>(null);
  const [role, setRole] = useState<FamilyRole>(FIRST[0] as FamilyRole);
  const [otherRole, setOtherRole] = useState<FamilyRole>(FAMILY_INVERSE[FIRST[0] as FamilyRole][0] as FamilyRole);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useId();
  // A pause after the last key before asking the server (rule P11).
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(typed.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [typed]);
  const found = useQuery({
    queryKey: ["contacts", "booking", query],
    queryFn: ({ signal }) => api<BookingPage>(`/contacts?for=booking&q=${encodeURIComponent(query)}`, { signal }),
    enabled: query.length >= 2,
    staleTime: 15_000,
  });
  const people = (found.data?.people ?? []).filter((person) => person.id !== id && !linked.includes(person.id));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!picked) {
      setError(t("web.contacts.family.pick"));
      return;
    }
    setBusy(true);
    setError("");
    api<ContactFamily>(`/contacts/${encodeURIComponent(id)}/family`, { method: "POST", body: { relative: picked.id, role, otherRole } })
      .then((next) => onDone(next, picked.name, role))
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm leading-6 text-fg-muted">{t("web.contacts.family.dialog.body")}</p>
      <TextField
        label={t("web.contacts.family.relative")}
        // Plain text, not "search": Esc in a search box only clears it, and here it closes the dialog.
        type="text"
        autoComplete="off"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          setPicked(null);
        }}
        aria-controls={list}
        hint={t("web.contacts.family.relative.hint")}
      />
      <fieldset id={list} aria-live="polite" className="space-y-1">
        <legend className="sr-only">{t("web.contacts.family.relative")}</legend>
        {query.length >= 2 && found.isPending ? (
          <Loading rows={1} />
        ) : query.length >= 2 && found.data && people.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("web.contacts.family.nobody")}</p>
        ) : (
          people.map((person) => (
            <label key={person.id} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2", picked?.id === person.id ? "border-accent bg-accent-soft" : "border-border")}>
              <input type="radio" name="relative" checked={picked?.id === person.id} onChange={() => setPicked(person)} className="h-5 w-5 shrink-0 accent-[var(--color-accent)]" />
              <span className="min-w-0">
                <span className="block font-semibold break-words">{person.name}</span>
                <span className="block text-sm break-words text-fg-muted">{[person.phone || person.email, person.birthday && t("web.contacts.born", { data: dayText(person.birthday, locale) })].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          ))
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t("web.contacts.family.role")}
          value={role}
          onChange={(event) => {
            const next = event.target.value as FamilyRole;
            setRole(next);
            setOtherRole(FAMILY_INVERSE[next][0] as FamilyRole);
          }}
        >
          {FIRST.map((item) => (
            <option key={item} value={item}>
              {t(roleKey(item))}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("web.contacts.family.otherRole", { nome: first })} value={otherRole} onChange={(event) => setOtherRole(event.target.value as FamilyRole)}>
          {FAMILY_INVERSE[role].map((item) => (
            <option key={item} value={item}>
              {t(roleKey(item))}
            </option>
          ))}
        </SelectField>
      </div>
      <p role="status" className="text-sm text-danger empty:hidden">
        {error}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("web.cancel")}
        </Button>
        <Button type="submit" loading={busy}>
          {t("web.contacts.family.link")}
        </Button>
      </div>
    </form>
  );
}
