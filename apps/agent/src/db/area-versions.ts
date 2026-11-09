import { AREAS, type AreaVersions } from "@zuri/shared";
import type { Database } from "./database.ts";

/** The areas with a column of their own; "usage" is read from the day's counters instead. */
const STORED = AREAS.filter((area) => area !== "usage");

/**
 * The AI usage's number (step 21) without a write of its own: every AI call
 * already writes the day's counters, and a trigger there would add a row
 * written to each of them (rule P4). The number is a hash of the newest day's
 * counters, so it changes whenever they do; the app only compares it.
 */
function usageVersion(db: Database): number | undefined {
  const row = db.one<{ day: string; a: number; b: number; c: number; d: number; e: number }>(
    `SELECT day, ai_requests AS a, ai_errors AS b, ai_aborted AS c, neurons AS d, paid_usd AS e FROM zur_usage_daily ORDER BY day DESC LIMIT 1`,
  );
  if (!row) return 0;
  // FNV-1a over the row as text: 32 bits, always a safe whole number.
  let hash = 0x811c9dc5;
  for (const char of `${row.day}|${row.a}|${row.b}|${row.c}|${row.d}|${row.e}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The number of each screen area (migration 21's triggers move them). One
 * row: it rides on the heartbeat and on the chat's tool events.
 */
export function readAreaVersions(db: Database): AreaVersions {
  const row = db.one<Record<string, unknown>>(`SELECT ${STORED.join(", ")} FROM zur_area_versions WHERE id = 1`);
  const versions: AreaVersions = {};
  const usage = usageVersion(db);
  if (usage !== undefined) versions.usage = usage;
  for (const area of STORED) {
    const n = row?.[area];
    if (typeof n === "number" && Number.isSafeInteger(n)) versions[area] = n;
  }
  return versions;
}
