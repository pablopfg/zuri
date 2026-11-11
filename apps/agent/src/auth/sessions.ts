import { hmacSha256Hex, MAX_SESSION_NETWORKS, MAX_SESSIONS, randomToken, SESSION_TOUCH_INTERVAL_MS, type SessionDeadlines, STEP_UP_WINDOW_MS } from "@zuri/shared";
import type { Database } from "../db/database.ts";

/** The three limits, from the settings (5–60 min, 3–15 min, 1–24 h). */
export interface SessionTimeouts {
  idleMinutes: number;
  presenceMinutes: number;
  maxHours: number;
}

export interface SessionRow {
  id: string;
  created_at: number;
  /** Last use: a request the owner's own input started (the activity header). */
  last_seen_at: number;
  /** Last sign of an open tab: any request, or the heartbeat. */
  last_presence_at: number;
  /** The maximum set at sign-in; a lower maximum chosen later applies too. */
  expires_at: number;
  /** When the password was last typed in this session (sign-in or confirm). */
  confirmed_at: number | null;
  user_agent: string;
  /** The network it signed in on. */
  network: string;
  /** The browser it was opened in: the HMAC of its device cookie. Null only for a session from before migration 34. */
  device: string | null;
  /** The edge's country at sign-in; empty when the edge gave none. */
  country: string;
  /** Every network it was used from, one per line, the sign-in's first. Empty only before migration 34. */
  networks: string;
  /** The network the password was last typed on: the 15-minute window holds only there. */
  confirmed_network: string | null;
  /** Not stored: the network of the request being answered (AuthService.validate sets it). */
  seen_network?: string | undefined;
}

/** Where a session is opened: what a later request is compared with. */
export interface SessionOrigin {
  userAgent: string;
  network: string;
  device: string | null;
  country: string;
}

/** Why a session ended on its own. */
export type SessionEnd = "idle" | "presence" | "max";

/** A session token is 32 random bytes in base64url; anything else is not one of ours. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Browser sessions. The token is 256 random bits held only in an HttpOnly
 * cookie; the database keeps HMAC(SESSION_SECRET, token) as the id, so a copy
 * of the database can't be replayed. The server alone decides when a session
 * ends: 30 min without use, 5 min without an open tab, 6 h at most (whichever
 * comes first), whatever the browser thinks.
 */
export class Sessions {
  constructor(
    private readonly db: Database,
    private readonly sessionSecret: string,
    private readonly clock: () => number,
    private readonly timeouts: () => SessionTimeouts,
  ) {}

  private idFor(token: string): Promise<string> {
    return hmacSha256Hex(this.sessionSecret, `zuri:session:v1:${token}`);
  }

  /** A new session, already confirmed (the password was just typed). The token goes to the cookie only. */
  async create(client: SessionOrigin): Promise<{ token: string; row: SessionRow }> {
    const token = randomToken(32);
    const id = await this.idFor(token);
    const now = this.clock();
    const row: SessionRow = {
      id,
      created_at: now,
      last_seen_at: now,
      last_presence_at: now,
      expires_at: now + this.timeouts().maxHours * 3600_000,
      confirmed_at: now,
      user_agent: client.userAgent,
      network: client.network,
      device: client.device,
      country: client.country,
      networks: client.network,
      confirmed_network: client.network,
    };
    this.db.run(
      `INSERT INTO zur_sessions (id, created_at, last_seen_at, last_presence_at, expires_at, confirmed_at, user_agent, network, device, country, networks, confirmed_network)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.created_at,
      row.last_seen_at,
      row.last_presence_at,
      row.expires_at,
      row.confirmed_at,
      row.user_agent,
      row.network,
      row.device,
      row.country,
      row.networks,
      row.confirmed_network,
    );
    // Past MAX_SESSIONS, the least recently used go.
    this.db.run(`DELETE FROM zur_sessions WHERE id NOT IN (SELECT id FROM zur_sessions ORDER BY last_seen_at DESC, created_at DESC LIMIT ?)`, MAX_SESSIONS);
    return { token, row };
  }

  /** The session for a cookie value, live or not; null for anything that isn't a current session's token. */
  async find(token: string | null): Promise<SessionRow | null> {
    if (!token || !TOKEN_SHAPE.test(token)) return null;
    return this.db.one<SessionRow>(`SELECT * FROM zur_sessions WHERE id = ?`, await this.idFor(token));
  }

  get(id: string): SessionRow | null {
    return this.db.one<SessionRow>(`SELECT * FROM zur_sessions WHERE id = ?`, id);
  }

  /** When each limit falls for this row, in ms. */
  limits(row: SessionRow, t = this.timeouts()): { idle: number; presence: number; max: number } {
    const max = Math.min(row.expires_at, row.created_at + t.maxHours * 3600_000);
    return {
      idle: Math.min(row.last_seen_at + t.idleMinutes * 60_000, max),
      presence: Math.min(row.last_presence_at + t.presenceMinutes * 60_000, max),
      max,
    };
  }

  /** The limit this session is past, if any (the maximum first). */
  ended(row: SessionRow): SessionEnd | null {
    const now = this.clock();
    const limit = this.limits(row);
    if (now >= limit.max) return "max";
    if (now >= limit.idle) return "idle";
    if (now >= limit.presence) return "presence";
    return null;
  }

  /**
   * Every request from a signed-in tab shows the tab is open; only `activity`
   * ones (the owner's own input) count as use. At most one write a minute,
   * unless `force` (the heartbeat, which answers with fresh deadlines).
   */
  touch(row: SessionRow, activity: boolean, force = false): SessionRow {
    const now = this.clock();
    const stale = (at: number) => force || now - at >= SESSION_TOUCH_INTERVAL_MS;
    if (activity && stale(row.last_seen_at)) {
      this.db.run(`UPDATE zur_sessions SET last_seen_at = ?, last_presence_at = ? WHERE id = ?`, now, now, row.id);
      return { ...row, last_seen_at: now, last_presence_at: now };
    }
    if (stale(row.last_presence_at)) {
      this.db.run(`UPDATE zur_sessions SET last_presence_at = ? WHERE id = ?`, now, row.id);
      return { ...row, last_presence_at: now };
    }
    return row;
  }

  deadlines(row: SessionRow): SessionDeadlines {
    const t = this.timeouts();
    const limit = this.limits(row, t);
    const iso = (ms: number) => new Date(ms).toISOString();
    return {
      now: iso(this.clock()),
      idleAt: iso(limit.idle),
      presenceAt: iso(limit.presence),
      maxAt: iso(limit.max),
      idleMinutes: t.idleMinutes,
    };
  }

  /** Opens the 15-minute window for sensitive actions, on the network the password was typed on. */
  confirm(id: string, network: string): void {
    this.db.run(`UPDATE zur_sessions SET confirmed_at = ?, confirmed_network = ? WHERE id = ?`, this.clock(), network, id);
  }

  /** The networks this session was used from; a session from before migration 34 has only the sign-in's. */
  networksOf(row: SessionRow): string[] {
    return row.networks ? row.networks.split("\n") : [row.network];
  }

  /**
   * Notes one more network for the session. "known": it was there already;
   * "added": it is new and there was room (written only if no request added it
   * meanwhile); "full": MAX_SESSION_NETWORKS were used already.
   */
  noteNetwork(row: SessionRow, network: string): "known" | "added" | "full" {
    const seen = this.networksOf(row);
    if (seen.includes(network)) return "known";
    if (seen.length >= MAX_SESSION_NETWORKS) return "full";
    const next = [...seen, network].join("\n");
    const written = this.db.all(`UPDATE zur_sessions SET networks = ? WHERE id = ? AND networks = ? RETURNING id`, next, row.id, row.networks);
    // Another request of the same moment wrote first: this one adds nothing and tells nobody twice.
    return written.length > 0 ? "added" : "known";
  }

  /**
   * Until when sensitive actions work without the password again; null when
   * the window is closed. It holds only on the network the password was typed
   * on: a copied cookie used elsewhere never inherits it.
   */
  recentAuthUntil(row: SessionRow): number | null {
    if (row.confirmed_at === null) return null;
    if (row.seen_network !== undefined && row.confirmed_network !== null && row.seen_network !== row.confirmed_network) return null;
    const until = row.confirmed_at + STEP_UP_WINDOW_MS;
    return until > this.clock() ? until : null;
  }

  /** Ends one session; returns how many ended (0 or 1). */
  revoke(id: string): number {
    return this.db.all(`DELETE FROM zur_sessions WHERE id = ? RETURNING id`, id).length;
  }

  /** Ends every session; returns how many. */
  revokeAll(): number {
    return this.db.all(`DELETE FROM zur_sessions RETURNING id`).length;
  }

  /** The sessions still within their limits, the most recently used first (at most MAX_SESSIONS exist). */
  list(): SessionRow[] {
    return this.db.all<SessionRow>(`SELECT * FROM zur_sessions ORDER BY last_seen_at DESC, created_at DESC`).filter((row) => !this.ended(row));
  }
}
