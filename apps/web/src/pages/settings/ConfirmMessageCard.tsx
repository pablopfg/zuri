import { CONFIRM_MESSAGE_MAX, CONFIRM_MESSAGE_VARS, type Clinic, type ConfirmMessageVar, clinicLocation, confirmMessageProblem, fillConfirmMessage } from "@zuri/shared";
import { MessageCircleMore } from "lucide-react";
import { type FormEvent, Fragment, useId, useRef, useState } from "react";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, cn, fieldClass } from "../../components/ui.tsx";
import { useSettingsMutation } from "../../hooks/settings.ts";
import { errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { clinicPhoneMask } from "./ClinicTab.tsx";

/** What each variable is, on its button. */
const VAR_HINT = {
  nome: "web.clinic.message.var.nome",
  tipo: "web.clinic.message.var.tipo",
  dia: "web.clinic.message.var.dia",
  hora: "web.clinic.message.var.hora",
  local: "web.clinic.message.var.local",
  link: "web.clinic.message.var.link",
  prazo: "web.clinic.message.var.prazo",
  consultorio: "web.clinic.message.var.consultorio",
  whatsapp: "web.clinic.message.var.whatsapp",
} as const satisfies Record<ConfirmMessageVar, string>;

/** A token-looking example: the real one is 128 random bits, never shown here. */
const EXAMPLE_TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

/**
 * "Mensagem de confirmação" of Configurações › Consultório (E7c1, protótipo cfgConsultorio): the text
 * with variables the WhatsApp button sends, a live preview as WhatsApp shows it, and the default back.
 */
export function ConfirmMessageCard({ stored, clinic }: { stored: string; clinic: Clinic }) {
  const { t } = useI18n();
  const save = useSettingsMutation();
  const toast = useToast();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const fallback = t("confirm.message.default");
  const [draft, setDraft] = useState(stored || fallback);
  const [shown, setShown] = useState(false);
  // The default is kept as "": back to the default follows a new version of it.
  const value = draft === fallback ? "" : draft;
  const problem = confirmMessageProblem(draft.normalize("NFC"));
  const unchanged = value === stored;
  const error = shown && problem ? problemText(problem, t) : "";

  const change = (next: string) => {
    if (save.isError) save.reset();
    setDraft(next);
  };
  const insert = (name: ConfirmMessageVar) => {
    const field = area.current;
    const token = `{${name}}`;
    const from = field?.selectionStart ?? draft.length;
    const to = field?.selectionEnd ?? draft.length;
    change(draft.slice(0, from) + token + draft.slice(to));
    // After React writes the value: the caret right after the variable, the field still focused.
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(from + token.length, from + token.length);
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShown(true);
    if (problem || unchanged) {
      if (problem) area.current?.focus();
      return;
    }
    save.mutate({ confirmMessage: value }, { onSuccess: () => toast(t("web.clinic.message.saved")) });
  };

  const place = clinicLocation(clinic);
  const example = fillConfirmMessage(draft, {
    nome: t("web.clinic.example.name"),
    tipo: t("web.clinic.example.type"),
    dia: t("web.clinic.example.day"),
    hora: "14:00",
    local: place ? t("confirm.message.address", { place }) : "",
    link: `${window.location.origin}/c/${EXAMPLE_TOKEN}`,
    prazo: t("web.clinic.example.deadline"),
    consultorio: clinic.name,
    whatsapp: clinicPhoneMask(clinic.whatsapp),
  });

  return (
    <Card title={t("web.clinic.message.title")} description={t("web.clinic.message.description")}>
      <form onSubmit={submit} noValidate>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <label htmlFor={`${id}-text`} className="block text-sm font-medium">
              {t("web.clinic.message.label")}
            </label>
            <textarea
              ref={area}
              id={`${id}-text`}
              rows={9}
              value={draft}
              maxLength={CONFIRM_MESSAGE_MAX * 2}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-count ${id}-error`}
              className={cn(fieldClass, "min-h-56 py-2 leading-6")}
              onChange={(e) => change(e.target.value)}
            />
            <p className="flex flex-wrap justify-between gap-2 text-xs">
              <span id={`${id}-count`} className="tabular-nums text-fg-muted">
                {t("web.clinic.message.count", { n: [...draft.normalize("NFC")].length, max: CONFIRM_MESSAGE_MAX })}
              </span>
              <span id={`${id}-error`} role="status" className="text-sm text-danger">
                {error}
              </span>
            </p>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">{t("web.clinic.message.vars")}</legend>
              {CONFIRM_MESSAGE_VARS.map((name) => (
                <button
                  key={name}
                  type="button"
                  title={t(VAR_HINT[name])}
                  onClick={() => insert(name)}
                  className="min-h-11 rounded-full border border-border bg-surface px-3 font-mono text-sm text-fg hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {`{${name}}`}
                  <span className="sr-only">{`: ${t(VAR_HINT[name])}`}</span>
                </button>
              ))}
            </fieldset>
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-medium">{t("web.clinic.message.preview", { name: t("web.clinic.example.name") })}</p>
            <div className="rounded-2xl bg-raised p-3">
              <p className="ml-auto max-w-[92%] whitespace-pre-wrap break-words rounded-xl rounded-tr-sm bg-success-soft px-3 py-2 text-sm leading-6 text-fg shadow-sm">
                <WhatsAppText text={example} />
              </p>
            </div>
            <p className="flex items-start gap-1.5 text-xs leading-5 text-fg-muted">
              <MessageCircleMore className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("web.clinic.message.previewHint")}
            </p>
          </div>
        </div>
        {save.isError && (
          <p role="alert" className="pt-3 text-sm text-danger">
            {errorMessage(save.error)}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-border/60 pt-4">
          <Button type="button" variant="ghost" disabled={draft === fallback} onClick={() => change(fallback)}>
            {t("web.clinic.message.reset")}
          </Button>
          <Button type="submit" loading={save.isPending} disabled={unchanged}>
            {t("web.clinic.message.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

type T = ReturnType<typeof useI18n>["t"];

function problemText(problem: NonNullable<ReturnType<typeof confirmMessageProblem>>, t: T): string {
  if (problem.problem === "empty") return t("web.clinic.message.empty");
  if (problem.problem === "long") return t("web.clinic.message.long", { max: CONFIRM_MESSAGE_MAX });
  if (problem.problem === "link") return t("web.clinic.message.needsLink", { link: "{link}" });
  if (problem.problem === "address") return t("web.clinic.message.address", { link: "{link}", whatsapp: "{whatsapp}" });
  if (problem.problem === "control") return t("web.clinic.message.control");
  return t("web.clinic.message.unknown", { vars: problem.vars.map((name) => `{${name}}`).join(", ") });
}

/** WhatsApp's bold: *text* on one line. Only text nodes and <b>: nothing the owner writes becomes markup. */
function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one text, in order, never reordered.
        part.length > 2 && part.startsWith("*") && part.endsWith("*") ? <b key={index}>{part.slice(1, -1)}</b> : <Fragment key={index}>{part}</Fragment>,
      )}
    </>
  );
}
