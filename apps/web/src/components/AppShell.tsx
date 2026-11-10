import { useQuery } from "@tanstack/react-query";
import type { Settings } from "@zuri/shared";
import { Search } from "lucide-react";
import { lazy, Suspense, type UIEvent, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useMfaStatus } from "../hooks/mfa.ts";
import { SETTINGS_KEY, useSession } from "../hooks/session.tsx";
import { api } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { NAV_ITEMS, topBarHidden } from "../lib/nav.ts";
import { shellShortcut } from "../lib/shortcut.ts";
import { readSidebarCollapsed, SIDEBAR_KEY, saveSidebarCollapsed } from "../lib/sidebar.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Logo } from "./Logo.tsx";
import { NotificationCenter } from "./NotificationCenter.tsx";
import { SessionGuard } from "./SessionGuard.tsx";
import { MoreSheet } from "./shell/MoreSheet.tsx";
import { Panel } from "./shell/Panel.tsx";
import { Avatar, NEW_CHAT, Sidebar } from "./shell/Sidebar.tsx";
import { TabBar } from "./shell/TabBar.tsx";

// Downloaded the first time it opens (rule P11): most visits never use it.
const CommandPalette = lazy(() => import("./CommandPalette.tsx").then((m) => ({ default: m.CommandPalette })));
const AccountPanel = lazy(() => import("./shell/AccountPanel.tsx").then((m) => ({ default: m.AccountPanel })));
// Only while two-step sign-in is off, which setup soon makes rare. The reminder checks the same
// status (and the snooze) itself: this test only spares the download.
const MfaReminder = lazy(() => import("./MfaReminder.tsx").then((m) => ({ default: m.MfaReminder })));
const SecretNotices = lazy(() => import("./SecretNotices.tsx").then((m) => ({ default: m.SecretNotices })));

/** After the top bar comes or goes, the content's height changes and the browser adjusts the scroll: those events are not the owner's. */
const SETTLE_MS = 350;

/**
 * The frame of every signed-in page (Sinal). On a computer, the menu on the
 * left (shell/Sidebar.tsx), which collapses to a rail of icons, remembered on
 * this device. On a phone, a top bar with the mark, the search, the bell and
 * the account, and a bottom bar with four places and "Mais" (shell/TabBar.tsx).
 * Only the content scrolls: the menus never leave the screen, except the
 * phone's top bar, which goes away while the owner scrolls down and comes back
 * on the way up. The account and the notices open as a panel beside the menu,
 * or as a sheet on a phone (shell/Panel.tsx).
 */
export function AppShell() {
  const { t } = useI18n();
  const { session } = useSession();
  const mfa = useMfaStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Same query as the session's: already in memory, no second request.
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api<Settings>("/settings"), staleTime: 5 * 60_000 });
  const ownerName = settings.data?.ownerName.trim();
  const name = ownerName || t("web.account.menuFallback");
  const initial = ownerName ? [...ownerName][0]?.toUpperCase() : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = shellShortcut(event);
      if (!action) return;
      // Not over another dialog: an open editor would lose its edits.
      if (document.querySelector("dialog[open]:not([data-palette])")) return;
      event.preventDefault();
      if (action === "search") setPaletteOpen((open) => !open);
      else {
        setPaletteOpen(false);
        navigate(NEW_CHAT);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
  useEffect(() => {
    // Another tab changed it: follow, so every tab looks the same.
    const onStorage = (event: StorageEvent) => event.key === SIDEBAR_KEY && setCollapsed(readSidebarCollapsed());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    // Widening past the phone's size (a tablet turned sideways) closes "Mais": a modal left open
    // behind md:hidden would keep the whole page inert.
    const wide = window.matchMedia("(min-width: 48rem)");
    const onChange = () => wide.matches && setMoreOpen(false);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  // The phone's top bar leaves while the content scrolls down and returns on the way up. Written
  // straight to the element: a scroll must not draw the whole frame again.
  const bar = useRef<HTMLElement>(null);
  const scroll = useRef({ last: 0, quietUntil: 0 });
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const header = bar.current;
    // Only the content's own scroll (a list inside it bubbles here too), and only where the bar shows.
    if (!header || event.target !== event.currentTarget || header.offsetParent === null) return;
    const { scrollTop: y, scrollHeight, clientHeight } = event.currentTarget;
    const state = scroll.current;
    const now = Date.now();
    if (now >= state.quietUntil) {
      const was = header.dataset.off === "true";
      const want = topBarHidden(was, y, state.last, scrollHeight - clientHeight - y);
      if (want !== was) {
        header.dataset.off = String(want);
        state.quietUntil = now + SETTLE_MS;
      }
    }
    state.last = y;
  };
  // Any move to another page closes "Mais" and the account, and brings the top bar back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the address is the trigger
  useEffect(() => {
    setMoreOpen(false);
    setAccountOpen(false);
    if (bar.current) bar.current.dataset.off = "false";
  }, [location.pathname]);

  const toggle = () => {
    saveSidebarCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };
  const openSearch = () => setPaletteOpen(true);
  const openAccount = () => setAccountOpen(true);

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#conteudo" className="zuri-skip">
        {t("web.nav.skip")}
      </a>
      {session && <SessionGuard session={session} />}
      <ConfirmDialog />
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setPaletteOpen(false)} navigate={navigate} places={NAV_ITEMS} />
        </Suspense>
      )}
      {accountOpen && (
        // Above the account at the foot of the menu; beside the rail when it is collapsed.
        <Panel onClose={() => setAccountOpen(false)} label={t("web.account.menuFallback")} at={collapsed ? "account-rail" : "account"}>
          <Suspense fallback={<div className="h-80" />}>
            <AccountPanel name={name} initial={initial} onClose={() => setAccountOpen(false)} navigate={navigate} />
          </Suspense>
        </Panel>
      )}
      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} />}

      <aside
        id="menu-lateral"
        data-collapsed={collapsed}
        className="zuri-menu"
      >
        <Sidebar collapsed={collapsed} onToggle={toggle} onSearch={openSearch} account={{ name, initial, open: accountOpen, onOpen: openAccount }} navigate={navigate} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          ref={bar}
          className="zuri-top-bar"
        >
          <Link to="/" aria-label={t("web.nav.homeLink")}>
            <Logo className="h-7 w-7" />
            <span>{t("app.name")}</span>
          </Link>
          <button type="button" onClick={openSearch} aria-label={t("web.search.open")} aria-haspopup="dialog" className="zuri-icon-button">
            <Search className="h-5 w-5" aria-hidden />
          </button>
          <NotificationCenter navigate={navigate} />
          <button type="button" onClick={openAccount} aria-haspopup="dialog" aria-expanded={accountOpen} className="zuri-icon-button">
            <Avatar initial={initial} />
            <span className="sr-only">
              {t("web.account.menuOpen")} {name}
            </span>
          </button>
        </header>
        {mfa.data?.enabled === false && (
          <Suspense fallback={null}>
            <MfaReminder />
          </Suspense>
        )}
        <main id="conteudo" tabIndex={-1} onScroll={onScroll} className="zuri-content">
          <div>
            {(session?.removePlainPasswordSecret || session?.removeSetupCodeSecret) && (
              <Suspense fallback={null}>
                <SecretNotices />
              </Suspense>
            )}
            <Outlet />
          </div>
        </main>
        <TabBar moreOpen={moreOpen} onMore={() => setMoreOpen(true)} />
      </div>
    </div>
  );
}
