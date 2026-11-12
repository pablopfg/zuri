import { type ReactNode, useId } from "react";
import { cn } from "../../components/ui.tsx";

/** A small rounded label: the status of an automation, a flow or a run. */
export function Badge({ tone = "neutral", dot, children }: { tone?: "neutral" | "accent" | "warning" | "danger" | "success"; dot?: boolean; children: ReactNode }) {
  const tones = {
    neutral: "bg-raised text-fg-muted",
    accent: "bg-accent-soft text-accent-text",
    warning: "bg-warning-soft text-fg",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-fg",
  } as const;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {dot && <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** An icon button with its name for screen readers and as a tooltip. */
export function IconButton({ label, onClick, children, busy, danger }: { label: string; onClick: () => void; children: ReactNode; busy?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors disabled:cursor-wait disabled:opacity-60 [&>svg]:h-4 [&>svg]:w-4",
        danger ? "text-danger hover:bg-danger-soft" : "text-fg-muted hover:bg-raised hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/** A checkbox with its label, 44 px tall. */
export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-accent" />
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
    </div>
  );
}

/**
 * A real checkbox as a 44 px switch, with a line of help under its name. `bare`
 * keeps the name for screen readers only (a row that already shows it). Never
 * disabled while saving, which would drop the focus: `busy` ignores the change.
 */
export function Toggle({ label, hint, checked, onChange, disabled, busy, bare }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; busy?: boolean; bare?: boolean }) {
  const id = useId();
  return (
    <div className={cn("flex min-h-11 items-center justify-between gap-3", !bare && "py-2")}>
      <div className={bare ? "sr-only" : "min-w-0 space-y-0.5"}>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-xs leading-5 text-fg-muted">
            {hint}
          </p>
        )}
      </div>
      <span className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          aria-checked={checked}
          disabled={disabled}
          aria-busy={busy || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            if (!busy) onChange(e.target.checked);
          }}
          className="zuri-toggle peer absolute inset-0 h-11 w-14 cursor-pointer appearance-none rounded-full focus-visible:outline-none disabled:cursor-not-allowed"
        />
        <span
          aria-hidden
          className="pointer-events-none h-6 w-11 rounded-full bg-border-strong transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-disabled:opacity-50"
        />
        <span aria-hidden className="pointer-events-none absolute left-2 h-5 w-5 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </div>
  );
}
