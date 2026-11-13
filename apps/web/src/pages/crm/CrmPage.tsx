import type { MessageKey } from "@zuri/shared";
import { FLOW_LIMITS } from "@zuri/shared";
import { KeyRound, Plus, Radar, Workflow, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Button, ErrorNotice, Loading, PageHeader } from "../../components/ui.tsx";
import { useI18n } from "../../lib/i18n.tsx";
import { CredentialDialog } from "../automations/flows/CredentialDialog.tsx";
import { type Editing, FlowEditor } from "../automations/flows/FlowEditor.tsx";
import { type ConnectionEditing, CredentialsPart, FlowsPart, useFlows } from "../automations/flows/FlowsPanel.tsx";
import { AutomationsPart, useCrmAutomations } from "./AutomationsPart.tsx";

/** The parts of the CRM that exist today. "Envios" gets its place when its server arrives (S19). */
export type CrmPart = "automacoes" | "fluxos" | "credenciais";

/** The palette's "Criar fluxo": an address and an event of that name (CommandPalette.tsx). */
const NEW_FLOW = "novo-fluxo";

const DESCRIPTION: Record<CrmPart, MessageKey> = { automacoes: "web.crmAutomations.description", fluxos: "web.flows.description", credenciais: "web.flows.connections.description" };

/**
 * CRM (Sinal, S15 and S18): the automations brought from the n8n, the flows the
 * owner builds and the credentials they call with, each part at its own address
 * (/crm for the automations, /crm/fluxos, /crm/credenciais).
 * The head's button creates what the open part lists. App.tsx only lets the
 * known parts through; any other address under /crm goes back to it.
 */
export function CrmPage() {
  const { t } = useI18n();
  const parte = useParams().parte;
  const part: CrmPart = parte === "credenciais" ? "credenciais" : parte === "fluxos" ? "fluxos" : "automacoes";
  const list = useFlows();
  const automations = useCrmAutomations();
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
          part === "automacoes" ? null : part === "fluxos" ? (
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
        <Link to="/crm" aria-current={part === "automacoes" ? "page" : undefined}>
          <Zap aria-hidden />
          {t("web.crm.part.automations")}
          {automations.data && <Count n={automations.data.automations.length} />}
        </Link>
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
      {part === "automacoes" ? (
        <AutomationsPart connections={data?.connections ?? []} />
      ) : list.isPending ? (
        <Loading label={t("web.flows.loading")} />
      ) : !data ? (
        <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
      ) : part === "fluxos" ? (
        <FlowsPart data={data} onEdit={setEditing} />
      ) : (
        <CredentialsPart data={data} onEdit={setConnection} />
      )}
      {editing && data && <FlowEditor editing={editing} connections={data.connections.filter((item) => item.kind === "http")} google={data.google} settings={data.settings} onClose={() => setEditing(null)} />}
      {connection && data && <CredentialDialog editing={connection} credentialsAvailable={data.credentialsAvailable} onClose={() => setConnection(null)} />}
    </>
  );
}

/** How many a part holds, beside its name; a number alone reads fine after the name. */
function Count({ n }: { n: number }) {
  // The space is for the link's name ("Fluxos 2"); the row's gap already sets them apart on the screen.
  return <span className="tabular-nums font-normal text-fg-muted"> {n}</span>;
}
