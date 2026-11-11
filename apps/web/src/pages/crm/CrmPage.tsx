import { PageHeader } from "../../components/ui.tsx";
import { useI18n } from "../../lib/i18n.tsx";
import { FlowsPanel } from "../automations/flows/FlowsPanel.tsx";
import { CrmCards } from "./CrmCards.tsx";

/**
 * CRM (Sinal shell): for now the flows and their connections, the screen that
 * lived under Automações › Fluxos, and the notices' card of the internal CRM
 * left by the Clients tab (S10). /crm, /crm/fluxos and /crm/credenciais open
 * this same screen until the CRM's own (S15) splits them; App.tsx checks the
 * address, so no router here (armadilhas.md, "Pacote da interface").
 */
export function CrmPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("web.nav.crm")} />
      <FlowsPanel />
      <CrmCards />
    </>
  );
}
