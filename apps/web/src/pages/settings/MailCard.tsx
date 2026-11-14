import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MAIL_LIMITS, type MailProblem, type MailStatus, type MailTest, ptBRMail } from "@zuri/shared";
import { Circle, CircleCheck, Mail } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, cn, ErrorNotice, Loading, Notice, PasswordField, SelectField, TextField } from "../../components/ui.tsx";
import { useSettings } from "../../hooks/settings.ts";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";

// The card's texts come with its download (rule P11).
addMessages(ptBRMail);

type T = ReturnType<typeof useI18n>["t"];
type Key = Parameters<T>[0];

export const MAIL_KEY = ["mail"] as const;

const PROBLEM_TEXT: Record<MailProblem, Key> = {
  not_configured: "web.mail.problem.not_configured",
  gmail_scope: "web.mail.problem.gmail_scope",
  google: "web.mail.problem.google",
  auth: "web.mail.problem.auth",
  no_tls: "web.mail.problem.no_tls",
  unreachable: "web.mail.problem.unreachable",
  timeout: "web.mail.problem.timeout",
  refused: "web.mail.problem.refused",
  blocked: "web.mail.problem.blocked",
  daily_limit: "web.mail.problem.daily_limit",
  password: "web.mail.problem.password",
};

/** The field the server named, the message the screen gives for it. */
type Field = "name" | "replyTo" | "host" | "user" | "password" | "from";
const FIELD_TEXT: Record<Field, Key> = {
  name: "web.mail.error.name",
  replyTo: "web.mail.error.replyTo",
  host: "web.mail.error.host",
  user: "web.mail.error.user",
  password: "web.mail.error.password",
  from: "web.mail.error.from",
};
const FIELDS: Record<string, Field> = { name: "name", replyTo: "replyTo", "smtp.host": "host", "smtp.user": "user", "smtp.password": "password", "smtp.from": "from" };

// The server's tidying, so "unchanged" compares with what it stores.
const tidy = (value: string) => value.normalize("NFC").replace(/[ \t]+/g, " ").trim();
const address = (value: string) => value.trim().toLowerCase();

interface Draft {
  mode: "gmail" | "smtp";
  name: string;
  replyTo: string;
  host: string;
  port: 465 | 587;
  user: string;
  from: string;
  password: string;
}

const draftOf = (status: MailStatus): Draft => ({
  mode: status.mode === "smtp" ? "smtp" : "gmail",
  name: status.name,
  replyTo: status.replyTo,
  host: status.smtp?.host ?? "",
  port: status.smtp?.port ?? 465,
  user: status.smtp?.user ?? "",
  from: status.smtp?.from ?? "",
  password: "",
});

/**
 * Configurações › Integrações › E-mail para pacientes (E6c): how e-mail to patients goes out, the
 * owner's Gmail (permission to send only) or another provider's SMTP, and a test to the owner.
 * The password never comes back; only its end, when it is long enough.
 */
export function MailCard() {
  const { t } = useI18n();
  const status = useQuery({ queryKey: MAIL_KEY, queryFn: ({ signal }) => api<MailStatus>("/mail", { signal }) });
  return (
    <Card
      title={t("web.mail.title")}
      description={
        <>
          {t("web.mail.description")} {status.data && t("web.mail.cap", { max: status.data.perDay, count: status.data.sentToday })}
        </>
      }
    >
      {status.isPending ? (
        <Loading />
      ) : status.isError ? (
        <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <MailForm key={JSON.stringify([status.data.mode, status.data.smtp, status.data.name, status.data.replyTo])} status={status.data} />
      )}
    </Card>
  );
}

function MailForm({ status }: { status: MailStatus }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useSettings();
  const [draft, setDraft] = useState<Draft>(() => draftOf(status));
  const [busy, setBusy] = useState<"save" | "test" | "connect" | "off" | null>(null);
  const [error, setError] = useState<{ field: Field | null; text: string } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const fields = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const bind = (field: Field) => (node: HTMLInputElement | null) => {
    fields.current[field] = node;
  };
  // After the message is on screen, so the field is read with it.
  useEffect(() => {
    if (error?.field) fields.current[error.field]?.focus();
  }, [error]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setError(null);
    setResult(null);
    setDraft((before) => ({ ...before, [key]: value }));
  };

  const saved = status.smtp;
  const host = address(draft.host).replace(/\.$/, "");
  const user = address(draft.user);
  const moved = !saved || saved.host !== host || saved.user !== user;
  const unchanged =
    draft.mode === status.mode &&
    tidy(draft.name) === status.name &&
    address(draft.replyTo) === status.replyTo &&
    (draft.mode === "gmail" || (!moved && draft.port === saved?.port && address(draft.from) === saved.from && draft.password === ""));
  const clinic = settings.data?.clinic.name ?? "";
  const senderName = tidy(draft.name) || clinic;
  const sender = draft.mode === "gmail" ? (status.gmail.granted ? status.gmail.account : null) : address(draft.from) || user || null;

  const fail = (failure: unknown) => {
    const fields = failure instanceof ApiError && Array.isArray(failure.details.fields) ? (failure.details.fields as string[]) : [];
    const field = fields.map((name) => FIELDS[name]).find((name): name is Field => name !== undefined) ?? null;
    // The password asked again because the server or the user moved: the message says why (QA-E6c-09).
    const again = field === "password" && saved !== null && moved;
    setError({ field, text: field ? t(again ? "web.mail.error.passwordAgain" : FIELD_TEXT[field]) : errorMessage(failure) });
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) return;
    // The password the server would ask for, asked here before the round trip.
    if (draft.mode === "smtp" && moved && draft.password === "") {
      setError({ field: "password", text: t(saved ? "web.mail.error.passwordAgain" : "web.mail.error.password") });
      return;
    }
    setBusy("save");
    setError(null);
    setResult(null);
    try {
      const body = {
        mode: draft.mode,
        name: draft.name,
        replyTo: draft.replyTo.trim(),
        ...(draft.mode === "smtp"
          ? { smtp: { host: draft.host, port: draft.port, user: draft.user, from: draft.from.trim(), ...(draft.password ? { password: draft.password } : {}) } }
          : {}),
      };
      const next = await api<MailStatus>("/mail", { method: "PUT", body });
      qc.setQueryData(MAIL_KEY, next);
      toast(t("web.mail.saved"));
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(null);
    }
  }

  async function connectGmail() {
    setBusy("connect");
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/mail/gmail/connect", { method: "POST" });
      window.location.assign(url);
    } catch (failure) {
      setError({ field: null, text: errorMessage(failure) });
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("off");
    setError(null);
    try {
      const next = await api<MailStatus>("/mail", { method: "PUT", body: { mode: "off", name: status.name, replyTo: status.replyTo } });
      qc.setQueryData(MAIL_KEY, next);
      toast(t("web.mail.gmail.disconnected"));
    } catch (failure) {
      setError({ field: null, text: errorMessage(failure) });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setError(null);
    setResult(null);
    try {
      const answer = await api<{ test: MailTest; status: MailStatus }>("/mail/test", { method: "POST" });
      qc.setQueryData(MAIL_KEY, answer.status);
      const sent = answer.test;
      setResult(
        sent.ok
          ? { ok: true, text: t(sent.via === "gmail" ? "web.mail.testSent.gmail" : "web.mail.testSent.smtp", { to: sent.to }) }
          : { ok: false, text: t(PROBLEM_TEXT[sent.problem], { max: status.perDay }) },
      );
    } catch (failure) {
      setResult({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(null);
    }
  }

  const fieldError = (field: Field) => (error?.field === field ? { error: error.text } : {});
  const passwordHint = saved && !moved ? (saved.passwordEnd ? t("web.mail.passwordKept", { end: saved.passwordEnd }) : t("web.mail.passwordKeptShort")) : t("web.mail.passwordHint");
  const testable = status.mode !== "off" && unchanged && status.testTo !== "";

  return (
    <form className="space-y-5" onSubmit={(e) => void save(e)} noValidate>
      <section className="space-y-3" aria-labelledby="mail-how">
        <h3 id="mail-how" className="text-sm font-semibold">
          {t("web.mail.how")}
        </h3>
        <fieldset aria-labelledby="mail-how" className="grid gap-2 sm:grid-cols-2">
          {(["gmail", "smtp"] as const).map((mode) => {
            const on = draft.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={on}
                onClick={() => set("mode", mode)}
                className={cn(
                  "grid min-h-11 gap-1 rounded-xl border bg-surface px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  on ? "border-accent ring-1 ring-accent" : "border-border hover:bg-raised",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {on ? <CircleCheck className="h-4 w-4 text-accent-text" aria-hidden /> : <Circle className="h-4 w-4 text-fg-muted" aria-hidden />}
                  {t(mode === "gmail" ? "web.mail.mode.gmail" : "web.mail.mode.smtp")}
                </span>
                <span className="text-xs leading-5 text-fg-muted">{t(mode === "gmail" ? "web.mail.mode.gmailHint" : "web.mail.mode.smtpHint")}</span>
              </button>
            );
          })}
        </fieldset>
        {draft.mode === "gmail" ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              {status.gmail.granted ? (
                <p className="flex items-center gap-2 break-all text-sm font-medium">
                  <CircleCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  {t("web.mail.gmail.connected", { account: status.gmail.account ?? "" })}
                </p>
              ) : (
                <p className="text-sm font-medium">{t("web.mail.gmail.off")}</p>
              )}
              <p className="text-xs leading-5 text-fg-muted">
                {status.gmail.granted ? t("web.mail.gmail.connectedHint") : status.gmail.connected ? t("web.mail.gmail.offHint") : t("web.mail.gmail.needGoogle")}
              </p>
            </div>
            <div className="shrink-0">
              {status.gmail.granted ? (
                status.mode === "gmail" && (
                  <Button variant="ghost" loading={busy === "off"} disabled={busy !== null} onClick={() => void disconnect()}>
                    {t("web.mail.gmail.disconnect")}
                  </Button>
                )
              ) : (
                <Button loading={busy === "connect"} disabled={busy !== null || !status.gmail.connected} onClick={() => void connectGmail()}>
                  {t("web.mail.gmail.connect")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {!status.vault && <Notice tone="warning">{t("web.mail.noVault")}</Notice>}
            <h3 className="text-sm font-semibold">{t("web.mail.server")}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                ref={bind("host")}
                label={t("web.mail.host")}
                value={draft.host}
                placeholder={t("web.mail.hostPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                inputMode="url"
                maxLength={MAIL_LIMITS.host}
                onChange={(e) => set("host", e.target.value)}
                {...fieldError("host")}
              />
              <SelectField label={t("web.mail.port")} value={String(draft.port)} onChange={(e) => set("port", e.target.value === "587" ? 587 : 465)}>
                <option value="465">{t("web.mail.port465")}</option>
                <option value="587">{t("web.mail.port587")}</option>
              </SelectField>
              <TextField
                ref={bind("user")}
                label={t("web.mail.user")}
                hint={t("web.mail.userHint")}
                value={draft.user}
                placeholder={t("web.mail.addressPlaceholder")}
                type="email"
                autoComplete="off"
                spellCheck={false}
                maxLength={MAIL_LIMITS.address}
                onChange={(e) => set("user", e.target.value)}
                {...fieldError("user")}
              />
              <PasswordField
                ref={bind("password")}
                label={t("web.mail.password")}
                hint={passwordHint}
                value={draft.password}
                autoComplete="new-password"
                maxLength={MAIL_LIMITS.password}
                disabled={!status.vault}
                onChange={(e) => set("password", e.target.value)}
                {...fieldError("password")}
              />
              <TextField
                ref={bind("from")}
                label={t("web.mail.from")}
                hint={t("web.mail.fromHint")}
                value={draft.from}
                placeholder={user || t("web.mail.addressPlaceholder")}
                type="email"
                autoComplete="off"
                spellCheck={false}
                maxLength={MAIL_LIMITS.address}
                onChange={(e) => set("from", e.target.value)}
                {...fieldError("from")}
              />
            </div>
            <p className="text-xs leading-5 text-fg-muted">{t("web.mail.tls")}</p>
          </div>
        )}
      </section>
      <section className="space-y-3" aria-labelledby="mail-who">
        <h3 id="mail-who" className="text-sm font-semibold">
          {t("web.mail.who")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            ref={bind("name")}
            label={t("web.mail.name")}
            hint={t("web.mail.nameHint")}
            value={draft.name}
            placeholder={clinic}
            autoComplete="off"
            // The server counts characters, an emoji as one; the field counts code units (QA-E6c-09).
            maxLength={MAIL_LIMITS.name * 2}
            onChange={(e) => set("name", e.target.value)}
            {...fieldError("name")}
          />
          <TextField
            ref={bind("replyTo")}
            label={t("web.mail.replyTo")}
            hint={t("web.mail.replyToHint")}
            value={draft.replyTo}
            placeholder={sender ?? t("web.mail.addressPlaceholder")}
            type="email"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAIL_LIMITS.address}
            onChange={(e) => set("replyTo", e.target.value)}
            {...fieldError("replyTo")}
          />
        </div>
        <p className="flex items-center gap-2 break-all text-sm">
          <Mail className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
          {t("web.mail.fromLine", { name: senderName, address: sender ?? t("web.mail.fromNone") })}
        </p>
      </section>
      {error && !error.field && (
        <p role="alert" className="text-sm text-danger">
          {error.text}
        </p>
      )}
      {result && (
        <div role="status">
          {result.ok ? (
            <Notice tone="success">{result.text}</Notice>
          ) : (
            <Notice tone="warning">{result.text}</Notice>
          )}
        </div>
      )}
      {!testable && status.mode !== "off" && !unchanged && <p className="text-xs leading-5 text-fg-muted">{t("web.mail.testSaveFirst")}</p>}
      {status.testTo === "" && <p className="text-xs leading-5 text-fg-muted">{t("web.mail.testNoOwner")}</p>}
      <div className="flex flex-col-reverse gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" loading={busy === "test"} disabled={busy !== null || !testable} onClick={() => void test()}>
          {t("web.mail.test")}
        </Button>
        <Button type="submit" loading={busy === "save"} disabled={unchanged || busy !== null}>
          {t("web.mail.save")}
        </Button>
      </div>
    </form>
  );
}
