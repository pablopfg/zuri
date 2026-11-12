import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ptBRReviews, REVIEW_LIMITS, type ReviewsStatus } from "@zuri/shared";
import { MessageSquareText } from "lucide-react";
import { Link } from "react-router";
import { buttonClass, ErrorNotice, Loading, Notice } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { REVIEW_PROBLEM_TEXT, REVIEWS_STATUS_KEY } from "../../lib/reviews.ts";
import { SyncIntervalForm } from "./SyncIntervalForm.tsx";

// The section's pt-BR texts travel with its code, loaded only with the Google card (rule P11).
addMessages(ptBRReviews);

/**
 * Settings › Integrations › Google › Reviews. The reviews have their own area
 * now (Sinal, S12): the profile, the permission and how Zuri replies live in
 * Avaliações › Ajustes, and this section points there. What stays here is how
 * often Zuri reads Google, next to the contacts' interval.
 */
export function ReviewsSection() {
  const { t, dateTime } = useI18n();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: REVIEWS_STATUS_KEY, queryFn: ({ signal }) => api<ReviewsStatus>("/reviews/status", { signal }) });
  const data = status.data;
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-labelledby="google-reviews">
      <h3 id="google-reviews" className="text-sm font-semibold">
        {t("web.reviews.card.title")}
      </h3>
      {status.isPending ? (
        <Loading rows={1} />
      ) : !data ? (
        <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <div className="space-y-4">
          {data.enabled ? (
            <p className="text-sm text-fg-muted" role="status">
              {data.lastCheckAt ? t("web.reviews.lastCheck", { when: dateTime(data.lastCheckAt) }) : t("web.reviews.neverChecked")}
            </p>
          ) : (
            <p className="text-sm leading-6 text-fg-muted">{t("web.reviews.card.intro")}</p>
          )}
          {data.enabled && data.problem && <Notice tone="warning">{t(REVIEW_PROBLEM_TEXT[data.problem])}</Notice>}
          {data.enabled && (
            <SyncIntervalForm
              label="web.reviews.card.every"
              minutes={data.syncEveryMinutes}
              min={REVIEW_LIMITS.checkEveryMinMinutes}
              max={REVIEW_LIMITS.checkEveryMaxMinutes}
              nextAt={data.nextSyncAt}
              onSave={async (minutes) => {
                qc.setQueryData(REVIEWS_STATUS_KEY, await api<ReviewsStatus>("/reviews/interval", { method: "PATCH", body: { syncEveryMinutes: minutes } }));
              }}
            />
          )}
          <Link to="/avaliacoes/ajustes" className={buttonClass(data.enabled ? "secondary" : "primary")}>
            <MessageSquareText className="h-4 w-4" aria-hidden />
            {t(data.enabled ? "web.reviews.card.open" : "web.reviews.card.connect")}
          </Link>
        </div>
      )}
    </section>
  );
}
