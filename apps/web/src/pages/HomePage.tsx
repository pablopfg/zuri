import { lazy, Suspense } from "react";
import { GreetingSlot, Loading, useDocumentTitle } from "../components/ui.tsx";
import { useI18n } from "../lib/i18n.tsx";

// The greeting, the field to write to Zuri, the day and the next days load on demand, in one
// piece: none of it is needed to sign in (rule P11).
const HomeBody = lazy(() => import("./home/HomeBody.tsx").then((m) => ({ default: m.HomeBody })));

/** The home page: the greeting, a field to write to Zuri, the day around the line of now and the next days. */
export function HomePage() {
  const { t } = useI18n();
  useDocumentTitle(t("web.nav.home"));
  const slot = <GreetingSlot />;
  return (
    <div className="zuri-home">
      <Suspense
        fallback={
          <>
            {slot}
            <Loading />
          </>
        }
      >
        <HomeBody greetingSlot={slot} />
      </Suspense>
    </div>
  );
}
