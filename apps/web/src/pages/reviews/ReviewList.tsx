import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { REVIEW_LIMITS, type ReviewItem, type ReviewPage, type ReviewsStatus, type ReviewTab } from "@zuri/shared";
import { ChevronsLeft, MessageSquareText, RefreshCw, SendHorizontal, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, Navigate } from "react-router";
import { useToast } from "../../components/Toaster.tsx";
import { Button, cn, Dialog, EmptyState, ErrorNotice, Loading, Notice } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { guardTexts, REVIEW_REASON_TEXT, REVIEW_SOURCE_TEXT, REVIEW_STATE_TEXT, REVIEWS_KEY, refusedCodes } from "../../lib/reviews.ts";
import { Mark, Stars } from "./parts.tsx";

const TAB_TEXT = { needs: "web.reviews.tab.needs", answered: "web.reviews.tab.answered", auto: "web.reviews.tab.auto", all: "web.reviews.tab.all" } as const;
const EMPTY_TEXT = {
  needs: ["web.reviews.empty.needs.title", "web.reviews.empty.needs.body"],
  answered: ["web.reviews.empty.answered.title", "web.reviews.empty.answered.body"],
  auto: ["web.reviews.empty.auto.title", "web.reviews.empty.auto.body"],
  all: ["web.reviews.empty.all.title", "web.reviews.empty.all.body"],
} as const;
/** States the owner can still act on: approve, write again, discard, mark as handled. */
const OPEN = new Set(["new", "escalated", "proposed"]);

/** The width from which the list and the open review sit side by side (the same as in styles.css). */
const WIDE = "(min-width: 1101px)";
const isWide = () => window.matchMedia(WIDE).matches;
function watchWide(changed: () => void): () => void {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
}

/**
 * Avaliações › Avaliações: the reviews on one side and the chosen one, with
 * its reply, on the other. In a narrow window the chosen review takes the
 * list's place. What waits for the owner comes first; the address holds which
 * review is open. The reviewer's text is always plain text, never markup.
 */
export function ReviewList({ status, id }: { status: ReviewsStatus; id: string | null }) {
  const { t, plural } = useI18n();
  // What waits for the owner opens first; with nothing waiting, everything.
  const [tab, setTab] = useState<ReviewTab>(status.needs > 0 ? "needs" : "all");
  const [rating, setRating] = useState("");
  const tabId = useId();
  const wide = useSyncExternalStore(watchWide, isWide);
  const list = useInfiniteQuery({
    queryKey: [...REVIEWS_KEY, "list", tab, rating],
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ tab });
      if (rating) params.set("rating", rating);
      if (pageParam) params.set("cursor", pageParam);
      return api<ReviewPage>(`/reviews?${params.toString()}`, { signal });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  const pages = list.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  const counts = pages[0]?.counts;
  // The "by itself" filter only once the level is on or something went out that way.
  const tabs = (["needs", "answered", "auto", "all"] as const).filter((key) => key !== "auto" || tab === "auto" || status.level === "auto" || (counts?.auto ?? 0) > 0);
  const chosen = id ? items.find((item) => item.id === id) : undefined;
  // The open review left this list (answered, another filter): back to the list, which shows what is there now.
  const gone = !!id && !chosen && list.isSuccess && !list.isFetching;
  // With room for both, the first review shows until another is picked; in one column nothing is open until then.
  const shown = chosen ?? (id || !wide ? undefined : items[0]);
  // In a narrow window the review takes the list's place, so the focus follows: to the review's
  // name when it opens, and back to the line it left (or to the filter, when the line is gone).
  const last = useRef<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const opened = chosen?.id ?? null;
  useEffect(() => {
    if (opened) {
      if (!wide && last.current !== opened) frame.current?.querySelector<HTMLElement>(".zuri-reviews-detail h2")?.focus();
      last.current = opened;
    } else if (last.current && !id) {
      (frame.current?.querySelector<HTMLElement>(`[data-review="${last.current}"]`) ?? frame.current?.querySelector<HTMLElement>("select"))?.focus();
      last.current = null;
    }
  }, [id, opened, wide]);
  if (gone) return <Navigate to="/avaliacoes/lista" replace />;
  const [emptyTitle, emptyBody] = EMPTY_TEXT[tab];
  return (
    // Only a review that is there takes the list's place: loading and failing stay in sight.
    <div ref={frame} className="zuri-reviews" data-open={chosen ? "" : undefined}>
      <section aria-label={t("web.reviews.list.label")} className="zuri-reviews-list">
        <div className="space-y-2">
          <label htmlFor={`${tabId}-tab`} className="sr-only">
            {t("web.reviews.tabs")}
          </label>
          <select id={`${tabId}-tab`} className="zuri-review-select" value={tab} onChange={(e) => setTab(e.target.value as ReviewTab)}>
            {tabs.map((key) => (
              <option key={key} value={key}>
                {counts ? t(TAB_TEXT[key], { count: counts[key] }) : t(TAB_TEXT[key], { count: "…" })}
              </option>
            ))}
          </select>
          <label htmlFor={`${tabId}-rating`} className="sr-only">
            {t("web.reviews.rating")}
          </label>
          <select id={`${tabId}-rating`} className="zuri-review-select" value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">{t("web.reviews.rating.all")}</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={String(n)}>
                {plural("web.reviews.stars", n)}
              </option>
            ))}
          </select>
        </div>
        {list.isPending ? (
          <Loading rows={4} />
        ) : list.isError && items.length === 0 ? (
          <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<MessageSquareText className="h-6 w-6" />} title={t(emptyTitle)}>
            <p>{t(emptyBody)}</p>
          </EmptyState>
        ) : (
          <>
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <Link to={`/avaliacoes/lista/${item.id}`} data-review={item.id} aria-current={item.id === shown?.id ? "true" : undefined} className="zuri-contact-row">
                    <Mark firstName={item.firstName} anonymous={item.anonymous} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.anonymous || !item.firstName ? t("web.reviews.anonymous") : item.firstName}</span>
                      <span className={cn("block truncate text-xs text-fg-muted", !item.comment && "italic")}>{item.comment || t("web.reviews.noText")}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Stars rating={item.rating} />
                      <span className={cn("text-xs", OPEN.has(item.state) ? "font-semibold text-fg" : "text-fg-muted")}>
                        {t(OPEN.has(item.state) && item.reasons[0] ? REVIEW_REASON_TEXT[item.reasons[0]] : REVIEW_STATE_TEXT[item.state])}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {list.hasNextPage && (
              <div className="flex justify-center">
                <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                  {t("web.reviews.more")}
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-label={t("web.reviews.detail.label")} className="zuri-reviews-detail">
        <Link to="/avaliacoes/lista" className="zuri-reviews-back">
          <ChevronsLeft className="h-4 w-4" aria-hidden />
          {t("web.reviews.part.list")}
        </Link>
        {shown ? (
          <ReviewCard key={shown.id} review={shown} paused={status.paused} level={status.level} />
        ) : (
          !list.isPending && <p className="py-10 text-center text-sm leading-6 text-fg-muted">{t("web.reviews.detail.pick")}</p>
        )}
      </section>
    </div>
  );
}

type Busy = "approve" | "draft" | "discard" | "resolve" | "delete" | null;

/** One review with its reply. A draft is only a suggestion: the owner edits and approves, and Zuri reads the review again at Google before it publishes. */
function ReviewCard({ review, paused, level }: { review: ReviewItem; paused: boolean; level: ReviewsStatus["level"] }) {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [text, setText] = useState(review.draft ?? "");
  const [busy, setBusy] = useState<Busy>(null);
  const [confirm, setConfirm] = useState<"approve" | "delete" | null>(null);
  // What the owner read when the dialog opened is what goes out (SEC-S12-01): a review
  // or a draft that changes behind the dialog must not be published unread.
  const [reading, setReading] = useState({ text: "", version: review.version });
  const [refused, setRefused] = useState<string[]>([]);
  // A new draft (written again, or the live channel's refresh) replaces what's in the box.
  useEffect(() => {
    setText(review.draft ?? "");
    setRefused([]);
  }, [review.draft]);
  const open = OPEN.has(review.state);
  const suspicious = review.reasons.includes("suspicious");
  const length = [...text.trim()].length;
  const name = review.anonymous || !review.firstName ? t("web.reviews.anonymous") : review.firstName;

  const act = async (kind: Exclude<Busy, null>, work: () => Promise<{ review: ReviewItem }>, done?: Parameters<typeof t>[0]) => {
    setBusy(kind);
    try {
      await work();
      setConfirm(null);
      setRefused([]);
      if (done) toast(t(done));
    } catch (failure) {
      setConfirm(null);
      const codes = refusedCodes(failure);
      if (codes) setRefused(guardTexts(codes, t));
      else toast(errorMessage(failure));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: REVIEWS_KEY });
    }
  };
  const post = (path: string, body?: unknown) => () => api<{ review: ReviewItem }>(`/reviews/${review.id}/${path}`, { method: "POST", ...(body === undefined ? {} : { body }) });

  return (
    <article className="space-y-4" aria-labelledby={`${id}-who`}>
      <header className="flex items-center gap-4">
        <Mark firstName={review.firstName} anonymous={review.anonymous} big />
        <div className="min-w-0 space-y-1">
          <h2 id={`${id}-who`} tabIndex={-1} className="break-words text-xl font-semibold tracking-tight">
            {name}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
            <Stars rating={review.rating} />
            <time dateTime={review.updatedAt}>{dateTime(review.updatedAt)}</time>
            {review.location && <span className="min-w-0 break-words">{review.location}</span>}
          </p>
        </div>
      </header>
      <ul className="flex flex-wrap gap-1" aria-label={t("web.reviews.detail.marks")}>
        <li className="zuri-review-pill" data-tone={review.state === "escalated" ? "danger" : review.state === "proposed" ? "accent" : undefined}>
          {t(REVIEW_STATE_TEXT[review.state])}
        </li>
        {review.auto && (
          <li className="zuri-review-pill" data-tone="accent">
            {t("web.reviews.auto.badge")}
          </li>
        )}
        {review.reasons.map((reason) => (
          <li key={reason} className="zuri-review-pill" data-tone="warning">
            {t(REVIEW_REASON_TEXT[reason])}
          </li>
        ))}
      </ul>
      {review.comment ? (
        <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border-strong pl-4 text-[15px] leading-7">{review.comment}</blockquote>
      ) : (
        <p className="text-sm italic text-fg-muted">{t("web.reviews.noText")}</p>
      )}

      {review.reply && (
        <div className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-fg-muted">{t(review.replyMine ? "web.reviews.reply.mine" : "web.reviews.reply.elsewhere")}</p>
            {/* Only Zuri's own reply can be deleted here, never one written at Google. One action, so a button and not a menu. */}
            {review.replyMine && (
              <Button variant="ghost" aria-haspopup="dialog" onClick={() => setConfirm("delete")}>
                <Trash2 className="h-4 w-4" aria-hidden />
                {t("web.reviews.deleteReply")}
              </Button>
            )}
          </div>
          <p className="whitespace-pre-wrap break-words rounded-xl bg-raised p-3 text-sm leading-6">{review.reply}</p>
        </div>
      )}
      {review.state === "uncertain" && <Notice tone="warning">{t("web.reviews.uncertain")}</Notice>}
      {open && suspicious && <Notice tone="warning">{t("web.reviews.suspicious")}</Notice>}

      {open && level !== "off" && (
        <div className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={`${id}-reply`} className="text-sm font-semibold">
              {t("web.reviews.reply.label")}
            </label>
            <span id={`${id}-count`} className={cn("text-xs tabular-nums text-fg-muted", length > REVIEW_LIMITS.replyMax && "text-danger")}>
              {t("web.reviews.reply.count", { n: length, max: REVIEW_LIMITS.replyMax })}
            </span>
          </div>
          <textarea
            id={`${id}-reply`}
            className="min-h-32 w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            value={text}
            maxLength={REVIEW_LIMITS.replyBytes}
            aria-describedby={`${id}-hint ${id}-count${refused.length ? ` ${id}-refused` : ""}`}
            aria-invalid={refused.length > 0 || length > REVIEW_LIMITS.replyMax || undefined}
            onChange={(e) => setText(e.target.value)}
          />
          <p id={`${id}-hint`} className="text-xs text-fg-muted">
            {t("web.reviews.reply.hint", { min: REVIEW_LIMITS.replyMin, max: REVIEW_LIMITS.replyMax })}
          </p>
          {review.draft && review.draftSource && (
            <p className="text-xs text-fg-muted">
              {t(REVIEW_SOURCE_TEXT[review.draftSource])}
              {review.expiresAt && ` · ${t("web.reviews.expires", { when: dateTime(review.expiresAt) })}`}
            </p>
          )}
          {review.fallback.length > 0 && <p className="text-xs text-fg-muted">{t("web.reviews.fallback")}</p>}
          {refused.length > 0 && (
            <div id={`${id}-refused`} role="alert" className="rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm">
              <p className="font-medium">{t("web.reviews.guard.title")}</p>
              <ul className="list-disc pl-5">
                {refused.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              onClick={() => {
                setReading({ text, version: review.version });
                setConfirm("approve");
              }} disabled={paused || length === 0 || length > REVIEW_LIMITS.replyMax} loading={busy === "approve"}>
              <SendHorizontal className="h-4 w-4" aria-hidden />
              {t("web.reviews.approve")}
            </Button>
            {!suspicious && (
              <Button variant="secondary" loading={busy === "draft"} onClick={() => void act("draft", post("draft"))}>
                <RefreshCw className="h-4 w-4" aria-hidden />
                {t(review.draft ? "web.reviews.redraft" : "web.reviews.draft")}
              </Button>
            )}
            {review.draft && (
              <Button variant="ghost" loading={busy === "discard"} onClick={() => void act("discard", post("discard"), "web.reviews.discarded")}>
                {t("web.reviews.discard")}
              </Button>
            )}
            <Button variant="ghost" loading={busy === "resolve"} onClick={() => void act("resolve", post("resolve"), "web.reviews.resolved")}>
              {t("web.reviews.resolve")}
            </Button>
          </div>
        </div>
      )}
      {open && level === "off" && (
        <div className="flex justify-end">
          <Button variant="ghost" loading={busy === "resolve"} onClick={() => void act("resolve", post("resolve"), "web.reviews.resolved")}>
            {t("web.reviews.resolve")}
          </Button>
        </div>
      )}

      <Dialog open={confirm === "approve"} onClose={() => setConfirm(null)} title={t("web.reviews.approve.title")}>
        <p className="text-sm leading-6 text-fg-muted">{t("web.reviews.approve.body")}</p>
        <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-raised p-3 text-sm leading-6">{reading.text.trim()}</blockquote>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            {t("web.cancel")}
          </Button>
          <Button loading={busy === "approve"} onClick={() => void act("approve", post("approve", reading), "web.reviews.published")}>
            {t("web.reviews.approve.confirm")}
          </Button>
        </div>
      </Dialog>
      <Dialog open={confirm === "delete"} onClose={() => setConfirm(null)} title={t("web.reviews.deleteReply.title")}>
        <p className="text-sm leading-6 text-fg-muted">{t("web.reviews.deleteReply.body")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            {t("web.cancel")}
          </Button>
          <Button
            variant="danger"
            loading={busy === "delete"}
            onClick={() => void act("delete", () => api<{ review: ReviewItem }>(`/reviews/${review.id}/reply`, { method: "DELETE" }), "web.reviews.deleted")}
          >
            {t("web.reviews.deleteReply.confirm")}
          </Button>
        </div>
      </Dialog>
    </article>
  );
}
