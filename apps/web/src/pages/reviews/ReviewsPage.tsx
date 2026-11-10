import { PageHeader } from "../../components/ui.tsx";
import { useI18n } from "../../lib/i18n.tsx";
import { ReviewsPanel } from "../contacts/reviews/ReviewsPanel.tsx";

/**
 * Avaliações (Sinal shell): the Google reviews at their own address, out of
 * Contatos. App.tsx checks the address, so no router here (armadilhas.md,
 * "Pacote da interface").
 */
export function ReviewsPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader title={t("web.nav.reviews")} />
      <ReviewsPanel />
    </div>
  );
}
