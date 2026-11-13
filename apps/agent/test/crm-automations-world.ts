import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import type { AutomationModule } from "../src/crm/automations/manifest.ts";
import { buildCatalog } from "../src/crm/automations/registry.ts";
import { CrmAutomations } from "../src/crm/automations/service.ts";

/** The owner's object with a catalog of the test's own modules (production has none with code yet). */
export function useCatalog(agent: ZuriAgent, modules: AutomationModule[]): CrmAutomations {
  const { db, flows, settings, auth } = agent.store;
  const automations = new CrmAutomations({
    db,
    connections: flows.connections,
    callDeps: (calls) => flows.automationCallDeps(calls),
    timeZone: () => settings.field("timeZone"),
    lockdown: () => auth.lockdown.active(),
    notify: () => {},
    catalog: buildCatalog(modules),
  });
  agent.store.crmAutomations = automations;
  flows.automationUsers = (id) => automations.users(id);
  return automations;
}
