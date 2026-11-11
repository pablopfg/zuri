import { useQueryClient } from "@tanstack/react-query";
import { NOTE_CONTENT_MAX, NOTE_TITLE_MAX, type Note, type TrashItem } from "@zuri/shared";
import { ArrowLeft, Check, FileDown, History, LoaderCircle, NotebookPen, PencilLine, Plus, Search, Trash2 } from "lucide-react";
import { type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useBlocker, useLocation, useNavigate, useParams } from "react-router";
import { ActionsMenu } from "../../components/ActionsMenu.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, buttonClass, cn, Dialog, EmptyState, ErrorNotice, fieldClass, Loading, Notice, useDocumentTitle } from "../../components/ui.tsx";
import { VoiceButton, VoiceStatus } from "../../components/voice/VoiceInput.tsx";
import { useVoice } from "../../components/voice/voice.ts";
import { NOTES_KEY, PROJECTS_KEY, useNote, useNotes, useProjects } from "../../hooks/productivity.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { type AutosaveState, Autosaver } from "../../lib/autosave.ts";
import { plainExcerpt } from "../../lib/excerpt.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { EDITOR_DONE, shouldAskBeforeLeaving } from "../../lib/leave-guard.ts";
import { FlashStatus, flashClass, useDebounced, useFlash } from "../../lib/lists.tsx";
import { appendDictation, localDayOffset as dayOffset, markdownFile, noteClock, noteWhen } from "./notes.ts";
import { FolderIcon as Folder, ProjectOptions, TrashedNotice } from "./shared.tsx";

/** Saves whatever is pending in the open editor; true when nothing is left unsaved. */
type Guard = RefObject<(() => Promise<boolean>) | null>;

/**
 * Notes at /notas, one note at /notas/:id (or /notas/nova). On a wide screen
 * the list stays at the side of the editor; on a narrow one the list and the
 * editor take turns. A note saves itself (Sinal, PR S07): leaving saves what
 * is pending first and only asks when that save was refused.
 */
export function NotesPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const [dirty, setDirty] = useState(false);
  const guard: Guard = useRef(null);
  // "Sair sem salvar" was chosen: the editor that closes next throws its pending text away instead of trying once more.
  const dropped = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => shouldAskBeforeLeaving(dirty, currentLocation, nextLocation));
  // The way out is held only while the pending text is saved; the question shows when that save was refused.
  const [stuck, setStuck] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per blocked way out; the blocker is a new object on every render.
  useEffect(() => {
    if (blocker.state !== "blocked") {
      setStuck(false);
      dropped.current = false;
      return;
    }
    let current = true;
    void (guard.current?.() ?? Promise.resolve(true)).then((saved) => {
      if (!current) return;
      if (saved) blocker.proceed();
      else setStuck(true);
    });
    return () => {
      current = false;
    };
  }, [blocker.state]);
  // A note created by its editor moves to its own address and keeps the same editor: the cursor stays where it was.
  // The address changes a moment after the note is born (a navigation is a transition), so the slot of the new
  // note is kept until the address arrives; only then does "Nova nota" mean another editor.
  const [born, setBorn] = useState({ count: 0, id: "", slot: "", arrived: true });
  const slot = id === "nova" ? (born.arrived ? `new-${born.count}` : born.slot) : born.id === id ? born.slot : id;
  const onBorn = useCallback((noteId: string) => setBorn((last) => ({ count: last.count + 1, id: noteId, slot: `new-${last.count}`, arrived: false })), []);
  useEffect(() => {
    if (id !== "nova") setBorn((last) => (last.arrived ? last : { ...last, arrived: true }));
  }, [id]);
  const heading = id === "nova" ? t("web.notes.new") : t("web.notes.edit");

  return (
    <div className="lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className={cn("space-y-3", id && "hidden lg:block")}>
        <NotesList activeId={id} />
      </div>
      <div className={cn("space-y-3", !id && "hidden lg:block")}>
        {id ? (
          <>
            <Link
              to="/notas"
              className="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-fg-muted hover:bg-raised hover:text-fg lg:hidden"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {t("web.notes.back")}
            </Link>
            {/* Alone on a narrow screen the editor is the page; beside the list, the list's heading is. */}
            <h1 className="sr-only lg:hidden">{heading}</h1>
            <h2 className="sr-only hidden lg:block">{heading}</h2>
            <NoteSlot key={slot} id={id === "nova" ? undefined : id} onDirty={setDirty} onBorn={onBorn} guard={guard} dropped={dropped} />
          </>
        ) : (
          <EmptyState icon={<NotebookPen className="h-6 w-6" />} title={t("web.notes.selectTitle")}>
            <p>{t("web.notes.selectBody")}</p>
          </EmptyState>
        )}
      </div>
      <Dialog open={blocker.state === "blocked" && stuck} onClose={() => blocker.reset?.()} title={t("web.notes.discardTitle")}>
        <p className="text-sm leading-6 text-fg-muted">{t("web.notes.discardBody")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => blocker.reset?.()}>
            {t("web.notes.keepEditing")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              dropped.current = true;
              blocker.proceed?.();
            }}
          >
            {t("web.notes.discard")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function NotesList({ activeId }: { activeId: string | undefined }) {
  const { t, locale, timeZone } = useI18n();
  useDocumentTitle(t("web.notes.title"));
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const notes = useNotes(q);
  const projects = useProjects().data?.projects ?? [];
  const flash = useFlash(notes.isPlaceholderData ? undefined : notes.data?.notes, (note) => note.id, (note) => note.updatedAt, q);
  // The editor hands over what it just moved to the trash, so the undo shows here.
  const location = useLocation();
  const navigate = useNavigate();
  const [trashed, setTrashed] = useState<TrashItem | null>(null);
  // Read once, then clear it: a reload must not offer the undo again. An effect,
  // not the initial state, because beside the editor the list is already mounted.
  useEffect(() => {
    if (!location.state) return;
    const item = (location.state as { trashed?: TrashItem }).trashed;
    if (item) setTrashed(item);
    navigate(".", { replace: true, state: null });
  }, [location.state, navigate]);
  // Beside the editor the list stays mounted: opening a note closes the old notice.
  useEffect(() => {
    if (activeId) setTrashed(null);
  }, [activeId]);
  const now = new Date();

  return (
    <>
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">{t("web.notes.title")}</h1>
          {/* The same way to the trash as on Tasks. */}
          <Link to="/configuracoes/dados?tipo=notas" aria-label={t("web.trash.open")} className={buttonClass("ghost", "h-11 w-11 px-0")}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Link>
          <Link to="/notas/nova" aria-label={t("web.notes.new")} className={buttonClass("primary", "h-11 w-11 px-0")}>
            <Plus className="h-5 w-5" aria-hidden />
          </Link>
        </div>
        <p className="text-sm text-fg-muted">{t("web.notes.description")}</p>
      </div>
      {trashed && <TrashedNotice item={trashed} message={t("web.notes.trashed")} onDone={() => setTrashed(null)} />}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <input
          type="search"
          value={query}
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("web.notes.search")}
          aria-label={t("web.notes.search")}
          aria-describedby="notes-search-hint"
          className={cn(fieldClass, "pl-9")}
        />
        <p id="notes-search-hint" className="sr-only">
          {t("web.notes.searchHint")}
        </p>
      </div>
      {notes.isPending ? (
        <Loading />
      ) : notes.isError ? (
        <ErrorNotice error={notes.error} onRetry={() => void notes.refetch()} />
      ) : notes.data.notes.length === 0 ? (
        <EmptyState icon={<NotebookPen className="h-6 w-6" />} title={q ? t("web.notes.emptySearch") : t("web.notes.empty")}>
          {!q && <p>{t("web.notes.emptyBody")}</p>}
        </EmptyState>
      ) : (
        <ul aria-label={t("web.notes.listLabel")} className="space-y-1">
          {notes.data.notes.map((note) => {
            const folder = projects.find((project) => project.id === note.projectId)?.name;
            const excerpt = plainExcerpt(note.excerpt);
            return (
              <li key={note.id}>
                <Link
                  to={`/notas/${note.id}`}
                  aria-current={note.id === activeId ? "page" : undefined}
                  className={cn(
                    "block min-h-11 rounded-2xl border px-3 py-2.5",
                    note.id === activeId ? "border-border bg-surface shadow-sm" : "border-transparent hover:bg-raised/60",
                    flashClass(flash.glowing, note.id),
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{note.title}</span>
                    <time dateTime={note.updatedAt} className="shrink-0 text-xs tabular-nums text-fg-muted">
                      {noteWhen(note.updatedAt, now, locale, timeZone, t("web.notes.yesterday"))}
                    </time>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-sm leading-5 text-fg-muted">{excerpt || t("web.notes.emptyExcerpt")}</span>
                  {folder && (
                    <span className="mt-1 flex items-center gap-1 text-xs text-fg-muted">
                      <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{folder}</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <FlashStatus count={flash.remote} />
    </>
  );
}

interface EditorProps {
  onDirty: (dirty: boolean) => void;
  onBorn: (id: string) => void;
  guard: Guard;
  dropped: { current: boolean };
}

/** The editor of one address. A new note starts at once; a saved one waits for its text. */
function NoteSlot({ id, ...rest }: EditorProps & { id: string | undefined }) {
  // A slot that began as a new note keeps its editor when the note gets an address.
  const [fresh] = useState(id === undefined);
  const note = useNote(id);
  // Once open, the editor stays even if a later refresh fails (the note gone elsewhere): the text typed is never dropped.
  if (fresh || note.data) return <NoteEditor note={note.data?.note} {...rest} />;
  if (note.isError) return <ErrorNotice error={note.error} onRetry={() => void note.refetch()} />;
  return <Loading />;
}

interface Draft {
  title: string;
  content: string;
  projectId: string;
}
const draftOf = (note?: Note): Draft => ({ title: note?.title ?? "", content: note?.content ?? "", projectId: note?.projectId ?? "" });
const sameDraft = (a: Draft, b: Draft) => a.title === b.title && a.content === b.content && a.projectId === b.projectId;

function NoteEditor({ note, onDirty, onBorn, guard, dropped }: EditorProps & { note: Note | undefined }) {
  const { t, locale, timeZone, dateTime } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const projects = useProjects();
  const ids = useId();
  const [draft, setDraft] = useState(() => draftOf(note));
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [state, setState] = useState<AutosaveState>({ phase: "saved" });
  // The version this editor started from (or last saved). A newer one from elsewhere never replaces what is typed.
  const [base, setBase] = useState(note?.updatedAt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dictated, setDictated] = useState(0);
  const body = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(draft);
  const sent = useRef(draft);
  const noteId = useRef(note?.id ?? null);
  const version = useRef(base);
  const inFlight = useRef(false);
  const leaving = useRef(false);
  const untitled = t("web.notes.untitled");

  // One save: the first creates the note, the next ones send only what changed. Kept in a ref so the saver always calls the newest.
  // The editor closed: a save or a dictation that ends later moves nothing on the screen the owner went to.
  const gone = useRef(false);
  const save = useRef(async (_next: Draft) => {});
  save.current = async (next) => {
    // A note needs a title on the server; an empty field is saved under a plain one and stays empty here.
    const title = next.title.trim() || untitled;
    const creating = noteId.current === null;
    inFlight.current = true;
    try {
      let saved: Note;
      if (creating) {
        saved = (await api<{ note: Note }>("/notes", { method: "POST", body: { title, content: next.content, projectId: next.projectId || null } })).note;
        noteId.current = saved.id;
      } else {
        const was = sent.current;
        const changed = {
          ...(next.title !== was.title ? { title } : {}),
          ...(next.content !== was.content ? { content: next.content } : {}),
          ...(next.projectId !== was.projectId ? { projectId: next.projectId || null } : {}),
        };
        // The server refuses the save when the note changed since the version this editor has.
        saved = (await api<{ note: Note }>(`/notes/${noteId.current}`, { method: "PATCH", body: { ...changed, ifUpdatedAt: version.current } })).note;
      }
      sent.current = next;
      version.current = saved.updatedAt;
      setBase(saved.updatedAt);
      qc.setQueryData([...NOTES_KEY, "one", saved.id], { note: saved });
      void qc.invalidateQueries({ queryKey: [...NOTES_KEY, "list"] });
      if (creating) {
        onBorn(saved.id);
        // The address follows the note, unless the owner is already on the way out.
        if (!leaving.current && !gone.current) navigate(`/notas/${saved.id}`, { replace: true, state: EDITOR_DONE });
      }
    } catch (failure) {
      inFlight.current = false;
      // Changed elsewhere: the new version is fetched, and the owner chooses which one stays (the notice below).
      if (failure instanceof ApiError && failure.code === "CONFLICT" && noteId.current) await qc.refetchQueries({ queryKey: [...NOTES_KEY, "one", noteId.current] });
      throw failure;
    } finally {
      inFlight.current = false;
    }
  };
  const [saver] = useState(() => new Autosaver<Draft>(draft, { equal: sameDraft, save: (next) => save.current(next), onState: setState }));
  const dirty = saver.dirty;

  const change = useCallback(
    (patch: Partial<Draft>) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setDraft(next);
      saver.set(next);
    },
    [saver],
  );

  // Later only (ISO times compare as text). The answer of this editor's own save is never "newer": while one is on its way, nothing is.
  const newer = note !== undefined && note.updatedAt > base && !inFlight.current ? note : null;
  const conflict = newer !== null && dirty;

  function adopt(next: Note) {
    const theirs = draftOf(next);
    saver.reset(theirs);
    latest.current = theirs;
    sent.current = theirs;
    setDraft(theirs);
    version.current = next.updatedAt;
    setBase(next.updatedAt);
    setState({ phase: "saved" });
  }

  // Untouched, the editor simply shows the new version; with changes, it asks (below) and saves nothing until the owner chooses.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a newer version from elsewhere matters here.
  useEffect(() => {
    if (newer && !dirty) adopt(newer);
  }, [newer?.updatedAt]);
  useEffect(() => {
    saver.hold(conflict);
  }, [conflict, saver]);

  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  // The page asks this before letting the owner out.
  useEffect(() => {
    guard.current = async () => {
      leaving.current = true;
      const saved = await saver.flush();
      if (!saved) leaving.current = false;
      return saved;
    };
    return () => {
      guard.current = null;
    };
  }, [guard, saver]);

  // Whatever is pending is sent when the tab goes to the background and when the editor closes (a way out that never asks, like the session's end).
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") void saver.flush();
    };
    document.addEventListener("visibilitychange", hidden);
    gone.current = false;
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      gone.current = true;
      // Thrown away on purpose ("Sair sem salvar"): no last try. Otherwise one.
      if (dropped.current) saver.dispose();
      else void saver.flush();
    };
  }, [saver, dropped]);

  // Closing the tab with text that has not been saved yet asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // What was said goes to the end of the text, which scrolls there so the owner reads it.
  const voice = useVoice(
    useCallback(
      (said: string) => {
        // A transcription that ends after the owner left this note is dropped: nobody would see where it went.
        if (gone.current) return;
        change({ content: appendDictation(latest.current.content, said) });
        setTab("write");
        setDictated((count) => count + 1);
      },
      [change],
    ),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: after each dictation, once the text is drawn.
  useEffect(() => {
    if (dictated > 0 && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [dictated]);

  async function remove() {
    const id = noteId.current;
    if (id === null) return;
    setDeleting(true);
    setError(null);
    // The trash keeps the note as it is on the screen; after that nothing more is saved.
    if (!(await saver.flush())) {
      // The save was refused (the line above says why): the note stays, so the trash never keeps an older text.
      setDeleting(false);
      return;
    }
    saver.hold(true);
    try {
      const { trashItem } = await api<{ trashItem: TrashItem }>(`/notes/${id}`, { method: "DELETE" });
      saver.dispose();
      qc.removeQueries({ queryKey: [...NOTES_KEY, "one", id] });
      await Promise.all([qc.invalidateQueries({ queryKey: [...NOTES_KEY, "list"] }), qc.invalidateQueries({ queryKey: PROJECTS_KEY })]);
      navigate("/notas", { state: { ...EDITOR_DONE, trashed: trashItem } });
    } catch (err) {
      saver.hold(conflict);
      setError(errorMessage(err));
      setDeleting(false);
    }
  }

  function download() {
    const file = markdownFile(draft.title.trim() || untitled, draft.content);
    const url = URL.createObjectURL(new Blob([file.text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const exists = noteId.current !== null;
  const savedAt = base && (dayOffset(base, new Date(), timeZone) === 0 ? t("web.notes.status.savedAt", { time: noteClock(base, locale, timeZone) }) : t("web.notes.status.savedOn", { time: dateTime(base) }));
  const statusClass = "inline-flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-sm text-fg-muted";

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        // The habit of saving by hand still works: it saves now.
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void saver.flush();
        }
      }}
      className="space-y-3"
    >
      {conflict && newer && (
        <Notice tone="warning">
          <p>{t("web.notes.changedElsewhere")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => adopt(newer)}>
              {t("web.notes.seeNewer")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                // The owner's text stays: it is saved now, over the version they chose not to take.
                // The next save is compared with what the server has now, so every field of this version goes, not only the one typed here (SEC-S07-01).
                sent.current = draftOf(newer);
                version.current = newer.updatedAt;
                setBase(newer.updatedAt);
                saver.hold(false);
                void saver.flush();
              }}
            >
              {t("web.notes.keepMine")}
            </Button>
          </div>
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {conflict ? (
          <p className={statusClass}>
            {/* The same icon the screens that share the menu chunk use: a different one here would split that chunk (rule P11). */}
            <History className="h-4 w-4 shrink-0" aria-hidden />
            {t("web.notes.status.waiting")}
          </p>
        ) : state.phase === "failed" ? (
          <p role="alert" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 text-sm font-medium text-danger">
            <span>{t("web.notes.status.failed", { reason: errorMessage(state.error) })}</span>
            <Button variant="secondary" onClick={() => void saver.flush()}>
              {t("web.retry")}
            </Button>
          </p>
        ) : dirty || state.phase === "saving" ? (
          <p className={statusClass}>
            <LoaderCircle className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />
            {t("web.notes.status.saving")}
          </p>
        ) : exists ? (
          <p className={statusClass}>
            <Check className="h-4 w-4 shrink-0" aria-hidden />
            {savedAt}
          </p>
        ) : (
          <p className={statusClass}>
            <PencilLine className="h-4 w-4 shrink-0" aria-hidden />
            {t("web.notes.status.draft")}
          </p>
        )}
        <span className="relative inline-flex items-center">
          <Folder className="pointer-events-none absolute left-3 h-4 w-4 text-fg-muted" aria-hidden />
          <select
            value={draft.projectId}
            onChange={(event) => change({ projectId: event.target.value })}
            aria-label={t("web.tasks.field.project")}
            className={cn(fieldClass, "w-auto max-w-[14rem] truncate pl-9 text-sm")}
          >
            <ProjectOptions projects={projects.data?.projects ?? []} none={t("web.tasks.noProject")} />
          </select>
        </span>
        <div role="tablist" aria-label={t("web.notes.modeLabel")} className="flex gap-1 rounded-xl bg-raised p-1">
          {(["write", "preview"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              id={`${ids}-tab-${item}`}
              aria-selected={tab === item}
              aria-controls={`${ids}-panel`}
              onClick={() => setTab(item)}
              className={cn("min-h-11 rounded-lg px-3 text-sm font-medium transition-colors", tab === item ? "bg-surface text-fg shadow-sm ring-1 ring-border-strong" : "text-fg-muted hover:text-fg")}
            >
              {item === "write" ? t("web.notes.write") : t("web.notes.preview")}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {note && exists && <LocalOnly note={note} />}
        <span className="ml-auto flex items-center gap-1">
          <VoiceButton voice={voice} label={t("web.notes.dictate")} className="rounded-xl" />
          {exists && (
            <ActionsMenu
              name={draft.title.trim() || untitled}
              busy={deleting}
              actions={[
                { label: t("web.notes.download"), icon: <FileDown className="h-4 w-4" aria-hidden />, onSelect: download },
                { label: t("web.trash.moveTo"), icon: <Trash2 className="h-4 w-4" aria-hidden />, onSelect: () => void remove(), danger: true, disabled: deleting },
              ]}
            />
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <label htmlFor={`${ids}-title`} className="sr-only">
        {t("web.notes.field.title")}
      </label>
      <input
        id={`${ids}-title`}
        value={draft.title}
        maxLength={NOTE_TITLE_MAX}
        autoComplete="off"
        placeholder={t("web.notes.field.title")}
        onChange={(event) => change({ title: event.target.value })}
        className="min-h-11 w-full rounded-lg bg-transparent text-2xl font-semibold sm:text-3xl tracking-tight text-fg placeholder:text-fg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      />
      <VoiceStatus voice={voice} />
      {dictated > 0 && voice.state.phase === "idle" && !voice.error && (
        <output className="flex items-start gap-1.5 text-sm text-fg-muted">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("web.notes.dictated")}
        </output>
      )}
      <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`}>
        {tab === "write" ? (
          <>
            <label htmlFor={`${ids}-content`} className="sr-only">
              {t("web.notes.field.content")}
            </label>
            <textarea
              ref={body}
              id={`${ids}-content`}
              value={draft.content}
              maxLength={NOTE_CONTENT_MAX}
              placeholder={t("web.notes.contentPlaceholder")}
              onChange={(event) => change({ content: event.target.value })}
              aria-describedby={`${ids}-hint`}
              className="field-sizing-content block max-h-[70vh] min-h-[45vh] w-full resize-y rounded-lg bg-transparent text-base leading-7 text-fg placeholder:text-fg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
            <p id={`${ids}-hint`} className="mt-2 text-xs text-fg-muted">
              {t("web.notes.markdownHint")}
            </p>
          </>
        ) : draft.content.trim() ? (
          <Markdown content={draft.content} />
        ) : (
          <p className="text-sm text-fg-muted">{t("web.notes.previewEmpty")}</p>
        )}
      </div>
    </form>
  );
}

/** Step 21 (plan D3): "never send out" for one note, saved at once; the text being edited stays as it is. */
function LocalOnly({ note }: { note: Note }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const hint = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(localOnly: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ note: Note }>(`/notes/${note.id}/local-only`, { method: "POST", body: { localOnly } });
      qc.setQueryData([...NOTES_KEY, "one", note.id], result);
      void qc.invalidateQueries({ queryKey: [...NOTES_KEY, "list"] });
      toast(t(localOnly ? "web.notes.localOnlyOn" : "web.notes.localOnlyOff"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 flex-1">
      {/* The switch first and its name after it, as in the editor's bar of the prototype. */}
      <div className="[&>label]:flex-row-reverse [&>label]:justify-end [&>label]:gap-1">
        <Switch label={t("web.notes.localOnly")} checked={note.localOnly} busy={busy} describedBy={hint} onChange={(on) => void change(on)} />
      </div>
      <p id={hint} className="text-xs text-fg-muted">
        {t("web.notes.localOnlyHint")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
