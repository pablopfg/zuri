import { useQueryClient } from "@tanstack/react-query";
import { ptBRSettings, ptBRSetup } from "@zuri/shared";
import { useEffect } from "react";
import { EntryLayout } from "../../components/EntryLayout.tsx";
import { TwoStepCard } from "../../components/security/TwoStepCard.tsx";
import { Button, useDocumentTitle } from "../../components/ui.tsx";
import { SESSION_KEY, useSession } from "../../hooks/session.tsx";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { SetupSteps } from "./SetupSteps.tsx";

// The two-step card's own texts live with the settings.
addMessages(ptBRSettings);
addMessages(ptBRSetup);

/**
 * Right after the first access, the server refuses everything but turning on
 * the second step: so does the interface. Closing the tab changes nothing;
 * the next sign-in lands here again until it is on.
 */
export function SecondStepPage({ hold }: { hold: (held: boolean) => void }) {
  const { t } = useI18n();
  const { signOut } = useSession();
  const qc = useQueryClient();
  useDocumentTitle(t("web.secondStep.title"));
  // Shown until the codes are kept, whatever a session check says meanwhile (App.tsx).
  useEffect(() => hold(true), [hold]);
  return (
    <EntryLayout wide>
      <div className="grid gap-4">
        <div>
          <h1>{t("web.secondStep.title")}</h1>
          <p>{t("web.secondStep.body")}</p>
        </div>
        <SetupSteps current={2} />
      </div>
        {/* Once the codes are kept, the server's session says the rest is open (or, if not, this screen comes back). */}
        <TwoStepCard
          onCodesKept={() => {
            void qc.invalidateQueries({ queryKey: SESSION_KEY }).then(() => hold(false));
          }}
        />
      <div className="flex justify-center">
        <Button variant="ghost" onClick={() => void signOut("manual")}>
          {t("web.nav.signOut")}
        </Button>
      </div>
    </EntryLayout>
  );
}
