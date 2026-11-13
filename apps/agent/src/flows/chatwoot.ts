import { CHATWOOT_LIMITS, type ChatwootInbox, chatwootInboxesSchema } from "@zuri/shared";
import { type CallDeps, type ConnectionRow, chatwootSettings, type FlowConnections, FlowStepError } from "./connections.ts";

/**
 * The Chatwoot's fixed client (PR S17; docs/planos/envio-chatwoot-pela-zuri.md).
 * Its paths are written here and nowhere else: a flow never calls a Chatwoot
 * credential, and the screen never names a path. For now it only reads the
 * inboxes the key sees (the test and the pick of the inbox); sending is the
 * queue's (S19).
 */
export async function chatwootInboxes(connections: FlowConnections, row: ConnectionRow, deps: CallDeps): Promise<ChatwootInbox[]> {
  const { accountId } = chatwootSettings(row);
  const answer = await connections.fixed(row, "chatwoot", { method: "GET", path: `/api/v1/accounts/${accountId}/inboxes` }, deps);
  // The answer is data from outside: only the id, a cut name and the kind of inbox come back.
  const parsed = chatwootInboxesSchema.safeParse(answer.body);
  if (!parsed.success) throw new FlowStepError("bad_answer");
  return parsed.data.payload.slice(0, CHATWOOT_LIMITS.inboxes).map((inbox) => ({
    id: inbox.id,
    name: [...inbox.name.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim()].slice(0, CHATWOOT_LIMITS.inboxName).join(""),
    api: inbox.channel_type === "Channel::Api",
  }));
}
