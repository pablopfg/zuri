import { ChangePasswordForm } from "../components/ChangePasswordForm.tsx";
import { EntryLayout } from "../components/EntryLayout.tsx";
import { Button, useDocumentTitle } from "../components/ui.tsx";
import { useSession } from "../hooks/session.tsx";
import { useI18n } from "../lib/i18n.tsx";
import { LockdownPage } from "./LockdownPage.tsx";

/**
 * Loaded only when needed, and without RequireSession's FullScreen: that module brings the router,
 * and a lazy screen importing it splits the first bundle (.claude/memoria/armadilhas.md).
 * While the password fails the current rules, the server refuses everything else: this is the only screen.
 * During a lockdown (step 16b) it shows "Sair do bloqueio" instead.
 */
export function PasswordChangePage() {
  const { session } = useSession();
  // A lockdown (step 16b) comes through here too, so the first load carries one lazy screen, not two.
  return session?.lockdown ? <LockdownPage /> : <PasswordChange />;
}

function PasswordChange() {
  const { t } = useI18n();
  const { signOut } = useSession();
  useDocumentTitle(t("web.passwordRequired.title"));
  return (
    <EntryLayout>
      <div>
        <h1>{t("web.passwordRequired.title")}</h1>
        <p>{t("web.passwordRequired.body")}</p>
      </div>
      <ChangePasswordForm />
      <div className="flex justify-center">
        <Button variant="ghost" onClick={() => void signOut("manual")}>
          {t("web.nav.signOut")}
        </Button>
      </div>
    </EntryLayout>
  );
}
