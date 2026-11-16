import type { AuthActivityEvent, AuthActivityGroup, AuthEventKind, MessageKey } from "@zuri/shared";
import { AUTH_ACTIVITY_GROUPS, AUTH_ATTENTION_KINDS, HOME_COUNTRY, ptBRSecurity } from "@zuri/shared";
import { addMessages } from "../../lib/i18n.tsx";
import { describeUserAgent } from "@zuri/shared";

// The Access log page and the activity card import this module: their pt-BR texts arrive
// with it, not in the first bundle (rule P11).
addMessages(ptBRSecurity);

/** Each kind of access event, in the owner's words. */
export const KIND_LABEL: Record<AuthEventKind, MessageKey> = {
  login_success: "web.activity.kind.login_success",
  login_failure: "web.activity.kind.login_failure",
  login_rate_limited: "web.activity.kind.login_rate_limited",
  login_turnstile: "web.activity.kind.login_turnstile",
  login_attack: "web.activity.kind.login_attack",
  logout: "web.activity.kind.logout",
  session_ended: "web.activity.kind.session_ended",
  session_blocked: "web.activity.kind.session_blocked",
  session_network_changed: "web.activity.kind.session_network_changed",
  confirm_success: "web.activity.kind.confirm_success",
  confirm_failure: "web.activity.kind.confirm_failure",
  password_changed: "web.activity.kind.password_changed",
  password_change_failure: "web.activity.kind.password_change_failure",
  credentials_reset: "web.activity.kind.credentials_reset",
  mfa_challenge: "web.activity.kind.mfa_challenge",
  mfa_failure: "web.activity.kind.mfa_failure",
  mfa_enabled: "web.activity.kind.mfa_enabled",
  mfa_disabled: "web.activity.kind.mfa_disabled",
  mfa_codes_regenerated: "web.activity.kind.mfa_codes_regenerated",
  recovery_code_used: "web.activity.kind.recovery_code_used",
  passkey_added: "web.activity.kind.passkey_added",
  passkey_removed: "web.activity.kind.passkey_removed",
  push_added: "web.activity.kind.push_added",
  push_removed: "web.activity.kind.push_removed",
  telegram_linked: "web.activity.kind.telegram_linked",
  telegram_unlinked: "web.activity.kind.telegram_unlinked",
  telegram_group_linked: "web.activity.kind.telegram_group_linked",
  telegram_unlocked: "web.activity.kind.telegram_unlocked",
  telegram_confirm_locked: "web.activity.kind.telegram_confirm_locked",
  telegram_approved: "web.activity.kind.telegram_approved",
  telegram_lockdown: "web.activity.kind.telegram_lockdown",
  telegram_sessions_ended: "web.activity.kind.telegram_sessions_ended",
  telegram_routines_paused: "web.activity.kind.telegram_routines_paused",
  lockdown_exited: "web.activity.kind.lockdown_exited",
  mcp_server_added: "web.activity.kind.mcp_server_added",
  flow_connection_added: "web.activity.kind.flow_connection_added",
  flow_connection_changed: "web.activity.kind.flow_connection_changed",
  crm_events_key: "web.activity.kind.crm_events_key",
  backup_exported: "web.activity.kind.backup_exported",
  backup_imported: "web.activity.kind.backup_imported",
  backup_key_set: "web.activity.kind.backup_key_set",
  mcp_server_changed: "web.activity.kind.mcp_server_changed",
  mcp_tool_autonomy: "web.activity.kind.mcp_tool_autonomy",
  google_connected: "web.activity.kind.google_connected",
  google_calendar_write: "web.activity.kind.google_calendar_write",
  reviews_autonomy: "web.activity.kind.reviews_autonomy",
  review_link_changed: "web.activity.kind.review_link_changed",
  mail_changed: "web.activity.kind.mail_changed",
  clinic_whatsapp_changed: "web.activity.kind.clinic_whatsapp_changed",
  confirm_text_changed: "web.activity.kind.confirm_text_changed",
  google_disconnected: "web.activity.kind.google_disconnected",
  setup_failure: "web.activity.kind.setup_failure",
  setup_locked: "web.activity.kind.setup_locked",
  owner_created: "web.activity.kind.owner_created",
  access_recovered: "web.activity.kind.access_recovered",
  recovery_requested: "web.activity.kind.recovery_requested",
  password_recovered: "web.activity.kind.password_recovered",
  agent_settings_changed: "web.activity.kind.agent_settings_changed",
  chatwoot_owner_linked: "web.activity.kind.chatwoot_owner_linked",
  chatwoot_owner_changed: "web.activity.kind.chatwoot_owner_changed",
  chatwoot_owner_removed: "web.activity.kind.chatwoot_owner_removed",
  chatwoot_owner_unlocked: "web.activity.kind.chatwoot_owner_unlocked",
};

/** The filter groups, as the access log's select names them. */
export const GROUP_LABEL: Record<AuthActivityGroup, MessageKey> = {
  success: "web.accessLog.group.success",
  failure: "web.accessLog.group.failure",
  blocked: "web.accessLog.group.blocked",
  robot: "web.accessLog.group.robot",
  account: "web.accessLog.group.account",
};

/** The reasons worth a word next to the event (the rest are internal codes). */
const REASON_LABEL: Record<string, MessageKey> = {
  new_device: "web.accessLog.reason.new_device",
  new_network: "web.accessLog.reason.new_network",
  missing: "web.accessLog.reason.missing",
  failed: "web.accessLog.reason.failed",
  unavailable: "web.accessLog.reason.unavailable",
  totp: "web.accessLog.reason.totp",
  recovery_code: "web.accessLog.reason.recovery_code",
  passkey: "web.accessLog.reason.passkey",
  idle: "web.accessLog.reason.idle",
  daily_cap: "web.accessLog.reason.daily_cap",
  network_daily_cap: "web.accessLog.reason.network_daily_cap",
  unbound: "web.accessLog.reason.unbound",
  other_browser: "web.accessLog.reason.other_browser",
  other_country: "web.accessLog.reason.other_country",
  too_many_networks: "web.accessLog.reason.too_many_networks",
  recovery: "web.accessLog.reason.recovery",
  wrong_email: "web.accessLog.reason.wrong_email",
  email_off: "web.accessLog.reason.email_off",
  link_sent: "web.accessLog.reason.link_sent",
  link_failed: "web.accessLog.reason.link_failed",
  link_held: "web.accessLog.reason.link_held",
};

/** The reasons of a row the owner can read, in order. */
export function reasonLabels(reason: string): MessageKey[] {
  return reason
    .split(",")
    .map((part) => part.trim())
    // Own keys only: a reason such as "constructor" must not reach Object's prototype.
    .filter((part) => Object.hasOwn(REASON_LABEL, part))
    .map((part) => REASON_LABEL[part] as MessageKey);
}

const GROUP_OF = new Map<AuthEventKind, AuthActivityGroup>(
  Object.entries(AUTH_ACTIVITY_GROUPS).flatMap(([group, kinds]) => kinds.map((kind) => [kind, group as AuthActivityGroup] as const)),
);

/** The group a kind belongs to: the tone of its badge. */
export function groupOf(kind: AuthEventKind): AuthActivityGroup {
  return GROUP_OF.get(kind) ?? "account";
}

/** Refusals and attacks stand out from the owner's own events (the same list as the "Attention" filter). */
export function isWarning(kind: AuthEventKind): boolean {
  return AUTH_ATTENTION_KINDS.includes(kind);
}

/** "Chrome on Android", or whichever half is known. */
export function deviceText(event: AuthActivityEvent, format: (browser: string, system: string) => string): string {
  const { browser, system } = describeUserAgent(event.userAgent);
  return browser && system ? format(browser, system) : (browser ?? system ?? "");
}

/** Where an access came from, as the row shows it: "Curitiba, PR · Brasil BR", or "· fora do Brasil" when it isn't home. */
export interface PlaceParts {
  /** City and state, empty when the edge didn't know them. */
  city: string;
  /** The country's name in the owner's language ("Unknown country" and "Tor network" for the edge's two codes that name none). */
  country: string;
  /** The two letters as recorded, empty without a country. */
  code: string;
  abroad: boolean;
}

/** The edge's codes that are not a country: an unknown place and the Tor network. */
const NOT_A_COUNTRY: Record<string, MessageKey> = { XX: "web.activity.countryUnknown", T1: "web.activity.tor" };

/** The pieces of the place line (E12a). Only two capital letters go to DisplayNames: anything else stays as it came. */
export function placeParts(event: Pick<AuthActivityEvent, "city" | "region" | "country">, locale: string, t: (key: MessageKey) => string): PlaceParts {
  const city = [event.city, event.region].filter(Boolean).join(", ");
  if (!event.country) return { city, country: "", code: "", abroad: false };
  // The same rule as the server's "Outside Brazil" filter: anything recorded that isn't BR.
  const abroad = event.country !== HOME_COUNTRY;
  const code = /^[A-Z0-9]{2}$/.test(event.country) ? event.country : "";
  // Something the edge doesn't send today (not two capitals or digits): an unknown country, its text never shown.
  if (!code) return { city, country: t("web.activity.countryUnknown"), code: "", abroad };
  if (Object.hasOwn(NOT_A_COUNTRY, code)) return { city, country: t(NOT_A_COUNTRY[code] as MessageKey), code, abroad };
  let country = code;
  if (/^[A-Z]{2}$/.test(code)) {
    try {
      country = new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
    } catch {
      // An old browser without DisplayNames: the two-letter code still says it.
    }
  }
  return { city, country, code, abroad };
}

/** The calendar day of an instant in the owner's zone, as YYYY-MM-DD (en-CA writes it so), never the device's zone. */
export function dayKey(at: string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** The day before a YYYY-MM-DD, by the calendar: a 23- or 25-hour day can't move it. */
export function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** The rows in blocks of one day each, newest first, as they came: a page cut in the middle of a day goes on in the same block. */
export function byDay<T extends { at: string }>(events: readonly T[], timeZone: string): { day: string; events: T[] }[] {
  const days: { day: string; events: T[] }[] = [];
  for (const event of events) {
    const day = dayKey(event.at, timeZone);
    const last = days.at(-1);
    if (last?.day === day) last.events.push(event);
    else days.push({ day, events: [event] });
  }
  return days;
}
