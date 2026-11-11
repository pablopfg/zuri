import {
  CRM_LIMITS,
  crmClientCreateSchema,
  crmClientsQuerySchema,
  crmClientUpdateSchema,
  crmNoteSchema,
  crmSettingsSchema,
  crmStagesSchema,
  RECORD_ID,
} from "@zuri/shared";
import type { Hono } from "hono";
import type { CrmService } from "../crm/service.ts";
import { AppError } from "../http/errors.ts";
import { parse } from "../productivity/validate.ts";
import type { ApiEnv } from "./app.ts";
import { readJson } from "./http.ts";

export interface CrmRouteDeps {
  crm: CrmService;
  /** Sets the shared alarm again after a follow-up or the birthday notices changed. */
  rearm: () => Promise<void>;
}

const BODY_MAX = 16 * 1024;

function clientId(value: string): string {
  if (!RECORD_ID.test(value)) throw new AppError("NOT_FOUND", "error.crmClientNotFound");
  return value;
}

/**
 * The CRM's routes (step 22b), after the session check: the owner's everyday
 * work. None of these is in WHILE_LOCKDOWN.
 */
export function registerCrmRoutes(app: Hono<ApiEnv>, deps: () => CrmRouteDeps): void {
  app.get("/crm", () => {
    const { crm } = deps();
    return Response.json({ stages: crm.stages(), tags: crm.tags(), summary: crm.summary(), settings: crm.settings(), limits: { clients: CRM_LIMITS.clients } });
  });

  app.get("/crm/clients", (c) => Response.json(deps().crm.list(parse(crmClientsQuerySchema, c.req.query()))));

  app.post("/crm/clients", async (c) => {
    const input = await readJson(c.req.raw, crmClientCreateSchema, BODY_MAX);
    const { crm, rearm } = deps();
    const created = crm.create(input, "app");
    await rearm();
    return Response.json({ client: created }, { status: 201 });
  });

  app.get("/crm/clients/:id", (c) => {
    const found = deps().crm.get(clientId(c.req.param("id")));
    if (!found) throw new AppError("NOT_FOUND", "error.crmClientNotFound");
    return Response.json({ client: found });
  });

  app.patch("/crm/clients/:id", async (c) => {
    const id = clientId(c.req.param("id"));
    const input = await readJson(c.req.raw, crmClientUpdateSchema, BODY_MAX);
    const { crm, rearm } = deps();
    const updated = crm.update(id, input);
    await rearm();
    return Response.json({ client: updated });
  });

  app.delete("/crm/clients/:id", (c) => {
    deps().crm.remove(clientId(c.req.param("id")));
    return Response.json({ deleted: true });
  });

  app.post("/crm/clients/:id/notes", async (c) => {
    const id = clientId(c.req.param("id"));
    const input = await readJson(c.req.raw, crmNoteSchema, BODY_MAX);
    return Response.json({ entry: deps().crm.note(id, "note", input.text) }, { status: 201 });
  });

  app.patch("/crm/stages", async (c) => {
    const input = await readJson(c.req.raw, crmStagesSchema, BODY_MAX);
    return Response.json({ stages: deps().crm.setStages(input.stages) });
  });

  app.patch("/crm/settings", async (c) => {
    const input = await readJson(c.req.raw, crmSettingsSchema, 1024);
    const { crm, rearm } = deps();
    const settings = crm.updateSettings(input);
    await rearm();
    return Response.json({ settings });
  });
}
