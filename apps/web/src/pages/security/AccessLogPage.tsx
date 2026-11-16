import { useInfiniteQuery } from "@tanstack/react-query";
import {
  AUTH_ACTIVITY_GROUP_NAMES,
  AUTH_ACTIVITY_PERIODS,
  AUTH_ACTIVITY_SHOW,
  type AuthActivityEvent,
  type AuthActivityGroup,
  type AuthActivityPeriod,
  type AuthActivityShow,
  authActivitySchema,
} from "@zuri/shared";
import { Globe, ShieldCheck } from "lucide-react";
import { useSearchParams } from "react-router";
import { byDay, dayBefore, dayKey, deviceText, GROUP_LABEL, groupOf, KIND_LABEL, reasonLabels } from "../../components/security/activity.ts";
import { Place } from "../../components/security/Place.tsx";
import { Button, Card, cn, EmptyState, ErrorNotice, PageHeader, SelectField, Loading, TextField } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useDebounced } from "../../lib/lists.tsx";
import { useI18n } from "../../lib/i18n.tsx";

const DEFAULT_PERIOD: AuthActivityPeriod = 7;
const PERIOD_LABEL = { 1: "web.accessLog.period.1", 7: "web.accessLog.period.7", 30: "web.accessLog.period.30", 90: "web.accessLog.period.90" } as const;
/** "Show" in the address, in the owner's words, and what each asks of the server (E12a). */
const SHOW_PARAM: Record<AuthActivityShow, string> = { attention: "atencao", abroad: "fora" };
const SHOW_LABEL = { all: "web.accessLog.show.all", attention: "web.accessLog.show.attention", abroad: "web.accessLog.show.abroad" } as const;
/** What the IP filter accepts, the same as the server: the start of an IPv4 or IPv6 address. */
const IP_PREFIX = /^[0-9A-Fa-f.:]{1,45}$/;

/** The badge of each group: green for the owner's sign-ins, red for wrong guesses, amber for what the guard stopped. */
const TONE: Record<AuthActivityGroup, string> = {
  success: "bg-success-soft text-success border-success/40",
  failure: "bg-danger-soft text-danger border-danger/40",
  blocked: "bg-warning-soft text-warning border-warning/40",
  robot: "bg-warning-soft text-warning border-warning/40",
  account: "bg-raised text-fg-muted border-border",
};

function readPeriod(value: string | null): AuthActivityPeriod {
  const n = Number(value);
  return (AUTH_ACTIVITY_PERIODS as readonly number[]).includes(n) ? (n as AuthActivityPeriod) : DEFAULT_PERIOD;
}

function readShow(value: string | null): AuthActivityShow | "" {
  return AUTH_ACTIVITY_SHOW.find((show) => SHOW_PARAM[show] === value) ?? "";
}

function readGroup(value: string | null): AuthActivityGroup | "" {
  return (AUTH_ACTIVITY_GROUP_NAMES as string[]).includes(value ?? "") ? (value as AuthActivityGroup) : "";
}

/**
 * Accesses: every try to get into Zuri, with the visitor's IP, the edge's place
 * and network, the browser and the result. The filters live in the address, so
 * the back button and a reload keep them.
 */
export function AccessLogPage() {
  const { t, plural, dateTime, locale, timeZone } = useI18n();
  const [params, setParams] = useSearchParams();
  const period = readPeriod(params.get("periodo"));
  const group = readGroup(params.get("tipo"));
  const show = readShow(params.get("mostrar"));
  const ipInput = params.get("ip") ?? "";
  const ip = useDebounced(ipInput.trim());
  const ipValid = ip === "" || IP_PREFIX.test(ip);
  const filtered = period !== DEFAULT_PERIOD || group !== "" || ipInput !== "" || show !== "";

  const update = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const log = useInfiniteQuery({
    queryKey: ["auth-activity", { period, group, ip, show }],
    enabled: ipValid,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams({ days: String(period) });
      if (group) query.set("group", group);
      if (show) query.set("show", show);
      if (ip) query.set("ip", ip);
      if (pageParam) query.set("before", pageParam);
      return authActivitySchema.parse(await api<unknown>(`/auth/activity?${query}`, { signal }));
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const events = log.data?.pages.flatMap((page) => page.events) ?? [];
  const days = byDay(events, timeZone);
  const today = dayKey(Date.now(), timeZone);
  const yesterday = dayBefore(today);
  const dayTitle = (day: string, at: string) =>
    day === today
      ? t("web.accessLog.today")
      : day === yesterday
        ? t("web.accessLog.yesterday")
        : new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(at));
  const hour = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-6">
      <PageHeader title={t("web.accessLog.title")} description={t("web.accessLog.description")} />

      <Card>
        <div className="grid gap-4 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-start">
          <SelectField label={t("web.accessLog.period")} value={String(period)} onChange={(e) => update("periodo", e.target.value === String(DEFAULT_PERIOD) ? "" : e.target.value)}>
            {AUTH_ACTIVITY_PERIODS.map((days) => (
              <option key={days} value={days}>
                {t(PERIOD_LABEL[days])}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("web.accessLog.group")} value={group} onChange={(e) => update("tipo", e.target.value)}>
            <option value="">{t("web.accessLog.group.all")}</option>
            {AUTH_ACTIVITY_GROUP_NAMES.map((name) => (
              <option key={name} value={name}>
                {t(GROUP_LABEL[name])}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t("web.accessLog.ip")}
            hint={t("web.accessLog.ipHint")}
            error={ipValid ? null : t("web.accessLog.ipInvalid")}
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={45}
            value={ipInput}
            onChange={(e) => update("ip", e.target.value)}
          />
          <Button variant="secondary" disabled={!filtered} onClick={() => setParams(new URLSearchParams(), { replace: true })} className="sm:mt-7">
            {t("web.accessLog.clear")}
          </Button>
        </div>
      </Card>

      {/* The prototype's "Show" (E12a): everything, what needs attention, or what came from outside Brazil. */}
      <fieldset className="flex min-w-0 flex-wrap gap-1 rounded-xl bg-raised p-1 sm:w-fit">
        <legend className="sr-only">{t("web.accessLog.show")}</legend>
        {(["all", ...AUTH_ACTIVITY_SHOW] as const).map((item) => {
          const on = item === "all" ? show === "" : show === item;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={on}
              onClick={() => update("mostrar", item === "all" ? "" : SHOW_PARAM[item])}
              className={cn(
                "min-h-11 flex-auto whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors",
                on ? "bg-surface text-fg shadow-sm ring-1 ring-border-strong" : "text-fg-muted hover:text-fg",
              )}
            >
              {t(SHOW_LABEL[item])}
            </button>
          );
        })}
      </fieldset>

      {!ipValid ? null : log.isPending ? (
        <Loading />
      ) : log.isError ? (
        <ErrorNotice error={log.error} onRetry={() => void log.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState icon={filtered ? <Globe className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />} title={filtered ? t("web.accessLog.emptyFiltered") : t("web.accessLog.empty")}>
          {filtered && t("web.accessLog.emptyFilteredHint")}
        </EmptyState>
      ) : (
        <section aria-labelledby="access-log-heading" className="space-y-4">
          <h2 id="access-log-heading" className="sr-only">
            {t("web.accessLog.listTitle")}
          </h2>
          <p className="text-sm text-fg-muted" aria-live="polite">
            {log.hasNextPage ? plural("web.accessLog.shownMore", events.length) : plural("web.accessLog.shown", events.length)}
          </p>

          {/* Wide screens: one table to scan by column, a header row per day (E12a). */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("web.accessLog.listTitle")}</caption>
              <thead className="border-b border-border bg-raised text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t("web.accessLog.col.when")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t("web.accessLog.col.event")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t("web.accessLog.col.ip")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t("web.accessLog.col.place")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t("web.accessLog.col.device")}
                  </th>
                </tr>
              </thead>
              {days.map(({ day, events: rows }) => (
                <tbody key={day} className="divide-y divide-border border-b border-border last:border-b-0">
                  <tr className="bg-raised/60">
                    <th scope="rowgroup" colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                      {dayTitle(day, rows[0]?.at ?? day)}
                    </th>
                  </tr>
                  {rows.map((event) => (
                    <tr key={event.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-fg-muted tabular-nums">
                        <time dateTime={event.at} title={dateTime(event.at)}>
                          {hour.format(new Date(event.at))}
                        </time>
                      </td>
                      <td className="px-4 py-3">
                        <EventLabel event={event} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{event.ip || "—"}</td>
                      <td className="px-4 py-3">
                        <PlaceAndNetwork event={event} />
                      </td>
                      <td className="px-4 py-3 text-fg-muted" title={event.userAgent || undefined}>
                        {deviceText(event, (browser, system) => t("web.activity.device", { browser, system })) || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>

          {/* Phones: a block per day, one card per access, the same fields stacked. */}
          <div className="space-y-5 md:hidden">
            {days.map(({ day, events: rows }) => {
              const title = dayTitle(day, rows[0]?.at ?? day);
              return (
                <section key={day} aria-label={title} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
                  <ul className="space-y-3">
                    {rows.map((event) => {
                      const device = deviceText(event, (browser, system) => t("web.activity.device", { browser, system }));
                      return (
                        <li key={event.id} className="space-y-2 rounded-2xl border border-border bg-surface p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <EventLabel event={event} />
                            <time dateTime={event.at} title={dateTime(event.at)} className="text-xs text-fg-muted tabular-nums">
                              {hour.format(new Date(event.at))}
                            </time>
                          </div>
                          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                            <dt className="text-fg-muted">{t("web.accessLog.col.ip")}</dt>
                            <dd className="break-all font-mono text-xs leading-5">{event.ip || "—"}</dd>
                            <dt className="text-fg-muted">{t("web.accessLog.col.place")}</dt>
                            <dd>
                              <PlaceAndNetwork event={event} />
                            </dd>
                            {device && (
                              <>
                                <dt className="text-fg-muted">{t("web.accessLog.col.device")}</dt>
                                <dd>{device}</dd>
                              </>
                            )}
                          </dl>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          {log.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                {t("web.accessLog.more")}
              </Button>
            </div>
          )}
          <p className="text-sm text-fg-muted">{t("web.accessLog.note")}</p>
        </section>
      )}
    </div>
  );
}

function EventLabel({ event }: { event: AuthActivityEvent }) {
  const { t, plural } = useI18n();
  const reasons = reasonLabels(event.reason);
  return (
    <div className="space-y-1">
      <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", TONE[groupOf(event.kind)])}>{t(KIND_LABEL[event.kind])}</span>
      {(event.count > 1 || reasons.length > 0) && (
        <p className="text-xs text-fg-muted">{[...reasons.map((key) => t(key)), ...(event.count > 1 ? [plural("web.activity.times", event.count)] : [])].join(" · ")}</p>
      )}
    </div>
  );
}

function PlaceAndNetwork({ event }: { event: AuthActivityEvent }) {
  const { t } = useI18n();
  return (
    <span className="block">
      <Place event={event} />
      {event.asn !== null && <span className="block pl-5.5 text-xs text-fg-muted">{t("web.accessLog.network", { asn: event.asn })}</span>}
    </span>
  );
}
