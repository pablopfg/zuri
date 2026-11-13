import { CHATWOOT_OWNER_LIMITS, hmacSha256Hex, timingSafeEqualText } from "@zuri/shared";

/**
 * The return of the owner's inbox in the Chatwoot (docs/planos/zuri-no-chatwoot.md):
 * `/api/chatwoot/owner/hook/<link id>/<token>`. The token is the HMAC of
 * SESSION_SECRET and the link's id, as the Google push token: the Worker checks
 * it before the notice costs an object request (P6), and nothing is stored.
 * The notice's own signature (`X-Chatwoot-Signature`) is checked in the object,
 * where the inbox's secret is kept.
 */
export const CHATWOOT_HOOK_PREFIX = "/api/chatwoot/owner/hook/";
export const CHATWOOT_SIGNATURE_HEADER = "x-chatwoot-signature";
export const CHATWOOT_TIMESTAMP_HEADER = "x-chatwoot-timestamp";
export const CHATWOOT_DELIVERY_HEADER = "x-chatwoot-delivery";

const HOOK = /^\/api\/chatwoot\/owner\/hook\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{64})$/;

/** The link id and token of a return path; null for anything else. */
export function chatwootHookPath(pathname: string): { linkId: string; token: string } | null {
  const match = HOOK.exec(pathname);
  return match ? { linkId: match[1] as string, token: match[2] as string } : null;
}

export function chatwootHookToken(sessionSecret: string, linkId: string): Promise<string> {
  return hmacSha256Hex(sessionSecret, `zuri:chatwoot-owner:v1:${linkId}`);
}

/** Constant-time check of the token in the path. */
export async function isChatwootHookToken(linkId: string, token: string, sessionSecret: string): Promise<boolean> {
  return timingSafeEqualText(token, await chatwootHookToken(sessionSecret, linkId));
}

/** The whole return address the inbox is given. */
export async function chatwootHookUrl(origin: string, sessionSecret: string, linkId: string): Promise<string> {
  return `${origin}${CHATWOOT_HOOK_PREFIX}${linkId}/${await chatwootHookToken(sessionSecret, linkId)}`;
}

/**
 * The signature's shape and its time, before the object wakes (SEC-A9-xx-5): a notice older than the
 * window, or without a signature that could be one, is refused in the Worker. The object checks the
 * HMAC itself with the inbox's secret.
 */
export function plausibleChatwootNotice(signature: string | null, timestamp: string | null, now: number): boolean {
  if (!signature || !/^sha256=[0-9a-f]{64}$/.test(signature) || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  return Math.abs(now - Number(timestamp) * 1000) <= CHATWOOT_OWNER_LIMITS.signatureSkewMs;
}
