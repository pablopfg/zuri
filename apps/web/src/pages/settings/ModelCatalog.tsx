import { type CatalogNotice, formatDateTimeParts, type ModelCatalog, modelCatalogSchema } from "@zuri/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { Button, cn } from "../../components/ui.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

export const CATALOG_KEY = ["ai", "catalog"] as const;

/** The catalog of models (PR S21): the card's lines and the free models the settings may name. */
export function useModelCatalog() {
  return useQuery({
    queryKey: CATALOG_KEY,
    queryFn: async ({ signal }): Promise<ModelCatalog> => modelCatalogSchema.parse(await api<unknown>("/ai/catalog", { signal })),
    // It changes once a day: no polling (rule P11).
    staleTime: 60_000,
  });
}

const PILL: Record<CatalogNotice["kind"], { label: "web.ai.catalog.new" | "web.ai.catalog.leaving" | "web.ai.catalog.price"; tone: string }> = {
  new: { label: "web.ai.catalog.new", tone: "bg-success-soft text-success" },
  leaving: { label: "web.ai.catalog.leaving", tone: "bg-warning-soft text-warning" },
  price: { label: "web.ai.catalog.price", tone: "bg-raised text-fg-muted" },
};

/**
 * The "Catálogo de modelos" box under the model (prototype, Modelos e limites):
 * when it was last checked, "Conferir agora", and one line per new model,
 * leaving date and price change. A new model joins the list only with
 * "Pôr na lista"; it then shows among the free models of both choices.
 */
export function CatalogPanel({ catalog }: { catalog: ModelCatalog }) {
  const { t, locale, timeZone } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const compact = new Intl.NumberFormat(locale, { notation: "compact" });
  // The line of a model put on the list goes away: the keyboard's focus goes back to the card's title.
  const title = useRef<HTMLHeadingElement>(null);

  async function send(key: string, path: string, body: unknown, message: (next: ModelCatalog) => string) {
    setBusy(key);
    setError(null);
    try {
      const next = modelCatalogSchema.parse(await api<unknown>(path, { method: "POST", body }));
      qc.setQueryData(CATALOG_KEY, next);
      toast(message(next));
      if (key !== "check") title.current?.focus();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(null);
    }
  }

  const when = catalog.checkedAt ? formatDateTimeParts(catalog.checkedAt, locale, timeZone) : null;
  const summary = !catalog.available
    ? t("web.ai.catalog.unavailable")
    : when
      ? t("web.ai.catalog.checkedAt", when)
      : t("web.ai.catalog.never");

  return (
    <section aria-labelledby="catalog-title" className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="catalog-title" ref={title} tabIndex={-1} className="flex items-center gap-2 text-sm font-medium">
          <RefreshCw className="h-4 w-4 text-fg-muted" aria-hidden />
          {t("web.ai.catalog.title")}
        </h3>
        {catalog.available && (
          <Button
            variant="ghost"
            loading={busy === "check"}
            disabled={busy !== null}
            onClick={() => void send("check", "/ai/catalog/check", undefined, (next) => (next.failed ? t("web.ai.catalog.checkFailed") : t("web.ai.catalog.checked")))}
          >
            {t("web.ai.catalog.check")}
          </Button>
        )}
      </div>
      <p className="text-sm text-fg-muted">{summary}</p>
      {catalog.failed && <p className="text-sm text-fg-muted">{t("web.ai.catalog.failed")}</p>}
      {catalog.available && catalog.checkedAt && catalog.notices.length === 0 && <p className="text-sm">{t("web.ai.catalog.empty")}</p>}
      {catalog.notices.length > 0 && (
        <ul className="divide-y divide-border">
          {catalog.notices.map((notice) => (
            <li key={`${notice.kind}|${notice.model.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
              <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", PILL[notice.kind].tone)}>{t(PILL[notice.kind].label)}</span>
              <p className="min-w-0 flex-1 basis-56 text-sm">
                <b className="font-semibold [overflow-wrap:anywhere]">{notice.model.label}</b>{" "}
                {notice.kind === "new"
                  ? t("web.ai.catalog.newText", { context: compact.format(notice.model.context) })
                  : notice.kind === "leaving"
                    ? t(notice.inUse ? "web.ai.catalog.leavingInUse" : "web.ai.catalog.leavingText", {
                        date: formatDateTimeParts(`${notice.on}T12:00:00Z`, locale, "UTC").date,
                      })
                    : t("web.ai.catalog.priceText")}
              </p>
              {notice.kind === "new" && (
                <Button
                  variant="secondary"
                  loading={busy === notice.model.id}
                  disabled={busy !== null}
                  onClick={() => void send(notice.model.id, "/ai/catalog/models", { id: notice.model.id }, () => t("web.ai.catalog.added", { label: notice.model.label }))}
                >
                  {t("web.ai.catalog.add")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(error)}
        </p>
      )}
    </section>
  );
}
