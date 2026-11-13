import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type FlowConnectionTest,
  type MessageKey,
  OUTBOX_FILTERS,
  OUTBOX_PERIODS,
  type OutboxDetail,
  type OutboxFilter,
  type OutboxList,
  type OutboxPeriod,
  type OutboxProblem,
  type OutboxStatus,
  type OutboxStatusInfo,
  type OutboxStep,
  type OutboxStepKind,
  type OutboxStopReason,
  ptBROutbox,
} from "@zuri/shared";
// Icons no other screen uses, or that the CRM's code already brings: one another lazy screen shares
// becomes a file of its own and its name joins the first load's list (rule P11).
import { Bell, Cable, CircleAlert, CircleCheck, Clock3, ListOrdered, LockKeyhole, MessageSquareShare, Pause, Play, RefreshCcw, Search, TimerReset } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { useToast } from "../../components/Toaster.tsx";
import { Button, cn, Dialog, ErrorNotice, Loading } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { PROBLEM_LABEL } from "../automations/flows/labels.ts";
import { Badge } from "../automations/parts.tsx";
import { useNames } from "./AutomationsPart.tsx";

// The part's pt-BR texts travel with the CRM's code, not in the first bundle (rule P11).
addMessages(ptBROutbox);

/** The live channel's "crm" area refreshes everything under this key (lib/versions.ts). */
const KEY = ["crm", "outbox"] as const;

type Tone = "neutral" | "accent" | "warning" | "danger" | "success";

const STATUS: Record<OutboxStatus, [MessageKey, Tone]> = {
  queued: ["web.outbox.status.queued", "neutral"],
  sending: ["web.outbox.status.sending", "accent"],
  checking: ["web.outbox.status.checking", "warning"],
  sent: ["web.outbox.status.sent", "success"],
  delivered: ["web.outbox.status.delivered", "success"],
  failed: ["web.outbox.status.failed", "danger"],
  expired: ["web.outbox.status.expired", "warning"],
  blocked: ["web.outbox.status.blocked", "warning"],
  optout: ["web.outbox.status.optout", "warning"],
};

const PROBLEM: Record<OutboxProblem, MessageKey> = {
  timeout: "web.outbox.problem.timeout",
  network: "web.outbox.problem.network",
  http: "web.outbox.problem.http",
  refused: "web.outbox.problem.refused",
  bad_answer: "web.outbox.problem.bad_answer",
  credential: "web.outbox.problem.credential",
  other: "web.outbox.problem.other",
};

const STOP: Record<OutboxStopReason, MessageKey> = {
  failures: "web.outbox.stopped.failures",
  credential: "web.outbox.stopped.credential",
  bad_answer: "web.outbox.stopped.bad_answer",
};

/** The steps worded without a number or a reason; the others are worded in stepText. */
const STEP: Record<Exclude<OutboxStepKind, "failed_try" | "uncertain" | "sent">, MessageKey> = {
  queued: "web.outbox.step.queued",
  found_sent: "web.outbox.step.found_sent",
  gave_up: "web.outbox.step.gave_up",
  expired: "web.outbox.step.expired",
  blocked: "web.outbox.step.blocked",
  retried: "web.outbox.step.retried",
};

const PERIOD: Record<OutboxPeriod, MessageKey> = { today: "web.outbox.period.today", "7d": "web.outbox.period.7d", "30d": "web.outbox.period.30d" };
const FILTER: Record<OutboxFilter, MessageKey> = { all: "web.outbox.filter.all", sent: "web.outbox.filter.sent", failed: "web.outbox.filter.failed", skipped: "web.outbox.filter.skipped" };

export function useOutboxStatus() {
  return useQuery({ queryKey: [...KEY, "status"], queryFn: ({ signal }) => api<OutboxStatusInfo>("/outbox/status", { signal }), staleTime: 15_000 });
}

/** Times in the owner's time zone: the clock alone for today, the day too for older ones. */
function useClock() {
  const { locale, timeZone } = useI18n();
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone });
  const seconds = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone });
  const day = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const today = day.format(new Date());
  return {
    time: (at: string) => time.format(new Date(at)),
    seconds: (at: string) => seconds.format(new Date(at)),
    when: (at: string) => {
      const date = day.format(new Date(at));
      return date === today ? time.format(new Date(at)) : `${date} · ${time.format(new Date(at))}`;
    },
    secs: (ms: number) => number.format(ms / 1000),
  };
}

/** A press on the part: the toast says how it went, and the part reloads after. */
function useAction() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function act(key: string, work: () => Promise<string | null>): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    let ok = true;
    try {
      const message = await work();
      if (message) toast(message);
    } catch (error) {
      ok = false;
      toast(errorMessage(error));
    } finally {
      setBusy(null);
      await qc.invalidateQueries({ queryKey: KEY });
    }
    return ok;
  }
  return { busy, act };
}

/**
 * CRM › Envios (PR S19): the queue every message to a contact goes through.
 * The state on top, with the way to pause and resume; what waits now; what
 * happens when something goes wrong; and the history, with each send's steps.
 */
export function OutboxPart() {
  const { t } = useI18n();
  const status = useOutboxStatus();
  if (status.isPending) return <Loading label={t("web.outbox.loading")} />;
  if (!status.data) return <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />;
  return (
    <>
      <StatusCard info={status.data} />
      <div className="grid items-start gap-4 min-[1101px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <QueueCard info={status.data} />
        <RulesCard />
      </div>
      <History />
    </>
  );
}

function StatusCard({ info }: { info: OutboxStatusInfo }) {
  const { t, plural } = useI18n();
  const clock = useClock();
  const { busy, act } = useAction();
  const waiting = plural("web.outbox.hint.waiting", info.waiting, { n: info.waiting });
  const gap = info.connection?.bulkGap ?? { min: 0, max: 0 };
  const view: Record<"running" | "slow" | "stopped" | "paused" | "lockdown", { pill: string; tone: Tone; line: string; hint: string; edge: string }> = {
    running: {
      pill: t("web.outbox.state.running"),
      tone: "success",
      line: info.connection ? t("web.outbox.running.text", { min: gap.min, max: gap.max }) : t("web.outbox.running.noCredential"),
      hint: [info.lastAt ? t("web.outbox.hint.last", { time: clock.seconds(info.lastAt) }) : t("web.outbox.running.none"), info.nextAt ? t("web.outbox.hint.next", { time: clock.seconds(info.nextAt) }) : null, waiting].filter(Boolean).join(" · "),
      edge: "border-l-accent",
    },
    slow: {
      pill: t("web.outbox.state.slow"),
      tone: "warning",
      line: t("web.outbox.slow.text"),
      hint: `${t("web.outbox.slow.hint", { seconds: clock.secs(info.averageMs ?? 0) })} ${waiting}.`,
      edge: "border-l-warning",
    },
    stopped: {
      pill: t("web.outbox.state.stopped", { time: info.since ? clock.time(info.since) : "" }),
      tone: "danger",
      line: t(STOP[info.stopReason ?? "failures"]),
      hint: `${t("web.outbox.stopped.hint")} ${waiting}.`,
      edge: "border-l-danger",
    },
    paused: {
      pill: t("web.outbox.state.paused"),
      tone: "neutral",
      line: t("web.outbox.paused.text"),
      hint: `${waiting}. ${t("web.outbox.paused.hint")}`,
      edge: "border-l-border-strong",
    },
    lockdown: {
      pill: t("web.outbox.state.lockdown"),
      tone: "neutral",
      line: t("web.outbox.lockdown.text"),
      hint: `${waiting}.`,
      edge: "border-l-border-strong",
    },
  };
  const shown = view[info.lockdown ? "lockdown" : info.state];
  const pause = () =>
    void act("pause", async () => {
      await api("/outbox/pause", { method: "POST" });
      return t("web.outbox.paused.done");
    });
  const resume = () =>
    void act("resume", async () => {
      await api("/outbox/resume", { method: "POST" });
      return t("web.outbox.resumed.done");
    });
  const connection = info.connection;
  return (
    <section aria-labelledby="outbox-status" className={cn("grid gap-3 rounded-2xl border border-l-4 border-border bg-surface p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5", shown.edge)}>
      <h2 id="outbox-status" className="sr-only">
        {t("web.outbox.status.title")}
      </h2>
      <div className="min-w-0 space-y-1">
        <Badge dot tone={shown.tone}>
          {shown.pill}
        </Badge>
        <p className="pt-1 font-semibold">{shown.line}</p>
        <p className="text-sm leading-6 text-fg-muted">{shown.hint}</p>
      </div>
      {!info.lockdown && (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {info.state === "running" || info.state === "slow" ? (
            <Button variant="secondary" loading={busy === "pause"} onClick={pause}>
              <Pause className="h-4 w-4" aria-hidden />
              {t("web.outbox.pause")}
            </Button>
          ) : (
            <>
              {info.state === "stopped" && connection && (
                <Button
                  variant="secondary"
                  loading={busy === "test"}
                  onClick={() =>
                    void act("test", async () => {
                      const { test } = await api<{ test: FlowConnectionTest }>(`/flows/connections/${connection.id}/test`, { method: "POST" });
                      if (!test.ok) return t("web.flows.test.failed", { problem: t(PROBLEM_LABEL[test.problem]) });
                      return test.inboxes ? plural("web.flows.test.inboxes", test.inboxes.length) : t("web.flows.test.answered", { ms: test.ms });
                    })
                  }
                >
                  <Cable className="h-4 w-4" aria-hidden />
                  {t("web.outbox.test")}
                </Button>
              )}
              <Button loading={busy === "resume"} onClick={resume}>
                <Play className="h-4 w-4" aria-hidden />
                {t("web.outbox.resume")}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Card({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function QueueCard({ info }: { info: OutboxStatusInfo }) {
  const { t, plural } = useI18n();
  const clock = useClock();
  const { name } = useNames();
  const moving = !info.lockdown && (info.state === "running" || info.state === "slow");
  const more = info.waiting - info.queue.length;
  return (
    <Card id="outbox-queue" title={t("web.outbox.queue.title")} aside={info.connection && <span className="text-sm text-fg-muted">{info.connection.name}</span>}>
      {info.queue.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("web.outbox.queue.empty")}</p>
      ) : (
        <ol aria-labelledby="outbox-queue" className="divide-y divide-border">
          {info.queue.map((item, index) => (
            <li key={item.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-sm">
              <time className="tabular-nums text-fg-muted" dateTime={item.at}>
                {moving ? clock.time(item.at) : "—"}
              </time>
              <span className="grid min-w-0">
                <b className="truncate font-semibold">{item.label}</b>
                <span className="truncate text-fg-muted">{name(item.automationId)}</span>
              </span>
              <Badge dot tone={moving && index === 0 ? "warning" : "neutral"}>
                {t(moving ? (index === 0 ? "web.outbox.queue.next" : "web.outbox.queue.waiting") : "web.outbox.queue.held")}
              </Badge>
            </li>
          ))}
        </ol>
      )}
      {more > 0 && <p className="text-sm text-fg-muted">{plural("web.outbox.queue.more", more, { n: more })}</p>}
      <p className="text-sm leading-6 text-fg-muted">
        {t("web.outbox.queue.hint")}{" "}
        <Link className="inline-flex min-h-11 items-center font-medium text-accent-text underline" to="/crm/credenciais">
          {t("web.outbox.queue.credentials")}
        </Link>
      </p>
    </Card>
  );
}

const RULES = [
  [RefreshCcw, "web.outbox.rule.retry.title", "web.outbox.rule.retry.body"],
  [CircleAlert, "web.outbox.rule.stop.title", "web.outbox.rule.stop.body"],
  [TimerReset, "web.outbox.rule.slow.title", "web.outbox.rule.slow.body"],
  [Clock3, "web.outbox.rule.late.title", "web.outbox.rule.late.body"],
  [Bell, "web.outbox.rule.stall.title", "web.outbox.rule.stall.body"],
] as const;

function RulesCard() {
  const { t } = useI18n();
  return (
    <Card id="outbox-rules" title={t("web.outbox.rules.title")}>
      <ul className="divide-y divide-border text-sm leading-6 text-fg-muted">
        {RULES.map(([Icon, title, body]) => (
          <li key={title} className="flex items-start gap-2.5 py-2.5">
            <Icon className="mt-1 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <b className="font-semibold text-fg">{t(title)}</b> {t(body)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Buttons that keep one choice pressed, like the views of Tarefas. */
function Choice<T extends string>({ label, options, value, names, onChange }: { label: string; options: readonly T[]; value: T; names: Record<T, MessageKey>; onChange: (next: T) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="flex min-w-0 flex-wrap gap-1 rounded-xl bg-raised p-1 sm:w-fit">
      <legend className="sr-only">{label}</legend>
      {options.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={value === item}
          onClick={() => onChange(item)}
          className={cn("min-h-11 flex-auto whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors", value === item ? "bg-surface text-fg shadow-sm ring-1 ring-border-strong" : "text-fg-muted hover:text-fg")}
        >
          {t(names[item])}
        </button>
      ))}
    </fieldset>
  );
}

function History() {
  const { t } = useI18n();
  const clock = useClock();
  const { name } = useNames();
  const [period, setPeriod] = useState<OutboxPeriod>("today");
  const [filter, setFilter] = useState<OutboxFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: [...KEY, "list", period, filter],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const query = new URLSearchParams({ period, filter });
      if (pageParam) query.set("cursor", pageParam);
      return api<OutboxList>(`/outbox?${query}`, { signal });
    },
    getNextPageParam: (page) => page.cursor,
    staleTime: 15_000,
  });
  const first = list.data?.pages[0];
  const rows = list.data?.pages.flatMap((page) => page.rows) ?? [];
  const tile = (Icon: typeof MessageSquareShare, label: MessageKey, value: number, note: string) => (
    <div className="min-w-0 space-y-1 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <dt className="flex items-start gap-2 text-sm text-fg-muted">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {t(label)}
      </dt>
      <dd>
        <span className="block text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
        <span className="block text-sm text-fg-muted">{note}</span>
      </dd>
    </div>
  );
  return (
    <section aria-labelledby="outbox-history" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="outbox-history" className="text-lg font-semibold">
          {t("web.outbox.history.title")}
        </h2>
        <Choice label={t("web.outbox.period.label")} options={OUTBOX_PERIODS} value={period} names={PERIOD} onChange={setPeriod} />
      </div>
      {list.isPending ? (
        <Loading label={t("web.outbox.loading")} />
      ) : !first ? (
        <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 min-[1101px]:grid-cols-4">
            {tile(MessageSquareShare, "web.outbox.kpi.sent", first.counts.sent, first.counts.averageMs === null ? t("web.outbox.kpi.sent.none") : t("web.outbox.kpi.sent.hint", { seconds: clock.secs(first.counts.averageMs) }))}
            {tile(CircleCheck, "web.outbox.kpi.delivered", first.counts.delivered, t("web.outbox.kpi.delivered.hint"))}
            {tile(CircleAlert, "web.outbox.kpi.failed", first.counts.failed, t("web.outbox.kpi.failed.hint"))}
            {tile(Clock3, "web.outbox.kpi.skipped", first.counts.skipped, t("web.outbox.kpi.skipped.hint"))}
          </dl>
          <Choice label={t("web.outbox.filter.label")} options={OUTBOX_FILTERS} value={filter} names={FILTER} onChange={setFilter} />
          {rows.length === 0 ? (
            <p className="flex items-center gap-2 rounded-2xl border border-dashed border-border p-4 text-sm text-fg-muted">
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              {t("web.outbox.history.empty")}
            </p>
          ) : (
            <ul aria-labelledby="outbox-history" className="divide-y divide-border rounded-2xl border border-border bg-surface shadow-sm">
              {rows.map((row) => {
                const [label, tone] = STATUS[row.status];
                return (
                  <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[8.5rem_minmax(0,1fr)_auto_auto]">
                    <time className="tabular-nums text-fg-muted" dateTime={row.at}>
                      {clock.when(row.at)}
                    </time>
                    <span className="col-start-1 grid min-w-0 sm:col-start-auto">
                      <b className="truncate font-semibold">{row.label}</b>
                      <span className="truncate text-fg-muted">
                        {name(row.automationId)}
                        {row.attempts > 1 && ` · ${t("web.outbox.row.attempts", { n: row.attempts })}`}
                      </span>
                    </span>
                    <span className="col-start-2 row-start-1 justify-self-end sm:col-start-auto sm:row-start-auto">
                      <Badge dot tone={tone}>
                        {t(label)}
                      </Badge>
                    </span>
                    <Button variant="ghost" className="col-start-2 justify-self-end sm:col-start-auto" aria-haspopup="dialog" aria-label={t("web.outbox.row.viewLabel", { name: row.label })} onClick={() => setOpen(row.id)}>
                      {t("web.outbox.row.view")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {list.hasNextPage && (
            <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {t("web.outbox.history.more")}
            </Button>
          )}
        </>
      )}
      <p className="flex items-start gap-2 text-sm leading-6 text-fg-muted">
        <LockKeyhole className="mt-1 h-4 w-4 shrink-0" aria-hidden />
        <span>{t("web.outbox.history.foot")}</span>
      </p>
      <DetailDialog id={open} onClose={() => setOpen(null)} />
    </section>
  );
}

function stepText(step: OutboxStep, t: ReturnType<typeof useI18n>["t"], secs: (ms: number) => string): string {
  const problem = step.problem ? t(PROBLEM[step.problem]) : "";
  switch (step.kind) {
    case "failed_try":
      return t("web.outbox.step.failed_try", { n: step.attempt ?? 1, problem });
    case "uncertain":
      return step.attempt === null ? t("web.outbox.step.interrupted") : t("web.outbox.step.uncertain", { n: step.attempt, problem });
    case "sent":
      return step.ms === null ? t("web.outbox.step.sentPlain") : t("web.outbox.step.sent", { seconds: secs(step.ms) });
    default:
      return t(STEP[step.kind]);
  }
}

/** One send's steps; the text itself is not here, only in the Chatwoot conversation. */
function DetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const clock = useClock();
  const { name } = useNames();
  const { busy, act } = useAction();
  const detail = useQuery({
    queryKey: [...KEY, "detail", id],
    queryFn: ({ signal }) => api<OutboxDetail>(`/outbox/${id}`, { signal }),
    enabled: id !== null,
    staleTime: 15_000,
  });
  const data = id !== null ? detail.data : undefined;
  const title = data ? t("web.outbox.detail.title", { automation: name(data.automationId), name: data.label }) : t("web.outbox.detail.loading");
  return (
    <Dialog open={id !== null} onClose={onClose} title={title}>
      {detail.isPending ? (
        <Loading label={t("web.outbox.detail.loading")} />
      ) : !data ? (
        <ErrorNotice error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <>
          <p className="text-sm text-fg-muted">
            {clock.when(data.at)} · {t(STATUS[data.status][0])}
          </p>
          <ol className="space-y-2 text-sm leading-6">
            {data.steps.map((step) => (
              <li key={`${step.at}-${step.kind}-${step.attempt ?? 0}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
                <time className="tabular-nums text-fg-muted" dateTime={step.at}>
                  {clock.time(step.at)}
                </time>
                <span className={cn(step.kind === "failed_try" || step.kind === "gave_up" ? "text-danger" : step.kind === "sent" || step.kind === "found_sent" ? "text-fg" : "text-fg-muted")}>{stepText(step, t, clock.secs)}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm leading-6 text-fg-muted">{t("web.outbox.detail.note")}</p>
          {data.canRetry && (
            <div className="flex justify-end">
              <Button
                loading={busy === "retry"}
                onClick={() =>
                  void act("retry", async () => {
                    await api(`/outbox/${data.id}/retry`, { method: "POST" });
                    onClose();
                    return t("web.outbox.detail.retried");
                  })
                }
              >
                <RefreshCcw className="h-4 w-4" aria-hidden />
                {t("web.outbox.detail.retry")}
              </Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/** Credenciais' Chatwoot row: how many wait and the way to Envios (the queue's numbers live there). */
export function OutboxSummary({ connectionId, gap }: { connectionId: string; gap: { min: number; max: number } }) {
  const { t, plural } = useI18n();
  const status = useOutboxStatus();
  const waiting = status.data && status.data.connection?.id === connectionId ? status.data.waiting : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-raised px-3 py-2 text-sm">
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <ListOrdered className="mt-1 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
        <span className="min-w-0">
          <b className="font-semibold">{t("web.outbox.summary.title")}</b> <span className="text-fg-muted">{plural("web.outbox.summary", waiting, { n: waiting, min: gap.min, max: gap.max })}</span>
        </span>
      </span>
      <Link className="inline-flex min-h-11 items-center gap-2 font-medium text-accent-text underline" to="/crm/envios">
        <MessageSquareShare className="h-4 w-4" aria-hidden />
        {t("web.outbox.open")}
      </Link>
    </div>
  );
}
