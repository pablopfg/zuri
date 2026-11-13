import type { FlowConnectionKind } from "@zuri/shared";
import { useState } from "react";
import { Button, Dialog } from "../../../components/ui.tsx";
import { useI18n } from "../../../lib/i18n.tsx";
import { ChatwootDialog } from "./ChatwootDialog.tsx";
import { ConnectionDialog } from "./ConnectionDialog.tsx";
import type { ConnectionEditing } from "./FlowsPanel.tsx";

/**
 * "Nova credencial" asks the kind first (PR S17); editing opens the kind's own
 * form. A Chatwoot credential always keeps a key, so it waits for the key's
 * encryption to be set up in the installation.
 */
export function CredentialDialog({ editing, credentialsAvailable, onClose }: { editing: ConnectionEditing; credentialsAvailable: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<FlowConnectionKind | null>(editing.mode === "edit" ? editing.connection.kind : null);
  if (kind === "chatwoot") return <ChatwootDialog current={editing.mode === "edit" ? editing.connection : null} onClose={onClose} />;
  if (kind === "http") return <ConnectionDialog editing={editing} credentialsAvailable={credentialsAvailable} onClose={onClose} />;
  return (
    <Dialog open onClose={onClose} title={t("web.flows.connections.new")}>
      <p className="text-sm leading-6 text-fg-muted">{t("web.flows.kind.question")}</p>
      <ul className="space-y-2">
        <li>
          <Button variant="secondary" className="w-full justify-start" disabled={!credentialsAvailable} onClick={() => setKind("chatwoot")}>
            {t("web.flows.kind.chatwoot")}
          </Button>
          <p className="mt-1 text-xs leading-5 text-fg-muted">{t(credentialsAvailable ? "web.flows.kind.chatwootHint" : "web.flows.connections.noKey")}</p>
        </li>
        <li>
          <Button variant="secondary" className="w-full justify-start" onClick={() => setKind("http")}>
            {t("web.flows.kind.http")}
          </Button>
          <p className="mt-1 text-xs leading-5 text-fg-muted">{t("web.flows.kind.httpHint")}</p>
        </li>
      </ul>
    </Dialog>
  );
}
