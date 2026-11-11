import { useQuery } from "@tanstack/react-query";
import type { AppointmentKind, ContactAppointment, ContactAppointments, ContactDetail, ContactList, ContactValue, Memory, MessageKey } from "@zuri/shared";
import {
  ArrowLeft,
  AtSign,
  BotMessageSquare,
  Building2,
  Cake,
  CalendarCheck2,
  CalendarClock,
  CalendarHeart,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  IdCard,
  Link2,
  Lock,
  type LucideIcon,
  MailOpen,
  MapPinned,
  MessageCircle,
  Phone,
  PhoneCall,
  Rows3,
  StickyNote,
  Tags,
  UsersRound,
} from "lucide-react";
import { type ReactNode, useCallback } from "react";
import { Link } from "react-router";
import { useToast } from "../../components/Toaster.tsx";
import { cn, ErrorNotice, Loading, Notice } from "../../components/ui.tsx";
import { ApiError, api } from "../../lib/api.ts";
import { contactKey } from "../../lib/contacts.ts";
import { Avatar } from "./Avatar.tsx";
import { useI18n } from "../../lib/i18n.tsx";
import { CARD_GROUPS, type CardGroup, daysApart, dayText, dialNumber, emptyGroups, hasGroup, isNamed, localDay, shownName, siteHref, siteText, whatsappNumber, whatsappOf } from "./person.ts";

const GROUP: Record<CardGroup, { icon: LucideIcon; title: MessageKey }> = {
  name: { icon: IdCard, title: "web.contacts.group.name" },
  phones: { icon: Phone, title: "web.contacts.group.phones" },
  emails: { icon: AtSign, title: "web.contacts.group.emails" },
  addresses: { icon: MapPinned, title: "web.contacts.group.addresses" },
  birthday: { icon: Cake, title: "web.contacts.group.birthday" },
  dates: { icon: CalendarHeart, title: "web.contacts.group.dates" },
  relations: { icon: UsersRound, title: "web.contacts.group.relations" },
  company: { icon: Building2, title: "web.contacts.group.company" },
  urls: { icon: Link2, title: "web.contacts.group.urls" },
  chats: { icon: MessageCircle, title: "web.contacts.group.chats" },
  labels: { icon: Tags, title: "web.contacts.group.labels" },
  fields: { icon: Rows3, title: "web.contacts.group.fields" },
  notes: { icon: StickyNote, title: "web.contacts.group.notes" },
};

/** The title of each box follows the type written in the event: a return is never called a consultation. */
const LAST_TITLE: Record<AppointmentKind, MessageKey> = { consultation: "web.contacts.visits.last.consultation", return: "web.contacts.visits.last.return", other: "web.contacts.visits.last.other" };
const NEXT_TITLE: Record<AppointmentKind, MessageKey> = { consultation: "web.contacts.visits.next.consultation", return: "web.contacts.visits.next.return", other: "web.contacts.visits.next.other" };

/** Memories shown on the card; the rest are a search away in Memória. */
const KNOWN_MAX = 3;

/**
 * One contact, whole (Sinal, S10): who it is, the four doors (ask Zuri, call,
 * WhatsApp, e-mail), what Zuri's memory says about them and every field Google
 * has, in Google Contacts' own order. A group with nothing is named in one
 * line at the end, never drawn as a blank row. All of it is the owner's text
 * from Google: shown as text, and only an http(s) site becomes a link.
 */
export function ContactCard({ id }: { id: string }) {
  const { t } = useI18n();
  const one = useQuery({
    queryKey: contactKey(id),
    queryFn: ({ signal }) => api<{ contact: ContactDetail }>(`/contacts/${encodeURIComponent(id)}`, { signal }),
    // A contact that left the copy is an answer, not a failure to try again.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  // On a phone the card takes the list's place: the focus goes to the name as soon as it is drawn.
  const heading = useCallback((node: HTMLHeadingElement | null) => {
    if (node && !window.matchMedia("(min-width: 1024px)").matches) node.focus();
  }, []);
  const contact = one.data?.contact;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/contatos" className="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-fg-muted hover:bg-raised hover:text-fg lg:hidden">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("web.contacts.person.back")}
      </Link>
      {one.isPending ? (
        <Loading rows={4} />
      ) : !contact ? (
        one.error instanceof ApiError && one.error.status === 404 ? (
          <p className="py-10 text-center text-sm leading-6 text-fg-muted">{t("web.contacts.person.gone")}</p>
        ) : (
          <ErrorNotice error={one.error} onRetry={() => void one.refetch()} />
        )
      ) : (
        <Whole contact={contact} heading={heading} />
      )}
    </div>
  );
}

function Whole({ contact, heading }: { contact: ContactDetail; heading: (node: HTMLHeadingElement | null) => void }) {
  const { t, locale } = useI18n();
  const named = isNamed(contact);
  const name = shownName(contact) || t("web.contacts.noName");
  const phone = contact.phones[0]?.value ?? "";
  const dial = dialNumber(phone);
  const whatsapp = whatsappOf(contact.phones);
  const email = contact.emails[0]?.value ?? "";
  const role = [contact.jobTitle, contact.organization].filter(Boolean).join(" · ");
  const google = siteHref(contact.googleUrl);
  return (
    <>
      <header className="flex items-start gap-4">
        <Avatar name={named ? contact.name : null} photo={contact.photo} big />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight break-words focus:outline-none">
            {name}
          </h2>
          {named || !(contact.phone || contact.email) ? role && <p className="break-words text-fg-muted">{role}</p> : <p className="text-fg-muted">{t(contact.phone ? "web.contacts.person.noName.phone" : "web.contacts.person.noName.email")}</p>}
          {contact.note && (
            <p className="text-sm text-fg-muted">
              <span className="sr-only">{t("web.contacts.note")} </span>
              <span className="zuri-contact-chip border border-border bg-transparent">{contact.note}</span>
            </p>
          )}
          {contact.labels.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t("web.contacts.group.labels")}>
              {contact.labels.map((label) => (
                <li key={label} className="zuri-contact-chip">
                  {label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {named && (
          <Link to="/conversa" state={{ draft: t("web.contacts.ask.message", { nome: contact.name.trim() }) }} className="zuri-contact-door border-transparent bg-accent-soft text-accent-text">
            <BotMessageSquare className="h-5 w-5" aria-hidden />
            {t("web.contacts.ask")}
          </Link>
        )}
        <Door href={dial ? `tel:${dial}` : null} icon={PhoneCall} label={t("web.contacts.call")} off={t("web.contacts.noPhone")} />
        <Door href={whatsapp ? `https://wa.me/${whatsapp}` : null} icon={MessageCircle} label={t("web.contacts.whatsapp")} off={t(dial ? "web.contacts.noMobile" : "web.contacts.noPhone")} outside />
        <Door href={email ? `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}` : null} icon={MailOpen} label={t("web.contacts.email")} off={t("web.contacts.noEmail")} />
      </div>

      {contact.sameName > 0 && (
        <Notice tone="warning">
          {t("web.contacts.sameName")}{" "}
          {[
            contact.phone,
            contact.birthdayFull && t("web.contacts.born", { data: dayText(contact.birthdayFull, locale) }),
            contact.cpf && t("web.contacts.cpf", { cpf: contact.cpf }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Notice>
      )}

      {named && <Appointments id={contact.id} />}

      {named && <Known name={contact.name.trim()} />}

      <section className="zuri-contact-box" aria-labelledby="zuri-contact-data">
        <h3 id="zuri-contact-data">{t("web.contacts.data")}</h3>
        <dl className="divide-y divide-border">
          {CARD_GROUPS.filter((group) => hasGroup(contact, group)).map((group) => (
            <Group key={group} group={group} contact={contact} />
          ))}
        </dl>
        <Empty contact={contact} />
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-fg-muted">
          <span className="flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0" aria-hidden />
            {t("web.contacts.readOnly")}
          </span>
          {google && (
            <a href={google} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-accent-text underline-offset-2 hover:underline">
              <ExternalLink className="h-4 w-4" aria-hidden />
              {t("web.contacts.openGoogle")}
            </a>
          )}
        </p>
      </section>
    </>
  );
}

/**
 * The last appointment and the next one, each named by its type, read from the calendar when the card opens (and again after a
 * minute): the event carries the person's name as its title and the type in its description.
 */
function Appointments({ id }: { id: string }) {
  const { t } = useI18n();
  const found = useQuery({
    queryKey: [...contactKey(id), "appointments"],
    queryFn: ({ signal }) => api<ContactAppointments>(`/contacts/${encodeURIComponent(id)}/appointments`, { signal }),
    staleTime: 60_000,
    retry: false,
  });
  const data = found.data;
  const unsure = !!data && [data.last, data.next].some((item) => item && !item.certain);
  return (
    <section className="zuri-contact-box space-y-3" aria-labelledby="zuri-contact-visits" aria-busy={found.isPending}>
      <h3 id="zuri-contact-visits">{t("web.contacts.visits")}</h3>
      {found.isPending ? (
        <Loading rows={1} />
      ) : !data ? (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
          {t("web.contacts.visits.failed")}
          <button type="button" onClick={() => void found.refetch()} className="inline-flex min-h-11 items-center font-semibold text-fg underline underline-offset-2">
            {t("web.retry")}
          </button>
        </p>
      ) : !data.available ? (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
          {t("web.contacts.visits.off")}
          <Link to="/configuracoes/integracoes" className="inline-flex min-h-11 items-center font-semibold text-fg underline underline-offset-2">
            {t("web.contacts.goIntegrations")}
          </Link>
        </p>
      ) : (
        <>
          {data.last || data.next ? (
            <dl className={cn("grid gap-3", data.last && data.next && "sm:grid-cols-2")}>
              {/* With nothing ahead the past one is just "the last appointment", whatever its type. */}
              {data.last && <Visit icon={CalendarCheck2} title={t(data.next ? LAST_TITLE[data.last.kind] : "web.contacts.visits.last.other")} item={data.last} />}
              {data.next && <Visit icon={CalendarClock} title={t(NEXT_TITLE[data.next.kind])} item={data.next} />}
            </dl>
          ) : (
            <p className="text-sm text-fg-muted">{t("web.contacts.visits.none")}</p>
          )}
          {unsure && <Notice tone="warning">{t("web.contacts.visits.unsure")}</Notice>}
          {data.more && <p className="text-xs text-fg-muted">{t("web.contacts.visits.more")}</p>}
        </>
      )}
    </section>
  );
}

function Visit({ icon: Icon, title, item }: { icon: LucideIcon; title: string; item: ContactAppointment }) {
  const { locale, timeZone } = useI18n();
  const day = item.allDay ? item.start : localDay(new Date(item.start), timeZone);
  const hour = item.allDay ? "" : new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(item.start));
  const when = [dayText(day, locale), hour].filter(Boolean).join(", ");
  const apart = daysApart(day, localDay(new Date(), timeZone), locale);
  return (
    <div className="space-y-1 rounded-xl border border-border p-3">
      <dt className="zuri-contact-term">
        <Icon className="h-4 w-4" aria-hidden />
        {title}
      </dt>
      <dd className="space-y-0.5">
        <p className="font-semibold">{when}</p>
        <p className="text-sm text-fg-muted">{[apart, [item.type, item.place].filter(Boolean).join(" | ")].filter(Boolean).join(" · ")}</p>
      </dd>
    </div>
  );
}

/** A door of the card: a link when there is somewhere to go, a dimmed box that says why when there is not. */
function Door({ href, icon: Icon, label, off, outside }: { href: string | null; icon: LucideIcon; label: string; off: string; outside?: boolean }) {
  if (!href) {
    return (
      <span className="zuri-contact-door" aria-disabled="true">
        <Icon className="h-5 w-5" aria-hidden />
        {off}
      </span>
    );
  }
  return (
    <a href={href} className="zuri-contact-door" {...(outside ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      <Icon className="h-5 w-5" aria-hidden />
      {label}
    </a>
  );
}

/** What the memory holds with this name: the same search the Memória screen does, three at most. */
function Known({ name }: { name: string }) {
  const { t } = useI18n();
  // Under "memories": a memory kept or forgotten anywhere refreshes the card too (lib/versions.ts).
  const found = useQuery({
    queryKey: ["memories", "about", name],
    queryFn: ({ signal }) => api<{ memories: Memory[] }>(`/memories?q=${encodeURIComponent(name.slice(0, 100))}&limit=${KNOWN_MAX}`, { signal }),
    staleTime: 60_000,
  });
  // The memory is a help on this card, never its point: a search that failed leaves the section out.
  if (!found.data) return null;
  return (
    <section className="zuri-contact-box space-y-3" aria-labelledby="zuri-contact-known">
      <h3 id="zuri-contact-known">{t("web.contacts.known")}</h3>
      {found.data.memories.length === 0 ? (
        <p className="text-sm leading-6 text-fg-muted">{t("web.contacts.known.none")}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {found.data.memories.map((memory) => (
              <li key={memory.id} className="rounded-xl bg-raised px-3 py-2 text-sm leading-6 break-words whitespace-pre-line">
                {memory.content}
              </li>
            ))}
          </ul>
          <Link to={`/memoria#busca=${encodeURIComponent(name)}`} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold hover:bg-raised">
            {t("web.contacts.known.open")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </>
      )}
    </section>
  );
}

function Group({ group, contact }: { group: CardGroup; contact: ContactDetail }) {
  const { t, plural, locale } = useI18n();
  const { icon: Icon, title } = GROUP[group];
  const more = group in contact.more ? (contact.more[group as ContactList] ?? 0) : 0;
  const labelled = (items: ContactValue[], draw: (item: ContactValue) => ReactNode = (item) => item.value) =>
    items.map((item, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: Google may repeat a value; the list never reorders
      <p key={index} className="break-words">
        {item.label && <span className="text-sm text-fg-muted">{item.label}: </span>}
        {draw(item)}
      </p>
    ));
  let body: ReactNode;
  switch (group) {
    case "name":
      body = (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {(
            [
              ["web.contacts.given", contact.given],
              ["web.contacts.middle", contact.middle],
              ["web.contacts.family", contact.family],
              ["web.contacts.nickname", contact.nickname],
            ] as const
          ).map(
            ([key, value]) =>
              value && (
                <span key={key} className="break-words">
                  <span className="text-sm text-fg-muted">{t(key)}: </span>
                  {value}
                </span>
              ),
          )}
        </p>
      );
      break;
    case "phones":
      body = contact.phones.map((phone, index) => {
        const whatsapp = whatsappNumber(phone.value);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: Google may repeat a number; the list never reorders
          <div key={index} className="flex items-center gap-1">
            <p className="min-w-0 flex-1 break-words">
              {phone.value}
              {phone.label && <span className="text-sm text-fg-muted"> · {phone.label}</span>}
            </p>
            {whatsapp && (
              <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" className="zuri-icon-button" aria-label={t("web.contacts.whatsappTo", { numero: phone.value })} title={t("web.contacts.whatsapp")}>
                <MessageCircle className="h-5 w-5" aria-hidden />
              </a>
            )}
            <CopyButton value={phone.value} />
          </div>
        );
      });
      break;
    case "emails":
      body = contact.emails.map((email, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Google may repeat an address; the list never reorders
        <div key={index} className="flex items-center gap-1">
          <p className="min-w-0 flex-1 break-all">
            {email.value}
            {email.label && <span className="text-sm break-normal text-fg-muted"> · {email.label}</span>}
          </p>
          <CopyButton value={email.value} />
        </div>
      ));
      break;
    case "addresses":
      body = labelled(contact.addresses);
      break;
    case "birthday":
      body = <p>{dayText(contact.birthdayFull ?? "", locale)}</p>;
      break;
    case "dates":
      body = labelled(contact.dates.map((date) => ({ label: date.label, value: dayText(date.date, locale) })));
      break;
    case "relations":
      body = labelled(contact.relations);
      break;
    case "company":
      body = <p className="break-words">{[contact.jobTitle, contact.organization].filter(Boolean).join(" · ")}</p>;
      break;
    case "urls":
      body = labelled(contact.urls, (item) => {
        const href = siteHref(item.value);
        return href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all text-accent-text underline underline-offset-2">
            {siteText(item.value)}
          </a>
        ) : (
          <span className="break-all">{item.value}</span>
        );
      });
      break;
    case "chats":
      body = labelled(contact.chats);
      break;
    case "labels":
      body = (
        <ul className="flex flex-wrap gap-1.5">
          {contact.labels.map((label) => (
            <li key={label} className="zuri-contact-chip">
              {label}
            </li>
          ))}
        </ul>
      );
      break;
    case "fields":
      body = labelled(contact.fields);
      break;
    case "notes":
      body = <p className="break-words whitespace-pre-line">{contact.notes}</p>;
      break;
  }
  return (
    <div className="space-y-1.5 py-3">
      <dt className="zuri-contact-term">
        <Icon className="h-4 w-4" aria-hidden />
        {t(title)}
      </dt>
      <dd className="space-y-1">
        {body}
        {more > 0 && <p className="text-sm text-fg-muted">{plural("web.contacts.moreAtGoogle", more)}</p>}
      </dd>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <button
      type="button"
      className="zuri-icon-button"
      aria-label={t("web.contacts.copy", { valor: value })}
      title={t("web.contacts.copy", { valor: value })}
      onClick={() => void navigator.clipboard?.writeText(value).then(() => toast(t("web.contacts.copied")), () => undefined)}
    >
      <ClipboardCopy className="h-4 w-4" aria-hidden />
    </button>
  );
}

/** "Vazio no Google: Endereço, Site, Chat." */
function Empty({ contact }: { contact: ContactDetail }) {
  const { t } = useI18n();
  const empty = emptyGroups(contact);
  if (empty.length === 0) return null;
  return (
    <div className="space-y-1 border-t border-border py-3">
      <p className="zuri-contact-term">{t("web.contacts.emptyAtGoogle")}</p>
      <p className="text-sm leading-6 text-fg-muted">{empty.map((group) => t(GROUP[group].title)).join(", ")}.</p>
    </div>
  );
}
