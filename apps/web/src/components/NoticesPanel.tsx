import { type InfiniteData, useMutation, useQueryClient } from "@tanstack/react-query";
import { NOTICE_SEEN_MAX, type Notice, type NoticePage, ptBRAlerts } from "@zuri/shared";
import { BellOff, Check, ChevronRight, Trash2 } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import { NOTICES_KEY, setUnseen, useNotices } from "../hooks/notices.ts";
import { api, errorMessage } from "../lib/api.ts";
import { addMessages, useI18n } from "../lib/i18n.tsx";
import { useToast } from "./Toaster.tsx";
import { Button, cn, EmptyState, ErrorNotice, Loading } from "./ui.tsx";

// The panel's pt-BR texts arrive with it (rule P11).
addMessages(ptBRAlerts);

/**
 * The notice center: every notice the Zuri raised, newest first. Titles and
 * bodies come written by the server in the owner's language and are shown as
 * plain text; a link only ever points inside the app (the server keeps a list).
 */
export function NoticesPanel({ onClose, navigate }: { onClose: () => void; navigate: (to: string) => void }) {
  const { t, plural } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const query = useNotices();
  const notices = query.data?.pages.flatMap((page) => page.notices) ?? [];
  const unread = query.data?.pages[0]?.unread;
  const unseen = query.data?.pages[0]?.unseen;

  // What the list says is the freshest number: the bell follows it.
  useEffect(() => {
    if (unseen !== undefined) setUnseen(qc, unseen);
  }, [qc, unseen]);
  const list = useRef<HTMLUListElement>(null);
  useSeen(list, notices);

  const refresh = () => qc.invalidateQueries({ queryKey: NOTICES_KEY });
  const failed = (error: unknown) => toast(errorMessage(error));

  const read = useMutation({
    mutationFn: (id?: string) => api<{ unseen: number }>("/notices/read", { method: "POST", body: id ? { id } : {} }),
    onSuccess: ({ unseen }) => {
      setUnseen(qc, unseen);
      void refresh();
    },
    onError: failed,
  });
  const mute = useMutation({
    mutationFn: (id: string) => api<Notice>(`/notices/${id}/mute`, { method: "POST" }),
    onSuccess: () => {
      toast(t("web.notices.muted"));
      void refresh();
    },
    onError: failed,
  });
  // A security alert the bot caused stops only here; the password typed recently is asked once if needed (step 16).
  const acknowledge = useMutation({
    mutationFn: (id: string) => api<Notice>(`/notices/${id}/acknowledge`, { method: "POST" }),
    onSuccess: () => {
      toast(t("web.notices.acknowledged"));
      void refresh();
    },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/notices/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast(t("web.notices.removed"));
      void refresh();
    },
    onError: failed,
  });

  const go = (notice: Notice) => {
    if (!notice.link) return;
    if (!notice.readAt) read.mutate(notice.id);
    onClose();
    navigate(notice.link);
  };

  if (query.isPending) {
    return (
      <div className="p-4">
        <Loading label={t("web.notices.loading")} />
      </div>
    );
  }

  return (
    <div>
      {query.isError && (
        <div className="p-4">
          <ErrorNotice error={query.error} onRetry={() => void query.refetch()} />
        </div>
      )}
      {!query.isError && notices.length === 0 && (
        <div className="p-4">
          <EmptyState icon={<BellOff className="h-6 w-6" />} title={t("web.notices.emptyTitle")}>
            {t("web.notices.emptyBody")}
          </EmptyState>
        </div>
      )}
      {notices.length > 0 && (
        <>
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-1">
            <p className={cn("text-sm", unread ? "inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-text" : "text-fg-muted")} aria-live="polite">
              {Boolean(unread) && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
              {unread ? plural("web.notices.unread", unread) : t("web.notices.allRead")}
            </p>
            {Boolean(unread) && (
              <Button variant="ghost" loading={read.isPending && read.variables === undefined} onClick={() => read.mutate(undefined)}>
                <Check className="h-4 w-4" aria-hidden />
                {t("web.notices.readAll")}
              </Button>
            )}
          </div>
          {/* The panel around it scrolls: the list has no window of its own. */}
          <ul ref={list} aria-label={t("web.notices.listLabel")} className="divide-y divide-border border-t border-border">
            {notices.map((notice) => (
              <NoticeItem
                key={notice.id}
                notice={notice}
                onOpen={() => go(notice)}
                onRead={() => read.mutate(notice.id)}
                onMute={() => mute.mutate(notice.id)}
                onAcknowledge={() => acknowledge.mutate(notice.id)}
                onRemove={() => remove.mutate(notice.id)}
                busy={[read, mute, acknowledge, remove].some((m) => m.isPending && m.variables === notice.id)}
              />
            ))}
          </ul>
          {query.hasNextPage && (
            <div className="border-t border-border p-3">
              <Button variant="secondary" className="w-full" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {t("web.notices.more")}
              </Button>
            </div>
          )}
        </>
      )}
      <div className="flex border-t border-border px-2 py-1">
        <Button
          variant="ghost"
          onClick={() => {
            onClose();
            navigate("/configuracoes/avisos");
          }}
        >
          {t("web.notices.settings")}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function NoticeItem({
  notice,
  onOpen,
  onRead,
  onMute,
  onAcknowledge,
  onRemove,
  busy,
}: {
  notice: Notice;
  onOpen: () => void;
  onRead: () => void;
  onMute: () => void;
  onAcknowledge: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const { t, dateTime } = useI18n();
  const unread = notice.readAt === null;
  const urgent = notice.priority === "critical" || notice.priority === "high";
  // The bot's own security alerts wait for the owner here (step 16, "Reconhecimento cruzado").
  const waiting = notice.ackInApp && (notice.escalation === "active" || notice.escalation === "unacknowledged");
  return (
    <li
      data-notice={notice.seen ? undefined : notice.id}
      aria-busy={busy || undefined}
      className={cn("px-4 py-3", unread && "bg-raised", notice.security && unread && "shadow-[inset_3px_0_0_var(--color-danger)]")}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
        {unread && (
          <span className="inline-flex items-center gap-1 font-semibold text-accent-text">
            <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
            {t("web.notices.new")}
          </span>
        )}
        <span>{t(CATEGORY[notice.category])}</span>
        {urgent && (
          <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", notice.priority === "critical" ? "bg-danger-soft text-danger" : "bg-warning-soft text-fg")}>
            {t(notice.priority === "critical" ? "web.notices.priority.critical" : "web.notices.priority.high")}
          </span>
        )}
        <time dateTime={notice.createdAt}>{dateTime(new Date(notice.createdAt))}</time>
      </div>
      <p className={cn("mt-1 break-words", unread ? "font-semibold" : "font-medium")}>{notice.title}</p>
      {notice.body && <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-fg-muted">{notice.body}</p>}
      {notice.escalation === "active" && (
        <p className="mt-1 text-xs text-fg-muted">{t(notice.ackInApp ? "web.notices.ackInApp" : notice.security ? "web.notices.securityInsists" : "web.notices.insisting")}</p>
      )}
      {notice.escalation === "unacknowledged" && <p className="mt-1 text-xs text-fg-muted">{t("web.notices.unacknowledged")}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {notice.link && (
          <Button variant="secondary" onClick={onOpen} disabled={busy}>
            {t("web.notices.open")}
          </Button>
        )}
        {unread && (
          <Button variant="ghost" onClick={onRead} disabled={busy}>
            {t("web.notices.markRead")}
          </Button>
        )}
        {waiting && (
          <Button variant="secondary" onClick={onAcknowledge} disabled={busy}>
            <Check className="h-4 w-4" aria-hidden />
            {t("web.notices.acknowledge")}
          </Button>
        )}
        {notice.escalation === "active" && !notice.security && (
          <Button variant="ghost" onClick={onMute} disabled={busy}>
            {t("web.notices.mute")}
          </Button>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`${t("web.notices.remove")}: ${notice.title}`}
          className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-xl text-fg-muted hover:bg-raised hover:text-danger disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}

/** How long a notice stays on screen, more than half of it, before it counts as seen (E12b). */
const SEEN_AFTER_MS = 600;

/**
 * The bell counts the notices not seen yet (E12b). One counts as seen once it
 * has been on screen in the open panel for 0.6 s, more than half of it: open
 * and close at once, or a notice below the fold, doesn't count. The ones seen
 * go to the server together, and the list in memory learns it, so a reopened
 * panel doesn't send them again.
 */
function useSeen(list: RefObject<HTMLUListElement | null>, notices: readonly Notice[]) {
  const qc = useQueryClient();
  const sent = useRef(new Set<string>());
  // Watched again only when the unseen ones change, not on every render (a running 0.6 s would start over).
  const waiting = notices.filter((notice) => !notice.seen).map((notice) => notice.id).join();
  useEffect(() => {
    if (!waiting) return;
    const items = list.current?.querySelectorAll<HTMLElement>("li[data-notice]");
    if (!items?.length || typeof IntersectionObserver === "undefined") return;
    const timers = new Map<string, number>();
    const batch: string[] = [];
    let flushing = 0;
    const flush = () => {
      flushing = 0;
      const ids = batch.splice(0, NOTICE_SEEN_MAX);
      if (batch.length) flushing = window.setTimeout(flush);
      if (!ids.length) return;
      void api<{ unseen: number }>("/notices/seen", { method: "POST", body: { ids } })
        .then(({ unseen }) => {
          setUnseen(qc, unseen);
          qc.setQueryData<InfiniteData<NoticePage>>([...NOTICES_KEY, "list"], (data) =>
            data && { ...data, pages: data.pages.map((page) => ({ ...page, unseen, notices: page.notices.map((n) => (ids.includes(n.id) ? { ...n, seen: true } : n)) })) },
          );
        })
        // Not saved: the next opening counts them again.
        .catch(() => {
          for (const id of ids) sent.current.delete(id);
        });
    };
    // On screen now; their 0.6 s only runs while the tab itself is shown (a panel left open in a hidden tab sees nothing).
    const inView = new Set<string>();
    const arm = (id: string) => {
      if (document.hidden || timers.has(id) || sent.current.has(id)) return;
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id);
          sent.current.add(id);
          batch.push(id);
          flushing ||= window.setTimeout(flush, 100);
        }, SEEN_AFTER_MS),
      );
    };
    const stop = (id: string) => {
      window.clearTimeout(timers.get(id));
      timers.delete(id);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.notice ?? "";
          if (entry.isIntersecting) {
            inView.add(id);
            arm(id);
          } else {
            inView.delete(id);
            stop(id);
          }
        }
      },
      { threshold: 0.5 },
    );
    const shown = () => {
      for (const id of inView) document.hidden ? stop(id) : arm(id);
    };
    document.addEventListener("visibilitychange", shown);
    for (const item of items) observer.observe(item);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", shown);
      for (const timer of timers.values()) window.clearTimeout(timer);
      // What was seen but not sent yet still goes (the panel closed in the 0.1 s between).
      window.clearTimeout(flushing);
      flush();
    };
  }, [list, waiting, qc]);
}

/** One literal key per category, so the i18n lint sees each one. */
const CATEGORY = {
  reminders: "web.notices.category.reminders",
  digests: "web.notices.category.digests",
  routines: "web.notices.category.routines",
  tasks: "web.notices.category.tasks",
  system: "web.notices.category.system",
  security: "web.notices.category.security",
  events: "web.notices.category.events",
} as const satisfies Record<Notice["category"], string>;
