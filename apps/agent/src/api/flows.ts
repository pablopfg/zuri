import { CHATWOOT_FREE_FIELDS, flowCreateSchema, flowSettingsSchema, flowUpdateSchema, RECORD_ID } from "@zuri/shared";
import { z } from "zod";
import type { Context, Hono } from "hono";
import type { ClientInfo } from "../auth/client.ts";
import type { AuthService } from "../auth/service.ts";
import type { FlowConnections } from "../flows/connections.ts";
import type { FlowService } from "../flows/service.ts";
import { AppError } from "../http/errors.ts";
import type { ApiEnv } from "./app.ts";
import { readJson } from "./http.ts";

export interface FlowRouteDeps {
  flows: FlowService;
  connections: FlowConnections;
  auth: AuthService;
  development: () => boolean;
}

/** A credential's body: an object, parsed again by the schema of its kind in FlowConnections. */
const connectionBody = /* @__PURE__ */ z.record(z.string(), z.unknown());

/** The bodies are small: a whole flow of 20 steps fits well under this. */
const BODY_MAX = 64 * 1024;

function flowId(value: string): string {
  if (!RECORD_ID.test(value)) throw new AppError("NOT_FOUND", "error.flowNotFound");
  return value;
}

function connectionId(value: string): string {
  if (!RECORD_ID.test(value)) throw new AppError("NOT_FOUND", "error.flowConnectionNotFound");
  return value;
}

/**
 * The flows (step 22a), after the session check: signed in, CSRF header, the
 * owner's Origin. These routes are the only way a flow, a connection or a
 * monitored address is made or changed: no tool, no bot command and no remote
 * token reaches them. Making, changing and turning on take the password typed
 * recently; a connection made or changed also tells the owner, since it opens
 * a way for data to leave. None of these is in WHILE_LOCKDOWN.
 */
export function registerFlowRoutes(app: Hono<ApiEnv>, deps: () => FlowRouteDeps, client: (c: Context<ApiEnv>) => ClientInfo): void {
  app.get("/flows", () => Response.json(deps().flows.list()));

  app.post("/flows", async (c) => {
    const input = await readJson(c.req.raw, flowCreateSchema, BODY_MAX);
    const { flows, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    return Response.json({ flow: await flows.create(input) }, { status: 201 });
  });

  app.get("/flows/runs", (c) => Response.json(deps().flows.runs(c.req.query())));

  // Before "/flows/:id". No password: every number stays inside FLOW_LIMITS and none sends data anywhere; a change goes to the activity log.
  app.patch("/flows/settings", async (c) => {
    const input = await readJson(c.req.raw, flowSettingsSchema, 1024);
    return Response.json({ settings: deps().flows.updateSettings(input) });
  });

  app.patch("/flows/:id", async (c) => {
    const id = flowId(c.req.param("id"));
    const input = await readJson(c.req.raw, flowUpdateSchema, BODY_MAX);
    const { flows, auth } = deps();
    // Turning off asks for nothing (it only stops); anything else may send data out.
    const onlyOff = Object.keys(input).length === 1 && input.enabled === false;
    if (!onlyOff) auth.requireRecentAuth(c.get("session"));
    return Response.json({ flow: await flows.update(id, input) });
  });

  app.delete("/flows/:id", async (c) => {
    await deps().flows.remove(flowId(c.req.param("id")));
    return Response.json({ deleted: true });
  });

  // Running asks for no password, on or off (the owner's decision of 03/11/2026, risk accepted).
  app.post("/flows/:id/run", async (c) => Response.json({ run: await deps().flows.runNow(flowId(c.req.param("id"))) }));

  app.post("/flows/connections", async (c) => {
    const input = await readJson(c.req.raw, connectionBody, 16 * 1024);
    const { flows, connections, auth, development } = deps();
    auth.requireRecentAuth(c.get("session"));
    const id = await connections.create(input, { development: development() });
    auth.events.record("flow_connection_added", client(c), { alert: true });
    const connection = flows.list().connections.find((entry) => entry.id === id);
    return Response.json({ connection }, { status: 201 });
  });

  app.patch("/flows/connections/:id", async (c) => {
    const id = connectionId(c.req.param("id"));
    const input = await readJson(c.req.raw, connectionBody, 16 * 1024);
    const { flows, connections, auth, development } = deps();
    // The Chatwoot's waits alone ask for no password (not a secret; the change goes to the activity log).
    const keys = Object.keys(input);
    const onlyWaits = keys.length > 0 && keys.every((key) => CHATWOOT_FREE_FIELDS.includes(key)) && connections.row(id).kind === "chatwoot";
    if (!onlyWaits) auth.requireRecentAuth(c.get("session"));
    const { sensitive } = await connections.update(id, input, { development: development(), inboxes: flows.inboxLookup });
    if (sensitive) auth.events.record("flow_connection_changed", client(c), { alert: true });
    return Response.json({ connection: flows.list().connections.find((entry) => entry.id === id) });
  });

  // "Testar" (PR S17): reads only, at the address the owner already gave; no password.
  app.post("/flows/connections/:id/test", async (c) => Response.json({ test: await deps().flows.testConnection(connectionId(c.req.param("id"))) }));

  // The chat's suggestions (step 22b): saving one is POST /flows with its id; dropping one asks nothing.
  app.delete("/flows/drafts/:id", (c) => {
    const id = c.req.param("id");
    if (!RECORD_ID.test(id)) throw new AppError("NOT_FOUND", "error.flowDraftNotFound");
    deps().flows.removeDraft(id);
    return Response.json({ deleted: true });
  });

  app.delete("/flows/connections/:id", (c) => {
    deps().flows.removeConnection(connectionId(c.req.param("id")));
    return Response.json({ deleted: true });
  });
}
