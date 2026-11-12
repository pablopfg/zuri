import { useQueryClient } from "@tanstack/react-query";
import type { AgendaEvent, AgendaPage as AgendaWindow } from "@zuri/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { dismissToast, useToast } from "../../components/Toaster.tsx";
import { applyChanges, canUndo, type EventChanges, reverseChanges, UNDO_MS } from "../../lib/agenda-edit.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

/** Every window of events the screen has read. */
export const EVENTS_KEY = ["calendar", "events"] as const;

const same = (a: AgendaEvent, b: AgendaEvent) => a.id === b.id && a.calendarId === b.calendarId;

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
  /** When Google took the last change, for "Salvo no Google agora". */
  const [savedAt, setSavedAt] = useState<number | null>(null);
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
        if (code === "NETWORK") {
          // Nothing waits in a hidden queue: the owner sends it again, or not.
          const offline = () => {
            const retry = () => {
              // Another change went out meanwhile: this one keeps waiting on screen, never dropped in silence.
              if (busy.current) offline();
              else void send(before, changes, message, undoable);
            };
            toast(t("web.agenda.change.offline"), gone.current ? { failed: true, persistent: true } : { failed: true, persistent: true, action: { label: t("web.retry"), run: retry } });
          };
          offline();
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
    [forget, put, qc, t, timeZone, toast],
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

  return { send, undo, forget, saving, savedAt };
}
