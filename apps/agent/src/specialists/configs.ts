import {
  AGENT_IDS,
  AGENT_PROFILES,
  AGENT_VERSIONS_KEPT,
  type AgentCallSettings,
  type AgentConfigInput,
  agentConfigProblems,
  type AgentId,
  agentPromptText,
  type AgentVersion,
  type AgentView,
  defaultAgentSettings,
} from "@zuri/shared";
import { CHAT_PERSONA, chatPromptVersion, FIXED_INSTRUCTIONS } from "../agent/prompt.ts";
import type { Database } from "../db/database.ts";
import { AppError } from "../http/errors.ts";
import { specialistVersion, type SpecialistText } from "./contract.ts";
import { FLOW_AI_SPECIALIST } from "./flow-ai.ts";
import { REVIEW_CHECK_SPECIALIST, REVIEW_DRAFT_SPECIALIST } from "./reviews.ts";
import { ROUTINE_CHECK_SPECIALIST } from "./routine-check.ts";
import { SUMMARY_SPECIALIST } from "./summary.ts";

/**
 * Each agent's settings as the owner saved them on the AI screen
 * (docs/planos/guardrails-especialistas-ia.md, PR 2): temperature, top_p, the
 * output cap and the style and task layer of the prompt. The fixed layer
 * (safety, the data rule, the answer's format) stays in the code and is only
 * shown. Every change is a new version; the latest is the one in use, and the
 * 20 newest are kept.
 *
 * Only the AI screen's routes change them, behind the password typed again
 * (requireRecentAuth) and outside the lockdown: no tool, bot command, MCP
 * or flow reaches this class.
 */

/** The texts of each agent's prompt: the chat's from prompt.ts, the specialists' from their own files. */
const TEXTS: Readonly<Record<AgentId, SpecialistText>> = {
  chat: { id: "chat", rules: FIXED_INSTRUCTIONS, ownerDefault: CHAT_PERSONA },
  summary: SUMMARY_SPECIALIST,
  flow_ai: FLOW_AI_SPECIALIST,
  review_draft: REVIEW_DRAFT_SPECIALIST,
  review_check: REVIEW_CHECK_SPECIALIST,
  routine_check: ROUTINE_CHECK_SPECIALIST,
};

/** The PROMPT_VERSION a call of `id` with `settings` records. */
export function agentPromptVersion(id: AgentId, settings: AgentCallSettings): string {
  return id === "chat" ? chatPromptVersion(settings) : specialistVersion(TEXTS[id], settings);
}

interface ConfigRow {
  agent: string;
  version: number;
  temperature: number | null;
  top_p: number | null;
  max_tokens: number | null;
  prompt: string | null;
  is_default: number;
  created_at: number;
}

const COLUMNS = "agent, version, temperature, top_p, max_tokens, prompt, is_default, created_at";

interface Current {
  settings: AgentCallSettings;
  savedAt: string | null;
}

export class AgentConfigs {
  /** The version in use of each agent, read once per wake of the object: every model call asks (rule P1). */
  #current: Map<AgentId, Current> | null = null;

  constructor(
    private readonly db: Database,
    private readonly clock: () => number = Date.now,
  ) {}

  /** The settings of agent `id`'s next call. */
  settings(id: AgentId): AgentCallSettings {
    return this.current(id).settings;
  }

  /** Every agent, in the screen's order. */
  list(): AgentView[] {
    return AGENT_IDS.map((id) => this.view(id));
  }

  view(id: AgentId): AgentView {
    const { settings, savedAt } = this.current(id);
    const text = TEXTS[id];
    return { id, settings, savedAt, ownerDefault: text.ownerDefault, rules: text.rules, promptVersion: agentPromptVersion(id, settings) };
  }

  /** The kept versions of `id`, newest first. */
  versions(id: AgentId): AgentVersion[] {
    return this.db
      .all<ConfigRow>(`SELECT ${COLUMNS} FROM zur_agent_configs WHERE agent = ? ORDER BY version DESC LIMIT ?`, id, AGENT_VERSIONS_KEPT)
      .map((row) => {
        const settings = toSettings(id, row);
        return {
          version: row.version,
          temperature: settings.temperature,
          topP: settings.topP,
          maxOutputTokens: settings.maxOutputTokens,
          prompt: settings.prompt,
          isDefault: row.is_default === 1,
          createdAt: new Date(row.created_at).toISOString(),
        };
      });
  }

  /** A new version with the owner's values. The same values as the one in use add nothing (`changed` false). */
  save(id: AgentId, input: AgentConfigInput): { view: AgentView; changed: boolean } {
    const problems = agentConfigProblems(id, input);
    if (problems.length) throw new AppError("VALIDATION_FAILED", undefined, { fields: problems });
    const prompt = input.prompt === null || !AGENT_PROFILES[id].ownerPrompt ? null : agentPromptText(input.prompt);
    // The code's own layer is kept as null, so it follows the code when it changes.
    const kept = prompt === TEXTS[id].ownerDefault.trim() ? null : prompt;
    const current = this.current(id).settings;
    const same = current.temperature === input.temperature && current.topP === input.topP && current.maxOutputTokens === input.maxOutputTokens && current.prompt === kept;
    if (same) return { view: this.view(id), changed: false };
    this.insert(id, { temperature: input.temperature, top_p: input.topP, max_tokens: input.maxOutputTokens, prompt: kept, is_default: 0 });
    return { view: this.view(id), changed: true };
  }

  /**
   * "Voltar para esta versão" (a copy of it becomes the newest) or "Voltar ao padrão". Going back
   * to what is already in use adds nothing, so repeated clicks never push real versions out of the 20.
   */
  restore(id: AgentId, target: { version: number } | { default: true }): { view: AgentView; changed: boolean } {
    let values: Pick<ConfigRow, "temperature" | "top_p" | "max_tokens" | "prompt" | "is_default">;
    if ("default" in target) values = { temperature: null, top_p: null, max_tokens: null, prompt: null, is_default: 1 };
    else {
      const row = this.db.one<ConfigRow>(`SELECT ${COLUMNS} FROM zur_agent_configs WHERE agent = ? AND version = ?`, id, target.version);
      if (!row) throw new AppError("NOT_FOUND");
      values = row;
    }
    const current = this.current(id);
    const next = toSettings(id, { agent: id, version: current.settings.version, created_at: 0, ...values });
    const same = values.is_default === 1 ? current.settings.version === 0 : sameValues(next, current.settings);
    if (same) return { view: this.view(id), changed: false };
    this.insert(id, { temperature: values.temperature, top_p: values.top_p, max_tokens: values.max_tokens, prompt: values.prompt, is_default: values.is_default });
    return { view: this.view(id), changed: true };
  }

  private insert(id: AgentId, values: Pick<ConfigRow, "temperature" | "top_p" | "max_tokens" | "prompt" | "is_default">): void {
    this.db.transaction(() => {
      const last = this.db.one<{ version: number | null }>(`SELECT max(version) AS version FROM zur_agent_configs WHERE agent = ?`, id)?.version ?? 0;
      const version = last + 1;
      this.db.run(
        `INSERT INTO zur_agent_configs (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        version,
        values.temperature,
        values.top_p,
        values.max_tokens,
        values.prompt,
        values.is_default,
        this.clock(),
      );
      this.db.run(`DELETE FROM zur_agent_configs WHERE agent = ? AND version <= ?`, id, version - AGENT_VERSIONS_KEPT);
    });
    this.#current = null;
  }

  private current(id: AgentId): Current {
    if (!this.#current) {
      const map = new Map<AgentId, Current>();
      const rows = this.db.all<ConfigRow>(
        `SELECT ${COLUMNS} FROM zur_agent_configs c WHERE version = (SELECT max(version) FROM zur_agent_configs WHERE agent = c.agent)`,
      );
      for (const row of rows) {
        const agent = AGENT_IDS.find((known) => known === row.agent);
        if (agent) map.set(agent, { settings: toSettings(agent, row), savedAt: new Date(row.created_at).toISOString() });
      }
      this.#current = map;
    }
    return this.#current.get(id) ?? { settings: defaultAgentSettings(id), savedAt: null };
  }
}

/** The same values, whatever the version number. */
function sameValues(a: AgentCallSettings, b: AgentCallSettings): boolean {
  return a.temperature === b.temperature && a.topP === b.topP && a.maxOutputTokens === b.maxOutputTokens && a.prompt === b.prompt;
}

/**
 * A row as call settings. "Voltar ao padrão" is the code's defaults with version 0, so its
 * PROMPT_VERSION is the code's own; a value out of the agent's ranges now (the code narrowed
 * them) falls back to the code's default for that field.
 */
function toSettings(id: AgentId, row: ConfigRow): AgentCallSettings {
  const defaults = defaultAgentSettings(id);
  if (row.is_default === 1) return defaults;
  const input: AgentConfigInput = {
    temperature: row.temperature ?? defaults.temperature,
    topP: row.top_p,
    maxOutputTokens: row.max_tokens,
    prompt: AGENT_PROFILES[id].ownerPrompt ? row.prompt : null,
  };
  const problems = new Set(agentConfigProblems(id, input));
  return {
    temperature: problems.has("temperature") ? defaults.temperature : input.temperature,
    topP: problems.has("topP") ? defaults.topP : input.topP,
    maxOutputTokens: problems.has("maxOutputTokens") ? defaults.maxOutputTokens : input.maxOutputTokens,
    prompt: problems.has("prompt") ? null : input.prompt,
    version: row.version,
  };
}
