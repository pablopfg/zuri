import { ChevronDown, PanelLeft, Search, Settings as SettingsIcon, SquarePen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, NavLink } from "react-router";
import { useTaskCounts } from "../../hooks/task-counts.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { NAV } from "../../lib/nav.ts";
import { Logo } from "../Logo.tsx";
import { NotificationCenter } from "../NotificationCenter.tsx";

export const NEW_CHAT = "/conversa";

/** The owner's initial on the dark tile of the mark, or a gear while there is no name. */
export function Avatar({ initial }: { initial: string | undefined }) {
  return (
    <span className="zuri-avatar" aria-hidden>
      {initial ?? <SettingsIcon className="h-4 w-4" />}
    </span>
  );
}

/**
 * The menu of a computer (Sinal): the mark, the bell and the toggle on top,
 * "Nova conversa", the search, the places in three groups (lib/nav.ts) and the
 * account at the foot. Collapsed, it is a rail of icons: every control keeps
 * its name for screen readers and shows it beside the icon on hover and on
 * keyboard focus. A phone never draws it: it has the bottom bar (TabBar.tsx).
 * Its looks are in styles.css (.zuri-menu-*), to keep the first load light.
 */
export function Sidebar({
  collapsed,
  onToggle,
  onSearch,
  account,
  navigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onSearch: () => void;
  account: { name: string; initial: string | undefined; open: boolean; onOpen: () => void };
  navigate: (to: string) => void;
}) {
  const { t } = useI18n();
  // Escape hides the rail's names until the pointer or focus moves (WCAG 1.4.13).
  const [tipsHidden, setTipsHidden] = useState(false);
  // Today's tasks beside Tarefas; kept fresh by the areas' numbers (lib/versions.ts).
  const today = useTaskCounts().data?.counts.today;
  const tip = (label: string) => (collapsed ? label : null);
  const rail = collapsed || undefined;
  const hide = collapsed ? "sr-only" : "truncate";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: listens only, to hide the rail's names (WCAG 1.4.13); every control inside is a real button or link.
    <div
      className="flex min-h-0 w-full flex-col p-3"
      onKeyDown={(event) => event.key === "Escape" && setTipsHidden(true)}
      onFocus={() => setTipsHidden(false)}
      onMouseLeave={() => setTipsHidden(false)}
    >
      <div className={collapsed ? "flex flex-col items-center" : "flex items-center gap-0.5"}>
        <Tip label={tip(t("app.name"))} quiet={tipsHidden} className={collapsed ? "" : "mr-auto min-w-0"}>
          <NavLink to="/" className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl px-1" aria-label={t("web.nav.homeLink")}>
            <Logo />
            <span className={collapsed ? "sr-only" : "truncate text-[1.1875rem] font-semibold tracking-tight"}>{t("app.name")}</span>
          </NavLink>
        </Tip>
        <NotificationCenter navigate={navigate} rail={collapsed} />
        <Tip label={tip(t("web.nav.expand"))} quiet={tipsHidden}>
          <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-controls="menu-lateral" aria-label={collapsed ? t("web.nav.expand") : t("web.nav.collapse")} className="zuri-icon-button">
            <PanelLeft className="h-5 w-5" aria-hidden />
          </button>
        </Tip>
      </div>
      <div className="mt-2 space-y-2">
        <Tip label={tip(t("web.nav.newChat"))} quiet={tipsHidden}>
          <Link to={NEW_CHAT} aria-keyshortcuts="Control+Shift+O Meta+Shift+O" data-rail={rail} className="zuri-menu-row zuri-menu-field font-semibold text-fg">
            <SquarePen className="h-5 w-5 shrink-0 text-accent-text" aria-hidden />
            <span className={hide}>{t("web.nav.newChat")}</span>
          </Link>
        </Tip>
        <Tip label={tip(t("web.search.open"))} quiet={tipsHidden}>
          <button type="button" onClick={onSearch} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" data-rail={rail} className="zuri-menu-row zuri-menu-field text-fg-muted hover:text-fg">
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className={hide}>{t("web.search.open")}</span>
          </button>
        </Tip>
      </div>
      <nav aria-label={t("web.nav.main")} className={`${collapsed ? "mt-2" : "mt-4"} min-h-0 flex-1 overflow-y-auto overscroll-contain`}>
        {NAV.map((group, index) => (
          <div key={group.heading ?? "top"} className={index === 0 ? "" : collapsed ? "mt-1 border-t border-border pt-1" : "mt-4"}>
            {group.heading && (
              <p id={`nav-${index}`} className={collapsed ? "hidden" : "zuri-menu-heading"}>
                {t(group.heading)}
              </p>
            )}
            <ul aria-labelledby={group.heading ? `nav-${index}` : undefined} className="space-y-0.5">
              {group.items.map(({ id, to, label, icon: Icon }) => {
                const count = id === "tasks" ? today : undefined;
                return (
                  <li key={id}>
                    <Tip label={tip(t(label))} quiet={tipsHidden}>
                      <NavLink to={to} end={to === "/"} data-rail={rail} className="zuri-menu-row zuri-menu-place">
                        <Icon aria-hidden />
                        <span className={hide}>{t(label)}</span>
                        {/* Read with the name, like a mail app's inbox: "Tarefas 3". */}
                        {!!count && <span className={collapsed ? "sr-only" : "ml-auto text-xs font-medium text-fg-muted tabular-nums"}> {count}</span>}
                      </NavLink>
                    </Tip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <Tip label={tip(account.name)} quiet={tipsHidden || account.open} className="mt-2">
        <button type="button" onClick={account.onOpen} aria-haspopup="dialog" aria-expanded={account.open} data-rail={rail} className="zuri-menu-row min-h-12 gap-2.5 px-2 text-left hover:bg-raised">
          <Avatar initial={account.initial} />
          {/* The name is the button's visible text; screen readers hear what it opens first. */}
          <span className="sr-only">{t("web.account.menuOpen")}</span>
          <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate text-sm font-semibold"}>{account.name}</span>
          {!collapsed && <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />}
        </button>
      </Tip>
    </div>
  );
}

/**
 * The name of a rail icon, shown beside it on hover or keyboard focus. It is
 * only a picture of the name the control already has, so screen readers skip
 * it (styles.css, .zuri-tip).
 */
function Tip({ label, quiet, className = "", children }: { label: string | null; quiet: boolean; className?: string; children: ReactNode }) {
  // The wrapper stays either way: swapping it would remount the control and drop its focus.
  return (
    <div data-quiet={quiet || undefined} className={`zuri-tip ${className}`}>
      {children}
      {label && (
        <span aria-hidden>
          <span>{label}</span>
        </span>
      )}
    </div>
  );
}
