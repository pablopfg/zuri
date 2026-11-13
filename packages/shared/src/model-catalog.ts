// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";
// The models card parses the catalog with this one: Zod Mini keeps the classic API out of its bundle.
import { z as mini } from "zod/mini";
import { FREE_NEURONS_PER_DAY } from "./ai-limits.ts";

/**
 * The Workers AI catalog checked on its own (PR S21, P24): once a day the
 * server reads Cloudflare's list of text models through the AI binding (no key,
 * no Neurons), and compares it with Zuri's. A new model only joins the list
 * when the owner taps "Pôr na lista"; a model in use that is leaving is
 * replaced by the default on its day, with a notice. Nothing here ever picks a
 * paid model, or a model the owner did not put on the list.
 */
export const MODEL_CATALOG_LIMITS = {
  /** A model joins the list only with tool calling and at least this window (Llama 3.3 70B, on the list, has 24,000). */
  minContext: 16_000,
  /** Models kept from one check: the text models of the catalog are a few dozen. */
  maxModels: 100,
  /** One check a day at 06:00 UTC (03:00 in Brasília); after a failed one, an hour later. */
  retryMs: 3_600_000,
  /** "Conferir agora" at most once a minute. */
  checkNowEveryMs: 60_000,
  /** The catalog call's deadline (rule P5). */
  timeoutMs: 15_000,
  /** A price change shows on the card for a week. */
  priceNoticeMs: 7 * 86_400_000,
  /** Longest model id taken from the catalog. */
  idMaxChars: 125,
} as const;

/** A Workers AI text model's id, as the catalog names it (`@cf/<author>/<name>`). */
export type CatalogModelId = `@cf/${string}`;

const MODEL_ID = /^@cf\/[a-z0-9][a-z0-9._-]{0,40}\/[a-z0-9][a-z0-9._-]{0,78}$/;

/** True for a string shaped like a Workers AI model id (the catalog's own list decides whether it exists). */
export function isCatalogModelId(value: unknown): value is CatalogModelId {
  return typeof value === "string" && value.length <= MODEL_CATALOG_LIMITS.idMaxChars && MODEL_ID.test(value);
}

/** What the settings accept besides the fixed list: an id of the right shape, checked against the catalog by the server. */
export const catalogModelIdSchema = /* @__PURE__ */ z.custom<CatalogModelId>(isCatalogModelId);

/** Neurons per million tokens from the catalog's US$ per million (1,000 Neurons cost US$ 0.011 on Workers Paid). */
export function neuronsPerMillion(usdPerMillion: number): number {
  return Math.round((usdPerMillion / 0.011) * 1_000);
}

/** A model's name for the screen when the catalog gives none: the last part of its id. */
export function catalogModelName(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

const count = /* @__PURE__ */ mini.number().check(mini.int(), mini.nonnegative());

/** A model of the catalog as the card shows it: Neurons per million tokens in and out, and the whole window. */
export const catalogModelSchema = /* @__PURE__ */ mini.strictObject({
  id: mini.string(),
  label: mini.string(),
  context: count,
  input: count,
  output: count,
  /** One of the fixed list (the dated table), not one the owner added. */
  fixed: mini.boolean(),
});
export type CatalogModel = mini.infer<typeof catalogModelSchema>;

export const CATALOG_NOTICE_KINDS = ["new", "leaving", "price"] as const;
export type CatalogNoticeKind = (typeof CATALOG_NOTICE_KINDS)[number];

/**
 * One line of the card. `new`: in the catalog, fit for the chat, not on the
 * list yet (`model` has its numbers). `leaving`: a model of the list with a
 * date to leave (`on`, YYYY-MM-DD). `price`: a model of the list whose price
 * changed in the last week.
 */
export const catalogNoticeSchema = /* @__PURE__ */ mini.strictObject({
  kind: mini.enum(CATALOG_NOTICE_KINDS),
  model: catalogModelSchema,
  on: mini.nullable(mini.string()),
  inUse: mini.boolean(),
});
export type CatalogNotice = mini.infer<typeof catalogNoticeSchema>;

/** GET /api/ai/catalog: the card in Settings › Modelos e limites, and the list's extra models. */
export const modelCatalogSchema = /* @__PURE__ */ mini.strictObject({
  /** False where there is no catalog to read (no AI binding): the card says so and nothing is checked. */
  available: mini.boolean(),
  /** The last check that read the catalog, or null before the first. */
  checkedAt: mini.nullable(mini.iso.datetime()),
  /** The last try failed: the card says the list is the one of the last check. */
  failed: mini.boolean(),
  /** The free models the settings may name now: the fixed ones that haven't left, then the ones the owner added. */
  listed: mini.array(catalogModelSchema),
  notices: mini.array(catalogNoticeSchema),
});
export type ModelCatalog = mini.infer<typeof modelCatalogSchema>;

/** POST /api/ai/catalog/models (read by the server only). */
export const catalogAddSchema = /* @__PURE__ */ z.object({ id: catalogModelIdSchema }).strict();

/** The highest price taken from the catalog (US$ 110 per million tokens): a model priced above it is left out, as malformed. */
export const CATALOG_MAX_NEURONS_PER_MILLION = FREE_NEURONS_PER_DAY * 1_000;
