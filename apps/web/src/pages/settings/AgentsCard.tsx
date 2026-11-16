import {
  AGENT_PROFILES,
  AGENT_PROMPT_MAX,
  AGENT_TEMPERATURE,
  AGENT_TOP_P,
  AGENT_VERSIONS_KEPT,
  type AgentConfigInput,
  agentConfigProblems,
  type AgentId,
  agentPromptText,
  type AgentVersion,
  type AgentView,
  formatDateTimeParts,
  type MessageKey,
  ptBRAgents,
} from "@zuri/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, History, RotateCcw } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, cn, ErrorNotice, Loading, TextField } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";

// This card's pt-BR texts arrive with the AI tab, not in the first bundle (rule P11).
addMessages(ptBRAgents);

export const AGENTS_KEY = ["ai", "agents"] as const;
/** The fixed rules' box: long, so it scrolls, and a scrolling region takes the keyboard. */
const SCROLL = "max-h-72 overflow-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const versionsKey = (id: AgentId) => ["ai", "agents", id, "versions"] as const;

/**
 * Settings › IA › Agentes (docs/planos/guardrails-especialistas-ia.md, PR 2):
 * each AI agent's temperature, top_p, output cap and the owner's style and
 * task layer, with the fixed rules shown read only, and the saved versions
 * with "Voltar para esta" and "Voltar ao padrão". Saving asks for the password
 * typed recently (the app's confirm dialog answers RECENT_AUTH_REQUIRED).
 */
export function AgentsCard() {
  const { t } = useI18n();
  const agents = useQuery({
    queryKey: AGENTS_KEY,
    queryFn: async ({ signal }) => (await api<{agents: AgentView[]}>("/ai/agents", { signal })).agents,
  });
  return (
    <Card title={t("web.agents.title")} description={t("web.agents.description")}>
      {agents.isPending ? (
        <Loading rows={4} />
      ) : agents.isError ? (
        <ErrorNotice error={agents.error} onRetry={() => void agents.refetch()} />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {agents.data.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function useDecimal() {
  const { locale } = useI18n();
  return (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

const NAME: Record<AgentId, MessageKey> = {
  chat: "web.agents.name.chat",
  summary: "web.agents.name.summary",
  flow_ai: "web.agents.name.flow_ai",
  review_draft: "web.agents.name.review_draft",
  review_check: "web.agents.name.review_check",
  routine_check: "web.agents.name.routine_check",
  home_order: "web.agents.name.home_order",
};
const ABOUT: Record<AgentId, MessageKey> = {
  chat: "web.agents.about.chat",
  summary: "web.agents.about.summary",
  flow_ai: "web.agents.about.flow_ai",
  review_draft: "web.agents.about.review_draft",
  review_check: "web.agents.about.review_check",
  routine_check: "web.agents.about.routine_check",
  home_order: "web.agents.about.home_order",
};
function AgentRow({ agent }: { agent: AgentView }) {
  const { t } = useI18n();
  const decimal = useDecimal();
  const [open, setOpen] = useState(false);
  const panel = useId();
  const { settings } = agent;
  const parts = [
    t("web.agents.summary.temperature", { value: decimal(settings.temperature) }),
    ...(settings.topP === null ? [] : [t("web.agents.summary.topP", { value: decimal(settings.topP) })]),
    ...(settings.maxOutputTokens === null ? [] : [t("web.agents.summary.tokens", { value: decimal(settings.maxOutputTokens) })]),
  ];
  return (
    <li className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {t(NAME[agent.id])}
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-medium",
                settings.version > 0 ? "border-accent/40 bg-accent-soft text-accent-text" : "border-border bg-raised text-fg-muted",
              )}
            >
              {settings.version > 0 ? t("web.agents.custom", { version: settings.version }) : t("web.agents.default")}
            </span>
          </h3>
          <p className="text-sm leading-6 text-fg-muted">{t(ABOUT[agent.id])}</p>
          <p className="text-xs text-fg-muted tabular-nums">{parts.join(" · ")}</p>
        </div>
        <Button variant="secondary" className="shrink-0 self-start" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((value) => !value)}>
          {open ? t("web.agents.close") : t("web.agents.adjust")}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
        </Button>
      </div>
      <div id={panel} hidden={!open}>
        {open && <AgentEditor agent={agent} />}
      </div>
    </li>
  );
}

/** What the form holds: text, as typed, so a half-typed number is never lost. */
interface Draft {
  temperature: string;
  topP: string;
  modelTopP: boolean;
  maxOutputTokens: string;
  prompt: string;
}

function draftOf(agent: AgentView): Draft {
  const { settings } = agent;
  return {
    temperature: String(settings.temperature),
    topP: String(settings.topP ?? 1),
    modelTopP: settings.topP === null,
    maxOutputTokens: settings.maxOutputTokens === null ? "" : String(settings.maxOutputTokens),
    prompt: settings.prompt ?? agent.ownerDefault,
  };
}

/** A typed number, or NaN for anything that isn't one (an empty field too). */
function numberOf(text: string): number {
  const clean = text.trim().replace(",", ".");
  return clean === "" ? Number.NaN : Number(clean);
}

function inputOf(agent: AgentView, draft: Draft): AgentConfigInput {
  const profile = AGENT_PROFILES[agent.id];
  return {
    temperature: numberOf(draft.temperature),
    topP: draft.modelTopP ? null : numberOf(draft.topP),
    maxOutputTokens: profile.maxOutputRange === null ? null : numberOf(draft.maxOutputTokens),
    prompt: profile.ownerPrompt ? draft.prompt : null,
  };
}

/** True when the form says what the agent already uses. */
function unchanged(agent: AgentView, input: AgentConfigInput): boolean {
  const { settings } = agent;
  const prompt = input.prompt === null ? null : agentPromptText(input.prompt);
  const current = settings.prompt ?? agent.ownerDefault.trim();
  return (
    settings.temperature === input.temperature &&
    settings.topP === input.topP &&
    settings.maxOutputTokens === input.maxOutputTokens &&
    (input.prompt === null || prompt === current)
  );
}

function AgentEditor({ agent }: { agent: AgentView }) {
  const { t } = useI18n();
  const decimal = useDecimal();
  const qc = useQueryClient();
  const toast = useToast();
  const profile = AGENT_PROFILES[agent.id];
  const [draft, setDraft] = useState<Draft>(() => draftOf(agent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<"unchanged" | null>(null);
  const [tried, setTried] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const promptId = useId();
  const temperatureId = useId();
  const rangeHintId = `${temperatureId}-hint`;
  const temperatureErrorId = `${temperatureId}-error`;

  // The version in use changed (saved here, gone back, or in another tab): the form follows it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new version replaces what is typed
  useEffect(() => {
    setDraft(draftOf(agent));
  }, [agent.settings.version, agent.savedAt]);

  const input = inputOf(agent, draft);
  const problems = new Set(agentConfigProblems(agent.id, input));
  const show = (field: keyof AgentConfigInput) => (tried || field === "prompt") && problems.has(field);
  const promptLength = [...agentPromptText(draft.prompt)].length;
  const change = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus(null);
  };

  async function send(path: string, body: unknown, method: "PUT" | "POST", message: string) {
    // The going-back buttons stay focusable while a call is out (a disabled button drops the focus), so a second tap waits here.
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const view = await api<AgentView>(path, { method, body });
      qc.setQueryData<AgentView[]>(AGENTS_KEY, (list) => list?.map((item) => (item.id === view.id ? view : item)));
      void qc.invalidateQueries({ queryKey: versionsKey(agent.id) });
      toast(message);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    setStatus(null);
    if (problems.size > 0) return;
    if (unchanged(agent, input)) {
      setStatus("unchanged");
      return;
    }
    await send(`/ai/agents/${agent.id}`, input, "PUT", t("web.agents.saved"));
  }

  function reset() {
    // Already the code's defaults: nothing to send, the same answer as an unchanged save.
    if (agent.settings.version === 0) {
      setStatus("unchanged");
      return;
    }
    void send(`/ai/agents/${agent.id}/restore`, { default: true }, "POST", t("web.agents.resetDone"));
  }

  const temperatureBounds = { min: decimal(AGENT_TEMPERATURE.min), max: decimal(AGENT_TEMPERATURE.max), step: decimal(AGENT_TEMPERATURE.step) };
  const topPBounds = { min: decimal(AGENT_TOP_P.min), max: decimal(AGENT_TOP_P.max), step: decimal(AGENT_TOP_P.step) };
  const range = profile.maxOutputRange;

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="mt-4 space-y-5 rounded-xl bg-raised p-4">
      {profile.sampling ? (
      <>
      <div className="space-y-1.5">
        <label htmlFor={temperatureId} className="block text-sm font-medium">
          {t("web.agents.temperature")}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={AGENT_TEMPERATURE.min}
            max={AGENT_TEMPERATURE.max}
            step={AGENT_TEMPERATURE.step}
            value={Number.isFinite(input.temperature) ? input.temperature : AGENT_TEMPERATURE.min}
            disabled={busy}
            aria-label={t("web.agents.temperature")}
            aria-describedby={rangeHintId}
            className="h-11 min-w-0 flex-1 accent-[var(--color-accent)]"
            onChange={(e) => change({ temperature: e.target.value })}
          />
          <input
            id={temperatureId}
            type="number"
            inputMode="decimal"
            min={AGENT_TEMPERATURE.min}
            max={AGENT_TEMPERATURE.max}
            step={AGENT_TEMPERATURE.step}
            value={draft.temperature}
            disabled={busy}
            aria-invalid={show("temperature") ? true : undefined}
            aria-describedby={show("temperature") ? `${rangeHintId} ${temperatureErrorId}` : rangeHintId}
            className="min-h-11 w-24 rounded-xl border border-border-strong bg-surface px-3 text-[15px] tabular-nums focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 aria-[invalid=true]:border-danger"
            onChange={(e) => change({ temperature: e.target.value })}
          />
        </div>
        <p id={rangeHintId} className="text-xs leading-5 text-fg-muted">
          {t("web.agents.temperatureHint", temperatureBounds)}
        </p>
        {show("temperature") && (
          <p id={temperatureErrorId} className="text-sm text-danger">
            {t("web.agents.invalid.step", temperatureBounds)}
          </p>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("web.agents.topP")}</legend>
        <Switch label={t("web.agents.topPModel")} checked={draft.modelTopP} busy={busy} onChange={(on) => change({ modelTopP: on })} />
        {!draft.modelTopP && (
          <TextField
            label={t("web.agents.topP")}
            hint={t("web.agents.topPHint", topPBounds)}
            error={show("topP") ? t("web.agents.invalid.step", topPBounds) : null}
            type="number"
            inputMode="decimal"
            min={AGENT_TOP_P.min}
            max={AGENT_TOP_P.max}
            step={AGENT_TOP_P.step}
            value={draft.topP}
            disabled={busy}
            onChange={(e) => change({ topP: e.target.value })}
          />
        )}
      </fieldset>
      </>
      ) : (
        <p className="text-sm leading-6 text-fg-muted">{t("web.agents.samplingLocked")}</p>
      )}

      {range ? (
        <TextField
          label={t("web.agents.maxTokens")}
          hint={t("web.agents.maxTokensHint", { min: decimal(range.min), max: decimal(range.max) })}
          error={show("maxOutputTokens") ? t("web.agents.invalid.tokens", { min: decimal(range.min), max: decimal(range.max) }) : null}
          type="number"
          inputMode="numeric"
          min={range.min}
          max={range.max}
          step={1}
          value={draft.maxOutputTokens}
          disabled={busy}
          onChange={(e) => change({ maxOutputTokens: e.target.value })}
        />
      ) : (
        <p className="text-sm text-fg-muted">{t("web.agents.maxTokensChat")}</p>
      )}

      {profile.ownerPrompt ? (
        <div className="space-y-1.5">
          <label htmlFor={promptId} className="block text-sm font-medium">
            {t("web.agents.prompt")}
          </label>
          <textarea
            id={promptId}
            value={draft.prompt}
            disabled={busy}
            rows={6}
            aria-invalid={show("prompt") ? true : undefined}
            aria-describedby={`${promptId}-hint ${promptId}-count${show("prompt") ? ` ${promptId}-error` : ""}`}
            className="min-h-28 w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-[15px] leading-6 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 aria-[invalid=true]:border-danger"
            onChange={(e) => change({ prompt: e.target.value })}
          />
          <div className="flex flex-wrap justify-between gap-2 text-xs leading-5 text-fg-muted">
            <p id={`${promptId}-hint`}>{t("web.agents.promptHint", { max: decimal(AGENT_PROMPT_MAX) })}</p>
            <p id={`${promptId}-count`} className={cn("tabular-nums", promptLength > AGENT_PROMPT_MAX && "text-danger")}>
              {t("web.agents.promptCount", { count: decimal(promptLength), max: decimal(AGENT_PROMPT_MAX) })}
            </p>
          </div>
          {show("prompt") && (
            <p id={`${promptId}-error`} className="text-sm text-danger">
              {t("web.agents.invalid.prompt", { max: decimal(AGENT_PROMPT_MAX) })}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm leading-6 text-fg-muted">{t("web.agents.promptLocked")}</p>
      )}

      <details className="group rounded-xl border border-border bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-medium">
          {t("web.agents.rules")}
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-2 border-t border-border p-3">
          <p className="text-xs leading-5 text-fg-muted">{t("web.agents.rulesHint")}</p>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the long rules scroll here, and a scrolling region must take the keyboard (axe). */}
          <section tabIndex={0} aria-label={t("web.agents.rules")} className={SCROLL}>
            <pre lang="en" className="whitespace-pre-wrap break-words text-xs leading-5 [overflow-wrap:anywhere]">
              {agent.rules}
            </pre>
          </section>
        </div>
      </details>

      <p className="text-xs leading-5 text-fg-muted">{t("web.agents.passwordNote")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy}>
          {t("web.agents.save")}
        </Button>
        {/* Always there, even at the default: a button that vanished after its own click would drop the keyboard's focus. */}
        <Button variant="secondary" aria-disabled={busy || undefined} onClick={reset}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          {t("web.agents.reset")}
        </Button>
        <Button variant="secondary" aria-expanded={showVersions} onClick={() => setShowVersions((value) => !value)}>
          <History className="h-4 w-4" aria-hidden />
          {showVersions ? t("web.agents.versionsHide") : t("web.agents.versions")}
        </Button>
        <div aria-live="polite" className="text-sm">
          {error !== null && <p className="text-danger">{errorMessage(error)}</p>}
          {status === "unchanged" && <p className="text-fg-muted">{t("web.agents.unchanged")}</p>}
        </div>
      </div>
      <p className="text-xs text-fg-muted [overflow-wrap:anywhere]">{t("web.agents.promptVersion", { value: agent.promptVersion })}</p>
      {showVersions && <Versions agent={agent} busy={busy} onRestore={(version) => void send(`/ai/agents/${agent.id}/restore`, { version }, "POST", t("web.agents.restored", { version }))} />}
    </form>
  );
}

function Versions({ agent, busy, onRestore }: { agent: AgentView; busy: boolean; onRestore: (version: number) => void }) {
  const { t, locale, timeZone } = useI18n();
  const decimal = useDecimal();
  const versions = useQuery({
    queryKey: versionsKey(agent.id),
    queryFn: async ({ signal }) => (await api<{versions: AgentVersion[]}>(`/ai/agents/${agent.id}/versions`, { signal })).versions,
  });
  if (versions.isPending) return <Loading rows={2} />;
  if (versions.isError) return <ErrorNotice error={versions.error} onRetry={() => void versions.refetch()} />;
  if (versions.data.length === 0) return <p className="text-sm text-fg-muted">{t("web.agents.versionsEmpty")}</p>;
  const newest = versions.data[0]?.version;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {versions.data.map((version: AgentVersion) => {
          const when = formatDateTimeParts(version.createdAt, locale, timeZone);
          const parts = version.isDefault
            ? [t("web.agents.versionDefault")]
            : [
                t("web.agents.summary.temperature", { value: decimal(version.temperature) }),
                ...(version.topP === null ? [] : [t("web.agents.summary.topP", { value: decimal(version.topP) })]),
                ...(version.maxOutputTokens === null ? [] : [t("web.agents.summary.tokens", { value: decimal(version.maxOutputTokens) })]),
              ];
          return (
            <li key={version.version} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">
                  {t("web.agents.versionItem", { version: version.version })}
                  <span className="font-normal text-fg-muted">
                    {" · "}
                    {when.date} {when.time}
                  </span>
                </p>
                <p className="text-xs text-fg-muted tabular-nums">{parts.join(" · ")}</p>
                {version.prompt === "" ? (
                  <p className="text-xs text-fg-muted">{t("web.agents.versionNoStyle")}</p>
                ) : (
                  version.prompt && <p className="line-clamp-2 text-xs text-fg-muted [overflow-wrap:anywhere]">{version.prompt}</p>
                )}
              </div>
              {version.version === newest ? (
                <span className="text-xs font-medium text-fg-muted">{t("web.agents.versionCurrent")}</span>
              ) : (
                <Button variant="secondary" className="self-start sm:self-auto" aria-disabled={busy || undefined} aria-label={t("web.agents.restoreLabel", { version: version.version })} onClick={() => onRestore(version.version)}>
                  {t("web.agents.restore")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-fg-muted">{t("web.agents.versionKept", { count: AGENT_VERSIONS_KEPT })}</p>
    </div>
  );
}
