import type { AutomationModule } from "./manifest.ts";

/**
 * An automation that exists only in local development (a loopback PUBLIC_URL)
 * and in the tests: the e2e tests and the screenshots need one with code
 * before the first real one (S20). It reads the inboxes of the simulated
 * Chatwoot (src/flows/dev-flows.ts) and sends three made-up people a message
 * through the outbox (PR S19); only the simulated Chatwoot ever answers it.
 * Never in the production catalog (zuri-agent.ts adds it only when
 * development() is true).
 */
export const EXAMPLE_AUTOMATION: AutomationModule = {
  manifest: {
    id: "example",
    version: 2,
    effectsVersion: 2,
    trigger: { kind: "every", minutes: 60, workingDays: false },
    connection: "chatwoot",
    writesToContacts: true,
    calls: [{ name: "inboxes", method: "GET", path: "/api/v1/accounts/{account}/inboxes" }],
    options: [{ key: "perDay", kind: "number", min: 1, max: 3, default: 3 }],
    effects: ["message"],
    caps: { runsPerDay: 24, callsPerRun: 4, effectsPerDay: 3, neuronsPerRun: 0 },
  },
  async run(ctx) {
    await ctx.read("inboxes");
    const people = ["Pessoa de exemplo 1", "Pessoa de exemplo 2", "Pessoa de exemplo 3"].slice(0, Number(ctx.options.perDay));
    for (const [index, name] of people.entries()) {
      await ctx.send({ key: `${ctx.day}:${index}`, label: name, phone: `+551190000000${index + 1}`, text: `Mensagem de exemplo ${index + 1}` });
    }
  },
};
