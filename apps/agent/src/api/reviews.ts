import {
  reviewApproveSchema,
  reviewIntervalSchema,
  reviewLinkSchema,
  reviewMatchSchema,
  reviewMetricsQuerySchema,
  reviewRequestSettingsSchema,
  reviewSettingsSchema,
  reviewsQuerySchema,
} from "@zuri/shared";
import type { Context, Hono } from "hono";
import { type ClientInfo, networkKey } from "../auth/client.ts";
import { REVIEW_OPEN_HEADER, REVIEW_OPEN_PATH } from "../gates/review-link.ts";
import { toAppError } from "../google/errors.ts";
import { AppError } from "../http/errors.ts";
import type { ApiEnv } from "./app.ts";
import type { GoogleRouteDeps } from "./google.ts";
import { readJson } from "./http.ts";

/** A Google failure in the owner's words. */
async function owner<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toAppError(error);
  }
}

const ID = /^[0-9a-f-]{36}$/;

function reviewId(c: Context<ApiEnv>): string {
  const id = c.req.param("id") ?? "";
  if (!ID.test(id)) throw new AppError("NOT_FOUND", "error.reviewNotFound");
  return id;
}

/**
 * Somebody opened a short address of a review request (PR S20): before the session check, since
 * the patient has no session. Only the Worker reaches it (the header), and only with a code it
 * already checked the shape of; the answer is the kind and, for "go", the profile's review page.
 */
export function registerReviewOpen(app: Hono<ApiEnv>, deps: () => GoogleRouteDeps): void {
  app.get(`${REVIEW_OPEN_PATH.replace(/^\/api/, "")}/:code`, async (c) => {
    const mode = c.req.header(REVIEW_OPEN_HEADER);
    if (mode !== "go" && mode !== "preview") throw new AppError("NOT_FOUND");
    const ip = (c.req.header("cf-connecting-ip") ?? "").slice(0, 64).trim();
    const answer = await deps().reviewRequests.open(c.req.param("code") ?? "", ip ? networkKey(ip) : "", mode === "preview");
    return Response.json(answer);
  });
}

/**
 * Google reviews (step 19c): Settings › Integrations › Google › Reviews and
 * the Reviews tab of Contacts, after the session check (signed in, CSRF, the
 * owner's Origin). None of these is in WHILE_LOCKDOWN, no tool reaches them
 * and the bot has none: only the owner on the screen picks the profile, the
 * level or approves a reply. Answers never carry Google's ids of a review.
 */
export function registerReviewRoutes(app: Hono<ApiEnv>, deps: () => GoogleRouteDeps, client: (c: Context<ApiEnv>) => ClientInfo): void {
  app.get("/reviews/status", () => Response.json(deps().reviews.status()));

  /** Google's page to add the Business Profile to the calendar's grant. */
  app.post("/reviews/connect", async (c) => {
    const { google, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    return Response.json({ url: await owner(() => google.begin(c.get("session").id, "reviews")) });
  });

  /** The profiles the account manages, read from Google now. */
  app.get("/reviews/locations", async () => Response.json({ locations: await owner(() => deps().reviews.listLocations()) }));

  /**
   * The profile, the reply style and the level (the password typed recently,
   * since replies go out in the owner's name), then a first read. Turning on
   * "publish positive ones by itself" (step 19d) also raises a security alert
   * on every channel: only this route sets it, never the chat, the bot or a
   * routine.
   */
  app.patch("/reviews/settings", async (c) => {
    const input = await readJson(c.req.raw, reviewSettingsSchema, 16 * 1024);
    const { reviews, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    const before = reviews.status().level;
    reviews.configure(input);
    if (input.level === "auto" && before !== "auto") auth.events.record("reviews_autonomy", client(c), { alert: true });
    // The first read now (one page per newly picked profile, kept as history): the owner sees at once
    // whether Google lets Zuri in, instead of a minute later. Its failures land in the status.
    await reviews.firstRead();
    await deps().rearm();
    return Response.json(reviews.status());
  });

  /**
   * How often the reviews are checked, within the limits of shared/reviews.ts. No password asked: it
   * changes only when Zuri reads Google, never what is published.
   */
  app.patch("/reviews/interval", async (c) => {
    const { syncEveryMinutes } = await readJson(c.req.raw, reviewIntervalSchema, 1024);
    // As the contacts' settings: only while on (the field shows only then).
    if (!deps().reviews.status().enabled) throw new AppError("CONFLICT", "error.reviewsOff");
    const status = deps().reviews.setInterval(syncEveryMinutes);
    await deps().rearm();
    return Response.json(status);
  });

  /** Turns the reviews off and forgets their copy (Google keeps the originals). */
  app.delete("/reviews", async (c) => {
    const { reviews, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    reviews.disable();
    await deps().rearm();
    return Response.json(reviews.status());
  });

  app.post("/reviews/pause", () => {
    deps().reviews.pause(true);
    return Response.json(deps().reviews.status());
  });

  app.post("/reviews/resume", () => {
    deps().reviews.pause(false);
    return Response.json(deps().reviews.status());
  });

  /** "Check now": once a minute. */
  app.post("/reviews/check", async () => {
    const { reviews } = deps();
    const outcome = await owner(() => reviews.checkNow());
    if (outcome === "busy") throw new AppError("CONFLICT", "error.reviewsBusy");
    await deps().rearm();
    return Response.json({ ...reviews.status(), outcome });
  });

  app.get("/reviews", async (c) => {
    const query = reviewsQuerySchema.safeParse({ tab: c.req.query("tab") || undefined, rating: c.req.query("rating") || undefined, cursor: c.req.query("cursor") || undefined });
    if (!query.success) throw new AppError("VALIDATION_FAILED");
    return Response.json(await deps().reviews.list(query.data));
  });

  /**
   * The overview's numbers (PR S11): ratings, the recommendation estimate by week or month, replies and
   * how long they took. Numbers only, read from Zuri's copy: Google is never asked.
   */
  app.get("/reviews/metrics", (c) => {
    const query = reviewMetricsQuerySchema.safeParse(c.req.query());
    // A period written twice is refused too, never the first one taken.
    if (!query.success || (c.req.queries("period")?.length ?? 0) > 1) throw new AppError("VALIDATION_FAILED");
    return Response.json(deps().reviews.metrics(query.data.period));
  });

  // ---------- Review requests and the link (PR S20) ----------

  /** Avaliações › Pedidos: the day's list, made by the alarm (never from Google here). */
  app.get("/reviews/requests", async () => {
    const { reviewRequests } = deps();
    // The very first list is made now, when the owner opens it, instead of at tomorrow's hour.
    await owner(() => reviewRequests.firstBuild());
    return Response.json(reviewRequests.list());
  });

  /** Avaliações › Ajustes › Pedidos e link. */
  app.get("/reviews/requests/settings", () => Response.json(deps().reviewRequests.settings()));

  /**
   * The link the requests lead to, pasted by the owner (null: back to Google's). The password typed
   * recently and an alert on every channel: whoever changes it decides where the patients land.
   */
  app.put("/reviews/requests/link", async (c) => {
    const { link } = await readJson(c.req.raw, reviewLinkSchema, 2 * 1024);
    const { reviewRequests, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    const before = reviewRequests.settings().link.manual;
    const settings = reviewRequests.setLink(link);
    if (link !== null && link !== before) auth.events.record("review_link_changed", client(c), { alert: true });
    await deps().rearm();
    return Response.json(settings);
  });

  /** "Buscar no perfil": the profiles read from Google again, their review links with them. */
  app.post("/reviews/requests/link/refresh", async () => {
    await owner(() => deps().reviews.listLocations());
    return Response.json(deps().reviewRequests.settings());
  });

  /** The message and "Quando pedir". */
  app.patch("/reviews/requests/settings", async (c) => {
    const input = await readJson(c.req.raw, reviewRequestSettingsSchema, 4 * 1024);
    const settings = deps().reviewRequests.update(input);
    await deps().rearm();
    return Response.json(settings);
  });

  /** "Enviar link de avaliação" or "Lembrar pelo WhatsApp": the text and the number for the owner's WhatsApp. */
  app.post("/reviews/requests/:id/send", async (c) => {
    const id = c.req.param("id") ?? "";
    if (!ID.test(id)) throw new AppError("NOT_FOUND", "error.reviewRequestNotFound");
    return Response.json(await deps().reviewRequests.send(id));
  });

  /** "É esta", "É ele" (a contact), "Nenhuma das duas", "Não é" or undoing a link (null). */
  app.post("/reviews/:id/match", async (c) => {
    const id = reviewId(c);
    const { contactId } = await readJson(c.req.raw, reviewMatchSchema, 1024);
    const { reviews, reviewMatches } = deps();
    if (!(await reviews.review(id))) throw new AppError("NOT_FOUND", "error.reviewNotFound");
    reviewMatches.decide(id, contactId);
    return Response.json({ review: await reviews.review(id) });
  });

  app.post("/reviews/:id/draft", async (c) => Response.json({ review: await owner(() => deps().reviews.redraft(reviewId(c))) }));

  app.post("/reviews/:id/approve", async (c) => {
    const id = reviewId(c);
    const input = await readJson(c.req.raw, reviewApproveSchema, 8 * 1024);
    return Response.json({ review: await owner(() => deps().reviews.approve(id, input, "app")) });
  });

  app.post("/reviews/:id/resolve", async (c) => Response.json({ review: await deps().reviews.resolve(reviewId(c), "app") }));

  app.post("/reviews/:id/discard", async (c) => Response.json({ review: await deps().reviews.discard(reviewId(c), "app") }));

  /** Deletes the reply Zuri published (the screen asks first); never anyone else's. */
  app.delete("/reviews/:id/reply", async (c) => Response.json({ review: await owner(() => deps().reviews.deleteReply(reviewId(c), "app")) }));
}
