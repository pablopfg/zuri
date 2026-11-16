import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CrmOverview, type CrmSettings, ptBRCrm } from "@zuri/shared";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Card, ErrorNotice, Loading } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";

// The card's pt-BR texts travel with its code, not in the first bundle (rule P11).
addMessages(ptBRCrm);

/** Everything about the CRM starts with this key: the live channel's "crm" area refreshes it (lib/versions.ts). */
const CRM_KEY = ["crm"] as const;

/**
 * Settings > Avisos, group "CRM" (Sinal, S15): which notices about the clients
 * the internal CRM sends, by the channels set above it. The Clients tab left
 * with the S10; the clients themselves are kept by the conversation's tools.
 */
export function CrmNoticesCard() {
  const overview = useQuery({ queryKey: [...CRM_KEY, "overview"], queryFn: ({ signal }) => api<CrmOverview>("/crm", { signal }) });
  if (overview.isPending) return <Loading rows={1} />;
  // The failure keeps the group's name over it: alone in the middle of the tab, it wouldn't say what failed.
  if (!overview.data) return <ErrorCard error={overview.error} onRetry={() => void overview.refetch()} />;
  return <SettingsCard settings={overview.data.settings} />;
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Card title={t("web.crm.settings.title")}>
      <ErrorNotice error={error} onRetry={onRetry} />
    </Card>
  );
}

/** Saves through the API and refreshes the cards; the error (if any) comes back to the caller. */
function useCrmSave() {
  const qc = useQueryClient();
  return async (work: () => Promise<unknown>) => {
    try {
      await work();
    } finally {
      await qc.invalidateQueries({ queryKey: CRM_KEY });
    }
  };
}

function SettingsCard({ settings }: { settings: CrmSettings }) {
  const { t } = useI18n();
  const toast = useToast();
  const save = useCrmSave();
  const change = (patch: Partial<CrmSettings>) =>
    void save(() => api("/crm/settings", { method: "PATCH", body: patch })).catch((err: unknown) => toast(errorMessage(err)));
  return (
    <Card title={t("web.crm.settings.title")} description={t("web.crm.settings.body")}>
      <Switch label={t("web.crm.settings.followUps")} checked={settings.followUps} onChange={(value) => change({ followUps: value })} />
    </Card>
  );
}
