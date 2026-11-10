import { ptBRShell } from "@zuri/shared";
import { Monitor, Moon, Sun } from "lucide-react";
import { useId, useState } from "react";
import { addMessages, useI18n } from "../lib/i18n.tsx";
import { applyTheme, readTheme, type ThemePreference } from "../lib/theme.ts";

// Its names come with it: the account panel and Configurações › Conta both show it, each on demand (rule P11).
addMessages(ptBRShell);

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
// The order of the Sinal: light, dark, then "as the system".
const ORDER = ["light", "dark", "system"] as const satisfies readonly ThemePreference[];

/**
 * Light, dark or as the system: a choice of this device, kept in its storage.
 * `wide` stretches the three choices across the line (the account panel).
 * No import from ui.tsx, like the panel around it (shell/Panel.tsx).
 */
export function ThemeSwitcher({ wide = false }: { wide?: boolean }) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  // Its own radio group: the page behind the account panel may show another switcher.
  const name = useId();
  const labels = { system: t("web.theme.system"), light: t("web.theme.light"), dark: t("web.theme.dark") } as const;
  return (
    <fieldset className="space-y-2">
      <legend className={wide ? "text-xs font-medium text-fg-muted" : "text-sm font-medium"}>{t("web.theme.label")}</legend>
      {/* Icons only (Sinal): the name stays for screen readers and as the hint on hover. */}
      <div className={`${wide ? "flex" : "inline-flex"} gap-0.5 rounded-xl border border-border bg-raised p-1`}>
        {ORDER.map((option) => {
          const Icon = ICONS[option];
          const checked = theme === option;
          return (
            <label
              key={option}
              title={labels[option]}
              className={`flex h-11 cursor-pointer items-center justify-center rounded-lg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${wide ? "flex-1" : "w-11"} ${
                checked ? "bg-surface text-fg shadow-sm ring-1 ring-border dark:bg-border dark:ring-border-strong" : "text-fg-muted hover:text-fg"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={checked}
                onChange={() => {
                  setTheme(option);
                  applyTheme(option);
                }}
                className="sr-only"
              />
              <Icon className="h-5 w-5" aria-hidden />
              <span className="sr-only">{labels[option]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
