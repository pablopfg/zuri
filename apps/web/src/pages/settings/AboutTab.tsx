import { useQuery } from "@tanstack/react-query";
import { APP_VERSION, RELEASES_URL, REPOSITORY_URL, serverVersionSchema } from "@zuri/shared";
import { CircleCheck, Code, ExternalLink, History, RefreshCw, TriangleAlert } from "lucide-react";
import { Button, buttonClass, Card, cn, ErrorNotice } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

/** The version the server runs, read only here (PR S16). */
const VERSION_KEY = ["server-version"] as const;

/**
 * Settings > Sobre a Zuri (PR S16): the version of this screen, the server's (to see,
 * after each update, that both moved), what changed in the newest version and the
 * way to every version and to the code. The notes come from CHANGELOG.md at build
 * time (vite.config.ts), as plain text.
 */
export function AboutTab() {
  return (
    <>
      <VersionCard />
      <NotesCard />
      <CodeCard />
    </>
  );
}

function VersionCard() {
  const { t } = useI18n();
  const server = useQuery({
    queryKey: VERSION_KEY,
    queryFn: async ({ signal }) => serverVersionSchema.parse(await api<unknown>("/version", { signal })).version,
    staleTime: 15_000,
  });
  const same = server.data === APP_VERSION;
  return (
    <Card title={t("web.about.version.title")} description={t("web.about.version.description")}>
      <div className="flex items-center gap-4 border-b border-border pb-4">
        {/* The app's icon as a file: importing Logo.tsx here would split it out of the first load into a chunk of its own (P11). */}
        <img src="/favicon.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl" />
        <p className="text-xl font-semibold tabular-nums">{t("web.about.version.name", { version: APP_VERSION })}</p>
      </div>
      <div className="pt-4" aria-live="polite">
        {server.isError ? (
          <ErrorNotice error={server.error} onRetry={() => void server.refetch()} />
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {server.data !== undefined && (
                <span
                  aria-hidden
                  className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", same ? "bg-success-soft text-fg" : "bg-warning-soft text-fg")}
                >
                  {same ? <CircleCheck className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}
                </span>
              )}
              <div className="min-w-0 text-sm leading-6">
                {server.isPending ? (
                  <p className="text-fg-muted">{t("web.about.version.checking")}</p>
                ) : same ? (
                  <>
                    <p className="font-semibold">{t("web.about.version.same")}</p>
                    <p className="text-fg-muted">{t("web.about.version.sameBody", { version: APP_VERSION })}</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">{t("web.about.version.differ")}</p>
                    <p className="text-fg-muted">{t("web.about.version.differBody", { screen: APP_VERSION, server: server.data })}</p>
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {server.data !== undefined && !same && <Button onClick={() => window.location.reload()}>{t("web.about.version.reload")}</Button>}
              <Button variant="secondary" loading={server.isFetching} onClick={() => void server.refetch()}>
                <RefreshCw className="h-4 w-4" aria-hidden />
                {t("web.about.version.check")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function NotesCard() {
  const { t } = useI18n();
  const notes = __RELEASE_NOTES__;
  return (
    <Card title={notes ? t("web.about.notes.title", { version: notes.version }) : t("web.about.notes.titleNone")}>
      {notes && notes.items.length > 0 ? (
        <ul className="divide-y divide-border text-sm leading-6">
          {notes.items.map((item) => (
            <li key={item} className="py-2">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">{t("web.about.notes.empty")}</p>
      )}
      <div className="mt-3 flex justify-end border-t border-border pt-3">
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost")}>
          <History className="h-4 w-4" aria-hidden />
          {t("web.about.notes.all")}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{t("web.about.newTab")}</span>
        </a>
      </div>
    </Card>
  );
}

function CodeCard() {
  const { t } = useI18n();
  return (
    <Card title={t("web.about.code.title")} description={t("web.about.code.description")}>
      <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "-ml-4")}>
        <Code className="h-4 w-4" aria-hidden />
        {t("web.about.code.open")}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">{t("web.about.newTab")}</span>
      </a>
    </Card>
  );
}
