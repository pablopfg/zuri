import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CrmAutomation,
  type CrmAutomationActivity,
  type CrmAutomationEffect,
  type CrmAutomationList,
  type CrmAutomationPause,
  type CrmAutomationVerdict,
  type FlowConnection,
  type FlowConnectionTest,
  type MessageKey,
  ptBRCrmAutomations,
} from "@zuri/shared";
import {
  Bell,
  CalendarCheck,
  ChartNoAxesColumn,
  Check,
  Contact,
  Gift,
  HeartPulse,
  Info,
  LockKeyhole,
  type LucideIcon,
  MailCheck,
  Megaphone,
  MessageCircleHeart,
  Power,
  RefreshCcw,
  Settings2,
  UserRoundCheck,
  Zap,
} from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { useToast } from "../../components/Toaster.tsx";
import { Button, cn, ErrorNotice, Loading, SelectField, TextField } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { Badge } from "../automations/parts.tsx";
import { PROBLEM_LABEL } from "../automations/flows/labels.ts";

// The part's pt-BR texts travel with the CRM's code, not in the first bundle (rule P11).
addMessages(ptBRCrmAutomations);

/** The live channel's "crm" area refreshes everything under this key (lib/versions.ts). */
const KEY = ["crm", "automations"] as const;

const ICON: Record<string, LucideIcon> = {
  "review-request": MessageCircleHeart,
  "review-link": UserRoundCheck,
  "appointment-confirmation": CalendarCheck,
  "plan-ready": MailCheck,
  "message-report": ChartNoAxesColumn,
  "chatwoot-mirror": Contact,
  "google-posts": Megaphone,
  birthday: Gift,
  "win-back": RefreshCcw,
  "plan-follow-up": HeartPulse,
};

type Tone = "neutral" | "accent" | "warning" | "danger" | "success";
const STATE: Record<string, [MessageKey, Tone]> = {
  off: ["web.crmAutomations.state.off", "neutral"],
  rehearsal: ["web.crmAutomations.state.rehearsal", "warning"],
  live: ["web.crmAutomations.state.live", "success"],
  paused: ["web.crmAutomations.state.paused", "danger"],
  next: ["web.crmAutomations.state.next", "accent"],
  development: ["web.crmAutomations.state.development", "neutral"],
};

/** The names and descriptions by id (pt-BR-crm-automations.ts); an id the catalog doesn't know shows as it is. */
const NAME: Record<string, MessageKey> = {
  "review-request": "web.crmAutomations.name.review-request",
  "review-link": "web.crmAutomations.name.review-link",
  "appointment-confirmation": "web.crmAutomations.name.appointment-confirmation",
  "plan-ready": "web.crmAutomations.name.plan-ready",
  "message-report": "web.crmAutomations.name.message-report",
  "chatwoot-mirror": "web.crmAutomations.name.chatwoot-mirror",
  "google-posts": "web.crmAutomations.name.google-posts",
  "birthday": "web.crmAutomations.name.birthday",
  "win-back": "web.crmAutomations.name.win-back",
  "plan-follow-up": "web.crmAutomations.name.plan-follow-up",
  "example": "web.crmAutomations.name.example",
};
const ABOUT: Record<string, MessageKey> = {
  "review-request": "web.crmAutomations.about.review-request",
  "review-link": "web.crmAutomations.about.review-link",
  "appointment-confirmation": "web.crmAutomations.about.appointment-confirmation",
  "plan-ready": "web.crmAutomations.about.plan-ready",
  "message-report": "web.crmAutomations.about.message-report",
  "chatwoot-mirror": "web.crmAutomations.about.chatwoot-mirror",
  "google-posts": "web.crmAutomations.about.google-posts",
  "birthday": "web.crmAutomations.about.birthday",
  "win-back": "web.crmAutomations.about.win-back",
  "plan-follow-up": "web.crmAutomations.about.plan-follow-up",
  "example": "web.crmAutomations.about.example",
};

const BASE: Record<"calendar" | "queue" | "identity", [MessageKey, MessageKey]> = {
  calendar: ["web.crmAutomations.base.calendar.title", "web.crmAutomations.base.calendar.body"],
  queue: ["web.crmAutomations.base.queue.title", "web.crmAutomations.base.queue.body"],
  identity: ["web.crmAutomations.base.identity.title", "web.crmAutomations.base.identity.body"],
};

const REASON: Record<CrmAutomationPause, MessageKey> = {
  failures: "web.crmAutomations.reason.failures",
  credential: "web.crmAutomations.reason.credential",
  bad_answer: "web.crmAutomations.reason.bad_answer",
};

const EFFECT: Record<CrmAutomationEffect["status"], MessageKey> = {
  would: "web.crmAutomations.effect.would",
  pending: "web.crmAutomations.effect.pending",
  done: "web.crmAutomations.effect.done",
  failed: "web.crmAutomations.effect.failed",
};

/** The options' names; one the catalog doesn't name shows its key. */
const OPTION: Record<string, MessageKey> = { perDay: "web.crmAutomations.option.perDay" };

function useNames() {
  const { t } = useI18n();
  return {
    name: (id: string) => {
      const key = NAME[id];
      return key ? t(key) : id;
    },
    about: (id: string) => {
      const key = ABOUT[id];
      return key ? t(key) : "";
    },
  };
}

export function useCrmAutomations() {
  return useQuery({ queryKey: [...KEY, "list"], queryFn: ({ signal }) => api<CrmAutomationList>("/crm/automations", { signal }) });
}

/** The owner's action on an automation, with the part refreshed after; the toast says how it went. */
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
 * CRM › Automações (PR S18): the n8n workflows written again in Zuri's code,
 * in the order they arrive. One without code shows where it is, with "Avisar
 * quando chegar"; one with code turns on in rehearsal and is followed here day
 * by day until the owner turns it on for real.
 */
export function AutomationsPart({ connections }: { connections: FlowConnection[] }) {
  const { t, plural } = useI18n();
  const list = useCrmAutomations();
  const [open, setOpen] = useState<string | null>(null);
  if (list.isPending) return <Loading label={t("web.crmAutomations.loading")} />;
  if (!list.data) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;
  const { automations, base, limits } = list.data;
  const ready = automations.filter((item) => item.availability === "ready").length;
  return (
    <>
      <section aria-labelledby="crm-automations-base" className="space-y-3">
        <h2 id="crm-automations-base" className="text-sm font-semibold text-fg-muted">
          {t("web.crmAutomations.base.title")}
        </h2>
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface px-4 text-sm leading-6 shadow-sm sm:px-5">
          {(["calendar", "queue", "identity"] as const).map((part) => (
            <li key={part} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3">
              <Check className={cn("mt-1 h-4 w-4 shrink-0", base[part] === "ready" ? "text-success" : "text-fg-subtle")} aria-hidden />
              <span className="min-w-0 flex-1">
                <b className="font-semibold">{t(BASE[part][0])}</b> {t(BASE[part][1])}
              </span>
              <Badge dot tone={base[part] === "ready" ? "success" : "neutral"}>
                {t(base[part] === "ready" ? "web.crmAutomations.base.ready" : "web.crmAutomations.base.coming")}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="crm-automations-list" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="crm-automations-list" className="text-sm font-semibold text-fg-muted">
            {t("web.crmAutomations.list.title")}
          </h2>
          <span className="text-sm tabular-nums text-fg-muted">{plural("web.crmAutomations.list.ready", ready, { total: automations.length })}</span>
        </div>
        <ol aria-labelledby="crm-automations-list" className="zuri-routines">
          {automations.map((item) => (
            <AutomationRow
              key={item.id}
              item={item}
              open={open === item.id}
              onToggle={() => setOpen(open === item.id ? null : item.id)}
              connections={connections.filter((connection) => connection.kind === item.connectionKind)}
              rehearsalDays={limits.rehearsalDays}
            />
          ))}
        </ol>
      </section>
      <p className="flex items-start gap-2 text-sm leading-6 text-fg-muted">
        <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden />
        <span>{t("web.crmAutomations.footnote")}</span>
      </p>
    </>
  );
}

function AutomationRow({ item, open, onToggle, connections, rehearsalDays }: { item: CrmAutomation; open: boolean; onToggle: () => void; connections: FlowConnection[]; rehearsalDays: number }) {
  const { t } = useI18n();
  const { name, about } = useNames();
  const { busy, act } = useAction();
  const titleId = useId();
  const panelId = useId();
  const Icon = ICON[item.id] ?? Zap;
  const coming = item.availability !== "ready";
  const [label, tone] = STATE[coming ? item.availability : item.state] ?? STATE.off as [MessageKey, Tone];
  const title = name(item.id);
  return (
    <li aria-labelledby={titleId} className={cn("zuri-routine", coming && "opacity-90")}>
      <span className="zuri-routine-tile" aria-hidden>
        <Icon />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <h3 id={titleId} className="flex min-w-0 items-baseline gap-2 font-semibold">
          <span className="tabular-nums text-fg-muted">{item.position}</span>
          <span className="min-w-0 break-words">{title}</span>
        </h3>
        <p className="text-sm leading-6 text-fg-muted">{about(item.id)}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          <Badge dot tone={tone}>
            {t(label)}
          </Badge>
          {item.writesToContacts && <Badge tone="neutral">{t("web.crmAutomations.writes")}</Badge>}
          {item.connectionKind && !coming && <span>{t(item.connectionKind === "chatwoot" ? "web.crmAutomations.uses.chatwoot" : "web.crmAutomations.uses.http")}</span>}
        </p>
      </div>
      <div className="zuri-routine-actions">
        {coming ? (
          <button
            type="button"
            className="zuri-icon-button"
            aria-pressed={item.watch}
            aria-label={t(item.watch ? "web.crmAutomations.watch.off" : "web.crmAutomations.watch.on", { name: title })}
            title={t(item.watch ? "web.crmAutomations.watch.off" : "web.crmAutomations.watch.on", { name: title })}
            disabled={busy !== null}
            onClick={() =>
              void act("watch", async () => {
                await api(`/crm/automations/${item.id}/watch`, { method: "PUT", body: { watch: !item.watch } });
                return t(item.watch ? "web.crmAutomations.watch.removed" : "web.crmAutomations.watch.saved");
              })
            }
          >
            {item.watch ? <Check className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
          </button>
        ) : (
          <Button variant="secondary" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
            {item.state === "off" ? <Power className="h-4 w-4" aria-hidden /> : <Settings2 className="h-4 w-4" aria-hidden />}
            {t(item.state === "off" ? "web.crmAutomations.turnOn" : "web.crmAutomations.follow")}
          </Button>
        )}
      </div>
      {open && !coming && (
        <div id={panelId} className="col-span-full">
          {item.state === "off" ? <SetupPanel item={item} title={title} connections={connections} rehearsalDays={rehearsalDays} onCancel={onToggle} /> : <FollowPanel item={item} />}
        </div>
      )}
    </li>
  );
}

/** Off: the credential (tested first), the limits, and the rehearsal it always starts in. */
function SetupPanel({ item, title, connections, rehearsalDays, onCancel }: { item: CrmAutomation; title: string; connections: FlowConnection[]; rehearsalDays: number; onCancel: () => void }) {
  const i18n = useI18n();
  const { t, plural } = i18n;
  const toast = useToast();
  const { busy, act } = useAction();
  const [connectionId, setConnectionId] = useState(item.connectionId ?? connections[0]?.id ?? "");
  const [tested, setTested] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, number | string>>(item.options);
  const needs = item.connectionKind !== null;
  const canSave = !needs || (connectionId !== "" && tested === connectionId);
  return (
    <form
      aria-label={t("web.crmAutomations.setup.label", { name: title })}
      className="mt-3 space-y-4 rounded-2xl border border-border bg-raised p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        void act("start", async () => {
          await api(`/crm/automations/${item.id}/config`, { method: "PUT", body: { connectionId: needs ? connectionId : null, options } });
          await api(`/crm/automations/${item.id}/mode`, { method: "POST", body: { mode: "rehearsal" } });
          return t("web.crmAutomations.setup.started");
        });
      }}
    >
      {needs && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">{t("web.crmAutomations.setup.credential")}</legend>
          {connections.length === 0 ? (
            <p className="text-sm leading-6 text-fg-muted">
              {t("web.crmAutomations.setup.noCredential")}{" "}
              <Link className="font-medium text-accent-text underline" to="/crm/credenciais">
                {t("web.crmAutomations.setup.credentials")}
              </Link>
            </p>
          ) : (
            <>
              <SelectField label={t("web.crmAutomations.setup.use")} value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </SelectField>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  loading={busy === "test"}
                  onClick={() =>
                    void act("test", async () => {
                      const { test } = await api<{ test: FlowConnectionTest }>(`/flows/connections/${connectionId}/test`, { method: "POST" });
                      if (!test.ok) return t("web.flows.test.failed", { problem: t(PROBLEM_LABEL[test.problem]) });
                      setTested(connectionId);
                      return test.inboxes ? plural("web.flows.test.inboxes", test.inboxes.length) : t("web.flows.test.answered", { ms: test.ms });
                    })
                  }
                >
                  {t("web.crmAutomations.setup.test")}
                </Button>
                <Link className="text-sm font-medium text-accent-text underline" to="/crm/credenciais">
                  {t("web.crmAutomations.setup.credentials")}
                </Link>
              </div>
            </>
          )}
        </fieldset>
      )}
      {item.optionDefs.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">{t("web.crmAutomations.setup.limits")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {item.optionDefs.map((def) => {
              const named = OPTION[def.key];
              const label = named ? t(named) : def.key;
              return def.kind === "number" ? (
                <TextField
                  key={def.key}
                  label={label}
                  type="number"
                  inputMode="numeric"
                  min={def.min}
                  max={def.max}
                  step={1}
                  required
                  hint={t("web.crmAutomations.setup.range", { min: def.min, max: def.max })}
                  value={String(options[def.key] ?? def.default)}
                  onChange={(event) => setOptions({ ...options, [def.key]: Number(event.target.value) })}
                />
              ) : (
                <TextField
                  key={def.key}
                  label={label}
                  type="time"
                  min={def.min}
                  max={def.max}
                  required
                  hint={t("web.crmAutomations.setup.range", { min: def.min, max: def.max })}
                  value={String(options[def.key] ?? def.default)}
                  onChange={(event) => setOptions({ ...options, [def.key]: event.target.value })}
                />
              );
            })}
          </div>
        </fieldset>
      )}
      <div className="space-y-3">
        <p className="text-sm font-semibold">{t("web.crmAutomations.setup.start")}</p>
        <p className="text-sm leading-6 text-fg-muted">{t("web.crmAutomations.setup.startHint", { days: rehearsalDays })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={busy === "start"} disabled={!canSave} onClick={() => !canSave && toast(t("web.crmAutomations.setup.testFirst"))}>
            <Zap className="h-4 w-4" aria-hidden />
            {t("web.crmAutomations.setup.save")}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t("web.crmAutomations.cancel")}
          </Button>
        </div>
        {!canSave && needs && connections.length > 0 && <p className="text-sm text-fg-muted">{t("web.crmAutomations.setup.testFirst")}</p>}
      </div>
    </form>
  );
}

/** On, in rehearsal or paused: the days to check, what Zuri did, and the way on or off. */
function FollowPanel({ item }: { item: CrmAutomation }) {
  const { t, plural, dateTime, locale } = useI18n();
  const { busy, act } = useAction();
  const [risk, setRisk] = useState(false);
  const riskId = useId();
  const activity = useQuery({
    queryKey: [...KEY, "activity", item.id],
    queryFn: ({ signal }) => api<CrmAutomationActivity>(`/crm/automations/${item.id}/activity`, { signal }),
    staleTime: 15_000,
  });
  const rehearsing = item.state === "rehearsal" || (item.state === "paused" && item.liveSince === null);
  const dayName = (day: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const setMode = (mode: "rehearsal" | "live" | "off", acceptRisk = false) =>
    void act(mode, async () => {
      await api(`/crm/automations/${item.id}/mode`, { method: "POST", body: { mode, ...(acceptRisk ? { acceptRisk } : {}) } });
      return t(mode === "off" ? "web.crmAutomations.turnedOff" : mode === "live" ? "web.crmAutomations.goLive.done" : "web.crmAutomations.setup.started");
    });
  const since = item.state === "live" ? item.liveSince : item.rehearsalSince;
  return (
    <div className="mt-3 space-y-4 rounded-2xl border border-border bg-raised p-4">
      <p className="text-sm leading-6 text-fg-muted">
        {item.state === "paused"
          ? t("web.crmAutomations.follow.paused", { reason: t(REASON[item.pausedReason ?? "failures"]) })
          : t(item.state === "live" ? "web.crmAutomations.follow.live" : "web.crmAutomations.follow.rehearsal", { date: since ? dateTime(since) : "" })}
      </p>
      {activity.isPending ? (
        <Loading label={t("web.crmAutomations.loading")} />
      ) : !activity.data ? (
        <ErrorNotice error={activity.error} onRetry={() => void activity.refetch()} />
      ) : (
        <>
          {rehearsing && (
            <section aria-label={t("web.crmAutomations.days.title")} className="space-y-2">
              <h4 className="text-sm font-semibold">{t("web.crmAutomations.days.title")}</h4>
              <p className="text-sm leading-6 text-fg-muted">{t("web.crmAutomations.days.hint", { matched: item.rehearsal.matched, required: item.rehearsal.required })}</p>
              {activity.data.days.length === 0 ? (
                <p className="text-sm text-fg-muted">{t("web.crmAutomations.days.empty")}</p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-3">
                  {activity.data.days.map((day) => (
                    <DayRow key={day.day} automationId={item.id} day={day.day} label={dayName(day.day)} items={plural("web.crmAutomations.day.items", day.would)} ran={day.ran} verdict={day.verdict} note={day.note} />
                  ))}
                </ul>
              )}
            </section>
          )}
          <section aria-label={t("web.crmAutomations.effects.title")} className="space-y-2">
            <h4 className="text-sm font-semibold">{t("web.crmAutomations.effects.title")}</h4>
            {activity.data.effects.length === 0 ? (
              <p className="text-sm text-fg-muted">{t("web.crmAutomations.effects.empty")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-3 text-sm">
                {activity.data.effects.map((effect) => (
                  <li key={effect.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <time className="tabular-nums text-fg-muted" dateTime={effect.at}>
                      {dateTime(effect.at)}
                    </time>
                    <span className="min-w-0 flex-1 break-words">{effect.label}</span>
                    <Badge tone={effect.status === "failed" ? "danger" : effect.status === "done" ? "success" : "neutral"}>{t(EFFECT[effect.status])}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <div className="space-y-3">
        {rehearsing && !item.rehearsal.ready && item.state === "rehearsal" && (
          <label htmlFor={riskId} className="flex items-start gap-2 text-sm leading-6">
            <input id={riskId} type="checkbox" className="mt-1 h-4 w-4" checked={risk} onChange={(event) => setRisk(event.target.checked)} />
            <span>{t("web.crmAutomations.goLive.risk", { days: item.rehearsal.required })}</span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          {item.state === "rehearsal" && (
            <Button loading={busy === "live"} disabled={!item.rehearsal.ready && !risk} onClick={() => setMode("live", !item.rehearsal.ready)}>
              <Power className="h-4 w-4" aria-hidden />
              {t("web.crmAutomations.goLive")}
            </Button>
          )}
          {item.state === "paused" && (
            <Button loading={busy === "rehearsal" || busy === "live"} onClick={() => setMode(item.liveSince ? "live" : "rehearsal")}>
              {t(item.liveSince ? "web.crmAutomations.goLive" : "web.crmAutomations.resume")}
            </Button>
          )}
          <Button variant="secondary" loading={busy === "off"} onClick={() => setMode("off")}>
            {t("web.crmAutomations.turnOff")}
          </Button>
        </div>
        <p className="flex items-start gap-2 text-sm leading-6 text-fg-muted">
          <LockKeyhole className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          <span>{t("web.crmAutomations.goLive.hint")}</span>
        </p>
      </div>
    </div>
  );
}

/** One working day of the rehearsal: right, or wrong with the reason (the server asks for one). */
function DayRow({ automationId, day, label, items, ran, verdict, note }: { automationId: string; day: string; label: string; items: string; ran: boolean; verdict: CrmAutomationVerdict | null; note: string | null }) {
  const { t } = useI18n();
  const { busy, act } = useAction();
  const [writing, setWriting] = useState(verdict === "differs");
  const [reason, setReason] = useState(note ?? "");
  const groupId = useId();
  const save = (next: CrmAutomationVerdict, text?: string) =>
    act(next, async () => {
      await api(`/crm/automations/${automationId}/days/${day}`, { method: "PUT", body: next === "match" ? { verdict: next } : { verdict: next, note: text } });
      return t("web.crmAutomations.day.saved");
    });
  return (
    <li className="space-y-2 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span id={groupId} className="min-w-0 flex-1 text-sm">
          <b className="font-semibold">{label}</b> · <span className="text-fg-muted">{items}</span>
        </span>
        {/* A day is checked once the rehearsal ran on it, never before it happened. */}
        {!ran ? (
          <span className="text-sm text-fg-muted">{t("web.crmAutomations.day.notRun")}</span>
        ) : (
        <fieldset aria-labelledby={groupId} className="flex gap-2">
          <Button
            variant={verdict === "match" ? "primary" : "secondary"}
            aria-pressed={verdict === "match"}
            loading={busy === "match"}
            onClick={() => {
              setWriting(false);
              void save("match");
            }}
          >
            {t("web.crmAutomations.day.right")}
          </Button>
          <Button variant={verdict === "differs" || writing ? "primary" : "secondary"} aria-pressed={verdict === "differs"} onClick={() => setWriting(true)}>
            {t("web.crmAutomations.day.wrong")}
          </Button>
        </fieldset>
        )}
      </div>
      {writing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) void save("differs", reason.trim());
          }}
        >
          <TextField className="min-w-0 flex-1" label={t("web.crmAutomations.day.note")} value={reason} maxLength={280} required onChange={(event) => setReason(event.target.value)} />
          <Button type="submit" variant="secondary" loading={busy === "differs"} disabled={!reason.trim()}>
            {t("web.crmAutomations.day.saveNote")}
          </Button>
        </form>
      )}
    </li>
  );
}
