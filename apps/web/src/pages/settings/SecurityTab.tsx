import { ActivityCard } from "../../components/security/ActivityCard.tsx";
import { PasskeysCard } from "../../components/security/PasskeysCard.tsx";
import { SessionLimitsCard } from "../../components/security/SessionLimitsCard.tsx";
import { TwoStepCard } from "../../components/security/TwoStepCard.tsx";

export function SecurityTab() {
  return (
    <>
      <TwoStepCard />
      <PasskeysCard />
      <SessionLimitsCard />
      <ActivityCard />
    </>
  );
}
