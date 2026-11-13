import { REVIEW_REQUEST_LIMITS } from "@zuri/shared";

/**
 * The short address of a review request, /a/<code> (PR S20): the Worker checks the shape here
 * before the request costs an object request, and tells a preview robot from a person.
 */

export const REVIEW_LINK_PREFIX = "/a/";

/** The object's route the Worker forwards to, and its header: set only by the Worker (INTERNAL_HEADER_PREFIXES strips any copy a client sends). */
export const REVIEW_OPEN_PATH = "/api/reviews/open";
export const REVIEW_OPEN_HEADER = "x-zuri-client-review-open";

export const CODE_PATTERN = new RegExp(`^[${REVIEW_REQUEST_LIMITS.codeAlphabet}]{${REVIEW_REQUEST_LIMITS.codeLength}}$`);

/** The code of /a/<code>, or null for any other path (a trailing slash included). */
export function reviewLinkCode(pathname: string): string | null {
  if (!pathname.startsWith(REVIEW_LINK_PREFIX)) return null;
  const code = pathname.slice(REVIEW_LINK_PREFIX.length);
  return CODE_PATTERN.test(code) ? code : null;
}

/** The robots that open a link to draw its preview: never an opening. */
const PREVIEW_AGENTS =
  /whatsapp|telegrambot|facebookexternalhit|facebot|meta-externalagent|slackbot|twitterbot|linkedinbot|discordbot|skypeuripreview|iframely|embedly|pinterest|redditbot|applebot|googlebot|bingbot|bingpreview|yandex|duckduckbot|vkshare|viber|line\/|kakaotalk|snapchat|signal|teams|preview|crawler|spider|bot\b/i;

export function isPreviewAgent(userAgent: string): boolean {
  return userAgent.trim() === "" || PREVIEW_AGENTS.test(userAgent);
}
