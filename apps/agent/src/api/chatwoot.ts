import {
  CHATWOOT_OWNER_LIMITS,
  chatwootOwnerCheckSchema,
  chatwootOwnerKeySchema,
  chatwootOwnerRepairSchema,
  chatwootOwnerSetupSchema,
  chatwootOwnerUpdateSchema,
} from "@zuri/shared";
import type { Context, Hono } from "hono";
import type { ClientInfo } from "../auth/client.ts";
import type { AuthService } from "../auth/service.ts";
import type { ChatwootOwner } from "../chatwoot/owner-service.ts";
import { CHATWOOT_DELIVERY_HEADER, CHATWOOT_SIGNATURE_HEADER, CHATWOOT_TIMESTAMP_HEADER, isChatwootHookToken } from "../gates/chatwoot-owner.ts";
import { AppError } from "../http/errors.ts";
import type { ApiEnv } from "./app.ts";
import { readBodyLimited, readJson } from "./http.ts";

export interface ChatwootRouteDeps {
  owner: ChatwootOwner;
  auth: AuthService;
}

/** The bodies carry an address, a number and a key: well under this. */
const BODY_MAX = 4 * 1024;

/**
 * The return of the owner's inbox (docs/planos/zuri-no-chatwoot.md), registered
 * before the CSRF and session checks: the Chatwoot has neither. The Worker
 * already checked the token in the path and the size; this checks both again,
 * in case a request ever reaches the object another way. The service checks
 * the signature with the inbox's secret and answers at once.
 */
export function registerChatwootHook(app: Hono<ApiEnv>, deps: () => ChatwootRouteDeps): void {
  app.post("/chatwoot/owner/hook/:id/:token", async (c) => {
    const linkId = c.req.param("id");
    const token = c.req.param("token");
    if (!/^[0-9a-f-]{36}$/.test(linkId) || !/^[0-9a-f]{64}$/.test(token) || !(await isChatwootHookToken(linkId, token, c.env.SESSION_SECRET))) {
      await c.req.raw.body?.cancel();
      throw new AppError("FORBIDDEN");
    }
    let raw: string;
    try {
      raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(await readBodyLimited(c.req.raw, CHATWOOT_OWNER_LIMITS.hookBodyMax));
    } catch {
      // Too large or not text: dropped, with a 200 (the Chatwoot never repeats a notice).
      return new Response(null, { status: 200 });
    }
    const status = await deps().owner.receive(linkId, raw, {
      signature: c.req.header(CHATWOOT_SIGNATURE_HEADER) ?? null,
      timestamp: c.req.header(CHATWOOT_TIMESTAMP_HEADER) ?? null,
      delivery: c.req.header(CHATWOOT_DELIVERY_HEADER) ?? null,
    });
    return new Response(null, { status });
  });
}

/**
 * Settings › Chatwoot, after the session check (signed in, CSRF, the owner's
 * Origin). Anything that creates, links or changes the inbox asks for the
 * password typed recently; the administrator's key arrives in the body of the
 * request that uses it and is never kept, logged or returned. None of these is
 * in WHILE_LOCKDOWN.
 */
export function registerChatwootRoutes(app: Hono<ApiEnv>, deps: () => ChatwootRouteDeps, client: (c: Context<ApiEnv>) => ClientInfo): void {
  app.get("/chatwoot/owner", () => Response.json(deps().owner.status()));

  app.post("/chatwoot/owner/check", async (c) => {
    const input = await readJson(c.req.raw, chatwootOwnerCheckSchema, BODY_MAX);
    const { owner, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    return Response.json({ profile: await owner.check(input) });
  });

  app.post("/chatwoot/owner/setup", async (c) => {
    const input = await readJson(c.req.raw, chatwootOwnerSetupSchema, BODY_MAX);
    const { owner, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    return Response.json(await owner.setup(input), { status: 201 });
  });

  // Another code for the same account: nothing changes who is answered, so no password.
  app.post("/chatwoot/owner/code", async () => Response.json(await deps().owner.newCode()));

  app.post("/chatwoot/owner/relink", async (c) => {
    const { owner, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    return Response.json(await owner.relink());
  });

  app.post("/chatwoot/owner/confirm", async (c) => {
    const { owner, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    const status = owner.confirm();
    auth.events.record("chatwoot_owner_linked", client(c), { alert: true });
    return Response.json(status);
  });

  // Turning off asks for nothing (it only stops); turning on lets the inbox reach the agent again.
  app.patch("/chatwoot/owner", async (c) => {
    const input = await readJson(c.req.raw, chatwootOwnerUpdateSchema, 256);
    const { owner, auth } = deps();
    if (input.enabled) auth.requireRecentAuth(c.get("session"));
    return Response.json(owner.setEnabled(input.enabled));
  });

  // The read lock (as the bot's): opening reading from the inbox asks for the password typed recently.
  app.post("/chatwoot/owner/unlock", async (c) => {
    const { owner, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    const status = owner.unlock();
    auth.events.record("chatwoot_owner_unlocked", client(c), { alert: true });
    return Response.json(status);
  });

  // Forgetting only stops Zuri (the inbox stays in the Chatwoot), but it drops the kept access for good,
  // as unlinking the bot does: the password typed recently.
  app.delete("/chatwoot/owner", (c) => {
    const { owner, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    owner.forget();
    auth.events.record("chatwoot_owner_removed", client(c));
    return new Response(null, { status: 204 });
  });

  app.post("/chatwoot/owner/test", async () => Response.json(await deps().owner.test()));

  app.post("/chatwoot/owner/test/full", async (c) => {
    const input = await readJson(c.req.raw, chatwootOwnerKeySchema, BODY_MAX);
    const { owner, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    return Response.json(await owner.fullTest(input.adminKey));
  });

  app.post("/chatwoot/owner/rotate", async (c) => {
    const input = await readJson(c.req.raw, chatwootOwnerKeySchema, BODY_MAX);
    const { owner, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    const test = await owner.rotate(input.adminKey);
    auth.events.record("chatwoot_owner_changed", client(c), { alert: true });
    return Response.json(test);
  });

  app.post("/chatwoot/owner/repair", async (c) => {
    const input = await readJson(c.req.raw, chatwootOwnerRepairSchema, BODY_MAX);
    const { owner, auth } = deps();
    auth.requireRecentAuth(c.get("session"));
    const status = await owner.repair(input);
    auth.events.record("chatwoot_owner_changed", client(c), { alert: true });
    return Response.json(status);
  });
}
