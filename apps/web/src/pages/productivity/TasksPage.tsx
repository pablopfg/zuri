import { useQueryClient } from "@tanstack/react-query";
import {
  type Project,
  TASK_DESCRIPTION_MAX,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TITLE_MAX,
  TASK_VIEWS,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskView,
  type TrashItem,
} from "@zuri/shared";
import { CheckCircle2, ChevronDown, Circle, CircleDot, Flag, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, buttonClass, cn, Dialog, EmptyState, ErrorNotice, fieldClass, PageHeader, SelectField, Loading, TextAreaField, TextField } from "../../components/ui.tsx";
import { PROJECTS_KEY, TASKS_KEY, useProjects, useTasks } from "../../hooks/productivity.ts";
import { useTaskCounts } from "../../hooks/task-counts.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { FlashStatus, flashClass, useDebounced, useFlash } from "../../lib/lists.tsx";
import { dueFromInputs, dueInputs, formatDue, quickAddDue } from "../../lib/due.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { groupTasks } from "./task-groups.ts";
import { ProjectsDialog } from "./ProjectsDialog.tsx";
import { FolderIcon as Folder, PRIORITY_LABEL, ProjectOptions, STATUS_LABEL, TrashedNotice, VIEW_EMPTY, VIEW_LABEL } from "./shared.tsx";

/**
 * Tasks: quick add, views by deadline, search, a folder filter, the list under its headings (late first) and an
 * editor. The arrangement is the Sinal one (PR S07); "project" is the name in the code of what the owner sees as a folder.
 */
export function TasksPage() {
  const { t, timeZone } = useI18n();
  const [view, setView] = useState<TaskView>("today");
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const tasks = useTasks({ view, projectId, q });
  const counts = useTaskCounts().data?.counts;
  const projects = useProjects();
  // The rows that changed glow for a moment; a list the owner just switched to never does.
  const flash = useFlash(tasks.isPlaceholderData ? undefined : tasks.data?.tasks, (task) => task.id, (task) => `${task.updatedAt}|${task.status}`, `${view}|${projectId}|${q}`);
  const [editing, setEditing] = useState<Task | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [trashed, setTrashed] = useState<TrashItem | null>(null);
  const projectList = projects.data?.projects ?? [];
  const [focusNew, setFocusNew] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  // The command palette asks to open a task or to start a new one (revisão de design, D1).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per arrival (location.key); the state is read then cleared.
  useEffect(() => {
    const asked = location.state as { openTask?: Task; newTask?: boolean } | null;
    if (!asked) return;
    if (asked.openTask) setEditing(asked.openTask);
    if (asked.newTask) {
      // The new-task field only shows where a new task can land.
      setView((current) => (current === "completed" || current === "overdue" ? "today" : current));
      setFocusNew((n) => n + 1);
    }
    // Once: going back or reloading doesn't open it again.
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
  }, [location.key]);

  // Marking a task moves its row to another heading (and back, when the server refuses), so what the row
  // would lose on the way lives here: the wait, the reason of a refusal and the focus.
  const qc = useQueryClient();
  const [marking, setMarking] = useState<ReadonlySet<string>>(new Set());
  const [refused, setRefused] = useState<Record<string, string>>({});
  const follow = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: after every drawing, while a marked task is being followed.
  useEffect(() => {
    if (follow.current && (document.activeElement === document.body || document.activeElement === null)) {
      document.querySelector<HTMLElement>(`input[data-task="${follow.current}"]:not(:disabled)`)?.focus();
    }
  });

  async function toggle(task: Task) {
    const status = task.status === "done" ? "todo" : "done";
    const waiting = (on: boolean) =>
      setMarking((current) => {
        const next = new Set(current);
        if (on) next.add(task.id);
        else next.delete(task.id);
        return next;
      });
    follow.current = task.id;
    waiting(true);
    setRefused(({ [task.id]: _gone, ...rest }) => rest);
    // The mark changes at once (in this same click) in every list that shows the task; a refusal puts the lists back as they were.
    // A fetch in flight would land after the mark and undo it.
    await qc.cancelQueries({ queryKey: TASKS_KEY });
    const before = qc.getQueriesData({ queryKey: TASKS_KEY });
    qc.setQueriesData<{ tasks: Task[] }>({ queryKey: TASKS_KEY }, (list) =>
      list?.tasks ? { ...list, tasks: list.tasks.map((item) => (item.id === task.id ? { ...item, status } : item)) } : list,
    );
    try {
      await api(`/tasks/${task.id}`, { method: "PATCH", body: { status } });
    } catch (err) {
      for (const [key, data] of before) qc.setQueryData(key, data);
      setRefused((current) => ({ ...current, [task.id]: errorMessage(err) }));
    } finally {
      waiting(false);
      await qc.invalidateQueries({ queryKey: TASKS_KEY });
      // The lists are as the server has them: the row is where it stays, and the focus is the owner's again.
      setTimeout(() => {
        if (follow.current === task.id) follow.current = null;
      }, 0);
    }
  }

  return (
    <>
      <PageHeader
        title={t("web.tasks.title")}
        description={t("web.tasks.description")}
        actions={
          <>
            <Button variant="secondary" className="min-w-11 px-3" onClick={() => setProjectsOpen(true)}>
              <Folder className="h-4 w-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t("web.projects.manage")}</span>
            </Button>
            <Link to="/configuracoes/dados?tipo=tarefas" className={buttonClass("secondary", "min-w-11 px-3")}>
              <Trash2 className="h-4 w-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t("web.trash.open")}</span>
            </Link>
          </>
        }
      />

      {trashed && <TrashedNotice item={trashed} message={t("web.tasks.trashed")} onDone={() => setTrashed(null)} />}

      <div className="space-y-4">
        {/* A task added here would not show up in Completed or Overdue, so those views have no quick add. */}
        {view !== "completed" && view !== "overdue" && <NewTask projects={projectList} forToday={view === "today"} focusSignal={focusNew} />}

        {/* Sized by their labels; on a narrow phone they wrap into rows, nothing hides off the side (Sinal). */}
        <fieldset className="flex min-w-0 flex-wrap gap-1 rounded-xl bg-raised p-1 sm:w-fit">
        <legend className="sr-only">{t("web.tasks.viewLabel")}</legend>
        {TASK_VIEWS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={view === item}
            onClick={() => setView(item)}
            className={cn(
              "min-h-11 flex-auto whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors",
              view === item ? "bg-surface text-fg shadow-sm ring-1 ring-border-strong" : "text-fg-muted hover:text-fg",
            )}
          >
            {t(VIEW_LABEL[item])} {counts && <span className="tabular-nums text-fg-muted">{counts[item]}</span>}
          </button>
        ))}
      </fieldset>

        <section aria-label={t("web.tasks.listLabel")} className="space-y-3">
          <div className="grid grid-cols-[minmax(0,1fr)_11rem] gap-2 sm:grid-cols-[1fr_14rem]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <input
                type="search"
                value={query}
                maxLength={200}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("web.tasks.search")}
                aria-label={t("web.tasks.search")}
                className={cn(fieldClass, "pl-9")}
              />
            </div>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label={t("web.tasks.filterProject")} className={fieldClass}>
              <option value="">{t("web.tasks.allProjects")}</option>
              <option value="none">{t("web.tasks.noProject")}</option>
              {projectList.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          {tasks.isPending ? (
            <Loading />
          ) : tasks.isError ? (
            <ErrorNotice error={tasks.error} onRetry={() => void tasks.refetch()} />
          ) : tasks.data.tasks.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title={q ? t("web.tasks.empty.search") : t(VIEW_EMPTY[view])}>
              {!q && view === "today" && t("web.tasks.emptyBody.today")}
              {!q && view === "all" && t("web.tasks.emptyBody.all")}
            </EmptyState>
          ) : (
            groupTasks(tasks.data.tasks, new Date(), timeZone).map(({ group, tasks: rows }) => (
              <section key={group} aria-labelledby={`tasks-${group}`} className="space-y-2">
                <h2 id={`tasks-${group}`} className="pt-1 text-sm font-semibold">
                  {t(VIEW_LABEL[group])} <span className="ml-1 font-normal tabular-nums text-fg-muted">{rows.length}</span>
                </h2>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                  {rows.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      projects={projectList}
                      glow={flashClass(flash.glowing, task.id)}
                      onOpen={() => setEditing(task)}
                      pending={marking.has(task.id)}
                      error={refused[task.id]}
                      onToggle={() => void toggle(task)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
          <FlashStatus count={flash.remote} />
        </section>
      </div>

      {editing && (
        <TaskDialog
          task={editing}
          projects={projectList}
          onClose={() => setEditing(null)}
          onTrashed={(item) => {
            setEditing(null);
            setTrashed(item);
          }}
        />
      )}
      <ProjectsDialog open={projectsOpen} onClose={() => setProjectsOpen(false)} />
    </>
  );
}

/**
 * Quick add: a title and Enter. In the Today view a task without a date is due
 * today (by the end of the day), so it shows up where it was typed. The rest
 * (date, time, project, priority) sits behind "More options".
 */
function NewTask({ projects, forToday, focusSignal }: { projects: Project[]; forToday: boolean; focusSignal: number }) {
  const { t, locale, timeZone, dateTime } = useI18n();
  const titleRef = useRef<HTMLInputElement>(null);
  // Only a new signal focuses: remounting (switching views) must not take the focus again.
  const seenSignal = useRef(focusSignal);
  useEffect(() => {
    if (focusSignal > seenSignal.current) titleRef.current?.focus();
    seenSignal.current = focusSignal;
  }, [focusSignal]);
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [more, setMore] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const optionsId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const dueAt = quickAddDue(date, time, forToday, new Date(), timeZone);
    if (dueAt === null) {
      setError(t("web.tasks.invalidDate"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api("/tasks", { method: "POST", body: { title, priority, dueAt: dueAt || null, projectId: projectId || null } });
      // Every task starts plain: nothing chosen for one carries over, unseen, to the next.
      setTitle("");
      setDate("");
      setTime("");
      setProjectId("");
      setPriority("medium");
      setMore(false);
      await qc.invalidateQueries({ queryKey: TASKS_KEY });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const placeholder = forToday && !date ? t("web.tasks.addForToday") : t("web.tasks.addOne");
  // With the panel closed, what is chosen in it stays in view.
  const dueAtChosen = date ? dueFromInputs(date, time, timeZone) : "";
  const chosen = [
    // A date the browser accepts but the deadline can't be (a 5-digit year) is left out, not formatted (SEC-6R-03).
    dueAtChosen && formatDue(dueAtChosen, locale, timeZone, dateTime),
    projects.find((project) => project.id === projectId)?.name,
    priority !== "medium" && t(PRIORITY_LABEL[priority]),
  ].filter(Boolean);

  return (
    <section aria-label={t("web.tasks.new")}>
      <form onSubmit={(e) => void submit(e)} className="space-y-1">
        <div className="flex gap-2">
          <input
            ref={titleRef}
            value={title}
            required
            maxLength={TASK_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className={cn(fieldClass, "flex-1")}
          />
          <Button type="submit" loading={pending} disabled={!title.trim()} aria-label={t("web.tasks.add")}>
            {!pending && <Plus className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline">{t("web.tasks.addShort")}</span>
          </Button>
        </div>
        <button
          type="button"
          aria-expanded={more}
          aria-controls={optionsId}
          onClick={() => setMore((open) => !open)}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-fg-muted hover:bg-raised hover:text-fg"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} aria-hidden />
          {t("web.tasks.moreOptions")}
        </button>
        {!more && chosen.length > 0 && <span className="ml-1 text-sm text-fg-muted">{t("web.tasks.optionsChosen", { summary: chosen.join(" · ") })}</span>}
        <div id={optionsId} hidden={!more} className="mt-1 space-y-2 rounded-2xl border border-border bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <TextField label={t("web.tasks.field.date")} type="date" value={date} min="2000-01-01" max="2199-12-31" onChange={(e) => setDate(e.target.value)} />
            <TextField label={t("web.tasks.field.time")} type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
            <SelectField label={t("web.tasks.field.project")} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <ProjectOptions projects={projects} none={t("web.tasks.noProject")} />
            </SelectField>
            <SelectField label={t("web.tasks.field.priority")} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((item) => (
                <option key={item} value={item}>
                  {t(PRIORITY_LABEL[item])}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="text-xs leading-5 text-fg-muted">{t("web.tasks.timeHint")}</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function TaskRow({
  task,
  projects,
  glow,
  onOpen,
  pending,
  error,
  onToggle,
}: { task: Task; projects: Project[]; glow: string; onOpen: () => void; pending: boolean; error: string | undefined; onToggle: () => void }) {
  const { t, locale, timeZone, dateTime } = useI18n();
  const done = task.status === "done";
  const overdue = !done && task.dueAt !== null && Date.parse(task.dueAt) < Date.now();
  const project = projects.find((item) => item.id === task.projectId);
  const flagged = !done && (task.priority === "high" || task.priority === "urgent");

  const Mark = done ? CheckCircle2 : task.status === "in_progress" ? CircleDot : Circle;
  const due = task.dueAt ? formatDue(task.dueAt, locale, timeZone, dateTime) : "";
  return (
    <li className={cn("grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-1 px-2 py-1.5 transition-colors hover:bg-raised/60 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto]", glow)}>
      {/* A real checkbox, drawn as a 44 px round mark: the icon shows the state, the input takes the touch. */}
      <span className={cn("relative row-span-2 flex h-11 w-11 shrink-0 items-center justify-center sm:row-span-1", done ? "text-accent-text" : "text-fg-muted")}>
        <input
          type="checkbox"
          checked={done}
          disabled={pending}
          data-task={task.id}
          onChange={onToggle}
          aria-label={t(done ? "web.tasks.reopen" : "web.tasks.complete", { title: task.title })}
          className="peer absolute inset-0 h-11 w-11 cursor-pointer appearance-none rounded-xl disabled:cursor-wait"
        />
        <Mark className="pointer-events-none relative h-5 w-5 peer-hover:text-accent-text" aria-hidden />
      </span>
      <div className="min-w-0">
        <button
          type="button"
          onClick={onOpen}
          className={cn("min-h-11 w-full rounded-lg px-1 text-left text-[15px] leading-6 font-medium break-words hover:underline", done && "font-normal text-fg-muted line-through")}
        >
          {task.title}
        </button>
        {(project || task.status === "in_progress" || task.description) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1 text-sm text-fg-muted">
            {project && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{project.name}</span>
              </span>
            )}
            {task.status === "in_progress" && <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-fg">{t(STATUS_LABEL.in_progress)}</span>}
            {task.description && <span className="max-w-[16rem] truncate">{task.description}</span>}
          </div>
        )}
        {error && (
          <p role="alert" className="px-1 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      {/* Deadline and priority: at the right on a wide screen, under the title on a phone. */}
      <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1.5 text-sm tabular-nums text-fg-muted sm:col-start-3 sm:flex-col sm:items-end sm:justify-center sm:py-1.5 sm:pr-3">
        {due &&
          (overdue ? (
            <span className="inline-flex items-center gap-1 font-medium text-danger">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("web.tasks.overdueAt", { date: due })}
            </span>
          ) : (
            <span>{due}</span>
          ))}
        <span className={cn("inline-flex items-center gap-1", flagged && "font-medium", flagged && (task.priority === "urgent" ? "text-danger" : "text-warning"))}>
          <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="sr-only">{t("web.tasks.field.priority")}: </span>
          {t(PRIORITY_LABEL[task.priority])}
        </span>
      </div>
    </li>
  );
}

function TaskDialog({ task, projects, onClose, onTrashed }: { task: Task; projects: Project[]; onClose: () => void; onTrashed: (item: TrashItem) => void }) {
  const { t, timeZone } = useI18n();
  const qc = useQueryClient();
  const initial = dueInputs(task.dueAt, timeZone);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [projectId, setProjectId] = useState(task.projectId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"save" | "delete" | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const dueAt = dueFromInputs(date, time, timeZone);
    if (dueAt === null) {
      setError(t("web.tasks.invalidDate"));
      return;
    }
    setPending("save");
    setError(null);
    try {
      // Only what changed: an untouched deadline keeps its exact value (seconds included).
      const next = { title, description, status, priority, dueAt: dueAt || null, projectId: projectId || null };
      const changed = Object.fromEntries(
        Object.entries(next).filter(([key, value]) =>
          key === "dueAt" ? date !== initial.date || time !== initial.time : value !== task[key as keyof typeof next],
        ),
      );
      if (Object.keys(changed).length > 0) await api(`/tasks/${task.id}`, { method: "PATCH", body: changed });
      await qc.invalidateQueries({ queryKey: TASKS_KEY });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setPending(null);
    }
  }

  async function remove() {
    setPending("delete");
    setError(null);
    try {
      const { trashItem } = await api<{ trashItem: TrashItem }>(`/tasks/${task.id}`, { method: "DELETE" });
      await Promise.all([qc.invalidateQueries({ queryKey: TASKS_KEY }), qc.invalidateQueries({ queryKey: PROJECTS_KEY })]);
      onTrashed(trashItem);
    } catch (err) {
      setError(errorMessage(err));
      setPending(null);
    }
  }

  return (
    <Dialog open onClose={onClose} title={t("web.tasks.edit")}>
      <form onSubmit={(e) => void save(e)} className="space-y-3">
        <TextField label={t("web.tasks.field.title")} value={title} required maxLength={TASK_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
        <TextAreaField
          label={t("web.tasks.field.description")}
          value={description}
          maxLength={TASK_DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t("web.tasks.field.date")} type="date" value={date} min="2000-01-01" max="2199-12-31" onChange={(e) => setDate(e.target.value)} />
          <TextField label={t("web.tasks.field.time")} type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
          <SelectField label={t("web.tasks.field.status")} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {TASK_STATUSES.map((item) => (
              <option key={item} value={item}>
                {t(STATUS_LABEL[item])}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("web.tasks.field.priority")} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {TASK_PRIORITIES.map((item) => (
              <option key={item} value={item}>
                {t(PRIORITY_LABEL[item])}
              </option>
            ))}
          </SelectField>
        </div>
        <SelectField label={t("web.tasks.field.project")} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <ProjectOptions projects={projects} none={t("web.tasks.noProject")} />
        </SelectField>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <Button variant="danger" onClick={() => void remove()} loading={pending === "delete"} disabled={pending !== null}>
            <Trash2 className="h-4 w-4" aria-hidden />
            {t("web.trash.moveTo")}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t("web.cancel")}
            </Button>
            <Button type="submit" loading={pending === "save"} disabled={pending !== null || !title.trim()}>
              {t("web.save")}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
