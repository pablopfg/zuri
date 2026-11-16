import { confirmAnswerSchema, confirmLinkRequestSchema, confirmSentSchema, confirmViewSchema, rescheduleDaysSchema, rescheduleOfferSchema, rescheduleSchema } from "@zuri/shared";
import type { Context, Hono } from "hono";
import type { ClientInfo } from "../auth/client.ts";
import { AppError } from "../http/errors.ts";
import type { ApiEnv } from "./app.ts";
import type { GoogleRouteDeps } from "./google.ts";
import { toAppError } from "../google/errors.ts";
import { readJson } from "./http.ts";

/**
 * The patient's confirmation link (E7a, docs/planos/link-de-confirmacao.md). No session: the token,
 * in the JSON body (never in an address or a log), is the key. Registered after the CSRF check, so
 * only the Zuri's own page can post, and before the session one.
 */
export function registerConfirmPublic(app: Hono<ApiEnv>, deps: () => GoogleRouteDeps, client: (c: Context<ApiEnv>) => ClientInfo): void {
  app.post("/c/view", async (c) => {
    const { token } = await readJson(c.req.raw, confirmViewSchema, 1024);
    return Response.json(await deps().confirmLinks.view(token, client(c).network));
  });

  app.post("/c/answer", async (c) => {
    const { token, action } = await readJson(c.req.raw, confirmAnswerSchema, 1024);
    return Response.json(await deps().confirmLinks.answer(token, action, client(c).network));
  });

  // Rescheduling by the link (E7b): the days, a half's slots, and the move.
  app.post("/c/days", async (c) => {
    const { token } = await readJson(c.req.raw, rescheduleDaysSchema, 1024);
    return Response.json(await deps().confirmLinks.days(token, client(c).network));
  });

  app.post("/c/offer", async (c) => {
    const input = await readJson(c.req.raw, rescheduleOfferSchema, 1024);
    return Response.json(await deps().confirmLinks.offer(input, client(c).network));
  });

  app.post("/c/reschedule", async (c) => {
    const input = await readJson(c.req.raw, rescheduleSchema, 1024);
    return Response.json(await deps().confirmLinks.reschedule(input, client(c).network));
  });
}

/** The owner's side, in the Agenda's details: the state of a link, and the link itself (made the first time). */
export function registerConfirmOwner(app: Hono<ApiEnv>, deps: () => GoogleRouteDeps): void {
  app.get("/google/events/link", (c) => {
    const query = confirmLinkRequestSchema.safeParse({ calendarId: c.req.query("calendarId"), eventId: c.req.query("eventId") });
    if (!query.success) throw new AppError("VALIDATION_FAILED");
    return Response.json(deps().confirmLinks.status(query.data.calendarId, query.data.eventId));
  });

  app.post("/google/events/link", async (c) => {
    const input = await readJson(c.req.raw, confirmLinkRequestSchema, 4 * 1024);
    try {
      return Response.json(await deps().confirmLinks.link(input.calendarId, input.eventId));
    } catch (error) {
      throw toAppError(error);
    }
  });

  // E7c2: "Enviar por e-mail", to the e-mail kept on the appointment; the body never names a recipient.
  app.post("/google/events/link/mail", async (c) => {
    const input = await readJson(c.req.raw, confirmLinkRequestSchema, 4 * 1024);
    try {
      return Response.json(await deps().confirmLinks.mail(input.calendarId, input.eventId));
    } catch (error) {
      throw toAppError(error);
    }
  });

  // E7c1: the owner sent the confirmation by the WhatsApp button, for the appointment's current start.
  app.post("/google/events/link/sent", async (c) => {
    const input = await readJson(c.req.raw, confirmSentSchema, 4 * 1024);
    try {
      return Response.json(await deps().confirmLinks.sent(input.calendarId, input.eventId, input.channel));
    } catch (error) {
      throw toAppError(error);
    }
  });
}
