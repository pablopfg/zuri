import { ptBRMenu } from "@zuri/shared";
import { Check, MoreHorizontal } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
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

/**
 * The "⋯ Mais opções" menu of a row: the row keeps its main action in view and
 * the rest comes here (docs/planos/revisao-de-textos-e-experiencia.md). Arrow
 * keys move between the items, Esc and a click outside close it, and the focus
 * goes back to the button.
 */
export function ActionsMenu({ actions, name }: { actions: MenuAction[]; name?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const ordered = [...actions.filter((action) => !action.danger), ...actions.filter((action) => action.danger)];
  const firstDanger = ordered.findIndex((action) => action.danger);

  const items = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 };
    if (event.key in move) {
      event.preventDefault();
      all[((move[event.key] as number) + all.length) % all.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  const label = name ? t("web.menu.moreNamed", { name }) : t("web.menu.more");
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-fg-muted hover:bg-raised hover:text-fg"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full z-20 mt-1 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-lg"
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
