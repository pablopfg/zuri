import { OUTBOX_ID, outboxListQuerySchema } from "@zuri/shared";
import type { Hono } from "hono";
import type { AuthService } from "../auth/service.ts";
import type { Outbox } from "../crm/outbox.ts";
import { AppError } from "../http/errors.ts";
import { parse } from "../productivity/validate.ts";
import type { ApiEnv } from "./app.ts";

export interface OutboxRouteDeps {
  outbox: Outbox;
  auth: AuthService;
  rearm: () => Promise<void>;
}

function outboxId(value: string): string {
  if (!OUTBOX_ID.test(value)) throw new AppError("NOT_FOUND", "error.outboxNotFound");
  return value;
}

/**
 * CRM › Envios (PR S19), after the session check. Reading never returns a
 * text or a phone. Pausing asks for nothing; resuming after a stop by the
 * breaker takes the password typed recently (resuming the owner's own pause
 * doesn't); "Tentar de novo" puts one failed message back with the same key.
 * None of these is in WHILE_LOCKDOWN: with the lockdown on, nothing goes.
 */
export function registerOutboxRoutes(app: Hono<ApiEnv>, deps: () => OutboxRouteDeps): void {
  app.get("/outbox/status", () => Response.json(deps().outbox.status()));

  app.get("/outbox", (c) => Response.json(deps().outbox.list(parse(outboxListQuerySchema, c.req.query()))));

  app.get("/outbox/:id", (c) => Response.json(deps().outbox.detail(outboxId(c.req.param("id")))));

  app.post("/outbox/pause", async () => {
    const { outbox, rearm } = deps();
    outbox.pause();
    await rearm();
    return Response.json(outbox.status());
  });

  app.post("/outbox/resume", async (c) => {
    const { outbox, auth, rearm } = deps();
    if (outbox.stopped()) auth.requireRecentAuth(c.get("session"));
    outbox.resume();
    await rearm();
    return Response.json(outbox.status());
  });

  app.post("/outbox/:id/retry", async (c) => {
    const id = outboxId(c.req.param("id"));
    const { outbox, rearm } = deps();
    outbox.retry(id);
    await rearm();
    return Response.json(outbox.detail(id));
  });
}
