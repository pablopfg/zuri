import { BACKUP_IMPORT_MAX_BYTES, BACKUP_IMPORT_PATH, CSRF_HEADER, DEV_SESSION_COOKIE, NOTE_BODY_MAX_BYTES, SESSION_COOKIE, VOICE_BASE64_MAX } from "@zuri/shared";
import { readBodyLimited } from "../api/http.ts";

/** The voice clip route (api/chat.ts); with the backup import, the only ones that read more than a note. */
export const VOICE_PATH = "/api/transcribe";

/** A voice clip, base64 in JSON: the most the Worker reads, and only on VOICE_PATH. */
export const VOICE_BODY_MAX_BYTES = VOICE_BASE64_MAX + 1024;

/** The most any other route reads: a note (api/productivity.ts). */
export const API_BODY_MAX_BYTES = NOTE_BODY_MAX_BYTES;

/** How much the Worker reads for a request, before anyone knows who is asking. */
export function bodyLimitFor(pathname: string, headers?: Headers): number {
  const path = pathname.replace(/\/+$/, "");
  if (path === VOICE_PATH) return VOICE_BODY_MAX_BYTES;
  // A backup file to import (step 23): 10 MB, the spec's ceiling, read only on this path and only
  // for a request that could be the owner's (a session cookie and the CSRF header): anyone else
  // gets the small ceiling, so an anonymous caller can't make the Worker hold 10 MB (SEC-A1-01).
  if (path === BACKUP_IMPORT_PATH && headers && mayBeOwner(headers)) return BACKUP_IMPORT_MAX_BYTES;
  return API_BODY_MAX_BYTES;
}

function mayBeOwner(headers: Headers): boolean {
  if (headers.get(CSRF_HEADER) !== "1") return false;
  const cookies = (headers.get("cookie") ?? "").split(";").map((part) => part.trim().split("=", 1)[0]);
  return cookies.includes(SESSION_COOKIE) || cookies.includes(DEV_SESSION_COOKIE);
}

/**
 * The request with its body already read here, whole. Handed over as a stream,
 * the runtime keeps pumping the client's body into the object even after the
 * object answered without reading it (a refused sign-in, CSRF, no session); once
 * this Worker's response has gone out, that pump fails with "Can't read from
 * request stream after response has been sent", an uncaught error in the log.
 * A body in memory has no pump left behind. API bodies are small JSON, and one
 * over what its route can read is refused here, before it costs an object request.
 */
export async function withBodyRead(request: Request): Promise<Request> {
  if (!request.body) return request;
  return new Request(request, { body: await readBodyLimited(request, bodyLimitFor(new URL(request.url).pathname, request.headers)) });
}
