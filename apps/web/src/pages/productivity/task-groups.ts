import type { Task, TaskView } from "@zuri/shared";

/** The calendar day of an instant in the owner's zone, as YYYY-MM-DD (en-CA writes it so): two of them compare as text. */
const localDay = (instant: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);

export type TaskGroup = Exclude<TaskView, "all">;
const GROUP_ORDER: readonly TaskGroup[] = ["overdue", "today", "upcoming", "completed"];

/** Which group a task is listed under, by the same rules as the server's views (`TaskRepository.list`). */
export function taskGroup(task: Task, now: Date, timeZone: string): TaskGroup {
  if (task.status === "done") return "completed";
  if (task.dueAt === null) return task.status === "in_progress" ? "today" : "upcoming";
  if (Date.parse(task.dueAt) < now.getTime()) return "overdue";
  return localDay(new Date(task.dueAt), timeZone) <= localDay(now, timeZone) ? "today" : "upcoming";
}

/** The tasks of a list under their headings (late first, done last), each in the order the server gave. */
export function groupTasks(tasks: readonly Task[], now: Date, timeZone: string): { group: TaskGroup; tasks: Task[] }[] {
  const byGroup = new Map<TaskGroup, Task[]>();
  for (const task of tasks) {
    const group = taskGroup(task, now, timeZone);
    byGroup.set(group, [...(byGroup.get(group) ?? []), task]);
  }
  return GROUP_ORDER.flatMap((group) => (byGroup.has(group) ? [{ group, tasks: byGroup.get(group) ?? [] }] : []));
}
