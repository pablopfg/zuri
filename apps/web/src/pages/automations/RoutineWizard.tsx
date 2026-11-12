import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AUTOMATION_KINDS,
  AUTOMATION_LIMITS,
  AUTOMATION_PRIORITIES,
  type Automation,
  type AutomationKind,
  type AutomationPriority,
  MCP_LIMITS,
  type McpRoutineTool,
  type MessageKey,
  SCHEDULE_TYPES,
  type Settings,
  upcomingRuns,
} from "@zuri/shared";
import { Bell, CalendarClock, Check, ChevronLeft, ChevronRight, ListChecks, WandSparkles, Workflow, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../../components/Toaster.tsx";
import { Button, buttonClass, cn, ErrorNotice, TextAreaField, TextField } from "../../components/ui.tsx";
import { AUTOMATIONS_KEY } from "../../hooks/automations.ts";
import { SETTINGS_KEY } from "../../hooks/session.tsx";
import { api } from "../../lib/api.ts";
import { describeSchedule, draftOf, emptyDraft, type ScheduleDraft, scheduleOf, stepReady, suggestName, type WizardStep, wizardSteps, zoneLabel } from "../../lib/automations.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { DAY_SHORT, FREQUENCY_LABEL, KIND_HINT, KIND_LABEL, MESSAGE_LABEL, NAME_PLACEHOLDER, PRIORITY_HINT, PRIORITY_LABEL } from "./labels.ts";
import { Toggle } from "./parts.tsx";

export const KIND_ICON: Record<AutomationKind, typeof Bell> = { reminder: Bell, task_digest: ListChecks, agent_prompt: WandSparkles };

/** Monday first, as the week reads in a calendar. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

/** Where "Fluxo" leads: the flows' own editor, opened on a new flow (FlowsPanel.tsx). */
const NEW_FLOW_HREF = "/crm/fluxos#novo-fluxo";

export type Editing = { mode: "new" } | { mode: "edit"; automation: Automation };

const STEP_NAME: Record<WizardStep, MessageKey> = {
  kind: "web.automations.wizard.step.kind",
  when: "web.automations.wizard.step.when",
  what: "web.automations.wizard.step.what",
  notify: "web.automations.wizard.step.notify",
  review: "web.automations.wizard.step.review",
};

const WHAT_QUESTION: Record<AutomationKind, MessageKey> = {
  reminder: "web.automations.wizard.what.reminder",
  task_digest: "web.automations.wizard.what.task_digest",
  agent_prompt: "web.automations.wizard.what.agent_prompt",
};

/**
 * Ready-made AI routines (step 19): the morning briefing every day at 07:00 and
 * the end of the day on weekdays at 19:00, in the owner's zone. They fill the
 * text and the name; the owner may change anything before saving.
 */
const ROUTINE_TEMPLATES = [
  {
    id: "briefing",
    name: "web.automations.template.briefing.name",
    message: "web.automations.template.briefing.message",
    schedule: { type: "daily", time: "07:00" },
  },
  {
    id: "closing",
    name: "web.automations.template.closing.name",
    message: "web.automations.template.closing.message",
    schedule: { type: "weekly", time: "19:00", days: [1, 2, 3, 4, 5] },
  },
  // Step 22b: the CRM's funnel, read on Monday mornings (routines only read the CRM).
  {
    id: "funnel",
    name: "web.automations.template.funnel.name",
    message: "web.automations.template.funnel.message",
    schedule: { type: "weekly", time: "08:00", days: [1] },
  },
] as const satisfies readonly { id: string; name: MessageKey; message: MessageKey; schedule: Partial<ScheduleDraft> }[];

/**
 * "Criar rotina" (Sinal, S14): one question per step. Tipo, Quando, O que,
 * Avisos and Revisar; editing starts at Quando, since the kind of a routine
 * never changes. Nothing is sent before the last step, and the server checks
 * everything again.
 */
export function RoutineWizard({ editing, active, onClose }: { editing: Editing; active: number | null; onClose: () => void }) {
  const { t, dateTime, timeZone, locale } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Read through the query cache, not hooks/settings.ts: a hook shared by two lazy screens splits the first download (armadilhas.md).
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api<Settings>("/settings"), staleTime: 5 * 60_000 });
  const current = editing.mode === "edit" ? editing.automation : null;
  const steps = wizardSteps(current !== null);
  const [index, setIndex] = useState(0);
  const step = steps[index] as WizardStep;
  const last = index === steps.length - 1;
  const [kind, setKind] = useState<AutomationKind | "flow">(current?.kind ?? "reminder");
  const [name, setName] = useState(current?.name ?? "");
  const [message, setMessage] = useState(current?.message ?? "");
  const [sentinel, setSentinel] = useState(current?.sentinel ?? false);
  const [priority, setPriority] = useState<AutomationPriority>(current?.priority ?? "normal");
  const [draft, setDraft] = useState<ScheduleDraft>(() => (current ? draftOf(current.schedule, timeZone, new Date()) : emptyDraft(timeZone, new Date())));
  // A template brings its own hours only while the owner hasn't chosen any at "Quando".
  const [whenTouched, setWhenTouched] = useState(current !== null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const schedule = scheduleOf(draft);
  const preview = useMemo(() => (schedule ? upcomingRuns(schedule, timeZone, new Date(), 3) : []), [schedule, timeZone]);
  const ready = stepReady(step, { kind, name, message, schedule });
  const set = (patch: Partial<ScheduleDraft>) => {
    setWhenTouched(true);
    setDraft((d) => ({ ...d, ...patch }));
  };
  // The external tools this routine may use on its own (decision of 03/11/2026): only an AI routine that exists.
  const toolsKey = ["automation-mcp-tools", current?.id] as const;
  const routineTools = useQuery({
    queryKey: toolsKey,
    queryFn: () => api<{ tools: McpRoutineTool[] }>(`/mcp/routines/${current?.id}/tools`),
    enabled: current?.kind === "agent_prompt",
    staleTime: 30_000,
  });
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const freed = allowed ?? routineTools.data?.tools.filter((tool) => tool.allowed).map((tool) => tool.id) ?? [];

  useLayoutEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  // Each step starts at its first answer: the chosen option, or the field to fill.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step is the trigger; the effect reads only the DOM.
  useEffect(() => {
    const first = body.current?.querySelector<HTMLElement>("[data-first]") ?? body.current?.querySelector<HTMLElement>("input:checked") ?? body.current?.querySelector<HTMLElement>("input, textarea");
    first?.focus();
  }, [step]);

  const close = () => {
    // Closing the modal first sends the focus back to what opened it.
    dialog.current?.close();
    onClose();
  };

  function go(to: number) {
    const target = steps[to];
    // Arriving at the last step with no name yet: start from what the routine says.
    if (target === "review" && name.trim() === "" && kind !== "flow") setName(suggestName(kind, message, t(KIND_LABEL.task_digest)));
    setError(null);
    setIndex(to);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || saving || kind === "flow") return;
    // Enter in a field goes on to the next step; only the last one sends.
    if (!last) return go(index + 1);
    setSaving(true);
    setError(null);
    try {
      const fields = { name: name.trim(), message: message.trim(), schedule, priority, ...(kind === "agent_prompt" ? { sentinel } : {}) };
      if (current) {
        // A finished one-time reminder given a new moment starts again.
        await api(`/automations/${current.id}`, { method: "PATCH", body: { ...fields, ...(current.status === "completed" ? { paused: false } : {}) } });
        // Another instruction lets go of the tools set free (on the server): only a list the owner touched is sent again.
        if (routineTools.data && allowed !== null) {
          const result = await api<{ tools: McpRoutineTool[] }>(`/mcp/routines/${current.id}/tools`, { method: "PATCH", body: { tools: freed } });
          qc.setQueryData(toolsKey, result);
        } else if (message.trim() !== current.message) void qc.invalidateQueries({ queryKey: toolsKey });
      } else {
        await api("/automations", { method: "POST", body: { kind, ...fields } });
      }
      await qc.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
      toast(t(current ? "web.automations.saved" : "web.automations.created"));
      close();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const question = (text: string) => <h3 className="text-lg font-semibold">{text}</h3>;

  function stepBody(): ReactNode {
    switch (step) {
      case "kind":
        return (
          <Choices legend={t("web.automations.wizard.kind.question")} columns>
            {AUTOMATION_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return <Choice key={k} name="kind" checked={kind === k} onChange={() => setKind(k)} icon={<Icon />} title={t(KIND_LABEL[k])} hint={t(KIND_HINT[k])} />;
            })}
            <Choice name="kind" checked={kind === "flow"} onChange={() => setKind("flow")} icon={<Workflow />} title={t("web.automations.wizard.flow.name")} hint={t("web.automations.wizard.flow.hint")} />
          </Choices>
        );
      case "when":
        return (
          <>
            {question(t("web.automations.wizard.when.question"))}
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t("web.automations.form.frequency")}</legend>
              <div className="zuri-wizard-seg">
                {SCHEDULE_TYPES.map((type) => (
                  <label key={type}>
                    <input type="radio" name="frequency" checked={draft.type === type} onChange={() => set({ type })} />
                    <span>{t(FREQUENCY_LABEL[type])}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {draft.type === "weekly" && <DayPicker days={draft.days} onChange={(days) => set({ days })} />}
            <div className="grid gap-4 sm:grid-cols-2">
              {draft.type === "once" && <TextField label={t("web.automations.form.date")} type="date" value={draft.date} required onChange={(e) => set({ date: e.target.value })} />}
              {draft.type === "monthly" && (
                <TextField
                  label={t("web.automations.form.dayOfMonth")}
                  hint={t("web.automations.form.dayOfMonthHint")}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={31}
                  value={draft.day}
                  required
                  onChange={(e) => set({ day: e.target.value })}
                />
              )}
              {draft.type === "interval" ? (
                <TextField
                  label={t("web.automations.form.hours")}
                  hint={t("web.automations.form.hoursHint")}
                  type="number"
                  inputMode="numeric"
                  min={AUTOMATION_LIMITS.minIntervalMinutes / 60}
                  max={Math.floor(AUTOMATION_LIMITS.maxIntervalMinutes / 60)}
                  value={draft.hours}
                  required
                  onChange={(e) => set({ hours: e.target.value })}
                />
              ) : (
                <TextField label={t("web.automations.form.time")} type="time" value={draft.time} required onChange={(e) => set({ time: e.target.value })} />
              )}
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{t("web.automations.wizard.zone")}</p>
                <p className="flex min-h-11 items-center rounded-xl bg-raised px-3 text-[15px] text-fg-muted">{zoneLabel(timeZone, new Date(), locale)}</p>
              </div>
            </div>
            {schedule && (
              <div className="zuri-wizard-note" aria-live="polite">
                <CalendarClock aria-hidden />
                <div>
                  <p className="font-medium text-fg">{t("web.automations.form.preview")}</p>
                  {preview.length === 0 ? (
                    <p>{t("web.automations.form.previewNone")}</p>
                  ) : (
                    <ul>
                      {preview.map((at) => (
                        <li key={at.toISOString()}>{dateTime(at)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </>
        );
      case "what": {
        // The first step never lets a flow through; this keeps the types honest.
        const routine = kind === "flow" ? "reminder" : kind;
        return (
          <>
            {question(t(WHAT_QUESTION[routine]))}
            {routine === "task_digest" && <p className="text-sm text-fg-muted">{t("web.automations.wizard.digestHint")}</p>}
            {routine === "agent_prompt" && !current && (
              // biome-ignore lint/a11y/useSemanticElements: a row of buttons, not form fields: a fieldset would add a frame and a legend.
              <div role="group" aria-labelledby={`${titleId}-templates`} className="space-y-1.5">
                <p id={`${titleId}-templates`} className="text-sm font-medium">
                  {t("web.automations.template.label")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {ROUTINE_TEMPLATES.map((template) => {
                    const on = message === t(template.message);
                    return (
                      <button
                        key={template.id}
                        type="button"
                        aria-pressed={on}
                        className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors", on ? "border-accent bg-accent-soft text-accent-text" : "border-border-strong bg-surface hover:bg-raised")}
                        onClick={() => {
                          setName(t(template.name));
                          setMessage(t(template.message));
                          if (!whenTouched) setDraft((d) => ({ ...d, ...template.schedule }));
                        }}
                      >
                        {t(template.name)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <TextAreaField
              data-first
              label={t(MESSAGE_LABEL[routine])}
              placeholder={routine === "agent_prompt" ? t("web.automations.form.messagePlaceholder.agent_prompt") : undefined}
              {...(routine === "reminder" ? { hint: t("web.automations.wizard.reminderHint") } : {})}
              value={message}
              maxLength={AUTOMATION_LIMITS.message}
              required={routine !== "task_digest"}
              onChange={(e) => setMessage(e.target.value)}
            />
            {routine === "agent_prompt" && (
              <>
                {routineTools.data && routineTools.data.tools.length > 0 && <RoutineTools tools={routineTools.data.tools} freed={freed} onChange={setAllowed} />}
                <p className="zuri-wizard-note">
                  <WandSparkles aria-hidden />
                  <span>{t("web.automations.form.aiNote", { count: settings.data?.aiScheduledRunsPerDay ?? 0 })}</span>
                </p>
                <Toggle label={t("web.automations.form.quiet")} hint={t("web.automations.form.quietHint")} checked={sentinel} onChange={setSentinel} />
              </>
            )}
          </>
        );
      }
      case "notify":
        return (
          <Choices legend={t("web.automations.form.priority")}>
            {AUTOMATION_PRIORITIES.map((p) => (
              <Choice key={p} name="priority" checked={priority === p} onChange={() => setPriority(p)} title={t(PRIORITY_LABEL[p])} hint={t(PRIORITY_HINT[p])} />
            ))}
          </Choices>
        );
      case "review": {
        const routine = kind === "flow" ? "reminder" : kind;
        const when = schedule ? describeSchedule(schedule, t, timeZone, dateTime) : "";
        const rows: [string, ReactNode][] = [
          [t("web.automations.wizard.step.kind"), t(KIND_LABEL[routine])],
          [t("web.automations.wizard.step.when"), preview[0] ? t("web.automations.wizard.review.when", { schedule: when, next: dateTime(preview[0]) }) : when],
          [
            t("web.automations.wizard.step.what"),
            <>
              {routine === "task_digest" && <span className="block">{t("web.automations.wizard.review.digest")}</span>}
              {message.trim() && <span className="line-clamp-4 block whitespace-pre-line break-words">{message.trim()}</span>}
              {routine === "agent_prompt" && sentinel && <span className="block text-fg-muted">{t("web.automations.quiet")}</span>}
            </>,
          ],
          [t("web.automations.wizard.review.priority"), t(PRIORITY_LABEL[priority])],
          [t("web.automations.wizard.review.cost"), t(routine === "agent_prompt" ? "web.automations.wizard.review.costAi" : "web.automations.wizard.review.costNone")],
        ];
        return (
          <>
            {question(t("web.automations.wizard.review.question"))}
            <TextField data-first label={t("web.automations.form.name")} placeholder={t(NAME_PLACEHOLDER[routine])} value={name} maxLength={AUTOMATION_LIMITS.name} required onChange={(e) => setName(e.target.value)} />
            <dl className="zuri-wizard-summary">
              {rows.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {!current && <p className="text-sm text-fg-muted">{active === null ? t("web.automations.wizard.review.hint") : `${t("web.automations.wizard.review.hint")} ${t("web.automations.wizard.review.active", { active, max: AUTOMATION_LIMITS.active })}`}</p>}
            {error !== null && <ErrorNotice error={error} />}
          </>
        );
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="zuri-wizard"
    >
      <form onSubmit={submit} noValidate>
        <header>
          <div className="min-w-0">
            <p className="text-sm text-fg-muted" aria-live="polite">
              {t("web.automations.wizard.progress", { step: index + 1, total: steps.length, name: t(STEP_NAME[step]) })}
            </p>
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">
              {t(current ? "web.automations.form.editTitle" : "web.automations.form.newTitle")}
            </h2>
          </div>
          <button type="button" onClick={close} aria-label={t("web.close")} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg-muted hover:bg-raised hover:text-fg">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>
        <ol aria-hidden className="zuri-wizard-bar">
          {steps.map((s, k) => (
            <li key={s} data-state={k < index ? "done" : k === index ? "on" : undefined} />
          ))}
        </ol>
        <div ref={body} className="zuri-wizard-body">
          {stepBody()}
        </div>
        <footer>
          <Button variant="ghost" onClick={close} className="max-sm:hidden">
            {t("web.automations.form.cancel")}
          </Button>
          <span className="flex-1" />
          {index > 0 && (
            <Button variant="secondary" onClick={() => go(index - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {t("web.automations.wizard.back")}
            </Button>
          )}
          {kind === "flow" ? (
            // A plain link: the flows' editor is another screen, and nothing was typed here yet.
            <a href={NEW_FLOW_HREF} className={buttonClass("primary")}>
              {t("web.automations.wizard.flow.open")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </a>
          ) : last ? (
            <Button type="submit" loading={saving} disabled={!ready}>
              <Check className="h-4 w-4" aria-hidden />
              {t(current ? "web.automations.form.save" : "web.automations.form.create")}
            </Button>
          ) : (
            <Button type="submit" disabled={!ready}>
              {t("web.automations.wizard.next")}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </footer>
      </form>
    </dialog>
  );
}

/** One question answered by picking a card: real radios, so the arrow keys move between them. */
function Choices({ legend, columns, children }: { legend: string; columns?: boolean; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-lg font-semibold">{legend}</legend>
      <div className={cn("grid gap-2", columns && "sm:grid-cols-2")}>{children}</div>
    </fieldset>
  );
}

function Choice({ name, checked, onChange, icon, title, hint }: { name: string; checked: boolean; onChange: () => void; icon?: ReactNode; title: string; hint: string }) {
  const id = useId();
  return (
    <label className="zuri-wizard-choice">
      <input type="radio" name={name} checked={checked} onChange={onChange} aria-labelledby={`${id}-t`} aria-describedby={`${id}-h`} />
      {icon}
      <span className="min-w-0">
        <span id={`${id}-t`} className="block font-semibold">
          {title}
        </span>
        <span id={`${id}-h`} className="mt-0.5 block text-sm">
          {hint}
        </span>
      </span>
    </label>
  );
}

/**
 * The external tools on in Integrations: the ones at "also in routines" come
 * on and locked; the others can be set free for this routine alone
 * (password and a security notice); a destructive one never.
 */
function RoutineTools({ tools, freed, onChange }: { tools: McpRoutineTool[]; freed: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useI18n();
  const full = freed.length >= MCP_LIMITS.routineTools;
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{t("web.automations.mcp.title")}</legend>
      <p className="text-xs leading-5 text-fg-muted">{t("web.automations.mcp.help")}</p>
      <div className="divide-y divide-border">
        {tools.map((tool) => {
          const everywhere = tool.policy === "routines" && !tool.destructive;
          const on = everywhere || freed.includes(tool.id);
          return (
            <Toggle
              key={tool.id}
              label={tool.label}
              hint={tool.destructive ? t("web.automations.mcp.destructive") : everywhere ? t("web.automations.mcp.everywhere") : ""}
              checked={on}
              disabled={tool.destructive || everywhere || (!on && full)}
              onChange={(value) => onChange(value ? [...freed, tool.id] : freed.filter((id) => id !== tool.id))}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

/** The days of the week as toggle buttons, Monday first. */
function DayPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{t("web.automations.form.days")}</legend>
      <div className="flex flex-wrap gap-1.5">
        {WEEK.map((day) => {
          const on = days.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? days.filter((d) => d !== day) : [...days, day])}
              className={cn("min-h-11 min-w-11 rounded-full border px-2 text-sm font-medium transition-colors", on ? "border-fg bg-fg text-bg" : "border-border-strong bg-surface text-fg hover:bg-raised")}
            >
              {t(DAY_SHORT[day] as MessageKey)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
