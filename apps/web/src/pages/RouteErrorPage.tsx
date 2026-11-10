import { CSRF_HEADER } from "@zuri/shared";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { useRouteError } from "react-router";
import { EntryLayout } from "../components/EntryLayout.tsx";
import { Button, useDocumentTitle } from "../components/ui.tsx";
import { useI18n } from "../lib/i18n.tsx";

/**
 * What the router shows when a screen throws while rendering, in place of its
 * built-in page (English, with the error's text). No detail of the error
 * reaches the screen; a reload starts over. Its name and the screen go to the
 * Diagnóstico tab (signed out, the server refuses it and nothing happens).
 */
export function RouteErrorPage() {
  const { t } = useI18n();
  const error = useRouteError();
  useDocumentTitle(t("web.crash.title"));
  // Loaded only when a screen breaks: the report never weighs on the first load (rule P11).
  useEffect(() => {
    void import("../lib/report-error.ts").then((m) => m.reportClientError(error, CSRF_HEADER)).catch(() => undefined);
  }, [error]);
  return (
    <EntryLayout>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-warning-soft text-warning" aria-hidden>
        <TriangleAlert className="h-5 w-5" />
      </span>
      <div>
        <h1>{t("web.crash.title")}</h1>
        <p>{t("web.crash.body")}</p>
      </div>
      <Button className="min-h-12 w-full" onClick={() => window.location.reload()}>
        {t("web.crash.reload")}
      </Button>
      <p className="text-center">
        {/* A full page load, not the router: the one that failed may be in a bad state. */}
        <a href="/" className="zuri-entry-link">
          {t("web.notFound.home")}
        </a>
      </p>
    </EntryLayout>
  );
}
