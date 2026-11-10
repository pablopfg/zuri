import type { ReactNode } from "react";
import { useI18n } from "../lib/i18n.tsx";
import { Logo } from "./Logo.tsx";

/**
 * The frame of every screen outside the app (sign-in, password recovery, first
 * access, second step, password change, lockdown, the bot's confirmation, a
 * screen that stopped): the brand side, dark in both themes, beside the
 * content on a computer; on a phone, only the mark above the content.
 * Its looks live in styles.css (.zuri-entry*): the sign-in is in the first
 * load, where a class list costs JavaScript (rule P11).
 *
 * No import from ui.tsx, like the mark itself (Logo.tsx): the lazy screens use it too.
 */
export function EntryLayout({ children, wide = false, working = false }: { children: ReactNode; wide?: boolean; working?: boolean }) {
  const { t } = useI18n();
  const brand = (
    <p className="zuri-entry-brand">
      {/* The light pulses while the server works: the mark is the sign of work. */}
      <Logo working={working} />
      {t("app.name")}
    </p>
  );
  return (
    <main className="zuri-entry">
      <div className="zuri-entry-art">
        {brand}
        <p>{t("web.login.headline")}</p>
        <svg viewBox="0 0 400 400" aria-hidden="true">
          <circle cx="200" cy="200" r="20" />
          <circle cx="200" cy="200" r="78" />
          <circle cx="200" cy="200" r="128" />
          <circle cx="200" cy="200" r="184" />
        </svg>
      </div>
      <div className="zuri-entry-side">
        <div className="zuri-entry-card" data-wide={wide || undefined}>
          {brand}
          {children}
        </div>
      </div>
    </main>
  );
}
