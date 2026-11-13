import { catalogAddSchema } from "@zuri/shared";
import type { Hono } from "hono";
import type { ModelCatalogService } from "../ai/catalog.ts";
import type { ApiEnv } from "./app.ts";
import { readJson } from "./http.ts";

/**
 * The catalog of models (PR S21), after the session check: the card in
 * Settings › Modelos e limites. Putting a model on the list changes nothing
 * the AI does until the owner picks it and saves, so it asks for no password,
 * like choosing a free model.
 */
export function registerModelCatalogRoutes(app: Hono<ApiEnv>, catalog: () => ModelCatalogService): void {
  app.get("/ai/catalog", () => Response.json(catalog().view()));

  app.post("/ai/catalog/check", async () => Response.json(await catalog().checkNow()));

  app.post("/ai/catalog/models", async (c) => {
    const { id } = await readJson(c.req.raw, catalogAddSchema, 1024);
    return Response.json(catalog().add(id));
  });
}
