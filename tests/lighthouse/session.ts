import type { APIRequestContext } from "@playwright/test";
import { CSRF } from "../e2e/ui-helpers.ts";

/**
 * Whether the browser still holds the owner's session, asked of the server.
 * Each check opens a connection of its own (issue #336): between two checks a
 * Lighthouse run keeps the connection idle for about as long as wrangler dev
 * keeps an idle one open (15 s), and a request sent on it as the server closes
 * it fails with ECONNRESET before any answer.
 */
export async function hasSession(request: APIRequestContext, baseURL: string): Promise<boolean> {
  const session = await request.get(`${baseURL}/api/auth/session`, { headers: { ...CSRF, connection: "close" } });
  return session.status() === 200;
}
