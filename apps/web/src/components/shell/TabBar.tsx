import { LayoutGrid } from "lucide-react";
import { NavLink, useLocation } from "react-router";
import { useTaskCounts } from "../../hooks/task-counts.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { isInside, MORE_ITEMS, TAB_ITEMS } from "../../lib/nav.ts";

/**
 * The phone's bottom bar (Sinal): the four places used most and "Mais", which
 * opens the sheet with the others. It sits outside the area that scrolls, so
 * nothing hides under it. A computer never draws it.
 */
export function TabBar({ moreOpen, onMore }: { moreOpen: boolean; onMore: () => void }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const today = useTaskCounts().data?.counts.today;
  // "Mais" lights up while the open place is one of its own (or the settings).
  const inMore = [...MORE_ITEMS.map((item) => item.to), "/configuracoes"].some((to) => isInside(pathname, to));
  return (
    <nav aria-label={t("web.nav.main")} className="zuri-tab-bar">
      {TAB_ITEMS.map(({ id, to, label, icon: Icon }) => (
        <NavLink key={id} to={to} end={to === "/"} className="zuri-tab">
          <Icon aria-hidden />
          <span>{t(label)}</span>
          {/* Read with the name, like the menu of a computer: "Tarefas 3". The dot is its picture. */}
          {id === "tasks" && !!today && (
            <>
              <span className="sr-only"> {today}</span>
              <span aria-hidden />
            </>
          )}
        </NavLink>
      ))}
      <button type="button" onClick={onMore} aria-haspopup="dialog" aria-expanded={moreOpen} data-current={inMore || undefined} className="zuri-tab">
        <LayoutGrid aria-hidden />
        <span>{t("web.nav.more")}</span>
      </button>
    </nav>
  );
}
