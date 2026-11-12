// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z as mini } from "zod/mini";

/**
 * The usage panel by day and by year (PR S13). A module of its own, so the first load of the
 * interface, which reads other schemas of ai.ts, carries none of this (rule P11).
 */
const count = /* @__PURE__ */ mini.int().check(mini.nonnegative());
const amount = /* @__PURE__ */ mini.number().check(mini.nonnegative());
const day = /* @__PURE__ */ mini.string().check(mini.regex(/^\d{4}-\d{2}-\d{2}$/));

/** What one hour, or one month, of the usage panel adds up: the same numbers as a day of the history. */
const usageTotals = {
  requests: count,
  errors: count,
  aborted: count,
  fallbacks: count,
  neurons: amount,
  paidUsd: amount,
  audioSeconds: count,
};

/**
 * GET /api/usage/hours: today by the hour, only the hours that had any use. `day` and `hour` are UTC,
 * like the counters (Cloudflare's allocation starts over at 00:00 UTC); the screen shows them in the
 * owner's time zone.
 */
export const usageHoursSchema = /* @__PURE__ */ mini.strictObject({
  day,
  hours: mini.array(mini.strictObject({ hour: mini.int().check(mini.minimum(0), mini.maximum(23)), ...usageTotals })),
});

export type UsageHours = mini.infer<typeof usageHoursSchema>;

/** Months of usage the year shows and the server keeps, the current one included. */
export const USAGE_MONTHS = 12;

const month = /* @__PURE__ */ mini.string().check(mini.regex(/^\d{4}-(0[1-9]|1[0-2])$/));

/**
 * GET /api/usage/months: the last 12 months, the current one included, only the months that had any
 * use. `days` is how many days of the month had use (for the average). Numbers only.
 */
export const usageMonthsSchema = /* @__PURE__ */ mini.strictObject({
  from: month,
  to: month,
  months: mini.array(mini.strictObject({ month, days: count, ...usageTotals })),
});

export type UsageMonths = mini.infer<typeof usageMonthsSchema>;
