import { CHATWOOT_LIMITS, type ChatwootInbox, chatwootContactsSchema, chatwootConversationsSchema, chatwootCreatedSchema, chatwootInboxesSchema, chatwootMessagesSchema, chatwootNewContactSchema } from "@zuri/shared";
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

// ---------- The outbox's calls (PR S19; crm/outbox.ts) ----------

/** The digits of a Brazilian mobile with and without the 9th digit; any other number only as it is. */
export function phoneVariants(e164: string): string[] {
  const digits = e164.replace(/\D/g, "");
  const br = /^55(\d{2})(\d{8,9})$/.exec(digits);
  if (!br) return [digits];
  const [, area, rest] = br as unknown as [string, string, string];
  if (rest.length === 9 && rest.startsWith("9")) return [digits, `55${area}${rest.slice(1)}`];
  if (rest.length === 8 && /^[6-9]/.test(rest)) return [digits, `55${area}9${rest}`];
  return [digits];
}

/** A contact of the Chatwoot account found by its phone (both forms of a Brazilian mobile), or null. */
export async function chatwootFindContact(connections: FlowConnections, row: ConnectionRow, deps: CallDeps, e164: string): Promise<{ id: number; blocked: boolean } | null> {
  const { accountId } = chatwootSettings(row);
  const variants = phoneVariants(e164);
  // The last 8 digits match both forms; the answer is then filtered by the whole number.
  const q = (variants[0] as string).slice(-8);
  const answer = await connections.fixed(row, "chatwoot", { method: "GET", path: `/api/v1/accounts/${accountId}/contacts/search?q=${q}&include_contacts=true` }, deps);
  const parsed = chatwootContactsSchema.safeParse(answer.body);
  if (!parsed.success) throw new FlowStepError("bad_answer");
  const found = parsed.data.payload.find((contact) => variants.includes((contact.phone_number ?? "").replace(/\D/g, "")));
  if (!found) return null;
  const flag = found.custom_attributes?.crmBloqueado;
  return { id: found.id, blocked: flag === true || flag === "true" || flag === "sim" || flag === 1 };
}

export async function chatwootCreateContact(connections: FlowConnections, row: ConnectionRow, deps: CallDeps, input: { name: string; e164: string }): Promise<number> {
  const { accountId, inboxId } = chatwootSettings(row);
  if (inboxId === null) throw new FlowStepError("connection_missing");
  const answer = await connections.fixed(row, "chatwoot", { method: "POST", path: `/api/v1/accounts/${accountId}/contacts`, body: { inbox_id: inboxId, name: input.name, phone_number: input.e164 } }, deps);
  const parsed = chatwootNewContactSchema.safeParse(answer.body);
  if (!parsed.success) throw new FlowStepError("bad_answer");
  return "contact" in parsed.data.payload ? parsed.data.payload.contact.id : parsed.data.payload.id;
}

/** The contact's open conversation in the credential's inbox, or a new one. */
export async function chatwootConversation(connections: FlowConnections, row: ConnectionRow, deps: CallDeps, contactId: number): Promise<number> {
  const { accountId, inboxId } = chatwootSettings(row);
  if (inboxId === null) throw new FlowStepError("connection_missing");
  const list = await connections.fixed(row, "chatwoot", { method: "GET", path: `/api/v1/accounts/${accountId}/contacts/${contactId}/conversations` }, deps);
  const parsed = chatwootConversationsSchema.safeParse(list.body);
  if (!parsed.success) throw new FlowStepError("bad_answer");
  const open = parsed.data.payload.find((conversation) => conversation.inbox_id === inboxId && conversation.status !== "resolved");
  if (open) return open.id;
  const created = await connections.fixed(row, "chatwoot", { method: "POST", path: `/api/v1/accounts/${accountId}/conversations`, body: { inbox_id: inboxId, contact_id: contactId } }, deps);
  const id = chatwootCreatedSchema.safeParse(created.body);
  if (!id.success) throw new FlowStepError("bad_answer");
  return id.data.id;
}

/** The id of an outgoing message with exactly this text, sent at `since` or later (seconds), or null. */
export async function chatwootFindSent(connections: FlowConnections, row: ConnectionRow, deps: CallDeps, conversationId: number, text: string, since: number): Promise<number | null> {
  const { accountId } = chatwootSettings(row);
  const answer = await connections.fixed(row, "chatwoot", { method: "GET", path: `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages` }, deps);
  const parsed = chatwootMessagesSchema.safeParse(answer.body);
  if (!parsed.success) throw new FlowStepError("bad_answer");
  // Compared without line-ending or edge-space differences: a Chatwoot that tidies the text must still be found.
  const wanted = sameText(text);
  const found = parsed.data.payload.find(
    (message) => (message.message_type === 1 || message.message_type === "outgoing") && typeof message.content === "string" && sameText(message.content) === wanted && (message.created_at ?? 0) >= Math.floor(since / 1000) - 60,
  );
  return found?.id ?? null;
}

export async function chatwootSend(connections: FlowConnections, row: ConnectionRow, deps: CallDeps, conversationId: number, text: string): Promise<number> {
  const { accountId } = chatwootSettings(row);
  const answer = await connections.fixed(row, "chatwoot", { method: "POST", path: `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, body: { content: text, message_type: "outgoing", private: false } }, deps);
  const parsed = chatwootCreatedSchema.safeParse(answer.body);
  if (!parsed.success) throw new FlowStepError("bad_answer");
  return parsed.data.id;
}

function sameText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}
