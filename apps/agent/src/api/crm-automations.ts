import { CRM_AUTOMATION_DAY, crmAutomationConfigSchema, crmAutomationDaySchema, crmAutomationModeSchema, crmAutomationWatchSchema } from "@zuri/shared";
import type { Hono } from "hono";
import type { AuthService } from "../auth/service.ts";
import type { CrmAutomations } from "../crm/automations/service.ts";
import { AppError } from "../http/errors.ts";
import type { ApiEnv } from "./app.ts";
import { readJson } from "./http.ts";

export interface CrmAutomationRouteDeps {
  automations: CrmAutomations;
  auth: AuthService;
  rearm: () => Promise<void>;
}

const ID = /^[a-z][a-z0-9-]{1,39}$/;

function automationId(value: string): string {
  if (!ID.test(value)) throw new AppError("NOT_FOUND", "error.crmAutomationNotFound");
  return value;
}

/**
 * The CRM's automations (PR S18), after the session check. Only the screen
 * reaches them: no tool, no bot command. Saving the credential and the options,
 * starting the rehearsal and going live take the password typed recently;
 * turning off, checking a day and "Avisar quando chegar" ask for nothing (none
 * sends anything out). None of these is in WHILE_LOCKDOWN.
 */
export function registerCrmAutomationRoutes(app: Hono<ApiEnv>, deps: () => CrmAutomationRouteDeps): void {
  app.get("/crm/automations", () => Response.json(deps().automations.list()));

  app.put("/crm/automations/:id/config", async (c) => {
    const id = automationId(c.req.param("id"));
    const input = await readJson(c.req.raw, crmAutomationConfigSchema, 4 * 1024);
    const { automations, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    automations.configure(id, input);
    return Response.json({ automation: automations.list().automations.find((item) => item.id === id) });
  });

  app.post("/crm/automations/:id/mode", async (c) => {
    const id = automationId(c.req.param("id"));
    const input = await readJson(c.req.raw, crmAutomationModeSchema, 1024);
    const { automations, auth, rearm } = deps();
    if (input.mode !== "off") auth.requireRecentAuth(c.get("session"));
    automations.setMode(id, input.mode, input.acceptRisk === true);
    await rearm();
    return Response.json({ automation: automations.list().automations.find((item) => item.id === id) });
  });

  app.get("/crm/automations/:id/activity", (c) => Response.json(deps().automations.activity(automationId(c.req.param("id")))));

  app.put("/crm/automations/:id/days/:day", async (c) => {
    const id = automationId(c.req.param("id"));
    const day = c.req.param("day");
    if (!CRM_AUTOMATION_DAY.test(day)) throw new AppError("VALIDATION_FAILED", "error.crmAutomationDay", { fields: ["day"] });
    const input = await readJson(c.req.raw, crmAutomationDaySchema, 2 * 1024);
    const { automations } = deps();
    automations.checkDay(id, day, input);
    return Response.json({ automation: automations.list().automations.find((item) => item.id === id) });
  });

  app.put("/crm/automations/:id/watch", async (c) => {
    const id = automationId(c.req.param("id"));
    const input = await readJson(c.req.raw, crmAutomationWatchSchema, 256);
    deps().automations.watch(id, input.watch);
    return Response.json({ watch: input.watch });
  });
}
