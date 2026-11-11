import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Memory, MemoryGraph, MemoryHub, MemoryHubKind, MemoryLinkKind } from "@zuri/shared";
import { Archive, ArchiveRestore, ArrowLeft, BadgeCheck, BookUser, CircleHelp, CornerDownRight, Folder, History, type LucideIcon, MessagesSquare, ListTodo, Notebook, Pencil, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { type ReactNode, type Ref, useState } from "react";
import { Link } from "react-router";
import { ActionsMenu } from "../../components/ActionsMenu.tsx";
import { Button, ErrorNotice, Loading } from "../../components/ui.tsx";
import { MEMORIES_KEY } from "../../hooks/memory.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { CATEGORY_LABEL, HUB_LABEL, ORIGIN_LABEL, STATUS_LABEL } from "./labels.ts";

/** One memory and what touches it: the panel's own request, small and bounded by the server. */
export function useMemoryLinks(id: string | null) {
  return useQuery({
    queryKey: [...MEMORIES_KEY, "graph", id],
    queryFn: ({ signal }) => api<MemoryGraph>(`/memories/graph?around=${id}`, { signal }),
    enabled: id !== null,
    staleTime: 15_000,
  });
}

const HUB_ICON: Record<MemoryHubKind, LucideIcon> = { folder: Folder, conversation: MessagesSquare, task: ListTodo, note: Notebook, contact: BookUser };
/** Where a hub opens: a note, a conversation and a contact have a page of their own; a task and a folder open their list. */
export const hubPath = (hub: MemoryHub): string =>
  hub.kind === "note" ? `/notas/${hub.ref}` : hub.kind === "conversation" ? `/conversa/${hub.ref}` : hub.kind === "contact" ? `/contatos/${hub.ref}` : "/tarefas";

export interface PanelActions {
  onEdit: (memory: Memory) => void;
  onCorrect: (memory: Memory) => void;
  onHistory: (memory: Memory) => void;
  onDelete: (memory: Memory) => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

const pick = "block w-full rounded-lg px-2 py-2 text-left text-sm leading-5 underline decoration-border-strong underline-offset-4 transition-colors hover:bg-raised";

/** The back button of the phone, where the panel takes the list's place. */
function Back({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-fg-muted hover:bg-raised hover:text-fg lg:hidden">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t("web.memory.panel.back")}
    </button>
  );
}

/**
 * The chosen memory: its text, what can be done with it and what it is linked
 * to ("Ligada a", "Aparece em", "Memórias próximas"). The links are worked out
 * by the server from names and words in common, and the panel says so.
 */
export function MemoryPanel({ id, heading, onSelect, onBack, onGone, actions }: { id: string; heading: Ref<HTMLHeadingElement>; onSelect: (id: string) => void; onBack: () => void; onGone: () => void; actions: PanelActions }) {
  const { t, dateTime } = useI18n();
  const qc = useQueryClient();
  const links = useMemoryLinks(id);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (links.isPending) return <Loading rows={4} />;
  const memory = links.data?.memories.find((m) => m.id === id);
  if (links.isError || !memory) {
    return (
      <div className="space-y-3">
        <Back onBack={onGone} />
        <ErrorNotice error={links.error} onRetry={() => void links.refetch()} />
      </div>
    );
  }
  const past = memory.status === "historical";

  async function post(path: string, body: unknown) {
    setPending(true);
    setError(null);
    try {
      await api(`/memories/${id}/${path}`, { method: "POST", body });
      await qc.invalidateQueries({ queryKey: MEMORIES_KEY });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }
  const setStatus = (status: Memory["status"]) => void post("status", { status });

  const kindOf = new Map<string, MemoryLinkKind>();
  for (const link of links.data.links) {
    if (link.from === id) kindOf.set(link.to, link.kind);
    else if (link.to === id) kindOf.set(link.from, link.kind);
  }
  const hubs = links.data.hubs.filter((hub) => kindOf.has(hub.id));
  // What the memory is about (its folder, the contact it names) and where else its words show up.
  const about = (hub: MemoryHub) => hub.kind === "folder" || hub.kind === "contact";
  const folders = hubs.filter(about);
  const mentions = hubs.filter((hub) => !about(hub));
  const near = links.data.memories.filter((m) => m.id !== id && kindOf.has(m.id));

  return (
    <div className="space-y-4">
      <Back onBack={onBack} />
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          <i className="zuri-cat" data-cat={memory.category} aria-hidden />
          {t(CATEGORY_LABEL[memory.category])} · {t(STATUS_LABEL[memory.status])}
        </p>
        <h2 ref={heading} tabIndex={-1} className="whitespace-pre-wrap break-words text-lg font-semibold leading-7 focus:outline-none">
          {memory.content}
        </h2>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
          {memory.author === "agent" ? <span title={t("web.memory.author.agentHint")}>{t("web.memory.author.agent")}</span> : <span>{t("web.memory.author.owner")}</span>}
          {memory.origin !== "app" && <span>{t(ORIGIN_LABEL[memory.origin])}</span>}
          {memory.validFrom && <span>{t("web.memory.since", { date: memory.validFrom })}</span>}
          <span>{t("web.memory.savedAt", { time: dateTime(memory.updatedAt) })}</span>
        </p>
        {memory.localOnly && (
          <p className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-text" title={t("web.memory.localOnlyHint")}>
            <ShieldCheck className="h-3 w-3" aria-hidden />
            {t("web.memory.localOnlyBadge")}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Button variant="secondary" onClick={() => actions.onEdit(memory)} disabled={pending}>
          <Pencil className="h-4 w-4" aria-hidden />
          {t("web.memory.edit")}
        </Button>
        <ActionsMenu
          name={memory.content}
          busy={pending}
          actions={[
            ...(past ? [] : [{ label: t("web.memory.correct"), icon: <RefreshCw className="h-4 w-4" />, onSelect: () => actions.onCorrect(memory), disabled: pending }]),
            // Step 21 (plan D3): a marked memory never goes to a paid model.
            { label: t("web.memory.localOnly"), icon: <ShieldCheck className="h-4 w-4" />, onSelect: () => void post("local-only", { localOnly: !memory.localOnly }), checked: memory.localOnly, disabled: pending },
            { label: t("web.memory.history"), icon: <History className="h-4 w-4" />, onSelect: () => actions.onHistory(memory), disabled: pending },
            ...(past
              ? [{ label: t("web.memory.restore"), icon: <ArchiveRestore className="h-4 w-4" />, onSelect: () => setStatus("active"), disabled: pending }]
              : [
                  memory.status === "active"
                    ? { label: t("web.memory.markUncertain"), icon: <CircleHelp className="h-4 w-4" />, onSelect: () => setStatus("uncertain"), disabled: pending }
                    : { label: t("web.memory.confirmCurrent"), icon: <BadgeCheck className="h-4 w-4" />, onSelect: () => setStatus("active"), disabled: pending },
                  { label: t("web.memory.markPast"), icon: <Archive className="h-4 w-4" />, onSelect: () => setStatus("historical"), disabled: pending },
                ]),
            { label: t("web.memory.delete"), icon: <Trash2 className="h-4 w-4" />, onSelect: () => actions.onDelete(memory), danger: true, disabled: pending },
          ]}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {folders.length > 0 && (
        <Section title={t("web.memory.links.to")}>
          <ul>
            {folders.map((hub) => (
              <li key={hub.id}>
                <HubLink hub={hub} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {mentions.length > 0 && (
        <Section title={t("web.memory.links.in")}>
          <ul>
            {mentions.map((hub) => (
              <li key={hub.id}>
                <HubLink hub={hub} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {near.length > 0 && (
        <Section title={t("web.memory.links.near")}>
          <ul>
            {near.map((other) => (
              <li key={other.id}>
                <button type="button" className={pick} onClick={() => onSelect(other.id)}>
                  <span className="flex items-start gap-2">
                    <i className="zuri-cat mt-1.5" data-cat={other.category} aria-hidden />
                    <span className="min-w-0 break-words">
                      {other.content}
                      {kindOf.get(other.id) !== "near" && <span className="block text-xs text-fg-muted no-underline">{t(kindOf.get(other.id) === "version" ? "web.memory.near.version" : "web.memory.near.review")}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <p className="text-xs leading-5 text-fg-muted">{hubs.length + near.length === 0 ? t("web.memory.links.none") : t("web.memory.links.how")}</p>
    </div>
  );
}

function HubLink({ hub }: { hub: MemoryHub }) {
  const { t } = useI18n();
  const Icon = hub.kind === "folder" || hub.kind === "contact" ? HUB_ICON[hub.kind] : CornerDownRight;
  return (
    <Link to={hubPath(hub)} className="flex min-h-11 items-center gap-2 rounded-lg px-2 py-1.5 text-sm leading-5 transition-colors hover:bg-raised">
      <Icon className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0 break-words">{t("web.memory.hub.named", { kind: t(HUB_LABEL[hub.kind]), name: hub.label })}</span>
    </Link>
  );
}

/** A folder, conversation, task or note picked on the map: what it is and the memories that talk about it. */
export function HubPanel({ hub, memories, heading, onSelect, onBack }: { hub: MemoryHub; memories: Memory[]; heading: Ref<HTMLHeadingElement>; onSelect: (id: string) => void; onBack: () => void }) {
  const { t } = useI18n();
  const Icon = HUB_ICON[hub.kind];
  return (
    <div className="space-y-4">
      <Back onBack={onBack} />
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
          <Icon className="h-4 w-4" aria-hidden />
          {t(HUB_LABEL[hub.kind])}
        </p>
        <h2 ref={heading} tabIndex={-1} className="break-words text-lg font-semibold leading-7 focus:outline-none">
          {hub.label}
        </h2>
      </div>
      <Link to={hubPath(hub)} className="inline-flex min-h-11 items-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-semibold hover:bg-raised">
        {t("web.memory.hub.open")}
      </Link>
      <Section title={t("web.memory.hub.memories")}>
        <ul>
          {memories.map((memory) => (
            <li key={memory.id}>
              <button type="button" className={pick} onClick={() => onSelect(memory.id)}>
                <span className="flex items-start gap-2">
                  <i className="zuri-cat mt-1.5" data-cat={memory.category} aria-hidden />
                  <span className="min-w-0 break-words">{memory.content}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
