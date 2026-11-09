import type { AgentCallSettings, ReviewDraftAnswer, ReviewTone } from "@zuri/shared";
import { dataLine } from "../agent/data.ts";
import { runSpecialist, type SpecialistAi } from "../specialists/contract.ts";
import { approved, REVIEW_CHECK_SPECIALIST, REVIEW_DRAFT_SPECIALIST } from "../specialists/reviews.ts";

export { jsonIn } from "../specialists/contract.ts";

/**
 * The reviews' agent (step 19c): text in, JSON out, through the specialists'
 * contract (specialists/contract.ts). It has no tools, no history and no
 * memories; the review goes in a `<data source="review">` block and the
 * owner's style in `<data source="settings">`, both neutralized, so nothing a
 * reviewer writes can become an instruction. Its answer is checked by Zod
 * (anything else is a failed draft), then by the fixed checker and by a
 * second reading of the reply alone.
 */

/** The narrow door to the model: the metered `generate`, never the chat's tools. */
export type ReviewAi = SpecialistAi;

export interface DraftInput {
  id: string;
  rating: number;
  firstName: string;
  comment: string;
  signature: string;
  tone: ReviewTone;
  /** positive: thank the reviewer; careful: a negative review, a short apology and an invitation to talk. */
  mode: "positive" | "careful";
}

const MODE: Record<DraftInput["mode"], string> = {
  positive: "Thank the reviewer warmly and briefly.",
  careful: "The review is negative: apologize in general terms, without admitting facts or discussing the case, and invite the person to talk through the business's official channel. Never argue.",
};

const TONE: Record<ReviewTone, string> = { close: "warm and close", formal: "polite and formal" };

export class ReviewResponder {
  constructor(
    private readonly ai: () => ReviewAi,
    /** The owner's settings of the two agents (AI screen); the code's defaults when absent. */
    private readonly agentSettings?: ((id: "review_draft" | "review_check") => AgentCallSettings) | undefined,
  ) {}

  /** A draft and what the agent saw in the review (null when the answer is out of shape), with the prompt that made it. Throws what the model throws. */
  async draft(input: DraftInput, maxNeurons: number, onNeurons: (n: number) => void): Promise<{ answer: ReviewDraftAnswer | null; version: string }> {
    const settings = dataLine("settings", "reply_style", `signature: ${input.signature}; tone: ${TONE[input.tone]}; task: ${MODE[input.mode]}`);
    const review = dataLine("review", input.id, input.comment, { rating: String(input.rating), first_name: input.firstName || "anonymous" });
    const { value, version } = await runSpecialist(this.ai(), REVIEW_DRAFT_SPECIALIST, `${settings}\n${review}`, { ...this.settings("review_draft"), maxNeurons, onNeurons });
    return { answer: value, version };
  }

  /** The second reading: the reply alone, never the review. False on any doubt (an answer out of shape too). */
  async secondRead(reply: string, maxNeurons: number, onNeurons: (n: number) => void): Promise<boolean> {
    const { value } = await runSpecialist(this.ai(), REVIEW_CHECK_SPECIALIST, dataLine("review", "reply", reply), { ...this.settings("review_check"), maxNeurons, onNeurons });
    return approved(value);
  }

  private settings(id: "review_draft" | "review_check"): { settings?: AgentCallSettings } {
    return this.agentSettings ? { settings: this.agentSettings(id) } : {};
  }
}
