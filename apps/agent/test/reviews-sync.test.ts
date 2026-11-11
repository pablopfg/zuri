import { REVIEW_LIMITS } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { add, draftAnswer, later, LOCATION, SECOND_OK, turnOn, withReviewsWorld, type ReviewsWorld } from "./reviews-world.ts";

// PR S09 of the new frontend (plan sincronizacao-contatos-avaliacoes.md, PR 1): the reviews read every
// ten minutes, and a check that finds nothing new moves nothing on the screens.

const EVERY = REVIEW_LIMITS.checkEveryMs;
const area = (world: ReviewsWorld) => world.db.one<{ reviews: number }>(`SELECT reviews FROM zur_area_versions WHERE id = 1`)?.reviews ?? -1;
const iso = (ms: number) => new Date(ms).toISOString();
const reviews = (world: ReviewsWorld) => world.db.all(`SELECT * FROM zur_reviews ORDER BY id`);

describe("the reviews every ten minutes", () => {
  it("plans the next check ten minutes after each one and tells the screen when, and how the last one went", () =>
    withReviewsWorld(async (world) => {
      expect(EVERY).toBe(10 * 60_000);
      expect(world.reviews.status()).toMatchObject({ nextSyncAt: null, lastResult: null, lastCheckAt: null });
      add(world, "old", 5, "Muito bom");
      await turnOn(world);
      const first = world.clock.now;
      expect(world.reviews.status()).toMatchObject({ lastCheckAt: iso(first), nextSyncAt: iso(first + EVERY), lastResult: "changed" });
      // One millisecond before, nothing is due; at the time, the alarm checks.
      world.clock.now = first + EVERY - 1;
      expect(await world.reviews.tick()).toBe(false);
      world.clock.now = first + EVERY;
      expect(await world.reviews.tick()).toBe(true);
      expect(world.reviews.status()).toMatchObject({ lastCheckAt: iso(first + EVERY), nextSyncAt: iso(first + 2 * EVERY), lastResult: "unchanged" });
    }));

  it("a check that finds nothing new writes no review and leaves the screens' number where it was", () =>
    withReviewsWorld(async (world) => {
      add(world, "a", 5, "Muito bom");
      add(world, "b", 4);
      await turnOn(world);
      const kept = reviews(world);
      const number = area(world);
      const writes: number[] = [];
      for (let i = 0; i < 6; i++) {
        world.clock.now += EVERY;
        const before = { ...world.db.usage };
        expect(await world.reviews.check("alarm")).toBe("ok");
        writes.push(world.db.usage.rowsWritten - before.rowsWritten);
        expect(world.reviews.status()).toMatchObject({ lastResult: "unchanged", lastCheckAt: iso(world.clock.now) });
      }
      // The lock, the check's own row and the lock's release (rule P4); the sixth, an hour on, also keeps Google's renewed token.
      expect(writes).toEqual([3, 3, 3, 3, 3, 4]);
      expect(reviews(world)).toEqual(kept);
      expect(area(world)).toBe(number);
    }));

  it("a new review, a changed one and a reply made elsewhere move the screens' number and say so", () =>
    withReviewsWorld(async (world) => {
      add(world, "a", 5, "Muito bom");
      await turnOn(world);
      const steps: (() => void)[] = [
        () => {
          world.answers.push(draftAnswer("Obrigado pela visita! Ficamos muito felizes com a sua avaliação."), SECOND_OK);
          add(world, "n1", 5, "Adorei o atendimento, todos muito gentis.");
        },
        () => add(world, "n2", 1, "Ruim"),
        // The author changed the review; then someone answered it at Google's own page.
        () => world.sim.business.edit(LOCATION, "a", { starRating: "TWO", comment: "Mudei de ideia", updateTime: new Date(world.clock.now + 1_000).toISOString() }),
        () => world.sim.business.edit(LOCATION, "n2", { reviewReply: { comment: "Sentimos muito. Equipe", updateTime: new Date(world.clock.now).toISOString() } }),
      ];
      for (const step of steps) {
        const number = area(world);
        step();
        expect(await later(world, 10)).toBe("ok");
        expect(area(world)).toBeGreaterThan(number);
        expect(world.reviews.status()).toMatchObject({ lastResult: "changed", lastCheckAt: iso(world.clock.now) });
      }
      // And the one after them is quiet again.
      const after = area(world);
      expect(await later(world, 10)).toBe("ok");
      expect(area(world)).toBe(after);
      expect(world.reviews.status().lastResult).toBe("unchanged");
    }));

  it("leaves no time to wait while off or without the permission at Google", () =>
    withReviewsWorld(async (world) => {
      await turnOn(world);
      expect(world.reviews.status().nextSyncAt).not.toBeNull();
      // The owner connected again and left the Business Profile's permission out.
      world.db.run(`UPDATE zur_google_account SET scopes = 'https://www.googleapis.com/auth/calendar.events'`);
      expect(world.reviews.status()).toMatchObject({ problem: "reconnect", nextSyncAt: null });
    }));

  it("a check due in a wake that synced the contacts waits two and a half minutes; one not due is left alone", () =>
    withReviewsWorld(async (world) => {
      // Off: nothing to hold.
      world.reviews.holdOff(150_000);
      await turnOn(world);
      const due = world.reviews.nextDue() ?? 0;
      // Not due yet: its time stays.
      world.clock.now = due - 1;
      world.reviews.holdOff(150_000);
      expect(world.reviews.nextDue()).toBe(due);
      // Due now: it moves, once, and the alarm's tick finds nothing to do in this wake.
      world.clock.now = due;
      const number = area(world);
      world.reviews.holdOff(150_000);
      expect(world.reviews.nextDue()).toBe(due + 150_000);
      expect(await world.reviews.tick()).toBe(false);
      expect(area(world)).toBe(number);
      world.clock.now = due + 150_000;
      expect(await world.reviews.tick()).toBe(true);
      expect(world.reviews.nextDue()).toBe(due + 150_000 + EVERY);
    }));
});
