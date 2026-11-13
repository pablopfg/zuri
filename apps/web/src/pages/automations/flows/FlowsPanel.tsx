import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { FLOW_LIMITS, FLOW_NODE_TYPES, FLOW_SETTING_RANGES, type Flow, type FlowConnection, type FlowConnectionTest, type FlowDraft, type FlowList, type FlowRun, type FlowRunPage, type FlowSettings, type FlowSite, type MessageKey, ptBRFlows, ptBRSchedule, type Schedule } from "@zuri/shared";
import { Cable, Copy, Earth, History, Info, KeyRound, Lightbulb, LockKeyhole, Pencil, Play, Power, Radar, ShieldCheck, Trash2, Workflow } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { ActionsMenu } from "../../../components/ActionsMenu.tsx";
import { NumbersForm } from "../../../components/NumbersForm.tsx";
import { useToast } from "../../../components/Toaster.tsx";
import { Button, buttonClass, Card, cn, Dialog, EmptyState, ErrorNotice, Loading } from "../../../components/ui.tsx";
import { api, errorMessage } from "../../../lib/api.ts";
import { copyName, describeSchedule } from "../../../lib/automations.ts";
import { addMessages, useI18n } from "../../../lib/i18n.tsx";
import { FlashStatus, flashClass, useFlash } from "../../../lib/lists.tsx";
import { Badge } from "../parts.tsx";
import type { Editing } from "./FlowEditor.tsx";
import { capitalizeFirst, NODE_LABEL, PROBLEM_LABEL, RUN_STATUS_LABEL, RUN_TRIGGER_LABEL, SITE_LABEL } from "./labels.ts";

// The tab's pt-BR texts travel with its code, not in the first bundle (rule P11).
addMessages(ptBRFlows);
// A flow's schedule reads as a routine's does (describeSchedule), and the editor names the
// days of the week: those words come with this screen too, or opening the CRM without
// having passed through Rotinas has no text for them (#297).
addMessages(ptBRSchedule);

/** Everything about flows starts with this key: the live channel's "flows" area refreshes it (lib/versions.ts). */
export const FLOWS_KEY = ["flows"] as const;

export function useFlows() {
  return useQuery({ queryKey: [...FLOWS_KEY, "list"], queryFn: ({ signal }) => api<FlowList>("/flows", { signal }) });
}

function useFlowRuns() {
  return useInfiniteQuery({
    queryKey: [...FLOWS_KEY, "runs"],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => api<FlowRunPage>(`/flows/runs${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`, { signal }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

type Translate = ReturnType<typeof useI18n>["t"];

/** A flow's trigger in the owner's words; the automations' wording, with intervals under an hour in minutes. */
export function describeTrigger(flow: Pick<Flow, "definition">, t: Translate, timeZone: string, dateTime: (value: Date) => string): string {
  const trigger = flow.definition.trigger;
  if (trigger.type === "manual") return t("web.flows.manual");
  const schedule: Schedule = trigger.schedule;
  if (schedule.type === "interval" && schedule.minutes % 60 !== 0) return t("web.flows.everyMinutes", { minutes: schedule.minutes });
  return describeSchedule(schedule, t, timeZone, dateTime);
}

/** The owner's action on a flow or a connection, with the tab refreshed after. */
function useFlowAction() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function act(key: string, work: () => Promise<string | null>) {
    if (busy) return;
    setBusy(key);
    try {
      const message = await work();
      if (message) toast(message);
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setBusy(null);
      await qc.invalidateQueries({ queryKey: FLOWS_KEY });
    }
  }
  return { busy, act };
}

/** "Chamar um serviço" in the middle of a sentence. */
const lowerFirst = (text: string) => (text ? (text[0] as string).toLocaleLowerCase() + text.slice(1) : text);

type Removing = { kind: "flow"; flow: Flow } | { kind: "connection"; connection: FlowConnection };
export type ConnectionEditing = { mode: "new" } | { mode: "edit"; connection: FlowConnection };

/**
 * CRM › Fluxos (Sinal, S15): the flows built from a closed list of steps, what
 * the chat suggested, the last runs and what holds for every flow. Every flow
 * is born off; turning one on asks for the password when it wasn't typed in
 * the last 15 minutes (the API client asks).
 */
export function FlowsPart({ data, onEdit }: { data: FlowList; onEdit: (editing: Editing) => void }) {
  const { t } = useI18n();
  const [removing, setRemoving] = useState<Removing | null>(null);
  const flows = data.flows;
  const flash = useFlash(data.flows, (flow) => flow.id, (flow) => `${flow.updatedAt}|${flow.enabled}|${flow.lastRunAt ?? ""}|${flow.sites.map((site) => site.state).join()}`);
  const full = data.counts.flows >= FLOW_LIMITS.flows;
  return (
    <>
      {flows.length === 0 ? (
        <EmptyState icon={<Workflow className="h-6 w-6" />} title={t("web.flows.empty.title")}>
          <p>{t("web.flows.empty.body")}</p>
        </EmptyState>
      ) : (
        <div className="space-y-2">
          <ul aria-label={t("web.flows.listLabel")} className="zuri-routines">
            {flows.map((flow) => (
              <FlowRow
                key={flow.id}
                flow={flow}
                full={full}
                failuresToPause={data.settings.failuresToPause}
                glow={flashClass(flash.glowing, flow.id)}
                onEdit={() => onEdit({ mode: "edit", flow })}
                onDelete={() => setRemoving({ kind: "flow", flow })}
              />
            ))}
          </ul>
          <p className="text-sm text-fg-muted">{t("web.flows.count", { flows: data.counts.flows, maxFlows: FLOW_LIMITS.flows, sites: data.counts.sites, maxSites: FLOW_LIMITS.sites })}</p>
        </div>
      )}
      <FlashStatus count={flash.remote} />
      <Drafts drafts={data.drafts} full={full} onReview={(draft) => onEdit({ mode: "draft", draft })} />
      <RunHistory />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex min-w-0 flex-1 basis-64 items-start gap-2 text-sm leading-6 text-fg-muted">
          <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          <span>{t("web.flows.note", { steps: FLOW_NODE_TYPES.map((type) => lowerFirst(t(NODE_LABEL[type]))).join(", "), request: t(NODE_LABEL.request) })}</span>
        </p>
        {/* A link of its own, 44 px tall: a word inside the sentence would be too small a target. */}
        <Link to="/crm/credenciais" className={buttonClass("ghost")}>
          {t("web.flows.noteLink")}
        </Link>
      </div>
      <FlowSettingsCard settings={data.settings} slots={data.counts.slots} slotsLimit={data.counts.slotsLimit} />
      <RemoveDialog removing={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

const SETTING_LABEL: Record<keyof FlowSettings, MessageKey> = {
  minIntervalMinutes: "web.flows.settings.minInterval",
  aiMinIntervalMinutes: "web.flows.settings.aiMinInterval",
  runsPerDay: "web.flows.settings.runs",
  callsPerRun: "web.flows.settings.calls",
  neuronsPerDay: "web.flows.settings.neurons",
  attempts: "web.flows.settings.attempts",
  failuresToPause: "web.flows.settings.failures",
};

/**
 * What holds for every flow. Each number has limits that fit the free plan, shown under its field; the
 * scheduled times a day of the flows turned on are counted against their own ceiling.
 */
function FlowSettingsCard({ settings, slots, slotsLimit }: { settings: FlowSettings; slots: number; slotsLimit: number }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const fields = (Object.keys(SETTING_LABEL) as (keyof FlowSettings)[]).map((key) => ({
    key,
    label: t(SETTING_LABEL[key]),
    hint: t("web.flows.settings.range", { min: FLOW_SETTING_RANGES[key].min, max: FLOW_SETTING_RANGES[key].max }),
    min: FLOW_SETTING_RANGES[key].min,
    max: FLOW_SETTING_RANGES[key].max,
  }));
  return (
    <Card title={t("web.flows.settings.title")} description={t("web.flows.settings.body")}>
      <div className="space-y-3">
        <NumbersForm
          fields={fields}
          values={settings}
          saveLabel={t("web.flows.settings.save")}
          savedLabel={t("web.flows.settings.saved")}
          onSave={async (changed) => {
            try {
              await api("/flows/settings", { method: "PATCH", body: changed });
            } finally {
              await qc.invalidateQueries({ queryKey: FLOWS_KEY });
            }
          }}
        />
        <p className="text-xs leading-5 text-fg-muted">{t("web.flows.settings.slots", { slots, max: slotsLimit })}</p>
      </div>
    </Card>
  );
}

/** The flows the chat suggested (step 22b): nothing runs until the owner reviews one and saves it. */
function Drafts({ drafts, full, onReview }: { drafts: FlowDraft[]; full: boolean; onReview: (draft: FlowDraft) => void }) {
  const { t, dateTime } = useI18n();
  const { busy, act } = useFlowAction();
  const titleId = useId();
  if (drafts.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <div className="space-y-1">
        <h2 id={titleId} className="text-base font-semibold">
          {t("web.flows.drafts.title")}
        </h2>
        <p className="text-sm text-fg-muted">{t("web.flows.drafts.body")}</p>
      </div>
      <ul className="zuri-routines">
        {drafts.map((draft) => (
          <li key={draft.id} className="zuri-routine">
            <span className="zuri-routine-tile" aria-hidden>
              <Lightbulb />
            </span>
            <div className="min-w-0 space-y-1">
              <p className="truncate font-semibold">{draft.name}</p>
              <p className="text-sm text-fg-muted">{t("web.flows.drafts.expires", { when: dateTime(draft.expiresAt) })}</p>
            </div>
            <div className="zuri-routine-actions">
              <Button variant="secondary" disabled={full} onClick={() => onReview(draft)}>
                {t("web.flows.drafts.review")}
              </Button>
              <Button variant="ghost" disabled={busy !== null} loading={busy === draft.id} onClick={() => void act(draft.id, async () => {
                await api(`/flows/drafts/${draft.id}`, { method: "DELETE" });
                return t("web.flows.drafts.dropped");
              })}>
                {t("web.flows.drafts.drop")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FlowRow({ flow, full, failuresToPause, glow, onEdit, onDelete }: { flow: Flow; full: boolean; failuresToPause: number; glow: string; onEdit: () => void; onDelete: () => void }) {
  const { t, plural, dateTime, timeZone } = useI18n();
  const { busy, act } = useFlowAction();
  const titleId = useId();
  const tripped = !flow.enabled && flow.failures >= failuresToPause;
  const runText = (run: FlowRun) => {
    const reason = run.problem ? t(PROBLEM_LABEL[run.problem]) : "";
    if (run.status === "waiting" && run.resumeAt) return t("web.flows.ranWaiting", { when: dateTime(run.resumeAt) });
    if (run.status === "skipped") return t("web.flows.ranSkipped", { reason });
    if (run.status === "error") return t("web.flows.ranError", { reason });
    return t("web.flows.ran");
  };
  const toggle = (enabled: boolean) =>
    act("toggle", async () => {
      await api(`/flows/${flow.id}`, { method: "PATCH", body: { enabled } });
      return t(enabled ? "web.flows.turnedOn" : "web.flows.turnedOff");
    });
  // A flow is always born off, so the copy never runs beside the original before the owner looks at it.
  const duplicate = () =>
    act("copy", async () => {
      await api("/flows", { method: "POST", body: { name: copyName(flow.name, (name) => t("web.flows.copyName", { name }), FLOW_LIMITS.name), definition: flow.definition } });
      return t("web.flows.duplicated");
    });
  return (
    <li aria-labelledby={titleId} className={cn("zuri-routine", glow)}>
      <span className="zuri-routine-tile" aria-hidden>
        {flow.sites.length > 0 ? <Radar /> : <Workflow />}
      </span>
      <div className="min-w-0 space-y-1">
        <h2 id={titleId} className="truncate font-semibold">
          {flow.name}
        </h2>
        <p className="text-sm text-fg-muted">
          {describeTrigger(flow, t, timeZone, dateTime)} · {plural("web.flows.steps", flow.definition.nodes.length)}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          <Badge dot tone={flow.enabled ? "accent" : tripped ? "danger" : "neutral"}>
            {t(flow.enabled ? "web.flows.on" : tripped ? "web.flows.pausedByFailures" : "web.flows.off")}
          </Badge>
          {flow.enabled && flow.nextRunAt && <span>{t("web.flows.next", { when: dateTime(flow.nextRunAt) })}</span>}
          {flow.lastRunAt && <span>{t("web.flows.last", { when: dateTime(flow.lastRunAt) })}</span>}
          {flow.failures > 0 && <span className="text-danger">{plural("web.flows.failures", flow.failures)}</span>}
          {flow.usesAi && <Badge>{t("web.flows.usesAi")}</Badge>}
        </p>
        {flow.lastRunStatus === "error" && flow.lastProblem && <p className="text-sm text-fg-muted">{capitalizeFirst(t(PROBLEM_LABEL[flow.lastProblem]))}.</p>}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a row of buttons, not form fields: a fieldset would add a frame and a legend. */}
      <div role="group" aria-label={t("web.flows.actionsFor", { name: flow.name })} className="zuri-routine-actions">
        <Button
          variant="secondary"
          loading={busy === "run"}
          disabled={busy !== null}
          onClick={() =>
            void act("run", async () => {
              const { run } = await api<{ run: FlowRun }>(`/flows/${flow.id}/run`, { method: "POST" });
              return runText(run);
            })
          }
        >
          {busy !== "run" && <Play className="h-4 w-4" aria-hidden />}
          {t("web.flows.runNow")}
        </Button>
        {/* The row keeps its main action in view; on and off, which the prototype's row doesn't show, open the menu. */}
        <ActionsMenu
          name={flow.name}
          busy={busy === "toggle" || busy === "copy"}
          actions={[
            { label: t(flow.enabled ? "web.flows.turnOff" : "web.flows.turnOn"), icon: <Power className="h-4 w-4" />, disabled: busy !== null, onSelect: () => void toggle(!flow.enabled) },
            { label: t("web.flows.edit"), icon: <Pencil className="h-4 w-4" />, onSelect: onEdit },
            { label: t("web.flows.duplicate"), icon: <Copy className="h-4 w-4" />, disabled: busy !== null || full, onSelect: () => void duplicate() },
            { label: t("web.flows.delete"), icon: <Trash2 className="h-4 w-4" />, onSelect: onDelete, danger: true },
          ]}
        />
      </div>
      {flow.sites.length > 0 && <SiteList name={flow.name} sites={flow.sites} />}
    </li>
  );
}

const SITE_DOT = { up: "bg-success", down: "bg-danger", unknown: "bg-border-strong" } as const;

/** How each watched address is: the state in words (never only a color), the last status and how long it took. */
function SiteList({ name, sites }: { name: string; sites: FlowSite[] }) {
  const { t, dateTime } = useI18n();
  return (
    <ul aria-label={t("web.flows.sitesOf", { name })} className="col-span-full grid gap-2 sm:col-start-2 sm:grid-cols-2">
      {sites.map((site) => {
        const details = [
          site.state === "unknown" ? null : site.status === null ? t("web.flows.site.noAnswer") : t("web.flows.site.status", { status: site.status }),
          site.ms !== null && site.state === "up" ? t("web.flows.site.ms", { ms: site.ms }) : null,
          site.since && site.state === "down" ? t("web.flows.site.since", { when: dateTime(site.since) }) : null,
        ].filter(Boolean);
        return (
          <li key={site.url} className="flex min-w-0 items-start gap-2 rounded-xl bg-subtle px-3 py-2 text-sm">
            <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", SITE_DOT[site.state])} aria-hidden />
            <div className="min-w-0">
              <p className="truncate font-medium">{site.host}</p>
              <p className="text-xs text-fg-muted">
                <span className={site.state === "down" ? "font-medium text-danger" : undefined}>{t(SITE_LABEL[site.state])}</span>
                {details.length > 0 && ` · ${details.join(" · ")}`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * CRM › Credenciais (Sinal, S15): the services a flow may call, each kept once
 * with its address and its key. The key never comes back to the screen.
 */
export function CredentialsPart({ data, onEdit }: { data: FlowList; onEdit: (editing: ConnectionEditing) => void }) {
  const { t } = useI18n();
  const [removing, setRemoving] = useState<Removing | null>(null);
  return (
    <>
      {!data.credentialsAvailable && <p className="text-sm leading-6 text-fg-muted">{t("web.flows.connections.noKey")}</p>}
      {data.connections.length === 0 ? (
        <EmptyState icon={<KeyRound className="h-6 w-6" />} title={t("web.flows.connections.emptyTitle")}>
          <p>{t("web.flows.connections.empty")}</p>
        </EmptyState>
      ) : (
        <ul aria-label={t("web.flows.connections.title")} className="zuri-routines">
          {data.connections.map((item) => (
            <ConnectionRow key={item.id} item={item} onEdit={() => onEdit({ mode: "edit", connection: item })} onDelete={() => setRemoving({ kind: "connection", connection: item })} />
          ))}
        </ul>
      )}
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface px-4 text-sm leading-6 shadow-sm sm:px-5">
        {(
          [
            [LockKeyhole, "web.flows.connections.aboutKey"],
            [Earth, "web.flows.connections.aboutAddress"],
            [ShieldCheck, "web.flows.connections.aboutPassword"],
          ] as const
        ).map(([Icon, key]) => (
          <li key={key} className="flex items-start gap-3 py-3">
            <Icon className="mt-1 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <RemoveDialog removing={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

/** What a test found, as one line for the toast. */
function testMessage(test: FlowConnectionTest, { t, plural }: ReturnType<typeof useI18n>): string {
  if (!test.ok) return t("web.flows.test.failed", { problem: t(PROBLEM_LABEL[test.problem]) });
  if (test.inboxes) return plural("web.flows.test.inboxes", test.inboxes.length);
  return t("web.flows.test.answered", { ms: test.ms });
}

function ConnectionRow({ item, onEdit, onDelete }: { item: FlowConnection; onEdit: () => void; onDelete: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const titleId = useId();
  const { act } = useFlowAction();
  const chatwoot = item.chatwoot;
  const key = item.keyEnd ? t("web.flows.connections.keyEnd", { end: item.keyEnd }) : t(item.hasCredential ? "web.flows.connections.hasCredential" : "web.flows.connections.noCredential");
  return (
    <li aria-labelledby={titleId} className="zuri-routine">
      <span className="zuri-routine-tile" aria-hidden>
        <Cable />
      </span>
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 id={titleId} className="min-w-0 truncate font-semibold">
            {item.name}
          </h2>
          <Badge tone="neutral">{t(item.kind === "chatwoot" ? "web.flows.kind.chatwootTag" : "web.flows.kind.httpTag")}</Badge>
        </div>
        <p className="break-all text-sm text-fg-muted">
          {chatwoot
            ? `${item.origin} · ${t("web.flows.chatwoot.summary", {
                account: chatwoot.accountId,
                inbox: chatwoot.inboxName ?? t("web.flows.chatwoot.noInbox"),
                bulkMin: chatwoot.bulkGap.min,
                bulkMax: chatwoot.bulkGap.max,
                oneMin: chatwoot.oneGap.min,
                oneMax: chatwoot.oneGap.max,
              })}`
            : `${item.origin} · ${item.methods.join(", ")} · ${item.paths.join(", ")}`}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          <Badge dot tone={item.hasCredential ? "accent" : "neutral"}>
            {key}
          </Badge>
          <span className="min-w-0 break-words">{item.usedBy.length > 0 ? t("web.flows.connections.usedBy", { names: item.usedBy.join(", ") }) : t("web.flows.connections.unused")}</span>
        </p>
      </div>
      <div className="zuri-routine-actions">
        <ActionsMenu
          name={item.name}
          actions={[
            {
              label: t("web.flows.test.action"),
              icon: <Radar className="h-4 w-4" />,
              onSelect: () =>
                void act(`test-${item.id}`, async () => {
                  const { test } = await api<{ test: FlowConnectionTest }>(`/flows/connections/${item.id}/test`, { method: "POST" });
                  return testMessage(test, i18n);
                }),
            },
            { label: t("web.flows.edit"), icon: <Pencil className="h-4 w-4" />, onSelect: onEdit },
            { label: t("web.flows.delete"), icon: <Trash2 className="h-4 w-4" />, onSelect: onDelete, danger: true },
          ]}
        />
      </div>
    </li>
  );
}

/** Deleting a flow or a connection: one confirmation, then gone. */
function RemoveDialog({ removing, onClose }: { removing: Removing | null; onClose: () => void }) {
  const { t } = useI18n();
  const { busy, act } = useFlowAction();
  const flow = removing?.kind === "flow";
  const name = removing ? (removing.kind === "flow" ? removing.flow.name : removing.connection.name) : "";
  return (
    <Dialog open={removing !== null} onClose={onClose} title={removing ? t(flow ? "web.flows.deleteTitle" : "web.flows.connections.deleteTitle", { name }) : ""}>
      <p className="text-sm leading-6 text-fg-muted">{t(flow ? "web.flows.deleteBody" : "web.flows.connections.deleteBody")}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("web.flows.cancel")}
        </Button>
        <Button
          variant="danger"
          loading={busy !== null}
          onClick={() =>
            removing &&
            void act("delete", async () => {
              // Closed either way: a refusal (a connection still in use) is told by the toast, with the reason.
              try {
                await api(removing.kind === "flow" ? `/flows/${removing.flow.id}` : `/flows/connections/${removing.connection.id}`, { method: "DELETE" });
              } finally {
                onClose();
              }
              return t(removing.kind === "flow" ? "web.flows.deleted" : "web.flows.connections.deleted");
            })
          }
        >
          {t("web.flows.delete")}
        </Button>
      </div>
    </Dialog>
  );
}

const RUN_TONE = { running: "accent", waiting: "accent", success: "success", skipped: "warning", error: "danger" } as const;

/** What each run did, newest first: when, which flow, how it ended and, below, why it stopped. */
function RunHistory() {
  const { t, dateTime } = useI18n();
  const runs = useFlowRuns();
  const items = runs.data?.pages.flatMap((page) => page.runs) ?? [];
  const flash = useFlash(runs.data ? items : undefined, (run) => run.id, (run) => `${run.status}|${run.finishedAt ?? ""}`, String(runs.data?.pages.length ?? 0));
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="text-base font-semibold">
        {t("web.flows.history.title")}
      </h2>
      {runs.isPending ? (
        <Loading />
      ) : runs.isError ? (
        <ErrorNotice error={runs.error} onRetry={() => void runs.refetch()} />
      ) : items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-sm text-fg-muted">
          <History className="h-5 w-5 shrink-0" aria-hidden />
          <p>{t("web.flows.history.empty")}</p>
        </div>
      ) : (
        <>
          <ol className="zuri-routine-runs">
            {items.map((run) => {
              const why = [
                run.problem && run.node !== null ? t("web.flows.history.step", { node: run.node }) : null,
                run.problem ? capitalizeFirst(t(PROBLEM_LABEL[run.problem])) : null,
                run.problem && run.httpStatus !== null ? t("web.flows.history.http", { status: run.httpStatus }) : null,
                run.status === "waiting" && run.resumeAt ? t("web.flows.history.resume", { when: dateTime(run.resumeAt) }) : null,
              ].filter(Boolean);
              return (
                <li key={run.id} className={flashClass(flash.glowing, run.id)}>
                  <time dateTime={run.startedAt}>{dateTime(run.startedAt)}</time>
                  <p className="min-w-0 break-words">
                    <span className="font-medium">{run.flowName}</span> · {t(RUN_TRIGGER_LABEL[run.trigger])} · {t("web.flows.history.calls", { calls: run.calls, items: run.items })}
                  </p>
                  <Badge tone={RUN_TONE[run.status]}>{t(RUN_STATUS_LABEL[run.status])}</Badge>
                  {why.length > 0 && (
                    <div>
                      <p className="leading-6 text-fg-muted">{why.join(" · ")}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {runs.hasNextPage && (
            <p className="flex justify-center">
              <Button variant="ghost" loading={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>
                {t("web.flows.history.more")}
              </Button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
