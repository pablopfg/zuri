import { CONTACT_LIMITS, DAY_BUDGET, FLOW_LIMITS, flowDefinitionSchema, flowSlotsPerDay, REVIEW_LIMITS, syncSlotsPerDay } from "@zuri/shared";
import { AppError } from "../http/errors.ts";
import type { Database } from "./database.ts";

// One count for everything the alarm runs by the clock (DAY_BUDGET): the two reads of Google and the flows
// turned on. A read every minute is paid from it, so the day's worst cost stays the one of before.

/**
 * A stored interval, in whole minutes. Past the longest it is the longest; under the shortest or not a number
 * (a damaged row) it is the default: what can't be trusted never reads Google more often than before.
 */
export function syncMinutes(value: number | null | undefined, initial: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) return initial;
  return Math.min(max, value);
}

/** Times a day of the two reads of Google at the owner's intervals, on or off (turning one on is never refused). */
export function syncSlots(db: Database, patch: { contacts?: number; reviews?: number } = {}): number {
  const contacts = patch.contacts ?? db.one<{ m: number }>(`SELECT sync_every_min AS m FROM zur_contact_sync WHERE id = 1`)?.m;
  const reviews = patch.reviews ?? db.one<{ m: number }>(`SELECT check_every_min AS m FROM zur_review_settings WHERE id = 1`)?.m;
  return (
    syncSlotsPerDay(syncMinutes(contacts, CONTACT_LIMITS.syncEveryMs / 60_000, CONTACT_LIMITS.syncEveryMinMinutes, CONTACT_LIMITS.syncEveryMaxMinutes)) +
    syncSlotsPerDay(syncMinutes(reviews, REVIEW_LIMITS.checkEveryMs / 60_000, REVIEW_LIMITS.checkEveryMinMinutes, REVIEW_LIMITS.checkEveryMaxMinutes))
  );
}

/** Times a day of the flows turned on, `except` aside; a stored flow that can't be read counts none. */
export function flowSlots(db: Database, except: string | null = null): number {
  return db
    .all<{ id: string; definition: string }>(`SELECT id, definition FROM zur_flows WHERE enabled = 1 LIMIT ?`, FLOW_LIMITS.flows)
    .filter((row) => row.id !== except)
    .reduce((sum, row) => {
      try {
        const parsed = flowDefinitionSchema.safeParse(JSON.parse(row.definition));
        return sum + (parsed.success ? flowSlotsPerDay(parsed.data) : 0);
      } catch {
        return sum;
      }
    }, 0);
}

/** What the flows may take: their own most, or what the reads of Google leave of the day. */
export function flowSlotsLimit(db: Database): number {
  return Math.max(0, Math.min(FLOW_LIMITS.slotsPerDay, Math.floor((DAY_BUDGET.units - syncSlots(db) * DAY_BUDGET.perSync) / DAY_BUDGET.perFlow)));
}

/** A shorter interval for a read of Google: 409 when the day, with the other read and the flows on, has no room for it. */
export function checkSyncSlots(db: Database, patch: { contacts?: number; reviews?: number }): void {
  const cost = syncSlots(db, patch) * DAY_BUDGET.perSync + flowSlots(db) * DAY_BUDGET.perFlow;
  if (cost > DAY_BUDGET.units) throw new AppError("CONFLICT", "error.syncSlotsLimit", { limit: DAY_BUDGET.units, cost });
}
