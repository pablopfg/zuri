import { APP_VERSION, ptBRShell } from "@zuri/shared";
import { Bell, LogOut, type LucideIcon, Settings as SettingsIcon, ShieldCheck, Tag, User } from "lucide-react";
import { type MouseEvent, useEffect, useRef } from "react";
import { useSession } from "../../hooks/session.tsx";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { ThemeSwitcher } from "../ThemeSwitcher.tsx";

// The panel's pt-BR texts arrive with it (rule P11).
addMessages(ptBRShell);

const row = "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-fg hover:bg-raised";

/**
 * What the account panel holds (Sinal): the owner's name, the ways into the
 * settings, the version in use, the theme of this device and Sair. The shell
 * draws the panel around it (above the account on a computer, a sheet on a
 * phone). It comes on demand, so the router and the panel stay out of it:
 * `navigate` comes from the shell (armadilhas.md, "Pacote da interface"). The
 * e-mail is never shown: the session doesn't carry it.
 */
export function AccountPanel({
  name,
  initial,
  onClose,
  navigate,
}: {
  name: string;
  initial: string | undefined;
  onClose: () => void;
  navigate: (to: string) => void;
}) {
  const { t } = useI18n();
  const { signOut } = useSession();
  // The panel opens before this content arrives, with the focus on its X: the first choice takes it, as in a menu.
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => list.current?.querySelector("a")?.focus(), []);
  const links: { to: string; label: string; icon: LucideIcon }[] = [
    { to: "/configuracoes/conta", label: t("web.account.profile"), icon: User },
    { to: "/configuracoes/seguranca", label: t("web.account.security"), icon: ShieldCheck },
    { to: "/configuracoes/avisos", label: t("web.account.notices"), icon: Bell },
    { to: "/configuracoes", label: t("web.nav.settings"), icon: SettingsIcon },
  ];
  // Real links (a new tab still works); a plain click stays in the app.
  const go = (event: MouseEvent, to: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onClose();
    navigate(to);
  };
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-border py-3 pl-4 pr-14 md:py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-tile font-semibold text-brand-mark" aria-hidden>
          {initial ?? <SettingsIcon className="h-5 w-5" />}
        </span>
        <p className="min-w-0 truncate font-semibold">{name}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ul ref={list} className="p-2">
          {links.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <a href={to} onClick={(event) => go(event, to)} className={row}>
                <Icon className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                {label}
              </a>
            </li>
          ))}
          {/* The version in use (CHANGELOG.md). A line, not a link, until "Sobre a Zuri" exists in the settings. */}
          <li className={`${row} hover:bg-transparent`}>
            <Tag className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <span className="flex-1">{t("web.account.version")}</span>
            <span className="text-fg-muted tabular-nums">{APP_VERSION}</span>
          </li>
        </ul>
        <div className="border-t border-border px-4 py-3">
          <ThemeSwitcher wide />
        </div>
        <div className="border-t border-border p-2">
          <button type="button" className={row} onClick={() => void signOut("manual")}>
            <LogOut className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            {t("web.nav.signOut")}
          </button>
        </div>
      </div>
    </>
  );
}
