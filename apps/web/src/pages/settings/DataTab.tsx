import { useQueryClient } from "@tanstack/react-query";
import { type MessageKey, TRASH_RETENTION_DAYS, type TrashItem } from "@zuri/shared";
import { Trash2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Button, Card, Dialog, EmptyState, ErrorNotice, Notice, Loading } from "../../components/ui.tsx";
import { TRASH_KEY, useTrash } from "../../hooks/productivity.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { refreshAfterTrash, TRASH_KIND_LABEL } from "../productivity/shared.tsx";

type TrashList = { items: TrashItem[]; total: number };

/** "?tipo=" from the trash buttons of Tasks and Notes: the kind shown, its line, its empty state and the way back. */
const ONLY: Record<string, { kind: TrashItem["kind"]; label: MessageKey; empty: MessageKey; back: string; backLabel: MessageKey }> = {
  tarefas: { kind: "task", label: "web.trash.only.task", empty: "web.trash.emptyOnly.task", back: "/tarefas", backLabel: "web.trash.back.task" },
  notas: { kind: "note", label: "web.trash.only.note", empty: "web.trash.emptyOnly.note", back: "/notas", backLabel: "web.trash.back.note" },
};

// Storage use, export and import (step 23): their own chunk, outside the first screen's JavaScript.
const BackupCards = lazy(() => import("./BackupCards.tsx").then((m) => ({ default: m.BackupCards })));

/** Settings › Data: storage use, export and import (step 23), then the trash. */
export function DataTab() {
  // Come from Tasks or Notes, the trash leads the page; the storage cards load after it without pushing it down.
  const [params] = useSearchParams();
  const filtered = ONLY[params.get("tipo") ?? ""] !== undefined;
  return (
    <>
      {filtered && <TrashCard />}
      <Suspense fallback={<Loading />}>
        <BackupCards />
      </Suspense>
      {!filtered && <TrashCard />}
    </>
  );
}

function TrashCard() {
  const { t, dateTime, plural } = useI18n();
  const qc = useQueryClient();
  const trash = useTrash();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ kind: "purge"; item: TrashItem } | { kind: "empty" } | null>(null);
  // From Tasks or Notes the trash opens filtered by that kind, with the way back (stage 26c).
  const [params, setParams] = useSearchParams();
  const only = ONLY[params.get("tipo") ?? ""];

  async function run(key: string, work: () => Promise<string>) {
    setBusy(key);
    setError(null);
    try {
      toast(await work());
      setConfirm(null);
      await refreshAfterTrash(qc);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  // The item leaves the trash at once; a refusal puts it back as it was.
  const restore = (item: TrashItem) =>
    void run(item.id, async () => {
      await qc.cancelQueries({ queryKey: TRASH_KEY });
      const before = qc.getQueryData<TrashList>(TRASH_KEY);
      qc.setQueryData<TrashList>(TRASH_KEY, (list) => (list ? { items: list.items.filter((other) => other.id !== item.id), total: Math.max(0, list.total - 1) } : list));
      try {
        await api(`/trash/${item.id}/restore`, { method: "POST" });
      } catch (err) {
        qc.setQueryData(TRASH_KEY, before);
        throw err;
      }
      return t("web.trash.restored", { title: item.title });
    });

  const purge = (item: TrashItem) =>
    void run(item.id, async () => {
      await api(`/trash/${item.id}`, { method: "DELETE" });
      return t("web.trash.purged");
    });

  const empty = () =>
    void run("empty", async () => {
      const { deleted } = await api<{ deleted: number }>("/trash/empty", { method: "POST" });
      return plural("web.trash.emptied", deleted);
    });

  const all = trash.data?.items ?? [];
  const items = only ? all.filter((item) => item.kind === only.kind) : all;

  return (
    <Card
      title={t("web.trash.title")}
      description={t("web.trash.description", { days: TRASH_RETENTION_DAYS })}
      actions={
        // Emptying takes every kind, so it shows only when every kind is in view.
        !only && items.length > 0 && (
          <Button variant="danger" onClick={() => setConfirm({ kind: "empty" })} disabled={busy !== null}>
            {t("web.trash.empty")}
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {only && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-raised px-3 py-2 text-sm">
            <span>{t(only.label)}</span>
            <span className="flex flex-wrap gap-1">
              <Link to={only.back} className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-accent-text hover:bg-surface">
                {t(only.backLabel)}
              </Link>
              <Button variant="ghost" onClick={() => setParams({}, { replace: true })}>
                {t("web.trash.showAll")}
              </Button>
            </span>
          </div>
        )}
        {trash.isPending ? (
          <Loading />
        ) : trash.isError ? (
          <ErrorNotice error={trash.error} onRetry={() => void trash.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Trash2 className="h-6 w-6" />} title={t(only ? only.empty : "web.trash.emptyTitle")} />
        ) : (
          <>
          {(trash.data?.total ?? 0) > items.length && (
            <Notice tone="info">{t("web.trash.showing", { shown: items.length, total: trash.data?.total ?? 0 })}</Notice>
          )}
          <ul className="divide-y divide-border rounded-xl border border-border">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="text-xs text-fg-muted">
                    {t(TRASH_KIND_LABEL[item.kind])} · {t("web.trash.deletedAt", { time: dateTime(item.deletedAt) })} ·{" "}
                    {t("web.trash.expiresAt", { time: dateTime(item.expiresAt) })}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="secondary"
                    onClick={() => restore(item)}
                    loading={busy === item.id}
                    disabled={busy !== null}
                    aria-label={t("web.trash.restoreNamed", { title: item.title })}
                  >
                    {t("web.trash.restore")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setConfirm({ kind: "purge", item })}
                    disabled={busy !== null}
                    aria-label={t("web.trash.purgeNamed", { title: item.title })}
                  >
                    {t("web.trash.purge")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title={confirm?.kind === "empty" ? t("web.trash.emptyConfirmTitle") : t("web.trash.purgeConfirmTitle")}>
        <p className="text-sm leading-6">
          {confirm?.kind === "purge" ? t("web.trash.purgeConfirm", { title: confirm.item.title }) : t("web.trash.emptyConfirm")}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            {t("web.cancel")}
          </Button>
          <Button
            variant="danger"
            loading={busy !== null}
            onClick={() => (confirm?.kind === "purge" ? purge(confirm.item) : empty())}
          >
            {confirm?.kind === "empty" ? t("web.trash.empty") : t("web.trash.purge")}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
