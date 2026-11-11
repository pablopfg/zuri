import { type InfiniteData, type UseInfiniteQueryResult, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CHAT_MESSAGE_MAX,
  type ChatEvent,
  type ChatMessage,
  CONVERSATION_TITLE_MAX,
  type Conversation,
  type ConversationPage,
  type PendingAction,
  ptBRChat,
  type TaskPlan,
  type ToolActivity,
  type ToolName,
} from "@zuri/shared";
import { ArrowLeft, ArrowUp, Check, CircleAlert, Clock, History, LifeBuoy, LoaderCircle, MessagesSquare, Pencil, Search, Sparkles, Square, SquarePen, Trash2, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router";
import { ActionsMenu, type MenuAction } from "../../components/ActionsMenu.tsx";
import { Logo } from "../../components/Logo.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, cn, Dialog, EmptyState, ErrorNotice, Loading, Notice, TextField, useDocumentTitle } from "../../components/ui.tsx";
import { api, ApiError, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { dayOffset, groupRecents } from "../../lib/recents.ts";
import { ApprovalCard, PlanCard } from "./cards.tsx";
import { TOOL_LABEL, TOOL_STATUS_LABEL } from "./labels.ts";
import { streamChat } from "./stream.ts";
import { VoiceButton, VoiceStatus } from "../../components/voice/VoiceInput.tsx";
import { useVoice } from "../../components/voice/voice.ts";
import { clock, messageDay, rowWhen, shortDate } from "./when.ts";

// This screen's pt-BR texts travel with its code, not in the first bundle (rule P11).
addMessages(ptBRChat);

const LIST_KEY = ["conversations"] as const;
const pageKey = (id: string) => ["conversations", "one", id] as const;

/** From this share of the limit on, the composer shows how many characters are left. */
const COUNTER_FROM = 0.8;

/** The turn being written in this tab: shown until the stored answer replaces it. */
interface LiveTurn {
  conversationId: string | null;
  user: string;
  /** The owner's message as stored, and the id the answer will have: known once the turn starts. */
  userMessageId: string | null;
  assistantId: string | null;
  text: string;
  tools: ToolActivity[];
  actions: PendingAction[];
  plans: TaskPlan[];
  error: string | null;
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((current) => current.id === item.id) ? items.map((current) => (current.id === item.id ? item : current)) : [...items, item];
}

type ConversationList = InfiniteData<{ conversations: Conversation[]; nextCursor: string | null }>;
/** What the owner asked to do with a conversation, from its row or from the top of the open one. */
type Change = { mode: "rename" | "delete"; conversation: Conversation };

const ICON_BUTTON = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg-muted hover:bg-raised hover:text-fg";

/**
 * The chat at /conversa (a new conversation) and /conversa/:id (Sinal). On a
 * wide screen the conversations stay in a column beside the open one; on a
 * narrow one they take its place while the owner picks. Only the messages
 * scroll: the title and the field to write never leave the screen. Answers
 * stream in as they are written; anything that deletes or rewrites comes as a
 * card the owner approves, and a plan creates nothing until confirmed.
 */
export function ChatPage() {
  const { id } = useParams();
  const { t, locale, timeZone } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [change, setChange] = useState<Change | null>(null);
  // The menu button a rename or a delete came from: the focus returns to it when the dialog leaves.
  const changeFrom = useRef<HTMLElement | null>(null);
  const openChange = (next: Change) => {
    changeFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setChange(next);
  };
  const closeChange = () => {
    flushSync(() => setChange(null));
    if (changeFrom.current?.isConnected) changeFrom.current.focus();
  };
  const controller = useRef<AbortController | null>(null);
  const listButton = useRef<HTMLButtonElement>(null);
  const listTitle = useRef<HTMLHeadingElement>(null);
  const page = useQuery({
    queryKey: pageKey(id ?? ""),
    // Encoded: an address like /conversa/..%2Fusage must stay one id, never another API path.
    queryFn: ({ signal }) => api<ConversationPage>(`/conversations/${encodeURIComponent(id ?? "")}`, { signal }),
    enabled: Boolean(id),
  });
  const list = useInfiniteQuery({
    queryKey: LIST_KEY,
    queryFn: ({ pageParam, signal }) => api<{ conversations: Conversation[]; nextCursor: string | null }>(`/conversations${pageParam ? `?before=${pageParam}` : ""}`, { signal }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const conversation = page.data?.conversation;
  const streamingHere = live !== null && live.conversationId === (id ?? null);
  const busy = live !== null;

  const patchPage = useCallback(
    (conversationId: string, change: (page: ConversationPage) => ConversationPage) => {
      qc.setQueryData<ConversationPage>(pageKey(conversationId), (current) => (current ? change(current) : current));
    },
    [qc],
  );

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setSendError(null);
    const abort = new AbortController();
    controller.current = abort;
    let turn: LiveTurn = { conversationId: id ?? null, user: message, userMessageId: null, assistantId: null, text: "", tools: [], actions: [], plans: [], error: null };
    const update = (next: LiveTurn) => {
      turn = next;
      setLive(next);
    };
    update(turn);
    setDraft("");
    let userMessage: ChatMessage | null = null;
    const onEvent = (event: ChatEvent) => {
      switch (event.type) {
        case "start":
          userMessage = event.userMessage;
          update({ ...turn, conversationId: event.conversation.id, userMessageId: event.userMessage.id, assistantId: event.assistantMessageId });
          if (!id) navigate(`/conversa/${event.conversation.id}`, { replace: true });
          void qc.invalidateQueries({ queryKey: LIST_KEY, exact: false, refetchType: "active" });
          break;
        case "text":
          update({ ...turn, text: turn.text + event.delta });
          break;
        case "tool":
          update({ ...turn, tools: upsert(turn.tools, event.tool) });
          // A tool that wrote sends the areas' numbers: the screens refresh what it changed, right now.
          if (event.versions) {
            const { versions } = event;
            void import("../../lib/versions.ts").then((m) => m.seen(qc, versions));
          }
          break;
        case "approval":
          update({ ...turn, actions: upsert(turn.actions, event.action) });
          break;
        case "plan":
          update({ ...turn, plans: upsert(turn.plans, event.plan) });
          break;
        case "error":
          update({ ...turn, error: event.message });
          break;
        case "done": {
          const stored = [userMessage, event.message].filter((m): m is ChatMessage => m !== null);
          const ids = new Set(stored.map((m) => m.id));
          // The stored turn replaces the live one at once, then the server's copy confirms it.
          patchPage(event.message.conversationId, (current) => ({
            ...current,
            messages: [...current.messages.filter((m) => !ids.has(m.id)), ...stored],
            actions: turn.actions.reduce(upsert, current.actions),
            plans: turn.plans.reduce(upsert, current.plans),
          }));
          break;
        }
      }
    };
    try {
      await streamChat(id ? { message, conversationId: id } : { message }, onEvent, abort.signal);
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) {
        // Refused before the turn began (busy, too long, signed out): the text goes back to the composer.
        if (!turn.assistantId) setDraft(message);
        setSendError(failure instanceof ApiError && failure.code === "NETWORK" ? t("web.error.network") : errorMessage(failure));
      }
    } finally {
      controller.current = null;
      const conversationId = turn.conversationId;
      if (conversationId) {
        await qc.invalidateQueries({ queryKey: pageKey(conversationId) });
        void qc.invalidateQueries({ queryKey: LIST_KEY });
      }
      setLive(null);
    }
  }

  // A question typed on the home page or in the search arrives with the address: sent once, then
  // the address forgets it, so a reload or going back never sends it again.
  const location = useLocation();
  // Per arrival (the address's key): the screen stays mounted from one conversation to the next.
  const asked = useRef<string | null>(null);
  const ask = (location.state as { ask?: unknown } | null)?.ask;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per question, with the send of this render
  useEffect(() => {
    if (asked.current === location.key || id || typeof ask !== "string" || !ask.trim()) return;
    asked.current = location.key;
    // Too long for one message: it waits in the composer, where the counter says why. Nothing is
    // sent, so the address may keep it (a reload just puts it back in the composer).
    if ([...ask].length > CHAT_MESSAGE_MAX) {
      setDraft(ask);
      return;
    }
    navigate(location.pathname, { replace: true, state: null });
    void send(ask);
  }, [ask, id, location.key]);

  async function stop() {
    const conversationId = live?.conversationId;
    if (!conversationId) {
      controller.current?.abort();
      return;
    }
    // The server stops the model and still sends the stored, partial answer.
    await api("/chat/cancel", { method: "POST", body: { conversationId } }).catch(() => controller.current?.abort());
  }

  // A move that came from outside the list (the palette asking a question, say) brings the conversation back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the address is the trigger
  useEffect(() => setListOpen(false), [location.key]);

  // The phone's list takes the conversation's place: the focus goes with it, and comes back.
  const showList = () => {
    flushSync(() => setListOpen(true));
    listTitle.current?.focus();
  };
  const hideList = (focus = true) => {
    flushSync(() => setListOpen(false));
    if (focus) listButton.current?.focus();
  };

  const title = id ? (conversation?.title ?? t("web.chat.title")) : t("web.chat.title");
  useDocumentTitle(title);
  const now = new Date();
  const items = list.data?.pages.flatMap((p) => p.conversations) ?? [];
  // Last used on a day before today, in the owner's zone: the notice under its messages says so.
  const previous = conversation && !streamingHere && dayOffset(conversation.updatedAt, now, timeZone) < 0;
  // The list comes newest first: its head is today's conversation, when there is one.
  const todays = previous ? items.find((item) => item.id !== id && dayOffset(item.updatedAt, now, timeZone) >= 0) : undefined;
  // "Desde hoje, 08:12": when the open conversation began.
  const began = conversation ? { days: -dayOffset(conversation.createdAt, now, timeZone), time: clock(conversation.createdAt, locale, timeZone) } : null;
  const since = !began || !conversation
    ? ""
    : began.days <= 0
      ? t("web.chat.since.today", { time: began.time })
      : began.days === 1
        ? t("web.chat.since.yesterday", { time: began.time })
        : t("web.chat.since.date", { date: shortDate(conversation.createdAt, now, locale, timeZone), time: began.time });
  const menu = (item: Conversation): MenuAction[] => [
    { label: t("web.chat.rename"), icon: <Pencil className="h-4 w-4" />, onSelect: () => openChange({ mode: "rename", conversation: item }), disabled: live?.conversationId === item.id },
    { label: t("web.chat.delete"), icon: <Trash2 className="h-4 w-4" />, onSelect: () => openChange({ mode: "delete", conversation: item }), danger: true, disabled: live?.conversationId === item.id },
  ];

  return (
    <div className="zuri-chat flex min-h-0 flex-1">
      <aside
        aria-label={t("web.chat.list")}
        onKeyDown={(event) => {
          // Only where the list replaced the conversation (a phone), and never under an open menu or dialog.
          if (event.key === "Escape" && listOpen && !event.defaultPrevented) hideList();
        }}
        className={cn("min-h-0 w-full flex-col lg:flex lg:w-72 lg:shrink-0 lg:border-r lg:border-border", listOpen ? "flex" : "hidden")}
      >
        <ConversationRows
          list={list}
          items={items}
          activeId={id}
          now={now}
          menu={menu}
          titleRef={listTitle}
          onBack={() => hideList()}
          onPick={() => hideList(false)}
        />
      </aside>
      <div className={cn("min-w-0 flex-1 flex-col lg:flex", listOpen ? "hidden" : "flex")}>
        <div className="flex min-h-16 flex-none items-center gap-1 border-b border-border px-2 lg:px-6">
          <Link to="/" aria-label={t("web.chat.home")} title={t("web.chat.home")} className={cn(ICON_BUTTON, "lg:hidden")}>
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <div className="min-w-0 flex-1 py-2">
            <h1 className="truncate text-base font-semibold leading-6">{title}</h1>
            <p className="truncate text-xs leading-5 text-fg-muted">{id ? since : t("web.chat.description")}</p>
          </div>
          <button ref={listButton} type="button" onClick={showList} aria-label={t("web.chat.listOpen")} title={t("web.chat.listOpen")} className={cn(ICON_BUTTON, "lg:hidden")}>
            <MessagesSquare className="h-5 w-5" aria-hidden />
          </button>
          {/* Without the name: the title is right beside it, and the row's menu in the list already carries the name. */}
          {id && conversation && <ActionsMenu actions={menu(conversation)} />}
        </div>

        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling area must take the keyboard's focus to scroll with the arrows. */}
        <section aria-label={t("web.chat.messages")} tabIndex={0} data-chat-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-5 lg:px-6">
            {id && page.isPending ? (
              <Loading label={t("web.chat.loading")} />
            ) : id && page.isError ? (
              <ErrorNotice error={page.error} onRetry={() => void page.refetch()} />
            ) : (
              <Thread
                key={id ?? "new"}
                page={id ? page.data : undefined}
                live={streamingHere ? live : null}
                onAction={(action) => {
                  if (streamingHere) setLive((current) => (current ? { ...current, actions: upsert(current.actions, action) } : current));
                  patchPage(action.conversationId, (current) => ({ ...current, actions: upsert(current.actions, action) }));
                }}
                onPlan={(plan) => {
                  if (streamingHere) setLive((current) => (current ? { ...current, plans: upsert(current.plans, plan) } : current));
                  patchPage(plan.conversationId, (current) => ({ ...current, plans: upsert(current.plans, plan) }));
                }}
                onSuggestion={(text) => void send(text)}
              />
            )}
            {previous && (
              <p role="note" className="flex items-start gap-2 rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm leading-6 text-fg-muted">
                <History className="mt-1 h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">
                  {t("web.chat.previous")}
                  {todays && (
                    <>
                      {" "}
                      <Link to={`/conversa/${todays.id}`} className="font-semibold text-fg underline underline-offset-2 hover:text-accent-text">
                        {t("web.chat.previousToday", { title: todays.title })}
                      </Link>
                    </>
                  )}
                </span>
              </p>
            )}
            {page.data?.streaming && !streamingHere && <Notice>{t("web.chat.streamingElsewhere")}</Notice>}
          </div>
        </section>

        <div className="mx-auto w-full max-w-3xl flex-none space-y-2 px-4 pb-3 lg:px-6">
          {sendError && (
            <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm">
              <p className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                {sendError}
              </p>
              <Button variant="ghost" className="h-11 w-11 px-0" aria-label={t("web.close")} onClick={() => setSendError(null)}>
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void send(draft)}
            onStop={() => void stop()}
            streaming={streamingHere}
            blocked={busy && !streamingHere}
            disabled={Boolean(id) && !page.data}
          />
        </div>
      </div>
      {change && (
        <ConversationChange
          key={`${change.mode}:${change.conversation.id}`}
          change={change}
          onClose={closeChange}
          onDeleted={(deleted) => {
            if (deleted === id) navigate("/conversa", { replace: true });
            // The row and its menu are gone: the focus waits on the list's search (or, with the list away, on its button).
            const search = document.getElementById(SEARCH_ID);
            (search?.offsetParent ? search : listButton.current)?.focus();
          }}
        />
      )}
    </div>
  );

}

const SEARCH_ID = "buscar-conversas";

/** The conversations, newest first, a page at a time, by day (in the owner's zone) and with a search of their titles. */
function ConversationRows({
  list,
  items,
  activeId,
  now,
  menu,
  titleRef,
  onBack,
  onPick,
}: {
  list: UseInfiniteQueryResult<ConversationList>;
  items: Conversation[];
  activeId: string | undefined;
  now: Date;
  menu: (conversation: Conversation) => MenuAction[];
  titleRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onPick: () => void;
}) {
  const { t, locale, timeZone } = useI18n();
  const [query, setQuery] = useState("");
  const groups = groupRecents(items, query, now, timeZone);
  const labels = { today: t("web.chat.group.today"), yesterday: t("web.chat.group.yesterday"), week: t("web.chat.group.week"), older: t("web.chat.group.older") } as const;
  return (
    <nav aria-label={t("web.chat.list")} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-16 flex-none items-center gap-1 border-b border-border pl-2 pr-3 lg:pl-4">
        <button type="button" onClick={onBack} aria-label={t("web.chat.back")} title={t("web.chat.back")} className={cn(ICON_BUTTON, "lg:hidden")}>
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <h2 ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 truncate text-base font-semibold focus:outline-none">
          {t("web.chat.list")}
        </h2>
        <Link
          to="/conversa"
          onClick={onPick}
          aria-label={t("web.chat.new")}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-strong bg-surface px-3.5 text-sm font-semibold text-fg shadow-sm hover:bg-raised"
        >
          <SquarePen className="h-4 w-4" aria-hidden />
          {t("web.chat.newShort")}
        </Link>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 text-fg-muted focus-within:border-accent">
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="sr-only">{t("web.chat.search")}</span>
          <input
            id={SEARCH_ID}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("web.chat.searchShort")}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-[15px] text-fg placeholder:text-fg-muted focus:outline-none"
          />
        </label>
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <p className="px-2 py-2 text-sm text-fg-muted">{t("web.chat.listEmpty")}</p>
        ) : groups.length === 0 ? (
          <p role="status" className="px-2 py-2 text-sm text-fg-muted">
            {list.hasNextPage ? t("web.chat.searchMore") : t("web.chat.searchEmpty")}
          </p>
        ) : (
          groups.map(({ group, items: inGroup }) => (
            <section key={group} aria-labelledby={`recentes-${group}`}>
              <h3 id={`recentes-${group}`} className="px-2 pb-1 pt-2 text-xs font-semibold text-fg-muted">
                {labels[group]}
              </h3>
              <ul className="space-y-0.5">
                {inGroup.map((item) => (
                  <li key={item.id} className="flex items-center gap-0.5">
                    <NavLink
                      to={`/conversa/${item.id}`}
                      onClick={onPick}
                      aria-current={item.id === activeId ? "page" : undefined}
                      className={cn(
                        "block min-h-11 min-w-0 flex-1 rounded-xl border px-2.5 py-1.5",
                        item.id === activeId ? "border-border bg-surface shadow-sm" : "border-transparent hover:bg-raised",
                      )}
                    >
                      <span className={cn("block truncate text-sm leading-5 text-fg", item.id === activeId ? "font-semibold" : "font-medium")}>{item.title}</span>
                      <time dateTime={item.updatedAt} className="block text-xs leading-5 text-fg-muted">
                        {rowWhen(item.updatedAt, now, locale, timeZone)}
                      </time>
                    </NavLink>
                    <ActionsMenu name={item.title} actions={menu(item)} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {list.hasNextPage && (
          <Button variant="ghost" className="w-full" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {t("web.chat.loadMore")}
          </Button>
        )}
      </div>
    </nav>
  );
}

/** Rename or delete one conversation: the dialog a "Mais opções" menu opens (line C1 of the Sinal plan). */
function ConversationChange({ change, onClose, onDeleted }: { change: Change; onClose: () => void; onDeleted: (id: string) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { mode, conversation } = change;
  const [name, setName] = useState(conversation.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    try {
      const result = await api<{ conversation: Conversation }>(`/conversations/${conversation.id}`, { method: "PATCH", body: { title: name } });
      // A read that left before the rename (the one a turn starts, say) would land later
      // with the old title and undo it on screen: drop those before writing the new one.
      await qc.cancelQueries({ queryKey: LIST_KEY });
      qc.setQueryData<ConversationPage>(pageKey(conversation.id), (current) => (current ? { ...current, conversation: result.conversation } : current));
      qc.setQueryData<ConversationList>(LIST_KEY, (current) =>
        current
          ? { ...current, pages: current.pages.map((p) => ({ ...p, conversations: p.conversations.map((c) => (c.id === conversation.id ? result.conversation : c)) })) }
          : current,
      );
      // Read again what was dropped (a list that missed a new conversation, say); these reads leave after the rename.
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      onClose();
      toast(t("web.chat.renamed"));
    } catch (failure) {
      if (gone(failure)) return left();
      setError(errorMessage(failure));
      setPending(false);
    }
  }

  /** Deleted already, in another tab or by the bot: the server says it does not exist. */
  const gone = (failure: unknown) => failure instanceof ApiError && failure.code === "NOT_FOUND";

  /** The conversation is no more, deleted here or elsewhere: its row leaves at once and the page moves on. */
  async function left() {
    qc.removeQueries({ queryKey: pageKey(conversation.id) });
    // Out of the list at once: the row must not wait for the next read to leave.
    await qc.cancelQueries({ queryKey: LIST_KEY });
    qc.setQueryData<ConversationList>(LIST_KEY, (current) =>
      current ? { ...current, pages: current.pages.map((p) => ({ ...p, conversations: p.conversations.filter((c) => c.id !== conversation.id) })) } : current,
    );
    void qc.invalidateQueries({ queryKey: LIST_KEY });
    // The dialog closes first; the row and its menu are gone, so the page says where the focus goes next.
    onClose();
    onDeleted(conversation.id);
    toast(t("web.chat.deleted"));
  }

  async function remove() {
    setPending(true);
    try {
      await api(`/conversations/${conversation.id}`, { method: "DELETE" });
      await left();
    } catch (failure) {
      if (gone(failure)) return left();
      setError(errorMessage(failure));
      setPending(false);
    }
  }

  if (mode === "rename")
    return (
      <Dialog open onClose={onClose} title={t("web.chat.rename")}>
        <form onSubmit={(e) => void rename(e)} className="space-y-4">
          <TextField label={t("web.chat.renameLabel")} value={name} maxLength={CONVERSATION_TITLE_MAX} required error={error} onChange={(e) => setName(e.target.value)} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("web.chat.cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              {t("web.chat.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    );
  return (
    <Dialog open onClose={onClose} title={t("web.chat.deleteTitle")}>
      <p className="break-words text-sm font-medium">{t("web.chat.deleteName", { title: conversation.title })}</p>
      <p className="text-sm leading-6 text-fg-muted">{t("web.chat.deleteBody")}</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("web.chat.cancel")}
        </Button>
        <Button variant="danger" loading={pending} onClick={() => void remove()}>
          {t("web.chat.delete")}
        </Button>
      </div>
    </Dialog>
  );
}

const SUGGESTIONS = ["web.chat.suggestion.today", "web.chat.suggestion.task", "web.chat.suggestion.plan", "web.chat.suggestion.remember"] as const;

function Thread({
  page,
  live,
  onAction,
  onPlan,
  onSuggestion,
}: {
  page: ConversationPage | undefined;
  live: LiveTurn | null;
  onAction: (action: PendingAction) => void;
  onPlan: (plan: TaskPlan) => void;
  onSuggestion: (text: string) => void;
}) {
  const { t, locale, timeZone } = useI18n();
  const [older, setOlder] = useState<{ messages: ChatMessage[]; hasMore: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<unknown>(null);
  const end = useRef<HTMLDivElement>(null);
  /** How far from the end the owner was when older messages were asked for: they come in above, and the place stays. */
  const fromEnd = useRef<number | null>(null);
  const messages = [...(older?.messages ?? []), ...(page?.messages ?? [])];
  const hasMore = older ? older.hasMore : (page?.hasMore ?? false);
  const actions = new Map([...(page?.actions ?? []), ...(live?.actions ?? [])].map((a) => [a.id, a]));
  const plans = new Map([...(page?.plans ?? []), ...(live?.plans ?? [])].map((p) => [p.id, p]));
  const shown = live ? messages.filter((m) => m.id !== live.assistantId && m.id !== live.userMessageId) : messages;

  // Follow the answer as it grows, unless the owner scrolled up to read.
  const growth = `${shown.length}:${live?.text.length ?? 0}:${live?.tools.length ?? 0}:${live?.user ?? ""}`;
  useEffect(() => {
    if (!growth) return;
    const node = end.current;
    if (!node) return;
    // Only the messages scroll: the title above and the field to write below stay put.
    const scroller = node.closest("[data-chat-scroll]");
    if (!scroller) return;
    if (fromEnd.current !== null) {
      scroller.scrollTop = scroller.scrollHeight - fromEnd.current;
      fromEnd.current = null;
      return;
    }
    const nearBottom = scroller.clientHeight + scroller.scrollTop >= scroller.scrollHeight - 240;
    if (nearBottom || growth.endsWith(":0:0:")) {
      // From far away it jumps: a slow walk to the end would be overtaken by text that is still taking its shape.
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: !nearBottom || matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, [growth]);

  // The messages grow after they are drawn (the formatting comes in a moment later): at the end, the owner stays at the end.
  const empty = shown.length === 0 && !live;
  useEffect(() => {
    const scroller = empty ? null : end.current?.closest("[data-chat-scroll]");
    const content = end.current?.parentElement;
    if (!scroller || !content) return;
    let pinned = true;
    const onScroll = () => {
      pinned = scroller.clientHeight + scroller.scrollTop >= scroller.scrollHeight - 240;
    };
    const observer = new ResizeObserver(() => {
      if (pinned && fromEnd.current === null) scroller.scrollTop = scroller.scrollHeight;
    });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(content);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [empty]);

  async function loadOlder() {
    const first = messages[0];
    if (!first || !page) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const result = await api<ConversationPage>(`/conversations/${page.conversation.id}?before=${first.id}`);
      const scroller = end.current?.closest("[data-chat-scroll]");
      if (scroller) fromEnd.current = scroller.scrollHeight - scroller.scrollTop;
      setOlder({ messages: [...result.messages, ...(older?.messages ?? [])], hasMore: result.hasMore });
    } catch (failure) {
      setOlderError(failure);
    } finally {
      setLoadingOlder(false);
    }
  }

  if (empty) {
    return (
      <EmptyState icon={<Sparkles className="h-6 w-6" />} title={t("web.chat.empty.title")}>
        <p>{t("web.chat.empty.body")}</p>
        <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label={t("web.chat.suggestions")}>
          {SUGGESTIONS.map((key) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => onSuggestion(t(key))}
                className="min-h-11 rounded-full border border-border bg-surface px-4 text-sm text-fg shadow-sm transition-colors hover:border-accent hover:bg-accent-soft"
              >
                {t(key)}
              </button>
            </li>
          ))}
        </ul>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      {hasMore && (
        <div className="flex flex-col items-center gap-2">
          <Button variant="ghost" loading={loadingOlder} onClick={() => void loadOlder()}>
            {t("web.chat.older")}
          </Button>
          {olderError !== null && <ErrorNotice error={olderError} onRetry={() => void loadOlder()} />}
        </div>
      )}
      <div role="log" aria-relevant="additions">
        <ol className="space-y-5">
          {/* One keyed list with the live turn under the ids its stored messages will carry: when the turn
            ends and they take over, React keeps these items, so a plan the owner is editing keeps its
            edits instead of mounting again (#223). A line with the day comes before the first message
            of each day, in the owner's zone. */}
          {(() => {
            const now = new Date();
            let last: number | null = null;
            const line = (createdAt: string) => {
              const day = messageDay(createdAt, now, locale, timeZone);
              if (day.offset === last) return [];
              last = day.offset;
              return [
                <li key={`day:${day.offset}`} className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-fg-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                  {day.offset === 0 ? t("web.chat.group.today") : day.offset === -1 ? t("web.chat.group.yesterday") : day.date}
                </li>,
              ];
            };
            return [
              ...shown.flatMap((message) => [...line(message.createdAt), <MessageItem key={message.id} message={message} actions={actions} plans={plans} onAction={onAction} onPlan={onPlan} />]),
              ...(live
                ? [
                    ...line(""),
                    <MessageItem key={live.userMessageId ?? "live-user"} message={liveMessage("user", live.user)} actions={actions} plans={plans} onAction={onAction} onPlan={onPlan} />,
                    <MessageItem key={live.assistantId ?? "live-assistant"} message={liveMessage("assistant", live.text)} actions={actions} plans={plans} onAction={onAction} onPlan={onPlan} live={live} />,
                  ]
                : []),
            ];
          })()}
        </ol>
      </div>
      <div ref={end} />
    </div>
  );
}

const liveMessage = (role: ChatMessage["role"], content: string): ChatMessage => ({ id: "", conversationId: "", role, content, tools: [], status: "complete", error: null, source: "app", createdAt: "" });

function MessageItem({
  message,
  actions,
  plans,
  onAction,
  onPlan,
  live,
}: {
  message: ChatMessage;
  actions: Map<string, PendingAction>;
  plans: Map<string, TaskPlan>;
  onAction: (action: PendingAction) => void;
  onPlan: (plan: TaskPlan) => void;
  /** The answer still streaming: the same element tree as the stored answer that replaces it. */
  live?: LiveTurn;
}) {
  const { t, locale, timeZone } = useI18n();
  const time = clock(message.createdAt, locale, timeZone);
  if (message.role === "user") {
    return (
      <li className="flex flex-col items-end gap-1">
        <span className="sr-only">{time ? t("web.chat.youAt", { time }) : `${t("web.chat.you")}:`}</span>
        {message.quoted?.map((item) => (
          // Someone else's text the owner sent along from Telegram: shown apart from their own words.
          <figure key={`${item.kind}:${item.text.slice(0, 64)}`} className="max-w-[85%] rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm text-fg">
            <figcaption className="mb-1 text-xs font-medium text-fg-muted">{t(QUOTED_LABEL[item.kind])}</figcaption>
            <blockquote className="whitespace-pre-wrap break-words">{item.text}</blockquote>
          </figure>
        ))}
        {message.content && (
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-raised px-4 py-2.5 text-[15px] leading-6 text-fg">{message.content}</div>
        )}
        {message.source === "import" && <span className="text-xs text-fg-muted">{t("web.chat.restored")}</span>}
        {message.source === "telegram" && <span className="text-xs text-fg-muted">{t("web.chat.viaTelegram")}</span>}
      </li>
    );
  }
  if (live) {
    return (
      <li aria-busy={!live.error} className="space-y-3">
        <AssistantBody text={live.text} tools={live.tools} actions={actions} plans={plans} onAction={onAction} onPlan={onPlan} streaming />
        {live.error && <ErrorLine text={live.error} />}
      </li>
    );
  }
  return (
    <li className="space-y-3">
      <AssistantBody text={message.content} tools={message.tools} actions={actions} plans={plans} onAction={onAction} onPlan={onPlan} time={time} />
      {message.fallback && (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <LifeBuoy className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("web.chat.fallback")}
        </p>
      )}
      {message.status === "cancelled" && <p className="text-xs font-medium text-fg-muted">{t("web.chat.stopped")}</p>}
      {message.status === "error" && message.error && <ErrorLine text={message.error.message} />}
      {message.status === "complete" && !message.content.trim() && message.tools.length === 0 && <p className="text-sm text-fg-muted">{t("web.chat.noText")}</p>}
    </li>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-sm">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      {text}
    </p>
  );
}

function AssistantBody({
  text,
  tools,
  actions,
  plans,
  onAction,
  onPlan,
  streaming = false,
  time = "",
}: {
  text: string;
  tools: ToolActivity[];
  actions: Map<string, PendingAction>;
  plans: Map<string, TaskPlan>;
  onAction: (action: PendingAction) => void;
  onPlan: (plan: TaskPlan) => void;
  streaming?: boolean;
  /** The hour the answer was stored; an answer still being written has none. */
  time?: string;
}) {
  const { t } = useI18n();
  const cards = tools.filter((tool) => tool.actionId || tool.planId || tool.automationId);
  return (
    <div className="flex items-start gap-3">
      <Logo className="hidden sm:block" />
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="flex min-h-8 items-center gap-2 text-sm">
          <Logo className="h-6 w-6 sm:hidden" />
          <span className="font-semibold">{t("app.name")}</span>
          <span className="sr-only">:</span>
          {time && <span className="text-xs text-fg-muted">{time}</span>}
        </p>
        {tools.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("web.chat.toolsLabel")}>
            {tools.map((tool) => (
              <ToolChip key={tool.id} tool={tool} />
            ))}
          </ul>
        )}
        {text ? (
          <div className="text-[15px]">
            <Markdown content={text} showDestination />
          </div>
        ) : (
          streaming &&
          tools.every((tool) => tool.status !== "running") && (
            <p className="inline-flex items-center gap-2.5 rounded-2xl border border-border bg-surface py-2 pl-2 pr-4 text-sm text-fg-muted shadow-sm">
              <Logo className="h-7 w-7" working />
              {t("web.chat.thinking")}
            </p>
          )
        )}
        {cards.map((tool) => {
          const action = tool.actionId ? actions.get(tool.actionId) : undefined;
          const plan = tool.planId ? plans.get(tool.planId) : undefined;
          return (
            <div key={`card-${tool.id}`}>
              {action && <ApprovalCard action={action} onChange={onAction} />}
              {plan && <PlanCard plan={plan} onChange={onPlan} />}
              {tool.automationId && (
                <Link
                  // The anchor of lib/automations.ts, written out so the chat needs nothing from that screen.
                  to={`/rotinas#automacao-${tool.automationId}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-accent-text hover:bg-raised"
                >
                  <Clock className="h-4 w-4" aria-hidden />
                  {t("web.chat.automationLink")}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolChip({ tool }: { tool: ToolActivity }) {
  const { t } = useI18n();
  const Icon = tool.status === "running" ? LoaderCircle : tool.status === "success" ? Check : X;
  return (
    <li
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        tool.status === "error" ? "border-danger/40 bg-danger-soft" : "border-border bg-raised text-fg",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tool.status === "running" && "motion-safe:animate-spin", tool.status === "success" && "text-success", tool.status === "error" && "text-danger")} aria-hidden />
      <span className="font-medium">{tool.name.startsWith("mcp_") ? (tool.label ?? t("web.chat.tool.external")) : t(TOOL_LABEL[tool.name as ToolName])}</span>
      {tool.detail && <span className="truncate text-fg-muted">· {tool.detail}</span>}
      <span className="sr-only">({t(TOOL_STATUS_LABEL[tool.status])})</span>
    </li>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  blocked,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  blocked: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const counterId = useId();
  const insert = useCallback(
    (text: string) => {
      const next = value.trim() ? `${value.trimEnd()} ${text}` : text;
      onChange(next.slice(0, CHAT_MESSAGE_MAX));
      ref.current?.focus();
    },
    [value, onChange],
  );
  const voice = useVoice(insert);
  const length = [...value].length;
  const over = length > CHAT_MESSAGE_MAX;
  const empty = !value.trim();
  const showCounter = length >= CHAT_MESSAGE_MAX * COUNTER_FROM;

  // The box grows with the text, up to a third of the screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height is measured again whenever the text changes.
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, Math.round(window.innerHeight / 3))}px`;
  }, [value]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!streaming && !blocked && !empty && !over) onSend();
    }
  }

  const recording = voice.state.phase === "recording";

  return (
    <>
      <form
        aria-label={t("web.chat.composer")}
        onSubmit={(event) => {
          event.preventDefault();
          if (!empty && !over && !streaming && !blocked) onSend();
        }}
        className="space-y-1 rounded-3xl border border-border-strong bg-surface p-1.5 shadow-md focus-within:border-accent"
      >
        <VoiceStatus voice={voice} />
        <div className="flex items-end gap-1.5">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("web.chat.messageLabel")}</span>
            <textarea
              ref={ref}
              rows={1}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("web.chat.placeholder")}
              aria-describedby={`${hintId}${showCounter ? ` ${counterId}` : ""}`}
              aria-invalid={over || undefined}
              disabled={disabled}
              className="block max-h-[33dvh] min-h-11 w-full resize-none bg-transparent px-3.5 py-2.5 text-[15px] leading-6 text-fg placeholder:text-fg-muted focus:outline-none"
            />
          </label>
          <VoiceButton voice={voice} disabled={disabled || streaming} />
          {streaming ? (
            <Button variant="secondary" className="h-11 shrink-0 rounded-2xl" onClick={onStop}>
              <Square className="h-4 w-4 fill-current" aria-hidden />
              {t("web.chat.stop")}
            </Button>
          ) : (
            <Button type="submit" className="h-11 w-11 shrink-0 rounded-2xl px-0" aria-label={t("web.chat.send")} disabled={disabled || blocked || empty || over || recording}>
              <ArrowUp className="h-5 w-5" aria-hidden />
            </Button>
          )}
        </div>
      </form>
      <div className="flex min-h-5 items-center justify-center gap-3 px-3 text-xs text-fg-muted">
        <span id={hintId} className="hidden sm:inline">
          {t("web.chat.hint")}
        </span>
        {showCounter && (
          <span id={counterId} className={cn("tabular-nums", over && "font-semibold text-danger")}>
            {t("web.chat.counter", { used: length, max: CHAT_MESSAGE_MAX })}
          </span>
        )}
      </div>
    </>
  );
}

// One literal key per value, so the i18n lint sees each one.
const QUOTED_LABEL = {
  forward: "web.chat.quoted.forward",
  quote: "web.chat.quoted.quote",
  reply: "web.chat.quoted.reply",
  voice: "web.chat.quoted.voice",
} as const;
