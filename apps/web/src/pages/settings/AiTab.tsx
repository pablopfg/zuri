import {
  AI_LIMIT_RANGES,
  AI_MODEL_IDS,
  type AiModel,
  CHAT_MODEL_IDS,
  CHAT_MODELS,
  chatNeurons,
  DEFAULT_CHAT_MODEL,
  FALLBACK_MODEL_IDS,
  type FallbackModel,
  formatDateTimeParts,
  isPaidModel,
  modelLabel,
  NO_FALLBACK_MODEL,
  PAID_MODEL_IDS,
  PAID_MODELS,
  PAID_PRICING,
  PAID_PROVIDER_IDS,
  PAID_PROVIDERS,
  PAID_TERMS_AS_OF,
  type PaidModel,
  type PaidProviderId,
  paidProviderOf,
  paidUsd,
  ptBRAi,
  type SemanticStatus,
  semanticStatusSchema,
  type Settings,
  type SettingsUpdate,
  TYPICAL_TURN_TOKENS,
  type UsageKind,
  type UsageReport,
  usageReportSchema,
} from "@zuri/shared";
import { Bot, ChevronDown, ExternalLink, FlaskConical, RotateCw } from "lucide-react";
import { type FormEvent, lazy, Suspense, useEffect, useId, useState } from "react";
import { Switch } from "../../components/Switch.tsx";
import { AgentsCard } from "./AgentsCard.tsx";
import { Button, Card, cn, Dialog, ErrorNotice, Notice, SelectField, Loading, TextField } from "../../components/ui.tsx";
import { useSettings, useSettingsMutation } from "../../hooks/settings.ts";
import { USAGE_KEY, useUsage } from "../../hooks/usage.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUsd } from "./usd.ts";

// This tab's pt-BR texts arrive with it, not in the first bundle (rule P11).
addMessages(ptBRAi);

// The charts by period (step 21) come in a piece of their own, after the tab shows.
const UsageCharts = lazy(() => import("./UsageCharts.tsx").then((m) => ({ default: m.UsageCharts })));

type LimitField = "aiRequestsPerDay" | "aiNeuronsPerDay" | "aiMaxOutputTokens" | "aiMaxToolCalls" | "aiMaxIterations" | "aiMaxContextTokens" | "aiScheduledRunsPerDay";
const LIMIT_FIELDS: readonly LimitField[] = [
  "aiRequestsPerDay",
  "aiNeuronsPerDay",
  "aiMaxOutputTokens",
  "aiMaxToolCalls",
  "aiMaxIterations",
  "aiMaxContextTokens",
  "aiScheduledRunsPerDay",
];

/** From this share of a limit on, the meter turns amber. */
const NEAR = 0.8;

function useNumber() {
  const { locale } = useI18n();
  return (value: number, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

/** Settings › Uso da IA: what the day used and the spending by period (stage 26c split the old AI tab in two). */
export function AiUsageTab() {
  return (
    <>
      <UsageCard />
      <Suspense fallback={<Card><Loading /></Card>}>
        <UsageCharts />
      </Suspense>
    </>
  );
}

/** Settings › Modelos e limites: the model first, then the paid providers, the agents and the search by meaning. */
export function AiModelsTab() {
  return (
    <>
      <LimitsCard />
      <ProvidersCard />
      <AgentsCard />
      <SemanticCard />
    </>
  );
}

function UsageCard() {
  const { t } = useI18n();
  const usage = useUsage();
  const description = usage.data ? <UsageDescription report={usage.data} /> : undefined;
  return (
    <Card title={t("web.ai.usage.title")} description={description} actions={usage.data && <ProviderBadge provider={usage.data.provider} />}>
      {usage.isPending ? (
        <Loading />
      ) : usage.isError ? (
        <ErrorNotice error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <UsageBody report={usage.data} />
      )}
    </Card>
  );
}

function UsageDescription({ report }: { report: UsageReport }) {
  const { t, locale, timeZone } = useI18n();
  return <>{t("web.ai.usage.description", { time: formatDateTimeParts(report.resetsAt, locale, timeZone).time })}</>;
}

const PROVIDER_LABELS = {
  "workers-ai": "web.ai.provider.workers-ai",
  anthropic: "web.ai.provider.anthropic",
  openai: "web.ai.provider.openai",
  mock: "web.ai.provider.mock",
} as const satisfies Record<UsageReport["provider"], string>;

function ProviderBadge({ provider }: { provider: UsageReport["provider"] }) {
  const { t } = useI18n();
  const Icon = provider === "mock" ? FlaskConical : Bot;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-raised px-3 py-1 text-xs font-medium">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">{t("web.ai.provider")}: </span>
      {t(PROVIDER_LABELS[provider])}
    </span>
  );
}

function UsageBody({ report }: { report: UsageReport }) {
  const { t, locale, timeZone } = useI18n();
  const number = useNumber();
  const usd = useUsd();
  const { today, limits } = report;
  const resetTime = formatDateTimeParts(report.resetsAt, locale, timeZone).time;
  const neuronDigits = today.neurons > 0 && today.neurons < 10 ? 1 : 0;
  const atLimit = today.requests >= limits.requestsPerDay || today.neurons >= limits.neuronsPerDay;
  const near = !atLimit && (today.requests >= limits.requestsPerDay * NEAR || today.neurons >= limits.neuronsPerDay * NEAR);

  return (
    <div className="space-y-6">
      {report.provider === "mock" && <Notice>{t("web.ai.provider.mockHint")}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Meter label={t("web.ai.neurons")} used={today.neurons} max={limits.neuronsPerDay} digits={neuronDigits} />
        <Meter label={t("web.ai.requests")} used={today.requests} max={limits.requestsPerDay} />
        <Meter
          label={t("web.ai.audio")}
          used={Math.floor(today.audioSeconds / 60)}
          max={Math.floor(limits.audioSecondsPerDay / 60)}
          valueKey="web.ai.ofMaxMinutes"
        />
      </div>
      {atLimit && <Notice tone="warning">{t("web.ai.atLimit", { time: resetTime })}</Notice>}
      {near && <Notice tone="warning">{t("web.ai.nearLimit")}</Notice>}

      {limits.usdCentsPerDay > 0 && (
        <Meter label={t("web.ai.paidToday")} used={today.paidUsd} max={limits.usdCentsPerDay / 100} format={usd} />
      )}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {limits.usdCentsPerDay === 0 && (
          <div className="rounded-xl bg-raised p-3">
            <dt className="text-fg-muted">{t("web.ai.paidToday")}</dt>
            <dd className="mt-1 leading-6 tabular-nums">{t("web.ai.paidNoCap", { usd: usd(today.paidUsd) })}</dd>
          </div>
        )}
        <div className="rounded-xl bg-raised p-3">
          <dt className="text-fg-muted">{t("web.ai.fallbacks")}</dt>
          <dd className="mt-1 leading-6 tabular-nums">{number(today.fallbacks)}</dd>
        </div>
        <div className="rounded-xl bg-raised p-3">
          <dt className="text-fg-muted">{t("web.ai.cost")}</dt>
          <dd className="mt-1 leading-6">
            {t("web.ai.costValue", { usd: new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(today.costUsd), free: number(report.pricing.freeNeuronsPerDay) })}
          </dd>
        </div>
        <div className="rounded-xl bg-raised p-3">
          <dt className="text-fg-muted">{t("web.ai.failures")}</dt>
          <dd className="mt-1 leading-6">{t("web.ai.failuresValue", { errors: number(today.errors), aborted: number(today.aborted) })}</dd>
        </div>
      </dl>

      <ModelTable report={report} />
      <WeekChart report={report} />

      <p className="text-xs leading-5 text-fg-muted">
        {t("web.ai.pricing", { date: formatDateTimeParts(`${report.pricing.asOf}T12:00:00Z`, locale, "UTC").date })}{" "}
        <a
          href={report.pricing.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 font-medium text-accent-text underline underline-offset-2"
        >
          {t("web.ai.pricingLink")}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </p>
    </div>
  );
}

function Meter({
  label,
  used,
  max,
  digits = 0,
  valueKey = "web.ai.ofMax",
  format,
}: {
  label: string;
  used: number;
  max: number;
  digits?: number;
  valueKey?: "web.ai.ofMax" | "web.ai.ofMaxMinutes";
  /** How the two numbers are written (US$ for the paid ceiling). */
  format?: (value: number) => string;
}) {
  const { t } = useI18n();
  const number = useNumber();
  const share = max > 0 ? Math.min(1, used / max) : 1;
  const percent = Math.round(share * 100);
  const value = t(valueKey, format ? { used: format(used), max: format(max) } : { used: number(used, digits), max: number(max) });
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {/* The native meter speaks to screen readers; the bar below is only for the eye. */}
      <meter className="sr-only" aria-label={label} aria-valuetext={`${value} · ${t("web.ai.percent", { percent })}`} min={0} max={max} value={Math.min(used, max)} />
      <div aria-hidden className="mt-3 h-2 overflow-hidden rounded-full bg-subtle">
        <div
          className={cn("h-full rounded-full transition-[width]", share >= 1 ? "bg-danger" : share >= NEAR ? "bg-warning" : "bg-accent")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ModelTable({ report }: { report: UsageReport }) {
  const { t } = useI18n();
  const number = useNumber();
  const kinds: Record<UsageKind, string> = {
    chat: t("web.ai.kind.chat"),
    transcription: t("web.ai.kind.transcription"),
    embedding: t("web.ai.kind.embedding"),
  };
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t("web.ai.byModel")}</h3>
      {report.today.models.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("web.ai.byModel.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-raised text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-2 py-2 sm:px-3 font-medium">
                  {t("web.ai.col.model")}
                </th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">
                  {t("web.ai.col.calls")}
                </th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">
                  {t("web.ai.col.amount")}
                </th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">
                  {t("web.ai.col.neurons")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.today.models.map((row) => (
                <tr key={`${row.model}|${row.kind}|${row.billable}`}>
                  <th scope="row" className="px-2 py-2 sm:px-3 font-normal">
                    <span className="block font-medium [overflow-wrap:anywhere]">{modelLabel(row.model)}</span>
                    <span className="text-xs text-fg-muted">{kinds[row.kind]}</span>
                  </th>
                  <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{number(row.calls)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right tabular-nums">
                    {row.kind === "transcription" ? t("web.ai.minutes", { count: number(Math.round(row.audioSeconds / 60)) }) : number(row.inputTokens + row.outputTokens)}
                    {row.estimatedTokens > 0 && <span className="block text-xs text-fg-muted">{t("web.ai.estimated", { count: number(row.estimatedTokens) })}</span>}
                  </td>
                  <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{number(row.neurons, row.neurons < 10 ? 1 : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Seven bars, today last. Each one says its numbers to screen readers; the bars are only for the eye. */
function WeekChart({ report }: { report: UsageReport }) {
  const { t, locale } = useI18n();
  const number = useNumber();
  const byDay = new Map(report.lastDays.map((d) => [d.day, d]));
  const end = Date.parse(`${report.day}T12:00:00Z`);
  const days = Array.from({ length: 7 }, (_, i) => new Date(end - (6 - i) * 86_400_000).toISOString().slice(0, 10));
  const peak = Math.max(report.limits.neuronsPerDay, ...report.lastDays.map((d) => d.neurons));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t("web.ai.week")}</h3>
      <ul className="flex h-28 items-end gap-2">
        {days.map((day) => {
          const entry = byDay.get(day);
          const neurons = entry?.neurons ?? 0;
          const label = weekday.format(Date.parse(`${day}T12:00:00Z`));
          return (
            <li key={day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="sr-only">{t("web.ai.weekDay", { day: label, neurons: number(neurons), requests: number(entry?.requests ?? 0) })}</span>
              <span
                aria-hidden
                className={cn("w-full rounded-md", day === report.day ? "bg-accent" : "bg-border-strong")}
                style={{ height: `${Math.max(4, Math.round((neurons / peak) * 100))}%` }}
              />
              <span aria-hidden className="text-xs text-fg-muted">
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LimitsCard() {
  const { t } = useI18n();
  const settings = useSettings();
  return (
    <Card title={t("web.ai.settings.title")} description={t("web.ai.settings.description")}>
      {settings.isPending ? (
        <Loading />
      ) : settings.isError ? (
        <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <LimitsForm settings={settings.data} />
      )}
    </Card>
  );
}

function LimitsForm({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const number = useNumber();
  const usd = useUsd();
  const qc = useQueryClient();
  const save = useSettingsMutation();
  const toast = useToast();
  const usage = useUsage();
  const [model, setModel] = useState<AiModel>(settings.aiModel);
  const [fallback, setFallback] = useState<FallbackModel>(usableFallback(settings.aiFallbackModel, settings.aiModel));
  const [values, setValues] = useState<Record<LimitField, string>>(() => texts(settings));
  const [cap, setCap] = useState(() => dollars(settings.aiUsdCentsPerDay));
  const [status, setStatus] = useState<"unchanged" | null>(null);
  // The nine limits and the dollar cap stay folded under the model (stage 26c); a wrong one unfolds them.
  const [advanced, setAdvanced] = useState(false);
  // A paid model newly chosen waits for the owner to read what leaves the account (plan D7).
  const [warning, setWarning] = useState<{ patch: SettingsUpdate; companies: PaidProviderId[] } | null>(null);

  // The settings as stored (after a save, or changed in another tab) replace the form.
  useEffect(() => {
    setModel(settings.aiModel);
    setFallback(usableFallback(settings.aiFallbackModel, settings.aiModel));
    setValues(texts(settings));
    setCap(dollars(settings.aiUsdCentsPerDay));
  }, [settings]);

  const configured = (id: PaidModel) => usage.data?.providers.find((p) => p.id === paidProviderOf(id))?.configured === true;
  const problems = Object.fromEntries(LIMIT_FIELDS.map((field) => [field, invalid(field, values[field])])) as Record<LimitField, boolean>;
  const capCents = cents(cap);
  const neuronCap = problems.aiNeuronsPerDay ? settings.aiNeuronsPerDay : Number(values.aiNeuronsPerDay);
  const modelHint = isPaidModel(model)
    ? t("web.ai.modelHintPaid", { usd: usd(paidUsd(model, TYPICAL_TURN_TOKENS.input, TYPICAL_TURN_TOKENS.output)), company: PAID_PROVIDERS[paidProviderOf(model)].label })
    : (() => {
        const turn = chatNeurons(model, TYPICAL_TURN_TOKENS.input, TYPICAL_TURN_TOKENS.output);
        return t("web.ai.modelHint", { neurons: number(turn), turns: number(Math.floor(neuronCap / turn)) });
      })();

  async function send(patch: SettingsUpdate) {
    await save.mutateAsync(patch).then(
      () => {
        toast(t("web.ai.saved"));
        void qc.invalidateQueries({ queryKey: USAGE_KEY });
      },
      () => undefined,
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus(null);
    if (LIMIT_FIELDS.some((field) => problems[field]) || capCents === null) {
      setAdvanced(true);
      return;
    }
    const patch: SettingsUpdate = {};
    if (model !== settings.aiModel) patch.aiModel = model;
    if (fallback !== usableFallback(settings.aiFallbackModel, settings.aiModel)) patch.aiFallbackModel = fallback;
    for (const field of LIMIT_FIELDS) {
      const value = Number(values[field]);
      if (value !== settings[field]) patch[field] = value;
    }
    if (capCents !== settings.aiUsdCentsPerDay) patch.aiUsdCentsPerDay = capCents;
    if (Object.keys(patch).length === 0) {
      setStatus("unchanged");
      return;
    }
    const companies = [...new Set([patch.aiModel, patch.aiFallbackModel].filter(isPaidModel).map(paidProviderOf))];
    if (companies.length > 0) {
      setWarning({ patch, companies });
      return;
    }
    await send(patch);
  }

  // The default is named only in the chosen model's list, as before.
  const option = (id: AiModel, named = true) =>
    isPaidModel(id) ? (
      <option key={id} value={id} disabled={!configured(id)}>
        {configured(id)
          ? t("web.ai.paidOption", { label: PAID_MODELS[id].label, input: usd(PAID_MODELS[id].input), output: usd(PAID_MODELS[id].output) })
          : t("web.ai.paidOptionNoKey", { label: PAID_MODELS[id].label })}
      </option>
    ) : (
      <option key={id} value={id}>
        {named && id === DEFAULT_CHAT_MODEL ? t("web.ai.modelDefault", { label: CHAT_MODELS[id].label }) : CHAT_MODELS[id].label}
      </option>
    );

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="space-y-4">
      <SelectField
        label={t("web.ai.model")}
        hint={modelHint}
        value={model}
        disabled={save.isPending}
        onChange={(e) => {
          const next = AI_MODEL_IDS.find((id) => id === e.target.value);
          if (!next) return;
          setModel(next);
          // The same model twice is no fallback.
          setFallback((current) => usableFallback(current, next));
          setStatus(null);
        }}
      >
        <optgroup label={t("web.ai.modelsFree")}>{CHAT_MODEL_IDS.map((id) => option(id))}</optgroup>
        <optgroup label={t("web.ai.modelsPaid")}>{PAID_MODEL_IDS.map((id) => option(id))}</optgroup>
      </SelectField>
      <SelectField
        label={t("web.ai.fallbackModel")}
        hint={t("web.ai.fallbackModelHint")}
        value={fallback}
        disabled={save.isPending}
        onChange={(e) => {
          const next = FALLBACK_MODEL_IDS.find((id) => id === e.target.value);
          if (next) setFallback(next);
          setStatus(null);
        }}
      >
        <option value={NO_FALLBACK_MODEL}>{t("web.ai.fallbackNone")}</option>
        <optgroup label={t("web.ai.modelsFree")}>{CHAT_MODEL_IDS.filter((id) => id !== model).map((id) => option(id, false))}</optgroup>
        <optgroup label={t("web.ai.modelsPaid")}>{PAID_MODEL_IDS.filter((id) => id !== model).map((id) => option(id, false))}</optgroup>
      </SelectField>
      <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)} className="group rounded-xl border border-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
          {t("web.ai.advanced")}
          <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-3">
          {LIMIT_FIELDS.map((field) => {
            const range = AI_LIMIT_RANGES[field];
            const bounds = { min: number(range.min), max: number(range.max) };
            return (
              <TextField
                key={field}
                label={t(LABELS[field].label)}
                hint={t(LABELS[field].hint, bounds)}
                error={problems[field] ? t("web.ai.invalid", bounds) : null}
                type="number"
                inputMode="numeric"
                min={range.min}
                max={range.max}
                step={1}
                required
                value={values[field]}
                disabled={save.isPending}
                onChange={(e) => {
                  const next = e.target.value;
                  setValues((current) => ({ ...current, [field]: next }));
                  setStatus(null);
                }}
              />
            );
          })}
          <TextField
            label={t("web.ai.usdCap")}
            hint={t("web.ai.usdCapHint")}
            error={capCents === null ? t("web.ai.usdCapInvalid", { max: number(AI_LIMIT_RANGES.aiUsdCentsPerDay.max / 100) }) : null}
            inputMode="decimal"
            autoComplete="off"
            value={cap}
            disabled={save.isPending}
            onChange={(e) => {
              setCap(e.target.value);
              setStatus(null);
            }}
          />
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={save.isPending}>
          {t("web.ai.save")}
        </Button>
        <div aria-live="polite" className="text-sm">
          {save.isError && <p className="text-danger">{errorMessage(save.error)}</p>}
          {status === "unchanged" && <p className="text-fg-muted">{t("web.ai.unchanged")}</p>}
        </div>
      </div>
      <PaidWarning
        companies={warning?.companies ?? []}
        open={warning !== null}
        onClose={() => setWarning(null)}
        onConfirm={() => {
          const patch = warning?.patch;
          setWarning(null);
          if (patch) void send(patch);
        }}
      />
    </form>
  );
}

/** Plan D7: what a paid company gets and what stays, before the first save that turns one on. */
function PaidWarning({ companies, open, onClose, onConfirm }: { companies: PaidProviderId[]; open: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t, locale } = useI18n();
  const date = formatDateTimeParts(`${PAID_TERMS_AS_OF}T12:00:00Z`, locale, "UTC").date;
  return (
    <Dialog open={open} onClose={onClose} title={t("web.ai.paidDialog.title")}>
      {companies.map((id) => {
        const company = PAID_PROVIDERS[id].label;
        return (
          <div key={id} className="space-y-3 text-sm leading-6">
            <p>{t("web.ai.paidDialog.cost", { company })}</p>
            <p>{t("web.ai.paidDialog.sent", { company })}</p>
            <p>{t("web.ai.paidDialog.kept")}</p>
            <p>{t("web.ai.paidDialog.retention", { company, days: PAID_PROVIDERS[id].retentionDays, date })}</p>
            <a
              href={PAID_PROVIDERS[id].termsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1 font-medium text-accent-text underline underline-offset-2"
            >
              {t("web.ai.paidDialog.terms", { company })}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        );
      })}
      <p className="text-sm text-fg-muted">{t("web.ai.paidDialog.password")}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("web.ai.paidDialog.cancel")}
        </Button>
        <Button onClick={onConfirm}>{t("web.ai.paidDialog.confirm")}</Button>
      </div>
    </Dialog>
  );
}

const STATE_LABELS = {
  notConfigured: "web.ai.providers.notConfigured",
  ok: "web.ai.providers.ok",
  no_credit: "web.ai.providers.no_credit",
  bad_key: "web.ai.providers.bad_key",
} as const;

/** The paid companies: key set or not, and the way back after a top-up or a new key. */
function ProvidersCard() {
  const { t, locale } = useI18n();
  const usage = useUsage();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<PaidProviderId | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function retry(id: PaidProviderId) {
    setBusy(id);
    setError(null);
    try {
      qc.setQueryData(USAGE_KEY, usageReportSchema.parse(await api<unknown>(`/usage/providers/${id}/retry`, { method: "POST" })));
      toast(t("web.ai.providers.retried", { company: PAID_PROVIDERS[id].label }));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={t("web.ai.providers.title")} description={t("web.ai.providers.description")}>
      {usage.isPending ? (
        <Loading />
      ) : usage.isError ? (
        <ErrorNotice error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <div className="space-y-3">
          <ul className="grid gap-3 sm:grid-cols-2">
            {PAID_PROVIDER_IDS.map((id) => {
              const entry = usage.data.providers.find((p) => p.id === id);
              const state = !entry?.configured ? "notConfigured" : entry.state;
              return (
                <li key={id} className="space-y-2 rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{PAID_PROVIDERS[id].label}</p>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        state === "ok" ? "bg-success-soft text-success" : state === "notConfigured" ? "bg-raised text-fg-muted" : "bg-danger-soft text-danger",
                      )}
                    >
                      {t(STATE_LABELS[state])}
                    </span>
                  </div>
                  <p className="text-xs text-fg-muted [overflow-wrap:anywhere]">{t("web.ai.providers.secret", { secret: PAID_PROVIDERS[id].secret })}</p>
                  {state === "no_credit" || state === "bad_key" ? (
                    <>
                      <p className="text-sm">{t(state === "no_credit" ? "web.ai.providers.noCreditHint" : "web.ai.providers.badKeyHint")}</p>
                      <Button variant="secondary" loading={busy === id} onClick={() => void retry(id)}>
                        <RotateCw className="h-4 w-4" aria-hidden />
                        {t(state === "no_credit" ? "web.ai.providers.toppedUp" : "web.ai.providers.retry")}
                      </Button>
                    </>
                  ) : null}
                  <a
                    href={PAID_PRICING.sources[id]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent-text underline underline-offset-2"
                  >
                    {t("web.ai.providers.pricingLink", { company: PAID_PROVIDERS[id].label })}
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-fg-muted">{t("web.ai.providers.pricing", { date: formatDateTimeParts(`${PAID_PRICING.asOf}T12:00:00Z`, locale, "UTC").date })}</p>
          {error !== null && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(error)}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

const LABELS = {
  aiRequestsPerDay: { label: "web.ai.requestsPerDay", hint: "web.ai.requestsPerDayHint" },
  aiNeuronsPerDay: { label: "web.ai.neuronsPerDay", hint: "web.ai.neuronsPerDayHint" },
  aiMaxOutputTokens: { label: "web.ai.maxOutputTokens", hint: "web.ai.maxOutputTokensHint" },
  aiMaxToolCalls: { label: "web.ai.maxToolCalls", hint: "web.ai.maxToolCallsHint" },
  aiMaxIterations: { label: "web.ai.maxIterations", hint: "web.ai.maxIterationsHint" },
  aiMaxContextTokens: { label: "web.ai.maxContextTokens", hint: "web.ai.maxContextTokensHint" },
  aiScheduledRunsPerDay: { label: "web.ai.scheduledRunsPerDay", hint: "web.ai.scheduledRunsPerDayHint" },
} as const;

/** The fallback as the form shows it: the chosen model again means none. */
function usableFallback(fallback: FallbackModel, model: AiModel): FallbackModel {
  return fallback === model ? NO_FALLBACK_MODEL : fallback;
}

/** The ceiling in cents as the field shows it, in dollars ("0" is no ceiling). */
function dollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** The field's dollars in cents, or null when the server would refuse them. Takes a comma or a dot. */
export function cents(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(clean)) return null;
  const value = Math.round(Number(clean) * 100);
  return value <= AI_LIMIT_RANGES.aiUsdCentsPerDay.max ? value : null;
}

function texts(settings: Settings): Record<LimitField, string> {
  return Object.fromEntries(LIMIT_FIELDS.map((field) => [field, String(settings[field])])) as Record<LimitField, string>;
}

/** True unless the text is a whole number inside the field's range (what the server accepts). */
export function invalid(field: LimitField, text: string): boolean {
  if (!/^\d{1,6}$/.test(text.trim())) return true;
  const value = Number(text);
  const range = AI_LIMIT_RANGES[field];
  return value < range.min || value > range.max;
}

export const SEMANTIC_KEY = ["semantic"] as const;
/**
 * The search by meaning (step 17): off by default. On, the card shows how much
 * is ready, what still waits and why it may be paused; "Preparar tudo de novo"
 * asks first. The words never name the machinery (no "vectors", no "index").
 */
function SemanticCard() {
  const { t } = useI18n();
  const status = useQuery({
    queryKey: SEMANTIC_KEY,
    // No polling (rule P11): the count moves when the owner comes back to the tab or opens the card again.
    queryFn: async ({ signal }): Promise<SemanticStatus> => semanticStatusSchema.parse(await api<unknown>("/semantic", { signal })),
  });
  return (
    <Card title={t("web.ai.semantic.title")} description={t("web.ai.semantic.description")}>
      {status.isPending ? (
        <Loading />
      ) : status.isError ? (
        <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <SemanticBody status={status.data} />
      )}
    </Card>
  );
}

function SemanticBody({ status }: { status: SemanticStatus }) {
  const { t, plural, locale, timeZone } = useI18n();
  const number = useNumber();
  const qc = useQueryClient();
  const toast = useToast();
  const hint = useId();
  const confirmId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);

  async function send(path: string, init: { method: "PATCH" | "POST"; body?: unknown }, message: string) {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(SEMANTIC_KEY, semanticStatusSchema.parse(await api<unknown>(path, init)));
      toast(message);
      setConfirming(false);
      // The usage report shows what the preparing spends; the palette learns at once whether to search by meaning.
      void qc.invalidateQueries({ queryKey: USAGE_KEY });
      void qc.invalidateQueries({ queryKey: ["palette", "semantic"] });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const share = status.total > 0 ? Math.min(1, status.ready / status.total) : 1;
  const state = status.paused === "lockdown"
    ? t("web.ai.semantic.pausedLockdown")
    : status.paused === "limit"
      ? t("web.ai.semantic.pausedLimit", { time: status.resumesAt ? formatDateTimeParts(status.resumesAt, locale, timeZone).time : "" })
      : status.waiting > 0
        ? plural("web.ai.semantic.preparing", status.waiting)
        : t("web.ai.semantic.done");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p id={hint} className="text-sm leading-6 text-fg-muted">
          {t("web.ai.semantic.offHint")}
        </p>
        <div className="shrink-0">
          <Switch
            label={t("web.ai.semantic.switch")}
            checked={status.enabled}
            busy={busy}
            describedBy={hint}
            onChange={(on) =>
              void send("/semantic", { method: "PATCH", body: { enabled: on } }, t(on ? "web.ai.semantic.on" : "web.ai.semantic.off"))
            }
          />
        </div>
      </div>
      {status.enabled && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <p className="text-lg font-semibold tabular-nums">{t("web.ai.semantic.ready", { ready: number(status.ready), total: number(status.total) })}</p>
          {/* The native meter speaks to screen readers; the bar below is only for the eye. */}
          <meter className="sr-only" min={0} max={Math.max(status.total, 1)} value={Math.min(status.ready, Math.max(status.total, 1))} aria-label={t("web.ai.semantic.progress")} />
          <div aria-hidden className="h-2 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
          <p role="status" className="text-sm text-fg-muted">
            {state}
          </p>
          <p className="text-xs text-fg-muted tabular-nums">{t("web.ai.semantic.today", { today: number(status.today), limit: number(status.limitPerDay) })}</p>
          {confirming ? (
            <div className="space-y-3 rounded-xl border border-warning/40 bg-warning-soft p-3">
              <p id={confirmId} className="text-sm">
                {plural("web.ai.semantic.redoConfirm", status.total)}
              </p>
              <fieldset aria-labelledby={confirmId} className="min-w-0 flex flex-wrap justify-end gap-2">
                <Button variant="secondary" autoFocus onClick={() => setConfirming(false)}>
                  {t("web.ai.semantic.cancel")}
                </Button>
                <Button loading={busy} onClick={() => void send("/semantic/reindex", { method: "POST" }, t("web.ai.semantic.redone"))}>
                  {t("web.ai.semantic.redoYes")}
                </Button>
              </fieldset>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              <RotateCw className="h-4 w-4" aria-hidden />
              {t("web.ai.semantic.redo")}
            </Button>
          )}
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(error)}
        </p>
      )}
    </div>
  );
}
