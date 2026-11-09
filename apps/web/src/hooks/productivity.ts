import { useQuery } from "@tanstack/react-query";
import type { Note, NoteSummary, Project, Task, TaskView, TrashItem } from "@zuri/shared";
import { api } from "../lib/api.ts";

/** Query keys: everything the trash touches starts with one of these. */
export const TASKS_KEY = ["tasks"] as const;
export const NOTES_KEY = ["notes"] as const;
export const PROJECTS_KEY = ["projects"] as const;
export const TRASH_KEY = ["trash"] as const;

export interface TaskFilter {
  view: TaskView;
  projectId: string;
  q: string;
}

function search(params: Record<string, string>): string {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== ""));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function useTasks(filter: TaskFilter) {
  return useQuery({
    queryKey: [...TASKS_KEY, filter],
    queryFn: ({ signal }) => api<{ tasks: Task[] }>(`/tasks${search({ view: filter.view, projectId: filter.projectId, q: filter.q })}`, { signal }),
    placeholderData: (previous) => previous,
  });
}

export function useNotes(q: string) {
  return useQuery({
    queryKey: [...NOTES_KEY, "list", q],
    queryFn: ({ signal }) => api<{ notes: NoteSummary[] }>(`/notes${search({ q })}`, { signal }),
    placeholderData: (previous) => previous,
  });
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: [...NOTES_KEY, "one", id],
    queryFn: ({ signal }) => api<{ note: Note }>(`/notes/${id}`, { signal }),
    enabled: id !== undefined,
    // A note being edited is not refetched under the owner's typing.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

export function useProjects() {
  return useQuery({ queryKey: PROJECTS_KEY, queryFn: ({ signal }) => api<{ projects: Project[] }>("/projects", { signal }) });
}

/** The trash, or only its tasks or notes: the server filters, so the count and the 200 newest are that kind's. */
export const trashKey = (kind?: TrashItem["kind"]) => (kind ? ([...TRASH_KEY, kind] as const) : TRASH_KEY);

export function useTrash(kind?: TrashItem["kind"]) {
  return useQuery({
    queryKey: trashKey(kind),
    queryFn: ({ signal }) => api<{ items: TrashItem[]; total: number }>(kind ? `/trash?kind=${kind}` : "/trash", { signal }),
  });
}
