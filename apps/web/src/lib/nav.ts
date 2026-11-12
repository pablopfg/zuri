import type { MessageKey } from "@zuri/shared";
import { AlarmClock, BookUser, Brain, CalendarDays, Handshake, House, ListTodo, type LucideIcon, MessagesSquare, Notebook, Star } from "lucide-react";

export interface NavItem {
  /** The address, also the place's key in every list. */
  to: string;
  label: MessageKey;
  icon: LucideIcon;
}

export interface NavGroup {
  /** The first group (Início, Conversa) has no title. */
  heading?: MessageKey;
  items: readonly NavItem[];
}

/**
 * The one list of places (Sinal), in areas: the sidebar draws each area as a
 * group, the phone's bottom bar takes the first four places, the "Mais" sheet
 * the rest under the same areas, and the command palette all of them. A place added here shows up in every menu, with
 * the same name and the same icon.
 */
export const NAV: readonly NavGroup[] = [
  {
    items: [
      { to: "/", label: "web.nav.home", icon: House },
      { to: "/conversa", label: "web.nav.chat", icon: MessagesSquare },
    ],
  },
  {
    heading: "web.nav.groupMyDay",
    items: [
      { to: "/tarefas", label: "web.nav.tasks", icon: ListTodo },
      { to: "/agenda", label: "web.nav.agenda", icon: CalendarDays },
      { to: "/notas", label: "web.nav.notes", icon: Notebook },
    ],
  },
  // The area "Consultório" (the practice's management) goes here, between
  // "Meu dia" and "Relacionamento", with its first screen: an area with no
  // screen yet is never drawn (docs/planos/sons-menu-e-agenda-editavel.md).
  {
    heading: "web.nav.groupRelations",
    items: [
      { to: "/contatos", label: "web.nav.contacts", icon: BookUser },
      { to: "/avaliacoes", label: "web.nav.reviews", icon: Star },
      { to: "/crm", label: "web.nav.crm", icon: Handshake },
    ],
  },
  {
    heading: "web.nav.groupAssistant",
    items: [
      { to: "/memoria", label: "web.nav.memory", icon: Brain },
      { to: "/rotinas", label: "web.nav.routines", icon: AlarmClock },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV.flatMap((group) => group.items);

/** How many places the phone's bottom bar holds before "Mais" (five targets in all). */
const TAB_COUNT = 4;
export const TAB_ITEMS = NAV_ITEMS.slice(0, TAB_COUNT);
export const MORE_ITEMS = NAV_ITEMS.slice(TAB_COUNT);
/** The areas of "Mais": every area with a place left out of the bottom bar, with only those places. */
export const MORE_GROUPS = NAV.map(({ heading, items }) => ({ heading: heading as MessageKey, items: items.filter((item) => MORE_ITEMS.includes(item)) })).filter((group) => group.items.length);

/** Whether an address is inside a place: "/" only for itself, the others for their sub-addresses too. */
export function isInside(pathname: string, to: string): boolean {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Whether the phone's top bar should be away, given where the content's scroll
 * is (`y`), where it was (`last`) and how much is left below (`room`). It
 * always shows near the top; it leaves on a clear move down, unless the end is
 * near (the bar coming back there would make the page jump); it returns on a
 * clear move up. A small tremble keeps it as it is.
 */
export function topBarHidden(hidden: boolean, y: number, last: number, room: number): boolean {
  if (y < 56) return false;
  if (y > last + 6 && room > 80) return true;
  if (y < last - 6) return false;
  return hidden;
}
