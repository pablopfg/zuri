import { defaultAgentSettings } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, scheduledInstructions } from "../src/agent/prompt.ts";
import { specialistSystem } from "../src/specialists/contract.ts";
import { FLOW_AI_SPECIALIST } from "../src/specialists/flow-ai.ts";
import { REVIEW_CHECK_SPECIALIST, REVIEW_DRAFT_SPECIALIST } from "../src/specialists/reviews.ts";
import { ROUTINE_CHECK_SPECIALIST } from "../src/specialists/routine-check.ts";
import { HOME_ORDER_SPECIALIST } from "../src/specialists/home-order.ts";
import { SUMMARY_SPECIALIST } from "../src/specialists/summary.ts";

/**
 * Every prompt as the code builds it, kept as a snapshot (CA9): a change to a
 * prompt shows up in the pull request's diff, next to the code that made it,
 * and goes through `scripts/avaliar-prompts.ts` before it merges
 * (.claude/rules/prompts.md). Update with `npx vitest run -u` only on purpose.
 */
describe("the prompts as built", () => {
  it("matches the chat's prompt, with fixed inputs", () => {
    const system = buildSystemPrompt({
      agentName: "Zuri",
      language: "Brazilian Portuguese (pt-BR)",
      timeZone: "America/Sao_Paulo",
      now: new Date("2026-11-04T12:00:00Z"),
      ownerName: "Ana",
      locale: "pt-BR",
      memories: "",
      summary: null,
      routine: scheduledInstructions("Revisão", true, true),
    });
    expect(system).toMatchSnapshot();
  });

  it("matches every specialist's prompt", () => {
    for (const spec of [SUMMARY_SPECIALIST, FLOW_AI_SPECIALIST, REVIEW_DRAFT_SPECIALIST, REVIEW_CHECK_SPECIALIST, ROUTINE_CHECK_SPECIALIST, HOME_ORDER_SPECIALIST]) {
      expect(specialistSystem(spec, defaultAgentSettings(spec.id)), spec.id).toMatchSnapshot(spec.id);
    }
  });
});
