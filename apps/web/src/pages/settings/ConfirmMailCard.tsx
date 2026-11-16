import {
  CONFIRM_MAIL_BODY_VARS,
  CONFIRM_MAIL_LIMITS,
  CONFIRM_MAIL_SUBJECT_VARS,
  type Clinic,
  type ConfirmMail,
  type ConfirmMailField,
  type ConfirmMailProblem,
  type ConfirmMessageVar,
  confirmMailProblem,
  fillConfirmMail,
} from "@zuri/shared";
import { Fragment, type FormEvent, type RefObject, useId, useRef, useState } from "react";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, cn, fieldClass } from "../../components/ui.tsx";
import { useSettingsMutation } from "../../hooks/settings.ts";
import { errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

type T = ReturnType<typeof useI18n>["t"];

/** What each variable is, on its button. {link} has none: the link is the button. */
const VAR_HINT = {
  nome: "web.mail.confirm.var.nome",
  tipo: "web.mail.confirm.var.tipo",
  dia: "web.mail.confirm.var.dia",
  hora: "web.mail.confirm.var.hora",
  local: "web.mail.confirm.var.local",
  prazo: "web.mail.confirm.var.prazo",
  consultorio: "web.mail.confirm.var.consultorio",
  whatsapp: "web.mail.confirm.var.whatsapp",
} as const satisfies Record<Exclude<ConfirmMessageVar, "link">, string>;

/** "(41) 3333-0000": the team's WhatsApp as the e-mail shows it (the same as Configurações › Consultório). */
function phoneText(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return digits;
  const cut = digits.length === 11 ? 7 : 6;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, cut)}-${digits.slice(cut)}`;
}

/**
 * The WhatsApp message as an e-mail's text (protótipo waToMail): no bold asterisks, no line with the
 * link (it is the button), "the same link" becomes "the same button".
 */
function whatsappToMail(text: string): string {
  const mail = text
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/[^\n]*link:[ \t]*\n+(?=[^\n]*\{link\})/g, "")
    .replace(/[^\n]*\{link\}[^\n]*\n?/g, "")
    .replace(/pelo mesmo link/g, "pelo mesmo botão")
    .replace(/the same link/g, "the same button")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [...mail].slice(0, CONFIRM_MAIL_LIMITS.body).join("");
}

/**
 * "E-mail de confirmação de consulta" of Integrações › E-mail para pacientes (E7c2, protótipo
 * mailTplSec): the subject, the text and the button, with a preview built of text nodes. The link is
 * always the button, never loose in the text.
 */
export function ConfirmMailCard({ stored, whatsapp, clinic, sender }: { stored: ConfirmMail; whatsapp: string; clinic: Clinic; sender: string }) {
  const { t, locale } = useI18n();
  const save = useSettingsMutation();
  const toast = useToast();
  const id = useId();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLInputElement>(null);
  const fallback: ConfirmMail = { subject: t("confirm.mail.subject"), body: t("confirm.mail.body"), button: t("confirm.mail.button") };
  const [draft, setDraft] = useState<ConfirmMail>(() => ({
    subject: stored.subject || fallback.subject,
    body: stored.body || fallback.body,
    button: stored.button || fallback.button,
  }));
  const [shown, setShown] = useState(false);
  // A field equal to its default is kept as "": back to the default follows a new version of it.
  const value: ConfirmMail = {
    subject: draft.subject === fallback.subject ? "" : draft.subject.normalize("NFC"),
    body: draft.body === fallback.body ? "" : draft.body.normalize("NFC"),
    button: draft.button === fallback.button ? "" : draft.button.normalize("NFC"),
  };
  // A field left blank is an error on the screen, not the default in disguise (CA-E2).
  const blank = (["subject", "body", "button"] as const).find((field) => draft[field].trim() === "");
  const problem: ConfirmMailProblem | null = blank ? { field: blank, problem: "empty" } : confirmMailProblem(value);
  const unchanged = value.subject === stored.subject && value.body === stored.body && value.button === stored.button;
  const isDefault = draft.subject === fallback.subject && draft.body === fallback.body && draft.button === fallback.button;
  const errorOf = (field: ConfirmMailField) => (shown && problem?.field === field ? problemText(problem, t) : "");
  const refs: Record<ConfirmMailField, RefObject<HTMLInputElement | HTMLTextAreaElement | null>> = { subject: subjectRef, body: bodyRef, button: buttonRef };

  const change = (field: ConfirmMailField, next: string) => {
    if (save.isError) save.reset();
    setDraft((current) => ({ ...current, [field]: next }));
  };
  const insert = (field: "subject" | "body", name: ConfirmMessageVar) => {
    const element = refs[field].current;
    const text = draft[field];
    const token = `{${name}}`;
    const from = element?.selectionStart ?? text.length;
    const to = element?.selectionEnd ?? text.length;
    change(field, text.slice(0, from) + token + text.slice(to));
    // After React writes the value: the caret right after the variable, the field still focused.
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(from + token.length, from + token.length);
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShown(true);
    if (problem) {
      refs[problem.field].current?.focus();
      return;
    }
    if (unchanged) return;
    save.mutate({ confirmMail: value }, { onSuccess: () => toast(t("web.mail.confirm.saved")) });
  };

  const count = new Intl.NumberFormat(locale);
  // As clinicLocation: "Rua, número, Cidade"; without the street, nothing.
  const place = clinic.address ? [clinic.address, clinic.city].filter(Boolean).join(", ") : "";
  const example = {
    nome: t("web.mail.confirm.example.name"),
    tipo: t("web.mail.confirm.example.type"),
    dia: t("web.mail.confirm.example.day"),
    hora: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(Date.UTC(2026, 0, 1, 14)),
    local: place ? t("web.mail.confirm.example.address", { place }) : "",
    link: "",
    prazo: t("web.mail.confirm.example.deadline"),
    consultorio: clinic.name,
    whatsapp: phoneText(clinic.whatsapp),
  };
  const chips = (field: "subject" | "body", names: readonly Exclude<ConfirmMessageVar, "link">[], legend: string) => (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{legend}</legend>
      {names.map((name) => (
        <button
          key={name}
          type="button"
          title={t(VAR_HINT[name])}
          onClick={() => insert(field, name)}
          className="min-h-11 rounded-full border border-border bg-surface px-3 font-mono text-sm text-fg hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {`{${name}}`}
          <span className="sr-only">{`: ${t(VAR_HINT[name])}`}</span>
        </button>
      ))}
    </fieldset>
  );
  const fieldError = (field: ConfirmMailField) => (
    <span id={`${id}-${field}-error`} role="status" className="block text-sm text-danger">
      {errorOf(field)}
    </span>
  );

  return (
    <Card title={t("web.mail.confirm.title")} description={t("web.mail.confirm.description")}>
      <form onSubmit={submit} noValidate>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <div className="space-y-2">
              <label htmlFor={`${id}-subject`} className="block text-sm font-medium">
                {t("web.mail.confirm.subject")}
              </label>
              <input
                ref={subjectRef}
                id={`${id}-subject`}
                value={draft.subject}
                maxLength={CONFIRM_MAIL_LIMITS.subject * 2}
                autoComplete="off"
                aria-invalid={errorOf("subject") ? true : undefined}
                aria-describedby={`${id}-subject-error`}
                className={fieldClass}
                onChange={(e) => change("subject", e.target.value)}
              />
              {fieldError("subject")}
              {chips("subject", CONFIRM_MAIL_SUBJECT_VARS, t("web.mail.confirm.subjectVars"))}
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-body`} className="block text-sm font-medium">
                {t("web.mail.confirm.body")}
              </label>
              <textarea
                ref={bodyRef}
                id={`${id}-body`}
                rows={10}
                value={draft.body}
                maxLength={CONFIRM_MAIL_LIMITS.body * 2}
                aria-invalid={errorOf("body") ? true : undefined}
                aria-describedby={`${id}-count ${id}-body-error`}
                className={cn(fieldClass, "min-h-56 py-2 leading-6")}
                onChange={(e) => change("body", e.target.value)}
              />
              <p className="flex flex-wrap justify-between gap-2 text-xs">
                <span id={`${id}-count`} className="tabular-nums text-fg-muted">
                  {t("web.mail.confirm.count", { n: count.format([...draft.body.normalize("NFC")].length), max: count.format(CONFIRM_MAIL_LIMITS.body) })}
                </span>
              </p>
              {fieldError("body")}
              {chips("body", CONFIRM_MAIL_BODY_VARS, t("web.mail.confirm.bodyVars"))}
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-button`} className="block text-sm font-medium">
                {t("web.mail.confirm.button")}
              </label>
              <input
                ref={buttonRef}
                id={`${id}-button`}
                value={draft.button}
                maxLength={CONFIRM_MAIL_LIMITS.button * 2}
                autoComplete="off"
                aria-invalid={errorOf("button") ? true : undefined}
                aria-describedby={`${id}-button-hint ${id}-button-error`}
                className={fieldClass}
                onChange={(e) => change("button", e.target.value)}
              />
              <p id={`${id}-button-hint`} className="text-xs leading-5 text-fg-muted">
                {t("web.mail.confirm.buttonHint")}
              </p>
              {fieldError("button")}
            </div>
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-medium">{t("web.mail.confirm.preview", { name: t("web.mail.confirm.example.name") })}</p>
            <div className="space-y-2 break-words rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                <span className="text-fg-muted">{t("web.mail.confirm.from")}</span>
                <b>{sender}</b>
              </p>
              <p className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                <span className="text-fg-muted">{t("web.mail.confirm.subject")}</span>
                <b>{fillConfirmMail(draft.subject, example)}</b>
              </p>
              <div className="space-y-3 border-t border-border pt-3 leading-6">
                <p className="whitespace-pre-wrap">{fillConfirmMail(draft.body, example)}</p>
                <span className="inline-block rounded-lg bg-accent px-4 py-2 font-semibold text-accent-fg">{draft.button}</span>
                <p className="text-xs leading-5 text-fg-muted">
                  {[clinic.name, place].filter(Boolean).map((part, index) => (
                    <Fragment key={part}>
                      {index > 0 && " · "}
                      {part}
                    </Fragment>
                  ))}
                  {(clinic.name || place) && <br />}
                  {t("confirm.mail.footer")}
                </p>
              </div>
            </div>
            <p className="text-xs leading-5 text-fg-muted">{t("web.mail.confirm.previewHint")}</p>
          </div>
        </div>
        {save.isError && (
          <p role="alert" className="pt-3 text-sm text-danger">
            {errorMessage(save.error)}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-border/60 pt-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={isDefault} onClick={() => setDraft(fallback)}>
              {t("web.mail.confirm.reset")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                // The default WhatsApp message has its e-mail twin: the default text.
                change("body", whatsapp ? whatsappToMail(whatsapp) : fallback.body);
                bodyRef.current?.focus();
                toast(t("web.mail.confirm.copied"));
              }}
            >
              {t("web.mail.confirm.copyWhatsapp")}
            </Button>
          </div>
          <Button type="submit" loading={save.isPending} disabled={unchanged}>
            {t("web.mail.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function problemText(problem: ConfirmMailProblem, t: T): string {
  const { field } = problem;
  switch (problem.problem) {
    case "empty":
      return field === "subject" ? t("web.mail.confirm.empty.subject") : field === "body" ? t("web.mail.confirm.empty.body") : t("web.mail.confirm.empty.button", { max: CONFIRM_MAIL_LIMITS.button });
    case "long":
    case "line":
      return field === "subject"
        ? t("web.mail.confirm.long.subject", { max: CONFIRM_MAIL_LIMITS.subject })
        : field === "body"
          ? t("web.mail.confirm.long.body", { max: CONFIRM_MAIL_LIMITS.body })
          : t("web.mail.confirm.empty.button", { max: CONFIRM_MAIL_LIMITS.button });
    case "link":
      return t("web.mail.confirm.link", { link: "{link}" });
    case "address":
      return t("web.mail.confirm.address", { whatsapp: "{whatsapp}" });
    case "control":
      return t("web.mail.confirm.control");
    case "unknown": {
      const vars = problem.vars.map((name) => `{${name}}`).join(", ");
      return field === "subject" ? t("web.mail.confirm.unknown.subject", { vars }) : t("web.mail.confirm.unknown.body", { vars });
    }
  }
}
