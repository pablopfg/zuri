import { type MessageKey, ptBRSettings, ptBRSettingsTabs } from "@zuri/shared";
import { Activity, Bell, Bot, CalendarDays, ChevronDown, Database, Gauge, BadgeInfo, MessagesSquare, Plug, ShieldCheck, Sparkle, User } from "lucide-react";
import { lazy, Suspense } from "react";
import { Navigate, NavLink, useNavigate, useParams } from "react-router";
import { cn, Loading, PageHeader } from "../components/ui.tsx";
import { addMessages, useI18n } from "../lib/i18n.tsx";
import { AboutTab } from "./settings/AboutTab.tsx";
import { AccountTab } from "./settings/AccountTab.tsx";
import { AgendaTab } from "./settings/AgendaTab.tsx";
import { AiModelsTab, AiUsageTab } from "./settings/AiTab.tsx";
import { AlertsTab } from "./settings/AlertsTab.tsx";
import { AssistantTab } from "./settings/AssistantTab.tsx";
import { DataTab } from "./settings/DataTab.tsx";
import { DiagnosticsTab } from "./settings/DiagnosticsTab.tsx";
import { IntegrationsTab } from "./settings/IntegrationsTab.tsx";
import { SecurityTab } from "./settings/SecurityTab.tsx";

// Settings › Chatwoot is its own download, with its texts: the settings screen stays as it was (rule P11).
const ChatwootTab = lazy(() => import("./settings/ChatwootTab.tsx").then((module) => ({ default: module.ChatwootTab })));

// The screen's texts come with its download (rule P11).
addMessages(ptBRSettings);
addMessages(ptBRSettingsTabs);

/**
 * The sections, by the path segment the address shows ("/configuracoes/seguranca"), in the
 * prototype's order and five groups (PR S16). The names of before stay the same: links to them
 * are kept in notices, Telegram messages and device notifications.
 */
export const SETTINGS_TABS = ["conta", "seguranca", "assistente", "ia", "modelos", "agenda", "avisos", "integracoes", "chatwoot", "dados", "diagnostico", "sobre"] as const;
type Tab = (typeof SETTINGS_TABS)[number];

const GROUPS = [
  { label: "web.settings.group.you", tabs: ["conta", "seguranca"] },
  { label: "web.settings.group.zuri", tabs: ["assistente", "ia", "modelos"] },
  { label: "web.settings.group.day", tabs: ["agenda", "avisos"] },
  { label: "web.settings.group.connections", tabs: ["integracoes", "chatwoot"] },
  { label: "web.settings.group.system", tabs: ["dados", "diagnostico", "sobre"] },
] as const satisfies readonly { label: MessageKey; tabs: readonly Tab[] }[];

// One literal key per value, so the i18n lint sees each one.
const SECTION = {
  conta: { label: "web.settings.tab.account", hint: "web.settings.hint.account", icon: User },
  seguranca: { label: "web.settings.tab.security", hint: "web.settings.hint.security", icon: ShieldCheck },
  assistente: { label: "web.settings.tab.assistant", hint: "web.settings.hint.assistant", icon: Bot },
  ia: { label: "web.settings.tab.ai", hint: "web.settings.hint.ai", icon: Gauge },
  modelos: { label: "web.settings.tab.models", hint: "web.settings.hint.models", icon: Sparkle },
  agenda: { label: "web.settings.tab.agenda", hint: "web.settings.hint.agenda", icon: CalendarDays },
  avisos: { label: "web.settings.tab.notifications", hint: "web.settings.hint.notifications", icon: Bell },
  integracoes: { label: "web.settings.tab.integrations", hint: "web.settings.hint.integrations", icon: Plug },
  chatwoot: { label: "web.settings.tab.chatwoot", hint: "web.settings.hint.chatwoot", icon: MessagesSquare },
  dados: { label: "web.settings.tab.data", hint: "web.settings.hint.data", icon: Database },
  diagnostico: { label: "web.settings.tab.diagnostics", hint: "web.settings.hint.diagnostics", icon: Activity },
  sobre: { label: "web.settings.tab.about", hint: "web.settings.hint.about", icon: BadgeInfo },
} as const satisfies Record<Tab, { label: MessageKey; hint: MessageKey; icon: unknown }>;

const isTab = (value: string): value is Tab => (SETTINGS_TABS as readonly string[]).includes(value);

export function SettingsPage() {
  const { t } = useI18n();
  const { tab } = useParams();
  const navigate = useNavigate();

  // The first section opens at once, on a computer and on a phone (the prototype's "Seção: Conta").
  if (tab === undefined || !isTab(tab)) return <Navigate to="/configuracoes/conta" replace />;
  const current = SECTION[tab];
  const label = t(current.label);

  return (
    <>
      <PageHeader title={t("web.settings.title")} description={t("web.settings.description")} documentTitle={`${label} · ${t("web.settings.title")}`} />
      {/* On a phone the sections are one list that opens, grouped like the side menu: no strip that scrolls sideways. */}
      <label className="flex min-h-12 items-center gap-2 rounded-2xl border border-border bg-surface px-4 shadow-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent lg:hidden">
        <span className="text-sm text-fg-muted" aria-hidden>
          {t("web.settings.section")}
        </span>
        {/* Named "Seção" alone: the label around it would add the chosen option to the name. */}
        <select
          aria-label={t("web.settings.section")}
          value={tab}
          onChange={(event) => navigate(`/configuracoes/${event.target.value}`)}
          className="min-h-11 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent font-semibold text-fg outline-none"
        >
          {GROUPS.map((group) => (
            <optgroup key={group.label} label={t(group.label)}>
              {group.tabs.map((id) => (
                <option key={id} value={id}>
                  {t(SECTION[id].label)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
      </label>
      {/* On a computer the sections are a submenu beside the page, in five groups, each with its line of what it holds. */}
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav aria-label={t("web.settings.sections")} className="sticky top-20 hidden lg:block">
          {GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">{t(group.label)}</h2>
              <ul className="space-y-1">
                {group.tabs.map((id) => {
                  const { label: name, hint, icon: Icon } = SECTION[id];
                  return (
                    <li key={id}>
                      <NavLink
                        to={`/configuracoes/${id}`}
                        aria-describedby={`secao-${id}`}
                        className={({ isActive }) =>
                          cn(
                            "flex min-h-11 items-start gap-3 rounded-2xl border px-3 py-2.5",
                            isActive ? "border-border bg-surface text-fg shadow-sm" : "border-transparent text-fg hover:bg-raised",
                          )
                        }
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{t(name)}</span>
                          {/* The hint describes the link; its name stays the section's. */}
                          <span id={`secao-${id}`} className="block text-xs leading-5 text-fg-muted" aria-hidden>
                            {t(hint)}
                          </span>
                        </span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <section aria-label={label} className="min-w-0 space-y-6">
          {tab === "conta" && <AccountTab />}
          {tab === "seguranca" && <SecurityTab />}
          {tab === "assistente" && <AssistantTab />}
          {tab === "ia" && <AiUsageTab />}
          {tab === "modelos" && <AiModelsTab />}
          {tab === "agenda" && <AgendaTab />}
          {tab === "avisos" && <AlertsTab />}
          {tab === "integracoes" && <IntegrationsTab />}
          {tab === "chatwoot" && (
            <Suspense fallback={<Loading />}>
              <ChatwootTab />
            </Suspense>
          )}
          {tab === "dados" && <DataTab />}
          {tab === "diagnostico" && <DiagnosticsTab />}
          {tab === "sobre" && <AboutTab />}
        </section>
      </div>
    </>
  );
}
