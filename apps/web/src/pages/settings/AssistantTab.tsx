import { ErrorNotice, Card, Loading } from "../../components/ui.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { useSettings, useSettingsMutation } from "../../hooks/settings.ts";
import { errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import type { Settings } from "@zuri/shared";
import { useId } from "react";
import { Link } from "react-router";
import { LearningCard, WatchersCard } from "./AlertsTab.tsx";

/**
 * Settings > Assistente (PR S16): how the Zuri works on her own. What she watches and
 * the priorities she learned came from Avisos; the conflict review came from the
 * Memory screen (C2). The prototype's "Conversas" card (a new conversation every day)
 * waits for its server (S05b): nothing shows before it works.
 */
export function AssistantTab() {
  const settings = useSettings();
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} />;
  return (
    <>
      <WatchersCard settings={settings.data} />
      <LearningCard settings={settings.data} />
      <MemoryCard settings={settings.data} />
    </>
  );
}

function MemoryCard({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const toast = useToast();
  const save = useSettingsMutation();
  const id = useId();
  return (
    <Card title={t("web.assistant.memory.title")} description={t("web.assistant.memory.description")}>
      <div className="space-y-2">
        <Switch
          label={t("web.assistant.memory.conflict")}
          describedBy={`${id}-hint`}
          checked={settings.memoryConflictReview}
          busy={save.isPending}
          onChange={(on) => save.mutate({ memoryConflictReview: on }, { onSuccess: () => toast(t("web.assistant.memory.saved")) })}
        />
        <p id={`${id}-hint`} className="text-sm leading-6 text-fg-muted">
          {t("web.assistant.memory.conflictHint")}
        </p>
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-2 border-t border-border pt-2 text-sm text-fg-muted">
          <span>{t("web.assistant.memory.where")}</span>
          <Link to="/memoria" className="inline-flex min-h-11 items-center font-semibold text-accent-text underline-offset-4 hover:underline">
            {t("web.assistant.memory.open")}
          </Link>
        </div>
      </div>
    </Card>
  );
}
