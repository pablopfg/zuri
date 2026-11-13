/**
 * The owner's conversation with Zuri inside the Chatwoot (docs/planos/zuri-no-chatwoot.md,
 * approved 13/11/2026): an API inbox of Zuri's own, where only the owner's
 * agent account gets an answer. The interface uses the types and limits; the
 * schemas run on the server and live in chatwoot-owner-schemas.ts, so this module imports
 * nothing and the page pulls no other part of the package (rule P11).
 */

const MINUTE = 60_000;

export const CHATWOOT_OWNER_LIMITS = {
  /** The link code: 8 characters without 0/O/1/I, 10 minutes, one at a time, kept only as an HMAC. */
  codeLength: 8,
  codeAlphabet: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  codeTtlMs: 10 * MINUTE,
  /** Wrong codes in the conversation that end the code. */
  codeTries: 10,
  /** New codes the owner may ask for in an hour. */
  codesPerHour: 6,
  /** The return's body, as Telegram's. */
  hookBodyMax: 64 * 1024,
  /** How old a signed notice may be. */
  signatureSkewMs: 5 * MINUTE,
  /** Messages and `X-Chatwoot-Delivery` ids remembered, so a notice acts once whatever its delivery says. */
  deliveriesKept: 100,
  /** Messages answered in an hour, as on Telegram (TELEGRAM_LIMITS.chatPerHour); over it, one answer an hour. */
  perHour: 30,
  /** Someone else writing this many times in the window turns the channel off. */
  strangersPause: 3,
  strangersWindowMs: 24 * 60 * MINUTE,
  /** The conversation or the contact made again by Zuri, at most this many times a day. */
  recreatePerDay: 3,
  /** The test waits this long for the signed notice of its message. */
  testWaitMs: 30_000,
  /** Tests and calls with the administrator's key in a minute. */
  testsPerMinute: 5,
  adminCallsPerMinute: 5,
  /** An answer goes in blocks of this many characters, at most this many blocks. */
  replyBlockMax: 4_000,
  replyBlocks: 3,
  /** Last messages the page shows. */
  log: 10,
  /** Administrators the full test names. */
  admins: 20,
  /** A name or e-mail kept from the Chatwoot, cut to this. */
  nameMax: 80,
} as const;

/**
 * code: waiting for the owner to answer the code in the conversation; confirm: the code came, the
 * app confirms the account; on: Zuri answers; paused: Zuri answers nothing (pausedBy says why).
 */
export const CHATWOOT_OWNER_STATES = ["code", "confirm", "on", "paused"] as const;
export type ChatwootOwnerState = (typeof CHATWOOT_OWNER_STATES)[number];

/**
 * owner: the switch; strangers: three messages from someone else in 24 h; signature or hmac: the test
 * found the secrets changed in the Chatwoot; inbox: the inbox is gone or the address moved; recreate:
 * the conversation was made again 3 times today.
 */
export const CHATWOOT_OWNER_PAUSES = ["owner", "strangers", "signature", "hmac", "inbox", "recreate"] as const;
export type ChatwootOwnerPause = (typeof CHATWOOT_OWNER_PAUSES)[number];

/** The pauses the switch alone turns back on; the others need Repair or new secrets. */
export const CHATWOOT_OWNER_SWITCHABLE: readonly ChatwootOwnerPause[] = ["owner", "strangers", "recreate"];

/** The setup's steps, in the prototype's order. */
export const CHATWOOT_OWNER_STEPS = ["key", "inbox", "members", "contact", "code", "discard"] as const;
export type ChatwootOwnerStep = (typeof CHATWOOT_OWNER_STEPS)[number];

/** What the test checks: the first five without a key, the rest with the administrator's key (full test). */
export const CHATWOOT_OWNER_CHECKS = ["reach", "inbox", "hmac", "conversation", "signature", "webhook", "members", "admin", "admins"] as const;
export type ChatwootOwnerCheck = (typeof CHATWOOT_OWNER_CHECKS)[number];

/** Why a call to the Chatwoot stopped, as the screen words it. */
export const CHATWOOT_OWNER_PROBLEMS = [
  "origin",
  "dns",
  "private_address",
  "redirect",
  "timeout",
  "unavailable",
  "too_large",
  "refused",
  "not_admin",
  "not_found",
  "rejected",
  "bad_answer",
  "old_version",
  "calls_limit",
] as const;
export type ChatwootOwnerProblem = (typeof CHATWOOT_OWNER_PROBLEMS)[number];

/** One line of "Últimas mensagens": who wrote, what happened, never the text. */
export const CHATWOOT_OWNER_EVENTS = ["answered", "code", "linked", "stranger", "recreated", "repaired", "rotated", "test", "limit", "long", "lockdown", "locked", "unlocked"] as const;
export type ChatwootOwnerEvent = (typeof CHATWOOT_OWNER_EVENTS)[number];

export interface ChatwootOwnerLogEntry {
  at: string;
  event: ChatwootOwnerEvent;
  ok: boolean;
}

export interface ChatwootOwnerAccount {
  id: number;
  name: string;
  email: string | null;
}

/** GET /api/chatwoot/owner. Nothing secret: no key, no code, no identifier of the inbox. */
export interface ChatwootOwnerStatus {
  configured: boolean;
  /** False without MCP_CREDENTIAL_KEY: nothing can be kept. */
  credentialsAvailable: boolean;
  state: ChatwootOwnerState | null;
  pausedBy: ChatwootOwnerPause | null;
  origin: string | null;
  accountId: number | null;
  inboxId: number | null;
  /** The agent account Zuri answers (after the confirmation). */
  owner: ChatwootOwnerAccount | null;
  /** Who answered the code, waiting for the confirmation. */
  candidate: ChatwootOwnerAccount | null;
  /** The code's end, while one is waiting. */
  codeExpiresAt: string | null;
  since: string | null;
  /** The other administrators the last full test found (they see every inbox). */
  admins: string[] | null;
  /**
   * The read lock, as the bot's (the same hours, Settings › Integrações › Telegram): after them
   * without use, Zuri answers only "destrave no app" until the app opens it again for 12 hours.
   */
  readLock: { locked: boolean; openUntil: string | null; hours: number };
  log: ChatwootOwnerLogEntry[];
}

/** What "Esta conta é você?" shows: the key's owner and whether they administer the account. */
export interface ChatwootOwnerProfile extends ChatwootOwnerAccount {
  administrator: boolean;
}

export interface ChatwootOwnerCheckResult {
  check: ChatwootOwnerCheck;
  ok: boolean;
  /** For "admins": the names; for "members": the names of anyone else in the inbox. */
  names?: string[];
  problem?: ChatwootOwnerProblem;
  ms?: number;
}

export interface ChatwootOwnerTest {
  ok: boolean;
  checks: ChatwootOwnerCheckResult[];
  /** The test paused the channel (the signature or the HMAC). */
  paused: ChatwootOwnerPause | null;
}

/** The answer of setup, a new code and relink: the code, shown once to type in the Chatwoot. */
export interface ChatwootOwnerCode {
  code: string;
  expiresAt: string;
  status: ChatwootOwnerStatus;
}
