import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type AgendaEvent, COUNTRY_DIAL, type ConfirmLinkMade, type ConfirmLinkStatus, CONFIRM_LINK_LIMITS, EVENT_STATUS_COLOR, eventStatus, HOME_COUNTRY, nationalHoliday } from "@zuri/shared";
import { CalendarDays, Copy, Mail, MessageCircleMore } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
import { useToast } from "../../components/Toaster.tsx";
import { Button } from "../../components/ui.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { useLinkedContact } from "./PatientLink.tsx";

/** The owner's day (YYYY-MM-DD) of an instant. */
const dayIn = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(at);

/** The last working day before the appointment's day: the automatic confirmation's day (E7c3a). */
function eveOf(start: string, timeZone: string): string {
  const day = new Date(`${dayIn(new Date(start), timeZone)}T12:00:00Z`);
  do day.setUTCDate(day.getUTCDate() - 1);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6 || nationalHoliday(day.toISOString().slice(0, 10)));
  return day.toISOString().slice(0, 10);
}

/** Whether the automation's run of that day at that hour is still ahead (it sends in the half hour after it). */
function stillAhead(eve: string, hour: string, timeZone: string): boolean {
  const now = new Date();
  const today = dayIn(now, timeZone);
  if (eve !== today) return eve > today;
  const [h, m] = hour.split(":").map(Number) as [number, number];
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(now).split(":").map(Number) as [number, number];
  return parts[0] * 60 + parts[1] < h * 60 + m + 30;
}

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
  const short = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
  const sentWhen = sentNow && s ? short(s.sentAt) : "";
  const when = s?.answeredAt ? short(s.answeredAt) : "";
  // E7c3a: the automation's last message, for this start only (moved, the appointment asks again).
  const auto = s && s.autoStart === event.start ? s.autoState : "";
  // The owner's send and the automation's: the newer one says how it went.
  const byOwner = sentNow && !(auto === "sent" && s && s.autoAt > s.sentAt);
  const format = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
  const line =
    answer === "confirmed"
      ? t("web.agenda.confirm.confirmed", { when })
      : answer === "rescheduled"
        ? t("web.agenda.confirm.rescheduled", { when, from: s?.previousStart ? format(s.previousStart) : "" })
        : answer === "cancelled"
          ? t("web.agenda.confirm.cancelled", { when })
          : byOwner
            ? s?.sentChannel === "email"
              ? t("web.agenda.confirm.sentEmail", { when: sentWhen })
              : t("web.agenda.confirm.sent", { when: sentWhen })
            : auto === "sent" && s
              ? t("web.agenda.confirm.sentChatwoot", { when: short(s.autoAt) })
              : auto === "queued"
                ? t("web.agenda.confirm.queued")
                : t("web.agenda.confirm.none");
  // E11c: linked to a contact, the messages go where the server says (the contact's mobile and e-mail, or the
  // responsible's); otherwise to the patient's mobile with the country's code, digits only (E5e). None, no button.
  const linked = useLinkedContact(event.contactId);
  const reach = event.contactId ? linked.data?.reach : undefined;
  const dial = (COUNTRY_DIAL[event.country ?? HOME_COUNTRY] ?? "").replace(/\D/g, "");
  const phone = event.contactId ? (reach?.phone ?? "").replace(/\D/g, "") : event.phone && dial ? `${dial}${event.phone.replace(/\D/g, "")}` : "";
  // E7c2: the e-mail kept on the appointment (or the contact's); once sent for this start, the button goes.
  const email = event.contactId ? (reach?.email ?? "") : (event.email ?? "");
  const mailable = !!email && !!s && s.mailedStart !== event.start;
  // The automatic confirmation, while it is on: when it will go, that it won't repeat, or that it didn't go.
  // Only the ones the automation sends to, as the server picks them: Agendado or Reagendado and, in Brazil, a mobile.
  const color = eventStatus(event.colorId ?? "");
  // A contact's number is always a Brazilian mobile (the server's rule).
  const mobile = !!event.contactId || (event.country ?? HOME_COUNTRY) !== HOME_COUNTRY || /^[1-9]{2}9\d{8}$/.test((event.phone ?? "").replace(/\D/g, ""));
  const eve = s?.autoHour && phone && mobile && (color === "scheduled" || color === "rescheduled") ? eveOf(event.start, timeZone) : "";
  const autoHint =
    !s?.autoHour || answer !== "none" || auto === "sent"
      ? ""
      : sentNow
        ? t("web.agenda.confirm.autoSkip")
        : auto === "missed"
          ? t("web.agenda.confirm.autoMissed")
          : !auto && eve && stillAhead(eve, s.autoHour, timeZone)
            ? t("web.agenda.confirm.autoPlanned", { day: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${eve}T12:00:00Z`)), hour: s.autoHour })
            : "";
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
      {!cancelled && !expired && autoHint && <p className="text-sm text-fg-muted">{autoHint}</p>}
      {!cancelled && !expired && answer !== "cancelled" && answer !== "confirmed" && (
        <>
          <div className="flex flex-wrap gap-2">
            {phone && (
              <Button variant="secondary" loading={busy === "whatsapp"} disabled={busy !== null} onClick={() => void link("whatsapp")}>
                <MessageCircleMore className="h-4 w-4" aria-hidden />
                {sentNow || auto === "sent" ? t("web.agenda.confirm.again") : t("web.agenda.confirm.whatsapp")}
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
