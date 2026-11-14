import { type Locale, t } from "@zuri/shared";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { ClientInfo } from "../auth/client.ts";
import type { AuthService } from "../auth/service.ts";
import { toAppError } from "../google/errors.ts";
import type { MailService } from "../mail/service.ts";
import type { ApiEnv } from "./app.ts";
import { readJson } from "./http.ts";

/**
 * E-mail to patients (E6c): only the owner's session reads, changes and tests it. No tool of the
 * agent and no command of the bot reaches these routes; the password never comes back.
 */
export interface MailRouteDeps {
  mail: MailService;
  /** Google's page to add gmail.send to the calendar's grant. */
  gmailConnect: (session: string) => Promise<string>;
  auth: AuthService;
  development: () => boolean;
  locale: () => Locale;
}

/** Parsed again, field by field, by mailSaveSchema in MailService. */
const saveBody = /* @__PURE__ */ z.record(z.string(), z.unknown());

export function registerMailRoutes(app: Hono<ApiEnv>, deps: () => MailRouteDeps, client: (c: Context<ApiEnv>) => ClientInfo): void {
  app.get("/mail", () => Response.json(deps().mail.status()));

  /** Every change asks for the password typed recently: the sender, the Reply-to and the server decide where patients' e-mail and answers go. */
  app.put("/mail", async (c) => {
    const input = await readJson(c.req.raw, saveBody, 8 * 1024);
    const { mail, auth, development } = deps();
    auth.requireRecentAuth(c.get("session"));
    const { sensitive } = await mail.save(input, { development: development() });
    if (sensitive) auth.events.record("mail_changed", client(c), { alert: true });
    return Response.json(mail.status());
  });

  /** Google's page to allow only the sending (gmail.send), joined to the connection of the Agenda. */
  app.post("/mail/gmail/connect", async (c) => {
    const { auth, gmailConnect } = deps();
    auth.requireRecentAuth(c.get("session"));
    try {
      return Response.json({ url: await gmailConnect(c.get("session").id) });
    } catch (error) {
      throw toAppError(error);
    }
  });

  /** "Enviar teste para você": only to the owner's e-mail, 3 in 10 minutes, inside the daily cap. */
  app.post("/mail/test", async () => {
    const { mail, locale } = deps();
    const language = locale();
    const test = await mail.test({ subject: t(language, "mail.test.subject"), text: t(language, "mail.test.text") });
    return Response.json({ test, status: mail.status() });
  });
}
