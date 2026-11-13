// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";
import { REVIEW_LEVELS, REVIEW_LIMITS, REVIEW_METRIC_PERIODS, REVIEW_REQUEST_LIMITS, REVIEW_TABS, REVIEW_TONES, reviewLinkProblem } from "./reviews.ts";

/**
 * Google reviews (step 19c): the routes' request bodies, what Zuri reads of
 * Google's answers and what the reviews' agent must answer. Apart from
 * reviews.ts, which the interface imports: Zod stays out of its first load
 * (rule P11).
 */

/** Google's names: "accounts/123/locations/456" and a review under it. Letters, digits and _- only. */
export const LOCATION_NAME = /^accounts\/[A-Za-z0-9_-]{1,100}\/locations\/[A-Za-z0-9_-]{1,100}$/;
export const REVIEW_NAME = /^accounts\/[A-Za-z0-9_-]{1,100}\/locations\/[A-Za-z0-9_-]{1,100}\/reviews\/[A-Za-z0-9_-]{1,200}$/;

/** One line of the owner's (no line breaks or control characters), trimmed. */
const line = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value)),
    );

/** Settings › Integrations › Google › Reviews: the profile, the reply style and the level. */
export const reviewSettingsSchema = /* @__PURE__ */ (() =>
  z
    .object({
      locations: z
        .array(z.string().regex(LOCATION_NAME))
        .max(REVIEW_LIMITS.maxLocations)
        .transform((ids) => [...new Set(ids)]),
      signature: line(REVIEW_LIMITS.signatureMin, REVIEW_LIMITS.signatureMax),
      tone: z.enum(REVIEW_TONES),
      templates: z.array(line(REVIEW_LIMITS.templateMin, REVIEW_LIMITS.templateMax)).min(REVIEW_LIMITS.templatesMin).max(REVIEW_LIMITS.templatesMax),
      banned: z
        .array(line(1, REVIEW_LIMITS.bannedWordMax))
        .max(REVIEW_LIMITS.bannedMax)
        .transform((words) => [...new Set(words)]),
      level: z.enum(REVIEW_LEVELS),
    })
    .strict())();

/** Settings › Integrations › Google › Reviews: how often Zuri checks the reviews by itself. */
export const reviewIntervalSchema = /* @__PURE__ */ (() =>
  z
    .object({
      syncEveryMinutes: z.number().int().min(REVIEW_LIMITS.checkEveryMinMinutes).max(REVIEW_LIMITS.checkEveryMaxMinutes),
    })
    .strict())();

/** "Approve and publish": the text as the owner left it, tied to the version of the review they saw. */
export const reviewApproveSchema = /* @__PURE__ */ (() =>
  z
    .object({
      text: z.string().min(1).max(REVIEW_LIMITS.replyBytes),
      version: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict())();

export const reviewsQuerySchema = /* @__PURE__ */ (() =>
  z
    .object({
      tab: z.enum(REVIEW_TABS).default("needs"),
      rating: z.coerce.number().int().min(1).max(5).optional(),
      cursor: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[0-9a-f-]{36}$/)
        .optional(),
    })
    .strict())();

/** The overview's period; 30 days when none is asked. */
export const reviewMetricsQuerySchema = /* @__PURE__ */ (() => z.object({ period: z.enum(REVIEW_METRIC_PERIODS).default("30d") }).strict())();

/** A review as Google sends it (accounts.locations.reviews); what doesn't fit is skipped, never stored half read. */
export const googleReviewSchema = /* @__PURE__ */ (() =>
  z.object({
    name: z.string().regex(REVIEW_NAME),
    reviewer: z
      .object({
        displayName: z.string().max(500).optional(),
        isAnonymous: z.boolean().optional(),
      })
      .optional(),
    starRating: z.string().max(40).optional(),
    comment: z.string().max(50_000).optional(),
    createTime: z.iso.datetime({ offset: true }),
    updateTime: z.iso.datetime({ offset: true }),
    reviewReply: z
      .object({
        comment: z.string().max(50_000).optional(),
        updateTime: z.iso.datetime({ offset: true }).optional(),
      })
      .optional(),
  }))();
export type GoogleReview = z.infer<typeof googleReviewSchema>;

/** The reviews' agent's answer: anything else is a failed draft. */
export const reviewDraftSchema = /* @__PURE__ */ (() =>
  z
    .object({
      sentiment: z.enum(["positive", "mixed", "negative", "off_topic", "suspicious"]),
      health: z.boolean(),
      language: z.enum(["pt-BR", "en", "other"]),
      reply: z.string().max(REVIEW_LIMITS.replyBytes),
    })
    .strict())();
export type ReviewDraftAnswer = z.infer<typeof reviewDraftSchema>;

/** The second reading of a reply. */
export const reviewSecondReadSchema = /* @__PURE__ */ (() =>
  z
    .object({
      ok: z.boolean(),
      issues: z.array(z.string().max(200)).max(10),
    })
    .strict())();

/** Avaliações › Ajustes › Pedidos e link: the link the owner pasted (null clears it, back to Google's). */
export const reviewLinkSchema = /* @__PURE__ */ (() =>
  z
    .object({
      link: z
        .string()
        .max(REVIEW_REQUEST_LIMITS.linkMax + 50)
        .transform((value) => value.trim())
        .refine((value) => reviewLinkProblem(value) === null)
        .nullable(),
    })
    .strict())();

const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The message and "Quando pedir"; a message must carry {link}. Null keeps the default text. */
export const reviewRequestSettingsSchema = /* @__PURE__ */ (() =>
  z
    .object({
      message: z
        .string()
        .max(REVIEW_REQUEST_LIMITS.messageMax * 2)
        .transform((value) => value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim().normalize("NFC"))
        .pipe(
          z
            .string()
            .min(1)
            .max(REVIEW_REQUEST_LIMITS.messageMax)
            .refine((value) => value.includes("{link}") && !/(?!\n)\p{Cc}|\p{Cf}/u.test(value)),
        )
        .nullable()
        .optional(),
      days: z.number().int().min(REVIEW_REQUEST_LIMITS.daysMin).max(REVIEW_REQUEST_LIMITS.daysMax).optional(),
      hour: z
        .string()
        .regex(HOUR)
        .refine((value) => value >= REVIEW_REQUEST_LIMITS.hourMin && value <= REVIEW_REQUEST_LIMITS.hourMax)
        .optional(),
      reminder: z.boolean().optional(),
    })
    .strict())();

/** "É esta" or "É ele" (a contact's id), "Nenhuma das duas", "Não é" or undoing a link (null). */
export const reviewMatchSchema = /* @__PURE__ */ (() => z.object({ contactId: z.string().regex(/^[0-9a-f-]{36}$/).nullable() }).strict())();

/** What Zuri reads of a profile in Business Information's list: its review link, when Google gives one. */
export const googleLocationMetadataSchema = /* @__PURE__ */ (() =>
  z.object({ metadata: z.object({ newReviewUri: z.string().max(2_000).optional() }).optional() }))();
