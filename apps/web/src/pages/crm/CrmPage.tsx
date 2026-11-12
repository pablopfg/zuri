import type { MessageKey } from "@zuri/shared";
import { FLOW_LIMITS } from "@zuri/shared";
import { KeyRound, Plus, Radar, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Button, ErrorNotice, Loading, PageHeader } from "../../components/ui.tsx";
import { useI18n } from "../../lib/i18n.tsx";
import { ConnectionDialog } from "../automations/flows/ConnectionDialog.tsx";
import { type Editing, FlowEditor } from "../automations/flows/FlowEditor.tsx";
import { type ConnectionEditing, CredentialsPart, FlowsPart, useFlows } from "../automations/flows/FlowsPanel.tsx";

/** The parts of the CRM that exist today. "Automações" and "Envios" get their place when their server arrives (S18, S19). */
export type CrmPart = "fluxos" | "credenciais";

/** The palette's "Criar fluxo": an address and an event of that name (CommandPalette.tsx). */
const NEW_FLOW = "novo-fluxo";

const DESCRIPTION: Record<CrmPart, MessageKey> = { fluxos: "web.flows.description", credenciais: "web.flows.connections.description" };

/**
 * CRM (Sinal, S15): the flows the owner builds and the credentials they call
 * with, each part at its own address (/crm and /crm/fluxos, /crm/credenciais).
 * The head's button creates what the open part lists. App.tsx only lets the
 * known parts through; any other address under /crm goes back to it.
 */
export function CrmPage() {
  const { t } = useI18n();
  const part: CrmPart = useParams().parte === "credenciais" ? "credenciais" : "fluxos";
  const list = useFlows();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [connection, setConnection] = useState<ConnectionEditing | null>(null);
  const data = list.data;
  const flowsFull = (data?.counts.flows ?? 0) >= FLOW_LIMITS.flows;
  // "Criar fluxo" in the palette opens the editor once the list is here: by the address on arrival (also
  // from Credenciais, which it leaves for the flows), by an event when the flows are already open.
  const loaded = data !== undefined;
  useEffect(() => {
    if (!loaded || part !== "fluxos") return;
    const open = () => setEditing({ mode: "new" });
    if (window.location.hash === `#${NEW_FLOW}`) {
      history.replaceState(history.state, "", window.location.pathname);
      open();
    }
    window.addEventListener(NEW_FLOW, open);
    return () => window.removeEventListener(NEW_FLOW, open);
  }, [loaded, part]);

  return (
    <>
      <PageHeader
        title={t("web.nav.crm")}
        description={<span className="block max-w-prose leading-6">{t(DESCRIPTION[part])}</span>}
        actions={
          part === "fluxos" ? (
            <>
              <Button variant="secondary" disabled={!data || flowsFull} onClick={() => setEditing({ mode: "monitor" })}>
                <Radar className="h-4 w-4" aria-hidden />
                {t("web.flows.monitorTemplate")}
              </Button>
              <Button disabled={!data || flowsFull} onClick={() => setEditing({ mode: "new" })}>
                <Plus className="h-4 w-4" aria-hidden />
                {t("web.flows.new")}
              </Button>
            </>
          ) : (
            <Button disabled={!data || data.connections.length >= FLOW_LIMITS.connections} onClick={() => setConnection({ mode: "new" })}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("web.flows.connections.new")}
            </Button>
          )
        }
      />
      <nav aria-label={t("web.crm.parts")} className="zuri-seg">
        <Link to="/crm/fluxos" aria-current={part === "fluxos" ? "page" : undefined}>
          <Workflow aria-hidden />
          {t("web.crm.part.flows")}
          {data && <Count n={data.counts.flows} />}
        </Link>
        <Link to="/crm/credenciais" aria-current={part === "credenciais" ? "page" : undefined}>
          <KeyRound aria-hidden />
          {t("web.crm.part.credentials")}
          {data && <Count n={data.connections.length} />}
        </Link>
      </nav>
      {list.isPending ? (
        <Loading label={t("web.flows.loading")} />
      ) : !data ? (
        <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
      ) : part === "fluxos" ? (
        <FlowsPart data={data} onEdit={setEditing} />
      ) : (
        <CredentialsPart data={data} onEdit={setConnection} />
      )}
      {editing && data && <FlowEditor editing={editing} connections={data.connections} google={data.google} settings={data.settings} onClose={() => setEditing(null)} />}
      {connection && data && <ConnectionDialog editing={connection} credentialsAvailable={data.credentialsAvailable} onClose={() => setConnection(null)} />}
    </>
  );
}

/** How many a part holds, beside its name; a number alone reads fine after the name. */
function Count({ n }: { n: number }) {
  // The space is for the link's name ("Fluxos 2"); the row's gap already sets them apart on the screen.
  return <span className="tabular-nums font-normal text-fg-muted"> {n}</span>;
}
