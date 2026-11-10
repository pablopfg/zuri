import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../lib/i18n.tsx";
import { applyTheme, readTheme, THEMES, type ThemePreference } from "../lib/theme.ts";
import { cn } from "./ui.tsx";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** Light, dark or as the system: a choice of this device, kept in its storage. */
export function ThemeSwitcher() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  const labels = { system: t("web.theme.system"), light: t("web.theme.light"), dark: t("web.theme.dark") } as const;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t("web.theme.label")}</legend>
      {/* Icons only (Sinal): the name stays for screen readers and as the hint on hover. */}
      <div className="inline-flex gap-1 rounded-xl border border-border bg-raised p-1">
        {THEMES.map((option) => {
          const Icon = ICONS[option];
          const checked = theme === option;
          return (
            <label
              key={option}
              title={labels[option]}
              className={cn(
                "flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                checked ? "border border-accent bg-accent-soft text-accent-text" : "border border-transparent text-fg-muted hover:text-fg",
              )}
            >
              <input
                type="radio"
                name="theme"
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
