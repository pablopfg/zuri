import { AGENT_IDS, type AgentId, agentConfigUpdateSchema, agentRestoreSchema } from "@zuri/shared";
import type { Context, Hono } from "hono";
import type { ClientInfo } from "../auth/client.ts";
import type { AuthService } from "../auth/service.ts";
import { AppError } from "../http/errors.ts";
import type { AgentConfigs } from "../specialists/configs.ts";
import type { ApiEnv } from "./app.ts";
import { readJson } from "./http.ts";

/** An agent's id from the path; anything else is not one. */
function agentId(value: string): AgentId {
  const id = AGENT_IDS.find((known) => known === value);
  if (!id) throw new AppError("NOT_FOUND");
  return id;
}

/**
 * The AI screen's agents (docs/planos/guardrails-especialistas-ia.md, PR 2).
 * Reading is open to the session; every change asks for the password typed in
 * the last minutes (requireRecentAuth). None of these routes is on the
 * lockdown's list (they answer 423 there) or in the remote tokens' allowlist.
 */
export function registerAgentRoutes(app: Hono<ApiEnv>, configs: () => AgentConfigs, auth: () => AuthService, client: (c: Context<ApiEnv>) => ClientInfo): void {
  // A change the owner didn't make (a session taken over, with the password typed recently) reaches them as a security alert.
  const changed = (c: Context<ApiEnv>, result: { view: unknown; changed: boolean }) => {
    if (result.changed) auth().events.record("agent_settings_changed", client(c), { alert: true });
    return Response.json(result.view);
  };

  app.get("/ai/agents", () => Response.json({ agents: configs().list() }));

  app.get("/ai/agents/:id/versions", (c) => Response.json({ versions: configs().versions(agentId(c.req.param("id"))) }));

  app.put("/ai/agents/:id", async (c) => {
    const id = agentId(c.req.param("id"));
    const input = await readJson(c.req.raw, agentConfigUpdateSchema, 8 * 1024);
    auth().requireRecentAuth(c.get("session"));
    return changed(c, configs().save(id, input));
  });

  app.post("/ai/agents/:id/restore", async (c) => {
    const id = agentId(c.req.param("id"));
    const target = await readJson(c.req.raw, agentRestoreSchema, 1024);
    auth().requireRecentAuth(c.get("session"));
    return changed(c, configs().restore(id, target));
  });
}
