import { NOTICE_LINKS, type NoticeLink } from "./alerts.ts";

/**
 * Addresses of the interface that changed name with the Sinal shell. Each old
 * one sends to the new one for good: notices saved before the change and old
 * Telegram messages still carry them. Fixed pairs only, never a destination
 * read from the address.
 */
export const MOVED_PAGES = {
  "/automacoes": "/rotinas",
  "/automacoes/rotinas": "/rotinas",
  "/automacoes/fluxos": "/crm/fluxos",
  "/automacoes/conexoes": "/crm/credenciais",
  "/contatos/avaliacoes": "/avaliacoes",
} as const;

/** Where an old address lives now, or null when it never moved. Anything else under /automacoes opens Rotinas. */
export function movedTo(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (Object.hasOwn(MOVED_PAGES, path)) return MOVED_PAGES[path as keyof typeof MOVED_PAGES];
  return path.startsWith("/automacoes/") ? "/rotinas" : null;
}

/**
 * The page a notice opens, as it is called today: a link saved under an old
 * name goes out with the new one, and anything outside the list is dropped (a
 * notice never carries an address someone else chose).
 */
export function noticePage(link: string | null | undefined): NoticeLink | null {
  if (!link) return null;
  const page = movedTo(link) ?? link;
  return (NOTICE_LINKS as readonly string[]).includes(page) ? (page as NoticeLink) : null;
}
