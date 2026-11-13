import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type MessageKey,
  REVIEW_REQUEST_GROUP,
  REVIEW_REQUEST_GROUPS,
  REVIEW_REQUEST_LIMITS,
  type ReviewRequestItem,
  type ReviewRequestSend,
  type ReviewRequestSettings,
  type ReviewRequestsBlocked,
  type ReviewRequestsPage,
  type ReviewRequestState,
  type ReviewsStatus,
  type ReviewItem,
  type ReviewMatchCandidate,
  reviewLinkProblem,
} from "@zuri/shared";
// Icons only this area uses, or ones that already have a piece of their own: one shared with another screen
// loaded on demand becomes a new piece, and its name goes into the first load (armadilhas.md).
import { ArrowUpRight, BadgeHelp, Ban, CalendarRange, ChevronRight, Hourglass, ChevronsLeft, Eye, EyeOff, Link as LinkIcon, MoveRight, RefreshCw, SendHorizontal, ShieldCheck, SlidersHorizontal, Star, Timer, CircleUser, UserSearch } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, Navigate } from "react-router";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, buttonClass, cn, Dialog, EmptyState, ErrorNotice, Loading, Notice, TextAreaField, TextField } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { REVIEWS_KEY } from "../../lib/reviews.ts";
import { whatsAppLink } from "./numbers.ts";
import { Stars } from "./parts.tsx";

export const REQUESTS_KEY = [...REVIEWS_KEY, "requests"] as const;
const SETTINGS_KEY = [...REVIEWS_KEY, "requests-settings"] as const;

const GROUP_TEXT = {
  today: "web.reviews.req.group.today",
  scheduled: "web.reviews.req.group.scheduled",
  waiting: "web.reviews.req.group.waiting",
  reviewed: "web.reviews.req.group.reviewed",
  off: "web.reviews.req.group.off",
} as const;
const STATE_TEXT: Record<ReviewRequestState, MessageKey> = {
  today: "web.reviews.req.state.today",
  reminder: "web.reviews.req.state.reminder",
  scheduled: "web.reviews.req.state.scheduled",
  waiting: "web.reviews.req.state.waiting",
  reminded: "web.reviews.req.state.reminded",
  reviewed: "web.reviews.req.state.reviewed",
  removed: "web.reviews.req.state.removed",
  pending: "web.reviews.req.state.pending",
  no_phone: "web.reviews.req.state.no_phone",
};
const TITLE_TEXT: Record<ReviewRequestState, MessageKey> = {
  today: "web.reviews.req.title.today",
  reminder: "web.reviews.req.title.reminder",
  scheduled: "web.reviews.req.title.scheduled",
  waiting: "web.reviews.req.title.waiting",
  reminded: "web.reviews.req.title.reminded",
  reviewed: "web.reviews.req.title.reviewed",
  removed: "web.reviews.req.title.removed",
  pending: "web.reviews.req.title.pending",
  no_phone: "web.reviews.req.title.no_phone",
};
const TONE: Partial<Record<ReviewRequestState, "warning" | "accent">> = { today: "warning", reminder: "warning", waiting: "warning", reminded: "warning", reviewed: "accent" };
const BLOCKED_TEXT: Record<Exclude<ReviewRequestsBlocked, "reviews">, { text: MessageKey; to: string }> = {
  link: { text: "web.reviews.req.blocked.link", to: "/avaliacoes/ajustes/pedidos" },
  contacts: { text: "web.reviews.req.blocked.contacts", to: "/configuracoes/integracoes" },
  calendar: { text: "web.reviews.req.blocked.calendar", to: "/configuracoes/integracoes" },
};
const SUM = [
  ["today", "web.reviews.req.sum.today"],
  ["scheduled", "web.reviews.req.sum.scheduled"],
  ["waiting", "web.reviews.req.sum.waiting"],
  ["reviewed", "web.reviews.req.sum.reviewed"],
] as const;

/** "27/10" of a local day ("2026-10-27"): the day itself, never moved by the device's zone. */
function useDay(): (day: string) => string {
  const { locale } = useI18n();
  return (day) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit" }).format(new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)));
  };
}

/** The first word of a contact's name, as the hints call the person. */
const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The width from which the list and the open request sit side by side (the same as in styles.css). */
const WIDE = "(min-width: 1101px)";
const isWide = () => window.matchMedia(WIDE).matches;
function watchWide(changed: () => void): () => void {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
}

/**
 * Avaliações › Pedidos (PR S20): who should get the review link, in groups, and
 * the chosen one with what happened so far. The list is made by Zuri once a day
 * from the calendar; "Enviar link de avaliação" checks everything again on the
 * server and opens the owner's WhatsApp with the text. Zuri never sends by itself.
 */
export function RequestsPart({ id }: { status: ReviewsStatus; id: string | null }) {
  const { t, dateTime } = useI18n();
  const page = useQuery({ queryKey: REQUESTS_KEY, queryFn: ({ signal }) => api<ReviewRequestsPage>("/reviews/requests", { signal }) });
  const [how, setHow] = useState(false);
  const wide = useSyncExternalStore(watchWide, isWide);
  const frame = useRef<HTMLDivElement>(null);
  const items = page.data?.items ?? [];
  const chosen = id ? items.find((item) => item.id === id) : undefined;
  // The first one the list shows (its groups' order), not the server's.
  const first = REVIEW_REQUEST_GROUPS.flatMap((group) => items.filter((item) => REVIEW_REQUEST_GROUP[item.state] === group))[0];
  const shown = chosen ?? (id || !wide ? undefined : first);
  const opened = chosen?.id ?? null;
  useEffect(() => {
    if (opened && !wide) frame.current?.querySelector<HTMLElement>(".zuri-reviews-detail h2")?.focus();
  }, [opened, wide]);
  if (id && !chosen && page.isSuccess && !page.isFetching) return <Navigate to="/avaliacoes/pedidos" replace />;
  const data = page.data;
  const blocked = data?.blocked && data.blocked !== "reviews" ? BLOCKED_TEXT[data.blocked] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" aria-haspopup="dialog" onClick={() => setHow(true)}>
          <LinkIcon className="h-4 w-4" aria-hidden />
          {t("web.reviews.req.how")}
        </Button>
        <Link to="/avaliacoes/ajustes/pedidos" className={buttonClass("ghost")}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          {t("web.reviews.req.adjust")}
        </Link>
      </div>
      {page.isPending ? (
        <Loading rows={4} />
      ) : !data ? (
        <ErrorNotice error={page.error} onRetry={() => void page.refetch()} />
      ) : (
        <>
          {blocked && (
            <Notice tone="warning">
              {t(blocked.text)}{" "}
              <Link to={blocked.to} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                {t("web.reviews.req.fix")}
              </Link>
            </Notice>
          )}
          <MatchSummary counts={data.matches} />
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
            {SUM.map(([group, key]) => (
              <span key={group}>{t(key, { n: data.counts[group] })}</span>
            ))}
            {data.builtAt && <span>{t("web.reviews.req.built", { quando: dateTime(data.builtAt) })}</span>}
          </p>
          {items.length === 0 ? (
            <EmptyState icon={<SendHorizontal className="h-6 w-6" />} title={t("web.reviews.req.empty.title")}>
              <p>{t("web.reviews.req.empty.body")}</p>
            </EmptyState>
          ) : (
            <div ref={frame} className="zuri-reviews" data-open={chosen ? "" : undefined}>
              <section aria-label={t("web.reviews.req.list.label")} className="zuri-reviews-list">
                <RequestList items={items} current={shown?.id ?? null} />
              </section>
              <section aria-label={t("web.reviews.req.detail.label")} className="zuri-reviews-detail">
                <Link to="/avaliacoes/pedidos" className="zuri-reviews-back">
                  <ChevronsLeft className="h-4 w-4" aria-hidden />
                  {t("web.reviews.part.requests")}
                </Link>
                {shown ? <RequestCard key={shown.id} item={shown} /> : <p className="py-10 text-center text-sm leading-6 text-fg-muted">{t("web.reviews.req.pick")}</p>}
              </section>
            </div>
          )}
        </>
      )}
      <LinkDialog open={how} onClose={() => setHow(false)} />
    </div>
  );
}

function RequestList({ items, current }: { items: ReviewRequestItem[]; current: string | null }) {
  const { t } = useI18n();
  const day = useDay();
  return (
    <ul>
      {REVIEW_REQUEST_GROUPS.map((group) => {
        const inGroup = items.filter((item) => REVIEW_REQUEST_GROUP[item.state] === group);
        if (inGroup.length === 0) return null;
        return (
          <li key={group}>
            <h3 className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">{t(GROUP_TEXT[group])}</h3>
            <ul>
              {inGroup.map((item) => (
                <li key={item.id}>
                  <Link to={`/avaliacoes/pedidos/${item.id}`} data-request={item.id} aria-current={item.id === current ? "true" : undefined} className="zuri-contact-row">
                    <span aria-hidden className="zuri-contact-mark">
                      {(item.name.match(/[\p{L}\p{N}]/u) ?? ["?"])[0]?.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <span className="block truncate text-xs text-fg-muted">{t("web.reviews.req.appointment", { dia: day(item.appointmentDay) })}</span>
                    </span>
                    <span className="zuri-review-pill shrink-0 tabular-nums" data-tone={TONE[item.state]}>
                      {item.state === "scheduled" ? day(item.dueDay) : t(STATE_TEXT[item.state])}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

/** One request: when, what happened, and the one action the owner has now. */
function RequestCard({ item }: { item: ReviewRequestItem }) {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const day = useDay();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const first = firstOf(item.name);
  const today = item.state === "today";

  const send = async () => {
    setBusy(true);
    // Opened now, in the tap: a window opened after the answer would be blocked by the browser.
    const tab = window.open("about:blank", "_blank");
    try {
      const answer = await api<ReviewRequestSend>(`/reviews/requests/${item.id}/send`, { method: "POST" });
      if (tab) {
        tab.opener = null;
        tab.location.replace(whatsAppLink(answer.phone, answer.text));
        toast(t("web.reviews.req.sent"));
      } else {
        toast(t("web.reviews.req.popup"));
      }
    } catch (failure) {
      tab?.close();
      toast(errorMessage(failure));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: REQUESTS_KEY });
    }
  };

  let action: ReactNode;
  if (today || item.state === "reminder") {
    action = (
      <>
        <Button variant={today ? "primary" : "secondary"} loading={busy} onClick={() => void send()}>
          <SendHorizontal className="h-4 w-4" aria-hidden />
          {t(today ? "web.reviews.req.send" : "web.reviews.req.remind")}
        </Button>
        <p className="text-xs leading-5 text-fg-muted">{today ? t("web.reviews.req.send.hint", { nome: first }) : t("web.reviews.req.remind.hint")}</p>
      </>
    );
  } else {
    const [icon, text] =
      item.state === "scheduled"
        ? [<Hourglass key="i" aria-hidden />, t("web.reviews.req.ro.scheduled", { dia: day(item.dueDay), nome: first })]
        : item.state === "waiting"
          ? [<Hourglass key="i" aria-hidden />, item.reminderDay ? t("web.reviews.req.ro.waitingOn", { dia: day(item.reminderDay), nome: first }) : t("web.reviews.req.ro.noReminder")]
          : item.state === "reminded"
            ? [<Ban key="i" aria-hidden />, t("web.reviews.req.ro.reminded")]
            : item.state === "pending"
              ? [<Ban key="i" aria-hidden />, t("web.reviews.req.ro.pending", { nome: first })]
              : item.state === "no_phone"
                ? [<Ban key="i" aria-hidden />, t("web.reviews.req.ro.no_phone", { nome: first })]
                : [<Ban key="i" aria-hidden />, t("web.reviews.req.ro.reviewed")];
    action = (
      <p className="flex items-start gap-2 text-sm leading-6 text-fg-muted [&>svg]:mt-1 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0">
        {icon}
        <span>{text}</span>
      </p>
    );
  }

  return (
    <article className="space-y-4" aria-labelledby={`${id}-who`}>
      <header className="flex items-center gap-4">
        <span aria-hidden className="zuri-contact-mark" data-big="">
          {(item.name.match(/[\p{L}\p{N}]/u) ?? ["?"])[0]?.toUpperCase()}
        </span>
        <div className="min-w-0 space-y-1">
          <h2 id={`${id}-who`} tabIndex={-1} className="break-words text-xl font-semibold tracking-tight">
            {item.name}
          </h2>
          <Link to={`/contatos/${item.contactId}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold underline underline-offset-2">
            {t("web.reviews.req.openContact")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </header>
      <section className="zuri-review-card space-y-3" aria-labelledby={`${id}-sec`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${id}-sec`} className="text-base font-semibold">
            {t("web.reviews.req.section")}
          </h3>
          <span className="zuri-review-pill" data-tone={TONE[item.state]}>
            {t(TITLE_TEXT[item.state])}
          </span>
        </div>
        <p className="flex items-start gap-2 text-sm leading-6">
          <CalendarRange className="mt-1 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
          <span>
            {t("web.reviews.req.appointment", { dia: day(item.appointmentDay) })}
            {(today || item.state === "scheduled") && ` · ${today ? t("web.reviews.req.sendToday") : t("web.reviews.req.sendOn", { dia: day(item.dueDay) })}`}
          </span>
        </p>
        {item.rating !== null && (
          <p className="flex items-center gap-2 text-sm">
            <Stars rating={item.rating} />
            <span className="text-fg-muted">{t("web.reviews.req.rating")}</span>
          </p>
        )}
        {item.steps.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("web.reviews.req.none")}</p>
        ) : (
          <ol className="space-y-2">
            {item.steps.map((step) => (
              <li key={`${step.kind}-${step.at}`} className="flex items-start gap-2 text-sm leading-6">
                <span className="mt-1 text-fg-muted [&>svg]:h-4 [&>svg]:w-4">
                  {step.kind === "reviewed" ? <Star aria-hidden /> : step.kind === "opened" ? <Eye aria-hidden /> : <SendHorizontal aria-hidden />}
                </span>
                <time dateTime={step.at} className="shrink-0 tabular-nums text-fg-muted">
                  {dateTime(step.at)}
                </time>
                <span>{step.kind === "reviewed" ? t("web.reviews.req.step.reviewed", { n: step.rating ?? 0 }) : t(STEP_TEXT[step.kind])}</span>
              </li>
            ))}
          </ol>
        )}
        {item.reviewId && (
          <Link to={`/avaliacoes/lista/${item.reviewId}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold underline underline-offset-2">
            {t("web.reviews.req.openReview")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
        <div className="space-y-2 pt-1">{action}</div>
      </section>
    </article>
  );
}

/** "Avaliações ligadas aos contatos": how many reviews Zuri read, linked, left to the owner and found nobody for. */
export function MatchSummary({ counts }: { counts: ReviewRequestsPage["matches"] }) {
  const { t } = useI18n();
  return (
    <section className="zuri-review-card space-y-2" aria-labelledby="req-match">
      <h2 id="req-match" className="flex items-center gap-2 text-base font-semibold">
        <LinkIcon className="h-4 w-4" aria-hidden />
        {t("web.reviews.match.title")}
      </h2>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
        <span>{t("web.reviews.match.read", { n: counts.read })}</span>
        <span>{t("web.reviews.match.linked", { n: counts.linked })}</span>
        <span>{t("web.reviews.match.pending", { n: counts.pending })}</span>
        <span>{t("web.reviews.match.none", { n: counts.none })}</span>
      </p>
      <p className="text-xs leading-5 text-fg-muted">{t("web.reviews.match.hint")}</p>
    </section>
  );
}

/** An invented code, only to show the shape of a request's own address. */
const SAMPLE_CODE = "k7Q2mX9pAB";

/** What each step of a request's history says (the reviewed one carries its stars). */
const STEP_TEXT = { sent: "web.reviews.req.step.sent", reminded: "web.reviews.req.step.reminded", opened: "web.reviews.req.step.opened" } as const;

/** "Como funciona o link": the example of a request's own link, step by step. */
export function LinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: ({ signal }) => api<ReviewRequestSettings>("/reviews/requests/settings", { signal }), enabled: open });
  const short = `${settings.data?.shortBase ?? "zuri.exemplo.com.br/a/"}k7Q2mX9pAB`;
  const rules: [ReactNode, MessageKey][] = [
    [<ShieldCheck key="a" aria-hidden />, "web.reviews.linkDlg.2.rule1"],
    [<EyeOff key="b" aria-hidden />, "web.reviews.linkDlg.2.rule2"],
    [<Timer key="c" aria-hidden />, "web.reviews.linkDlg.2.rule3"],
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t("web.reviews.linkDlg.title")}>
      <p className="text-sm leading-6 text-fg-muted">{t("web.reviews.linkDlg.sub")}</p>
      <ol className="mt-4 space-y-4 text-sm leading-6">
        <li className="space-y-1">
          <p className="font-semibold">1. {t("web.reviews.linkDlg.1.title")}</p>
          <p className="break-all rounded-xl bg-raised p-3 font-mono text-xs">{short}</p>
          <p className="text-fg-muted">{t("web.reviews.linkDlg.1.body", { codigo: SAMPLE_CODE })}</p>
        </li>
        <li className="space-y-2">
          <p className="font-semibold">2. {t("web.reviews.linkDlg.2.title")}</p>
          <p className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="break-all">{short}</span>
            <MoveRight className="h-4 w-4" aria-hidden />
            <span>{t("web.reviews.linkDlg.google")}</span>
          </p>
          <ul className="space-y-1">
            {rules.map(([icon, key]) => (
              <li key={key} className="flex items-start gap-2 text-fg-muted [&>svg]:mt-1 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0">
                {icon}
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </li>
        <li className="space-y-1">
          <p className="font-semibold">3. {t("web.reviews.linkDlg.3.title")}</p>
          <p className="text-fg-muted">{t("web.reviews.linkDlg.3.body")}</p>
        </li>
      </ol>
    </Dialog>
  );
}

// ---------- The review's contact, on its card ----------

/**
 * Which contact left a review (PR S20): linked by itself or by the owner, or waiting for the owner's
 * choice. Two people of one name never link by themselves; until the owner picks, none gets a request.
 */
export function ReviewMatchBlock({ review }: { review: ReviewItem }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const day = useDay();
  const [busy, setBusy] = useState<string | null>(null);
  const match = review.match;
  if (!match) return null;
  const decide = async (contactId: string | null, done: MessageKey) => {
    setBusy(contactId ?? "none");
    try {
      await api<{ review: ReviewItem }>(`/reviews/${review.id}/match`, { method: "POST", body: { contactId } });
      toast(t(done));
    } catch (failure) {
      toast(errorMessage(failure));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: REVIEWS_KEY });
    }
  };
  if (match.contact || match.kind === "auto" || match.kind === "confirmed") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-4 py-2">
        <p className="flex items-center gap-2 text-sm">
          <CircleUser className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
          <span>
            {t("web.reviews.match.linkedTo")}{" "}
            {match.contact ? (
              <Link to={`/contatos/${match.contact.id}`} className="font-semibold underline underline-offset-2">
                {match.contact.name}
              </Link>
            ) : (
              <span className="italic">{t("web.reviews.match.gone")}</span>
            )}
          </span>
        </p>
        {/* Only a link made by itself can be undone here; the owner's own choice is kept for ever. */}
        {match.kind === "auto" && (
          <Button variant="ghost" loading={busy === "none"} onClick={() => void decide(null, "web.reviews.match.undone")}>
            {t("web.reviews.match.undo")}
          </Button>
        )}
      </div>
    );
  }
  const people = match.candidates;
  if (people.length === 0) return null;
  const name = people[0]?.name ?? "";
  if (match.kind === "guess" && people.length === 1) {
    const one = people[0] as ReviewMatchCandidate;
    return (
      <div className="space-y-2 rounded-2xl border border-border bg-surface p-4">
        <p className="flex items-start gap-2 text-sm leading-6">
          <BadgeHelp className="mt-1 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
          <span>{t(one.opened ? "web.reviews.match.guessOpened" : "web.reviews.match.guess", { nome: one.name })}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy === one.id} onClick={() => void decide(one.id, "web.reviews.match.saved")}>
            {t("web.reviews.match.isHim")}
          </Button>
          <Button variant="ghost" loading={busy === "none"} onClick={() => void decide(null, "web.reviews.match.saved")}>
            {t("web.reviews.match.notHim")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4" aria-labelledby={`${review.id}-twins`}>
      <h3 id={`${review.id}-twins`} className="flex items-center gap-2 text-sm font-semibold">
        <UserSearch className="h-4 w-4 shrink-0" aria-hidden />
        {t("web.reviews.match.twins.title", { n: people.length, nome: name })}
      </h3>
      <p className="text-xs leading-5 text-fg-muted">{t("web.reviews.match.twins.hint")}</p>
      <ul className="divide-y divide-border">
        {people.map((person, index) => {
          const label = t("web.reviews.match.candidate", { nome: person.name, n: index + 1 });
          return (
            <li key={person.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-40 flex-1 basis-0 space-y-0.5 text-sm">
                <p className="font-semibold">
                  {label}
                  {person.best && (
                    <span className="zuri-review-pill ml-2" data-tone="accent">
                      {t("web.reviews.match.best")}
                    </span>
                  )}
                </p>
                <p className="text-xs text-fg-muted">
                  {person.phoneEnd ? t("web.reviews.match.phone", { fim: person.phoneEnd }) : t("web.reviews.match.noPhone")}
                  {" · "}
                  {person.email || t("web.reviews.match.noEmail")}
                </p>
                <p className="text-xs text-fg-muted">
                  {person.opened ? `${t("web.reviews.match.opened")} · ` : ""}
                  {person.requestedAt ? t("web.reviews.match.requested", { dia: day(person.requestedAt.slice(0, 10)) }) : t("web.reviews.match.notRequested")}
                </p>
              </div>
              <Button
                variant={person.best ? "primary" : "secondary"}
                aria-label={t("web.reviews.match.isThisOf", { nome: person.name, n: index + 1 })}
                loading={busy === person.id}
                onClick={() => void decide(person.id, "web.reviews.match.saved")}
              >
                {t("web.reviews.match.isThis")}
              </Button>
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" loading={busy === "none"} onClick={() => void decide(null, "web.reviews.match.saved")}>
        {t(people.length === 2 ? "web.reviews.match.noneOfTwo" : "web.reviews.match.noneOfThem")}
      </Button>
    </section>
  );
}

// ---------- Avaliações › Ajustes › Pedidos e link ----------

/** The link, the message and "Quando pedir", each saved by itself. Only here: other screens show it and lead here. */
export function RequestSettings() {
  const { t } = useI18n();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: ({ signal }) => api<ReviewRequestSettings>("/reviews/requests/settings", { signal }) });
  if (settings.isPending) return <Loading rows={4} />;
  if (!settings.data) return <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} />;
  const data = settings.data;
  return (
    <div className="space-y-4">
      {data.link.location === null ? (
        <Notice>{t("web.reviews.reqset.off")}</Notice>
      ) : (
        <LinkForm key={`${data.link.google}|${data.link.manual}`} settings={data} />
      )}
      <MessageForm key={data.message ?? ""} settings={data} />
      <WhenForm key={`${data.days}|${data.hour}|${data.reminder}`} settings={data} />
    </div>
  );
}

function useKeep() {
  const qc = useQueryClient();
  return (next: ReviewRequestSettings) => {
    qc.setQueryData(SETTINGS_KEY, next);
    void qc.invalidateQueries({ queryKey: REQUESTS_KEY });
  };
}

function Card({ title, body, children, onSubmit }: { title: string; body: string; children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  const id = useId();
  return (
    <form className="zuri-review-card space-y-3" aria-labelledby={id} onSubmit={onSubmit}>
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      <p className="text-sm leading-6 text-fg-muted">{body}</p>
      {children}
    </form>
  );
}

function LinkForm({ settings }: { settings: ReviewRequestSettings }) {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const keep = useKeep();
  const [value, setValue] = useState(settings.link.manual ?? settings.link.google ?? "");
  const [busy, setBusy] = useState<"save" | "fetch" | "back" | null>(null);
  const trimmed = value.trim();
  const problem = trimmed ? reviewLinkProblem(trimmed) : null;
  const current = settings.link.manual ?? settings.link.google;
  const hint = settings.link.manual
    ? t("web.reviews.reqset.link.manual")
    : settings.link.google && settings.link.readAt
      ? t("web.reviews.reqset.link.fromGoogle", { perfil: settings.link.location ?? "", dia: dateTime(settings.link.readAt) })
      : t("web.reviews.reqset.link.missing");

  const run = async (kind: "save" | "fetch" | "back", work: () => Promise<ReviewRequestSettings>, done: MessageKey) => {
    setBusy(kind);
    try {
      keep(await work());
      toast(t(done));
    } catch (failure) {
      toast(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };
  // The same address as Google's is no link of the owner's: saving it goes back to Google's.
  const manual = trimmed && trimmed !== settings.link.google ? trimmed : null;
  return (
    <Card
      title={t("web.reviews.reqset.link.title")}
      body={t("web.reviews.reqset.link.body")}
      onSubmit={(e) => {
        e.preventDefault();
        if (problem || !trimmed) return;
        void run("save", () => api<ReviewRequestSettings>("/reviews/requests/link", { method: "PUT", body: { link: manual } }), "web.reviews.reqset.link.saved");
      }}
    >
      <TextField
        label={t("web.reviews.reqset.link.label")}
        hint={problem ? t(problem === "host" ? "web.reviews.reqset.link.host" : "web.reviews.reqset.link.invalid") : hint}
        value={value}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        maxLength={REVIEW_REQUEST_LIMITS.linkMax}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" loading={busy === "fetch"} onClick={() => void run("fetch", () => api<ReviewRequestSettings>("/reviews/requests/link/refresh", { method: "POST" }), "web.reviews.reqset.link.fetched")}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t("web.reviews.reqset.link.fetch")}
        </Button>
        {current && reviewLinkProblem(current) === null && (
          <a href={current} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost")}>
            <ArrowUpRight className="h-4 w-4" aria-hidden />
            {t("web.reviews.reqset.link.test")}
          </a>
        )}
        {settings.link.manual && (
          <Button type="button" variant="ghost" loading={busy === "back"} onClick={() => void run("back", () => api<ReviewRequestSettings>("/reviews/requests/link", { method: "PUT", body: { link: null } }), "web.reviews.reqset.link.saved")}>
            {t("web.reviews.reqset.link.back")}
          </Button>
        )}
      </div>
      <div className="space-y-1 rounded-xl border border-border p-3">
        <p className="text-sm font-semibold">{t("web.reviews.reqset.short.title")}</p>
        <p className="text-xs leading-5 text-fg-muted">{t("web.reviews.reqset.short.body")}</p>
        <p className="break-all font-mono text-xs">{settings.shortBase}
          {SAMPLE_CODE}</p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={busy === "save"} disabled={!trimmed || !!problem || manual === settings.link.manual}>
          {t("web.reviews.reqset.link.save")}
        </Button>
      </div>
    </Card>
  );
}

function MessageForm({ settings }: { settings: ReviewRequestSettings }) {
  const { t } = useI18n();
  const toast = useToast();
  const keep = useKeep();
  const fallback = settings.defaultMessage;
  const [text, setText] = useState(settings.message ?? fallback);
  const [busy, setBusy] = useState(false);
  const length = [...text.trim()].length;
  const missing = !text.includes("{link}");
  const save = async (message: string | null) => {
    setBusy(true);
    try {
      keep(await api<ReviewRequestSettings>("/reviews/requests/settings", { method: "PATCH", body: { message } }));
      toast(t("web.reviews.reqset.message.saved"));
    } catch (failure) {
      toast(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={t("web.reviews.reqset.message.title")}
      body={t("web.reviews.reqset.message.body")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!missing) void save(text.trim() === fallback ? null : text);
      }}
    >
      <TextAreaField
        label={t("web.reviews.reqset.message.label")}
        hint={missing ? t("web.reviews.reqset.message.needsLink") : t("web.reviews.reqset.message.hint", { n: length, max: REVIEW_REQUEST_LIMITS.messageMax })}
        rows={5}
        value={text}
        maxLength={REVIEW_REQUEST_LIMITS.messageMax}
        aria-invalid={missing || undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap justify-end gap-2">
        {settings.message !== null && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(null)}>
            {t("web.reviews.reqset.message.default")}
          </Button>
        )}
        <Button type="submit" loading={busy} disabled={missing || length === 0}>
          {t("web.reviews.reqset.message.save")}
        </Button>
      </div>
    </Card>
  );
}

function WhenForm({ settings }: { settings: ReviewRequestSettings }) {
  const { t } = useI18n();
  const toast = useToast();
  const keep = useKeep();
  const [days, setDays] = useState(String(settings.days));
  const [hour, setHour] = useState(settings.hour);
  const [reminder, setReminder] = useState(settings.reminder);
  const [busy, setBusy] = useState(false);
  const n = Number(days);
  const daysOk = Number.isInteger(n) && n >= REVIEW_REQUEST_LIMITS.daysMin && n <= REVIEW_REQUEST_LIMITS.daysMax;
  const hourOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(hour) && hour >= REVIEW_REQUEST_LIMITS.hourMin && hour <= REVIEW_REQUEST_LIMITS.hourMax;
  return (
    <Card
      title={t("web.reviews.reqset.when.title")}
      body={t("web.reviews.reqset.when.body")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!daysOk || !hourOk) return;
        setBusy(true);
        api<ReviewRequestSettings>("/reviews/requests/settings", { method: "PATCH", body: { days: n, hour, reminder } })
          .then((next) => {
            keep(next);
            toast(t("web.reviews.reqset.when.saved"));
          })
          .catch((failure: unknown) => toast(errorMessage(failure)))
          .finally(() => setBusy(false));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={t("web.reviews.reqset.when.days")}
          hint={t("web.reviews.reqset.when.days.hint", { min: REVIEW_REQUEST_LIMITS.daysMin, max: REVIEW_REQUEST_LIMITS.daysMax })}
          type="number"
          inputMode="numeric"
          min={REVIEW_REQUEST_LIMITS.daysMin}
          max={REVIEW_REQUEST_LIMITS.daysMax}
          value={days}
          aria-invalid={!daysOk || undefined}
          onChange={(e) => setDays(e.target.value)}
        />
        <TextField
          label={t("web.reviews.reqset.when.hour")}
          hint={t("web.reviews.reqset.when.hour.hint", { min: REVIEW_REQUEST_LIMITS.hourMin, max: REVIEW_REQUEST_LIMITS.hourMax })}
          type="time"
          min={REVIEW_REQUEST_LIMITS.hourMin}
          max={REVIEW_REQUEST_LIMITS.hourMax}
          value={hour}
          aria-invalid={!hourOk || undefined}
          onChange={(e) => setHour(e.target.value)}
        />
      </div>
      <div>
        <Switch label={t("web.reviews.reqset.when.reminder")} checked={reminder} onChange={setReminder} describedBy="req-reminder-hint" />
        <p id="req-reminder-hint" className="text-xs leading-5 text-fg-muted">
          {t("web.reviews.reqset.when.reminder.hint")}
        </p>
      </div>
      <p className={cn("text-xs leading-5 text-fg-muted")}>{t("web.reviews.reqset.when.source")}</p>
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!daysOk || !hourOk}>
          {t("web.reviews.reqset.when.save")}
        </Button>
      </div>
    </Card>
  );
}
