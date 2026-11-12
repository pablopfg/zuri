import { useQueryClient } from "@tanstack/react-query";
import { AUTOMATION_LIMITS, type Automation, type AutomationList, type AutomationRun, ptBRAutomations, ptBRSchedule } from "@zuri/shared";
import { AlarmClock, Check, Copy, History, Pencil, Play, Plus, Trash2, WandSparkles } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useToast } from "../../components/Toaster.tsx";
import { Button, cn, Dialog, EmptyState, ErrorNotice, Loading, PageHeader } from "../../components/ui.tsx";
import { AUTOMATIONS_KEY, useAutomationRuns, useAutomations } from "../../hooks/automations.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { automationAnchor, copyName, describeSchedule } from "../../lib/automations.ts";
import { ActionsMenu } from "../../components/ActionsMenu.tsx";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { FlashStatus, flashClass, useFlash } from "../../lib/lists.tsx";
import { KIND_LABEL, PROBLEM_LABEL, RUN_STATUS_LABEL, STATUS_LABEL, TRIGGER_LABEL } from "./labels.ts";
import { Badge, Toggle } from "./parts.tsx";
import { type Editing, KIND_ICON, RoutineWizard } from "./RoutineWizard.tsx";

// This screen's pt-BR texts travel with its code, not in the first bundle (rule P11).
addMessages(ptBRAutomations);
addMessages(ptBRSchedule);

/** The palette's "Criar rotina": an address and an event of that name (CommandPalette.tsx). */
const NEW_AUTOMATION = "nova-automacao";

/**
 * Rotinas (step 10; its own address since the Sinal shell): reminders, the task
 * digest and Zuri's routines, all in the owner's time zone. Routines Zuri
 * proposed in the chat wait at the top for approval; the history shows what
 * each run delivered. The flows moved to /crm/fluxos.
 */
export function AutomationsPage() {
  const { t } = useI18n();
  const list = useAutomations();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<Automation | null>(null);
  // "Criar rotina" in the command palette opens the steps here: by the address on arrival, by an event
  // when the page is already open. No router in this screen (armadilhas.md, "Pacote da interface").
  useEffect(() => {
    const open = () => setEditing({ mode: "new" });
    if (window.location.hash === `#${NEW_AUTOMATION}`) {
      // Once: a reload or the back button doesn't open it again.
      history.replaceState(history.state, "", window.location.pathname);
      open();
    }
    window.addEventListener(NEW_AUTOMATION, open);
    return () => window.removeEventListener(NEW_AUTOMATION, open);
  }, []);

  // A link from the chat points at one automation: bring it into view once the list is here.
  const loaded = list.data !== undefined;
  useEffect(() => {
    // Only the anchors this page makes; anything else in the address is ignored.
    const hash = /^#(automacao-[0-9a-f-]{36})$/.exec(window.location.hash)?.[1];
    if (!loaded || !hash) return;
    document.getElementById(hash)?.scrollIntoView({ block: "center" });
  }, [loaded]);

  const all = list.data?.automations ?? [];
  const pending = all.filter((a) => a.status === "pending_approval");
  const others = all.filter((a) => a.status !== "pending_approval");
  const counts = list.data?.counts;
  const flash = useFlash(list.data?.automations, (automation) => automation.id, (automation) => `${automation.updatedAt}|${automation.status}|${automation.lastRunAt ?? ""}`);

  return (
    <>
      <PageHeader
        title={t("web.automations.title")}
        description={counts ? `${t("web.automations.description")} ${t("web.automations.activeCount", { active: counts.active, max: AUTOMATION_LIMITS.active })}` : t("web.automations.description")}
        actions={
          <Button onClick={() => setEditing({ mode: "new" })} disabled={!loaded}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("web.automations.new")}
          </Button>
        }
      />
      {list.isPending ? (
        <Loading label={t("web.automations.loading")} />
      ) : list.isError ? (
        <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <>
          {pending.length > 0 && <PendingCard routines={pending} onDecline={setRemoving} />}
          {others.length === 0 ? (
            pending.length === 0 && (
              <EmptyState icon={<AlarmClock className="h-6 w-6" />} title={t("web.automations.empty.title")}>
                <p>{t("web.automations.empty.body")}</p>
              </EmptyState>
            )
          ) : (
            <ul aria-label={t("web.automations.listLabel")} className="zuri-routines">
              {others.map((automation) => (
                <AutomationRow
                  key={automation.id}
                  automation={automation}
                  glow={flashClass(flash.glowing, automation.id)}
                  onEdit={() => setEditing({ mode: "edit", automation })}
                  onDelete={() => setRemoving(automation)}
                />
              ))}
            </ul>
          )}
          <FlashStatus count={flash.remote} />
          <RunHistory />
        </>
      )}
      {editing && <RoutineWizard editing={editing} active={counts?.active ?? null} onClose={() => setEditing(null)} />}
      <RemoveDialog automation={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

const STATUS_TONE = { active: "accent", paused: "neutral", pending_approval: "warning", completed: "neutral" } as const;

/** The owner's action on one automation, with the list and history refreshed after. */
function useAutomationAction() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
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
      await qc.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
    }
  }
  const runText = (run: AutomationRun) => {
    const reason = run.problem ? t(PROBLEM_LABEL[run.problem]) : "";
    if (run.status === "quiet") return t("web.automations.ranQuiet");
    if (run.status === "skipped") return t("web.automations.ranSkipped", { reason });
    if (run.status === "error") return t("web.automations.ranError", { reason });
    return t("web.automations.ran");
  };
  return { busy, act, runText };
}

function AutomationRow({ automation, glow, onEdit, onDelete }: { automation: Automation; glow: string; onEdit: () => void; onDelete: () => void }) {
  const { t, dateTime, timeZone } = useI18n();
  const { busy, act, runText } = useAutomationAction();
  const Icon = KIND_ICON[automation.kind];
  const titleId = useId();
  const paused = automation.status === "paused" || automation.status === "completed";
  const qc = useQueryClient();
  const setPaused = (value: boolean) =>
    act("pause", async () => {
      // Paused or running again at once; a refusal puts the list back as it was (act refreshes it after).
      const key = [...AUTOMATIONS_KEY, "list"];
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<AutomationList>(key);
      qc.setQueryData<AutomationList>(key, (list) =>
        list ? { ...list, automations: list.automations.map((item) => (item.id === automation.id ? { ...item, status: value ? "paused" : "active" } : item)) } : list,
      );
      try {
        await api(`/automations/${automation.id}`, { method: "PATCH", body: { paused: value } });
      } catch (error) {
        qc.setQueryData(key, before);
        throw error;
      }
      return t(value ? "web.automations.paused" : "web.automations.resumed");
    });
  const duplicate = () =>
    act("copy", async () => {
      // The server has no "create paused": the copy is made and paused right after, before its first hour comes.
      const { automation: copy } = await api<{ automation: Automation }>("/automations", {
        method: "POST",
        body: {
          kind: automation.kind,
          name: copyName(automation.name, (name) => t("web.automations.copyName", { name })),
          message: automation.message,
          schedule: automation.schedule,
          priority: automation.priority,
          ...(automation.kind === "agent_prompt" ? { sentinel: automation.sentinel } : {}),
        },
      });
      await api(`/automations/${copy.id}`, { method: "PATCH", body: { paused: true } });
      return t("web.automations.duplicated");
    });
  return (
    <li id={automationAnchor(automation.id)} aria-labelledby={titleId} className={cn("zuri-routine", glow)}>
      <span className="zuri-routine-tile" aria-hidden>
        <Icon />
      </span>
      <div className="min-w-0 space-y-1">
        <h2 id={titleId} className="truncate font-semibold">
          {automation.name}
        </h2>
        <p className="text-sm text-fg-muted">
          {t(KIND_LABEL[automation.kind])} · {describeSchedule(automation.schedule, t, timeZone, dateTime)}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          <Badge dot tone={STATUS_TONE[automation.status]}>
            {t(STATUS_LABEL[automation.status])}
          </Badge>
          {automation.nextRunAt && <span>{t("web.automations.next", { when: dateTime(automation.nextRunAt) })}</span>}
          {automation.lastRunAt && <span>{t("web.automations.last", { when: dateTime(automation.lastRunAt) })}</span>}
          {automation.kind === "agent_prompt" && <Badge>{t("web.automations.usesAi")}</Badge>}
          {automation.kind === "agent_prompt" && automation.sentinel && <Badge>{t("web.automations.quiet")}</Badge>}
          {automation.origin === "chat" && <Badge>{t("web.automations.fromChat")}</Badge>}
        </p>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a row of buttons, not form fields: a fieldset would add a frame and a legend. */}
      <div role="group" aria-label={t("web.automations.actionsFor", { name: automation.name })} className="zuri-routine-actions">
        <Button
          variant="secondary"
          loading={busy === "run"}
          disabled={busy !== null}
          onClick={() =>
            void act("run", async () => {
              const { run } = await api<{ run: AutomationRun }>(`/automations/${automation.id}/run`, { method: "POST" });
              return runText(run);
            })
          }
        >
          {busy !== "run" && <Play className="h-4 w-4" aria-hidden />}
          {t("web.automations.runNow")}
        </Button>
        <Toggle bare label={t("web.automations.activeSwitch", { name: automation.name })} checked={!paused} busy={busy !== null} onChange={(on) => void setPaused(!on)} />
        <ActionsMenu
          name={automation.name}
          busy={busy === "copy"}
          actions={[
            { label: t("web.automations.edit"), icon: <Pencil className="h-4 w-4" />, onSelect: onEdit },
            { label: t("web.automations.duplicate"), icon: <Copy className="h-4 w-4" />, disabled: busy !== null, onSelect: () => void duplicate() },
            { label: t("web.automations.delete"), icon: <Trash2 className="h-4 w-4" />, onSelect: onDelete, danger: true },
          ]}
        />
      </div>
    </li>
  );
}

/** Routines Zuri proposed in the chat: the owner reads exactly what will run, then approves or declines. */
function PendingCard({ routines, onDecline }: { routines: Automation[]; onDecline: (routine: Automation) => void }) {
  const { t, plural, dateTime, timeZone } = useI18n();
  const { busy, act } = useAutomationAction();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="zuri-routine-pending">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="flex items-center gap-2 font-semibold">
          <WandSparkles className="h-4 w-4 shrink-0" aria-hidden />
          {plural("web.automations.pending.title", routines.length)}
        </h2>
        <Badge dot tone="warning">
          {t("web.automations.status.pending_approval")}
        </Badge>
      </div>
      <p className="text-sm text-fg-muted">{t("web.automations.pending.description")}</p>
      <ul className="divide-y divide-border">
        {routines.map((routine) => (
          <li key={routine.id} id={automationAnchor(routine.id)} className="scroll-mt-24 space-y-2 py-3 last:pb-0">
            <h3 className="font-semibold">
              {routine.name} · <span className="font-medium">{describeSchedule(routine.schedule, t, timeZone, dateTime)}</span>
            </h3>
            <div className="space-y-1">
              <p className="text-sm text-fg-muted">{t("web.automations.pending.instruction")}</p>
              <blockquote className="whitespace-pre-line break-words rounded-lg border-l-4 border-border-strong bg-raised px-3 py-2 text-sm leading-6">{routine.message}</blockquote>
            </div>
            <p className="flex flex-wrap gap-2">
              <Badge>{t("web.automations.usesAi")}</Badge>
              {routine.sentinel && <Badge>{t("web.automations.quiet")}</Badge>}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                loading={busy === routine.id}
                onClick={() =>
                  void act(routine.id, async () => {
                    await api(`/automations/${routine.id}/approve`, { method: "POST", body: { updatedAt: routine.updatedAt } });
                    return t("web.automations.pending.approved");
                  })
                }
              >
                {busy !== routine.id && <Check className="h-4 w-4" aria-hidden />}
                {t("web.automations.pending.approve")}
              </Button>
              <Button variant="ghost" onClick={() => onDecline(routine)}>
                {t("web.automations.pending.decline")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Deleting an automation, or declining a proposed routine: one confirmation, then gone. */
function RemoveDialog({ automation, onClose }: { automation: Automation | null; onClose: () => void }) {
  const { t } = useI18n();
  const { busy, act } = useAutomationAction();
  const proposal = automation?.status === "pending_approval";
  return (
    <Dialog
      open={automation !== null}
      onClose={onClose}
      title={automation ? t(proposal ? "web.automations.pending.declineTitle" : "web.automations.deleteTitle", { name: automation.name }) : ""}
    >
      <p className="text-sm leading-6 text-fg-muted">{t(proposal ? "web.automations.pending.declineBody" : "web.automations.deleteBody")}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("web.automations.form.cancel")}
        </Button>
        <Button
          variant="danger"
          loading={busy !== null}
          onClick={() =>
            automation &&
            void act("delete", async () => {
              await api(`/automations/${automation.id}`, { method: "DELETE" });
              onClose();
              return t(proposal ? "web.automations.pending.declined" : "web.automations.deleted");
            })
          }
        >
          {proposal ? t("web.automations.pending.decline") : t("web.automations.delete")}
        </Button>
      </div>
    </Dialog>
  );
}

/** What each run delivered, newest first. Until the notice center (step 11), this is where results land. */
function RunHistory() {
  const { t, dateTime } = useI18n();
  const runs = useAutomationRuns();
  const items = runs.data?.pages.flatMap((page) => page.runs) ?? [];
  // "Carregar mais" is the owner asking for older runs: a new page starts a new base, so it never glows whole.
  const flash = useFlash(runs.data ? items : undefined, (run) => run.id, (run) => `${run.status}|${run.finishedAt ?? ""}`, String(runs.data?.pages.length ?? 0));
  const tone = { running: "accent", success: "success", quiet: "neutral", skipped: "warning", error: "danger" } as const;
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="text-base font-semibold">
        {t("web.automations.history.title")}
      </h2>
      {runs.isPending ? (
        <Loading />
      ) : runs.isError ? (
        <ErrorNotice error={runs.error} onRetry={() => void runs.refetch()} />
      ) : items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-sm text-fg-muted">
          <History className="h-5 w-5 shrink-0" aria-hidden />
          <p>{t("web.automations.history.empty")}</p>
        </div>
      ) : (
        <>
          <ol className="zuri-routine-runs">
            {items.map((run) => (
              <li key={run.id} className={flashClass(flash.glowing, run.id)}>
                <time dateTime={run.startedAt}>{dateTime(run.startedAt)}</time>
                <p className="min-w-0 break-words">
                  <span className="font-medium">{run.automationName}</span> · {t(TRIGGER_LABEL[run.trigger])}
                </p>
                <Badge tone={tone[run.status]}>{t(RUN_STATUS_LABEL[run.status])}</Badge>
                {(run.result || run.problem) && (
                  <div>
                    {run.result && <p className="whitespace-pre-line break-words leading-6">{run.result}</p>}
                    {run.problem && <p className="leading-6 text-fg-muted">{capitalizeFirst(t(PROBLEM_LABEL[run.problem]))}</p>}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {runs.hasNextPage && (
            <Button variant="secondary" loading={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>
              {t("web.automations.history.more")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

const capitalizeFirst = (text: string) => (text ? (text[0] as string).toLocaleUpperCase() + text.slice(1) : text);
