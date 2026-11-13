import { describe, expect, it } from "vitest";
import { add, LOCATION, later, turnOn, withReviewsWorld } from "./reviews-world.ts";

// PR S22: the review the home page suggests answering. Only the first name and
// the stars leave the module, lowest stars first; nothing while it is off.

describe("reviews: the first one waiting, for the home page", () => {
  it("is none while the module is off, then the lowest stars first, without a name when anonymous", () =>
    withReviewsWorld(async (world) => {
      expect(world.reviews.firstWaiting()).toBeNull();
      await turnOn(world);
      expect(world.reviews.firstWaiting()).toBeNull();
      add(world, "five", 5, "Ótimo atendimento", { name: "Bia Lima" });
      add(world, "two", 2, "Demorou muito", { name: "Pedro Alves" });
      add(world, "three", 3, "Ok", { anonymous: true });
      await later(world);
      const waiting = world.db.all<{ google_name: string; state: string }>(`SELECT google_name, state FROM zur_reviews`);
      expect(waiting.length).toBe(3);
      expect(world.reviews.firstWaiting()).toEqual({ name: "Pedro", rating: 2 });
      world.db.run(`UPDATE zur_reviews SET state = 'replied' WHERE google_name = ?`, `${LOCATION}/reviews/two`);
      expect(world.reviews.firstWaiting()).toEqual({ name: "", rating: 3 });
      world.db.run(`UPDATE zur_reviews SET state = 'resolved'`);
      expect(world.reviews.firstWaiting()).toBeNull();
    }));

  it("reads a bounded number of rows however long the queue (rule P2)", () =>
    withReviewsWorld(async (world) => {
      await turnOn(world);
      world.db.transaction(() => {
        for (let i = 0; i < 300; i++) {
          const at = new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString();
          world.db.run(
            `INSERT INTO zur_reviews (id, location, google_name, rating, first_name, comment, created_at, updated_at, state, seen_at) VALUES (?, ?, ?, ?, ?, '', ?, ?, 'new', 0)`,
            `r${i}`,
            LOCATION,
            `${LOCATION}/reviews/bulk${i}`,
            i === 295 ? 1 : 4,
            i === 295 ? "Rui" : "Ana",
            at,
            at,
          );
        }
      });
      const before = world.db.usage.rowsRead;
      expect(world.reviews.firstWaiting()).toEqual({ name: "Rui", rating: 1 });
      expect(world.db.usage.rowsRead - before).toBeLessThanOrEqual(50);
    }));
});
