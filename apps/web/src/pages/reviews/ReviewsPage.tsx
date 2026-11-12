import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ptBRReviews, REVIEW_LIMITS, type ReviewsStatus } from "@zuri/shared";
import { CirclePause, CirclePlay, LayoutGrid, MessageSquareText, RefreshCw, SlidersVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { useToast } from "../../components/Toaster.tsx";
import { buttonClass, cn, EmptyState, ErrorNotice, Loading, Notice, useDocumentTitle } from "../../components/ui.tsx";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { REVIEW_BREAKER_TEXT, REVIEW_PROBLEM_TEXT, REVIEWS_BUT_STATUS, REVIEWS_STATUS_KEY } from "../../lib/reviews.ts";
import { countdown, type ReviewPart, reviewAddress } from "./numbers.ts";
import { Overview } from "./Overview.tsx";
import { ReviewList } from "./ReviewList.tsx";
import { ReviewSettings } from "./ReviewSettings.tsx";

// The area's pt-BR texts travel with its code, not in the first bundle (rule P11).
addMessages(ptBRReviews);

/** How long after the hour of the next check the screen asks the server again, at most three times. */
const DUE_CHECKS_MS = [3_000, 15_000, 30_000];

/**
 * Avaliações (Sinal, S12): the Google reviews in their own area, in three
 * parts. The overview shows the period's numbers, the list holds each review
 * with its reply, and the settings hold the connection with the Business
 * Profile and how Zuri replies. The address holds the part and, in the list,
 * the open review; anything else after /avaliacoes goes to the nearest real one.
 */
export function ReviewsPage() {
  const { aba, item } = useParams();
  const to = reviewAddress(aba, item);
  return to ? <Navigate to={to} replace /> : <Area part={(aba as ReviewPart | undefined) ?? null} item={item ?? null} />;
}

function Area({ part, item }: { part: ReviewPart | null; item: string | null }) {
  const { t, dateTime } = useI18n();
  useDocumentTitle(t("web.nav.reviews"));
  const toast = useToast();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: REVIEWS_STATUS_KEY, queryFn: ({ signal }) => api<ReviewsStatus>("/reviews/status", { signal }) });
  const [busy, setBusy] = useState<"check" | "pause" | null>(null);
  const data = status.data;

  const check = async () => {
    setBusy("check");
    try {
      const { outcome, ...next } = await api<ReviewsStatus & { outcome: string }>("/reviews/check", { method: "POST" });
      qc.setQueryData(REVIEWS_STATUS_KEY, next);
      void qc.invalidateQueries(REVIEWS_BUT_STATUS);
      toast(t(outcome === "ok" ? "web.reviews.checked" : outcome === "partial" ? "web.reviews.checkedPartial" : "web.reviews.checkFailed"));
    } catch (failure) {
      // The server says how long the button rests; the screen shows the seconds.
      const wait = failure instanceof ApiError && failure.code === "RATE_LIMITED" ? failure.details.retryAfter : null;
      toast(typeof wait === "number" && wait > 0 ? t("web.reviews.checkWait", { n: Math.ceil(wait) }) : errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };

  const pause = async (on: boolean) => {
    setBusy("pause");
    try {
      qc.setQueryData(REVIEWS_STATUS_KEY, await api<ReviewsStatus>(on ? "/reviews/pause" : "/reviews/resume", { method: "POST" }));
      toast(t(on ? "web.reviews.pausedNow" : "web.reviews.resumedNow"));
    } catch (failure) {
      toast(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };

  const places = data?.locations.filter((location) => location.selected).map((location) => location.title) ?? [];
  const pauseText = t(data?.paused ? "web.reviews.resume" : "web.reviews.pause");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-48 flex-1 basis-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("web.nav.reviews")}</h1>
          <p className="max-w-prose text-sm leading-6 text-fg-muted">{t("web.reviews.area.description")}</p>
          {data?.enabled && (
            <div className="space-y-0.5 pt-1 text-sm">
              {places.length > 0 && (
                <p className="flex items-center gap-2">
                  <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", data.problem || data.lastResult === "failed" ? "bg-warning" : "bg-success")} />
                  <span className="min-w-0 break-words">{places.join(" · ")}</span>
                </p>
              )}
              <SyncLine status={data} checkedAt={Math.max(status.dataUpdatedAt, status.errorUpdatedAt)} onDue={() => void status.refetch()} />
            </div>
          )}
        </div>
        {data?.enabled && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="zuri-icon-button border border-border-strong bg-surface shadow-sm"
              aria-label={t("web.reviews.check")}
              title={t("web.reviews.check")}
              disabled={busy === "check" || data.problem === "reconnect"}
              onClick={() => void check()}
            >
              <RefreshCw className={cn("h-5 w-5", busy === "check" && "motion-safe:animate-spin")} aria-hidden />
            </button>
            {data.level !== "off" && (
              <button
                type="button"
                className="zuri-icon-button border border-border-strong bg-surface shadow-sm"
                aria-label={pauseText}
                title={pauseText}
                disabled={busy === "pause"}
                onClick={() => void pause(!data.paused)}
              >
                {data.paused ? <CirclePlay className="h-5 w-5" aria-hidden /> : <CirclePause className="h-5 w-5" aria-hidden />}
              </button>
            )}
          </div>
        )}
      </div>

      <nav aria-label={t("web.reviews.parts")} className="zuri-seg">
        <Link to="/avaliacoes" aria-current={part === null ? "page" : undefined}>
          <LayoutGrid aria-hidden />
          {t("web.reviews.part.overview")}
        </Link>
        <Link to="/avaliacoes/lista" aria-current={part === "lista" ? "page" : undefined}>
          <MessageSquareText aria-hidden />
          {t("web.reviews.part.list")}
          {!!data?.enabled && data.needs > 0 && (
            <>
              <span aria-hidden className="tabular-nums text-fg-muted">
                {data.needs}
              </span>
              <span className="sr-only">{t("web.reviews.part.waiting", { n: data.needs })}</span>
            </>
          )}
        </Link>
        <Link to="/avaliacoes/ajustes" aria-current={part === "ajustes" ? "page" : undefined}>
          <SlidersVertical aria-hidden />
          {t("web.reviews.part.settings")}
        </Link>
      </nav>

      {status.isPending ? (
        <Loading rows={4} />
      ) : !data ? (
        <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <>
          {data.enabled && (
            <>
              {data.problem && <Notice tone="warning">{t(REVIEW_PROBLEM_TEXT[data.problem])}</Notice>}
              {data.paused && <Notice tone="info">{t("web.reviews.paused")}</Notice>}
              {data.level === "auto" && !data.paused && <Notice tone="info">{t("web.reviews.auto.status", { n: data.autoToday, max: REVIEW_LIMITS.autoPerDay })}</Notice>}
              {data.breaker && <Notice tone="warning">{t(REVIEW_BREAKER_TEXT[data.breaker.reason], { when: dateTime(data.breaker.at) })}</Notice>}
            </>
          )}
          {part === "ajustes" ? (
            <ReviewSettings status={data} reply={item === "responder"} />
          ) : !data.enabled ? (
            <EmptyState icon={<MessageSquareText className="h-6 w-6" />} title={t("web.reviews.off.title")}>
              <p>{t("web.reviews.off.body")}</p>
              <Link to="/avaliacoes/ajustes" className={buttonClass("primary", "mt-4")}>
                {t("web.reviews.off.link")}
              </Link>
            </EmptyState>
          ) : part === "lista" ? (
            <ReviewList status={data} id={item} />
          ) : (
            <Overview status={data} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * "Nada novo às 08:07 · Próxima em 8:47". The count runs on the screen's own
 * clock from the hour the server gave; once it is due the screen asks the
 * state again a few times (one row each), since a check that brings nothing
 * sends no news. Never inside a live region: it would be read every second.
 */
function SyncLine({ status, checkedAt, onDue }: { status: ReviewsStatus; checkedAt: number; onDue: () => void }) {
  const { t, locale, timeZone } = useI18n();
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
    // A tab nobody is looking at asks nothing (rule P11); it asks when the owner comes back.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        tries.current++;
        onDue();
      }, wait);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [due, checkedAt]);

  const hora = status.lastCheckAt ? new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(status.lastCheckAt)) : "";
  const last =
    status.lastResult === "failed" ? t("web.reviews.last.failed") : !hora ? t("web.reviews.last.first") : t(status.lastResult === "changed" ? "web.reviews.last.changed" : "web.reviews.last.unchanged", { hora });
  return (
    <p className="text-fg-muted">
      {last}
      {next !== null && (
        <>
          {" · "}
          {due ? (
            t("web.reviews.next.now")
          ) : (
            <>
              {t("web.reviews.next")} <strong className="font-semibold tabular-nums text-fg">{countdown(next - now)}</strong>
            </>
          )}
        </>
      )}
    </p>
  );
}
