import { useMutation, useQueryClient } from "@tanstack/react-query";
import { APP_VERSION, type DiagnosticEntry, type DiagnosticsStatus, ptBRAlerts } from "@zuri/shared";
import { Bug, CircleAlert, CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button, buttonClass, Card, cn, Dialog, ErrorNotice, Loading } from "../../components/ui.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { DIAGNOSTICS_KEY, useDiagnostics } from "../../hooks/notices.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { ISSUE_FIELDS, type IssueField, issueReportFields, issueReportUrl } from "../../lib/issue-report.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";

// This tab's pt-BR texts arrive with it (rule P11).
addMessages(ptBRAlerts);

/** Settings > Diagnóstico: the overall state and every kind of failure of the last 30 days, names and counts only. */
export function DiagnosticsTab() {
  const { t } = useI18n();
  const report = useDiagnostics();
  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorNotice error={report.error} onRetry={() => void report.refetch()} />;
  const { status, release, entries } = report.data;
  return (
    <>
      {/* Nothing in 30 days: one card says so, instead of a second card repeating "no failure". */}
      <StatusCard status={status} release={release} empty={entries.length === 0} />
      {entries.length > 0 && (
        <Card title={t("web.diagnostics.listLabel")} description={t("web.diagnostics.listHint")}>
          <ul aria-label={t("web.diagnostics.listLabel")} className="divide-y divide-border">
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ul>
          {entries.some((entry) => !entry.resolvedAt) && <p className="mt-3 text-xs leading-5 text-fg-muted">{t("web.diagnostics.reportHint")}</p>}
        </Card>
      )}
    </>
  );
}

function StatusCard({ status, release, empty }: { status: DiagnosticsStatus; release: string | null; empty: boolean }) {
  const { t } = useI18n();
  const { Icon, tone, title, body } = STATUS[status];
  return (
    <section aria-labelledby="diagnostico-estado" className={cn("flex gap-3 rounded-2xl border p-4", tone)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-1 text-sm leading-6">
        <h3 id="diagnostico-estado" className="text-base font-semibold">
          {t(title)}
        </h3>
        <p>{t(body)}</p>
        {empty && <p>{t("web.diagnostics.empty")}</p>}
        <p className="text-fg-muted">{t("web.diagnostics.privacy")}</p>
        {/* The version of the build (CHANGELOG.md); the deployment code tells two deploys of the same version apart. */}
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-fg-muted">
          <span>
            {t("web.diagnostics.version", { version: APP_VERSION })}
            {release && <> · {t("web.diagnostics.release", { release: release.slice(0, 8) })}</>}
          </span>
          <span aria-hidden>·</span>
          {/* A link beside the line, 44 px tall, into Settings > Sobre a Zuri (PR S16). */}
          <Link to="/configuracoes/sobre" className="inline-flex min-h-11 items-center font-semibold text-fg underline underline-offset-4">
            {t("web.settings.tab.about")}
          </Link>
        </p>
      </div>
    </section>
  );
}

function Entry({ entry }: { entry: DiagnosticEntry }) {
  const { t, dateTime } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [previewing, setPreviewing] = useState(false);
  const resolve = useMutation({
    mutationFn: () => api<void>("/diagnostics/resolve", { method: "POST", body: { id: entry.id } }),
    onSuccess: () => {
      toast(t("web.diagnostics.resolvedToast"));
      void qc.invalidateQueries({ queryKey: DIAGNOSTICS_KEY });
    },
    onError: (error) => toast(errorMessage(error)),
  });
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-0.5 text-sm">
        <p className="break-words font-medium">
          {t(SOURCE[entry.source])} · <code className="font-mono text-[0.8125rem]">{entry.code}</code>
          {entry.errorName !== "Error" && <span className="text-fg-muted"> · {entry.errorName}</span>}
        </p>
        {entry.route && <p className="break-all font-mono text-xs text-fg-muted">{entry.route}</p>}
        <p className="text-fg-muted">
          {t("web.diagnostics.counts", { today: entry.countToday, total: entry.countTotal })} · {t("web.diagnostics.lastAt", { when: dateTime(new Date(entry.lastAt)) })}
        </p>
        {entry.lastRef && <p className="font-mono text-xs text-fg-muted">{t("web.diagnostics.ref", { ref: entry.lastRef })}</p>}
        {entry.resolvedAt && <p className="text-xs font-semibold text-fg-muted">{t("web.diagnostics.resolved", { when: dateTime(new Date(entry.resolvedAt)) })}</p>}
      </div>
      {!entry.resolvedAt && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {/* First the preview of every field (PR S16), then GitHub's form filled in; the owner still sends it there (docs/agente/issues.md). */}
          <Button variant="secondary" onClick={() => setPreviewing(true)}>
            <Bug className="h-4 w-4" aria-hidden />
            {t("web.diagnostics.report")}
          </Button>
          <Button variant="secondary" loading={resolve.isPending} onClick={() => resolve.mutate()}>
            {t("web.diagnostics.resolve")}
          </Button>
        </div>
      )}
      <ReportPreview entry={entry} open={previewing} onClose={() => setPreviewing(false)} />
    </li>
  );
}

// One literal key per field, so the i18n lint sees each one.
const FIELD_LABEL: Record<IssueField, "web.diagnostics.field.title" | "web.diagnostics.field.contexto" | "web.diagnostics.field.passos" | "web.diagnostics.field.esperado" | "web.diagnostics.field.obtido" | "web.diagnostics.field.codigo"> = {
  title: "web.diagnostics.field.title",
  contexto: "web.diagnostics.field.contexto",
  passos: "web.diagnostics.field.passos",
  esperado: "web.diagnostics.field.esperado",
  obtido: "web.diagnostics.field.obtido",
  codigo: "web.diagnostics.field.codigo",
};

/** Each field of GitHub's form exactly as the link fills it: the owner sees what leaves before it leaves. */
function ReportPreview({ entry, open, onClose }: { entry: DiagnosticEntry; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const fields = issueReportFields(entry);
  return (
    <Dialog open={open} onClose={onClose} title={t("web.diagnostics.preview.title")}>
      <div className="space-y-4 px-5">
        <p className="text-sm leading-6 text-fg-muted">{t("web.diagnostics.preview.intro")}</p>
        <dl className="space-y-3 text-sm">
          {ISSUE_FIELDS.map((id) => (
            <div key={id}>
              <dt className="font-semibold">{t(FIELD_LABEL[id])}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words rounded-xl border border-border bg-raised px-3 py-2 font-mono text-xs leading-5">{fields[id]}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm leading-6 text-fg-muted">{t("web.diagnostics.preview.lists")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("web.cancel")}
          </Button>
          <a href={issueReportUrl(entry)} target="_blank" rel="noopener noreferrer" onClick={onClose} className={buttonClass("primary")}>
            {t("web.diagnostics.preview.open")}
            <ExternalLink className="h-4 w-4" aria-hidden />
            <span className="sr-only">{t("web.diagnostics.reportNewTab")}</span>
          </a>
        </div>
      </div>
    </Dialog>
  );
}

// One literal key per value, so the i18n lint sees each one.
const STATUS = {
  ok: { Icon: CircleCheck, tone: "border-success/40 bg-success-soft", title: "web.diagnostics.status.ok", body: "web.diagnostics.status.okBody" },
  attention: { Icon: CircleAlert, tone: "border-warning/40 bg-warning-soft", title: "web.diagnostics.status.attention", body: "web.diagnostics.status.attentionBody" },
  failing: { Icon: TriangleAlert, tone: "border-danger/40 bg-danger-soft", title: "web.diagnostics.status.failing", body: "web.diagnostics.status.failingBody" },
} as const;
const SOURCE = {
  api: "web.diagnostics.source.api",
  ai: "web.diagnostics.source.ai",
  automation: "web.diagnostics.source.automation",
  chat: "web.diagnostics.source.chat",
  interface: "web.diagnostics.source.interface",
} as const;
