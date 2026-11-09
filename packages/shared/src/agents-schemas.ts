// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";
import { AGENT_PROMPT_MAX } from "./agents.ts";

/**
 * The AI screen's agents (docs/planos/guardrails-especialistas-ia.md, PR 2):
 * the routes' request bodies (the answers are the types of agents.ts). The ranges per agent are checked by
 * agentConfigProblems (agents.ts), which the screen uses too. Each schema is
 * built inside a pure call, so a bundle that doesn't use it leaves it (and
 * Zod) out of the first load (rule P11).
 */

export const agentConfigUpdateSchema = /* @__PURE__ */ (() =>
  z.strictObject({
    temperature: z.number(),
    topP: z.number().nullable(),
    maxOutputTokens: z.number().int().nullable(),
    // Room for line breaks sent as CRLF; agentConfigProblems counts the kept text.
    prompt: z.string().max(AGENT_PROMPT_MAX * 2).nullable(),
  }))();

/** "Voltar para esta versão" names one; "Voltar ao padrão" asks for the code's defaults. */
export const agentRestoreSchema = /* @__PURE__ */ (() =>
  z.union([z.strictObject({ version: z.number().int().min(1) }), z.strictObject({ default: z.literal(true) })]))();
