import { useQuery } from "@tanstack/react-query";
import { type AutomationList, ptBRHome } from "@zuri/shared";
import { ArrowUp, ChevronRight } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Greeting } from "../../components/Greeting.tsx";
import { cn, ErrorNotice, Loading } from "../../components/ui.tsx";
import { useTasks } from "../../hooks/productivity.ts";
import { api } from "../../lib/api.ts";
import { dueInputs } from "../../lib/due.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { dayOffset } from "../../lib/recents.ts";
import { DayCard, useDayWindow } from "./DayCard.tsx";

// Loaded on demand by the home page, with its pt-BR texts (rule P11).
addMessages(ptBRHome);

/** How many lines "Próximos dias" lists: a glance, the full list is one tap away. */
const SHOWN = 5;
/** How far "Próximos dias" looks ahead for routines. */
const NEXT_DAYS = 7;

/**
 * The home page: the greeting, a field to write to Zuri, three ideas to start
 * with, "Seu dia" and the next days. The greeting's placeholder comes from the
 * page, which shows the same one while this part loads.
 */
export function HomeBody({ greetingSlot }: { greetingSlot: ReactNode }) {
  const { t } = useI18n();
  const window = useDayWindow();
  // The Rotinas page's own query (same key and address), written out: importing its hook would split the first load.
  const automations = useQuery({ queryKey: ["automations", "list"], queryFn: ({ signal }) => api<AutomationList>("/automations", { signal }) });
  const list = automations.data?.automations ?? [];
  // At midnight "Amanhã" is another day: the lists under this one are drawn again.
  const [, turn] = useState(0);
  const newDay = useCallback(() => turn((count) => count + 1), []);
  return (
    <>
      <Greeting placeholder={greetingSlot} />
      <Ask />
      <Block title={t("web.home.day.title")} note={window} link={<More to="/agenda" label={t("web.home.day.agenda")} />}>
        <DayCard automations={list} onNewDay={newDay} />
      </Block>
      <Block title={t("web.home.next.title")} link={<More to="/tarefas" label={t("web.home.next.link")} />}>
        <NextDays automations={list} />
      </Block>
    </>
  );
}

/** Whatever is written here opens a new conversation with it (ChatPage reads it from the address's state). */
function Ask() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const ask = (message: string) => message.trim() && navigate("/conversa", { state: { ask: message.trim() } });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(text);
  };
  const ideas = [t("web.home.idea.week"), t("web.home.idea.tomorrow"), t("web.home.idea.remind")];
  return (
    <>
      <form
        onSubmit={submit}
        className="flex flex-wrap items-end rounded-3xl border border-border-strong bg-surface py-2.5 pr-2.5 pl-5 shadow-md transition-shadow focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/20"
      >
        <label className="min-w-0 basis-full">
          <span className="sr-only">{t("web.home.ask")}</span>
          <textarea
            value={text}
            rows={1}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line; never in the middle of composing an accented letter.
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              ask(text);
            }}
            placeholder={t("web.home.placeholder")}
            enterKeyHint="send"
            className="field-sizing-content block max-h-40 min-h-11 w-full resize-none bg-transparent pt-2.5 pb-1 text-[17px] leading-normal text-fg placeholder:text-fg-muted focus:outline-none"
          />
        </label>
        <button
          type="submit"
          aria-label={t("web.home.send")}
          disabled={!text.trim()}
          className="ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          <ArrowUp className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        </button>
      </form>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("web.home.ideas")}>
        {ideas.map((idea) => (
          <li key={idea}>
            <button
              type="button"
              onClick={() => ask(idea)}
              className="min-h-11 rounded-full border border-border-strong bg-surface px-3.5 text-sm font-medium text-fg transition-colors hover:bg-raised"
            >
              {idea}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A part of the page: its title, a quiet note beside it and a link at the far end. */
function Block({ title, note, link, children }: { title: string; note?: string; link: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-10">
      <div className="mb-2 flex items-center gap-2">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {note && <span className="text-sm tabular-nums text-fg-muted">{note}</span>}
        {link}
      </div>
      {children}
    </section>
  );
}

function More({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="-mr-1 ml-auto inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg pr-1 pl-2 text-sm font-semibold text-fg-muted hover:bg-raised hover:text-fg">
      {label}
      <ChevronRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

/** One line of "Próximos dias": a task with a deadline or a routine's next run. */
interface Upcoming {
  id: string;
  title: string;
  at: string;
  routine: boolean;
}

function NextDays({ automations }: { automations: AutomationList["automations"] }) {
  const { t, locale, timeZone } = useI18n();
  const tasks = useTasks({ view: "upcoming", projectId: "", q: "" });
  const now = new Date();
  const entries: Upcoming[] = [
    ...(tasks.data?.tasks ?? []).flatMap((task) => (task.dueAt ? [{ id: task.id, title: task.title, at: task.dueAt, routine: false }] : [])),
    // Active ones whose next run falls on one of the next days (today's are in "Seu dia" already).
    ...automations.flatMap((item) => {
      const offset = item.status === "active" && item.nextRunAt ? dayOffset(item.nextRunAt, now, timeZone) : 0;
      return item.nextRunAt && offset >= 1 && offset <= NEXT_DAYS ? [{ id: item.id, title: item.name, at: item.nextRunAt, routine: true }] : [];
    }),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, SHOWN);
  if (tasks.isPending) return <Loading />;
  if (tasks.isError) return <ErrorNotice error={tasks.error} onRetry={() => void tasks.refetch()} />;
  // The day of each line: "Amanhã", then the weekday and the day ("qui., 5"), in the owner's zone.
  const day = (at: string) =>
    dayOffset(at, now, timeZone) === 1 ? t("web.home.tomorrow") : new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric" }).format(new Date(at));
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-1 shadow-sm">
      {entries.length === 0 ? (
        <p className="py-4 text-sm text-fg-muted">{t("web.home.next.empty")}</p>
      ) : (
        <ul>
          {entries.map((entry, index) => {
            // The day shows once, on its first line; a screen reader hears it on every line.
            const repeated = index > 0 && day(entries[index - 1]?.at ?? "") === day(entry.at);
            return (
              <li key={entry.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-border/60 py-3.5 first:border-t-0">
                <span className={cn("text-sm font-medium first-letter:uppercase", repeated && "sr-only")}>{day(entry.at)}</span>
                <span className="col-start-2 min-w-0 font-medium break-words">{entry.title}</span>
                <span className="text-sm whitespace-nowrap tabular-nums text-fg-muted">{entry.routine ? t("web.home.next.routine") : dueInputs(entry.at, timeZone).time}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
