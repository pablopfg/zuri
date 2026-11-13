import {
  CHATWOOT_LIMITS,
  type ChatwootSettings,
  chatwootConnectionCreateSchema,
  chatwootConnectionUpdateSchema,
  CHATWOOT_FREE_FIELDS,
  chatwootGapsProblem,
  FLOW_CONNECTION_KINDS,
  FLOW_LIMITS,
  type FlowAuthType,
  type FlowConnection,
  type FlowConnectionKind,
  type FlowGap,
  type FlowMethod,
  type FlowRunProblem,
  flowConnectionCreateSchema,
  flowConnectionUpdateSchema,
} from "@zuri/shared";
import { recordActivity } from "../db/activity.ts";
import type { Database } from "../db/database.ts";
import { AppError } from "../http/errors.ts";
import { McpCredentials } from "../mcp/credentials.ts";
import { limitBody, McpConnectionError } from "../mcp/guarded-fetch.ts";
import { assertPublicHost, endpointUrl, McpEndpointError, type Resolver } from "../mcp/url.ts";
import { parse } from "../productivity/validate.ts";
import { type Json, plain } from "./paths.ts";

export interface ConnectionRow {
  id: string;
  name: string;
  origin: string;
  methods: string;
  paths: string;
  auth: FlowAuthType;
  header_name: string | null;
  credential: string | null;
  /** Migration 38: 'http' for every row of before. */
  kind: string;
  /** The kind's settings as JSON (a Chatwoot's account, inbox and waits); never a secret. */
  meta: string | null;
  key_end: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The kinds of credential (PR S17) and what keeps them apart: each one seals its
 * key under its own `info`, so a key sealed for one kind never opens as
 * another. A kind added later (fzap, SMTP) gets a line here, its schemas in
 * packages/shared and its fixed client; the routes don't change.
 */
export const CONNECTION_KINDS: Record<FlowConnectionKind, { info: string; freeFields: readonly string[] }> = {
  http: { info: "flows-v1", freeFields: [] },
  // The waits are not a secret: changing only them asks for no password (it goes to the activity log).
  chatwoot: { info: "chatwoot-v1", freeFields: CHATWOOT_FREE_FIELDS },
  // The owner's conversation with Zuri (docs/planos/zuri-no-chatwoot.md): the inbox's public access and its
  // signing secret, sealed together. Only Settings › Chatwoot makes or opens it; no screen edits it here.
  "chatwoot-dono": { info: "chatwoot-dono-v1", freeFields: [] },
};

/** The kind kept apart from CRM › Credentials: never listed, changed or called by a flow. */
export const OWNER_KIND = "chatwoot-dono";

/** What the owner's inbox keeps sealed: the public API's access, the contact's identifier and the signing secret. */
export interface OwnerSecrets {
  inboxIdentifier: string;
  secret: string;
  hmacToken: string;
  identifier: string;
  sourceId: string;
}

const OWNER_FIELDS = ["inboxIdentifier", "secret", "hmacToken", "identifier", "sourceId"] as const;

/** The Chatwoot's key goes in this header (its API's own name). */
export const CHATWOOT_KEY_HEADER = "api_access_token";

/** A key shows its end only when it is long enough that 4 characters don't give it away. */
const KEY_END_FROM = 12;

export function knownKind(kind: string): FlowConnectionKind | null {
  return (FLOW_CONNECTION_KINDS as readonly string[]).includes(kind) ? (kind as FlowConnectionKind) : null;
}

function keyEnd(credential: string): string | null {
  return credential.length >= KEY_END_FROM ? credential.slice(-4) : null;
}

/** The Chatwoot settings of a row; the defaults where a value is missing or out of shape. */
export function chatwootSettings(row: Pick<ConnectionRow, "meta">): ChatwootSettings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.meta ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    // Kept as the defaults: a row edited by hand never breaks the list.
  }
  const int = (value: unknown, min: number, max: number) => (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null);
  const gap = (value: unknown, fallback: FlowGap): FlowGap => {
    const entry = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const min = int(entry.min, 0, CHATWOOT_LIMITS.bulkGap.ceiling);
    const max = int(entry.max, 0, CHATWOOT_LIMITS.bulkGap.ceiling);
    return min === null || max === null ? { min: fallback.min, max: fallback.max } : { min, max };
  };
  let bulkGap = gap(raw.bulkGap, CHATWOOT_LIMITS.bulkGap);
  let oneGap = gap(raw.oneGap, CHATWOOT_LIMITS.oneGap);
  if (chatwootGapsProblem(bulkGap, oneGap)) {
    bulkGap = { min: CHATWOOT_LIMITS.bulkGap.min, max: CHATWOOT_LIMITS.bulkGap.max };
    oneGap = { min: CHATWOOT_LIMITS.oneGap.min, max: CHATWOOT_LIMITS.oneGap.max };
  }
  const inboxId = int(raw.inboxId, 1, Number.MAX_SAFE_INTEGER);
  return {
    accountId: int(raw.accountId, 1, CHATWOOT_LIMITS.accountMax) ?? 1,
    inboxId,
    // Cut by characters, not UTF-16 units: half an emoji would show as a broken sign.
    inboxName: inboxId !== null && typeof raw.inboxName === "string" ? [...raw.inboxName].slice(0, CHATWOOT_LIMITS.inboxName).join("") : null,
    bulkGap,
    oneGap,
  };
}

/** A step that stopped. `transient`: worth another try later (a timeout, a 5xx, a 429). */
export class FlowStepError extends Error {
  constructor(
    readonly problem: FlowRunProblem,
    readonly transient = false,
    readonly httpStatus: number | null = null,
  ) {
    super(problem);
    this.name = "FlowStepError";
  }
}

/** The way out of the object, swapped in the tests and in local development. */
export interface FlowNetwork {
  fetch: typeof fetch;
  resolve: Resolver;
}

/** Counts the subrequests of a wake (rule P9); throwing refuses the request. */
export interface WakeMeter {
  room(n: number): boolean;
  take(): void;
}

/** What a request to a connection answered: its status and the body read as JSON (or text). */
export interface ConnectionAnswer {
  status: number;
  body: Json;
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const TEXT_KEPT = 2_000;

/** A path is allowed when an allowed prefix is the whole path or ends at a segment: `/v1` takes `/v1` and `/v1/x`, never `/v1x`. */
export function pathAllowed(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => {
    const base = prefix.length > 1 && prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return base === "/" || pathname === base || pathname.startsWith(`${base}/`);
  });
}

/**
 * The services flows may call (step 22a). Each one is an https origin with the
 * methods and path prefixes the owner allowed; its credential is sealed and
 * only opened to sign a request to that origin. Nothing here ever returns it.
 */
export class FlowConnections {
  readonly #vaults: Record<FlowConnectionKind, McpCredentials>;

  /** `secret` is MCP_CREDENTIAL_KEY; each kind derives its own key from it. */
  constructor(
    private readonly db: Database,
    secret: string | undefined,
    private readonly clock: () => number = Date.now,
  ) {
    this.#vaults = Object.fromEntries(FLOW_CONNECTION_KINDS.map((kind) => [kind, new McpCredentials(secret, CONNECTION_KINDS[kind].info)])) as Record<
      FlowConnectionKind,
      McpCredentials
    >;
  }

  get credentialsAvailable(): boolean {
    return this.#vaults.http.available;
  }

  // The owner's inbox (OWNER_KIND) is left out of every query a screen or a flow reaches.
  rows(): ConnectionRow[] {
    return this.db.all<ConnectionRow>(`SELECT * FROM zur_flow_connections WHERE kind != ? ORDER BY name COLLATE NOCASE, id LIMIT ?`, OWNER_KIND, FLOW_LIMITS.connections);
  }

  row(id: string): ConnectionRow {
    const row = this.find(id);
    if (!row) throw new AppError("NOT_FOUND", "error.flowConnectionNotFound");
    return row;
  }

  find(id: string): ConnectionRow | null {
    return this.db.one<ConnectionRow>(`SELECT * FROM zur_flow_connections WHERE id = ? AND kind != ?`, id, OWNER_KIND) ?? null;
  }

  // ---------- The owner's inbox in the Chatwoot (Settings › Chatwoot) ----------

  /** The one row of the owner's inbox, if any. */
  ownerRow(): ConnectionRow | null {
    return this.db.one<ConnectionRow>(`SELECT * FROM zur_flow_connections WHERE kind = ? ORDER BY created_at LIMIT 1`, OWNER_KIND) ?? null;
  }

  /** Keeps the owner's inbox: one row, replaced whole; the secrets sealed under the row's id. */
  async saveOwner(id: string, origin: string, secrets: OwnerSecrets): Promise<void> {
    const sealed = await this.seal(OWNER_KIND, id, JSON.stringify(Object.fromEntries(OWNER_FIELDS.map((field) => [field, secrets[field]]))));
    const at = new Date(this.clock()).toISOString();
    this.db.transaction(() => {
      this.db.run(`DELETE FROM zur_flow_connections WHERE kind = ? AND id != ?`, OWNER_KIND, id);
      this.db.run(
        `INSERT INTO zur_flow_connections (id, name, origin, methods, paths, auth, header_name, credential, kind, meta, key_end, created_at, updated_at)
         VALUES (?, 'Chatwoot', ?, '[]', '[]', 'none', NULL, ?, ?, NULL, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET origin = excluded.origin, credential = excluded.credential, updated_at = excluded.updated_at`,
        id,
        origin,
        sealed,
        OWNER_KIND,
        at,
        at,
      );
    });
  }

  /** The sealed secrets of the owner's inbox, or null when they can't be opened (another key, a row edited by hand). */
  async openOwner(row: ConnectionRow): Promise<OwnerSecrets | null> {
    if (row.kind !== OWNER_KIND || !row.credential) return null;
    const plain = await this.#vaults[OWNER_KIND].decrypt(row.id, row.credential);
    if (plain === null) return null;
    try {
      const parsed: unknown = JSON.parse(plain);
      if (!parsed || typeof parsed !== "object") return null;
      const record = parsed as Record<string, unknown>;
      if (!OWNER_FIELDS.every((field) => typeof record[field] === "string" && record[field] !== "")) return null;
      return Object.fromEntries(OWNER_FIELDS.map((field) => [field, record[field]])) as unknown as OwnerSecrets;
    } catch {
      return null;
    }
  }

  removeOwner(): void {
    this.db.run(`DELETE FROM zur_flow_connections WHERE kind = ?`, OWNER_KIND);
  }

  /** False without MCP_CREDENTIAL_KEY: the owner's inbox can't be kept. */
  get ownerAvailable(): boolean {
    return this.#vaults[OWNER_KIND].available;
  }

  /** `kind` picks the schema; left out, it is `http`, as every body of before. */
  async create(input: unknown, opts: { development: boolean }): Promise<string> {
    const kind = kindOfBody(input);
    const count = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_flow_connections WHERE kind != ?`, OWNER_KIND)?.n ?? 0;
    const id = crypto.randomUUID();
    const at = new Date(this.clock()).toISOString();
    if (kind === "chatwoot") {
      const data = parse(chatwootConnectionCreateSchema, input);
      checkOrigin(data.origin, opts.development);
      if (count >= FLOW_LIMITS.connections) throw new AppError("CONFLICT", "error.flowConnectionLimit", { limit: FLOW_LIMITS.connections });
      const settings = chatwootSettings({ meta: null });
      const meta = { ...settings, accountId: data.accountId, bulkGap: data.bulkGap ?? settings.bulkGap, oneGap: data.oneGap ?? settings.oneGap };
      const gaps = chatwootGapsProblem(meta.bulkGap, meta.oneGap);
      if (gaps) throw new AppError("VALIDATION_FAILED", "error.chatwootGaps", { fields: [gaps] });
      const credential = await this.seal("chatwoot", id, data.credential);
      this.db.run(
        `INSERT INTO zur_flow_connections (id, name, origin, methods, paths, auth, header_name, credential, kind, meta, key_end, created_at, updated_at) VALUES (?, ?, ?, '[]', '[]', 'header', ?, ?, 'chatwoot', ?, ?, ?, ?)`,
        id,
        data.name,
        data.origin,
        CHATWOOT_KEY_HEADER,
        credential,
        JSON.stringify(meta),
        keyEnd(data.credential),
        at,
        at,
      );
      recordActivity(this.db, "flow.connection_added", { auth: "header", kind });
      return id;
    }
    const data = parse(flowConnectionCreateSchema, input);
    checkOrigin(data.origin, opts.development);
    if (count >= FLOW_LIMITS.connections) throw new AppError("CONFLICT", "error.flowConnectionLimit", { limit: FLOW_LIMITS.connections });
    const withKey = data.auth !== "none" && data.credential ? data.credential : null;
    const credential = withKey ? await this.seal("http", id, withKey) : null;
    this.db.run(
      `INSERT INTO zur_flow_connections (id, name, origin, methods, paths, auth, header_name, credential, kind, key_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'http', ?, ?, ?)`,
      id,
      data.name,
      data.origin,
      JSON.stringify(data.methods),
      JSON.stringify(data.paths),
      data.auth,
      data.auth === "header" ? data.headerName : null,
      credential,
      withKey ? keyEnd(withKey) : null,
      at,
      at,
    );
    recordActivity(this.db, "flow.connection_added", { auth: data.auth, kind: "http" });
    return id;
  }

  /**
   * The row's kind picks the schema (a kind never changes). Another origin or
   * another kind of key needs the new key in the same change (PR S17): a kept
   * key never follows the credential to another service. `credential: null`
   * drops it.
   */
  async update(id: string, input: unknown, opts: { development: boolean; inboxes?: InboxLookup }): Promise<{ sensitive: boolean }> {
    const row = this.row(id);
    const kind = knownKind(row.kind);
    if (kind === "chatwoot") return this.updateChatwoot(row, input, opts);
    if (kind !== "http") throw new AppError("CONFLICT", "error.flowConnectionKind");
    const patch = parse(flowConnectionUpdateSchema, input);
    const origin = patch.origin ?? row.origin;
    const auth = patch.auth ?? row.auth;
    const headerName = auth === "header" ? (patch.headerName !== undefined ? patch.headerName : row.header_name) : null;
    if (auth === "header" && !headerName) throw new AppError("VALIDATION_FAILED", undefined, { fields: ["headerName"] });
    if (patch.origin !== undefined) checkOrigin(origin, opts.development);
    const moved = origin !== row.origin || auth !== row.auth;
    if (moved && auth !== "none" && row.credential !== null && patch.credential === undefined) {
      throw new AppError("VALIDATION_FAILED", "error.flowConnectionKeyAgain", { fields: ["credential"] });
    }
    let credential = moved ? null : row.credential;
    let end = moved ? null : row.key_end;
    if (patch.credential === null || auth === "none") {
      credential = null;
      end = null;
    } else if (patch.credential !== undefined) {
      credential = await this.seal("http", id, patch.credential);
      end = keyEnd(patch.credential);
    }
    const kept = this.db.run(
      `UPDATE zur_flow_connections SET name = ?, origin = ?, methods = ?, paths = ?, auth = ?, header_name = ?, credential = ?, key_end = ?, updated_at = ? WHERE id = ? AND updated_at = ?`,
      patch.name ?? row.name,
      origin,
      patch.methods ? JSON.stringify(patch.methods) : row.methods,
      patch.paths ? JSON.stringify(patch.paths) : row.paths,
      auth,
      headerName,
      credential,
      end,
      this.nextStamp(row.updated_at),
      id,
      row.updated_at,
    );
    // Sealing the key awaits: another change that came in meanwhile is never written over.
    if (kept.rowsWritten === 0) throw new AppError("CONFLICT");
    const sensitive = moved || patch.credential !== undefined || patch.methods !== undefined || patch.paths !== undefined || patch.headerName !== undefined;
    if (sensitive) recordActivity(this.db, "flow.connection_changed", { auth, kind: "http" });
    return { sensitive };
  }

  /**
   * A Chatwoot change. A new address or account needs the key again (the key
   * belongs to that server and that account) and drops the picked inbox; a new
   * inbox is checked against what the key sees, and its name kept. The waits
   * alone are not sensitive, but go to the activity log.
   */
  private async updateChatwoot(row: ConnectionRow, input: unknown, opts: { development: boolean; inboxes?: InboxLookup }): Promise<{ sensitive: boolean }> {
    const patch = parse(chatwootConnectionUpdateSchema, input);
    const current = chatwootSettings(row);
    const origin = patch.origin ?? row.origin;
    if (patch.origin !== undefined) checkOrigin(origin, opts.development);
    const accountId = patch.accountId ?? current.accountId;
    const moved = origin !== row.origin || accountId !== current.accountId;
    if (moved && patch.credential === undefined) throw new AppError("VALIDATION_FAILED", "error.flowConnectionKeyAgain", { fields: ["credential"] });
    const meta: ChatwootSettings = {
      ...current,
      accountId,
      bulkGap: patch.bulkGap ?? current.bulkGap,
      oneGap: patch.oneGap ?? current.oneGap,
    };
    const gaps = chatwootGapsProblem(meta.bulkGap, meta.oneGap);
    if (gaps) throw new AppError("VALIDATION_FAILED", "error.chatwootGaps", { fields: [gaps] });
    if (moved) {
      meta.inboxId = null;
      meta.inboxName = null;
    }
    const credential = patch.credential !== undefined ? await this.seal("chatwoot", row.id, patch.credential) : row.credential;
    const end = patch.credential !== undefined ? keyEnd(patch.credential) : row.key_end;
    if (patch.inboxId === null) {
      meta.inboxId = null;
      meta.inboxName = null;
    } else if (patch.inboxId !== undefined) {
      if (!opts.inboxes) throw new AppError("NOT_CONFIGURED", "error.flowConnectionKind");
      // Checked with the key and address as they will be kept: an inbox the key can't see is never picked.
      const inboxes = await opts.inboxes({ ...row, origin, credential, meta: JSON.stringify(meta) });
      const inbox = inboxes.find((entry) => entry.id === patch.inboxId);
      if (!inbox) throw new AppError("VALIDATION_FAILED", "error.chatwootInbox", { fields: ["inboxId"] });
      meta.inboxId = inbox.id;
      meta.inboxName = inbox.name;
    }
    // Only if nothing changed the row while the inbox was being checked: the network wait lets another
    // request in, and writing what was read before would undo it (a new key, new waits).
    const kept = this.db.run(
      `UPDATE zur_flow_connections SET name = ?, origin = ?, credential = ?, key_end = ?, meta = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND kind = 'chatwoot'`,
      patch.name ?? row.name,
      origin,
      credential,
      end,
      JSON.stringify(meta),
      this.nextStamp(row.updated_at),
      row.id,
      row.updated_at,
    );
    if (kept.rowsWritten === 0) throw new AppError("CONFLICT");
    const sensitive = moved || patch.credential !== undefined || patch.inboxId !== undefined;
    if (sensitive || patch.bulkGap !== undefined || patch.oneGap !== undefined) recordActivity(this.db, "flow.connection_changed", { auth: "header", kind: "chatwoot" });
    return { sensitive };
  }

  remove(id: string): void {
    this.row(id);
    this.db.run(`DELETE FROM zur_flow_connections WHERE id = ?`, id);
    recordActivity(this.db, "flow.connection_removed", {});
  }

  /** A change's time, always after the row's: two changes in the same millisecond still tell apart. */
  private nextStamp(previous: string): string {
    const now = this.clock();
    const before = Date.parse(previous);
    return new Date(Number.isFinite(before) && before >= now ? before + 1 : now).toISOString();
  }

  present(row: ConnectionRow, usedBy: string[]): FlowConnection {
    // A kind this code doesn't know (written by a newer version) shows as it is, and nothing calls it.
    const kind = (knownKind(row.kind) ?? row.kind) as FlowConnectionKind;
    return {
      id: row.id,
      kind,
      name: row.name,
      origin: row.origin,
      methods: parseList(row.methods) as FlowMethod[],
      paths: parseList(row.paths),
      auth: row.auth,
      headerName: row.header_name,
      hasCredential: row.credential !== null,
      keyEnd: row.credential !== null ? row.key_end : null,
      chatwoot: kind === "chatwoot" ? chatwootSettings(row) : null,
      usedBy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async seal(kind: FlowConnectionKind, id: string, credential: string): Promise<string> {
    const vault = this.#vaults[kind];
    if (!vault.available) throw new AppError("NOT_CONFIGURED", "error.flowCredentialKey");
    return vault.encrypt(id, credential);
  }

  /**
   * One request of a flow to a connection: only its methods, only under its
   * paths once the address is normalized, only its origin after the DNS check,
   * never a redirect, 10 s, 256 KB read. The answer is data.
   */
  async call(row: ConnectionRow, request: { method: FlowMethod; path: string; body: Json | undefined }, deps: CallDeps): Promise<ConnectionAnswer> {
    // Only an http credential is a flow's: the others are called by their fixed client alone.
    if (knownKind(row.kind) !== "http") throw new FlowStepError("kind_not_allowed");
    const methods = parseList(row.methods);
    if (!methods.includes(request.method)) throw new FlowStepError("method_not_allowed");
    let url: URL;
    try {
      url = new URL(request.path, `${row.origin}/`);
    } catch {
      throw new FlowStepError("path_not_allowed");
    }
    // Checked after the parser resolved dot segments and encoded dots: what is sent is what was allowed.
    if (url.origin !== row.origin || url.username || url.password || !pathAllowed(url.pathname, parseList(row.paths))) throw new FlowStepError("path_not_allowed");
    return this.send(row, url, request.method, request.body, deps);
  }

  /**
   * A call of a kind's fixed client (the Chatwoot's): the path is written in
   * the code, never by a flow or the screen, so the row's lists don't apply;
   * every other rule does.
   */
  async fixed(row: ConnectionRow, kind: FlowConnectionKind, request: { method: FlowMethod; path: string }, deps: CallDeps): Promise<ConnectionAnswer> {
    if (knownKind(row.kind) !== kind) throw new FlowStepError("kind_not_allowed");
    const url = new URL(request.path, `${row.origin}/`);
    if (url.origin !== row.origin) throw new FlowStepError("path_not_allowed");
    return this.send(row, url, request.method, undefined, deps);
  }

  private async send(row: ConnectionRow, url: URL, method: FlowMethod, payload: Json | undefined, deps: CallDeps): Promise<ConnectionAnswer> {
    const kind = knownKind(row.kind);
    if (!kind) throw new FlowStepError("kind_not_allowed");
    url.hash = "";
    if (!endpointUrl(url.href, { development: deps.development })) throw new FlowStepError("blocked");
    await this.vet(url, deps);
    let credential: string | null = null;
    if (row.auth !== "none") {
      if (!row.credential) throw new FlowStepError("credential");
      credential = await this.#vaults[kind].decrypt(row.id, row.credential);
      if (credential === null) throw new FlowStepError("credential");
    }
    const headers = new Headers({ accept: "application/json", "user-agent": "Zuri" });
    if (row.auth === "bearer" && credential) headers.set("authorization", `Bearer ${credential}`);
    if (row.auth === "header" && credential && row.header_name) headers.set(row.header_name, credential);
    let body: string | undefined;
    if (payload !== undefined && method !== "GET") {
      body = JSON.stringify(payload);
      headers.set("content-type", "application/json");
    }
    if (!deps.meter.room(1)) throw new FlowStepError("calls_limit");
    deps.meter.take();
    const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(FLOW_LIMITS.requestTimeoutMs)]) : AbortSignal.timeout(FLOW_LIMITS.requestTimeoutMs);
    let response: Response;
    try {
      response = await deps.network.fetch(new Request(url.href, { method, headers, ...(body === undefined ? {} : { body }), redirect: "manual", signal }));
    } catch (error) {
      throw networkProblem(error);
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new FlowStepError("redirect");
    }
    if (response.status >= 400) {
      // The answer of a refusal is never read: its status is all the run keeps.
      await response.body?.cancel().catch(() => undefined);
      throw new FlowStepError("http_error", TRANSIENT_STATUS.has(response.status), response.status);
    }
    let raw: string;
    try {
      raw = await limitBody(response, FLOW_LIMITS.responseBytes, FLOW_LIMITS.requestTimeoutMs).text();
    } catch (error) {
      throw networkProblem(error);
    }
    return { status: response.status, body: readBody(raw, response.status) };
  }

  /** The DNS check, once per host and wake: two lookups, counted. */
  private vet(url: URL, deps: CallDeps): Promise<void> {
    const known = deps.hosts.get(url.host);
    if (known) return known;
    const check = (async () => {
      // Checked before the lookup: a refusal inside the resolver would read as a DNS failure.
      if (!deps.meter.room(2)) throw new FlowStepError("calls_limit");
      const resolve: Resolver = async (host, signal) => {
        deps.meter.take();
        deps.meter.take();
        return deps.network.resolve(host, signal);
      };
      try {
        await assertPublicHost(url, resolve, { development: deps.development });
      } catch (error) {
        if (error instanceof FlowStepError) throw error;
        if (error instanceof McpEndpointError) throw new FlowStepError(error.problem === "private_address" ? "private_address" : "dns", error.problem === "dns");
        throw new FlowStepError("dns", true);
      }
    })();
    deps.hosts.set(url.host, check);
    // A refusal is not kept: the next try looks again.
    check.catch(() => deps.hosts.delete(url.host));
    return check;
  }
}

/** What a call needs from its caller: the network, the wake's counter and the hosts already checked. */
export interface CallDeps {
  network: FlowNetwork;
  development: boolean;
  meter: WakeMeter;
  signal?: AbortSignal;
  hosts: Map<string, Promise<void>>;
}

/** Lists the inboxes a Chatwoot row's key sees (flows/chatwoot.ts); given to an update that picks one. */
export type InboxLookup = (row: ConnectionRow) => Promise<{ id: number; name: string; api: boolean }[]>;

/** A body's kind: `http` when it says none; anything unknown is refused by name. */
function kindOfBody(input: unknown): FlowConnectionKind {
  const kind = input && typeof input === "object" && "kind" in input ? (input as { kind: unknown }).kind : undefined;
  if (kind === undefined) return "http";
  const known = typeof kind === "string" ? knownKind(kind) : null;
  // The owner's inbox is made only by Settings › Chatwoot.
  if (!known || known === OWNER_KIND) throw new AppError("VALIDATION_FAILED", undefined, { fields: ["kind"] });
  return known;
}

/** The origin of a connection must be public (the same rules as an MCP server). */
function checkOrigin(origin: string, development: boolean): void {
  if (!endpointUrl(origin, { development })) throw new AppError("VALIDATION_FAILED", "error.flowConnectionOrigin", { fields: ["origin"] });
}

export function parseList(value: string): string[] {
  try {
    const list: unknown = JSON.parse(value);
    return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** JSON as plain data; anything else kept as a short text with the status. */
function readBody(raw: string, status: number): Json {
  if (raw.trim() === "") return Object.assign(Object.create(null), { status });
  try {
    return plain(JSON.parse(raw));
  } catch {
    return Object.assign(Object.create(null), { status, text: [...raw].slice(0, TEXT_KEPT).join("") });
  }
}

/** A failed fetch or body read as a step's problem; the error's own text is never kept. */
export function networkProblem(error: unknown): FlowStepError {
  if (error instanceof FlowStepError) return error;
  if (error instanceof McpConnectionError) {
    if (error.problem === "too_large") return new FlowStepError("too_large");
    if (error.problem === "timeout") return new FlowStepError("timeout", true);
    return new FlowStepError("unavailable", true);
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return new FlowStepError("timeout", true);
  return new FlowStepError("unavailable", true);
}
