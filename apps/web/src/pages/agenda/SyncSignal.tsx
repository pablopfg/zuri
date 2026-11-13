import type { MessageKey } from "@zuri/shared";
import { CircleCheck, CircleX, CloudOff, Hourglass, Link2Off, LoaderCircle, Lock, RefreshCcw, RefreshCw, WifiOff } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button, cn, Dialog } from "../../components/ui.tsx";
import { useI18n } from "../../lib/i18n.tsx";
import type { ChangeLine, ChangeProblem } from "./changes.ts";

/**
 * The sync signal of the Agenda (E5d, protótipo v51 item 4): one button that says where the
 * Agenda stands with Google, with an icon, a color and a short name (the color never goes alone),
 * and a panel with what happened, what to do, the visit's last changes and what each signal means.
 */
export type SyncKind = "ok" | "saving" | "saved" | "pulling" | "offline" | "failed" | "changed" | "paused" | "stale";

/** No word from Google for this long: the screen may be out of date. */
export const STALE_MS = 15 * 60_000;

/**
 * The signal now, most urgent first: a change on its way, the last change's problem, a reading on its
 * way, an old or failed reading, a change saved a moment ago, and else all in step.
 */
export function syncKind(input: { saving: boolean; problem: ChangeProblem["kind"] | null; fetching: boolean; readFailed: boolean; readAt: number; savedAt: number | null; savedMs: number; now: number }): SyncKind {
  if (input.saving) return "saving";
  if (input.problem) return input.problem;
  if (input.fetching) return "pulling";
  if (input.readFailed) return "stale";
  // Not read yet (the first reading has not started): nothing is out of date.
  if (input.readAt === 0) return "pulling";
  if (input.now - input.readAt > STALE_MS) return "stale";
  if (input.savedAt !== null && input.now - input.savedAt < input.savedMs) return "saved";
  return "ok";
}

type Tone = "ok" | "info" | "warn" | "danger" | "muted";
type Look = { icon: ReactNode; tone: Tone; name: MessageKey; legend: MessageKey };

const ICON = "h-3.5 w-3.5 shrink-0";
const LOOK: Record<SyncKind | "expired" | "readOnly", Look> = {
  ok: { icon: <CircleCheck className={ICON} aria-hidden />, tone: "ok", name: "web.agenda.sync.ok", legend: "web.agenda.sync.legend.ok" },
  saving: { icon: <LoaderCircle className={cn(ICON, "motion-safe:animate-spin")} aria-hidden />, tone: "info", name: "web.agenda.sync.saving", legend: "web.agenda.sync.what.saving" },
  saved: { icon: <CircleCheck className={ICON} aria-hidden />, tone: "ok", name: "web.agenda.sync.saved", legend: "web.agenda.sync.what.arrived" },
  pulling: { icon: <RefreshCw className={cn(ICON, "motion-safe:animate-spin")} aria-hidden />, tone: "info", name: "web.agenda.sync.pulling", legend: "web.agenda.sync.what.pulling" },
  offline: { icon: <WifiOff className={ICON} aria-hidden />, tone: "warn", name: "web.agenda.sync.offline", legend: "web.agenda.sync.legend.offline" },
  failed: { icon: <CircleX className={ICON} aria-hidden />, tone: "danger", name: "web.agenda.sync.failed", legend: "web.agenda.sync.legend.failed" },
  changed: { icon: <RefreshCcw className={ICON} aria-hidden />, tone: "warn", name: "web.agenda.sync.changed", legend: "web.agenda.sync.legend.changed" },
  paused: { icon: <Hourglass className={ICON} aria-hidden />, tone: "warn", name: "web.agenda.sync.paused", legend: "web.agenda.sync.legend.paused" },
  stale: { icon: <CloudOff className={ICON} aria-hidden />, tone: "warn", name: "web.agenda.sync.stale", legend: "web.agenda.sync.legend.stale" },
  expired: { icon: <Link2Off className={ICON} aria-hidden />, tone: "danger", name: "web.agenda.sync.expired", legend: "web.agenda.sync.legend.expired" },
  readOnly: { icon: <Lock className={ICON} aria-hidden />, tone: "muted", name: "web.agenda.sync.readOnly", legend: "web.agenda.sync.legend.readOnly" },
};

const TONE: Record<Tone, string> = {
  ok: "text-success",
  info: "text-accent-text",
  warn: "text-warning",
  danger: "text-danger",
  muted: "text-fg-muted",
};

const LEGEND: readonly (keyof typeof LOOK)[] = ["ok", "saving", "saved", "pulling", "offline", "failed", "changed", "paused", "stale", "expired", "readOnly"];

export function SyncSignal({
  kind,
  readAt,
  problem,
  log,
  onPull,
  onShow,
}: {
  kind: SyncKind;
  /** When Google answered the screen's reading last. */
  readAt: number;
  problem: ChangeProblem | null;
  log: readonly ChangeLine[];
  /** Reads the events again ("Atualizar agora"). */
  onPull: () => void;
  /** Opens the event of the last change's problem ("Ver o evento"); none when it is no longer on screen. */
  onShow: ((problem: ChangeProblem) => void) | undefined;
}) {
  const { t, locale, timeZone } = useI18n();
  const [open, setOpen] = useState(false);
  const look = LOOK[kind];
  const time = (at: number) => new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const title = problem?.event.title || t("web.agenda.event.untitled");
  const what =
    kind === "ok"
      ? t("web.agenda.sync.what.ok", { time: time(readAt) })
      : kind === "stale"
        ? readAt === 0
          ? t("web.agenda.sync.what.staleNever")
          : t("web.agenda.sync.what.stale", { time: time(readAt) })
        : kind === "offline"
          ? t("web.agenda.sync.what.offline", { title })
          : kind === "changed"
            ? t("web.agenda.sync.what.changed", { title })
            : kind === "paused"
              ? t("web.agenda.sync.what.paused", { title })
              : kind === "failed"
            ? t("web.agenda.sync.what.failed", { title, reason: problem?.reason ?? "" })
            : t(look.legend);
  const act = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  const action =
    problem && (kind === "offline" || kind === "paused") && problem.retry ? (
      <Button onClick={act(problem.retry)}>{t("web.retry")}</Button>
    ) : problem && onShow && (kind === "failed" || kind === "changed") ? (
      <Button variant="secondary" onClick={act(() => onShow(problem))}>
        {t("web.agenda.sync.show")}
      </Button>
    ) : kind === "ok" || kind === "saved" || kind === "stale" ? (
      <Button variant={kind === "stale" ? "primary" : "secondary"} onClick={act(onPull)}>
        <RefreshCw className="h-4 w-4" aria-hidden />
        {t("web.agenda.sync.pull")}
      </Button>
    ) : null;
  return (
    <>
      <button
        type="button"
        data-sync={kind}
        aria-haspopup="dialog"
        aria-label={t("web.agenda.sync.label", { name: t(look.name) })}
        onClick={() => setOpen(true)}
        className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium hover:bg-raised", TONE[look.tone])}
      >
        {look.icon}
        <span>{t(look.name)}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("web.agenda.sync.title")}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-fg-muted">{t("web.agenda.sync.intro")}</p>
          <div role="status" className="flex flex-wrap items-start gap-3 rounded-xl border border-border p-3">
            <span className={cn("mt-0.5", TONE[look.tone])}>{look.icon}</span>
            <p className="min-w-0 flex-1 text-sm leading-6">
              <b className="block">{t(look.name)}</b>
              {what}
            </p>
            {action}
          </div>
          <section aria-labelledby="sync-log" className="space-y-2">
            <h3 id="sync-log" className="text-sm font-semibold">
              {t("web.agenda.sync.log")}
            </h3>
            {log.length === 0 ? (
              <p className="text-sm text-fg-muted">{t("web.agenda.sync.logEmpty")}</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {log.map((line) => (
                  <li key={`${line.at}-${line.text}`} className="flex gap-2">
                    <span className="shrink-0 tabular-nums text-fg-muted">{time(line.at)}</span>
                    <span className={cn("mt-1", line.ok ? "text-success" : "text-danger")}>{line.ok ? <CircleCheck className={ICON} aria-hidden /> : <CircleX className={ICON} aria-hidden />}</span>
                    <span className="min-w-0">
                      <span className="sr-only">{t(line.ok ? "web.agenda.sync.lineOk" : "web.agenda.sync.lineFailed")} </span>
                      {line.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <details className="text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{t("web.agenda.sync.legendTitle")}</summary>
            <ul className="space-y-2">
              {LEGEND.map((each) => (
                <li key={each} className="flex gap-2">
                  <span className={cn("mt-1", TONE[LOOK[each].tone])}>{LOOK[each].icon}</span>
                  <span className="min-w-0">
                    <b>{t(LOOK[each].name)}</b>: {t(LOOK[each].legend)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </Dialog>
    </>
  );
}
