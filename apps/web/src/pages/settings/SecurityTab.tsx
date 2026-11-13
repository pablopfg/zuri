import { useToast } from "../../components/Toaster.tsx";
import { ChangePasswordForm } from "../../components/ChangePasswordForm.tsx";
import { Card } from "../../components/ui.tsx";
import { useI18n } from "../../lib/i18n.tsx";
import { ActivityCard } from "../../components/security/ActivityCard.tsx";
import { PasskeysCard } from "../../components/security/PasskeysCard.tsx";
import { SessionLimitsCard } from "../../components/security/SessionLimitsCard.tsx";
import { TwoStepCard } from "../../components/security/TwoStepCard.tsx";

/** Settings > Segurança. The password came here from Conta in PR S16, first as in the prototype. */
export function SecurityTab() {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <>
      <Card title={t("web.password.title")} description={t("web.password.hint")}>
        <ChangePasswordForm onChanged={() => toast(t("web.password.changed"))} />
      </Card>
      <TwoStepCard />
      <PasskeysCard />
      <SessionLimitsCard />
      <ActivityCard />
    </>
  );
}
