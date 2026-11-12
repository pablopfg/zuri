import { REVIEW_LIMITS, type ReviewMetrics, recommendationIndex } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { METRICS_SQL, type MetricRow, metricWindow, summarize } from "../src/reviews/metrics.ts";
import { add, draftAnswer, later, LOCATION, type ReviewsWorld, row, SECOND_OK, turnOn, withReviewsWorld } from "./reviews-world.ts";

// PR S11: the numbers of Reviews › Overview, in the owner's time zone.

const SP = "America/Sao_Paulo";
const at = (iso: string) => Date.parse(iso);
const review = (created: string, rating: number, repliedAt: string | null = null, answered = repliedAt ? 1 : 0): MetricRow => ({ created_at: created, rating, replied_at: repliedAt, answered });
const REPLY = "Obrigado pela visita, Ana! Ficamos muito felizes com a sua avaliação.";
/** The review as the simulated Google keeps it. */
const in_ = (world: ReviewsWorld, id: string) => {
  const stored = world.sim.business.reviews.get(LOCATION)?.find((item) => item.reviewId === id);
  if (!stored) throw new Error(`no review ${id}`);
  return stored;
};
const index = (metrics: ReviewMetrics) => metrics.buckets.map((bucket) => recommendationIndex(bucket));

describe("the overview's period", () => {
  it("30 days: today and the 29 before, in weeks from Monday", () => {
    // Wednesday 11/11/2026, 12:00 in São Paulo (UTC-3).
    const window = metricWindow("30d", at("2026-11-11T15:00:00Z"), SP);
    expect(window.unit).toBe("week");
    // The first day is Tuesday 13/10, at the owner's midnight; its week started on Monday 12/10.
    expect(new Date(window.from).toISOString()).toBe("2026-10-13T03:00:00.000Z");
    expect(window.buckets.map((bucket) => bucket.key)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(new Date(window.buckets[4]?.start ?? 0).toISOString()).toBe("2026-11-09T03:00:00.000Z");
  });

  it("30 days starting on a Monday or ending on a Sunday keeps whole weeks, and crosses the year", () => {
    // Tuesday 10/11: the first day is Monday 12/10.
    expect(metricWindow("30d", at("2026-11-10T15:00:00Z"), SP).buckets.map((bucket) => bucket.key)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
    // Sunday 10/01/2027: from Saturday 12/12/2026, five weeks touched.
    const window = metricWindow("30d", at("2027-01-10T15:00:00Z"), SP);
    expect(new Date(window.from).toISOString()).toBe("2026-12-12T03:00:00.000Z");
    expect(window.buckets.map((bucket) => bucket.key)).toEqual(["2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28", "2027-01-04"]);
  });

  it("30 days ending on a Monday touch six weeks", () => {
    // Monday 09/11/2026: the first day is Sunday 11/10, the last of its week.
    const window = metricWindow("30d", at("2026-11-09T15:00:00Z"), SP);
    expect(new Date(window.from).toISOString()).toBe("2026-10-11T03:00:00.000Z");
    expect(window.buckets.map((bucket) => bucket.key)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
  });

  it("a day of 23 hours, a midnight that doesn't exist and a leap day keep the owner's calendar", () => {
    // New York enters daylight saving on 08/03/2026: the weeks' midnights go from UTC-5 to UTC-4.
    const spring = metricWindow("30d", at("2026-03-20T16:00:00Z"), "America/New_York");
    expect(new Date(spring.buckets[1]?.start ?? 0).toISOString()).toBe("2026-02-23T05:00:00.000Z");
    expect(new Date(spring.buckets.at(-1)?.start ?? 0).toISOString()).toBe("2026-03-16T04:00:00.000Z");
    // Santiago skips 00:00 on 06/09/2026 (the clock goes to 01:00): the day starts at 01:00, 04:00 UTC.
    const santiago = metricWindow("30d", at("2026-10-05T15:00:00Z"), "America/Santiago");
    expect(santiago.buckets[0]?.key).toBe("2026-08-31");
    expect(new Date(santiago.from).toISOString()).toBe("2026-09-06T04:00:00.000Z");
    // 29/02/2028 is a day of its own, and the month before March is February.
    expect(new Date(metricWindow("30d", at("2028-03-29T15:00:00Z"), SP).from).toISOString()).toBe("2028-02-29T03:00:00.000Z");
    expect(metricWindow("6m", at("2028-03-29T15:00:00Z"), SP).buckets.map((bucket) => bucket.key)).toEqual(["2027-10", "2027-11", "2027-12", "2028-01", "2028-02", "2028-03"]);
  });

  it("6 and 12 months: this month and the ones before, from the owner's first midnight", () => {
    const six = metricWindow("6m", at("2026-11-11T15:00:00Z"), SP);
    expect(six.unit).toBe("month");
    expect(six.buckets.map((bucket) => bucket.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(new Date(six.from).toISOString()).toBe("2026-06-01T03:00:00.000Z");
    const twelve = metricWindow("12m", at("2026-11-11T15:00:00Z"), SP);
    expect(twelve.buckets).toHaveLength(12);
    expect(twelve.buckets[0]?.key).toBe("2025-12");
    expect(twelve.buckets[11]?.key).toBe("2026-11");
    // From a 31st, the months before never skip a shorter one (March 31st minus one month is February).
    expect(metricWindow("6m", at("2026-03-31T15:00:00Z"), SP).buckets.map((bucket) => bucket.key)).toEqual(["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
  });

  it("24 months: this half of the year and the three before; 5 years: this year and the four before", () => {
    const halves = metricWindow("24m", at("2026-11-11T15:00:00Z"), SP);
    expect(halves.unit).toBe("semester");
    expect(halves.buckets.map((bucket) => bucket.key)).toEqual(["2025-S1", "2025-S2", "2026-S1", "2026-S2"]);
    expect(new Date(halves.from).toISOString()).toBe("2025-01-01T03:00:00.000Z");
    expect(new Date(halves.buckets[3]?.start ?? 0).toISOString()).toBe("2026-07-01T03:00:00.000Z");
    // June 30th is still the first half, July 1st the second; the first half goes back across the year.
    expect(metricWindow("24m", at("2026-07-01T02:59:00Z"), SP).buckets.map((bucket) => bucket.key)).toEqual(["2024-S2", "2025-S1", "2025-S2", "2026-S1"]);
    expect(metricWindow("24m", at("2026-07-01T03:00:00Z"), SP).buckets.at(-1)?.key).toBe("2026-S2");
    const years = metricWindow("5y", at("2026-11-11T15:00:00Z"), SP);
    expect(years.unit).toBe("year");
    expect(years.buckets.map((bucket) => bucket.key)).toEqual(["2022", "2023", "2024", "2025", "2026"]);
    expect(new Date(years.from).toISOString()).toBe("2022-01-01T03:00:00.000Z");
    // New Year's Eve at 23:59 of the owner's is still the old year.
    expect(metricWindow("5y", at("2027-01-01T02:59:00Z"), SP).buckets.at(-1)?.key).toBe("2026");
    expect(metricWindow("5y", at("2027-01-01T03:00:00Z"), SP).buckets.at(-1)?.key).toBe("2027");
    // A zone with summer time: January starts at 05:00Z and July at 04:00Z, each at its own local midnight.
    const york = metricWindow("24m", at("2026-11-11T15:00:00Z"), "America/New_York");
    expect(york.buckets.slice(2).map((bucket) => new Date(bucket.start).toISOString())).toEqual(["2026-01-01T05:00:00.000Z", "2026-07-01T04:00:00.000Z"]);
  });

  it("follows the owner's day, not UTC's: 23:59 and 00:00 fall in different days and months", () => {
    // 30/11 23:59 in São Paulo is already December in UTC.
    expect(metricWindow("6m", at("2026-12-01T02:59:00Z"), SP).buckets.at(-1)?.key).toBe("2026-11");
    expect(metricWindow("6m", at("2026-12-01T03:00:00Z"), SP).buckets.at(-1)?.key).toBe("2026-12");
    expect(metricWindow("6m", at("2026-11-30T23:30:00Z"), "Asia/Tokyo").buckets.at(-1)?.key).toBe("2026-12");
    expect(new Date(metricWindow("30d", at("2026-11-12T02:59:00Z"), SP).from).toISOString()).toBe("2026-10-13T03:00:00.000Z");
    expect(new Date(metricWindow("30d", at("2026-11-12T03:00:00Z"), SP).from).toISOString()).toBe("2026-10-14T03:00:00.000Z");
  });

  it("keeps the local midnight across a daylight-saving change", () => {
    // New York leaves daylight saving on 01/11/2026: midnight is UTC-4 before and UTC-5 after.
    const window = metricWindow("30d", at("2026-11-11T17:00:00Z"), "America/New_York");
    expect(new Date(window.from).toISOString()).toBe("2026-10-13T04:00:00.000Z");
    expect(new Date(window.buckets.at(-1)?.start ?? 0).toISOString()).toBe("2026-11-09T05:00:00.000Z");
    const months = metricWindow("6m", at("2026-11-11T17:00:00Z"), "America/New_York");
    expect(new Date(months.buckets[4]?.start ?? 0).toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(new Date(months.buckets[5]?.start ?? 0).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });
});

describe("the overview's numbers", () => {
  const window = metricWindow("30d", at("2026-11-11T15:00:00Z"), SP);

  it("answers zeros and no index without reviews", () => {
    const metrics = summarize("30d", window, []);
    expect(metrics).toEqual({
      period: "30d",
      from: "2026-10-13T03:00:00.000Z",
      unit: "week",
      ratings: [0, 0, 0, 0, 0],
      buckets: window.buckets.map(({ key }) => ({ key, promoters: 0, neutrals: 0, detractors: 0, stars: 0 })),
      replied: 0,
      medianReplyMinutes: null,
      requests: null,
      partial: false,
    });
    expect(index(metrics)).toEqual([null, null, null, null, null]);
  });

  it("counts 5 stars as recommending, 4 as neutral and 1 to 3 as not, in the week each was written", () => {
    const metrics = summarize("30d", window, [
      // The owner's first instant of the period, in the week of 12/10.
      review("2026-10-13T03:00:00.000Z", 5),
      // Sunday 18/10 23:59 local: still that week; a minute later, the next one.
      review("2026-10-19T02:59:00.000Z", 3),
      review("2026-10-19T03:00:00.000Z", 4),
      review("2026-11-10T12:00:00.000Z", 5),
      review("2026-11-10T13:00:00.000Z", 5),
      review("2026-11-10T14:00:00.000Z", 1),
      review("2026-11-11T14:00:00.000Z", 2),
    ]);
    expect(metrics.ratings).toEqual([3, 1, 1, 1, 1]);
    expect(metrics.buckets).toEqual([
      { key: "2026-10-12", promoters: 1, neutrals: 0, detractors: 1, stars: 8 },
      { key: "2026-10-19", promoters: 0, neutrals: 1, detractors: 0, stars: 4 },
      { key: "2026-10-26", promoters: 0, neutrals: 0, detractors: 0, stars: 0 },
      { key: "2026-11-02", promoters: 0, neutrals: 0, detractors: 0, stars: 0 },
      { key: "2026-11-09", promoters: 2, neutrals: 0, detractors: 2, stars: 13 },
    ]);
    expect(index(metrics)).toEqual([0, 0, null, null, 0]);
  });

  it("leaves out what is before the period, without stars or with a date that can't be read", () => {
    const metrics = summarize("30d", window, [review("2026-10-13T02:59:59.999Z", 5), review("2026-11-01T12:00:00.000Z", 0), review("2026-11-01T12:00:00.000Z", 6), review("not a date", 5), review("2026-11-01T12:00:00.000Z", 4)]);
    expect(metrics.ratings).toEqual([0, 1, 0, 0, 0]);
  });

  it("the index goes from -100 to 100", () => {
    expect(recommendationIndex({ promoters: 0, neutrals: 0, detractors: 0 })).toBeNull();
    expect(recommendationIndex({ promoters: 0, neutrals: 3, detractors: 0 })).toBe(0);
    expect(recommendationIndex({ promoters: 0, neutrals: 0, detractors: 2 })).toBe(-100);
    expect(recommendationIndex({ promoters: 4, neutrals: 0, detractors: 0 })).toBe(100);
    expect(recommendationIndex({ promoters: 5, neutrals: 1, detractors: 1 })).toBe(57);
    expect(recommendationIndex({ promoters: 1, neutrals: 0, detractors: 2 })).toBe(-33);
  });

  it("counts every reply, and takes the middle time of those whose time is known", () => {
    const odd = summarize("30d", window, [
      review("2026-11-10T12:00:00.000Z", 5, "2026-11-10T12:30:00.000Z"),
      review("2026-11-10T12:00:00.000Z", 5, "2026-11-10T16:00:00.000Z"),
      review("2026-11-10T12:00:00.000Z", 2, "2026-11-12T12:00:00.000Z"),
      // Answered at Google before Zuri kept the time: counted, out of the middle time.
      review("2026-11-10T12:00:00.000Z", 4, null, 1),
      review("2026-11-10T12:00:00.000Z", 5),
    ]);
    expect(odd.replied).toBe(4);
    expect(odd.medianReplyMinutes).toBe(240);
    const even = summarize("30d", window, [review("2026-11-10T12:00:00.000Z", 5, "2026-11-10T12:10:00.000Z"), review("2026-11-10T12:00:00.000Z", 5, "2026-11-10T12:25:00.000Z")]);
    expect(even.medianReplyMinutes).toBe(18);
    // A reply dated before the review counts as at once; one whose time can't be read is left out.
    expect(summarize("30d", window, [review("2026-11-10T12:00:00.000Z", 5, "2026-11-10T11:00:00.000Z")]).medianReplyMinutes).toBe(0);
    expect(summarize("30d", window, [review("2026-11-10T12:00:00.000Z", 5, "soon")]).medianReplyMinutes).toBeNull();
    // A time left on a review whose reply is gone doesn't count.
    expect(summarize("30d", window, [review("2026-11-10T12:00:00.000Z", 5, "2026-11-10T12:10:00.000Z", 0)])).toMatchObject({ replied: 0, medianReplyMinutes: null });
  });
});

describe("the overview read from the copy", () => {
  it("counts the reviews of the period in the owner's weeks and months, and never one removed at Google", () =>
    withReviewsWorld(async (world) => {
      const now = world.clock.now;
      const day = 86_400_000;
      // What Google already had comes in as history on the first read.
      add(world, "month", 4, undefined, { at: new Date(now - 20 * day).toISOString() });
      add(world, "half", 5, undefined, { at: new Date(now - 100 * day).toISOString() });
      add(world, "year", 3, undefined, { at: new Date(now - 300 * day).toISOString() });
      add(world, "older", 5, undefined, { at: new Date(now - 400 * day).toISOString() });
      await turnOn(world);
      add(world, "today", 5, "Adorei");
      add(world, "bad", 1, "Ruim");
      add(world, "gone", 1, "Ruim");
      await later(world);
      world.db.run(`UPDATE zur_reviews SET state = 'removed' WHERE google_name = ?`, `${LOCATION}/reviews/gone`);
      const thirty = world.reviews.metrics("30d");
      expect(thirty.ratings).toEqual([1, 1, 0, 0, 1]);
      expect(thirty.buckets.reduce((sum, bucket) => sum + bucket.promoters + bucket.neutrals + bucket.detractors, 0)).toBe(3);
      expect(thirty.buckets.at(-1)).toMatchObject({ promoters: 1, detractors: 1 });
      expect(world.reviews.metrics("6m").ratings).toEqual([2, 1, 0, 0, 1]);
      const year = world.reviews.metrics("12m");
      expect(year.ratings).toEqual([2, 1, 1, 0, 1]);
      expect(year.buckets).toHaveLength(12);
      expect(year.partial).toBe(false);
      expect(year.requests).toBeNull();
    }));

  it("knows how long a reply given at Google took, by Google's time of the reply first seen", () =>
    withReviewsWorld(async (world) => {
      await turnOn(world);
      // Answered at Google before Zuri saw it: Google's time of the reply (the simulated one is the review's).
      add(world, "elsewhere", 5, "Ótimo", { reply: "Obrigado!" });
      add(world, "waiting", 5, "Adorei");
      await later(world);
      expect(row(world, "elsewhere")?.replied_at).toBe(row(world, "elsewhere")?.created_at);
      expect(row(world, "waiting")?.replied_at).toBeNull();
      // The team answers at Google 90 minutes after the review.
      const created = Date.parse(String(row(world, "waiting")?.created_at));
      const answered = new Date(created + 90 * 60_000).toISOString();
      const stored = world.sim.business.reviews.get(LOCATION)?.find((item) => item.name.endsWith("/waiting"));
      if (!stored) throw new Error("no review");
      stored.reviewReply = { comment: "Obrigada pela visita!", updateTime: answered };
      stored.updateTime = answered;
      world.clock.now = created + 100 * 60_000;
      expect(await world.reviews.check("alarm")).toBe("ok");
      expect(row(world, "waiting")).toMatchObject({ state: "replied_elsewhere", replied_at: answered });
      // The reply edited later at Google: the first time stays.
      const edited = new Date(created + 5 * 86_400_000).toISOString();
      stored.reviewReply = { comment: "Obrigada pela visita, volte sempre!", updateTime: edited };
      stored.updateTime = edited;
      world.clock.now = created + 5 * 86_400_000 + 60_000;
      expect(await world.reviews.check("alarm")).toBe("ok");
      expect(row(world, "waiting")?.replied_at).toBe(answered);
      const metrics = world.reviews.metrics("30d");
      expect(metrics.replied).toBe(2);
      // 0 and 90 minutes.
      expect(metrics.medianReplyMinutes).toBe(45);
      // A reply copied before Zuri kept the time, edited now: the edit's time is not the reply's, so none is kept.
      world.db.run(`UPDATE zur_reviews SET replied_at = NULL WHERE google_name = ?`, `${LOCATION}/reviews/waiting`);
      const again = new Date(created + 5 * 86_400_000 + 120_000).toISOString();
      stored.reviewReply = { comment: "Obrigada pela visita, até a próxima!", updateTime: again };
      stored.updateTime = again;
      world.clock.now = created + 5 * 86_400_000 + 180_000;
      expect(await world.reviews.check("alarm")).toBe("ok");
      expect(row(world, "waiting")).toMatchObject({ reply: "Obrigada pela visita, até a próxima!", replied_at: null });
      expect(world.reviews.metrics("30d")).toMatchObject({ replied: 2, medianReplyMinutes: 0 });
      // The reply taken down at Google: neither counted nor timed.
      delete stored.reviewReply;
      stored.updateTime = new Date(created + 6 * 86_400_000).toISOString();
      world.clock.now = created + 6 * 86_400_000 + 60_000;
      expect(await world.reviews.check("alarm")).toBe("ok");
      expect(row(world, "waiting")?.replied_at).toBeNull();
      expect(world.reviews.metrics("30d")).toMatchObject({ replied: 1, medianReplyMinutes: 0 });
    }));

  it("keeps Google's time of a reply on every way a reply is found", () =>
    withReviewsWorld(async (world) => {
      await turnOn(world);
      const minutes = (n: number) => n * 60_000;
      const start = world.clock.now;
      // An old review, read whole by an earlier check, answered later without Google moving its own time.
      add(world, "old", 5, "Muito bom");
      await later(world);
      // Three hours on, two more reviews.
      world.clock.now = start + minutes(180);
      add(world, "same", 5, "Adorei");
      add(world, "edited", 4, "Bom");
      expect(await world.reviews.check("alarm")).toBe("ok");
      const oldAnswered = new Date(start + minutes(200)).toISOString();
      const sameAnswered = new Date(start + minutes(205)).toISOString();
      const editedAnswered = new Date(start + minutes(210)).toISOString();
      in_(world, "old").reviewReply = { comment: "Obrigado!", updateTime: oldAnswered };
      // Only the reply is new: the review's own time stays.
      in_(world, "same").reviewReply = { comment: "Obrigada!", updateTime: sameAnswered };
      // The stars changed and the reply came in the same read.
      const edited = in_(world, "edited");
      edited.starRating = "FIVE";
      edited.updateTime = editedAnswered;
      edited.reviewReply = { comment: "Que bom!", updateTime: editedAnswered };
      world.clock.now = start + minutes(220);
      expect(await world.reviews.check("alarm")).toBe("ok");
      expect(row(world, "old")).toMatchObject({ reply: "Obrigado!", replied_at: oldAnswered });
      expect(row(world, "same")).toMatchObject({ reply: "Obrigada!", replied_at: sameAnswered });
      expect(row(world, "edited")).toMatchObject({ rating: 5, reply: "Que bom!", replied_at: editedAnswered });
      // 200, 25 and 30 minutes after each review.
      expect(world.reviews.metrics("30d")).toMatchObject({ ratings: [3, 0, 0, 0, 0], replied: 3, medianReplyMinutes: 30 });
    }));

  it("times a reply Zuri published by the moment it went out, and a later read keeps it", () =>
    withReviewsWorld(async (world) => {
      await turnOn(world);
      const created = world.clock.now;
      add(world, "mine", 5, "Adorei o atendimento, todos muito gentis.");
      world.answers.push(draftAnswer(REPLY), SECOND_OK);
      await later(world);
      const item = await world.reviews.item(row(world, "mine") as never);
      expect(item.state).toBe("proposed");
      world.clock.now = created + 50 * 60_000;
      expect((await world.reviews.approve(item.id, { text: `${REPLY}\n\nEquipe Exemplo`, version: item.version }, "app")).state).toBe("replied");
      const published = new Date(created + 50 * 60_000).toISOString();
      expect(row(world, "mine")?.replied_at).toBe(published);
      // Google dates the reply a little later: the next reads keep Zuri's own time.
      in_(world, "mine").reviewReply = { comment: `${REPLY}\n\nEquipe Exemplo`, updateTime: new Date(created + 58 * 60_000).toISOString() };
      await later(world);
      await later(world);
      expect(row(world, "mine")).toMatchObject({ state: "replied", replied_at: published });
      expect(world.reviews.metrics("30d")).toMatchObject({ replied: 1, medianReplyMinutes: 50 });
    }));

  it("counts a review written at the period's first instant and not one a millisecond before", () =>
    withReviewsWorld(async (world) => {
      await turnOn(world);
      const from = Date.parse(world.reviews.metrics("30d").from);
      const insert = (id: string, created: number, state: string) =>
        world.db.run(
          `INSERT INTO zur_reviews (id, location, google_name, rating, created_at, updated_at, state, seen_at) VALUES (?, ?, ?, 5, ?, ?, ?, ?)`,
          id,
          LOCATION,
          `${LOCATION}/reviews/${id}`,
          new Date(created).toISOString(),
          new Date(created).toISOString(),
          state,
          world.clock.now,
        );
      insert("before", from - 1, "history");
      expect(world.reviews.metrics("30d").ratings).toEqual([0, 0, 0, 0, 0]);
      insert("first", from, "history");
      // Every state but "removed" counts: a review is one whatever Zuri did with it.
      insert("sending", from + 1, "sending");
      insert("uncertain", from + 2, "uncertain");
      insert("removed", from + 3, "removed");
      const metrics = world.reviews.metrics("30d");
      expect(metrics.ratings).toEqual([3, 0, 0, 0, 0]);
      expect(metrics.buckets[0]).toMatchObject({ promoters: 3 });
    }));

  it("answers zeros while the reviews are off, without reading the copy", () =>
    withReviewsWorld(async (world) => {
      const before = world.db.usage.rowsRead;
      const metrics = world.reviews.metrics("12m");
      expect(metrics.ratings).toEqual([0, 0, 0, 0, 0]);
      expect(metrics.buckets).toHaveLength(12);
      // The settings' row only.
      expect(world.db.usage.rowsRead - before).toBeLessThanOrEqual(2);
    }));

  it("reads only the index, and at most the newest 5,000 reviews", () =>
    withReviewsWorld(async (world) => {
      await turnOn(world);
      const plan = world.db.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${METRICS_SQL}`, "2026-01-01T00:00:00.000Z", 10);
      expect(plan.map((step) => step.detail).join(" | ")).toMatch(/USING COVERING INDEX zur_reviews_metrics \(created_at>\?\)/);
      expect(plan.map((step) => step.detail).join(" | ")).not.toMatch(/TEMP B-TREE/);
      const total = REVIEW_LIMITS.metricsRows + 1;
      world.db.transaction(() => {
        for (let i = 0; i < total; i++) {
          // One a minute, back from now; the oldest is 1 star.
          const created = new Date(world.clock.now - i * 60_000).toISOString();
          world.db.run(
            `INSERT INTO zur_reviews (id, location, google_name, rating, created_at, updated_at, state, seen_at) VALUES (?, ?, ?, ?, ?, ?, 'history', ?)`,
            `many-${i}`,
            LOCATION,
            `${LOCATION}/reviews/many-${i}`,
            i >= REVIEW_LIMITS.metricsRows ? 1 : 5,
            created,
            created,
            world.clock.now,
          );
        }
      });
      // Exactly the limit: everything counted, nothing partial.
      world.db.run(`UPDATE zur_reviews SET state = 'removed' WHERE id = ?`, `many-${REVIEW_LIMITS.metricsRows}`);
      expect(world.reviews.metrics("30d")).toMatchObject({ partial: false, ratings: [REVIEW_LIMITS.metricsRows, 0, 0, 0, 0] });
      // One more: the oldest is left out, and the answer says so.
      world.db.run(`UPDATE zur_reviews SET state = 'history' WHERE id = ?`, `many-${REVIEW_LIMITS.metricsRows}`);
      const before = world.db.usage.rowsRead;
      const metrics = world.reviews.metrics("30d");
      expect(metrics.partial).toBe(true);
      expect(metrics.ratings).toEqual([REVIEW_LIMITS.metricsRows, 0, 0, 0, 0]);
      // One row of the index per review counted, the one that shows there are more, and the settings.
      expect(world.db.usage.rowsRead - before).toBeLessThanOrEqual(REVIEW_LIMITS.metricsRows + 5);
    }));
});
