import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CONFIRM_LINK_LIMITS, type ConfirmView, type RescheduleDays, type RescheduleOffer, type RescheduleTurn } from "@zuri/shared";
import { ArrowLeft, CalendarFold, ChevronRight, MessageCircleMore, Sun, Sunrise } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, buttonClass, cn, Dialog } from "../../components/ui.tsx";
import { ApiError, api } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { NOTICE_NOTES, play, type Note } from "../../lib/sounds.ts";

/**
 * "Preciso remarcar" (E7b, docs/planos/link-de-confirmacao.md, section 15): four steps, the day, the
 * half of the day, the preferred hour and one of the slots the server offers. The page never sees a
 * rule or another appointment, only days, halves and hours; the server offers again when the patient
 * taps and answers "taken" when someone got there first.
 */

/** Two low notes when the hour was just taken: the prototype's sound (13/11/2026, 01:04). Kept here, out of the first load. */
const TAKEN_NOTES: readonly Note[] = [
  { f: 330, at: 0, dur: 0.18, gain: 0.12, type: "triangle" },
  { f: 247, at: 0.16, dur: 0.26, gain: 0.12, type: "triangle" },
];

type Step = 1 | 2 | 3 | 4;

/** A minute of the day as "09:00". */
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function Reschedule({ token, view, viewKey, onClose, teamHref }: { token: string; view: ConfirmView; viewKey: readonly unknown[]; onClose: () => void; teamHref: (text: string) => string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [day, setDay] = useState("");
  const [turn, setTurn] = useState<RescheduleTurn>("morning");
  const [pref, setPref] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [taken, setTaken] = useState(false);
  const [failed, setFailed] = useState(false);
  const days = useQuery({
    queryKey: ["confirm-days", token],
    queryFn: () => api<RescheduleDays>("/c/days", { method: "POST", body: { token } }),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });
  const offer = useQuery({
    queryKey: ["confirm-offer", token, day, turn, pref],
    queryFn: () => api<RescheduleOffer>("/c/offer", { method: "POST", body: { token, day, turn, pref } }),
    enabled: step === 4,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  });
  const move = useMutation({
    mutationFn: (start: number) => api<ConfirmView>("/c/reschedule", { method: "POST", body: { token, day, turn, pref, start } }),
    onMutate: () => setFailed(false),
    onSuccess: (next) => {
      play(NOTICE_NOTES.sino);
      qc.setQueryData(viewKey, next);
      onClose();
    },
    onError: (error) => {
      setPicked(null);
      if (error instanceof ApiError && error.code === "CONFLICT" && error.details.problem === "taken") {
        // Someone got there first: the offer is asked again and the patient picks another.
        play(TAKEN_NOTES);
        setTaken(true);
        void qc.invalidateQueries({ queryKey: ["confirm-days", token] });
        void offer.refetch();
        return;
      }
      // Out of the deadline, moved at the office or gone meanwhile: the page as it is now.
      if (error instanceof ApiError && (error.code === "CONFLICT" || error.code === "NOT_FOUND")) {
        void qc.invalidateQueries({ queryKey: viewKey });
        onClose();
        return;
      }
      // Too many tries or the office out of reach: said on the slots, the appointment where it was.
      setFailed(true);
    },
  });

  const zone = view.zone;
  const noon = (value: string) => new Date(`${value}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  const short = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const currentDay = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(new Date(view.start));
  const currentTime = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date(view.start));
  const length = days.data?.length ?? 60;
  const chosen = days.data?.days.find((each) => each.day === day);
  const window = chosen?.turns.find((each) => each.turn === turn);
  const dayLong = day ? long.format(noon(day)) : "";

  const go = (next: Step) => {
    setTaken(false);
    setFailed(false);
    setStep(next);
  };
  const back = () => {
    if (step === 1) onClose();
    // A day with a single half skips step 2 on the way back too.
    else if (step === 3 && chosen && chosen.turns.length === 1) go(1);
    else go((step - 1) as Step);
  };
  const pickDay = (value: string) => {
    setDay(value);
    const only = days.data?.days.find((each) => each.day === value)?.turns;
    if (only?.length === 1 && only[0]) {
      setTurn(only[0].turn);
      go(3);
    } else go(2);
  };

  const team = (
    <div className="grid gap-1 border-t border-border pt-4">
      <p className="text-center text-sm text-fg-muted">{t("web.confirm.rm.teamAsk")}</p>
      {view.team ? (
        <a className={buttonClass("ghost", "w-full text-fg-muted")} href={teamHref(t("web.confirm.teamTextReschedule", { name: view.first, day: currentDay, time: currentTime }))} target="_blank" rel="noopener noreferrer">
          <MessageCircleMore className="h-4 w-4" aria-hidden />
          {t("web.confirm.rm.teamLink")}
        </a>
      ) : null}
    </div>
  );

  let title = "";
  let body: ReactNode = null;
  if (step === 1) {
    title = t("web.confirm.rm.day.title", { name: view.first });
    if (days.isPending) body = <Loading label={t("web.confirm.rm.loading")} />;
    else if (days.isError) body = <Failed error={days.error} onRetry={() => void days.refetch()} />;
    else if (days.data.days.length === 0)
      body = (
        <div className="grid justify-items-start gap-3 rounded-xl bg-raised p-4">
          <p className="text-fg-muted">{t("web.confirm.rm.none", { days: CONFIRM_LINK_LIMITS.rescheduleDays })}</p>
          {view.team ? (
            <a className={buttonClass("secondary")} href={teamHref(t("web.confirm.teamTextReschedule", { name: view.first, day: currentDay, time: currentTime }))} target="_blank" rel="noopener noreferrer">
              <MessageCircleMore className="h-4 w-4" aria-hidden />
              {t("web.confirm.rm.whatsapp")}
            </a>
          ) : null}
        </div>
      );
    else
      body = (
        <>
          <div className="grid gap-2.5">
            <p id="rm-days" className="font-semibold">
              {t("web.confirm.rm.day.label")}
            </p>
            <ul aria-labelledby="rm-days" className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5">
              {days.data.days.map((each) => (
                <li key={each.day}>
                  <button
                    type="button"
                    aria-pressed={each.day === day}
                    onClick={() => pickDay(each.day)}
                    className={cn(
                      "grid min-h-[72px] w-full content-center justify-items-start gap-1 rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:border-border-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-safe:active:scale-[0.98]",
                      each.day === day && "border-accent bg-accent-soft text-accent-text",
                    )}
                  >
                    <span className="text-sm text-fg-muted first-letter:uppercase">{weekday.format(noon(each.day))}</span>
                    <span className="font-semibold">{short.format(noon(each.day))}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {team}
        </>
      );
  } else if (step === 2) {
    const turns = chosen?.turns ?? [];
    title = t(turns.length > 1 ? "web.confirm.rm.turn.title" : "web.confirm.rm.turn.one");
    body = (
      <>
        <p className="-mt-3 text-fg-muted first-letter:uppercase">{dayLong}</p>
        <div className="grid gap-2.5">
          {turns.map((each) => (
            <button
              key={each.turn}
              type="button"
              onClick={() => {
                setTurn(each.turn);
                go(3);
              }}
              className="grid min-h-14 w-full grid-cols-[auto_1fr] items-center gap-x-2.5 rounded-xl border border-border bg-surface px-4 py-3.5 text-left transition-colors hover:border-border-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-safe:active:scale-[0.98]"
            >
              <span className="row-span-2 text-fg-muted">{each.turn === "morning" ? <Sunrise className="h-4 w-4" aria-hidden /> : <Sun className="h-4 w-4" aria-hidden />}</span>
              <span className="font-semibold">{t(each.turn === "morning" ? "web.confirm.rm.morning" : "web.confirm.rm.afternoon")}</span>
              <span className="text-sm text-fg-muted">{t("web.confirm.rm.range", { from: hhmm(each.from), to: hhmm(each.to) })}</span>
            </button>
          ))}
        </div>
      </>
    );
  } else if (step === 3) {
    title = t("web.confirm.rm.hour.title");
    body = (
      <>
        <p className="-mt-3 text-fg-muted first-letter:uppercase">{t(turn === "morning" ? "web.confirm.rm.hour.morning" : "web.confirm.rm.hour.afternoon", { day: dayLong })}</p>
        <fieldset className="flex flex-wrap gap-2.5">
          <legend className="sr-only">{t("web.confirm.rm.hour.label")}</legend>
          {(window?.hours ?? []).map((minute) => (
            <button
              key={minute}
              type="button"
              onClick={() => {
                setPref(minute);
                go(4);
              }}
              className="min-h-11 min-w-[4.5rem] rounded-full border border-border bg-surface px-4 font-medium tabular-nums transition-colors hover:border-border-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-safe:active:scale-[0.98]"
            >
              {hhmm(minute)}
            </button>
          ))}
        </fieldset>
      </>
    );
  } else {
    const slots = offer.data?.slots ?? [];
    title = offer.isSuccess && slots.length === 0 ? t("web.confirm.rm.full.title") : t("web.confirm.rm.slots.title");
    body = offer.isPending ? (
      <Loading label={t("web.confirm.rm.loading")} />
    ) : offer.isError ? (
      <Failed error={offer.error} onRetry={() => void offer.refetch()} />
    ) : (
      <>
        {taken && (
          <p role="alert" className="-mt-2 rounded-xl bg-danger-soft p-3 text-sm font-medium text-danger">
            {t("web.confirm.rm.taken")}
          </p>
        )}
        {failed && (
          <p role="alert" className="-mt-2 rounded-xl bg-danger-soft p-3 text-sm font-medium text-danger">
            {t("web.confirm.rm.moveFailed")}
          </p>
        )}
        {slots.length === 0 ? (
          <p className="-mt-3 text-fg-muted">{t("web.confirm.rm.full.body")}</p>
        ) : (
          <>
            <p className="-mt-3 text-fg-muted first-letter:uppercase">{t("web.confirm.rm.slots.sub", { day: dayLong })}</p>
            <ul className="grid gap-2.5">
              {slots.map((minute) => (
                <li key={minute}>
                  <button
                    type="button"
                    onClick={() => setPicked(minute)}
                    className="flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-left font-semibold tabular-nums transition-colors hover:border-border-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-safe:active:scale-[0.98]"
                  >
                    {t("web.confirm.rm.slot", { from: hhmm(minute), to: hhmm(minute + length) })}
                    <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <Button variant="ghost" className="w-full" onClick={() => go(1)}>
          {t("web.confirm.rm.restart")}
        </Button>
      </>
    );
  }

  return (
    <>
      <StepFrame key={`${step}-${taken ? "taken" : ""}`} step={step} title={title} onBack={back} backLabel={t("web.confirm.rm.back")} stepLabel={t("web.confirm.rm.step", { n: step })}>
        <div className="flex items-center gap-3 rounded-xl bg-raised px-4 py-3">
          <CalendarFold className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
          <span className="grid gap-0.5">
            <span className="text-xs text-fg-muted">{t("web.confirm.rm.current")}</span>
            <b className="font-semibold first-letter:uppercase">{t("web.confirm.rm.currentWhen", { day: currentDay, time: currentTime })}</b>
          </span>
        </div>
        {body}
      </StepFrame>
      <Dialog open={picked !== null} onClose={() => setPicked(null)} title={t("web.confirm.rm.ask.title")}>
        {picked !== null && (
          <p className="text-sm text-fg-muted first-letter:uppercase">
            {t("web.confirm.rm.ask.body", { day: dayLong, from: hhmm(picked), to: hhmm(picked + length), old: `${currentDay}, ${currentTime}` })}
          </p>
        )}
        {/* "Voltar" first and focused: Enter or a double tap by mistake never moves the appointment. */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" autoFocus onClick={() => setPicked(null)}>
            {t("web.confirm.rm.ask.back")}
          </Button>
          <Button loading={move.isPending} onClick={() => picked !== null && move.mutate(picked)}>
            {t("web.confirm.rm.ask.yes")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** Each step: the progress and Voltar on top, the title (focused, so a screen reader hears the new step), then the content. */
function StepFrame({ step, title, onBack, backLabel, stepLabel, children }: { step: Step; title: string; onBack: () => void; backLabel: string; stepLabel: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="grid gap-5 motion-safe:animate-rise">
      <div className="flex items-center justify-between gap-2">
        <div className="grid gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{stepLabel}</p>
          <span aria-hidden className="flex gap-1">
            {[1, 2, 3, 4].map((i) => (
              <i key={i} className={cn("h-1 w-7 rounded-sm", i <= step ? "bg-accent" : "bg-border")} />
            ))}
          </span>
        </div>
        <Button variant="ghost" className="px-3" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {backLabel}
        </Button>
      </div>
      <h1 ref={ref} tabIndex={-1} className="text-2xl font-semibold tracking-tight focus:outline-none">
        {title}
      </h1>
      {children}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <output aria-label={label} aria-busy="true" className="grid gap-2.5">
      <span className="h-[72px] rounded-xl zuri-skeleton" />
      <span className="h-[72px] rounded-xl zuri-skeleton" />
    </output>
  );
}

function Failed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  const limited = error instanceof ApiError && error.code === "RATE_LIMITED";
  return (
    <div role="alert" className="grid justify-items-start gap-2">
      <p className="text-fg-muted">{limited ? t("web.confirm.limited.body") : t("web.confirm.down.title")}</p>
      {!limited && (
        <Button variant="secondary" onClick={onRetry}>
          {t("web.confirm.retry")}
        </Button>
      )}
    </div>
  );
}
