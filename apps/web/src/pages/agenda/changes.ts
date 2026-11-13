import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { AgendaEvent, AgendaPage as AgendaWindow } from "@zuri/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { dismissToast, useToast } from "../../components/Toaster.tsx";
import { GOOGLE_STATUS_KEY } from "../../lib/agenda.ts";
import { applyChanges, canUndo, type EventChanges, reverseChanges, UNDO_MS } from "../../lib/agenda-edit.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

/** Every window of events the screen has read. */
export const EVENTS_KEY = ["calendar", "events"] as const;

const same = (a: AgendaEvent, b: AgendaEvent) => a.id === b.id && a.calendarId === b.calendarId;

/**
 * What went wrong with the last change, for the sync signal (E5d): no internet, Google refused it,
 * the event changed at Google meanwhile, or Google asked for a pause (429). The next change that
 * goes through clears it.
 */
export interface ChangeProblem {
  kind: "offline" | "failed" | "changed" | "paused";
  /** The event as it was before the change: "Ver o evento" opens it. */
  event: AgendaEvent;
  /** Google's reason, said to the owner. */
  reason: string;
  /** Sends the same change again (no internet, a pause). */
  retry?: () => void;
}

/** One line of "Últimas mudanças": what was said, when, and whether it reached Google. */
export interface ChangeLine {
  at: number;
  text: string;
  ok: boolean;
}

/** How many lines "Últimas mudanças" keeps: the visit's last few. */
export const LOG_MAX = 5;

/** The newest line first, and only the last few. */
export function pushLine(old: readonly ChangeLine[], line: ChangeLine): ChangeLine[] {
  return [line, ...old].slice(0, LOG_MAX);
}

/**
 * A refusal that says the access to Google was lost (409 CONFLICT: revoked, forbidden, not connected):
 * the account's state, read again, puts "Conectar de novo" on the screen. Any request of the Agenda
 * passes its failure here.
 */
export function lostGoogle(qc: QueryClient, failure: unknown): void {
  if (failure instanceof ApiError && failure.code === "CONFLICT") void qc.invalidateQueries({ queryKey: GOOGLE_STATUS_KEY });
}

/**
 * One change of an event, sent to Google as it is made (sons, menu e agenda,
 * delivery 3). The screen shows the event changed at once; Google's answer
 * takes its place, and a refusal or a lost connection puts the event back and
 * says so. A change that went through offers "Desfazer" for a few seconds,
 * which sends the opposite change with the event's new version.
 *
 * One change at a time: while one is on its way the next is not taken, so
 * every request carries the version Google answered last.
 */
export function useEventChanges() {
  const { t, timeZone } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  /** When Google took the last change, for "Salvo no Google". */
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [problem, setProblem] = useState<ChangeProblem | null>(null);
  const [log, setLog] = useState<readonly ChangeLine[]>([]);
  /** A line in "Últimas mudanças"; the form's new events come through here too. */
  const note = useCallback((text: string, ok = true) => setLog((old) => pushLine(old, { at: Date.now(), text, ok })), []);
  /** The toast of a change that did not go (no internet, a pause): closed once the change goes again, by any button. */
  const waiting = useRef<number | null>(null);
  const settle = useCallback(() => {
    if (waiting.current !== null) dismissToast(waiting.current);
    waiting.current = null;
  }, []);
  const busy = useRef(false);
  /** The undo on offer: its toast and what it runs. */
  const offer = useRef<{ toast: number; run: () => void; until: number } | null>(null);
  /** The owner left the Agenda: an answer that comes afterwards offers nothing to do here. */
  const gone = useRef(false);
  const forget = useCallback(() => {
    if (offer.current) dismissToast(offer.current.toast);
    offer.current = null;
  }, []);

  const put = useCallback(
    (event: AgendaEvent) => {
      qc.setQueriesData<AgendaWindow>({ queryKey: EVENTS_KEY }, (old) => old && { ...old, events: old.events.map((each) => (same(each, event) ? event : each)) });
    },
    [qc],
  );

  const send = useCallback(
    async (before: AgendaEvent, changes: EventChanges, message: (saved: AgendaEvent) => string, undoable = true): Promise<void> => {
      if (busy.current) return;
      busy.current = true;
      setSaving(true);
      settle();
      // The undo of the change before this one named a version that is about to be old.
      forget();
      put(applyChanges(before, changes, timeZone));
      try {
        // A reading on its way would bring the event back as it was.
        await qc.cancelQueries({ queryKey: EVENTS_KEY });
        const { event: saved } = await api<{ event: AgendaEvent }>("/google/events", {
          method: "PATCH",
          body: { calendarId: before.calendarId, eventId: before.id, etag: before.etag, ...changes },
        });
        put(saved);
        setSavedAt(Date.now());
        setProblem(null);
        note(message(saved));
        if (!undoable || gone.current || !canUndo(before, changes)) {
          toast(message(saved));
          return;
        }
        const run = () => {
          if (offer.current?.run !== run) return;
          void send(saved, reverseChanges(before, changes, timeZone), () => t("web.agenda.change.undone"), false);
        };
        const id = toast(message(saved), { ms: UNDO_MS, action: { label: t("web.agenda.change.undo"), run } });
        offer.current = { toast: id, run, until: Date.now() + UNDO_MS };
      } catch (failure) {
        put(before);
        const code = failure instanceof ApiError ? failure.code : null;
        const again = () => {
          if (!busy.current) void send(before, changes, message, undoable);
        };
        const reason = errorMessage(failure);
        const title = before.title || t("web.agenda.event.untitled");
        note(t("web.agenda.sync.lineAbout", { title, text: code === "NETWORK" ? t("web.agenda.change.offline") : reason }), false);
        if (code === "NETWORK") setProblem({ kind: "offline", event: before, reason, retry: again });
        else if (code === "TARGET_CHANGED" || code === "NOT_FOUND") setProblem({ kind: "changed", event: before, reason });
        else if (code === "RATE_LIMITED") setProblem({ kind: "paused", event: before, reason, retry: again });
        else setProblem({ kind: "failed", event: before, reason });
        lostGoogle(qc, failure);
        if (code === "NETWORK" || code === "RATE_LIMITED") {
          // Nothing waits in a hidden queue: the owner sends it again, or not. The toast and the signal offer the same.
          const text = code === "NETWORK" ? t("web.agenda.change.offline") : t("web.agenda.change.refused", { reason });
          const later = () => {
            const retry = () => {
              // Another change went out meanwhile: this one keeps waiting on screen, never dropped in silence.
              if (busy.current) later();
              else void send(before, changes, message, undoable);
            };
            waiting.current = toast(text, gone.current ? { failed: true, persistent: true } : { failed: true, persistent: true, action: { label: t("web.retry"), run: retry } });
          };
          later();
        } else if (code === "TARGET_CHANGED" || code === "NOT_FOUND") {
          // The screen had an old version: the reading below shows the event as Google has it.
          toast(errorMessage(failure), { failed: true, persistent: true });
        } else {
          toast(t("web.agenda.change.refused", { reason: errorMessage(failure) }), { failed: true, persistent: true });
        }
      } finally {
        busy.current = false;
        setSaving(false);
        void qc.invalidateQueries({ queryKey: EVENTS_KEY });
      }
    },
    [forget, note, put, qc, settle, t, timeZone, toast],
  );

  /** "Desfazer" from the keyboard (Ctrl or ⌘ + Z), while the toast offers it. */
  const undo = useCallback((): boolean => {
    const current = offer.current;
    if (!current || Date.now() > current.until) return false;
    dismissToast(current.toast);
    current.run();
    return true;
  }, []);

  // Leaving the Agenda: an undo of a change made here is not offered on another screen.
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      forget();
    };
  }, [forget]);

  return { send, undo, forget, saving, savedAt, problem, log, note };
}
