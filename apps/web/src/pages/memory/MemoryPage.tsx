import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MEMORY_CATEGORIES,
  MEMORY_CONTENT_MAX,
  MEMORY_GRAPH_MEMORIES_MAX,
  type Memory,
  type MemoryCategory,
  type MemoryGraph,
  type MemoryCounts,
  type MemoryFilter,
  type MemoryReview,
  type MemoryReviewAction,
  type MemoryWriteResult,
  ptBRMemory,
  type Settings,
} from "@zuri/shared";
import { Brain, CircleHelp, GitCompareArrows, List, Maximize, Minus, Plus, Search, ShieldCheck, Type, Waypoints } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button, Card, cn, Dialog, EmptyState, ErrorNotice, fieldClass, Notice, PageHeader, SelectField, Loading, TextAreaField } from "../../components/ui.tsx";
import { MEMORIES_KEY, useMemories, useMemoryHistory, useMemoryReviews } from "../../hooks/memory.ts";
import { SETTINGS_KEY } from "../../hooks/session.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { FlashStatus, flashClass, useDebounced, useFlash } from "../../lib/lists.tsx";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { onMemorySearch } from "../../lib/palette.ts";
import { useToast } from "../../components/Toaster.tsx";
import { CATEGORY_LABEL, FILTER_LABEL, HUB_LABEL, ORIGIN_LABEL, REASON_LABEL, STATUS_LABEL, TOPIC_LABEL } from "./labels.ts";
// The map comes with this screen, which is already loaded on demand. As a piece of its own it made the
// bundler cut a shared piece (the icons, the texts or the JSX runtime) out of the first load (rule P11).
import MemoryMap from "./MemoryMap.tsx";
import { HubPanel, MemoryPanel, useMemoryLinks } from "./MemoryPanel.tsx";

// This screen's pt-BR texts travel with its code, not in the first bundle (rule P11).
addMessages(ptBRMemory);

/** The filters on the page, in order: a count from the server's counters for each. */
const FILTERS = ["all", "active", "uncertain", "historical"] as const satisfies readonly MemoryFilter[];
const COUNT_OF: Record<(typeof FILTERS)[number], keyof MemoryCounts> = { all: "all", active: "active", uncertain: "uncertain", historical: "historical" };

type Editing = { mode: "edit" | "correct"; memory: Memory };
type ViewMode = "list" | "map";

/** The whole map: the newest memories and their links. Asked only with the map open. */
function useMemoryMap(enabled: boolean) {
  return useQuery({
    queryKey: [...MEMORIES_KEY, "graph", "all"],
    queryFn: ({ signal }) => api<MemoryGraph>("/memories/graph", { signal }),
    enabled,
    staleTime: 15_000,
  });
}

const chip = "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors";
const chipClass = (on: boolean) => cn(chip, on ? "border-transparent bg-accent-soft text-accent-text" : "border-border-strong bg-surface text-fg hover:bg-raised");

/** The search a link asked for after "#busca=", as text and no longer than the field takes; empty when there is none. */
function askedInAddress(): string {
  const asked = /^#busca=(.*)$/.exec(window.location.hash)?.[1];
  if (!asked) return "";
  try {
    return decodeURIComponent(asked).slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * Memory: what Zuri knows about the owner and how each thing is linked. Facts
 * that change keep their past versions; possible conflicts wait here for the
 * owner's answer; nothing is overwritten or deleted without them. The list is
 * the main, accessible view; the map shows the same memories as points.
 */
export function MemoryPage() {
  const { t, plural } = useI18n();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [category, setCategory] = useState<MemoryCategory | "">("");
  // A contact's card sends its name in the address ("/memoria#busca=Ana"): the list opens with that search.
  const [query, setQuery] = useState(askedInAddress);
  const [view, setView] = useState<ViewMode>("list");
  /** A memory's id, or a hub's ("note:<id>") picked on the map. */
  const [selected, setSelected] = useState<string | null>(null);
  // The last memory chosen: the map around it stays while one of its folders or notes is looked at.
  const [center, setCenter] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // A memory found in the command palette opens here with that search (revisão de design, D1).
  useEffect(
    () =>
      onMemorySearch((q) => {
        setFilter("all");
        setCategory("");
        setView("list");
        setQuery(q);
      }),
    [],
  );
  const q = useDebounced(query.trim());
  const memories = useMemories({ filter, category, q });
  const counts = memories.data?.counts;
  const flash = useFlash(memories.isPlaceholderData ? undefined : memories.data?.memories, (memory) => memory.id, (memory) => `${memory.updatedAt}|${memory.status}`, `${filter}|${category}|${q}`);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [historyOf, setHistoryOf] = useState<Memory | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);
  const toast = useToast();
  // A write that raised conflicts leaves something to do: that toast stays until closed.
  const notify = (message: string, pending: boolean) => toast(message, { persistent: pending });
  // Saving by hand is the rarer visit (the Zuri saves most memories herself): a button and a dialog, so the list gets the top (stage 26c).
  const [creating, setCreating] = useState(false);

  const whole = useMemoryMap(view === "map");
  const selectedMemory = selected !== null && !selected.includes(":") ? selected : null;
  // More memories than the map draws: with one chosen, the map is that memory and what touches it.
  const around = useMemoryLinks(view === "map" && whole.data?.truncated ? (selectedMemory ?? center) : null);
  const graph = around.data ?? whole.data;
  const hub = selected?.includes(":") ? graph?.hubs.find((h) => h.id === selected) : undefined;
  const filtered = filter !== "all" || category !== "" || q !== "";
  const listed = useMemo(() => new Set(memories.data?.memories.map((m) => m.id)), [memories.data]);

  const opener = useRef<HTMLElement | null>(null);
  const focusPanel = useRef(false);
  /**
   * On a phone the panel takes the list's place: the focus goes to its heading as soon as it is
   * drawn (the links load first), and comes back with "Voltar".
   */
  const heading = useCallback((node: HTMLHeadingElement | null) => {
    if (!node || !focusPanel.current) return;
    focusPanel.current = false;
    node.focus();
  }, []);
  function select(id: string) {
    if (selected === null) opener.current = document.activeElement as HTMLElement | null;
    focusPanel.current = !window.matchMedia("(min-width: 1024px)").matches;
    setSelected(id);
    if (!id.includes(":")) setCenter(id);
  }
  function back() {
    const from = opener.current;
    focusPanel.current = false;
    flushSync(() => {
      setSelected(null);
      setCenter(null);
    });
    opener.current = null;
    if (from?.isConnected) from.focus();
    else document.querySelector<HTMLElement>(".zuri-memory-main button")?.focus();
  }
  const groups = useMemo(() => {
    const by = new Map<MemoryCategory, Memory[]>();
    for (const memory of memories.data?.memories ?? []) (by.get(memory.category) ?? by.set(memory.category, []).get(memory.category))?.push(memory);
    return MEMORY_CATEGORIES.flatMap((item) => (by.has(item) ? [{ category: item, memories: by.get(item) ?? [] }] : []));
  }, [memories.data]);

  return (
    <>
      <PageHeader
        title={t("web.memory.title")}
        description={t("web.memory.description")}
        actions={
          <Button onClick={() => setCreating(true)} aria-haspopup="dialog">
            <Plus className="h-4 w-4" aria-hidden />
            {t("web.memory.new")}
          </Button>
        }
      />

      <Dialog open={creating} onClose={() => setCreating(false)} title={t("web.memory.new")}>
        <NewMemory
          onCancel={() => setCreating(false)}
          onSaved={(message, pending) => {
            setCreating(false);
            notify(message, pending);
          }}
        />
      </Dialog>

      {(counts?.reviews ?? 0) > 0 && (
        <section aria-label={t("web.memory.reviews.title")} className="rounded-2xl border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised text-fg-muted" aria-hidden>
              <CircleHelp className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 basis-56">
              <h2 className="text-sm font-semibold">{plural("web.memory.reviews.strip", counts?.reviews ?? 0)}</h2>
              <p className="text-sm text-fg-muted">{plural("web.memory.reviews.count", counts?.reviews ?? 0)}</p>
            </div>
            <Button variant="secondary" aria-expanded={reviewing} onClick={() => setReviewing((open) => !open)}>
              {t("web.memory.reviews.open")}
            </Button>
          </div>
          {reviewing && (
            <div className="border-t border-border p-4">
              <ReviewQueue total={counts?.reviews ?? 0} onDone={toast} />
            </div>
          )}
        </section>
      )}

      <div className="zuri-memory" data-open={selectedMemory !== null || hub !== undefined || undefined}>
        <section aria-label={t("web.memory.listLabel")} className="zuri-memory-main space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
              <input
                type="search"
                value={query}
                maxLength={200}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("web.memory.search")}
                aria-label={t("web.memory.search")}
                className={cn(fieldClass, "pl-9")}
              />
            </div>
            <fieldset className="grid min-w-0 grid-cols-2 gap-1 rounded-xl bg-raised p-1">
              <legend className="sr-only">{t("web.memory.view")}</legend>
              {(["list", "map"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={view === item}
                  onClick={() => setView(item)}
                  className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors", view === item ? "bg-surface text-fg shadow-sm ring-1 ring-border-strong" : "text-fg-muted hover:text-fg")}
                >
                  {item === "list" ? <List className="h-4 w-4" aria-hidden /> : <Waypoints className="h-4 w-4" aria-hidden />}
                  {t(item === "list" ? "web.memory.view.list" : "web.memory.view.map")}
                </button>
              ))}
            </fieldset>
          </div>

          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="sr-only">{t("web.memory.filterLabel")}</legend>
            {FILTERS.map((item) => (
              <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className={chipClass(filter === item)}>
                {t(FILTER_LABEL[item])} {counts && <span className="tabular-nums">{counts[COUNT_OF[item]]}</span>}
              </button>
            ))}
          </fieldset>
          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="sr-only">{t("web.memory.filterCategory")}</legend>
            <button type="button" aria-pressed={category === ""} onClick={() => setCategory("")} className={chipClass(category === "")}>
              {t("web.memory.allCategories")}
            </button>
            {MEMORY_CATEGORIES.map((item) => (
              <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={chipClass(category === item)}>
                <i className="zuri-cat" data-cat={item} aria-hidden />
                {t(CATEGORY_LABEL[item])}
              </button>
            ))}
          </fieldset>

          {view === "map" ? (
            whole.isPending ? (
              <Loading label={t("web.memory.map.loading")} />
            ) : whole.isError ? (
              <ErrorNotice error={whole.error} onRetry={() => void whole.refetch()} />
            ) : !graph || graph.memories.length === 0 ? (
              <EmptyState icon={<Waypoints className="h-6 w-6" />} title={t("web.memory.empty.title")}>
                {t("web.memory.empty.body")}
              </EmptyState>
            ) : (
              <>
                {whole.data.truncated && <Notice>{t(around.data ? "web.memory.map.around" : "web.memory.map.truncated", { max: MEMORY_GRAPH_MEMORIES_MAX })}</Notice>}
                <MemoryMap
                  graph={graph}
                  selected={selected}
                  dimmed={(id) => filtered && !listed.has(id)}
                  onSelect={select}
                  texts={{
                    label: t("web.memory.map.label"),
                    hint: t("web.memory.map.hint"),
                    zoomIn: t("web.memory.map.zoomIn"),
                    zoomOut: t("web.memory.map.zoomOut"),
                    fit: t("web.memory.map.fit"),
                    names: t("web.memory.map.names"),
                    hubName: (kind, name) => t("web.memory.hub.named", { kind: t(HUB_LABEL[kind]), name }),
                    icons: {
                      zoomIn: <Plus className="h-4 w-4" aria-hidden />,
                      zoomOut: <Minus className="h-4 w-4" aria-hidden />,
                      fit: <Maximize className="h-4 w-4" aria-hidden />,
                      names: <Type className="h-4 w-4" aria-hidden />,
                    },
                  }}
                />
              </>
            )
          ) : memories.isPending ? (
            <Loading />
          ) : memories.isError ? (
            <ErrorNotice error={memories.error} onRetry={() => void memories.refetch()} />
          ) : memories.data.memories.length === 0 ? (
            <EmptyState
              icon={<Brain className="h-6 w-6" />}
              title={q ? t("web.memory.empty.search") : (counts?.all ?? 0) === 0 ? t("web.memory.empty.title") : t("web.memory.empty.filter")}
            >
              {!q && (counts?.all ?? 0) === 0 && t("web.memory.empty.body")}
            </EmptyState>
          ) : (
            groups.map((group) => (
              <section key={group.category} aria-labelledby={`zuri-memory-${group.category}`} className="space-y-1.5">
                <h2 id={`zuri-memory-${group.category}`} className="flex items-center gap-2 px-1 text-sm font-semibold">
                  <i className="zuri-cat" data-cat={group.category} aria-hidden />
                  {t(CATEGORY_LABEL[group.category])}
                  <span className="font-normal tabular-nums text-fg-muted">{group.memories.length}</span>
                </h2>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                  {group.memories.map((memory) => (
                    <MemoryRow key={memory.id} memory={memory} glow={flashClass(flash.glowing, memory.id)} chosen={selected === memory.id} onSelect={() => select(memory.id)} />
                  ))}
                </ul>
              </section>
            ))
          )}
          <FlashStatus count={flash.remote} />
        </section>

        <aside aria-label={t("web.memory.panel.label")} className="zuri-memory-panel">
          {hub && graph ? (
            <HubPanel
              key={hub.id}
              hub={hub}
              memories={graph.memories.filter((m) => graph.links.some((l) => l.to === hub.id && l.from === m.id))}
              heading={heading}
              onSelect={select}
              onBack={back}
            />
          ) : selectedMemory ? (
            <MemoryPanel
              key={selectedMemory}
              id={selectedMemory}
              heading={heading}
              onSelect={select}
              onBack={back}
              onGone={back}
              actions={{ onEdit: (memory) => setEditing({ mode: "edit", memory }), onCorrect: (memory) => setEditing({ mode: "correct", memory }), onHistory: setHistoryOf, onDelete: setDeleting }}
            />
          ) : (
            <p className="text-sm leading-6 text-fg-muted">{t("web.memory.panel.empty")}</p>
          )}
        </aside>
      </div>

      <ConflictReviewSetting />

      {editing && <EditDialog editing={editing} onClose={() => setEditing(null)} onSaved={notify} />}
      {historyOf && <HistoryDialog memory={historyOf} onClose={() => setHistoryOf(null)} />}
      {deleting && (
        <DeleteDialog
          memory={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            back();
            toast(t("web.memory.deleted"));
          }}
        />
      )}
    </>
  );
}

/** The message after a write: saved, already there, and how many conflicts wait for review. */
function useWriteMessage() {
  const { t, plural } = useI18n();
  return (result: MemoryWriteResult, kind: "saved" | "updated" | "corrected") => {
    if (result.duplicate && kind === "saved") return t("web.memory.duplicate");
    const base = t(kind === "saved" ? "web.memory.saved" : kind === "updated" ? "web.memory.updated" : "web.memory.corrected");
    return result.reviews > 0 ? `${base} ${plural("web.memory.reviewsRaised", result.reviews)}` : base;
  };
}

function NewMemory({ onSaved, onCancel }: { onSaved: (message: string, pending: boolean) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const message = useWriteMessage();
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("fact");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;
    setPending(true);
    setError(null);
    try {
      const result = await api<MemoryWriteResult>("/memories", { method: "POST", body: { content, category } });
      setContent("");
      onSaved(message(result, "saved"), result.reviews > 0);
      await qc.invalidateQueries({ queryKey: MEMORIES_KEY });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <p className="text-sm leading-6 text-fg-muted">{t("web.memory.newHint")}</p>
      <TextAreaField
        label={t("web.memory.content")}
        value={content}
        maxLength={MEMORY_CONTENT_MAX}
        required
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("web.memory.placeholder")}
        hint={t("web.memory.counter", { used: content.length, max: MEMORY_CONTENT_MAX })}
        className="[&_textarea]:min-h-20"
      />
      <SelectField label={t("web.memory.category")} value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)}>
        {MEMORY_CATEGORIES.map((item) => (
          <option key={item} value={item}>
            {t(CATEGORY_LABEL[item])}
          </option>
        ))}
      </SelectField>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("web.cancel")}
        </Button>
        <Button type="submit" loading={pending} disabled={!content.trim()}>
          {t("web.memory.save")}
        </Button>
      </div>
    </form>
  );
}

const STATUS_TONE: Record<Memory["status"], string> = {
  active: "bg-success-soft text-fg",
  uncertain: "bg-warning-soft text-fg",
  historical: "bg-raised text-fg-muted",
};

/** A memory on the list: one button that opens it in the panel, where its actions and links are. */
function MemoryRow({ memory, glow, chosen, onSelect }: { memory: Memory; glow: string; chosen: boolean; onSelect: () => void }) {
  const { t, dateTime } = useI18n();
  const past = memory.status === "historical";
  return (
    <li className={glow}>
      <button type="button" aria-pressed={chosen} onClick={onSelect} className={cn("block w-full space-y-1.5 px-4 py-3 text-left transition-colors hover:bg-raised", chosen && "bg-raised")}>
        <span className={cn("block whitespace-pre-wrap break-words text-[15px] leading-6", past && "text-fg-muted")}>{memory.content}</span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-fg-muted">
          {memory.status !== "active" && <span className={cn("rounded-full px-2 py-0.5 font-medium", STATUS_TONE[memory.status])}>{t(STATUS_LABEL[memory.status])}</span>}
          {memory.localOnly && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-text">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              {t("web.memory.localOnlyBadge")}
            </span>
          )}
          <span>{memory.author === "agent" ? t("web.memory.author.agent") : t("web.memory.author.owner")}</span>
          {memory.origin !== "app" && <span>{t(ORIGIN_LABEL[memory.origin])}</span>}
          {memory.validFrom && <span>{t("web.memory.since", { date: memory.validFrom })}</span>}
          <span>{t("web.memory.savedAt", { time: dateTime(memory.updatedAt) })}</span>
        </span>
      </button>
    </li>
  );
}

function ReviewQueue({ total, onDone }: { total: number; onDone: (message: string) => void }) {
    const reviews = useMemoryReviews(total > 0);
  return (
    <>
      {reviews.isPending ? (
        <Loading />
      ) : reviews.isError ? (
        <ErrorNotice error={reviews.error} onRetry={() => void reviews.refetch()} />
      ) : (
        <ul className="space-y-4">
          {reviews.data.reviews.map((review) => (
            <ReviewItem key={review.id} review={review} onDone={onDone} />
          ))}
        </ul>
      )}
    </>
  );
}

const REVIEW_DONE: Record<MemoryReviewAction, "web.memory.reviews.doneKeep" | "web.memory.reviews.doneHistorical" | "web.memory.reviews.doneReplace" | "web.memory.reviews.doneCancel"> = {
  keep_both: "web.memory.reviews.doneKeep",
  mark_historical: "web.memory.reviews.doneHistorical",
  replace: "web.memory.reviews.doneReplace",
  cancel: "web.memory.reviews.doneCancel",
};

function ReviewItem({ review, onDone }: { review: MemoryReview; onDone: (message: string) => void }) {
  const { t, dateTime } = useI18n();
  const qc = useQueryClient();
  const [pending, setPending] = useState<MemoryReviewAction | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();

  async function resolve(action: MemoryReviewAction) {
    setPending(action);
    setError(null);
    try {
      await api(`/memories/reviews/${review.id}`, { method: "POST", body: { action } });
      setConfirm(null);
      onDone(t(REVIEW_DONE[action]));
      await qc.invalidateQueries({ queryKey: MEMORIES_KEY });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  const reason = t(REASON_LABEL[review.reason], { topic: review.topic ? t(TOPIC_LABEL[review.topic]) : "" });
  return (
    <li aria-labelledby={headingId} className="space-y-3 rounded-xl border border-border p-3">
      <p id={headingId} className="flex items-center gap-2 text-sm font-medium">
        <GitCompareArrows className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        {t(review.relationship === "possible_update" ? "web.memory.reviews.possibleUpdate" : "web.memory.reviews.contradiction")}
      </p>
      <p className="text-sm text-fg-muted">{reason}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { label: t("web.memory.reviews.newer"), memory: review.memory },
          { label: t("web.memory.reviews.older"), memory: review.other },
        ].map(({ label, memory }) => (
          <div key={memory.id} className="rounded-lg bg-raised p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{memory.content}</p>
            <p className="mt-1 text-xs text-fg-muted">{t("web.memory.savedAt", { time: dateTime(memory.createdAt) })}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void resolve("keep_both")} loading={pending === "keep_both"} disabled={pending !== null}>
          {t("web.memory.reviews.keepBoth")}
        </Button>
        <Button onClick={() => void resolve("mark_historical")} loading={pending === "mark_historical"} disabled={pending !== null}>
          {t("web.memory.reviews.markHistorical")}
        </Button>
        <Button variant="danger" onClick={() => setConfirm("replace")} disabled={pending !== null}>
          {t("web.memory.reviews.replace")}
        </Button>
        <Button variant="danger" onClick={() => setConfirm("cancel")} disabled={pending !== null}>
          {t("web.memory.reviews.cancel")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t(confirm === "cancel" ? "web.memory.reviews.cancelConfirmTitle" : "web.memory.reviews.replaceConfirmTitle")}
      >
        <p className="text-sm leading-6">{confirm === "cancel" ? review.memory.content : review.other.content}</p>
        <p className="text-sm text-fg-muted">{t("web.memory.deleteForever")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            {t("web.cancel")}
          </Button>
          <Button variant="danger" onClick={() => confirm && void resolve(confirm)} loading={pending !== null}>
            {t("web.memory.deleteConfirm")}
          </Button>
        </div>
      </Dialog>
    </li>
  );
}

function EditDialog({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: (message: string, pending: boolean) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const message = useWriteMessage();
  const { mode, memory } = editing;
  const [content, setContent] = useState(mode === "edit" ? memory.content : "");
  const [category, setCategory] = useState<MemoryCategory>(memory.category);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result =
        mode === "edit"
          ? await api<MemoryWriteResult>(`/memories/${memory.id}`, { method: "PATCH", body: { content, category } })
          : await api<MemoryWriteResult>(`/memories/${memory.id}/correct`, { method: "POST", body: { content, category } });
      onSaved(message(result, mode === "edit" ? "updated" : "corrected"), result.reviews > 0);
      await qc.invalidateQueries({ queryKey: MEMORIES_KEY });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={t(mode === "edit" ? "web.memory.editTitle" : "web.memory.correctTitle")}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        {mode === "correct" && (
          <div className="rounded-lg bg-raised p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{t("web.memory.currentVersion")}</p>
            <p className="mt-1 whitespace-pre-wrap break-words leading-6">{memory.content}</p>
          </div>
        )}
        <p className="text-sm text-fg-muted">{t(mode === "edit" ? "web.memory.editHint" : "web.memory.correctHint")}</p>
        <TextAreaField
          label={t(mode === "edit" ? "web.memory.content" : "web.memory.newVersion")}
          value={content}
          maxLength={MEMORY_CONTENT_MAX}
          required
          autoFocus
          onChange={(e) => setContent(e.target.value)}
          hint={t("web.memory.counter", { used: content.length, max: MEMORY_CONTENT_MAX })}
        />
        <SelectField label={t("web.memory.category")} value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)}>
          {MEMORY_CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {t(CATEGORY_LABEL[item])}
            </option>
          ))}
        </SelectField>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("web.cancel")}
          </Button>
          <Button type="submit" loading={pending} disabled={!content.trim()}>
            {t("web.memory.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function HistoryDialog({ memory, onClose }: { memory: Memory; onClose: () => void }) {
  const { t, dateTime } = useI18n();
  const history = useMemoryHistory(memory.id);
  const entry = (m: Memory, label: string) => (
    <li key={m.id} className="rounded-lg border border-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{m.content}</p>
      <p className="mt-1 text-xs text-fg-muted">
        {t(STATUS_LABEL[m.status])} · {t("web.memory.savedAt", { time: dateTime(m.createdAt) })}
      </p>
    </li>
  );
  return (
    <Dialog open onClose={onClose} title={t("web.memory.historyTitle")}>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorNotice error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {history.data.previous.length === 0 && history.data.next.length === 0 && <p className="text-sm text-fg-muted">{t("web.memory.historyEmpty")}</p>}
          <ol className="space-y-2">
            {[...history.data.next].reverse().map((m) => entry(m, t("web.memory.historyLater")))}
            {entry(history.data.memory, t("web.memory.historyThis"))}
            {[...history.data.previous].reverse().map((m) => entry(m, t("web.memory.historyBefore")))}
          </ol>
        </div>
      )}
    </Dialog>
  );
}

function DeleteDialog({ memory, onClose, onDeleted }: { memory: Memory; onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await api(`/memories/${memory.id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: MEMORIES_KEY });
      onDeleted();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={t("web.memory.deleteTitle")}>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{memory.content}</p>
      <p className="text-sm text-fg-muted">{t("web.memory.deleteForever")}</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("web.cancel")}
        </Button>
        <Button variant="danger" onClick={() => void remove()} loading={pending}>
          {t("web.memory.deleteConfirm")}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * The switch reads the settings the session already holds and saves with a plain
 * request. Through hooks/settings.ts, shared with the settings screen, the
 * bundler would split the first load into extra chunks (rule P11).
 */
function ConflictReviewSetting() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api<Settings>("/settings"), staleTime: 5 * 60_000 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const id = useId();
  const on = settings.data?.memoryConflictReview ?? true;

  async function save(memoryConflictReview: boolean) {
    setSaving(true);
    setError(null);
    try {
      qc.setQueryData(SETTINGS_KEY, await api<Settings>("/settings", { method: "PATCH", body: { memoryConflictReview } }));
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card title={t("web.memory.settings.title")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p id={`${id}-hint`} className="text-sm leading-6 text-fg-muted">
          {t("web.memory.settings.conflictHint")}
        </p>
        <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-3">
          <span className="text-sm font-medium">{t("web.memory.settings.conflict")}</span>
          {/* A real checkbox as a 44 px touch target; the track and knob are drawn from its state. */}
          <span className="relative inline-flex h-11 w-14 items-center justify-center">
            <input
              type="checkbox"
              role="switch"
              checked={on}
              aria-checked={on}
              // Never disabled while saving: a disabled control drops the keyboard focus.
              disabled={settings.isPending}
              aria-busy={saving || undefined}
              aria-describedby={`${id}-hint`}
              onChange={(e) => {
                if (!saving) void save(e.target.checked);
              }}
              className="peer absolute inset-0 h-11 w-14 cursor-pointer appearance-none rounded-full focus-visible:outline-none disabled:cursor-wait"
            />
            <span
              aria-hidden
              className="pointer-events-none h-6 w-11 rounded-full bg-border-strong transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-disabled:opacity-60"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute left-2 h-5 w-5 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-5"
            />
          </span>
        </label>
      </div>
      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(error)}
        </p>
      )}
    </Card>
  );
}
