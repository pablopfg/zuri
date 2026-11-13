import type { MessageKey } from "@zuri/shared";

/** Each automation's name in the catalog (pt-BR-crm-automations.ts), for the notices and a credential's "Usada por". */
export const AUTOMATION_NAME: Record<string, MessageKey> = {
  "review-request": "web.crmAutomations.name.review-request",
  "review-link": "web.crmAutomations.name.review-link",
  "appointment-confirmation": "web.crmAutomations.name.appointment-confirmation",
  "plan-ready": "web.crmAutomations.name.plan-ready",
  "message-report": "web.crmAutomations.name.message-report",
  "chatwoot-mirror": "web.crmAutomations.name.chatwoot-mirror",
  "google-posts": "web.crmAutomations.name.google-posts",
  "birthday": "web.crmAutomations.name.birthday",
  "win-back": "web.crmAutomations.name.win-back",
  "plan-follow-up": "web.crmAutomations.name.plan-follow-up",
  "example": "web.crmAutomations.name.example",
};
