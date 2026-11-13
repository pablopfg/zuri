import { CHATWOOT_OWNER_LIMITS, type ChatwootOwnerProblem, FLOW_LIMITS } from "@zuri/shared";
import { z } from "zod";
import type { FlowNetwork, WakeMeter } from "../flows/connections.ts";
import { limitBody, McpConnectionError } from "../mcp/guarded-fetch.ts";
import { assertPublicHost, endpointUrl, McpEndpointError, type Resolver } from "../mcp/url.ts";

/**
 * The Chatwoot calls of the owner's conversation (docs/planos/zuri-no-chatwoot.md,
 * section 7). Every path is written here; the screen gives only the address and
 * the account. The administrator's key travels in one request's header and is
 * never kept, logged or returned. Each call: https only, the host's DNS checked
 * once per request, no redirect, 10 s, 256 KB read, counted (rule P9).
 */

/** A call that stopped, by what the screen says about it. */
export class ChatwootCallError extends Error {
  constructor(
    readonly problem: ChatwootOwnerProblem,
    readonly status: number | null = null,
    /** An inbox the call created before it stopped (an old Chatwoot without the secrets): undone by the caller. */
    readonly createdInbox: number | null = null,
  ) {
    super(problem);
    this.name = "ChatwootCallError";
  }
}

export interface OwnerCallDeps {
  network: FlowNetwork;
  development: boolean;
  meter: WakeMeter;
  /** The hosts already checked in this request. */
  hosts: Map<string, Promise<void>>;
  signal?: AbortSignal;
}

/** The Chatwoot's own header for a user's key. */
const KEY_HEADER = "api_access_token";

interface Call {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  /** Only the calls of the setup, the full test, repair and new secrets carry it. */
  adminKey?: string;
}

/** One call to the Chatwoot at `origin`; the answer read as JSON (null when empty). */
export async function chatwootCall(origin: string, call: Call, deps: OwnerCallDeps): Promise<{ status: number; body: unknown }> {
  let url: URL;
  try {
    url = new URL(call.path, `${origin}/`);
  } catch {
    throw new ChatwootCallError("origin");
  }
  for (const [name, value] of Object.entries(call.query ?? {})) url.searchParams.set(name, value);
  if (url.origin !== origin || !endpointUrl(url.href, { development: deps.development })) throw new ChatwootCallError("origin");
  await vet(url, deps);
  const headers = new Headers({ accept: "application/json", "user-agent": "Zuri" });
  if (call.adminKey !== undefined) headers.set(KEY_HEADER, call.adminKey);
  let body: string | undefined;
  if (call.body !== undefined) {
    body = JSON.stringify(call.body);
    headers.set("content-type", "application/json");
  }
  if (!deps.meter.room(1)) throw new ChatwootCallError("calls_limit");
  deps.meter.take();
  const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(FLOW_LIMITS.requestTimeoutMs)]) : AbortSignal.timeout(FLOW_LIMITS.requestTimeoutMs);
  let response: Response;
  try {
    response = await deps.network.fetch(new Request(url.href, { method: call.method, headers, ...(body === undefined ? {} : { body }), redirect: "manual", signal }));
  } catch (error) {
    throw problemOf(error);
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new ChatwootCallError("redirect", response.status);
  }
  if (response.status >= 400) {
    // A refusal's body is never read: its status says enough, and it may echo what was sent.
    await response.body?.cancel().catch(() => undefined);
    throw new ChatwootCallError(refusal(response.status), response.status);
  }
  let raw: string;
  try {
    raw = await limitBody(response, FLOW_LIMITS.responseBytes, FLOW_LIMITS.requestTimeoutMs).text();
  } catch (error) {
    throw problemOf(error);
  }
  if (raw.trim() === "") return { status: response.status, body: null };
  try {
    return { status: response.status, body: JSON.parse(raw) as unknown };
  } catch {
    throw new ChatwootCallError("bad_answer", response.status);
  }
}

function refusal(status: number): ChatwootOwnerProblem {
  if (status === 401 || status === 403) return "refused";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "rejected";
  return "unavailable";
}

function problemOf(error: unknown): ChatwootCallError {
  if (error instanceof ChatwootCallError) return error;
  if (error instanceof McpConnectionError) return new ChatwootCallError(error.problem === "too_large" ? "too_large" : error.problem === "timeout" ? "timeout" : "unavailable");
  const name = error instanceof Error ? error.name : "";
  return new ChatwootCallError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable");
}

/** The DNS check, once per host and request: two lookups, counted before they run. */
function vet(url: URL, deps: OwnerCallDeps): Promise<void> {
  const known = deps.hosts.get(url.host);
  if (known) return known;
  const check = (async () => {
    if (!deps.meter.room(2)) throw new ChatwootCallError("calls_limit");
    const resolve: Resolver = async (host, signal) => {
      deps.meter.take();
      deps.meter.take();
      return deps.network.resolve(host, signal);
    };
    try {
      await assertPublicHost(url, resolve, { development: deps.development, ...(deps.signal ? { signal: deps.signal } : {}) });
    } catch (error) {
      if (error instanceof McpEndpointError) throw new ChatwootCallError(error.problem === "private_address" ? "private_address" : "dns");
      throw new ChatwootCallError("dns");
    }
  })();
  deps.hosts.set(url.host, check);
  check.catch(() => deps.hosts.delete(url.host));
  return check;
}

// ---------- What each answer must hold (the answer is data from outside) ----------

const id = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const name = z.string().max(500).catch("");
const token = z.string().min(8).max(200).regex(/^[\x21-\x7e]+$/);

const profileSchema = z.object({
  id,
  name,
  email: z.string().max(320).nullable().catch(null),
  accounts: z.array(z.object({ id, role: z.string().max(40).catch("") }).loose()).max(200).catch([]),
});

const inboxSchema = z.object({
  id,
  inbox_identifier: token,
  secret: token.optional(),
  hmac_token: token.optional(),
  webhook_url: z.string().max(2_048).nullable().optional(),
  hmac_mandatory: z.boolean().nullable().optional(),
  channel_type: z.string().max(80).optional(),
});

const agentSchema = z.object({ id, name, role: z.string().max(40).catch("") }).loose();

/** Names as the screen shows them: no control or format characters, cut by characters. */
export function cleanName(value: string): string {
  return [...value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()].slice(0, CHATWOOT_OWNER_LIMITS.nameMax).join("");
}

function parsed<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new ChatwootCallError("bad_answer");
  return result.data;
}

// ---------- With the administrator's key ----------

export interface AdminTarget {
  origin: string;
  accountId: number;
  adminKey: string;
}

/** Who owns the key, and whether they administer the account given. */
export async function profile(target: AdminTarget, deps: OwnerCallDeps): Promise<{ id: number; name: string; email: string | null; administrator: boolean }> {
  const answer = await chatwootCall(target.origin, { method: "GET", path: "/api/v1/profile", adminKey: target.adminKey }, deps);
  const body = parsed(profileSchema, answer.body);
  const account = body.accounts.find((entry) => entry.id === target.accountId);
  return {
    id: body.id,
    name: cleanName(body.name),
    email: body.email ? cleanName(body.email) : null,
    administrator: account?.role === "administrator",
  };
}

export interface InboxSecrets {
  id: number;
  inboxIdentifier: string;
  secret: string;
  hmacToken: string;
  webhookUrl: string | null;
  hmacMandatory: boolean;
}

function inboxSecrets(body: unknown): InboxSecrets {
  const inbox = parsed(inboxSchema, body);
  // An older Chatwoot doesn't return them: nothing could be signed or checked.
  if (!inbox.secret || !inbox.hmac_token) throw new ChatwootCallError("old_version");
  return {
    id: inbox.id,
    inboxIdentifier: inbox.inbox_identifier,
    secret: inbox.secret,
    hmacToken: inbox.hmac_token,
    webhookUrl: inbox.webhook_url ?? null,
    hmacMandatory: inbox.hmac_mandatory === true,
  };
}

/**
 * The "Zuri" inbox, born quiet and with the HMAC already mandatory (the order
 * matters: the contact comes after, with its hash): no greeting, no survey, no
 * e-mail request, one conversation.
 */
export async function createInbox(target: AdminTarget, webhookUrl: string, deps: OwnerCallDeps): Promise<InboxSecrets> {
  const answer = await chatwootCall(
    target.origin,
    {
      method: "POST",
      path: `/api/v1/accounts/${target.accountId}/inboxes`,
      adminKey: target.adminKey,
      body: {
        name: "Zuri",
        greeting_enabled: false,
        csat_survey_enabled: false,
        enable_email_collect: false,
        allow_messages_after_resolved: true,
        lock_to_single_conversation: true,
        channel: { type: "api", webhook_url: webhookUrl, hmac_mandatory: true },
      },
    },
    deps,
  );
  try {
    return inboxSecrets(answer.body);
  } catch (error) {
    // Made but unusable: the caller deletes it, so a stopped setup leaves nothing behind.
    const made = z.object({ id }).loose().safeParse(answer.body);
    if (error instanceof ChatwootCallError && made.success) throw new ChatwootCallError(error.problem, error.status, made.data.id);
    throw error;
  }
}

export async function readInbox(target: AdminTarget, inboxId: number, deps: OwnerCallDeps): Promise<InboxSecrets> {
  const answer = await chatwootCall(target.origin, { method: "GET", path: `/api/v1/accounts/${target.accountId}/inboxes/${inboxId}`, adminKey: target.adminKey }, deps);
  return inboxSecrets(answer.body);
}

/** Points the inbox back at Zuri, HMAC mandatory (Repair). */
export async function fixInbox(target: AdminTarget, inboxId: number, webhookUrl: string, deps: OwnerCallDeps): Promise<void> {
  await chatwootCall(
    target.origin,
    { method: "PATCH", path: `/api/v1/accounts/${target.accountId}/inboxes/${inboxId}`, adminKey: target.adminKey, body: { channel: { webhook_url: webhookUrl, hmac_mandatory: true } } },
    deps,
  );
}

/** The list sent is the exact list of members (InboxMembersController#update). */
export async function setMembers(target: AdminTarget, inboxId: number, userIds: number[], deps: OwnerCallDeps): Promise<void> {
  await chatwootCall(target.origin, { method: "PATCH", path: `/api/v1/accounts/${target.accountId}/inbox_members`, adminKey: target.adminKey, body: { inbox_id: inboxId, user_ids: userIds } }, deps);
}

export async function members(target: AdminTarget, inboxId: number, deps: OwnerCallDeps): Promise<{ id: number; name: string }[]> {
  const answer = await chatwootCall(target.origin, { method: "GET", path: `/api/v1/accounts/${target.accountId}/inbox_members/${inboxId}`, adminKey: target.adminKey }, deps);
  const body = parsed(z.object({ payload: z.array(agentSchema).max(500) }), answer.body);
  return body.payload.map((agent) => ({ id: agent.id, name: cleanName(agent.name) }));
}

export async function agents(target: AdminTarget, deps: OwnerCallDeps): Promise<{ id: number; name: string; administrator: boolean }[]> {
  const answer = await chatwootCall(target.origin, { method: "GET", path: `/api/v1/accounts/${target.accountId}/agents`, adminKey: target.adminKey }, deps);
  const body = parsed(z.array(agentSchema).max(500), answer.body);
  return body.map((agent) => ({ id: agent.id, name: cleanName(agent.name), administrator: agent.role === "administrator" }));
}

/** New signing secret (`reset_secret` answers the inbox). */
export async function resetSecret(target: AdminTarget, inboxId: number, deps: OwnerCallDeps): Promise<string> {
  const answer = await chatwootCall(target.origin, { method: "POST", path: `/api/v1/accounts/${target.accountId}/inboxes/${inboxId}/reset_secret`, adminKey: target.adminKey }, deps);
  return inboxSecrets(answer.body).secret;
}

/** New HMAC token (`rotate_hmac_token` answers the inbox). */
export async function rotateHmac(target: AdminTarget, inboxId: number, deps: OwnerCallDeps): Promise<string> {
  const answer = await chatwootCall(target.origin, { method: "POST", path: `/api/v1/accounts/${target.accountId}/inboxes/${inboxId}/rotate_hmac_token`, adminKey: target.adminKey }, deps);
  return inboxSecrets(answer.body).hmacToken;
}

/** Undo of a setup that stopped: the inbox and everything in it. */
export async function deleteInbox(target: AdminTarget, inboxId: number, deps: OwnerCallDeps): Promise<void> {
  await chatwootCall(target.origin, { method: "DELETE", path: `/api/v1/accounts/${target.accountId}/inboxes/${inboxId}`, adminKey: target.adminKey }, deps);
}

// ---------- The inbox's public API (no key: the identifier and the contact's HMAC) ----------

export interface PublicAccess {
  origin: string;
  inboxIdentifier: string;
  sourceId: string;
  /** HMAC-SHA256(hmac_token, identifier) in hex: what `hmac_mandatory` asks of every call. */
  identifierHash: string;
}

const segment = (value: string) => encodeURIComponent(value);

/** The contact "Zuri": a random identifier (the Chatwoot looks contacts up by it in the whole account). */
export async function createContact(origin: string, inboxIdentifier: string, identifier: string, identifierHash: string, deps: OwnerCallDeps): Promise<string> {
  const answer = await chatwootCall(
    origin,
    { method: "POST", path: `/public/api/v1/inboxes/${segment(inboxIdentifier)}/contacts`, body: { identifier, identifier_hash: identifierHash, name: "Zuri" } },
    deps,
  );
  return parsed(z.object({ source_id: z.string().min(1).max(200) }).loose(), answer.body).source_id;
}

/** A conversation of the contact; its `id` is the display id the notices carry. */
export async function createConversation(access: PublicAccess, deps: OwnerCallDeps): Promise<number> {
  const answer = await chatwootCall(
    access.origin,
    { method: "POST", path: `/public/api/v1/inboxes/${segment(access.inboxIdentifier)}/contacts/${segment(access.sourceId)}/conversations`, body: { identifier_hash: access.identifierHash } },
    deps,
  );
  return parsed(z.object({ id }).loose(), answer.body).id;
}

/** Zuri writes as the contact: plain text only. */
export async function postMessage(access: PublicAccess, conversationId: number, content: string, deps: OwnerCallDeps): Promise<number> {
  const answer = await chatwootCall(
    access.origin,
    {
      method: "POST",
      path: `/public/api/v1/inboxes/${segment(access.inboxIdentifier)}/contacts/${segment(access.sourceId)}/conversations/${conversationId}/messages`,
      body: { content, identifier_hash: access.identifierHash },
    },
    deps,
  );
  return parsed(z.object({ id }).loose(), answer.body).id;
}

export interface FetchedMessage {
  id: number;
  content: string;
  /** 0 incoming (the contact, Zuri), 1 outgoing (an agent). */
  messageType: number;
  sender: { id: number; type: string; name: string } | null;
}

const messageSchema = z
  .object({
    id,
    content: z.string().max(200_000).nullable().catch(null),
    message_type: z.number().int(),
    sender: z.object({ id, type: z.string().max(40), name: name.optional(), available_name: name.optional() }).loose().nullable().optional(),
  })
  .loose();

/**
 * The message `messageId` as the Chatwoot keeps it: `before=id+1` returns the
 * 20 before it, itself included, without private notes or activity
 * (MessageFinder). Null when it isn't there.
 */
export async function fetchMessage(access: PublicAccess, conversationId: number, messageId: number, deps: OwnerCallDeps): Promise<FetchedMessage | null> {
  const answer = await chatwootCall(
    access.origin,
    {
      method: "GET",
      path: `/public/api/v1/inboxes/${segment(access.inboxIdentifier)}/contacts/${segment(access.sourceId)}/conversations/${conversationId}/messages`,
      query: { before: String(messageId + 1), identifier_hash: access.identifierHash },
    },
    deps,
  );
  const list = parsed(z.array(z.unknown()).max(100), answer.body);
  for (const item of list) {
    const message = messageSchema.safeParse(item);
    if (!message.success || message.data.id !== messageId) continue;
    const sender = message.data.sender;
    return {
      id: message.data.id,
      content: message.data.content ?? "",
      messageType: message.data.message_type,
      sender: sender ? { id: sender.id, type: sender.type, name: cleanName(sender.available_name || sender.name || "") } : null,
    };
  }
  return null;
}

/** The conversation is still there (Test and the recreation). */
export async function conversationExists(access: PublicAccess, conversationId: number, deps: OwnerCallDeps): Promise<boolean> {
  try {
    await chatwootCall(
      access.origin,
      {
        method: "GET",
        path: `/public/api/v1/inboxes/${segment(access.inboxIdentifier)}/contacts/${segment(access.sourceId)}/conversations/${conversationId}`,
        query: { identifier_hash: access.identifierHash },
      },
      deps,
    );
    return true;
  } catch (error) {
    if (error instanceof ChatwootCallError && error.problem === "not_found") return false;
    throw error;
  }
}

/** The inbox exists (its public page answers). */
export async function inboxExists(origin: string, inboxIdentifier: string, deps: OwnerCallDeps): Promise<boolean> {
  try {
    await chatwootCall(origin, { method: "GET", path: `/public/api/v1/inboxes/${segment(inboxIdentifier)}` }, deps);
    return true;
  } catch (error) {
    if (error instanceof ChatwootCallError && error.problem === "not_found") return false;
    throw error;
  }
}

/** A call without the contact's HMAC: with `hmac_mandatory` the Chatwoot refuses it. True when it refused. */
export async function hmacRequired(access: PublicAccess, deps: OwnerCallDeps): Promise<boolean> {
  try {
    await chatwootCall(access.origin, { method: "GET", path: `/public/api/v1/inboxes/${segment(access.inboxIdentifier)}/contacts/${segment(access.sourceId)}/conversations` }, deps);
    return false;
  } catch (error) {
    if (error instanceof ChatwootCallError && error.problem === "refused") return true;
    throw error;
  }
}
