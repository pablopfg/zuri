// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";

/**
 * The patient's confirmation link (E7a, docs/planos/link-de-confirmacao.md): /c/<token>, one per
 * appointment, opened without signing in. The token is 128 random bits in 22 base64url characters;
 * the server finds the appointment by its SHA-256 only.
 */
export const CONFIRM_LINK_LIMITS = {
  tokenLength: 22,
  /** The link stops an hour before the start. */
  expireBeforeMs: 3_600_000,
  /** Cancelling by the link: up to 12 hours before, and never on the day itself. */
  cancelBeforeMs: 12 * 3_600_000,
  /** Per network, in each window: pages opened, answers, and unknown tokens before an hour's block. */
  windowMs: 10 * 60_000,
  viewsPerWindow: 30,
  answersPerWindow: 10,
  invalidPerWindow: 3,
  blockMs: 3_600_000,
  /** Answers that change something, per link and day. */
  answersPerDay: 10,
  /** Rescheduling by the link (E7b): from tomorrow up to 8 days ahead, twice per appointment, on the hour. */
  rescheduleDays: 8,
  reschedulesMax: 2,
  rescheduleStep: 60,
  /** What the last step offers: up to 3 slots next to an appointment, else 2. */
  offerNext: 3,
  offerOther: 2,
} as const;

export const CONFIRM_LINK_PREFIX = "/c/";

/** Exactly 22 characters of base64url: nothing else is ever looked up. */
export const CONFIRM_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** The token of /c/<token>, or null for any other path (a trailing slash or a path past it included). */
export function confirmLinkToken(pathname: string): string | null {
  if (!pathname.startsWith(CONFIRM_LINK_PREFIX)) return null;
  const token = pathname.slice(CONFIRM_LINK_PREFIX.length);
  return CONFIRM_TOKEN.test(token) ? token : null;
}

export const CONFIRM_ACTIONS = ["confirm", "cancel"] as const;
export type ConfirmAction = (typeof CONFIRM_ACTIONS)[number];

/** POST /api/c/view: the page of a link. The token is checked for its shape inside, so a wrong one is the same "not found" as an unknown one. */
export const confirmViewSchema = /* @__PURE__ */ z.object({ token: z.string().max(64) }).strict();
/** POST /api/c/answer: the patient's tap. */
export const confirmAnswerSchema = /* @__PURE__ */ z.object({ token: z.string().max(64), action: z.enum(CONFIRM_ACTIONS) }).strict();

/** The two halves of the day the patient picks from: the lunch break splits them (noon without one). */
export const RESCHEDULE_TURNS = ["morning", "afternoon"] as const;
export type RescheduleTurn = (typeof RESCHEDULE_TURNS)[number];

const day = /* @__PURE__ */ z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minute = /* @__PURE__ */ z.number().int().min(0).max(1_439);
/** POST /api/c/days: the days with a free hour. */
export const rescheduleDaysSchema = confirmViewSchema;
/** POST /api/c/offer: the slots of a day's half, near the hour the patient prefers. */
export const rescheduleOfferSchema = /* @__PURE__ */ z.object({ token: z.string().max(64), day, turn: z.enum(RESCHEDULE_TURNS), pref: minute }).strict();
/** POST /api/c/reschedule: one of the offered slots. */
export const rescheduleSchema = /* @__PURE__ */ z.object({ token: z.string().max(64), day, turn: z.enum(RESCHEDULE_TURNS), pref: minute, start: minute }).strict();

/** A half of a day with a free hour: its window and the hours of step 3, in minutes of the owner's clock. */
export interface RescheduleTurnView {
  turn: RescheduleTurn;
  from: number;
  to: number;
  hours: number[];
}

/** Step 1 and 2: only the days and halves with a free hour, never what fills the others. */
export interface RescheduleDays {
  /** The appointment's length, in minutes. */
  length: number;
  days: { day: string; turns: RescheduleTurnView[] }[];
}

/** Step 4: the slots offered, as minutes of the day. */
export interface RescheduleOffer {
  slots: number[];
}

/** What the page shows: `cancelled` only right after cancelling; opened again, it is `expired`. */
export const CONFIRM_STATES = ["open", "confirmed", "rescheduled", "cancelled", "expired"] as const;
export type ConfirmState = (typeof CONFIRM_STATES)[number];

/**
 * The page of a link: only the first name, the day, the time, the type and the place, never a phone,
 * an e-mail, the full name, a note or a payment. Times are ISO instants; `zone` is the owner's.
 */
export interface ConfirmView {
  state: ConfirmState;
  clinic: string;
  first: string;
  start: string;
  end: string;
  zone: string;
  /** The type line's first part ("Consulta", "Retorno"). */
  type: string;
  online: boolean;
  /** The office's address for one in person; "" online or when the office has none. */
  place: string;
  /** Up to when cancelling by the link is allowed. */
  cancelUntil: string;
  canCancel: boolean;
  /** Whether "Preciso remarcar" is offered: within the cancel deadline and under two moves by the link. */
  canReschedule: boolean;
  /** The team's WhatsApp, as digits ("" when the office has none). */
  team: string;
}

/** The owner's view of an appointment's link, in the Agenda's details. */
export const CONFIRM_ANSWERS = ["none", "confirmed", "rescheduled", "cancelled"] as const;
export type ConfirmAnswer = (typeof CONFIRM_ANSWERS)[number];

export interface ConfirmLinkStatus {
  /** Whether a link was made for it. */
  made: boolean;
  answer: ConfirmAnswer;
  /** When the patient answered, ISO; "" when not. */
  answeredAt: string;
  /** The start the answer was for, ISO: an answer for another start is old (the appointment moved). */
  answerStart: string;
  /** The start before the patient moved it by the link, ISO; "" when never moved. */
  previousStart: string;
  /** The last time the confirmation went out (E7c1): by which channel, when (ISO) and for which start; "" when never. */
  sentChannel: ConfirmChannel | "";
  sentAt: string;
  sentStart: string;
}

/** How the confirmation went out: by the owner on WhatsApp (E7c1); e-mail and Chatwoot come next. */
export const CONFIRM_CHANNELS = ["whatsapp"] as const;
export type ConfirmChannel = (typeof CONFIRM_CHANNELS)[number];

/** POST /api/google/events/link/sent: the owner sent it, now, for the appointment's current start. */
export const confirmSentSchema = /* @__PURE__ */ z.object({ calendarId: z.string().min(1).max(1024), eventId: z.string().min(1).max(1024), channel: z.enum(CONFIRM_CHANNELS) }).strict();

/** POST /api/google/events/link and GET ?calendarId&eventId. */
export const confirmLinkRequestSchema = /* @__PURE__ */ z.object({ calendarId: z.string().min(1).max(1024), eventId: z.string().min(1).max(1024) }).strict();

/** The link itself, once made: only for the owner. */
export interface ConfirmLinkMade extends ConfirmLinkStatus {
  url: string;
  /** The confirmation message of Configurações › Consultório, filled for this appointment (E7c1). */
  message: string;
}
