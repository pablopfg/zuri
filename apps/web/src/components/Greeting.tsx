import { useQuery } from "@tanstack/react-query";
import { ptBRGreeting, type Settings } from "@zuri/shared";
import { type ReactNode, useEffect, useState } from "react";
import { SETTINGS_KEY } from "../hooks/session.tsx";
import { api } from "../lib/api.ts";
import { GREETING_LINES, GREETING_TITLES, greetingFor, msUntilNextPart } from "../lib/greeting.ts";
import { addMessages, useI18n } from "../lib/i18n.tsx";

// Loaded on demand by the home page, with its pt-BR lines (rule P11).
addMessages(ptBRGreeting);

/** The current moment, looked at again when the part of the day may turn and when the tab comes back. */
function useNow(timeZone: string): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setTimeout(() => setNow(new Date()), msUntilNextPart(now, timeZone));
    return () => clearTimeout(timer);
  }, [now, timeZone]);
  useEffect(() => {
    // Timers sleep in background tabs: a tab opened at night and read in the morning catches up here.
    const onVisible = () => document.visibilityState === "visible" && setNow(new Date());
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return now;
}

/**
 * The home page's title: the day, good morning, afternoon or evening by the owner's
 * clock (their zone, not the device's), with their name when they gave one,
 * and a line in the agent's voice that changes every day.
 */
// The placeholder comes from the page: importing ui.tsx here would make the bundler split it
// out of the first load into a shared chunk (armadilhas.md, "Pacote da interface").
export function Greeting({ placeholder }: { placeholder: ReactNode }) {
  const { t, locale, timeZone } = useI18n();
  // Same query as the session's: already in memory, no second request.
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api<Settings>("/settings"), staleTime: 5 * 60_000 });
  const now = useNow(timeZone);

  if (settings.isPending) return placeholder;

  const { part, line } = greetingFor(now, timeZone);
  const name = settings.data?.ownerName ?? "";
  const titles = GREETING_TITLES[part];
  const lineKey = GREETING_LINES[part][line] ?? GREETING_LINES[part][0];

  // The owner's day, as "segunda-feira, 9 de novembro" (the first letter goes up in the style).
  const date = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <header className="mb-5 motion-safe:animate-rise">
      <p className="mb-1.5 text-sm font-medium text-fg-muted first-letter:uppercase">{date}</p>
      <h1 className="text-3xl leading-tight font-semibold tracking-tight break-words md:text-4xl">{name ? t(titles.named, { name }) : t(titles.plain)}</h1>
      {lineKey && <p className="mt-2.5 max-w-[56ch] text-lg text-fg-muted">{t(lineKey)}</p>}
    </header>
  );
}
