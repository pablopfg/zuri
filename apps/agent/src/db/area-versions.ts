import { AREAS, type AreaVersions } from "@zuri/shared";
import type { Database } from "./database.ts";

/** The areas with a column of their own; "usage" comes from the meter (UsageMeter.version). */
const STORED = AREAS.filter((area) => area !== "usage");

/**
 * The number of each screen area (migration 21's triggers move them). One
 * row: it rides on the heartbeat and on the chat's tool events. `usage` is the
 * AI meter's number (step 21), kept in memory: no row read, no row written.
 */
export function readAreaVersions(db: Database, usage?: number): AreaVersions {
  const row = db.one<Record<string, unknown>>(`SELECT ${STORED.join(", ")} FROM zur_area_versions WHERE id = 1`);
  const versions: AreaVersions = {};
  if (usage !== undefined) versions.usage = usage;
  for (const area of STORED) {
    const n = row?.[area];
    if (typeof n === "number" && Number.isSafeInteger(n)) versions[area] = n;
  }
  return versions;
}
