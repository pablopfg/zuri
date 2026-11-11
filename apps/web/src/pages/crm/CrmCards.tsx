import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CrmEventsKey, type CrmOverview, type CrmSettings, ptBRCrm } from "@zuri/shared";
import { Webhook } from "lucide-react";
import { useState } from "react";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, Dialog, ErrorNotice, Loading, Notice } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";

// The cards' pt-BR texts travel with their code, not in the first bundle (rule P11).
addMessages(ptBRCrm);

/** Everything about the CRM starts with this key: the live channel's "crm" area refreshes it (lib/versions.ts). */
const CRM_KEY = ["crm"] as const;

/**
 * The two controls of the internal CRM that outlived the Clients tab (Sinal,
 * S10): which CRM notices reach the owner and the address the n8n events come
 * in by, with its secret. They wait here, under the flows, for the CRM's own
 * screens (S15): the owner must always be able to silence a notice and to
 * turn the events off.
 */
export function CrmCards() {
  const overview = useQuery({ queryKey: [...CRM_KEY, "overview"], queryFn: ({ signal }) => api<CrmOverview>("/crm", { signal }) });
  if (overview.isPending) return <Loading rows={2} />;
  if (!overview.data) return <ErrorNotice error={overview.error} onRetry={() => void overview.refetch()} />;
  return (
    <>
      <SettingsCard settings={overview.data.settings} />
      <EventsCard events={overview.data.events} />
    </>
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
      <Switch label={t("web.crm.settings.birthdays")} checked={settings.birthdays} onChange={(value) => change({ birthdays: value })} />
      <Switch label={t("web.crm.settings.newClients")} checked={settings.newClients} onChange={(value) => change({ newClients: value })} />
    </Card>
  );
}

function EventsCard({ events }: { events: CrmOverview["events"] }) {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const save = useCrmSave();
  const [shown, setShown] = useState<CrmEventsKey | null>(null);
  const [busy, setBusy] = useState(false);
  async function enable() {
    setBusy(true);
    try {
      let key: CrmEventsKey | null = null;
      await save(async () => {
        key = await api<CrmEventsKey>("/crm/events-key", { method: "POST" });
      });
      setShown(key);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    try {
      await save(() => api("/crm/events-key", { method: "DELETE" }));
      toast(t("web.crm.events.turnedOff"));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const copy = (value: string) =>
    void navigator.clipboard?.writeText(value).then(
      () => toast(t("web.crm.events.copied")),
      () => undefined,
    );
  return (
    <Card
      title={t("web.crm.events.title")}
      description={t("web.crm.events.body")}
      actions={
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent-text" aria-hidden>
          <Webhook className="h-5 w-5" />
        </span>
      }
    >
      {events.enabled ? (
        <div className="space-y-3 text-sm">
          <p className="break-all">
            <span className="text-fg-muted">{t("web.crm.events.url")}: </span>
            <code>{events.url}</code>
          </p>
          <p className="text-fg-muted">
            {events.lastEventAt ? t("web.crm.events.last", { when: dateTime(events.lastEventAt), count: events.today }) : t("web.crm.events.none")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy} onClick={() => void enable()}>
              {t("web.crm.events.rotate")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void disable()}>
              {t("web.crm.events.turnOff")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">{t("web.crm.events.off")}</p>
          <Button loading={busy} onClick={() => void enable()}>
            {t("web.crm.events.turnOn")}
          </Button>
        </div>
      )}
      <p className="text-xs leading-5 text-fg-muted">{t("web.crm.events.passwordNote")}</p>
      {shown && (
        <Dialog open onClose={() => setShown(null)} title={t("web.crm.events.secretTitle")}>
          <Notice tone="warning">{t("web.crm.events.secretOnce")}</Notice>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-fg-muted">{t("web.crm.events.url")}</dt>
              <dd className="mt-1 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all">{shown.url}</code>
                <Button variant="ghost" onClick={() => copy(shown.url)}>
                  {t("web.crm.events.copyUrl")}
                </Button>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-fg-muted">{t("web.crm.events.secret")}</dt>
              <dd className="mt-1 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all">{shown.secret}</code>
                <Button variant="ghost" onClick={() => copy(shown.secret)}>
                  {t("web.crm.events.copySecret")}
                </Button>
              </dd>
            </div>
          </dl>
          <p className="text-xs leading-5 text-fg-muted">{t("web.crm.events.howTo")}</p>
          <div className="flex justify-end">
            <Button onClick={() => setShown(null)}>{t("web.crm.events.done")}</Button>
          </div>
        </Dialog>
      )}
    </Card>
  );
}
