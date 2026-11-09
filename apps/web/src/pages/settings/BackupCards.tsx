import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BACKUP_IMPORT_MAX_BYTES, type BackupImportSummary, type MessageKey, ptBRBackup, type StorageUse, type StorageUseKind } from "@zuri/shared";
import { Download, Upload } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, cn, Dialog, ErrorNotice, Loading, Notice } from "../../components/ui.tsx";
import { api, download, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";

addMessages(ptBRBackup);

const STORAGE_KEY = ["storage"] as const;
/** From 80% a bar turns amber and says so. */
const NEAR = 0.8;

const KIND_LABEL: Record<StorageUseKind, MessageKey> = {
  tasks: "web.backup.storage.kind.tasks",
  notes: "web.backup.storage.kind.notes",
  projects: "web.backup.storage.kind.projects",
  memories: "web.backup.storage.kind.memories",
  conversations: "web.backup.storage.kind.conversations",
  messages: "web.backup.storage.kind.messages",
  automations: "web.backup.storage.kind.automations",
  crm_clients: "web.backup.storage.kind.crm_clients",
};

/** Settings › Data (step 23): storage use, then export and import. Loaded with its own chunk. */
export function BackupCards() {
  return (
    <>
      <StorageCard />
      <ExportImportCard />
    </>
  );
}

function useNumber() {
  const { locale } = useI18n();
  return (value: number) => new Intl.NumberFormat(locale).format(value);
}

function useBytes() {
  const { locale } = useI18n();
  return (value: number) => {
    const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
    let unit = 0;
    let size = value;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return new Intl.NumberFormat(locale, { style: "unit", unit: units[unit], unitDisplay: "short", maximumFractionDigits: unit === 0 ? 0 : 1 }).format(size);
  };
}

function StorageCard() {
  const { t } = useI18n();
  const number = useNumber();
  const bytes = useBytes();
  const use = useQuery({ queryKey: STORAGE_KEY, queryFn: () => api<StorageUse>("/storage") });
  return (
    <Card title={t("web.backup.storage.title")} description={t("web.backup.storage.body")}>
      {use.isPending ? (
        <Loading rows={2} />
      ) : use.isError ? (
        <ErrorNotice error={use.error} onRetry={() => void use.refetch()} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          <Bar label={t("web.backup.storage.database")} used={use.data.bytes} max={use.data.maxBytes} value={t("web.backup.storage.of", { count: bytes(use.data.bytes), limit: bytes(use.data.maxBytes) })} />
          {use.data.kinds.map((kind) => (
            <Bar key={kind.kind} label={t(KIND_LABEL[kind.kind])} used={kind.count} max={kind.limit} value={t("web.backup.storage.of", { count: number(kind.count), limit: number(kind.limit) })} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function Bar({ label, used, max, value }: { label: string; used: number; max: number; value: string }) {
  const { t } = useI18n();
  const share = max > 0 ? Math.min(1, used / max) : 1;
  const near = share >= NEAR;
  return (
    <li className="rounded-xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-fg-muted">{label}</span>
        <span className="text-sm font-semibold tabular-nums">{value}</span>
      </div>
      {/* The native meter speaks to screen readers; the bar below is only for the eye. */}
      <meter className="sr-only" aria-label={label} aria-valuetext={near ? `${value} · ${t("web.backup.storage.near")}` : value} min={0} max={max} value={Math.min(used, max)} />
      <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
        <div className={cn("h-full rounded-full", share >= 1 ? "bg-danger" : near ? "bg-warning" : "bg-accent")} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      {near && <p className="mt-1 text-xs text-fg-muted">{t("web.backup.storage.near")}</p>}
    </li>
  );
}

const SUMMARY: [keyof BackupImportSummary, Parameters<ReturnType<typeof useI18n>["plural"]>[0]][] = [
  ["tasks", "web.backup.summary.tasks"],
  ["notes", "web.backup.summary.notes"],
  ["projects", "web.backup.summary.projects"],
  ["memories", "web.backup.summary.memories"],
  ["conversations", "web.backup.summary.conversations"],
  ["automations", "web.backup.summary.automations"],
  ["clients", "web.backup.summary.clients"],
];

function ExportImportCard() {
  const { t, plural } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);

  async function exportNow() {
    setBusy("export");
    setError(null);
    try {
      const blob = await download("/backup/export");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `zuri-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast(t("web.backup.export.done"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    setError(null);
    if (!chosen) return;
    // Over the ceiling the file never leaves the browser.
    if (chosen.size > BACKUP_IMPORT_MAX_BYTES) {
      setError(t("web.backup.import.tooLarge"));
      return;
    }
    try {
      setFile({ name: chosen.name, text: await chosen.text() });
    } catch {
      setError(t("web.backup.import.unreadable"));
    }
  }

  async function importNow() {
    if (!file) return;
    setBusy("import");
    setError(null);
    try {
      const { summary } = await api<{ summary: BackupImportSummary }>("/backup/import", { method: "POST", json: file.text });
      setFile(null);
      const parts = SUMMARY.filter(([key]) => summary[key] > 0).map(([key, base]) => plural(base, summary[key]));
      toast(parts.length > 0 ? t("web.backup.import.done", { summary: parts.join(", ") }) : t("web.backup.import.nothing"));
      if (summary.routinesToApprove > 0) toast(plural("web.backup.import.routines", summary.routinesToApprove));
      // Everything may have changed: every screen reads again.
      await qc.invalidateQueries();
    } catch (err) {
      setFile(null);
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={t("web.backup.export.title")} description={t("web.backup.export.body")}>
      <div className="space-y-3">
        <Notice tone="warning">{t("web.backup.export.warning")}</Notice>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void exportNow()} loading={busy === "export"} disabled={busy !== null}>
            <Download className="h-4 w-4" aria-hidden />
            {t("web.backup.export.action")}
          </Button>
          <Button variant="secondary" onClick={() => input.current?.click()} loading={busy === "import"} disabled={busy !== null}>
            <Upload className="h-4 w-4" aria-hidden />
            {t("web.backup.import.action")}
          </Button>
          <input ref={input} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label={t("web.backup.import.file")} onChange={(event) => void pick(event)} />
        </div>
      </div>
      <Dialog open={file !== null} onClose={() => setFile(null)} title={t("web.backup.import.title")}>
        <p className="break-all text-sm font-medium">{file?.name}</p>
        <p className="text-sm leading-6">{t("web.backup.import.confirm")}</p>
        <div className="flex justify-end gap-2">
          {/* Cancel first and focused: importing adds a lot, and the owner decides with eyes open. */}
          <Button variant="secondary" onClick={() => setFile(null)} autoFocus>
            {t("web.cancel")}
          </Button>
          <Button onClick={() => void importNow()} loading={busy === "import"}>
            {t("web.backup.import.submit")}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
