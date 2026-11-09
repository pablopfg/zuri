import { ptBRMenu } from "@zuri/shared";
import { Check, Loader2, MoreHorizontal } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { addMessages, useI18n } from "../lib/i18n.tsx";
import { cn } from "./ui.tsx";

addMessages(ptBRMenu);

export interface MenuAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Apagar, Remover: listed last, apart and in red (stage 26). */
  danger?: boolean;
  disabled?: boolean;
  /** An on/off mark (menuitemcheckbox): its state is read out and shown with a tick. */
  checked?: boolean;
}

/** A row's name in the button's label: long texts (a memory) are cut, so the label stays a label. */
const NAME_MAX = 60;
const GAP = 4;
/** Until it is measured, the list sits at the top right; the layout effect moves it before the first paint. */
const UNPLACED: CSSProperties = { top: 0, right: 0 };

/**
 * The "⋯ Mais opções" menu of a row: the row keeps its main action in view and
 * the rest comes here (docs/planos/revisao-de-textos-e-experiencia.md). Arrow
 * keys move between the items, Esc and a click outside close it, and Esc and a
 * pick send the focus back to the button. The list floats over the page
 * (position fixed), so a list with overflow-hidden never cuts it; it opens
 * upwards when there is no room below, follows the button when the page
 * scrolls and sits above the toasts: it is what the owner just opened. While
 * the row's action runs, the button says so (`busy`).
 */
export function ActionsMenu({ actions, name, busy = false }: { actions: MenuAction[]; name?: string; busy?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>(UNPLACED);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const ordered = [...actions.filter((action) => !action.danger), ...actions.filter((action) => action.danger)];
  const firstDanger = ordered.findIndex((action) => action.danger);

  const items = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
  const close = (focus = true) => {
    setOpen(false);
    setPlace(UNPLACED);
    if (focus) button.current?.focus();
  };

  // Below the button, right edges aligned, or above it when the screen ends first.
  const placeMenu = () => {
    if (!button.current || !list.current) return;
    const anchor = button.current.getBoundingClientRect();
    const height = list.current.scrollHeight;
    const right = Math.max(GAP, window.innerWidth - anchor.right);
    const below = window.innerHeight - anchor.bottom;
    setPlace(
      below >= height + GAP || below >= anchor.top
        ? { top: anchor.bottom + GAP, right, maxHeight: below - 2 * GAP }
        : { bottom: window.innerHeight - anchor.top + GAP, right, maxHeight: anchor.top - 2 * GAP },
    );
  };
  // Placed before the first paint.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placeMenu reads only refs; it runs once per opening.
  useLayoutEffect(() => {
    if (open) placeMenu();
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: placeMenu reads only refs; the listeners live while the menu is open.
  useEffect(() => {
    if (!open) return;
    // preventScroll: the page stays where the owner left it.
    list.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setPlace(UNPLACED);
      }
    };
    // The list floats (position fixed): when the page scrolls or the window changes, it follows its button.
    const follow = (event: Event) => {
      if (!(event.target instanceof Node && list.current?.contains(event.target))) placeMenu();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  // On the wrapper, so Esc works even when every item is disabled and the focus stayed on the button.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 };
    if (event.key in move && all.length > 0) {
      event.preventDefault();
      all[((move[event.key] as number) + all.length) % all.length]?.focus({ preventScroll: true });
    }
  };

  const short = name && name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
  const label = short ? t("web.menu.moreNamed", { name: short }) : t("web.menu.more");
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys belong to the menu inside; the wrapper only catches them for it.
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-busy={busy || undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-fg-muted hover:bg-raised hover:text-fg"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <MoreHorizontal className="h-5 w-5" aria-hidden />}
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          style={place}
          className="fixed z-[60] min-w-48 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {ordered.map((action, index) => (
            <div key={action.label}>
              {index === firstDanger && index > 0 && <hr className="my-1 border-border" />}
              <button
                type="button"
                {...(action.checked === undefined ? { role: "menuitem" } : { role: "menuitemcheckbox", "aria-checked": action.checked })}
                tabIndex={-1}
                disabled={action.disabled}
                onClick={() => {
                  close();
                  action.onSelect();
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-raised focus:bg-raised disabled:cursor-not-allowed disabled:opacity-60",
                  action.danger ? "text-danger" : "text-fg",
                )}
              >
                <span className="shrink-0" aria-hidden>
                  {action.icon}
                </span>
                <span className="flex-1">{action.label}</span>
                {action.checked && <Check className="h-4 w-4 shrink-0 text-accent-text" aria-hidden />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
