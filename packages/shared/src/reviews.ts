/**
 * Google reviews (step 19c): the reviews of the owner's business profile on
 * Google, read every 15 minutes on the same Google connection as the calendar
 * (step 19). A fixed rule on the rating decides first (the AI can only make a
 * review more cautious), negative ones go to the team, and nothing is
 * published without the owner's approval. Replying is the first public
 * message Zuri writes to someone else: docs/planos/google-business-profile.md.
 * The interface uses only the types and constants here; the schemas run on
 * the server (rule P11).
 */

/** The Business Profile scope, joined to the calendar's grant with `include_granted_scopes`. */
export const BUSINESS_SCOPE = "https://www.googleapis.com/auth/business.manage";

export const REVIEW_LIMITS = {
  /** How often the alarm reads the reviews until the owner picks another interval (Settings, 11/11/2026). */
  checkEveryMs: 10 * 60_000,
  /** The interval the owner may pick, in minutes (the same floor and ceiling as the contacts'). */
  checkEveryMinMinutes: 1,
  checkEveryMaxMinutes: 1_440,
  /** "Check now" at most once a minute. */
  checkNowEveryMs: 60_000,
  /** Pages of 50 read per check; the rest waits for the next one, from where this one stopped. */
  pagesPerCheck: 3,
  pageSize: 50,
  /** Pages a day of the walk over the reviews read before PR S20 (their names' prints): about 700 rows written each. */
  namesPagesPerDay: 20,
  /** Older than this when first read: history, never a notice nor a draft. */
  maxAgeDays: 14,
  /** Locations (profiles) the owner may pick, and listed from Google. */
  maxLocations: 3,
  listedLocations: 20,
  /** A comment longer than this is never read by the AI: the team gets it as suspicious. */
  commentForAi: 2_000,
  /** What Zuri keeps of a comment and a reply. */
  commentMax: 4_096,
  replyMin: 40,
  replyMax: 600,
  replyBytes: 4_096,
  signatureMin: 2,
  signatureMax: 60,
  templatesMin: 3,
  templatesMax: 5,
  templateMin: 20,
  templateMax: 600,
  bannedMax: 50,
  bannedWordMax: 40,
  firstNameMax: 20,
  /** Drafts written by the AI a day; past it a positive gets a template and a negative none. */
  aiDraftsPerDay: 30,
  /** Neurons the module may spend a day, within the owner's 9,000. */
  neuronsPerDay: 1_000,
  /** AI drafts per wake: the rest waits for the next one (each draft is two model calls). */
  draftsPerWake: 3,
  /** Publications per wake. */
  publishesPerWake: 3,
  /** A proposal waits this long for the owner. */
  proposalTtlMs: 72 * 3_600_000,
  /** A burst: this many negative or new reviews in an hour sends one grouped notice. */
  burstNegative: 5,
  burstNew: 10,
  burstWindowMs: 3_600_000,
  /** Single notices per check; more become one grouped notice. */
  noticesPerCheck: 3,
  /** A negative review left without an answer is told again once, after this long. */
  insistAfterMs: 48 * 3_600_000,
  /** Reviews per page of the screen. */
  screenPage: 30,
  /** Audit rows are kept this long. */
  eventsDays: 180,
  /** Step 19d: replies published by themselves, per check and per day (the owner's zone). */
  autoPerCheck: 3,
  autoPerDay: 10,
  /** Step 19d: drafts approved without a change, among the owner's last decisions, before publishing by itself unlocks. */
  trialNeeded: 10,
  trialWindow: 30,
  /** Step 19d: drafts of positive reviews failing the checks in a row that turn publishing by itself off. */
  breakerRejections: 3,
  /** Reviews the overview's numbers read at most, newest first; past it the answer says it is partial. */
  metricsRows: 5_000,
} as const;

/**
 * Off: only the notices to the team (nothing drafted for approval). Approve:
 * every reply waits for the owner. Auto (step 19d): positive reviews whose
 * draft passed both checks go out by themselves; the rest still waits.
 */
export const REVIEW_LEVELS = ["off", "approve", "auto"] as const;
export type ReviewLevel = (typeof REVIEW_LEVELS)[number];

export const REVIEW_TONES = ["close", "formal"] as const;
export type ReviewTone = (typeof REVIEW_TONES)[number];

/**
 * Where a review stands. history: before the module or too old; new: waits for
 * its draft; escalated: with the team (a careful draft may come); proposed: a
 * reply waits for the owner; sending/uncertain: going out, or no answer from
 * Google; replied: by Zuri; replied_elsewhere: someone answered on Google;
 * resolved: the owner handled it outside Zuri; removed: deleted at Google.
 */
export const REVIEW_STATES = ["history", "new", "escalated", "proposed", "sending", "uncertain", "replied", "replied_elsewhere", "resolved", "removed"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** Why a review went to the team. */
export const REVIEW_REASONS = ["low_rating", "complaint", "suspicious", "health", "language", "worse"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** Who wrote the draft: the AI, one of the owner's templates, or the owner. */
export const REVIEW_DRAFT_SOURCES = ["ai", "template", "owner"] as const;
export type ReviewDraftSource = (typeof REVIEW_DRAFT_SOURCES)[number];

/**
 * Codes of the fixed checker of a reply (never the text): size, language,
 * contact or digit, markup, a name, copied words, a banned word, the
 * signature, hidden characters; and the AI's second reading.
 */
export const REVIEW_GUARD_CODES = ["size", "language", "contact", "markup", "name", "copied", "banned", "signature", "hidden", "second_read", "invalid"] as const;
export type ReviewGuardCode = (typeof REVIEW_GUARD_CODES)[number];

/** Why the module needs the owner. */
export const REVIEW_PROBLEMS = ["reconnect", "no_access", "api_disabled", "unavailable"] as const;
export type ReviewProblem = (typeof REVIEW_PROBLEMS)[number];

/** "auto": the replies Zuri published by itself (step 19d). */
export const REVIEW_TABS = ["needs", "answered", "auto", "all"] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

/** Why publishing by itself went back to asking (step 19d): drafts failing the checks in a row, Google refusing one, or the owner deleting a reply of Zuri's. */
export const REVIEW_BREAKER_REASONS = ["rejected", "refused", "deleted"] as const;
export type ReviewBreakerReason = (typeof REVIEW_BREAKER_REASONS)[number];

export interface ReviewLocation {
  /** Google's name of the location ("accounts/1/locations/2"). */
  id: string;
  title: string;
  selected: boolean;
}

export interface ReviewPattern {
  signature: string;
  tone: ReviewTone;
  templates: string[];
  banned: string[];
}

export interface ReviewsStatus {
  /** The Google account is connected (the calendar's connection). */
  connected: boolean;
  /** Google granted business.manage. */
  granted: boolean;
  enabled: boolean;
  level: ReviewLevel;
  paused: boolean;
  problem: ReviewProblem | null;
  lastCheckAt: string | null;
  /** UTC ISO of the next check by itself (in the past while one is due); null while off or not allowed. */
  nextSyncAt: string | null;
  /** How the last check ended; null before the first one. */
  lastResult: "unchanged" | "changed" | "failed" | null;
  /** Minutes between two checks by itself, as the owner chose. */
  syncEveryMinutes: number;
  locations: ReviewLocation[];
  pattern: ReviewPattern;
  /** Reviews waiting for the owner (the tab's number). */
  needs: number;
  /** Step 19d: drafts of positive reviews approved without a change among the owner's last 30 decisions; "auto" unlocks at `needed`. */
  trial: { approved: number; needed: number };
  /** Replies published by themselves today. */
  autoToday: number;
  /** The last time publishing by itself turned off on its own, until the owner turns it on again. */
  breaker: { reason: ReviewBreakerReason; at: string } | null;
}

/** A review as the screen gets it: the first name only, never Google's ids or the photo. */
export interface ReviewItem {
  id: string;
  location: string;
  rating: number;
  firstName: string;
  anonymous: boolean;
  comment: string;
  createdAt: string;
  updatedAt: string;
  state: ReviewState;
  reasons: ReviewReason[];
  draft: string | null;
  draftSource: ReviewDraftSource | null;
  /** The draft fell back to a template: the AI's one failed these checks. */
  fallback: ReviewGuardCode[];
  /** The reply on Google, when there is one. */
  reply: string | null;
  /** The reply is Zuri's (only then can it be deleted here). */
  replyMine: boolean;
  /** Zuri published it by itself, without the owner's approval (step 19d). */
  auto: boolean;
  /** Ties an approval to this version of the review. */
  version: string;
  /** When a proposal stops being approvable. */
  expiresAt: string | null;
  /** Its contact, or the people it may be (PR S20); null without one. */
  match: ReviewMatch | null;
}

export interface ReviewPage {
  items: ReviewItem[];
  nextCursor: string | null;
  counts: Record<ReviewTab, number>;
}

/** The overview's periods: 30 days by week, 6 and 12 months by month, 24 months by half year, 5 years by year. */
export const REVIEW_METRIC_PERIODS = ["30d", "6m", "12m", "24m", "5y"] as const;
export type ReviewMetricPeriod = (typeof REVIEW_METRIC_PERIODS)[number];

export type ReviewMetricUnit = "week" | "month" | "semester" | "year";

/** A week, a month, a half year or a year of the period. By the stars: 5 recommends, 4 is neutral, 1 to 3 does not. */
export interface ReviewMetricBucket {
  /** The owner's local day the week starts on (a Monday, "2026-11-09"), the month ("2026-11"), the half year ("2026-S2") or the year ("2026"). */
  key: string;
  promoters: number;
  neutrals: number;
  detractors: number;
  /** The sum of the stars of its reviews: over their count, the average rating of the bucket. */
  stars: number;
}

/** The overview of the reviews written in a period: numbers only, never a name or a text. */
export interface ReviewMetrics {
  period: ReviewMetricPeriod;
  /** UTC ISO of the first instant counted (a midnight of the owner's). */
  from: string;
  unit: ReviewMetricUnit;
  /** How many reviews got 5, 4, 3, 2 and 1 stars, in this order. */
  ratings: [number, number, number, number, number];
  /** Oldest first; a week, month, half year or year without reviews comes with zeros. The first and the last may be cut by the period. */
  buckets: ReviewMetricBucket[];
  /** Reviews of the period with a reply on Google, whoever wrote it. */
  replied: number;
  /** Half of the replies whose time Zuri knows went out within this many minutes; null when it knows none. */
  medianReplyMinutes: number | null;
  /** The requests' funnel (sent, opened, reviewed); null until Zuri sends review requests. */
  requests: { sent: number; opened: number; reviewed: number } | null;
  /** There were more reviews than `REVIEW_LIMITS.metricsRows`: only the newest were counted. */
  partial: boolean;
}

/** The recommendation index, from -100 to 100: % that recommends minus % that does not. Null without reviews. */
export function recommendationIndex(counts: { promoters: number; neutrals: number; detractors: number }): number | null {
  const total = counts.promoters + counts.neutrals + counts.detractors;
  return total > 0 ? Math.round(((counts.promoters - counts.detractors) / total) * 100) : null;
}

/**
 * Review requests (PR S20): the owner sends each person a link of their own
 * with one tap in WhatsApp (option A of 09/11/2026). The link is Zuri's short
 * address (`/a/<code>`), which notes the first opening and goes on to the
 * profile's review page on Google. docs/planos/s20-pedido-de-avaliacao.md.
 */
export const REVIEW_REQUEST_LIMITS = {
  /** Days after the appointment; a weekend or national holiday moves it to the next working day. */
  daysDefault: 8,
  daysMin: 3,
  daysMax: 30,
  /** When the list is made and the owner hears of today's requests (the owner's time zone). */
  hourDefault: "09:00",
  hourMin: "06:00",
  hourMax: "21:00",
  /** The one reminder, this many days after the request, on the next working day. */
  reminderAfterDays: 7,
  /** Appointments read back from today: the days after it and three more weeks. */
  lookbackExtraDays: 21,
  /** A request never sent goes this many days after its day. */
  unsentDays: 30,
  /** The short address's code. */
  codeLength: 10,
  /** Letters and digits without the ones that look alike (0, O, 1, l, I): about 57 bits for 10. */
  codeAlphabet: "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789",
  /** A code takes the person to Google and notes the opening for this many days; after that, to Google only. */
  linkValidDays: 30,
  /** Codes past their time are removed after this many days. */
  linkKeepDays: 60,
  /** Openings of /a/ a minute from one network. */
  hitsPerMinute: 30,
  /** Openings of /a/ a minute from everyone together: a block of addresses changing at each one is held too. */
  hitsAllPerMinute: 300,
  messageMax: 500,
  linkMax: 300,
  /** The same link is handed again when the owner taps once more within this time (WhatsApp didn't open). */
  reopenMs: 10 * 60_000,
  /** An anonymous review, or a name nobody has, becomes a guess when one link alone was opened this long before it. */
  guessWindowMs: 48 * 3_600_000,
  /** Requests the screen lists, newest days first. */
  listMax: 300,
  /** Contacts shown on a review's card of people with the same name. */
  candidatesMax: 5,
  /** Contacts of one first name read to link a review: past this many, nothing links by itself. */
  candidatesRead: 300,
  /** Google calls the daily list may make: token renewals and the calendars' pages (four each at most), until they run out. */
  buildBudget: 12,
} as const;

/** The hosts of a Google review page; anything else is refused, whatever the address says. */
export const REVIEW_LINK_HOSTS = ["g.page", "search.google.com", "www.google.com", "maps.app.goo.gl"] as const;

/**
 * An address written into the request's message besides {link} (S20-2): a stolen session could
 * otherwise send every patient elsewhere with the owner's own text. A dot glued to two letters
 * ("exemplo.com"), "www." or a scheme is enough to refuse; "consulta. Até" is not one.
 */
export function messageHasAddress(message: string): boolean {
  return /https?:|www\.|[\p{L}\p{N}_-]\.[a-z]{2,24}(?![\p{L}\p{N}])/iu.test(message.replaceAll("{link}", " "));
}

/** Why an address can't be the profile's review link, or null when it can (the screen and the server ask the same). */
export function reviewLinkProblem(value: string): "invalid" | "host" | null {
  const text = value.trim();
  if (!text || text.length > REVIEW_REQUEST_LIMITS.linkMax || /[\s\p{Cc}\p{Cf}]/u.test(text)) return "invalid";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return "invalid";
  if (!(REVIEW_LINK_HOSTS as readonly string[]).includes(url.hostname)) return "host";
  // Google's own hosts carry redirectors (www.google.com/url): only the paths of a review page.
  if (url.hostname === "search.google.com" && !url.pathname.startsWith("/local/")) return "host";
  if (url.hostname === "www.google.com" && !url.pathname.startsWith("/maps/")) return "host";
  return null;
}

/** Where a request stands for the owner, as the screen groups it. */
export const REVIEW_REQUEST_STATES = ["today", "reminder", "scheduled", "waiting", "reminded", "reviewed", "removed", "pending", "no_phone"] as const;
export type ReviewRequestState = (typeof REVIEW_REQUEST_STATES)[number];

/** The groups of Avaliações › Pedidos, in the screen's order. */
export const REVIEW_REQUEST_GROUPS = ["today", "scheduled", "waiting", "reviewed", "off"] as const;
export type ReviewRequestGroup = (typeof REVIEW_REQUEST_GROUPS)[number];

export const REVIEW_REQUEST_GROUP: Record<ReviewRequestState, ReviewRequestGroup> = {
  today: "today",
  reminder: "today",
  scheduled: "scheduled",
  waiting: "waiting",
  reminded: "waiting",
  reviewed: "reviewed",
  removed: "reviewed",
  pending: "off",
  no_phone: "off",
};

/** One step of a request's timeline. */
export interface ReviewRequestStep {
  kind: "sent" | "reminded" | "opened" | "reviewed";
  at: string;
  /** The stars, on "reviewed". */
  rating?: number;
}

/** A person of the list: the contact's name, never the phone (it travels only in the answer of "send"). */
export interface ReviewRequestItem {
  id: string;
  contactId: string;
  name: string;
  /** The owner's local day of the appointment ("YYYY-MM-DD"). */
  appointmentDay: string;
  /** The day the request is (or was) due. */
  dueDay: string;
  /** The day the reminder is due; null without one to come. */
  reminderDay: string | null;
  state: ReviewRequestState;
  /** The review the person left, when linked. */
  reviewId: string | null;
  rating: number | null;
  steps: ReviewRequestStep[];
}

/** What keeps the list from being made, or null. */
export type ReviewRequestsBlocked = "reviews" | "link" | "contacts" | "calendar";

export interface ReviewRequestsPage {
  blocked: ReviewRequestsBlocked | null;
  /** UTC ISO of the last time the list was made from the calendar; null before the first. */
  builtAt: string | null;
  items: ReviewRequestItem[];
  counts: Record<ReviewRequestGroup, number>;
  /** The reviews and the contacts: read, linked, waiting for the owner, without a contact. */
  matches: { read: number; linked: number; pending: number; none: number };
}

export interface ReviewRequestSettings {
  link: {
    /** The address Google gave for the profile; null when it gave none. */
    google: string | null;
    /** The one the owner pasted, which wins; null without one. */
    manual: string | null;
    /** UTC ISO of the last read of Google's. */
    readAt: string | null;
    /** The profile's name. */
    location: string | null;
  };
  /** The start of each request's short address ("zuri.exemplo.com.br/a/"). */
  shortBase: string;
  /** The owner's message; null keeps the default text of the owner's language. */
  message: string | null;
  /** The default text, in the owner's language. */
  defaultMessage: string;
  days: number;
  hour: string;
  reminder: boolean;
}

/** The answer of "Enviar link de avaliação": what the owner's WhatsApp opens with. */
export interface ReviewRequestSend {
  /** Digits only, with the country code (wa.me's form). */
  phone: string;
  text: string;
  item: ReviewRequestItem;
}

export const REVIEW_MATCH_KINDS = ["auto", "confirmed", "twins", "guess"] as const;
export type ReviewMatchKind = (typeof REVIEW_MATCH_KINDS)[number];

/** A contact a review may be from, with what tells the people with one name apart. */
export interface ReviewMatchCandidate {
  id: string;
  name: string;
  /** The last four digits of the mobile, or "". */
  phoneEnd: string;
  /** The e-mail with the middle hidden ("an•••@exemplo.com.br"), or "". */
  email: string;
  /** UTC ISO of the request sent to this contact, or null. */
  requestedAt: string | null;
  /** The contact opened their link in the 7 days before the review. */
  opened: boolean;
  /** The likeliest one; none when the clues don't tell them apart. */
  best: boolean;
}

/** The link between a review and a contact, as a review's card shows it. */
export interface ReviewMatch {
  kind: ReviewMatchKind;
  /** The contact, once linked ("auto", "confirmed"). */
  contact: { id: string; name: string } | null;
  /** The people it may be ("twins", "guess"). */
  candidates: ReviewMatchCandidate[];
}
