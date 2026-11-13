import type { Database } from "../db/database.ts";

/**
 * Forgets the copy of the Google reviews (step 19c): the reviews, the drafts,
 * the audit, the profiles and the check's state. Third parties' text that
 * Google keeps: turning the module off or disconnecting Google drops it here.
 * The owner's reply style stays (it is theirs), and so does the trial of
 * publishing by itself (their own decisions, step 19d); publishing by itself
 * goes off, so turning on again starts at drafts. The notices that quote a
 * review go too. Clearing `running_since` makes a check on its way stop before
 * it writes again. Runs inside the caller's transaction when there is one.
 */
export function forgetReviews(db: Database): void {
  db.run(`DELETE FROM zur_reviews`);
  // Their links to the contacts go with them (PR S20); the requests stay while Google stays connected: who was
  // asked is never asked again. Disconnecting Google forgets them too (forgetReviewRequests).
  db.run(`DELETE FROM zur_review_match_candidates`);
  db.run(`DELETE FROM zur_review_matches`);
  db.run(`DELETE FROM zur_review_events`);
  db.run(`DELETE FROM zur_review_locations`);
  db.run(`DELETE FROM zur_notices WHERE kind IN ('reviews.negative', 'reviews.many', 'reviews.worse', 'reviews.draft', 'reviews.burst', 'reviews.auto', 'reviews.breaker')`);
  db.run(
    `UPDATE zur_review_settings SET enabled = 0, paused = 0, problem = NULL, problem_noticed_at = NULL, failures = 0, running_since = NULL,
       next_check = NULL, checked_now_at = NULL, listed_at = NULL, saved_read_at = NULL, last_ok_at = NULL, burst_noticed_at = NULL,
       auto = 0, auto_since = NULL, rejections = 0, breaker = NULL, breaker_at = NULL, auto_day = '', auto_today = 0
     WHERE id = 1`,
  );
}

/**
 * Forgets the review requests (PR S20) with the Google account that made them: the requests, the short
 * addresses already sent (they answer 404 from then on) and the openings' counters. The owner's message
 * and "Quando pedir" stay (theirs); the day's list is made again when Google comes back.
 */
export function forgetReviewRequests(db: Database): void {
  db.run(`DELETE FROM zur_review_requests`);
  db.run(`DELETE FROM zur_review_links`);
  db.run(`DELETE FROM zur_notices WHERE kind = 'reviews.requests'`);
  db.run(`UPDATE zur_review_settings SET requests_day = '', requests_built_at = NULL, requests_told_day = '' WHERE id = 1`);
}
