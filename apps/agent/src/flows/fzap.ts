import { type FzapStatus, fzapStatusSchema } from "@zuri/shared";
import { type CallDeps, type ConnectionRow, type FlowConnections, FlowStepError } from "./connections.ts";

/**
 * The fzap's fixed client (E6b, docs/planos/credencial-fzap.md). Only the session's state, for
 * "Testar": whether the instance is linked to WhatsApp and whether it runs on the Cloud API, where
 * the fzap sends no Pix. The answer is data from outside: only these three things are read.
 */
export async function fzapStatus(connections: FlowConnections, row: ConnectionRow, deps: CallDeps): Promise<FzapStatus> {
  const answer = await connections.fixed(row, "fzap", { method: "GET", path: "/session/status" }, deps);
  const parsed = fzapStatusSchema.safeParse(answer.body);
  if (!parsed.success) throw new FlowStepError("bad_answer");
  const { connected, loggedIn, cloudapi } = parsed.data.data;
  return { connected, loggedIn, cloud: cloudapi !== undefined && cloudapi !== null };
}
