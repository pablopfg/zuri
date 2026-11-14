// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";

/**
 * The home page's suggestions (PR S22, plan docs/planos/sugestoes-do-inicio.md).
 *
 * A closed catalog: the server picks up to three of these by fixed rules on
 * the owner's day and hour, the taps teach the order, and once a day the AI may
 * reorder the catalog's ids. The text on the screen always comes from the
 * interface's own catalog; only a first name, a bill and a time fill its blanks.
 */
export const HOME_SUGGESTION_IDS = ["late", "bill", "review", "week", "today", "rest", "tomorrow"] as const;
export type HomeSuggestionId = (typeof HOME_SUGGESTION_IDS)[number];

/** At most this many under the field. */
export const HOME_SUGGESTIONS_SHOWN = 3;
/** A name or bill that fills a blank is cut to this many characters (the chip stays under 48). */
export const HOME_SUGGESTION_NAME_MAX = 20;
/** The longest a suggestion may read on the screen. */
export const HOME_SUGGESTION_TEXT_MAX = 48;
/** Most ids the AI's answer may carry. */
export const HOME_SUGGESTION_ORDER_MAX = 6;

/** One suggestion as GET /api/home/suggestions returns it. */
export interface HomeSuggestion {
  id: HomeSuggestionId;
  /** The bill (`bill`) or the reviewer's first name (`review`), already cut; absent for an anonymous review. */
  name?: string;
  /** `bill` only: the reminder's time, "HH:MM" in the owner's zone. */
  time?: string;
}

export interface HomeSuggestions {
  suggestions: HomeSuggestion[];
}

/**
 * The AI's whole answer: ids of the catalog in its order, nothing else (read by
 * the server only). Text, a link, an unknown id, a repeated id or more than six
 * fail, and the rules alone decide the order.
 */
export const homeSuggestionOrderSchema = /* @__PURE__ */ z
  .object({ order: z.array(z.enum(HOME_SUGGESTION_IDS)).max(HOME_SUGGESTION_ORDER_MAX) })
  .strict()
  .refine((value) => new Set(value.order).size === value.order.length);

export const homeSuggestionIdSchema = /* @__PURE__ */ z.enum(HOME_SUGGESTION_IDS);
