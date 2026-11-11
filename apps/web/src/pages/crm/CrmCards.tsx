import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CrmOverview, type CrmSettings, ptBRCrm } from "@zuri/shared";
import { type FormEvent, useEffect, useState } from "react";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, ErrorNotice, Loading, TextField } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";

// The cards' pt-BR texts travel with their code, not in the first bundle (rule P11).
addMessages(ptBRCrm);

/** Everything about the CRM starts with this key: the live channel's "crm" area refreshes it (lib/versions.ts). */
const CRM_KEY = ["crm"] as const;

/**
 * The control of the internal CRM that outlived the Clients tab (Sinal, S10):
 * which CRM notices reach the owner. It waits here, under the flows, for the
 * CRM's own screens (S15): the owner must always be able to silence a notice.
 */
export function CrmCards() {
  const overview = useQuery({ queryKey: [...CRM_KEY, "overview"], queryFn: ({ signal }) => api<CrmOverview>("/crm", { signal }) });
  if (overview.isPending) return <Loading rows={1} />;
  if (!overview.data) return <ErrorNotice error={overview.error} onRetry={() => void overview.refetch()} />;
  return <SettingsCard settings={overview.data.settings} />;
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
      <Switch label={t("web.crm.settings.birthdays")} checked={settings.birthdays} onChange={(value) => change({ birthdays: value })} />
      <BirthdayTime time={settings.birthdayTime} />
    </Card>
  );
}

/** When the day's birthdays are told: typed, then saved (a day gets one notice whatever the time becomes). */
function BirthdayTime({ time }: { time: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const save = useCrmSave();
  const [value, setValue] = useState(time);
  const [saving, setSaving] = useState(false);
  // What the server holds moved (another tab): start from it again.
  useEffect(() => setValue(time), [time]);
  const valid = /^\d{2}:\d{2}$/.test(value);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await save(() => api("/crm/settings", { method: "PATCH", body: { birthdayTime: value } }));
      toast(t("web.crm.settings.saved"));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-xl border border-border p-3">
      <TextField label={t("web.crm.settings.birthdayTime")} type="time" required value={value} onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" loading={saving} disabled={!valid || value === time}>
        {t("web.crm.settings.save")}
      </Button>
    </form>
  );
}
