import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ContactLabel, type ContactPage, type ContactsStatus, ptBRContacts } from "@zuri/shared";
import { Check, ListFilter, RefreshCw, Search, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { useToast } from "../../components/Toaster.tsx";
import { Button, buttonClass, cn, Dialog, EmptyState, ErrorNotice, fieldClass, Loading, Notice, PageHeader, useDocumentTitle } from "../../components/ui.tsx";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { CONTACTS_STATUS_KEY, contactsListKey } from "../../lib/contacts.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { useDebounced } from "../../lib/lists.tsx";
import { ContactCard } from "./ContactCard.tsx";
import { byLetter, countdown, initials, isContactId, isNamed, shownName } from "./person.ts";

// This screen's pt-BR texts travel with its code, not in the first bundle (rule P11).
addMessages(ptBRContacts);

/** How long after the hour of the next sync the screen asks the server again, at most three times. */
const DUE_CHECKS_MS = [3_000, 15_000, 30_000];

/**
 * Contacts (step 19b; Sinal, S10): the read-only copy of the owner's Google
 * contacts in the labels they chose. The list on one side, the chosen
 * contact's card on the other; the address holds who is open. The Clients tab
 * left this screen (its old address comes here); nothing here writes to Google.
 */
export function ContactsPage() {
  const { id } = useParams();
  // Only a contact's own id is ever asked of the server; anything else typed after /contatos is the list.
  if (id !== undefined && !isContactId(id)) return <Navigate to="/contatos" replace />;
  return <Screen id={id ?? null} />;
}

function Screen({ id }: { id: string | null }) {
  const { t } = useI18n();
  useDocumentTitle(t("web.contacts.title"));
  const status = useQuery({ queryKey: CONTACTS_STATUS_KEY, queryFn: ({ signal }) => api<ContactsStatus>("/google/contacts", { signal }) });

  if (!status.data?.enabled) {
    return (
      <>
        <PageHeader title={t("web.contacts.title")} />
        {status.isPending ? (
          <Loading rows={4} />
        ) : !status.data ? (
          <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
        ) : (
          <EmptyState icon={<Search className="h-6 w-6" />} title={t("web.contacts.off.title")}>
            <p>{t("web.contacts.off.body")}</p>
            <Link to="/configuracoes/integracoes" className={buttonClass("primary", "mt-4")}>
              {t("web.contacts.goIntegrations")}
            </Link>
          </EmptyState>
        )}
      </>
    );
  }
  return <Book id={id} status={status.data} checkedAt={Math.max(status.dataUpdatedAt, status.errorUpdatedAt)} onDue={() => void status.refetch()} />;
}

function Book({ id, status, checkedAt, onDue }: { id: string | null; status: ContactsStatus; checkedAt: number; onDue: () => void }) {
  const { t, plural } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [dialog, setDialog] = useState<"filter" | "pick" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const q = useDebounced(query.trim());
  const chosen = status.labels.filter((item) => item.selected);
  // The label of the filter left the copy (unchecked here or gone at Google): the filter goes with it.
  const active = chosen.find((item) => item.id === label);
  useEffect(() => {
    if (label && !active) setLabel("");
  }, [label, active]);

  const list = useInfiniteQuery({
    queryKey: contactsListKey(q, active ? label : ""),
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (active) params.set("label", label);
      if (pageParam) params.set("after", pageParam);
      const search = params.toString();
      return api<ContactPage>(`/contacts${search ? `?${search}` : ""}`, { signal });
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });

  /** `quiet`: right after the labels were saved, which already said so. */
  const sync = async (quiet = false) => {
    setSyncing(true);
    try {
      const { outcome, ...next } = await api<ContactsStatus & { outcome: string }>("/google/contacts/sync", { method: "POST" });
      qc.setQueryData(CONTACTS_STATUS_KEY, next);
      void qc.invalidateQueries({ queryKey: ["contacts", "list"] });
      if (!quiet) toast(t(outcome === "partial" ? "web.contacts.partial" : "web.contacts.synced"));
    } catch (failure) {
      // The server says how long the button rests; the screen shows the seconds.
      const wait = failure instanceof ApiError && failure.code === "RATE_LIMITED" ? failure.details.retryAfter : null;
      if (!quiet) toast(typeof wait === "number" && wait > 0 ? plural("web.contacts.syncWait", Math.ceil(wait)) : errorMessage(failure));
    } finally {
      setSyncing(false);
    }
  };

  // On a phone the card takes the list's place: coming back, the focus returns to the line it left.
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (id) last.current = id;
    else if (last.current) {
      document.querySelector<HTMLElement>(`[data-contact="${last.current}"]`)?.focus();
      last.current = null;
    }
  }, [id]);

  const contacts = list.data?.pages.flatMap((page) => page.contacts) ?? [];
  const filtered = !!q || !!active;
  return (
    <div className="zuri-contacts" data-open={id ? "" : undefined}>
      <section aria-label={t("web.contacts.listLabel")} className="zuri-contacts-list">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("web.contacts.title")}</h1>
          <button type="button" className="zuri-icon-button" aria-label={t("web.contacts.sync")} title={t("web.contacts.sync")} disabled={syncing} onClick={() => void sync()}>
            <RefreshCw className={cn("h-5 w-5", syncing && "motion-safe:animate-spin")} aria-hidden />
          </button>
        </div>
        <SyncLine status={status} checkedAt={checkedAt} onDue={onDue} />
        {status.problem ? (
          <Notice tone="warning">
            {t("web.contacts.stopped")}{" "}
            <Link to="/configuracoes/integracoes" className="font-semibold underline underline-offset-2">
              {t("web.contacts.goIntegrations")}
            </Link>
          </Notice>
        ) : (
          status.refreshing && <Notice>{t("web.contacts.refreshing")}</Notice>
        )}
        <search className="grid grid-cols-[1fr_auto] gap-2">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <input
              type="search"
              value={query}
              maxLength={100}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("web.contacts.search.hint")}
              aria-label={t("web.contacts.search")}
              className={cn(fieldClass, "pl-9")}
            />
          </div>
          <button
            type="button"
            className="zuri-icon-button border border-border-strong bg-surface"
            aria-label={t("web.contacts.filter")}
            title={t("web.contacts.filter")}
            aria-haspopup="dialog"
            onClick={() => setDialog("filter")}
          >
            <ListFilter className="h-5 w-5" aria-hidden />
          </button>
        </search>
        {active && (
          <p className="flex items-center gap-1 text-sm">
            <span className="min-w-0 truncate font-medium">{t("web.contacts.filter.active", { nome: active.name })}</span>
            <button type="button" className="zuri-icon-button" aria-label={t("web.contacts.filter.clear")} title={t("web.contacts.filter.clear")} onClick={() => setLabel("")}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </p>
        )}
        {list.isPending ? (
          <Loading rows={4} />
        ) : list.isError && contacts.length === 0 ? (
          <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
        ) : contacts.length === 0 ? (
          filtered ? (
            <p className="px-1 py-6 text-center text-sm text-fg-muted">{t("web.contacts.empty")}</p>
          ) : (
            <EmptyState icon={<Search className="h-6 w-6" />} title={t("web.contacts.emptyAll")}>
              <p>{t("web.contacts.emptyAll.body")}</p>
              <Button className="mt-4" aria-haspopup="dialog" onClick={() => setDialog("pick")}>
                {t("web.contacts.filter.choose")}
              </Button>
            </EmptyState>
          )
        ) : (
          <>
            {byLetter(contacts).map((group) => (
              <section key={group.letter} aria-labelledby={`zuri-contacts-${group.letter}`}>
                <h2 id={`zuri-contacts-${group.letter}`} className="px-3 py-1 text-xs font-semibold text-fg-muted">
                  {group.letter}
                </h2>
                <ul>
                  {group.contacts.map((contact) => {
                    const named = isNamed(contact);
                    return (
                      <li key={contact.id}>
                        <Link to={`/contatos/${contact.id}`} data-contact={contact.id} aria-current={contact.id === id ? "true" : undefined} className="zuri-contact-row">
                          <span aria-hidden className="zuri-contact-mark">
                            {(named && initials(contact.name)) || "?"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{shownName(contact) || t("web.contacts.noName")}</span>
                            <span className="block truncate text-xs text-fg-muted">{named ? [contact.phone, contact.email].filter(Boolean).join(" · ") : shownName(contact) && t("web.contacts.noName")}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {list.hasNextPage && (
              <div className="flex justify-center">
                <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                  {t("web.contacts.more")}
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-label={t("web.contacts.person.label")} className="zuri-contacts-card">
        {id ? <ContactCard key={id} id={id} /> : <p className="py-10 text-center text-sm leading-6 text-fg-muted">{t("web.contacts.person.pick")}</p>}
      </section>

      <Dialog open={dialog === "filter"} onClose={() => setDialog(null)} title={t("web.contacts.filter")}>
        <LabelFilter
          labels={chosen}
          total={status.contacts}
          current={active ? label : ""}
          onPick={(next) => {
            setLabel(next);
            setDialog(null);
          }}
          onChoose={() => setDialog("pick")}
        />
      </Dialog>
      <Dialog open={dialog === "pick"} onClose={() => setDialog(null)} title={t("web.contacts.pick.title")}>
        <LabelPicker
          status={status}
          onSaved={() => {
            setDialog(null);
            // A new choice is copied at once (the server gives the minute back for it); if this read fails, the next one by itself does it.
            void sync(true);
          }}
        />
      </Dialog>
    </div>
  );
}

/**
 * "Nada mudou às 08:08 · Próxima em 4:12". The count runs on the screen's own
 * clock from the hour the server gave; once it is due the screen asks the
 * state again a few times (one row each), since a read that brings nothing
 * sends no news. Never inside a live region: it would be read every second.
 */
function SyncLine({ status, checkedAt, onDue }: { status: ContactsStatus; checkedAt: number; onDue: () => void }) {
  const { t, plural, locale, timeZone } = useI18n();
  const next = status.nextSyncAt ? Date.parse(status.nextSyncAt) : null;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (next === null) return;
    // The clock is read again here: the one from the first draw may be minutes old.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [next]);
  const due = next !== null && next - now <= 0;
  const tries = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new hour from the server starts the tries again
  useEffect(() => {
    tries.current = 0;
  }, [next]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again after each answer or failure (checkedAt), with that render's onDue
  useEffect(() => {
    const wait = due ? DUE_CHECKS_MS[tries.current] : undefined;
    if (wait === undefined) return;
    const timer = setTimeout(() => {
      tries.current++;
      onDue();
    }, wait);
    return () => clearTimeout(timer);
  }, [due, checkedAt]);

  const hora = status.lastSyncAt ? new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(status.lastSyncAt)) : "";
  const last =
    status.lastResult === "failed" ? t("web.contacts.last.failed") : !hora ? t("web.contacts.last.first") : t(status.lastResult === "changed" ? "web.contacts.last.changed" : "web.contacts.last.unchanged", { hora });
  return (
    <div className="space-y-0.5 text-sm">
      <p className="flex items-center gap-2">
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", status.problem || status.lastResult === "failed" ? "bg-warning" : "bg-success")} />
        {t("web.contacts.source", { count: plural("web.contacts.count", status.contacts) })}
      </p>
      <p className="text-fg-muted">
        {last}
        {next !== null && (
          <>
            {" · "}
            {due ? (
              t("web.contacts.next.now")
            ) : (
              <>
                {t("web.contacts.next")} <strong className="font-semibold tabular-nums text-fg">{countdown(next - now)}</strong>
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}

/** The labels the copy holds, to show only one of them. A list that opens, with its own search: nothing scrolls sideways. */
function LabelFilter({ labels, total, current, onPick, onChoose }: { labels: ContactLabel[]; total: number; current: string; onPick: (id: string) => void; onChoose: () => void }) {
  const { t, plural } = useI18n();
  const [query, setQuery] = useState("");
  const fold = (text: string) => text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
  const wanted = fold(query.trim());
  const shown = wanted ? labels.filter((label) => fold(label.name).includes(wanted)) : labels;
  const row = (id: string, name: string, count: number) => (
    <li key={id}>
      <button type="button" aria-pressed={current === id} onClick={() => onPick(id)} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-raised">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 tabular-nums text-fg-muted">{count}</span>
        <Check className={cn("h-4 w-4 shrink-0", current !== id && "invisible")} aria-hidden />
      </button>
    </li>
  );
  return (
    <>
      <p className="text-sm leading-6 text-fg-muted">{plural("web.contacts.filter.hint", labels.length)}</p>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <input
          type="search"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("web.contacts.filter.search")}
          aria-label={t("web.contacts.filter.search")}
          className={cn(fieldClass, "pl-9")}
        />
      </div>
      <ul className="max-h-[45dvh] overflow-y-auto">
        {!wanted && row("", t("web.contacts.allLabels"), total)}
        {shown.map((label) => row(label.id, label.name, label.count))}
      </ul>
      {wanted && shown.length === 0 && <p className="text-sm text-fg-muted">{t("web.contacts.filter.none")}</p>}
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
        {t("web.contacts.filter.missing")}
        <button type="button" onClick={onChoose} className="inline-flex min-h-11 items-center font-semibold text-fg underline underline-offset-2">
          {t("web.contacts.filter.choose")}
        </button>
      </p>
    </>
  );
}

/**
 * Which Google labels Zuri copies, saved together. Opening it reads the labels
 * as Google has them now (the server keeps that for a minute); adding one may
 * ask for the password typed recently, and the server says when.
 */
function LabelPicker({ status, onSaved }: { status: ContactsStatus; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const stored = status.labels.filter((label) => label.selected).map((label) => label.id);
  const [chosen, setChosen] = useState<string[]>(stored);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the list opens
  useEffect(() => {
    let alive = true;
    api<ContactsStatus>("/google/contacts/labels/refresh", { method: "POST" })
      .then((next) => alive && qc.setQueryData(CONTACTS_STATUS_KEY, next))
      // Google did not answer: the labels Zuri already knows are still a fair list to choose from.
      .catch(() => undefined)
      .finally(() => alive && setReading(false));
    return () => {
      alive = false;
    };
  }, []);
  const changed = [...chosen].sort().join("\n") !== [...stored].sort().join("\n");
  const leaving = status.labels.filter((label) => label.selected && !chosen.includes(label.id)).map((label) => label.name);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Only labels that still exist: one gone at Google while the list was open is not sent back.
      const selected = chosen.filter((id) => status.labels.some((label) => label.id === id));
      qc.setQueryData(CONTACTS_STATUS_KEY, await api<ContactsStatus>("/google/contacts/labels", { method: "PATCH", body: { selected } }));
      void qc.invalidateQueries({ queryKey: ["contacts", "list"] });
      toast(t("web.contacts.pick.saved"));
      onSaved();
    } catch (failure) {
      toast(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4">
      <p className="text-sm leading-6 text-fg-muted">{t("web.contacts.pick.hint")}</p>
      {status.labels.length === 0 ? (
        reading ? (
          <Loading rows={3} />
        ) : (
          <p className="text-sm text-fg-muted">{t("web.contacts.pick.empty")}</p>
        )
      ) : (
        <ul className="max-h-[45dvh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {status.labels.map((label) => (
            <li key={label.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                  checked={chosen.includes(label.id)}
                  onChange={(e) => setChosen((list) => (e.target.checked ? [...list, label.id] : list.filter((id) => id !== label.id)))}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{label.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-fg-muted">{label.count}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {leaving.length > 0 && <Notice tone="warning">{t("web.contacts.pick.leaving", { nomes: new Intl.ListFormat(locale, { type: "disjunction" }).format(leaving) })}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" loading={saving} disabled={!changed}>
          {t("web.contacts.pick.save")}
        </Button>
      </div>
    </form>
  );
}
