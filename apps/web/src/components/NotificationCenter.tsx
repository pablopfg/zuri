import { Bell } from "lucide-react";
import { lazy, Suspense, useId, useState } from "react";
import { useSession } from "../hooks/session.tsx";
import { useI18n } from "../lib/i18n.tsx";
import { Panel } from "./shell/Panel.tsx";
import { Loading } from "./ui.tsx";

// The list, its actions and its texts come only when the bell is opened (rule P11).
const NoticesPanel = lazy(() => import("./NoticesPanel.tsx").then((m) => ({ default: m.NoticesPanel })));

/**
 * The bell: how many notices wait unseen (E12b; the count comes with the
 * session check and the heartbeat, so no request of its own) and the notice
 * center behind it, a panel beside the menu on a computer and a sheet on a
 * phone. The same number goes in front of the tab's name and on the installed
 * app's icon. `navigate` comes from the shell: the router stays out of the lazy
 * panel (.claude/memoria/armadilhas.md, "Pacote da interface").
 */
export function NotificationCenter({ navigate, rail = false }: { navigate: (to: string) => void; rail?: boolean }) {
  const { t } = useI18n();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const unseen = session?.unseenNotices ?? 0;
  // "99+" past that, on the bell and in its name (the tab title: lib/sounds.ts).
  const shown = unseen > 99 ? "99+" : String(unseen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unseen ? t("web.notifications.unseen", { n: shown }) : t("web.notifications.open")}
        aria-haspopup="dialog"
        className="zuri-icon-button relative"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unseen > 0 && (
          <span aria-hidden data-unseen>
            {shown}
          </span>
        )}
      </button>
      {open && (
        <Panel onClose={() => setOpen(false)} labelledBy={titleId} at={rail ? "notices-rail" : "notices"}>
          <h2 id={titleId} className="zuri-panel-title border-b border-border">
            {t("web.notifications.title")}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <Suspense
              fallback={
                <div className="p-4">
                  <Loading />
                </div>
              }
            >
              <NoticesPanel onClose={() => setOpen(false)} navigate={navigate} />
            </Suspense>
          </div>
        </Panel>
      )}
    </>
  );
}
