import { homeSuggestionIdSchema } from "@zuri/shared";
import type { Hono } from "hono";
import type { HomeSuggestionService } from "../home/suggestions.ts";
import { AppError } from "../http/errors.ts";
import type { ApiEnv } from "./app.ts";

/**
 * The home page's suggestions (PR S22), after the session check. Reading
 * picks up to three by the rules; a tap only counts its kind. Nothing here
 * sends or does anything: the suggestion fills the field, the owner sends.
 */
export function registerHomeRoutes(app: Hono<ApiEnv>, home: () => HomeSuggestionService): void {
  app.get("/home/suggestions", () => Response.json(home().list()));

  app.post("/home/suggestions/:id/used", (c) => {
    const id = homeSuggestionIdSchema.safeParse(c.req.param("id"));
    if (!id.success) throw new AppError("NOT_FOUND");
    home().used(id.data);
    return new Response(null, { status: 204 });
  });
}
