import { useQuery } from "@tanstack/react-query";
import { type AgendaEvent, type ConfirmLinkMade, type ConfirmLinkStatus, CONFIRM_LINK_LIMITS, EVENT_STATUS_COLOR } from "@zuri/shared";
import { CalendarDays, Copy } from "lucide-react";
import { useState } from "react";
import { useToast } from "../../components/Toaster.tsx";
import { Button } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

/**
 * "Confirmação do paciente" in an appointment's details (E7a, protótipo cfBox): what the patient
 * answered through the link, and the link itself, made the first time it is asked for. A cancelled
 * appointment, or one less than an hour away, has no link to give.
 */
export function ConfirmBox({ event }: { event: AgendaEvent }) {
  const { t, locale, timeZone } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<"copy" | "see" | null>(null);
  const cancelled = event.colorId === EVENT_STATUS_COLOR.cancelled;
  const expired = Date.parse(event.start) - CONFIRM_LINK_LIMITS.expireBeforeMs <= Date.now();
  const query = new URLSearchParams({ calendarId: event.calendarId, eventId: event.id }).toString();
  const status = useQuery({
    queryKey: ["calendar", "link", event.calendarId, event.id],
    queryFn: ({ signal }) => api<ConfirmLinkStatus>(`/google/events/link?${query}`, { signal }),
  });
  const s = status.data;
  // An answer for another start is old: the appointment moved and asks again.
  const answer = s && (s.answer === "cancelled" || s.answerStart === event.start) ? s.answer : "none";
  const when = s?.answeredAt ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(s.answeredAt)) : "";
  const format = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
  const line =
    answer === "confirmed"
      ? t("web.agenda.confirm.confirmed", { when })
      : answer === "rescheduled"
        ? t("web.agenda.confirm.rescheduled", { when, from: s?.previousStart ? format(s.previousStart) : "" })
        : answer === "cancelled"
          ? t("web.agenda.confirm.cancelled", { when })
          : t("web.agenda.confirm.none");
  const link = async (what: "copy" | "see") => {
    setBusy(what);
    // A tab opened now, before the wait: a browser blocks one opened after it.
    const tab = what === "see" ? window.open("", "_blank") : null;
    try {
      const made = await api<ConfirmLinkMade>("/google/events/link", { method: "POST", body: { calendarId: event.calendarId, eventId: event.id } });
      if (tab) {
        tab.opener = null;
        tab.location.href = made.url;
      } else {
        await navigator.clipboard.writeText(made.url);
        toast(t("web.agenda.confirm.copied"));
      }
      void status.refetch();
    } catch (failure) {
      tab?.close();
      toast(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-labelledby={`cf-${event.id}`} className="space-y-2.5 rounded-xl border border-border p-3">
      <h3 id={`cf-${event.id}`} className="flex items-center gap-2 text-sm font-semibold">
        <CalendarDays className="h-4 w-4" aria-hidden />
        {t("web.agenda.confirm.title")}
      </h3>
      {/* Polite, without the status role: the details already have one, for "Situação salva". */}
      <p className="text-sm" aria-live="polite">
        {cancelled ? t("web.agenda.confirm.cancelledGone") : status.isPending ? "" : line}
      </p>
      {!cancelled && expired && <p className="text-sm text-fg-muted">{t("web.agenda.confirm.expired")}</p>}
      {!cancelled && !expired && answer !== "cancelled" && (
        <>
          <p className="text-sm text-fg-muted">{t("web.agenda.confirm.hint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy === "copy"} disabled={busy !== null} onClick={() => void link("copy")}>
              <Copy className="h-4 w-4" aria-hidden />
              {t("web.agenda.confirm.copy")}
            </Button>
            <Button variant="ghost" loading={busy === "see"} disabled={busy !== null} onClick={() => void link("see")}>
              {t("web.agenda.confirm.see")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
