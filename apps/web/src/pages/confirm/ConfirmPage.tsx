import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ConfirmAction, type ConfirmView, confirmLinkToken, type MessageKey, ptBRConfirm } from "@zuri/shared";
import { CalendarClock, CalendarFold, CalendarX, CircleCheck, Clock4, Laptop, MapPinHouse, MessageCircleMore, Stethoscope, TriangleAlert, Unlink2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, buttonClass, cn, Dialog } from "../../components/ui.tsx";
import { ApiError, api } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { NOTICE_NOTES, play } from "../../lib/sounds.ts";
import { Reschedule } from "./Reschedule.tsx";

addMessages(ptBRConfirm);

/**
 * The patient's confirmation page, /c/<token> (E7a, docs/planos/link-de-confirmacao.md): outside the
 * app, with no session, no menu and no link into the Zuri. Opening only shows; a tap changes the
 * appointment. The token goes in the body of a POST, never in a query's address. A token out of shape
 * is never asked about.
 */

type Problem = "invalid" | "limited" | "down";

function problemOf(error: unknown): Problem {
  if (error instanceof ApiError && error.code === "NOT_FOUND") return "invalid";
  if (error instanceof ApiError && error.code === "RATE_LIMITED") return "limited";
  return "down";
}

const PROBLEM: Record<Problem, { title: MessageKey; body: MessageKey; icon: ReactNode }> = {
  invalid: { title: "web.confirm.invalid.title", body: "web.confirm.invalid.body", icon: <Unlink2 className="h-7 w-7" aria-hidden /> },
  limited: { title: "web.confirm.limited.title", body: "web.confirm.limited.body", icon: <TriangleAlert className="h-7 w-7" aria-hidden /> },
  down: { title: "web.confirm.down.title", body: "web.confirm.down.body", icon: <TriangleAlert className="h-7 w-7" aria-hidden /> },
};

export function ConfirmPage() {
  const { t } = useI18n();
  // The page never moves inside the app: the address it opened with is the one it reads.
  const token = confirmLinkToken(window.location.pathname);
  const qc = useQueryClient();
  const key = ["confirm", token] as const;
  const view = useQuery({
    queryKey: key,
    queryFn: () => api<ConfirmView>("/c/view", { method: "POST", body: { token } }),
    enabled: token !== null,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [late, setLate] = useState(false);
  const [moving, setMoving] = useState(false);
  const answer = useMutation({
    mutationFn: (action: ConfirmAction) => api<ConfirmView>("/c/answer", { method: "POST", body: { token, action } }),
    onSuccess: (next, action) => {
      qc.setQueryData(key, next);
      play(NOTICE_NOTES[action === "confirm" ? "sino" : "gota"]);
    },
    onError: (error) => {
      // Past the deadline, or gone, meanwhile: the page shows it as it is now.
      if (error instanceof ApiError && error.code === "CONFLICT") setLate(true);
      if (error instanceof ApiError && (error.code === "CONFLICT" || error.code === "NOT_FOUND")) void view.refetch();
    },
  });
  const data = view.data;
  // The office's name alone: the patient's tab never says Zuri.
  const title = data?.clinic || t("web.confirm.pageTitle");
  useEffect(() => {
    document.title = title;
  }, [title]);
  const problem: Problem | null = token === null ? "invalid" : view.error ? problemOf(view.error) : null;
  return (
    <main id="conteudo" className="flex min-h-dvh flex-col items-center bg-bg px-4 py-6 text-fg sm:py-12">
      <div className="grid w-full max-w-[440px] gap-4 rounded-[20px] border border-border bg-surface p-5 shadow-lg sm:p-6">
        {data?.clinic && <Brand name={data.clinic} />}
        {problem ? (
          <State icon={PROBLEM[problem].icon} title={t(PROBLEM[problem].title)} body={t(PROBLEM[problem].body)}>
            {problem === "down" && (
              <Button variant="secondary" onClick={() => void view.refetch()} loading={view.isFetching}>
                {t("web.confirm.retry")}
              </Button>
            )}
          </State>
        ) : !data ? (
          <output aria-label={t("web.confirm.loading")} className="grid gap-3" aria-busy="true">
            <span className="h-8 w-2/3 rounded-lg zuri-skeleton" />
            <span className="h-28 rounded-xl zuri-skeleton" />
            <span className="h-11 rounded-xl zuri-skeleton" />
          </output>
        ) : (
          moving && token && data.canReschedule ? (
            <Reschedule token={token} view={data} viewKey={key} onClose={() => setMoving(false)} teamHref={(text) => teamHref(data.team, text)} />
          ) : (
            <Body
              view={data}
              late={late}
              working={answer.isPending ? answer.variables : null}
              failed={answer.isError && !late && !(answer.error instanceof ApiError && answer.error.code === "NOT_FOUND") ? answer.error : null}
              onAnswer={(action) => answer.mutate(action)}
              onReschedule={() => setMoving(true)}
            />
          )
        )}
        <p className="text-center text-xs text-fg-muted">{t("web.confirm.foot")}</p>
      </div>
    </main>
  );
}

/** The team's WhatsApp with a message ready: it only leaves the patient's phone if they tap send there. */
function teamHref(team: string, text: string): string {
  return `https://wa.me/55${team}?text=${encodeURIComponent(text)}`;
}

/** The office's name with its initials: the patient's page wears the office, never the Zuri. */
function Brand({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <p className="flex items-center gap-2.5 font-semibold text-fg-muted">
      <span aria-hidden className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent-soft text-[13px] font-bold text-accent-text">
        {initials}
      </span>
      {name}
    </p>
  );
}

function State({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  const ref = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="grid justify-items-start gap-2 motion-safe:animate-rise">
      <span className="text-fg-muted">{icon}</span>
      <h1 ref={ref} tabIndex={-1} className="text-xl font-semibold focus:outline-none">
        {title}
      </h1>
      <p className="text-fg-muted">{body}</p>
      {children}
    </div>
  );
}

/** Focus on what just appeared, so a screen reader hears the new state. */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

function useFormat(zone: string) {
  const { locale } = useI18n();
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: zone });
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: zone });
  return { day: (iso: string) => day.format(new Date(iso)), time: (iso: string) => time.format(new Date(iso)) };
}

function Body({
  view,
  late,
  working,
  failed,
  onAnswer,
  onReschedule,
}: {
  view: ConfirmView;
  late: boolean;
  working: ConfirmAction | null | undefined;
  failed: unknown;
  onAnswer: (action: ConfirmAction) => void;
  onReschedule: () => void;
}) {
  const { t } = useI18n();
  const f = useFormat(view.zone);
  const [asking, setAsking] = useState(false);
  const team = (text: string) =>
    view.team ? (
      <a className={buttonClass("ghost", "w-full text-fg-muted")} href={teamHref(view.team, text)} target="_blank" rel="noopener noreferrer">
        <MessageCircleMore className="h-4 w-4" aria-hidden />
        {t("web.confirm.team")}
      </a>
    ) : null;
  if (view.state === "expired" || view.state === "cancelled") {
    const cancelled = view.state === "cancelled";
    return (
      <>
        <State
          icon={cancelled ? <CalendarX className="h-7 w-7" aria-hidden /> : <Clock4 className="h-7 w-7" aria-hidden />}
          title={t(cancelled ? "web.confirm.cancelled.title" : "web.confirm.expired.title")}
          body={t(cancelled ? "web.confirm.cancelled.body" : "web.confirm.expired.body")}
        />
        {team(t("web.confirm.teamTextPlain"))}
      </>
    );
  }
  const day = f.day(view.start);
  const from = f.time(view.start);
  const until = `${f.day(view.cancelUntil)}, ${f.time(view.cancelUntil)}`;
  const confirmed = view.state === "confirmed";
  const rescheduled = view.state === "rescheduled";
  const canCancel = view.canCancel && !late;
  const canMove = view.canReschedule && !late;
  return (
    <>
      {confirmed ? (
        <Confirmed name={view.first} />
      ) : rescheduled ? (
        <Rescheduled name={view.first} />
      ) : (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("web.confirm.hello", { name: view.first })}</h1>
          <p className="mt-1 text-fg-muted">{t("web.confirm.ask")}</p>
        </div>
      )}
      <dl className="grid gap-2.5 rounded-xl bg-raised p-4">
        <Line icon={<CalendarFold className="h-4 w-4" aria-hidden />} label={t("web.confirm.day")}>
          <span className="first-letter:uppercase">{day}</span>
        </Line>
        <Line icon={<Clock4 className="h-4 w-4" aria-hidden />} label={t("web.confirm.time")}>
          {t("web.confirm.timeRange", { from, to: f.time(view.end) })}
        </Line>
        <Line icon={view.online ? <Laptop className="h-4 w-4" aria-hidden /> : <Stethoscope className="h-4 w-4" aria-hidden />} label={t("web.confirm.type")}>
          {view.type}
        </Line>
        {(view.online || view.place) && (
          <Line icon={<MapPinHouse className="h-4 w-4" aria-hidden />} label={t("web.confirm.place")}>
            {view.online ? t("web.confirm.online") : view.place}
          </Line>
        )}
      </dl>
      {!confirmed && !rescheduled && (
        <Button className="min-h-12 w-full text-base" loading={working === "confirm"} disabled={!!working} onClick={() => onAnswer("confirm")}>
          <CircleCheck className="h-5 w-5" aria-hidden />
          {t("web.confirm.confirm")}
        </Button>
      )}
      {canMove ? (
        <Button variant="secondary" className="w-full" disabled={!!working} onClick={onReschedule}>
          <CalendarClock className="h-4 w-4" aria-hidden />
          {t("web.confirm.reschedule")}
        </Button>
      ) : (
        <Note icon={<CalendarFold className="h-4 w-4" aria-hidden />}>{t("web.confirm.change")}</Note>
      )}
      {team(t("web.confirm.teamText", { name: view.first, day, time: from }))}
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {failed instanceof ApiError && failed.code === "RATE_LIMITED" ? t("web.confirm.limited.body") : t("web.confirm.down.title")}
        </p>
      ) : null}
      <div className="grid gap-2 border-t border-border pt-4">
        {canCancel ? (
          <>
            <Button variant="ghost" className="w-full text-danger" disabled={!!working} onClick={() => setAsking(true)}>
              <CalendarX className="h-4 w-4" aria-hidden />
              {t("web.confirm.cancel")}
            </Button>
            <p className="text-center text-xs text-fg-muted">{t("web.confirm.cancelUntil", { when: until })}</p>
          </>
        ) : (
          <Note icon={<Clock4 className="h-4 w-4" aria-hidden />}>{t("web.confirm.late")}</Note>
        )}
      </div>
      <Dialog open={asking} onClose={() => setAsking(false)} title={t("web.confirm.ask.title")}>
        <p className="text-sm text-fg-muted">{t("web.confirm.ask.body", { name: view.first, when: `${day}, ${from}` })}</p>
        {canMove && (
          <p className="flex items-start gap-2 rounded-xl bg-raised p-3 text-sm">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <span>
              {t("web.confirm.ask.rescheduleOffer")}{" "}
              <button
                type="button"
                // Inline in the sentence, but a 44 px tall target (CA-R13) without moving the lines.
                className="-my-3 inline-block min-h-11 py-3 font-semibold text-accent-text underline underline-offset-2"
                onClick={() => {
                  setAsking(false);
                  onReschedule();
                }}
              >
                {t("web.confirm.ask.reschedule")}
              </button>
            </span>
          </p>
        )}
        {/* "Manter" first and focused: Enter or a double tap by mistake never cancels. */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" autoFocus onClick={() => setAsking(false)}>
            {t("web.confirm.ask.keep")}
          </Button>
          <Button
            variant="danger"
            loading={working === "cancel"}
            onClick={() => {
              setAsking(false);
              onAnswer("cancel");
            }}
          >
            {t("web.confirm.ask.yes")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function Confirmed({ name }: { name: string }) {
  const { t } = useI18n();
  const ref = useFocusOnMount<HTMLDivElement>();
  return (
    <div ref={ref} tabIndex={-1} role="status" className="flex items-start gap-2.5 rounded-xl bg-success-soft p-4 text-success focus:outline-none motion-safe:animate-rise">
      <CircleCheck className="h-6 w-6 shrink-0" aria-hidden />
      <span>
        <b>{t("web.confirm.confirmed")}</b> {t("web.confirm.seeYou", { name })}
      </span>
    </div>
  );
}

function Rescheduled({ name }: { name: string }) {
  const { t } = useI18n();
  const ref = useFocusOnMount<HTMLDivElement>();
  return (
    <div ref={ref} tabIndex={-1} role="status" className="flex items-start gap-2.5 rounded-xl bg-warning-soft p-4 text-warning focus:outline-none motion-safe:animate-rise">
      <CalendarClock className="h-6 w-6 shrink-0" aria-hidden />
      <span>
        <b>{t("web.confirm.rescheduled")}</b> {t("web.confirm.seeYou", { name })} {t("web.confirm.rescheduledBelow")}
      </span>
    </div>
  );
}

function Line({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      {/* The icon inside the dd: a dl's group holds only dt and dd. */}
      <dd className="flex items-start gap-2.5 font-medium">
        <span className="mt-0.5 text-fg-muted">{icon}</span>
        <span>{children}</span>
      </dd>
    </div>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className={cn("flex items-start gap-2 text-sm text-fg-muted")}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
