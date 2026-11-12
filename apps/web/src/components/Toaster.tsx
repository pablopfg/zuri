import { Check, TriangleAlert, X } from "lucide-react";
import { type FocusEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { useI18n } from "../lib/i18n.tsx";
import { createToastStore, type Toast, type ToastOptions } from "../lib/toasts.ts";

/**
 * Toasts: short confirmations ("Salvo", "Senha trocada") that show for a few
 * seconds at the foot of the screen and leave on their own (revisão de design,
 * D7). Only screens that load on demand import this module, so the first
 * download never carries it (rule P11): the stack mounts on the first toast,
 * in a React root of its own, and the message arrives already translated.
 */

const SHOW_MS = 5000;

const store = createToastStore();
let mounted = false;

/** Shows a confirmation. A screen reader reads its text once (a polite status). */
export function showToast(message: string, closeLabel: string, options?: ToastOptions): number {
  if (!mounted) {
    mounted = true;
    const host = document.createElement("div");
    document.body.append(host);
    createRoot(host).render(<Toaster />);
  }
  return store.show(message, closeLabel, options);
}

/** Takes a toast off before its time: what it offered ("Desfazer") no longer applies. */
export function dismissToast(id: number) {
  store.dismiss(id);
}

/** The toast function of a screen: it knows the close button's label in the current language. */
export function useToast() {
  const { t } = useI18n();
  return useCallback((message: string, options?: ToastOptions): number => showToast(message, t("web.close"), options), [t]);
}

function Toaster() {
  const list = useSyncExternalStore(store.subscribe, store.snapshot);
  const latest = list.at(-1);
  return (
    <>
      {/* Only the text is spoken; the buttons stay out of the announcement. */}
      <div role="status" aria-live="polite" className="sr-only">
        {latest && <p key={latest.id}>{latest.message}</p>}
      </div>
      {/* Above the phone's bottom navigation; at the bottom right on a computer. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-6 md:bottom-6 md:items-end md:px-0">
        {list.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </div>
    </>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  // Held while the pointer or the focus is on it, so it never leaves mid-read (WCAG 2.2.1).
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Where the focus came from: closing the toast by keyboard puts it back there.
  const cameFrom = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (toast.persistent || hovered || focused) return;
    const timer = setTimeout(() => store.dismiss(toast.id), toast.ms ?? SHOW_MS);
    return () => clearTimeout(timer);
  }, [toast.persistent, toast.ms, hovered, focused, toast.id]);

  function focusIn(event: FocusEvent) {
    if (!focused && event.relatedTarget instanceof HTMLElement) cameFrom.current = event.relatedTarget;
    setFocused(true);
  }

  function close() {
    const back = cameFrom.current;
    store.dismiss(toast.id);
    if (focused) (back?.isConnected ? back : document.getElementById("conteudo"))?.focus();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only hold the timer; the button is the control.
    <div
      className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-border bg-surface py-2 pr-1.5 pl-3.5 text-sm text-fg shadow-lg motion-safe:animate-rise"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={focusIn}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${toast.failed ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`} aria-hidden>
        {toast.failed ? <TriangleAlert className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
      </span>
      <p className="min-w-0 flex-1 py-1.5 leading-5">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          className="min-h-11 shrink-0 rounded-lg px-2 font-semibold text-accent-text hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={() => {
            const { run } = toast.action ?? {};
            close();
            run?.();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-raised hover:text-fg"
        aria-label={toast.closeLabel}
        onClick={close}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
