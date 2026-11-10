import { X } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { useI18n } from "../../lib/i18n.tsx";

/**
 * A panel of the shell (Sinal): the account, the notices and "Mais". On a
 * phone it is a sheet that rises from the bottom over the shaded page; on a
 * computer, a small panel beside the menu, placed by `at` (styles.css,
 * .zuri-panel). A native modal <dialog>: focus stays inside, Escape closes it
 * and the page behind is hidden from screen readers. Mounted only while open.
 */
export function Panel({
  onClose,
  at,
  label,
  labelledBy,
  children,
}: {
  onClose: () => void;
  at: "notices" | "notices-rail" | "account" | "account-rail" | "more";
  label?: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  // A layout effect: its cleanup runs while the dialog is still in the page, so closing gives the focus back.
  useLayoutEffect(() => {
    const dialog = ref.current;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (before?.isConnected) before.focus();
    };
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard closes it with Escape (the dialog's cancel); the click is for the page around it.
    <dialog
      ref={ref}
      data-at={at}
      aria-label={label}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A tap on the page around it (the dialog itself, outside its content) closes it.
      onClick={(event) => event.target === event.currentTarget && onClose()}
      className="zuri-panel"
    >
      <div>
        {children}
        {/* Last in the page, so opening focuses the first choice; drawn in the top right corner. */}
        <button type="button" onClick={onClose} aria-label={t("web.close")} className="zuri-icon-button">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </dialog>
  );
}
