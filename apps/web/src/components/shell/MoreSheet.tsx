import { ChevronRight, Settings as SettingsIcon } from "lucide-react";
import { useId } from "react";
import { NavLink } from "react-router";
import { useI18n } from "../../lib/i18n.tsx";
import { MORE_ITEMS } from "../../lib/nav.ts";
import { Panel } from "./Panel.tsx";

/**
 * "Mais" on a phone: the places that don't fit the bottom bar, from the same
 * list as the menu of a computer (lib/nav.ts), and the settings. Picking one
 * closes the sheet (the shell closes it on every change of address).
 */
export function MoreSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const titleId = useId();
  const items = [...MORE_ITEMS, { id: "settings", to: "/configuracoes", label: "web.nav.settings", icon: SettingsIcon } as const];
  return (
    <Panel onClose={onClose} labelledBy={titleId} at="more">
      <h2 id={titleId} className="zuri-panel-title">
        {t("web.nav.more")}
      </h2>
      <nav aria-labelledby={titleId} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        <ul>
          {items.map(({ id, to, label, icon: Icon }) => (
            <li key={id}>
              <NavLink to={to} onClick={onClose} className="zuri-more-row">
                <Icon aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t(label)}</span>
                <ChevronRight aria-hidden />
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </Panel>
  );
}
