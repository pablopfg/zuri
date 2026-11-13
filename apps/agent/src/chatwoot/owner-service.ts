import {
  CHAT_MESSAGE_MAX,
  CHATWOOT_OWNER_LIMITS,
  CHATWOOT_OWNER_SWITCHABLE,
  type ChatwootOwnerAccount,
  type ChatwootOwnerCheck,
  type ChatwootOwnerCheckResult,
  type ChatwootOwnerCode,
  type ChatwootOwnerEvent,
  type ChatwootOwnerLogEntry,
  type ChatwootOwnerPause,
  type ChatwootOwnerProblem,
  type ChatwootOwnerProfile,
  type ChatwootOwnerState,
  type ChatwootOwnerStatus,
  type ChatwootOwnerStep,
  type ChatwootOwnerTest,
  hmacSha256Hex,
  type Locale,
  type MessageKey,
  t,
  TELEGRAM_LIMITS,
  timingSafeEqualText,
} from "@zuri/shared";
import type { AgentRunner } from "../agent/runner.ts";
import { MAX_ACTIVE_TURNS } from "../api/chat.ts";
import type { ConversationRepository } from "../chat/conversations.ts";
import type { InternalState } from "../db/internal-state.ts";
import type { FlowConnections, FlowNetwork, OwnerSecrets } from "../flows/connections.ts";
import { chatwootHookUrl } from "../gates/chatwoot-owner.ts";
import { AppError } from "../http/errors.ts";
import type { SimulatedChatwoot } from "./dev-chatwoot-owner.ts";
import { log } from "../log.ts";
import { disarm } from "../telegram/channel.ts";
import {
  type AdminTarget,
  agents,
  ChatwootCallError,
  conversationExists,
  createContact,
  createConversation,
  createInbox,
  deleteInbox,
  fetchMessage,
  fixInbox,
  hmacRequired,
  inboxExists,
  members,
  type OwnerCallDeps,
  postMessage,
  profile,
  type PublicAccess,
  readInbox,
  resetSecret,
  rotateHmac,
  setMembers,
} from "./owner-client.ts";

const L = CHATWOOT_OWNER_LIMITS;
const STATE_KEY = "chatwoot_owner";
const CONVERSATION_KEY = "chatwoot_conversation";
/** Calls a notice's work may make to the Chatwoot: the read back, the answer's blocks, a recreation, the DNS. */
const NOTICE_CALLS = 12;
/** Calls of a request of the screen (the setup is the longest: 6 calls, the undo and the DNS). */
const ROUTE_CALLS = 16;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The link as it is kept (zur_settings › chatwoot_owner): never a secret, never a message's text. */
interface Link {
  v: 1;
  id: string;
  state: ChatwootOwnerState;
  pausedBy: ChatwootOwnerPause | null;
  origin: string;
  accountId: number;
  inboxId: number;
  conversationId: number;
  owner: ChatwootOwnerAccount | null;
  /** Who must answer the code: the key's owner at the setup; null on "Vincular outra conta" (any agent). */
  expectId: number | null;
  code: { mac: string; expiresAt: string; wrong: number } | null;
  codesAsked: number[];
  candidate: ChatwootOwnerAccount | null;
  since: string | null;
  admins: string[] | null;
  /** The last messages acted on (`m<id>`) and deliveries (`d<id>`): a notice acts once, whatever its delivery says. */
  seen: string[];
  hour: number[];
  /** When "limite da hora" was last said: once an hour, never one answer per message over it. */
  limitSaidAt: number | null;
  /** The read lock (as the bot's): the last use while open, and the app's unlock. */
  lastUsedAt: string | null;
  unlockedUntil: string | null;
  strangers: number[];
  recreated: number[];
  log: ChatwootOwnerLogEntry[];
}

export interface ChatwootOwnerDeps {
  state: InternalState;
  connections: FlowConnections;
  network(): FlowNetwork;
  development(): boolean;
  /** The app's address: the return path is built on it. */
  publicUrl(): URL;
  sessionSecret(): string;
  locale(): Locale;
  lockdown(): boolean;
  runner(): AgentRunner;
  conversations(): ConversationRepository;
  /** The app's and the bot's turns: a conversation answers one turn at a time. */
  activeRuns: Map<string, AbortController>;
  notify(notice: { kind: "chatwoot.stranger" | "chatwoot.recreated" | "chatwoot.paused"; reason?: ChatwootOwnerPause }): void;
  /** Keeps the object awake while a notice's work runs (keepAliveWhile). */
  keepAlive(work: () => Promise<void>): void;
  clock?: () => number;
}

/** What the setup stopped on: the step, the reason, and whether what it had made was undone. */
function stepError(step: ChatwootOwnerStep, error: unknown, undone: boolean): AppError {
  if (error instanceof AppError) return error;
  const problem: ChatwootOwnerProblem = error instanceof ChatwootCallError ? error.problem : "unavailable";
  const code = ["refused", "not_admin", "origin", "private_address", "rejected", "old_version", "not_found", "bad_answer"].includes(problem) ? "VALIDATION_FAILED" : "SERVICE_UNAVAILABLE";
  return new AppError(code, "error.chatwootOwner.step", { step, problem, undone });
}

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** A code of 8 characters without 0/O/1/I, drawn without bias. */
export function linkCode(): string {
  // 32 characters: the low 5 bits of a byte pick one, each equally likely (as the Telegram code).
  return [...crypto.getRandomValues(new Uint8Array(L.codeLength))].map((byte) => L.codeAlphabet[byte & 31]).join("");
}

/** What someone typed, as a code: letters and digits only, upper case. Null when it can't be one. */
export function asCode(text: string): string | null {
  const cleaned = text.normalize("NFKC").replace(/[\s\-.]/g, "").toUpperCase();
  return cleaned.length === L.codeLength && [...cleaned].every((char) => L.codeAlphabet.includes(char)) ? cleaned : null;
}

/**
 * The notice's signature: `sha256=` + HMAC-SHA256(secret, `timestamp.body`), compared in constant
 * time, and the timestamp within 5 minutes of now (lib/webhooks/trigger.rb of the Chatwoot).
 */
export async function validSignature(secret: string, raw: string, signature: string | null, timestamp: string | null, now: number): Promise<boolean> {
  if (!signature || !timestamp || !/^\d{1,12}$/.test(timestamp) || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > L.signatureSkewMs) return false;
  return timingSafeEqualText(signature, `sha256=${await hmacSha256Hex(secret, `${timestamp}.${raw}`)}`);
}

/** Text that goes to the Chatwoot: links, mentions and commands disarmed, cut in blocks. */
export function chatwootBlocks(text: string): string[] {
  const chars = [...disarm(text.trim())];
  const blocks: string[] = [];
  for (let at = 0; at < chars.length && blocks.length < L.replyBlocks; at += L.replyBlockMax) blocks.push(chars.slice(at, at + L.replyBlockMax).join(""));
  return blocks;
}

interface Waiter {
  messageId: number | null;
  /** Incoming notices that came before the message's id was known. */
  early: Set<number>;
  done(result: "ok" | "bad_signature" | "timeout"): void;
}

/**
 * Zuri inside the Chatwoot, for the owner alone (docs/planos/zuri-no-chatwoot.md).
 * Every notice is a doorbell: the signature is checked, the message is read
 * back through the inbox's public API, and only the owner's agent account, in
 * the link's inbox and conversation, gets an answer. The administrator's key
 * lives only inside the request that brought it.
 */
export class ChatwootOwner {
  #queue: Promise<void> = Promise.resolve();
  #turn: Promise<void> | null = null;
  #waiter: Waiter | null = null;
  #settingUp = false;
  #testing = false;
  readonly #adminCalls: number[] = [];
  readonly #tests: number[] = [];
  /** Tests shorten the wait for the test's notice. */
  testWaitMs: number = L.testWaitMs;

  /** Tests that share one object start each case with the minute's counts empty. */
  clearCounts(): void {
    this.#adminCalls.length = 0;
    this.#tests.length = 0;
  }

  constructor(private readonly deps: ChatwootOwnerDeps) {}

  #now(): number {
    return this.deps.clock?.() ?? Date.now();
  }

  #load(): Link | null {
    const raw = this.deps.state.get<unknown>(STATE_KEY);
    if (!raw || typeof raw !== "string") return null;
    try {
      const link = JSON.parse(raw) as Link;
      return link && link.v === 1 && typeof link.id === "string" ? link : null;
    } catch {
      return null;
    }
  }

  #save(link: Link): void {
    this.deps.state.set(STATE_KEY, JSON.stringify(link));
  }

  #event(link: Link, event: ChatwootOwnerEvent, ok: boolean): void {
    link.log = [{ at: new Date(this.#now()).toISOString(), event, ok }, ...link.log].slice(0, L.log);
  }

  /** A request's own count of calls (P9). */
  #callDeps(max: number, signal?: AbortSignal): OwnerCallDeps {
    let used = 0;
    return {
      network: this.deps.network(),
      development: this.deps.development(),
      meter: {
        room: (n) => used + n <= max,
        take: () => {
          if (used >= max) throw new ChatwootCallError("calls_limit");
          used++;
        },
      },
      hosts: new Map(),
      ...(signal ? { signal } : {}),
    };
  }

  /** At most `limit` in the last minute; RATE_LIMITED with the wait otherwise. */
  #take(list: number[], limit: number): void {
    const now = this.#now();
    while (list.length > 0 && now - (list[0] as number) >= 60_000) list.shift();
    if (list.length >= limit) throw new AppError("RATE_LIMITED", undefined, { retryAfter: Math.max(1, Math.ceil((60_000 - (now - (list[0] as number))) / 1000)) });
    list.push(now);
  }

  #require(): Link {
    const link = this.#load();
    if (!link) throw new AppError("NOT_FOUND", "error.chatwootOwner.missing");
    return link;
  }

  async #secrets(): Promise<OwnerSecrets> {
    const row = this.deps.connections.ownerRow();
    const secrets = row ? await this.deps.connections.openOwner(row) : null;
    if (!secrets) throw new AppError("NOT_CONFIGURED", "error.chatwootOwner.sealed");
    return secrets;
  }

  async #access(link: Link, secrets: OwnerSecrets): Promise<PublicAccess> {
    return { origin: link.origin, inboxIdentifier: secrets.inboxIdentifier, sourceId: secrets.sourceId, identifierHash: await hmacSha256Hex(secrets.hmacToken, secrets.identifier) };
  }

  #hookUrl(linkId: string): Promise<string> {
    return chatwootHookUrl(this.deps.publicUrl().origin, this.deps.sessionSecret(), linkId);
  }

  #codeMac(linkId: string, code: string): Promise<string> {
    return hmacSha256Hex(this.deps.sessionSecret(), `zuri:chatwoot-code:v1:${linkId}:${code}`);
  }

  // ---------- What the screen reads ----------

  status(): ChatwootOwnerStatus {
    const link = this.#load();
    const configured = link !== null && this.deps.connections.ownerRow() !== null;
    const codeAlive = link?.code && Date.parse(link.code.expiresAt) > this.#now() ? link.code.expiresAt : null;
    return {
      configured,
      credentialsAvailable: this.deps.connections.ownerAvailable,
      state: configured ? link.state : null,
      pausedBy: configured && link.state === "paused" ? link.pausedBy : null,
      origin: configured ? link.origin : null,
      accountId: configured ? link.accountId : null,
      inboxId: configured ? link.inboxId : null,
      owner: configured ? link.owner : null,
      candidate: configured && link.state === "confirm" ? link.candidate : null,
      codeExpiresAt: configured && link.state === "code" ? codeAlive : null,
      since: configured ? link.since : null,
      admins: configured ? link.admins : null,
      readLock: {
        locked: configured && link.owner !== null ? this.#locked(link) : false,
        openUntil: configured && link.owner !== null ? new Date(this.#openUntil(link)).toISOString() : null,
        hours: this.#lockHours(),
      },
      log: configured ? link.log : [],
    };
  }

  // ---------- The read lock (as the bot's, telegram/read-lock.ts) ----------

  /** The bot's hours without use (Settings › Integrações › Telegram): one rule for both channels. */
  #lockHours(): number {
    const stored = this.deps.state.get<unknown>("bot_read_lock_hours");
    const { min, max } = TELEGRAM_LIMITS.readLockHours;
    return typeof stored === "number" && Number.isInteger(stored) && stored >= min && stored <= max ? stored : TELEGRAM_LIMITS.readLockHours.default;
  }

  /** A use or an unlock from before the last lockdown ended opens nothing after it (SEC-A5-02). */
  #beforeLockdownExit(at: number): boolean {
    const exited = this.deps.state.get<unknown>("lockdown_exited_at");
    const exitedAt = typeof exited === "string" ? Date.parse(exited) : Number.NaN;
    return Number.isFinite(exitedAt) && at <= exitedAt;
  }

  #unlockedUntil(link: Link): number | null {
    const at = link.unlockedUntil ? Date.parse(link.unlockedUntil) : Number.NaN;
    if (!Number.isFinite(at) || this.#beforeLockdownExit(at - TELEGRAM_LIMITS.unlockMs)) return null;
    return at > this.#now() ? at : null;
  }

  /** Locked: no unlock running and more than the hours since the last use (the confirmation, before any). A broken date fails closed. */
  #locked(link: Link): boolean {
    if (this.#unlockedUntil(link) !== null) return false;
    const since = Date.parse(link.lastUsedAt ?? link.since ?? "");
    if (!Number.isFinite(since) || this.#beforeLockdownExit(since)) return true;
    return this.#now() - since > this.#lockHours() * HOUR;
  }

  #openUntil(link: Link): number {
    const since = Date.parse(link.lastUsedAt ?? link.since ?? "");
    const byUse = Number.isFinite(since) && !this.#beforeLockdownExit(since) ? since + this.#lockHours() * HOUR : 0;
    return Math.max(byUse, this.#unlockedUntil(link) ?? 0);
  }

  /** "Destravar por 12 horas", in the app with the password typed recently: reading opens, and it counts as use. */
  unlock(): ChatwootOwnerStatus {
    const link = this.#require();
    if (!link.owner) throw new AppError("CONFLICT", "error.chatwootOwner.state");
    const now = this.#now();
    link.unlockedUntil = new Date(now + TELEGRAM_LIMITS.unlockMs).toISOString();
    link.lastUsedAt = new Date(now).toISOString();
    this.#event(link, "unlocked", true);
    this.#save(link);
    return this.status();
  }

  /** The link kept now, when it is still the one of `id`: every write after a wait on the network starts here. */
  #fresh(id: string): Link | null {
    const link = this.#load();
    return link && link.id === id ? link : null;
  }

  // ---------- Setup (the administrator's key, this request only) ----------

  /** "Esta conta é você?": who owns the key. Refused when they don't administer the account. */
  async check(input: { origin: string; accountId: number; adminKey: string }): Promise<ChatwootOwnerProfile> {
    this.#origin(input.origin);
    this.#take(this.#adminCalls, L.adminCallsPerMinute);
    let who: ChatwootOwnerProfile;
    try {
      who = await profile(input, this.#callDeps(4));
    } catch (error) {
      throw stepError("key", error, false);
    }
    if (!who.administrator) throw new AppError("VALIDATION_FAILED", "error.chatwootOwner.notAdmin", { step: "key", problem: "not_admin", name: who.name, accountId: input.accountId });
    return who;
  }

  #origin(origin: string): void {
    const row = this.deps.connections;
    if (!row.ownerAvailable) throw new AppError("NOT_CONFIGURED", "error.flowCredentialKey");
    // The same rule as every credential: https, public, no port; development also takes this machine.
    const url = (() => {
      try {
        return new URL(origin);
      } catch {
        return null;
      }
    })();
    if (!url || url.origin !== origin) throw new AppError("VALIDATION_FAILED", "error.flowConnectionOrigin", { fields: ["origin"] });
  }

  /**
   * The whole setup, each step in order, undone (the inbox deleted) when one fails: the key's
   * owner checked again, the inbox (HMAC mandatory, quiet), only the owner as member, the contact
   * and the conversation by the public API, the code sent. The key is dropped when this returns.
   */
  async setup(input: { origin: string; accountId: number; adminKey: string; ownerId: number }): Promise<ChatwootOwnerCode> {
    this.#origin(input.origin);
    // One at a time: the object takes another request while this one waits on the network, and two would make two inboxes.
    if (this.#settingUp || (this.#load() && this.deps.connections.ownerRow())) throw new AppError("CONFLICT", "error.chatwootOwner.exists");
    this.#take(this.#adminCalls, L.adminCallsPerMinute);
    this.#settingUp = true;
    try {
      return await this.#setup(input);
    } finally {
      this.#settingUp = false;
    }
  }

  async #setup(input: { origin: string; accountId: number; adminKey: string; ownerId: number }): Promise<ChatwootOwnerCode> {
    const deps = this.#callDeps(ROUTE_CALLS);
    const target: AdminTarget = { origin: input.origin, accountId: input.accountId, adminKey: input.adminKey };
    let who: ChatwootOwnerProfile;
    try {
      who = await profile(target, deps);
    } catch (error) {
      throw stepError("key", error, false);
    }
    if (!who.administrator) throw new AppError("VALIDATION_FAILED", "error.chatwootOwner.notAdmin", { step: "key", problem: "not_admin", name: who.name, accountId: input.accountId });
    // The account confirmed on "Esta conta é você?" must still be the key's: a key swapped in between never links.
    if (who.id !== input.ownerId) throw new AppError("CONFLICT", "error.chatwootOwner.notYou", { step: "key" });
    const linkId = crypto.randomUUID();
    let inboxId: number | null = null;
    let step: ChatwootOwnerStep = "inbox";
    try {
      const inbox = await createInbox(target, await this.#hookUrl(linkId), deps);
      inboxId = inbox.id;
      step = "members";
      await setMembers(target, inbox.id, [who.id], deps);
      step = "contact";
      const identifier = randomHex(16);
      const identifierHash = await hmacSha256Hex(inbox.hmacToken, identifier);
      const sourceId = await createContact(input.origin, inbox.inboxIdentifier, identifier, identifierHash, deps);
      const access: PublicAccess = { origin: input.origin, inboxIdentifier: inbox.inboxIdentifier, sourceId, identifierHash };
      const conversationId = await createConversation(access, deps);
      step = "code";
      await this.deps.connections.saveOwner(linkId, input.origin, { inboxIdentifier: inbox.inboxIdentifier, secret: inbox.secret, hmacToken: inbox.hmacToken, identifier, sourceId });
      const link: Link = {
        v: 1,
        id: linkId,
        state: "code",
        pausedBy: null,
        origin: input.origin,
        accountId: input.accountId,
        inboxId: inbox.id,
        conversationId,
        owner: null,
        expectId: who.id,
        code: null,
        codesAsked: [],
        candidate: { id: who.id, name: who.name, email: who.email },
        since: null,
        admins: null,
        seen: [],
        hour: [],
        limitSaidAt: null,
        lastUsedAt: null,
        unlockedUntil: null,
        strangers: [],
        recreated: [],
        log: [],
      };
      const code = await this.#sendCode(link, access, deps);
      return { ...code, status: this.status() };
    } catch (error) {
      if (inboxId === null && error instanceof ChatwootCallError && error.createdInbox !== null) inboxId = error.createdInbox;
      let undone = inboxId === null;
      if (inboxId !== null) {
        try {
          // A fresh count: the undo must never be refused because the setup used its calls.
          await deleteInbox(target, inboxId, this.#callDeps(4));
          undone = true;
        } catch (undo) {
          log("warn", "chatwoot_owner_undo_failed", { error: undo });
        }
      }
      this.deps.connections.removeOwner();
      this.deps.state.delete(STATE_KEY);
      throw stepError(step, error, undone);
    }
  }

  /** A new code, sent in the conversation and kept as an HMAC; the one before stops working. */
  async #sendCode(link: Link, access: PublicAccess, deps: OwnerCallDeps): Promise<{ code: string; expiresAt: string }> {
    const now = this.#now();
    link.codesAsked = link.codesAsked.filter((at) => now - at < HOUR);
    if (link.codesAsked.length >= L.codesPerHour) throw new AppError("RATE_LIMITED", undefined, { retryAfter: Math.ceil((HOUR - (now - (link.codesAsked[0] as number))) / 1000) });
    const code = linkCode();
    const expiresAt = new Date(now + L.codeTtlMs).toISOString();
    // The code shows only in the app: whoever types it in the conversation proved they hold the app's session.
    // Written here, every administrator of the account would read it (SEC-A5-xx-2).
    teachSimulatedOwner(this.deps.network(), code);
    await postMessage(access, link.conversationId, t(this.deps.locale(), "chatwoot.owner.codeMessage", { minutes: Math.round(L.codeTtlMs / 60_000) }), deps);
    link.codesAsked.push(now);
    link.code = { mac: await this.#codeMac(link.id, code), expiresAt, wrong: 0 };
    link.state = "code";
    this.#save(link);
    return { code, expiresAt };
  }

  /** "Mandar outro código": the same account still expected. */
  async newCode(): Promise<ChatwootOwnerCode> {
    const link = this.#require();
    if (link.state !== "code") throw new AppError("CONFLICT", "error.chatwootOwner.state");
    const access = await this.#access(link, await this.#secrets());
    try {
      const code = await this.#sendCode(link, access, this.#callDeps(4));
      return { ...code, status: this.status() };
    } catch (error) {
      throw stepError("code", error, false);
    }
  }

  /** "Vincular outra conta": nobody is answered until the new account answers a new code and the app confirms. */
  async relink(): Promise<ChatwootOwnerCode> {
    const link = this.#require();
    if (link.state === "paused" && !CHATWOOT_OWNER_SWITCHABLE.includes(link.pausedBy ?? "owner")) throw new AppError("CONFLICT", "error.chatwootOwner.repairFirst");
    const access = await this.#access(link, await this.#secrets());
    link.expectId = null;
    link.candidate = null;
    try {
      const code = await this.#sendCode(link, access, this.#callDeps(4));
      return { ...code, status: this.status() };
    } catch (error) {
      throw stepError("code", error, false);
    }
  }

  /** "Confirmar esta conta": from here on only this agent account is answered. */
  confirm(): ChatwootOwnerStatus {
    const link = this.#require();
    if (link.state !== "confirm" || !link.candidate) throw new AppError("CONFLICT", "error.chatwootOwner.state");
    link.owner = link.candidate;
    link.candidate = null;
    link.expectId = null;
    link.state = "on";
    link.pausedBy = null;
    link.strangers = [];
    link.since = new Date(this.#now()).toISOString();
    // The confirmation is a use: reading starts open, as the bot's after its link.
    link.lastUsedAt = link.since;
    this.#event(link, "linked", true);
    this.#save(link);
    return this.status();
  }

  /** The switch. On only from a pause the switch may lift. */
  setEnabled(enabled: boolean): ChatwootOwnerStatus {
    const link = this.#require();
    if (!enabled) {
      if (link.state === "on") {
        link.state = "paused";
        link.pausedBy = "owner";
        this.#save(link);
      }
      return this.status();
    }
    if (link.state === "on") return this.status();
    if (link.state !== "paused" || !link.owner) throw new AppError("CONFLICT", "error.chatwootOwner.state");
    if (!CHATWOOT_OWNER_SWITCHABLE.includes(link.pausedBy ?? "owner")) throw new AppError("CONFLICT", "error.chatwootOwner.repairFirst");
    link.state = "on";
    link.pausedBy = null;
    link.strangers = [];
    link.recreated = [];
    if (!link.since) link.since = new Date(this.#now()).toISOString();
    this.#save(link);
    return this.status();
  }

  /** "Desligar e esquecer": everything Zuri kept goes; the inbox stays in the Chatwoot. */
  forget(): void {
    this.#require();
    this.deps.connections.removeOwner();
    this.deps.state.delete(STATE_KEY);
    this.#waiter?.done("timeout");
    this.#waiter = null;
  }

  // ---------- Test ----------

  /**
   * The quick test, no key: the Chatwoot answers by https without a redirect, the inbox exists,
   * a call without the contact's HMAC is refused, the conversation is there, and the notice of a
   * test message comes back signed with the kept secret. A changed secret or HMAC pauses the channel.
   */
  async test(): Promise<ChatwootOwnerTest> {
    const link = this.#require();
    return this.#oneTest(async () => {
      this.#take(this.#tests, L.testsPerMinute);
      const checks = await this.#quick(link, await this.#secrets());
      return this.#finishTest(checks);
    });
  }

  /** One test at a time: a second one (another tab, new secrets) would end the first's wait and read it as a failure. */
  async #oneTest<T>(run: () => Promise<T>): Promise<T> {
    if (this.#testing) throw new AppError("CONFLICT", "error.chatwootOwner.testing");
    this.#testing = true;
    try {
      return await run();
    } finally {
      this.#testing = false;
    }
  }

  /** The full test: the quick one, then, with the key of this request, the return, members and administrators. */
  async fullTest(adminKey: string): Promise<ChatwootOwnerTest> {
    const link = this.#require();
    return this.#oneTest(() => this.#fullTest(link, adminKey));
  }

  async #fullTest(link: Link, adminKey: string): Promise<ChatwootOwnerTest> {
    this.#take(this.#tests, L.testsPerMinute);
    this.#take(this.#adminCalls, L.adminCallsPerMinute);
    const checks = await this.#quick(link, await this.#secrets());
    const target: AdminTarget = { origin: link.origin, accountId: link.accountId, adminKey };
    const deps = this.#callDeps(ROUTE_CALLS);
    const timed = async (check: ChatwootOwnerCheck, run: () => Promise<Omit<ChatwootOwnerCheckResult, "check" | "ms">>) => {
      const at = this.#now();
      try {
        checks.push({ check, ...(await run()), ms: Math.max(0, this.#now() - at) });
      } catch (error) {
        checks.push({ check, ok: false, problem: error instanceof ChatwootCallError ? error.problem : "unavailable" });
      }
    };
    await timed("webhook", async () => {
      const inbox = await readInbox(target, link.inboxId, deps);
      return { ok: inbox.webhookUrl === (await this.#hookUrl(link.id)) && inbox.hmacMandatory };
    });
    const ownerId = link.owner?.id ?? link.expectId;
    await timed("members", async () => {
      const list = await members(target, link.inboxId, deps);
      const others = list.filter((member) => member.id !== ownerId);
      return { ok: others.length === 0 && list.some((member) => member.id === ownerId), names: others.map((member) => member.name).slice(0, L.admins) };
    });
    let admins: string[] | null = null;
    await timed("admin", async () => {
      const list = await agents(target, deps);
      admins = list.filter((agent) => agent.administrator && agent.id !== ownerId).map((agent) => agent.name).slice(0, L.admins);
      return { ok: list.some((agent) => agent.id === ownerId && agent.administrator) };
    });
    if (admins !== null) {
      const names: string[] = admins;
      // Other administrators see every inbox: named, never a failure (the owner can't change that here).
      checks.push({ check: "admins", ok: true, names });
      const fresh = this.#load();
      if (fresh && fresh.id === link.id) {
        fresh.admins = names;
        this.#save(fresh);
      }
    }
    return this.#finishTest(checks);
  }

  #finishTest(checks: ChatwootOwnerCheckResult[]): ChatwootOwnerTest {
    const link = this.#load();
    let paused: ChatwootOwnerPause | null = null;
    const failed = (check: ChatwootOwnerCheck) => checks.some((entry) => entry.check === check && !entry.ok && entry.problem === undefined);
    if (failed("signature")) paused = "signature";
    else if (failed("hmac")) paused = "hmac";
    else if (checks.some((entry) => entry.check === "inbox" && !entry.ok && entry.problem === "not_found")) paused = "inbox";
    if (link) {
      if (paused && (link.state === "on" || link.state === "paused")) {
        link.state = "paused";
        link.pausedBy = paused;
      }
      this.#event(link, "test", checks.every((entry) => entry.ok));
      this.#save(link);
    }
    return { ok: checks.every((entry) => entry.ok), checks, paused };
  }

  async #quick(link: Link, secrets: OwnerSecrets): Promise<ChatwootOwnerCheckResult[]> {
    const deps = this.#callDeps(ROUTE_CALLS);
    const access = await this.#access(link, secrets);
    const checks: ChatwootOwnerCheckResult[] = [];
    const run = async (check: ChatwootOwnerCheck, work: () => Promise<boolean>): Promise<boolean> => {
      const at = this.#now();
      try {
        const ok = await work();
        checks.push({ check, ok, ms: Math.max(0, this.#now() - at) });
        return ok;
      } catch (error) {
        checks.push({ check, ok: false, problem: error instanceof ChatwootCallError ? error.problem : "unavailable" });
        return false;
      }
    };
    // Reaching it at all is the first check; the inbox's public page answers 404 when it is gone.
    let exists = false;
    const reached = await run("reach", async () => {
      exists = await inboxExists(link.origin, secrets.inboxIdentifier, deps);
      return true;
    });
    if (!reached) return checks;
    checks.push(exists ? { check: "inbox", ok: true } : { check: "inbox", ok: false, problem: "not_found" });
    if (!exists) return checks;
    await run("hmac", () => hmacRequired(access, deps));
    const there = await run("conversation", () => conversationExists(access, link.conversationId, deps));
    if (!there) return checks;
    await run("signature", () => this.#signedEcho(link, access, deps));
    return checks;
  }

  /** Sends "Teste da configuração" and waits for its notice, signed with the kept secret. */
  async #signedEcho(link: Link, access: PublicAccess, deps: OwnerCallDeps): Promise<boolean> {
    let resolve: (result: "ok" | "bad_signature" | "timeout") => void = () => undefined;
    const outcome = new Promise<"ok" | "bad_signature" | "timeout">((done) => {
      resolve = done;
    });
    const waiter: Waiter = { messageId: null, early: new Set(), done: (result) => resolve(result) };
    this.#waiter = waiter;
    const deadline = AbortSignal.timeout(this.testWaitMs);
    const onTimeout = () => resolve("timeout");
    deadline.addEventListener("abort", onTimeout, { once: true });
    try {
      const id = await postMessage(access, link.conversationId, t(this.deps.locale(), "chatwoot.owner.test"), deps);
      waiter.messageId = id;
      if (waiter.early.has(id)) resolve("ok");
      const result = await outcome;
      // No notice in time: the Chatwoot may be slow or the address moved (Repair); never read as changed secrets.
      if (result === "timeout") throw new ChatwootCallError("timeout");
      return result === "ok";
    } finally {
      deadline.removeEventListener("abort", onTimeout);
      if (this.#waiter === waiter) this.#waiter = null;
    }
  }

  // ---------- Repair and new secrets (the administrator's key, this request only) ----------

  /**
   * New signing secret and HMAC token in the Chatwoot, kept sealed; the old ones stop working at
   * once. The contact's identifier stays, its hash changes with the token. Then the quick test.
   */
  async rotate(adminKey: string): Promise<ChatwootOwnerTest> {
    const link = this.#require();
    this.#take(this.#adminCalls, L.adminCallsPerMinute);
    const secrets = await this.#secrets();
    const target: AdminTarget = { origin: link.origin, accountId: link.accountId, adminKey };
    const deps = this.#callDeps(ROUTE_CALLS);
    if (this.#testing) throw new AppError("CONFLICT", "error.chatwootOwner.testing");
    let kept: OwnerSecrets = secrets;
    try {
      // Each new secret is kept as soon as the Chatwoot made it: one that stops in between never leaves the old one kept.
      kept = { ...kept, secret: await resetSecret(target, link.inboxId, deps) };
      await this.deps.connections.saveOwner(link.id, link.origin, kept);
      kept = { ...kept, hmacToken: await rotateHmac(target, link.inboxId, deps) };
      await this.deps.connections.saveOwner(link.id, link.origin, kept);
    } catch (error) {
      throw stepError("inbox", error, false);
    }
    const fresh = this.#require();
    if (fresh.state === "paused" && (fresh.pausedBy === "signature" || fresh.pausedBy === "hmac") && fresh.owner) {
      fresh.state = "on";
      fresh.pausedBy = null;
    }
    this.#event(fresh, "rotated", true);
    this.#save(fresh);
    return this.test();
  }

  /**
   * "Reparar": with the key, the inbox is checked and only what is missing is made again: a gone
   * inbox is created again (members, contact, conversation); one that exists gets Zuri's return,
   * the HMAC mandatory, only the owner as member, and its secrets read again. A new address of the
   * Chatwoot comes with it. The owner's account doesn't change.
   */
  async repair(input: { adminKey: string; origin?: string | undefined }): Promise<ChatwootOwnerStatus> {
    const link = this.#require();
    const origin = input.origin ?? link.origin;
    this.#origin(origin);
    this.#take(this.#adminCalls, L.adminCallsPerMinute);
    const secrets = await this.#secretsOrNull();
    const target: AdminTarget = { origin, accountId: link.accountId, adminKey: input.adminKey };
    const deps = this.#callDeps(ROUTE_CALLS);
    const hookUrl = await this.#hookUrl(link.id);
    const ownerId = link.owner?.id ?? link.expectId;
    if (ownerId === null) throw new AppError("CONFLICT", "error.chatwootOwner.state");
    let step: ChatwootOwnerStep = "inbox";
    let created: number | null = null;
    try {
      let inbox: Awaited<ReturnType<typeof readInbox>> | null = null;
      try {
        inbox = await readInbox(target, link.inboxId, deps);
      } catch (error) {
        if (!(error instanceof ChatwootCallError && error.problem === "not_found")) throw error;
      }
      if (inbox) {
        await fixInbox(target, inbox.id, hookUrl, deps);
      } else {
        inbox = await createInbox(target, hookUrl, deps);
        created = inbox.id;
      }
      step = "members";
      await setMembers(target, inbox.id, [ownerId], deps);
      step = "contact";
      let identifier = secrets?.identifier ?? randomHex(16);
      let sourceId = created === null ? (secrets?.sourceId ?? null) : null;
      let access: PublicAccess | null = sourceId ? { origin, inboxIdentifier: inbox.inboxIdentifier, sourceId, identifierHash: await hmacSha256Hex(inbox.hmacToken, identifier) } : null;
      let conversationId = link.conversationId;
      const alive = access && created === null ? await conversationExists(access, conversationId, deps).catch((error: unknown) => {
        if (error instanceof ChatwootCallError && (error.problem === "not_found" || error.problem === "refused")) return false;
        throw error;
      }) : false;
      if (!alive) {
        identifier = randomHex(16);
        const identifierHash = await hmacSha256Hex(inbox.hmacToken, identifier);
        sourceId = await createContact(origin, inbox.inboxIdentifier, identifier, identifierHash, deps);
        access = { origin, inboxIdentifier: inbox.inboxIdentifier, sourceId, identifierHash };
        conversationId = await createConversation(access, deps);
      }
      await this.deps.connections.saveOwner(link.id, origin, { inboxIdentifier: inbox.inboxIdentifier, secret: inbox.secret, hmacToken: inbox.hmacToken, identifier, sourceId: sourceId as string });
      const fresh = this.#require();
      fresh.origin = origin;
      fresh.inboxId = inbox.id;
      fresh.conversationId = conversationId;
      fresh.recreated = [];
      fresh.strangers = [];
      if (fresh.state === "paused" && fresh.owner) {
        fresh.state = "on";
        fresh.pausedBy = null;
      }
      this.#event(fresh, "repaired", true);
      this.#save(fresh);
      return this.status();
    } catch (error) {
      if (created === null && error instanceof ChatwootCallError && error.createdInbox !== null) created = error.createdInbox;
      let undone = created === null;
      if (created !== null) {
        try {
          await deleteInbox(target, created, this.#callDeps(4));
          undone = true;
        } catch (undo) {
          log("warn", "chatwoot_owner_undo_failed", { error: undo });
        }
      }
      throw stepError(step, error, undone);
    }
  }

  async #secretsOrNull(): Promise<OwnerSecrets | null> {
    const row = this.deps.connections.ownerRow();
    return row ? this.deps.connections.openOwner(row) : null;
  }

  // ---------- The return (the notices of the inbox) ----------

  /**
   * A notice that passed the Worker's gate (the path's token, the size). Checked here: the link, the
   * signature with the inbox's secret, the event, the inbox and the conversation, the delivery seen
   * once. The answer is at once (the Chatwoot waits 5 s and never repeats); the work runs after.
   */
  async receive(linkId: string, raw: string, headers: { signature: string | null; timestamp: string | null; delivery: string | null }): Promise<number> {
    const link = this.#load();
    if (!link || link.id !== linkId) return 200;
    // Read before anything is opened: only its shape, nothing is acted on before the signature.
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      // Not JSON: checked below all the same, then dropped.
    }
    const messageId = body && typeof body.id === "number" && Number.isSafeInteger(body.id) && body.id > 0 ? body.id : null;
    // Zuri's own messages come back too; with no test waiting, nothing to open or check (P4).
    if (body?.message_type === "incoming" && !this.#waiter) return 200;
    const secrets = await this.#secretsOrNull();
    if (!secrets) return 200;
    if (!(await validSignature(secrets.secret, raw, headers.signature, headers.timestamp, this.#now()))) {
      // Only the notice of the test's own message ends the test as a changed secret: any other forged one
      // changes nothing (SEC-A5-xx-4).
      if (this.#waiter && messageId !== null && this.#waiter.messageId === messageId) this.#waiter.done("bad_signature");
      return 401;
    }
    if (!body || body.event !== "message_created") return 200;
    const inbox = body.inbox && typeof body.inbox === "object" ? (body.inbox as Record<string, unknown>) : {};
    const conversation = body.conversation && typeof body.conversation === "object" ? (body.conversation as Record<string, unknown>) : {};
    if (inbox.id !== link.inboxId || messageId === null) return 200;
    if (body.message_type === "incoming") {
      if (conversation.id === link.conversationId && this.#waiter) {
        if (this.#waiter.messageId === messageId) this.#waiter.done("ok");
        else this.#waiter.early.add(messageId);
      }
      return 200;
    }
    if (body.message_type !== "outgoing" || body.private !== false) return 200;
    // Once per message, whatever the delivery says: the delivery isn't signed, the message's id is (SEC-A5-xx-3).
    const fresh = this.#fresh(linkId);
    if (!fresh) return 200;
    const delivery = headers.delivery && /^[A-Za-z0-9-]{1,100}$/.test(headers.delivery) ? `d${headers.delivery}` : null;
    const message = `m${messageId}`;
    if (fresh.seen.includes(message) || (delivery && fresh.seen.includes(delivery))) return 200;
    fresh.seen = [message, ...(delivery ? [delivery] : []), ...fresh.seen].slice(0, L.deliveriesKept);
    this.#save(fresh);
    const sameConversation = conversation.id === fresh.conversationId;
    this.#enqueue(() => (sameConversation ? this.#handle(linkId, messageId) : this.#elsewhere(linkId)));
    return 200;
  }

  #enqueue(work: () => Promise<void>): void {
    const next = this.#queue.then(work).catch((error: unknown) => log("error", "chatwoot_owner_failed", { error }));
    this.#queue = next;
    this.deps.keepAlive(() => next);
  }

  /** Tests: resolves when the queued work (and the turn it started) ended. */
  async settled(): Promise<void> {
    await this.#queue;
    await this.#turn;
  }

  /**
   * A message in another conversation of the inbox: the link's conversation may be gone (deleted
   * in the Chatwoot). Checked once; when it is, a new one is opened from the same contact.
   */
  async #elsewhere(linkId: string): Promise<void> {
    // The lockdown: the channel is mute, nothing is made or sent.
    if (this.deps.lockdown()) return;
    const link = this.#load();
    if (!link || link.id !== linkId || link.state === "paused") return;
    const secrets = await this.#secretsOrNull();
    if (!secrets) return;
    const deps = this.#callDeps(NOTICE_CALLS);
    const access = await this.#access(link, secrets);
    try {
      if (await conversationExists(access, link.conversationId, deps)) return;
    } catch (error) {
      if (!(error instanceof ChatwootCallError && error.problem === "not_found")) return;
    }
    const fresh = this.#fresh(linkId);
    if (!fresh || fresh.state === "paused" || this.deps.lockdown()) return;
    await this.#recreate(fresh, secrets, deps);
  }

  /** The conversation (or the contact) made again, at most 3 times a day; a gone inbox pauses for Repair. */
  async #recreate(link: Link, secrets: OwnerSecrets, deps: OwnerCallDeps): Promise<PublicAccess | null> {
    const now = this.#now();
    if (link.recreated.filter((at) => now - at < DAY).length >= L.recreatePerDay) {
      this.#pause(link, "recreate");
      return null;
    }
    let access = await this.#access(link, secrets);
    let kept = secrets;
    try {
      let conversationId: number;
      try {
        conversationId = await createConversation(access, deps);
      } catch (error) {
        if (!(error instanceof ChatwootCallError && (error.problem === "not_found" || error.problem === "refused"))) throw error;
        // The contact is gone too: a new one, with a new identifier and its hash.
        const identifier = randomHex(16);
        const identifierHash = await hmacSha256Hex(secrets.hmacToken, identifier);
        const sourceId = await createContact(link.origin, secrets.inboxIdentifier, identifier, identifierHash, deps);
        kept = { ...secrets, identifier, sourceId };
        access = { ...access, sourceId, identifierHash };
        conversationId = await createConversation(access, deps);
        await this.deps.connections.saveOwner(link.id, link.origin, kept);
      }
      // Kept on the link as it is now: switched off or forgotten meanwhile stays so.
      const fresh = this.#fresh(link.id);
      if (!fresh) return null;
      fresh.conversationId = conversationId;
      fresh.recreated = [...fresh.recreated.filter((at) => now - at < DAY), now];
      this.#event(fresh, "recreated", true);
      this.#save(fresh);
      link.conversationId = conversationId;
      this.deps.notify({ kind: "chatwoot.recreated" });
      await postMessage(access, conversationId, t(this.deps.locale(), "chatwoot.owner.recreated"), deps).catch(() => undefined);
      return access;
    } catch (error) {
      if (error instanceof ChatwootCallError && error.problem === "not_found") this.#pause(link, "inbox");
      else log("warn", "chatwoot_owner_failed", { error });
      return null;
    }
  }

  #pause(link: Link, reason: ChatwootOwnerPause): void {
    link.state = "paused";
    link.pausedBy = reason;
    const fresh = this.#fresh(link.id);
    if (!fresh) return;
    fresh.state = "paused";
    fresh.pausedBy = reason;
    this.#save(fresh);
    this.deps.notify({ kind: "chatwoot.paused", reason });
  }

  /** A message in the link's conversation: read back, then by the link's state. */
  async #handle(linkId: string, messageId: number): Promise<void> {
    const before = this.#load();
    if (!before || before.id !== linkId || before.state === "paused") return;
    // The lockdown: the channel is mute in every state; nothing is read back, answered or sent.
    if (this.deps.lockdown()) {
      if (before.state === "on") {
        this.#event(before, "lockdown", false);
        this.#save(before);
      }
      return;
    }
    const secrets = await this.#secretsOrNull();
    if (!secrets) return;
    const deps = this.#callDeps(NOTICE_CALLS);
    const access = await this.#access(before, secrets);
    let message: Awaited<ReturnType<typeof fetchMessage>>;
    try {
      message = await fetchMessage(access, before.conversationId, messageId, deps);
    } catch (error) {
      const fresh = this.#fresh(linkId);
      if (!fresh || fresh.state === "paused" || this.deps.lockdown()) return;
      if (error instanceof ChatwootCallError && error.problem === "not_found") await this.#recreate(fresh, secrets, deps);
      // Zuri's own call refused: the contact's HMAC token changed in the Chatwoot. Nobody can forge this answer.
      else if (error instanceof ChatwootCallError && error.problem === "refused") this.#pause(fresh, "hmac");
      else log("warn", "chatwoot_owner_failed", { error });
      return;
    }
    // From here on, the link as it is now: the switch or "esquecer" may have come while the Chatwoot answered.
    const link = this.#fresh(linkId);
    if (!link || link.state === "paused" || link.state !== before.state || this.deps.lockdown()) return;
    // Only what the Chatwoot answered counts: the notice's own body was never used.
    if (!message || message.messageType !== 1 || message.sender?.type !== "user") return;
    const sender = message.sender;
    if (link.state === "code") return this.#codeAnswer(link, access, deps, sender, message.content);
    if (link.state === "confirm") {
      if (link.candidate && sender.id !== link.candidate.id) this.#stranger(link);
      return;
    }
    if (!link.owner || sender.id !== link.owner.id) return this.#stranger(link);
    await this.#ownerMessage(link, access, deps, message.content);
  }

  async #codeAnswer(link: Link, access: PublicAccess, deps: OwnerCallDeps, sender: { id: number; name: string }, content: string): Promise<void> {
    if (link.expectId !== null && sender.id !== link.expectId) return this.#stranger(link);
    const code = link.code;
    if (!code || Date.parse(code.expiresAt) <= this.#now()) return;
    const typed = asCode(content);
    const right = typed !== null && timingSafeEqualText(await this.#codeMac(link.id, typed), code.mac);
    // The code may have changed while its HMAC was made (a new one asked in the app): judged on the one kept now.
    const current = this.#fresh(link.id);
    if (!current?.code || current.state !== "code" || current.code.mac !== code.mac) return;
    if (!right) {
      current.code.wrong += 1;
      // 10 wrong tries end the code: the owner asks for another in the app.
      if (current.code.wrong >= L.codeTries) current.code = null;
      this.#event(current, "code", false);
      this.#save(current);
      return;
    }
    current.code = null;
    current.state = "confirm";
    current.candidate = { id: sender.id, name: sender.name, email: current.candidate?.id === sender.id ? current.candidate.email : null };
    this.#event(current, "code", true);
    this.#save(current);
    await postMessage(access, current.conversationId, t(this.deps.locale(), "chatwoot.owner.codeReceived"), deps).catch(() => undefined);
  }

  /** Someone who isn't the owner wrote: no answer, a notice without the text; 3 in 24 h turn the channel off. */
  #stranger(link: Link): void {
    const now = this.#now();
    link.strangers = [...link.strangers.filter((at) => now - at < L.strangersWindowMs), now];
    this.#event(link, "stranger", false);
    this.#save(link);
    this.deps.notify({ kind: "chatwoot.stranger" });
    if (link.strangers.length >= L.strangersPause && link.state !== "paused") this.#pause(link, "strangers");
  }

  async #ownerMessage(link: Link, access: PublicAccess, deps: OwnerCallDeps, content: string): Promise<void> {
    const locale = this.deps.locale();
    const say = (key: MessageKey, params?: Record<string, string | number>) => this.#send(link, access, deps, [t(locale, key, params)]);
    // The lockdown: nothing goes out, and the message never reaches the agent.
    if (this.deps.lockdown()) {
      this.#event(link, "lockdown", false);
      this.#save(link);
      return;
    }
    const text = content.trim();
    if (!text) return;
    const now = this.#now();
    link.hour = link.hour.filter((at) => now - at < HOUR);
    if (link.hour.length >= L.perHour) {
      this.#event(link, "limit", false);
      // Said once an hour: never one answer for each message over the limit.
      const tell = link.limitSaidAt === null || now - link.limitSaidAt >= HOUR;
      if (tell) link.limitSaidAt = now;
      this.#save(link);
      if (tell) await say("chatwoot.owner.limit", { n: L.perHour });
      return;
    }
    link.hour.push(now);
    // The read lock (SEC-A5-xx-1): whoever took the agent account must not read everything; only the app opens it.
    if (this.#locked(link)) {
      this.#event(link, "locked", false);
      this.#save(link);
      await say("chatwoot.owner.locked", { hours: this.#lockHours(), link: new URL("/configuracoes/chatwoot", this.deps.publicUrl().origin).href });
      return;
    }
    if ([...text].length > CHAT_MESSAGE_MAX) {
      this.#event(link, "long", false);
      this.#save(link);
      await say("chatwoot.owner.long", { n: CHAT_MESSAGE_MAX });
      return;
    }
    if (this.#turn) {
      this.#save(link);
      await say("chatwoot.owner.busy");
      return;
    }
    // Used while open: the lock's hours count from here.
    link.lastUsedAt = new Date(now).toISOString();
    this.#save(link);
    // The turn goes on after this notice's work: the next notice is read while the answer is written.
    const turn = this.#answer(link.id, access, deps, text)
      .catch((error: unknown) => log("error", "chatwoot_owner_failed", { error }))
      .finally(() => {
        this.#turn = null;
      });
    this.#turn = turn;
    this.deps.keepAlive(() => turn);
  }

  async #answer(linkId: string, access: PublicAccess, deps: OwnerCallDeps, text: string): Promise<void> {
    const locale = this.deps.locale();
    const conversations = this.deps.conversations();
    const conversationId = this.#conversationId(conversations);
    const link = () => this.#load();
    const current = link();
    if (!current || current.id !== linkId) return;
    if (conversationId === null) {
      await this.#send(current, access, deps, [t(locale, "chatwoot.owner.failed")]);
      return;
    }
    const runs = this.deps.activeRuns;
    if (runs.has(conversationId) || runs.size >= MAX_ACTIVE_TURNS) {
      await this.#send(current, access, deps, [t(locale, "chatwoot.owner.busy")]);
      return;
    }
    const controller = new AbortController();
    // The bot's deadline (P5: no timer of our own); the app's "parar" aborts the controller.
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TELEGRAM_LIMITS.turnTimeoutMs)]);
    runs.set(conversationId, controller);
    let answer = "";
    let errorText: string | null = null;
    let proposals = false;
    let cancelled = false;
    try {
      for await (const event of this.deps.runner().chat({ conversationId, message: text, signal, source: "chatwoot" })) {
        if (event.type === "text") answer += event.delta;
        else if (event.type === "approval" || event.type === "plan") proposals = true;
        else if (event.type === "error") errorText = event.message;
        else if (event.type === "done") cancelled = event.message.status === "cancelled";
      }
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError("INTERNAL_ERROR");
      if (!(error instanceof AppError)) log("error", "chatwoot_owner_failed", { error });
      errorText = t(locale, appError.messageKey);
    } finally {
      if (runs.get(conversationId) === controller) runs.delete(conversationId);
    }
    const after = link();
    // Switched off, forgotten or locked while the agent wrote: nothing goes out.
    if (!after || after.id !== linkId || after.state !== "on" || this.deps.lockdown()) return;
    const blocks = answer.trim() ? chatwootBlocks(answer) : [];
    const appLink = new URL(`/conversa/${conversationId}`, this.deps.publicUrl().origin).href;
    if ([...disarm(answer.trim())].length > L.replyBlockMax * L.replyBlocks) blocks.push(t(locale, "chatwoot.owner.truncated", { link: appLink }));
    const timedOut = !controller.signal.aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
    if (cancelled) blocks.push(t(locale, timedOut ? "chatwoot.owner.timeout" : "chatwoot.owner.stopped"));
    else if (errorText) blocks.push(disarm(errorText));
    else if (blocks.length === 0 && !proposals) blocks.push(t(locale, "chatwoot.owner.failed"));
    // What needs approval is approved in the app or on Telegram, never here; the app's own address is the one link.
    if (proposals) blocks.push(t(locale, "chatwoot.owner.pending", { link: appLink }));
    this.#event(after, "answered", true);
    this.#save(after);
    await this.#send(after, access, deps, blocks);
  }

  /** The bot's own app conversation: the one in use, or a new one named "Chatwoot". */
  #conversationId(conversations: ConversationRepository): string | null {
    const stored = this.deps.state.get<unknown>(CONVERSATION_KEY);
    if (typeof stored === "string") {
      try {
        conversations.get(stored);
        return stored;
      } catch {
        // Deleted in the app: a new one below.
      }
    }
    try {
      const created = conversations.create("Chatwoot");
      this.deps.state.set(CONVERSATION_KEY, created.id);
      return created.id;
    } catch (error) {
      if (!(error instanceof AppError)) log("error", "chatwoot_owner_failed", { error });
      return null;
    }
  }

  /** The blocks in the link's conversation; a gone conversation is made again once and the rest goes there. */
  async #send(link: Link, access: PublicAccess, deps: OwnerCallDeps, blocks: string[]): Promise<void> {
    let target = access;
    for (const block of blocks) {
      try {
        await postMessage(target, link.conversationId, block, deps);
      } catch (error) {
        if (!(error instanceof ChatwootCallError && error.problem === "not_found")) {
          log("warn", "chatwoot_owner_failed", { error });
          return;
        }
        const secrets = await this.#secretsOrNull();
        const again = secrets ? await this.#recreate(link, secrets, deps) : null;
        if (!again) return;
        target = again;
        try {
          await postMessage(target, link.conversationId, block, deps);
        } catch (retry) {
          log("warn", "chatwoot_owner_failed", { error: retry });
          return;
        }
      }
    }
  }
}

/** Local development and the tests only: the simulated owner reads the code as the owner would, in the app. */
function teachSimulatedOwner(network: FlowNetwork, code: string): void {
  if ("sim" in network) (network as SimulatedChatwoot).sim.code = code;
}
