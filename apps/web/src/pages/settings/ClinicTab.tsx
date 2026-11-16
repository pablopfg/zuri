import { type AgendaPrefs, CLINIC_LIMITS, CLINIC_PHONE, type Clinic, type CrmAutomationList, ptBRClinic } from "@zuri/shared";
import { ChevronRight, MessageCircleMore } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, ErrorNotice, Loading, TextField } from "../../components/ui.tsx";
import { useSettings, useSettingsMutation } from "../../hooks/settings.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { ConfirmMessageCard } from "./ConfirmMessageCard.tsx";

// The section's texts come with its download (rule P11).
addMessages(ptBRClinic);

type T = ReturnType<typeof useI18n>["t"];

/** "(41) 3333-0000" or "(41) 93333-0000" as the digits come; at most 11 of them. Kept here: the Agenda's mask is another download (rule P11). */
export function clinicPhoneMask(value: string): string {
  const all = value.replace(/\D/g, "");
  // Pasted with the country code (+55): the number is what follows it. Only with the "+": 55 is also an area code (QA-E6a-04).
  const digits = (value.trimStart().startsWith("+55") ? all.slice(2) : all).slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  const area = `(${digits.slice(0, 2)}) `;
  const rest = digits.slice(2);
  const cut = digits.length === 11 ? 5 : 4;
  return rest.length <= cut ? area + rest : `${area}${rest.slice(0, cut)}-${rest.slice(cut)}`;
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "Segunda a sexta, das 08:00 às 18:00, almoço das 12:00 às 14:00": the office hours of Configurações › Agenda in one line. */
export function hoursSummary(prefs: AgendaPrefs, t: T, locale: string): string {
  // "segunda", as the prototype says it, not "segunda-feira".
  const name = (day: number) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" }).format(new Date(Date.UTC(2026, 0, 4 + day, 12))).replace(/-feira$/, "");
  // The week in the owner's order, so "Segunda a sexta" reads as a run.
  const order = Array.from({ length: 7 }, (_, index) => (index + prefs.weekStart) % 7);
  const days = order.filter((day) => prefs.workDays.includes(day));
  if (days.length === 0) return t("web.clinic.noDays");
  const first = order.indexOf(days[0] ?? 0);
  const run = days.length >= 3 && days.every((day, index) => order[first + index] === day);
  const text = run ? t("web.clinic.days.range", { from: name(days[0] ?? 0), to: name(days[days.length - 1] ?? 0) }) : new Intl.ListFormat(locale, { type: "conjunction" }).format(days.map(name));
  const head = text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  const base = { days: head, from: hhmm(prefs.from * 60), to: hhmm(prefs.to * 60) };
  return prefs.lunch ? t("web.clinic.summaryLunch", { ...base, lunchFrom: hhmm(prefs.lunch.from), lunchTo: hhmm(prefs.lunch.to) }) : t("web.clinic.summary", base);
}

function ClinicForm({ stored }: { stored: Clinic }) {
  const { t } = useI18n();
  const save = useSettingsMutation();
  const toast = useToast();
  const [draft, setDraft] = useState(() => ({ ...stored, whatsapp: clinicPhoneMask(stored.whatsapp) }));
  const [phoneError, setPhoneError] = useState(false);
  const phone = useRef<HTMLInputElement>(null);
  // After the message is on screen, so the field is read with it.
  useEffect(() => {
    if (phoneError) phone.current?.focus();
  }, [phoneError]);
  const digits = draft.whatsapp.replace(/\D/g, "");
  // The server's tidying (QA-E6a-07): what it stores is what "unchanged" compares with.
  const tidy = (value: string) => value.normalize("NFC").replace(/[ \t]+/g, " ").trim();
  const clinic: Clinic = { name: tidy(draft.name), whatsapp: digits, address: tidy(draft.address), city: tidy(draft.city) };
  const unchanged = (Object.keys(clinic) as (keyof Clinic)[]).every((key) => clinic[key] === stored[key]);

  const set = (key: keyof Clinic, value: string) => {
    if (save.isError) save.reset();
    if (key === "whatsapp") setPhoneError(false);
    setDraft((before) => ({ ...before, [key]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unchanged) return;
    if (!CLINIC_PHONE.test(digits)) {
      setPhoneError(true);
      phone.current?.focus();
      return;
    }
    save.mutate(
      { clinic },
      {
        onSuccess: (settings) => {
          // The fields show what was stored, so the button rests until the next change.
          setDraft({ ...settings.clinic, whatsapp: clinicPhoneMask(settings.clinic.whatsapp) });
          toast(t("web.clinic.saved"));
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t("web.clinic.name")} value={draft.name} maxLength={CLINIC_LIMITS.name} autoComplete="organization" onChange={(e) => set("name", e.target.value)} />
        <TextField
          ref={phone}
          label={t("web.clinic.whatsapp")}
          value={draft.whatsapp}
          inputMode="tel"
          autoComplete="tel-national"
          maxLength={16}
          placeholder="(41) 3333-0000"
          {...(phoneError ? { error: t("web.clinic.whatsappError") } : {})}
          onChange={(e) => set("whatsapp", clinicPhoneMask(e.target.value))}
        />
        <TextField
          label={t("web.clinic.address")}
          value={draft.address}
          maxLength={CLINIC_LIMITS.address}
          autoComplete="street-address"
          placeholder={t("web.clinic.addressPlaceholder")}
          onChange={(e) => set("address", e.target.value)}
        />
        <TextField label={t("web.clinic.city")} value={draft.city} maxLength={CLINIC_LIMITS.city} placeholder={t("web.clinic.cityPlaceholder")} onChange={(e) => set("city", e.target.value)} />
      </div>
      <p className="pt-3 text-xs leading-5 text-fg-muted">{t("web.clinic.where")}</p>
      {save.isError && (
        <p role="alert" className="pt-3 text-sm text-danger">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="mt-4 flex justify-end border-t border-border/60 pt-4">
        <Button type="submit" loading={save.isPending} disabled={unchanged}>
          {t("web.clinic.save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Automático, pelo Chatwoot" (E7c3a): the CRM automation's state and hour, shown here; it is turned on,
 * rehearsed and paused in CRM › Automações, its one place (rule of 13/11).
 */
function AutoRow() {
  const { t } = useI18n();
  // A plain read, not a query: one more shared module here would weigh on the first load (P11).
  const [list, setList] = useState<CrmAutomationList | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api<CrmAutomationList>("/crm/automations", { signal: abort.signal }).then(setList, () => {});
    return () => abort.abort();
  }, []);
  const item = list?.automations.find((automation) => automation.id === "appointment-confirmation");
  const state = item?.state ?? null;
  const on = state === "live";
  return (
    <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-border/60 pt-4">
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <p className="text-sm font-semibold">{t("web.clinic.send.auto")}</p>
        <p className="text-sm text-fg-muted">{t("web.clinic.send.autoHint")}</p>
        {/* E7c3b: whether the e-mail goes along, set in the same place. */}
        {state && state !== "off" && <p className="text-sm text-fg-muted">{t(item?.options.mail === 0 ? "web.clinic.send.mailOff" : "web.clinic.send.mailOn")}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {state && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-success-soft text-success" : "bg-raised text-fg-muted"}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
            {state === "live"
              ? t("web.clinic.send.state.live", { hour: String(item?.options.hour ?? "07:00") })
              : state === "rehearsal"
                ? t("web.clinic.send.state.rehearsal")
                : state === "paused"
                  ? t("web.clinic.send.state.paused")
                  : t("web.clinic.send.state.off")}
          </span>
        )}
        <Link
          to="/crm"
          aria-label={t("web.clinic.send.changeAuto")}
          className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-medium text-fg hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t("web.clinic.change")}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/** Configurações › Consultório (E6a): the office's details the whole system reads, and the office hours as a line that leads to where they are set. */
export function ClinicTab() {
  const { t, locale } = useI18n();
  const settings = useSettings();
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} />;
  return (
    <>
      <Card title={t("web.clinic.title")} description={t("web.clinic.description")}>
        <ClinicForm stored={settings.data.clinic} />
      </Card>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold">{t("web.clinic.hours")}</p>
            <p className="text-sm text-fg-muted">{t("web.clinic.hoursHint", { summary: hoursSummary(settings.data.agenda, t, locale) })}</p>
          </div>
          <Link
            to="/configuracoes/agenda"
            aria-label={t("web.clinic.changeHours")}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-medium text-fg hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("web.clinic.change")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </Card>
      <ConfirmMessageCard stored={settings.data.confirmMessage} clinic={settings.data.clinic} />
      <Card title={t("web.clinic.send.title")} description={t("web.clinic.send.description")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <MessageCircleMore className="h-4 w-4" aria-hidden />
              {t("web.clinic.send.whatsapp")}
            </p>
            <p className="text-sm text-fg-muted">{t("web.clinic.send.whatsappHint")}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            {t("web.clinic.send.always")}
          </span>
        </div>
        <AutoRow />
      </Card>
    </>
  );
}
