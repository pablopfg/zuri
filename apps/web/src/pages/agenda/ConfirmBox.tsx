import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type AgendaEvent, COUNTRY_DIAL, type ConfirmLinkMade, type ConfirmLinkStatus, CONFIRM_LINK_LIMITS, EVENT_STATUS_COLOR, HOME_COUNTRY } from "@zuri/shared";
import { CalendarDays, Copy, Mail, MessageCircleMore } from "lucide-react";
import { Link } from "react-router";
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
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"copy" | "see" | "whatsapp" | "mail" | null>(null);
  const cancelled = event.colorId === EVENT_STATUS_COLOR.cancelled;
  const expired = Date.parse(event.start) - CONFIRM_LINK_LIMITS.expireBeforeMs <= Date.now();
  const query = new URLSearchParams({ calendarId: event.calendarId, eventId: event.id }).toString();
  const key = ["calendar", "link", event.calendarId, event.id];
  const status = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api<ConfirmLinkStatus>(`/google/events/link?${query}`, { signal }),
  });
  const s = status.data;
  // An answer for another start is old: the appointment moved and asks again.
  const answer = s && (s.answer === "cancelled" || s.answerStart === event.start) ? s.answer : "none";
  // A send for another start was for the old time: the appointment moved and asks again.
  const sentNow = !!s?.sentAt && s.sentStart === event.start;
  const sentWhen = sentNow && s ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(s.sentAt)) : "";
  const when = s?.answeredAt ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(s.answeredAt)) : "";
  const format = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
  const line =
    answer === "confirmed"
      ? t("web.agenda.confirm.confirmed", { when })
      : answer === "rescheduled"
        ? t("web.agenda.confirm.rescheduled", { when, from: s?.previousStart ? format(s.previousStart) : "" })
        : answer === "cancelled"
          ? t("web.agenda.confirm.cancelled", { when })
          : sentNow
            ? s?.sentChannel === "email"
              ? t("web.agenda.confirm.sentEmail", { when: sentWhen })
              : t("web.agenda.confirm.sent", { when: sentWhen })
            : t("web.agenda.confirm.none");
  // The patient's mobile with the country's code, digits only (E5e); none, no WhatsApp button.
  const dial = (COUNTRY_DIAL[event.country ?? HOME_COUNTRY] ?? "").replace(/\D/g, "");
  const phone = event.phone && dial ? `${dial}${event.phone.replace(/\D/g, "")}` : "";
  // E7c2: the e-mail kept on the appointment; once sent for this start, the button goes.
  const mailable = !!event.email && !!s && s.mailedStart !== event.start;
  const mail = async () => {
    setBusy("mail");
    try {
      qc.setQueryData(key, await api<ConfirmLinkStatus>("/google/events/link/mail", { method: "POST", body: { calendarId: event.calendarId, eventId: event.id } }));
      toast(t("web.agenda.confirm.mailed", { name: event.title.replace(/^\s*dra?\.?\s+/i, "").trim().split(/\s+/)[0] ?? "" }));
    } catch (failure) {
      toast(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };
  const link = async (what: "copy" | "see" | "whatsapp") => {
    setBusy(what);
    // A tab opened now, before the wait: a browser blocks one opened after it.
    const tab = what === "copy" ? null : window.open("", "_blank");
    try {
      const made = await api<ConfirmLinkMade>("/google/events/link", { method: "POST", body: { calendarId: event.calendarId, eventId: event.id } });
      if (tab) {
        tab.opener = null;
        tab.location.href = what === "see" ? made.url : `https://wa.me/${phone}?text=${encodeURIComponent(made.message)}`;
        // Opened with the message: counted as sent, so the automatic send (E7c3) skips it. A record that
        // fails leaves the tab with the message open (the owner may already be sending it) and says so.
        if (what === "whatsapp") {
          await api("/google/events/link/sent", { method: "POST", body: { calendarId: event.calendarId, eventId: event.id, channel: "whatsapp" } }).catch((failure: unknown) => toast(errorMessage(failure)));
        }
      } else {
        await navigator.clipboard.writeText(made.message);
        toast(t("web.agenda.confirm.messageCopied"));
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
      {!cancelled && !expired && answer === "confirmed" && <p className="text-sm text-fg-muted">{t("web.agenda.confirm.noNeed")}</p>}
      {!cancelled && !expired && answer !== "cancelled" && answer !== "confirmed" && (
        <>
          <div className="flex flex-wrap gap-2">
            {phone && (
              <Button variant="secondary" loading={busy === "whatsapp"} disabled={busy !== null} onClick={() => void link("whatsapp")}>
                <MessageCircleMore className="h-4 w-4" aria-hidden />
                {sentNow ? t("web.agenda.confirm.again") : t("web.agenda.confirm.whatsapp")}
              </Button>
            )}
            {mailable && (
              <Button variant="ghost" loading={busy === "mail"} disabled={busy !== null} onClick={() => void mail()}>
                <Mail className="h-4 w-4" aria-hidden />
                {t("web.agenda.confirm.mail")}
              </Button>
            )}
            <Button variant="ghost" loading={busy === "copy"} disabled={busy !== null} onClick={() => void link("copy")}>
              <Copy className="h-4 w-4" aria-hidden />
              {t("web.agenda.confirm.copyMessage")}
            </Button>
            <Button variant="ghost" loading={busy === "see"} disabled={busy !== null} onClick={() => void link("see")}>
              {t("web.agenda.confirm.see")}
            </Button>
          </div>
          <p className="text-sm text-fg-muted">
            {phone ? t("web.agenda.confirm.hintPhone") : t("web.agenda.confirm.hintNoPhone")}{" "}
            <Link to="/configuracoes/consultorio" className="-my-3 inline-block min-h-11 py-3 font-medium text-accent-text underline underline-offset-2">
              {t("web.agenda.confirm.editMessage")}
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
