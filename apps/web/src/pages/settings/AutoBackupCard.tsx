import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BACKUP_KEY_FILE_NAME,
  BACKUP_RESTORE_MAX_BYTES,
  backupImportParts,
  type BackupAutoStatus,
  BackupFileError,
  type BackupImportSummary,
  type BackupKeyFile,
  type BackupParts,
  createBackupKey,
  isBackupEnvelope,
  type MessageKey,
  openBackup,
  parseBackupKeyFile,
} from "@zuri/shared";
import { Download, KeyRound, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, Dialog, ErrorNotice, Loading, Notice } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

export const AUTO_BACKUP_KEY = ["backup", "auto"] as const;
const DAY_MS = 86_400_000;

const OPEN_ERROR: Record<BackupFileError["reason"], MessageKey> = {
  format: "web.backup.restore.notCopy",
  key: "web.backup.restore.wrongKey",
  damaged: "web.backup.restore.damaged",
};

/** The browser saves a file without a round trip: the key never goes anywhere else. */
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type Backup = BackupParts[number];

const OPENED_COUNTS = [
  ["tasks", "web.backup.summary.tasks"],
  ["notes", "web.backup.summary.notes"],
  ["projects", "web.backup.summary.projects"],
  ["memories", "web.backup.summary.memories"],
  ["conversations", "web.backup.summary.conversations"],
  ["automations", "web.backup.summary.automations"],
] as const;

/** Settings › Data › Automatic backup (step 23b): the key, the copies, and restoring one in the browser. */
export function AutoBackupCard() {
  const { t, dateTime, plural } = useI18n();
  const status = useQuery({ queryKey: AUTO_BACKUP_KEY, queryFn: () => api<BackupAutoStatus>("/backup/auto") });
  const [keyDialog, setKeyDialog] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const bytes = useBytes();

  async function download(name: string) {
    setBusy(name);
    setError(null);
    try {
      const blob = await (await api<Response>(`/backup/copies/${name}`, { raw: true })).blob();
      save(blob, `zuri-backup-${name}.zuri`);
      toast(t("web.backup.auto.downloaded"));
      await qc.invalidateQueries({ queryKey: AUTO_BACKUP_KEY });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const data = status.data;
  const days = data?.downloadedAt ? Math.floor((Date.now() - Date.parse(data.downloadedAt)) / DAY_MS) : null;
  return (
    <Card title={t("web.backup.auto.title")} description={t("web.backup.auto.body")}>
      {status.isPending ? (
        <Loading rows={2} />
      ) : status.isError ? (
        <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
      ) : !data?.available ? (
        <Notice>{t("web.backup.auto.off")}</Notice>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            {days === null ? t("web.backup.auto.neverDownloaded") : days === 0 ? t("web.backup.auto.downloadedToday") : plural("web.backup.auto.downloadedDays", days)}
          </p>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {!data.key ? (
            <>
              <Notice tone="warning">{t("web.backup.auto.noKey")}</Notice>
              <Button onClick={() => setKeyDialog(true)}>
                <KeyRound className="h-4 w-4" aria-hidden />
                {t("web.backup.key.create")}
              </Button>
            </>
          ) : (
            <>
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-fg-muted">{t("web.backup.auto.keyLabel")}</dt>
                <dd>{t("web.backup.auto.keyValue", { id: data.key.id.slice(0, 8), date: dateTime(data.key.createdAt) })}</dd>
                {data.nextAt && (
                  <>
                    <dt className="text-fg-muted">{t("web.backup.auto.nextLabel")}</dt>
                    <dd>{dateTime(data.nextAt)}</dd>
                  </>
                )}
              </dl>
              {data.failure && <Notice tone="warning">{t("web.backup.auto.failed", { date: dateTime(data.failure.at) })}</Notice>}
              {data.listFailed ? (
                <Notice tone="warning">{t("web.backup.auto.listFailed")}</Notice>
              ) : data.copies.length === 0 ? (
                <p className="text-sm text-fg-muted">{t("web.backup.auto.noCopies")}</p>
              ) : (
                <ul aria-label={t("web.backup.auto.copies")} className="divide-y divide-border rounded-xl border border-border">
                  {data.copies.map((copy) => (
                    <li key={copy.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="text-sm">
                        {dateTime(copy.at)} <span className="text-fg-muted">· {bytes(copy.size)}</span>
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() => void download(copy.name)}
                        loading={busy === copy.name}
                        disabled={busy !== null}
                        aria-label={t("web.backup.auto.downloadCopy", { date: dateTime(copy.at) })}
                      >
                        <Download className="h-4 w-4" aria-hidden />
                        {t("web.backup.auto.download")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setRestoring(true)}>
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  {t("web.backup.restore.action")}
                </Button>
                <Button variant="ghost" onClick={() => setKeyDialog(true)}>
                  <KeyRound className="h-4 w-4" aria-hidden />
                  {t("web.backup.key.replace")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <KeyDialog open={keyDialog} replacing={Boolean(data?.key)} onClose={() => setKeyDialog(false)} />
      <RestoreDialog open={restoring} onClose={() => setRestoring(false)} />
    </Card>
  );
}

export function useBytes() {
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

/**
 * Makes the key pair here, in two steps: the key file is saved by the owner's
 * own click (a download started after a network call can be blocked), and
 * only then does the public half go to the server. A key not confirmed is
 * dropped with the dialog, and the copies go on with the key in use.
 */
function KeyDialog({ open, replacing, onClose }: { open: boolean; replacing: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [made, setMade] = useState<{ publicKey: string; file: BackupKeyFile } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setMade(null);
    setSaved(false);
    setError(null);
    onClose();
  };

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setMade(await createBackupKey());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!made) return;
    save(new Blob([JSON.stringify(made.file, null, 2)], { type: "application/json" }), BACKUP_KEY_FILE_NAME);
    setSaved(true);
  }

  async function confirm() {
    if (!made) return;
    setBusy(true);
    setError(null);
    try {
      await api("/backup/key", { method: "PUT", body: { key: made.file.key, publicKey: made.publicKey } });
      toast(t("web.backup.key.created"));
      await qc.invalidateQueries({ queryKey: AUTO_BACKUP_KEY });
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={t(replacing ? "web.backup.key.replaceTitle" : "web.backup.key.title")}>
      <p className="text-sm leading-6">{t(made ? "web.backup.key.saveFirst" : "web.backup.key.body")}</p>
      {replacing && <Notice tone="warning">{t("web.backup.key.replaceWarning")}</Notice>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={close} autoFocus>
          {t("web.cancel")}
        </Button>
        {!made ? (
          <Button onClick={() => void create()} loading={busy}>
            {t("web.backup.key.submit")}
          </Button>
        ) : (
          <>
            <Button variant={saved ? "secondary" : "primary"} onClick={download}>
              <Download className="h-4 w-4" aria-hidden />
              {t("web.backup.key.download")}
            </Button>
            <Button onClick={() => void confirm()} loading={busy} disabled={!saved}>
              {t("web.backup.key.confirm")}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

class TooLarge extends Error {}

/** gzip opened as text, stopping past `max` bytes: a forged copy can't fill the tab's memory. */
async function gunzip(bytes: Uint8Array, max: number): Promise<string> {
  const body = new Response(bytes as Uint8Array<ArrayBuffer>).body;
  if (!body) throw new BackupFileError("damaged");
  const reader = body.pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    chunks.push(value);
  }
  return new Blob(chunks).text();
}

/**
 * Opens a copy with the key file, all in the browser, then imports what it
 * holds, part by part. A part that fails stops there: "continue" picks up at
 * that part, so the ones already in aren't imported twice.
 */
function RestoreDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, plural, dateTime } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [copy, setCopy] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [opened, setOpened] = useState<{ backup: Backup; parts: BackupParts } | null>(null);
  const [done, setDone] = useState(0);
  const [routines, setRoutines] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setCopy(null);
    setKey(null);
    setOpened(null);
    setDone(0);
    setRoutines(0);
    setError(null);
    onClose();
  };

  async function unseal() {
    if (!copy || !key) return;
    setBusy(true);
    setError(null);
    try {
      if (copy.size > BACKUP_RESTORE_MAX_BYTES) throw new TooLarge();
      let keyFile: BackupKeyFile;
      try {
        keyFile = parseBackupKeyFile(await key.text());
      } catch {
        throw new BackupFileError("key");
      }
      const gzip = await openBackup(new Uint8Array(await copy.arrayBuffer()), keyFile);
      const backup = JSON.parse(await gunzip(gzip, BACKUP_RESTORE_MAX_BYTES)) as unknown;
      // Only the envelope here; every item is judged by the server, as in the manual import.
      if (!isBackupEnvelope(backup)) throw new BackupFileError("format");
      setOpened({ backup, parts: backupImportParts(backup) });
      setDone(0);
      setRoutines(0);
    } catch (err) {
      setError(err instanceof TooLarge ? t("web.backup.restore.tooLarge") : err instanceof BackupFileError ? t(OPEN_ERROR[err.reason]) : t("web.backup.restore.damaged"));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!opened) return;
    setBusy(true);
    setError(null);
    let index = done;
    let waiting = routines;
    try {
      for (; index < opened.parts.length; index++) {
        const { summary } = await api<{ summary: BackupImportSummary }>("/backup/import", { method: "POST", body: opened.parts[index] });
        waiting += summary.routinesToApprove;
        setDone(index + 1);
        setRoutines(waiting);
      }
      toast(t("web.backup.restore.done"));
      if (waiting > 0) toast(plural("web.backup.import.routines", waiting));
      await qc.invalidateQueries();
      close();
    } catch (err) {
      setError(errorMessage(err));
      // Something may have gone in already: the screens read again.
      if (index > 0) await qc.invalidateQueries();
    } finally {
      setBusy(false);
    }
  }

  const count = (name: string) => {
    const items = opened?.backup.data[name];
    return Array.isArray(items) ? items.length : 0;
  };
  const total = opened?.parts.length ?? 0;
  return (
    <Dialog open={open} onClose={close} title={t("web.backup.restore.title")}>
      {!opened ? (
        <>
          <p className="text-sm leading-6">{t("web.backup.restore.body")}</p>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t("web.backup.restore.copy")}</span>
            <input type="file" accept=".zuri,application/octet-stream" className="block w-full text-sm" onChange={(event) => setCopy(event.target.files?.[0] ?? null)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t("web.backup.restore.key")}</span>
            <input type="file" accept=".json,application/json" className="block w-full text-sm" onChange={(event) => setKey(event.target.files?.[0] ?? null)} />
          </label>
        </>
      ) : (
        <>
          <p className="text-sm leading-6">{t("web.backup.restore.opened", { date: dateTime(opened.backup.exportedAt) })}</p>
          <ul className="text-sm text-fg-muted">
            {OPENED_COUNTS.map(([name, base]) => (
              <li key={name}>{plural(base, count(name))}</li>
            ))}
          </ul>
          <p className="text-sm leading-6">{t("web.backup.import.confirm")}</p>
          {total > 1 && (
            <p className="text-sm text-fg-muted" aria-live="polite">
              {busy ? t("web.backup.restore.progress", { current: Math.min(done + 1, total), total }) : done > 0 ? t("web.backup.restore.partial", { done, total }) : t("web.backup.restore.parts", { total })}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={close} autoFocus>
          {t("web.cancel")}
        </Button>
        {!opened ? (
          <Button onClick={() => void unseal()} loading={busy} disabled={!copy || !key}>
            {t("web.backup.restore.open")}
          </Button>
        ) : (
          <Button onClick={() => void restore()} loading={busy}>
            {done > 0 ? t("web.backup.restore.resume", { current: done + 1, total }) : t("web.backup.restore.submit")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
