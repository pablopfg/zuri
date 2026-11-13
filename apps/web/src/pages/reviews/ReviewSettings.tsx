import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type MessageKey, REVIEW_LIMITS, type ReviewLevel, type ReviewLocation, type ReviewsStatus, type ReviewTone } from "@zuri/shared";
import { CircleCheck, CircleDashed, Hourglass, PenLine, PlugZap, Plus, RefreshCw, SendHorizontal, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, buttonClass, Dialog, ErrorNotice, Loading, Notice, SelectField, TextAreaField, TextField } from "../../components/ui.tsx";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { guardTexts, REVIEW_PROBLEM_TEXT, REVIEWS_BUT_STATUS, REVIEWS_STATUS_KEY } from "../../lib/reviews.ts";
import { RequestSettings } from "./Requests.tsx";

const DEFAULTS: MessageKey[] = ["web.reviews.card.template.default1", "web.reviews.card.template.default2", "web.reviews.card.template.default3"];
const ACCESS_STEPS: MessageKey[] = ["web.reviews.access.1", "web.reviews.access.2", "web.reviews.access.3", "web.reviews.access.4", "web.reviews.access.5", "web.reviews.access.6"];

/** Opens Google's page to add the Business Profile to the calendar's grant. Only Google's own page. */
async function goToGoogle(): Promise<void> {
  const { url } = await api<{ url: string }>("/reviews/connect", { method: "POST" });
  if (new URL(url).origin !== "https://accounts.google.com") throw new Error("unexpected");
  window.location.assign(url);
}

/** The signature at the end of a template, as the server keeps it: shown without it, since it goes in by itself. */
function withoutSignature(text: string, signature: string): string {
  const sign = signature.trim();
  return sign && text.endsWith(sign) ? text.slice(0, -sign.length).trim() : text;
}

interface Settings {
  locations: string[];
  signature: string;
  tone: ReviewTone;
  templates: string[];
  banned: string[];
  level: ReviewLevel;
}

/**
 * What the server holds, in the shape its one settings route takes. Each part
 * of this screen changes its own fields and sends the rest back as it is; a
 * first save starts from the three suggested templates and "drafts to approve".
 */
function current(status: ReviewsStatus, t: (key: MessageKey) => string): Settings {
  const { pattern } = status;
  return {
    locations: status.locations.filter((location) => location.selected).map((location) => location.id),
    signature: pattern.signature,
    tone: pattern.tone,
    templates: pattern.templates.length ? pattern.templates.map((text) => withoutSignature(text, pattern.signature)) : DEFAULTS.map((key) => t(key)),
    banned: pattern.banned,
    level: status.enabled ? status.level : "approve",
  };
}

/** Saves the settings (the server asks for the password typed recently) and keeps the answer as the new state. */
function useSave() {
  const qc = useQueryClient();
  return async (body: Settings) => {
    qc.setQueryData(REVIEWS_STATUS_KEY, await api<ReviewsStatus>("/reviews/settings", { method: "PATCH", body }));
    void qc.invalidateQueries(REVIEWS_BUT_STATUS);
  };
}

/**
 * Avaliações › Ajustes: the connection with the Business Profile, step by
 * step, and how Zuri replies. There is no key to paste: the permission is
 * given at Google, on the same account as the calendar and the contacts.
 */
export function ReviewSettings({ status, sub }: { status: ReviewsStatus; sub: "connection" | "reply" | "requests" }) {
  const { t } = useI18n();
  return (
    <div className="max-w-3xl space-y-4">
      <nav aria-label={t("web.reviews.set.parts")} className="zuri-seg">
        <Link to="/avaliacoes/ajustes" aria-current={sub === "connection" ? "page" : undefined}>
          <PlugZap aria-hidden />
          {t("web.reviews.set.connection")}
        </Link>
        <Link to="/avaliacoes/ajustes/responder" aria-current={sub === "reply" ? "page" : undefined}>
          <PenLine aria-hidden />
          {t("web.reviews.set.reply")}
        </Link>
        <Link to="/avaliacoes/ajustes/pedidos" aria-current={sub === "requests" ? "page" : undefined}>
          <SendHorizontal aria-hidden />
          {t("web.reviews.set.requests")}
        </Link>
      </nav>
      {sub === "connection" ? (
        <Connection status={status} />
      ) : sub === "requests" ? (
        status.enabled ? (
          <RequestSettings />
        ) : (
          <Notice>
            {t("web.reviews.reqset.off")}{" "}
            <Link to="/avaliacoes/ajustes" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
              {t("web.reviews.set.connection")}
            </Link>
          </Notice>
        )
      ) : status.enabled ? (
        <ReplyForm key={JSON.stringify(status.pattern) + status.level} status={status} />
      ) : (
        <Notice>
          {t("web.reviews.set.reply.off")}{" "}
          <Link to="/avaliacoes/ajustes" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
            {t("web.reviews.set.connection")}
          </Link>
        </Notice>
      )}
    </div>
  );
}

type StepState = "ok" | "waiting" | "missing";
const STEP_TEXT = { ok: "web.reviews.step.ok", waiting: "web.reviews.step.waiting", missing: "web.reviews.step.missing" } as const;

function Step({ state, title, children, action }: { state: StepState; title: string; children: ReactNode; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3" data-state={state}>
      <span className="zuri-review-step" data-state={state}>
        {state === "ok" ? <CircleCheck aria-hidden /> : state === "waiting" ? <Hourglass aria-hidden /> : <CircleDashed aria-hidden />}
        <span className="sr-only">{t(STEP_TEXT[state])}</span>
      </span>
      <div className="min-w-40 flex-1 basis-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="break-words text-sm leading-6 text-fg-muted">{children}</p>
      </div>
      {action}
    </li>
  );
}

function Connection({ status }: { status: ReviewsStatus }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const save = useSave();
  const [busy, setBusy] = useState<"connect" | "disable" | "publish" | null>(null);
  const [dialog, setDialog] = useState<"profiles" | "disable" | null>(null);
  const publishId = useId();
  const chosen = status.locations.filter((location) => location.selected);
  // "Granted" only while the last check really reached the profile.
  const reached = status.enabled && !!status.lastCheckAt && !status.problem && status.lastResult !== "failed";

  const connect = async () => {
    setBusy("connect");
    try {
      await goToGoogle();
    } catch (failure) {
      toast(errorMessage(failure));
      setBusy(null);
    }
  };

  const disable = async () => {
    setBusy("disable");
    try {
      qc.setQueryData(REVIEWS_STATUS_KEY, await api<ReviewsStatus>("/reviews", { method: "DELETE" }));
      void qc.invalidateQueries(REVIEWS_BUT_STATUS);
      setDialog(null);
      toast(t("web.reviews.card.disabled"));
    } catch (failure) {
      toast(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };

  const publish = async (on: boolean) => {
    setBusy("publish");
    try {
      await save({ ...current(status, t), level: on ? "approve" : "off" });
      toast(t(on ? "web.reviews.publish.on" : "web.reviews.publish.off"));
    } catch (failure) {
      toast(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };

  const ghost = buttonClass("ghost", "shrink-0");
  return (
    <>
      <section className="zuri-review-card" aria-labelledby={`${publishId}-title`}>
        <h2 id={`${publishId}-title`} className="text-base font-semibold">
          {t("web.reviews.conn.title")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{t("web.reviews.conn.body")}</p>
        <ol className="mt-2 divide-y divide-border">
          <Step
            state={status.connected ? "ok" : "missing"}
            title={t("web.reviews.conn.account")}
            action={
              <Link to="/configuracoes/integracoes" className={ghost}>
                {t(status.connected ? "web.reviews.conn.account.see" : "web.reviews.conn.account.connect")}
              </Link>
            }
          >
            {t(status.connected ? "web.reviews.conn.account.ok" : "web.reviews.conn.account.missing")}
          </Step>
          <Step
            state={status.granted ? "ok" : "missing"}
            title={t("web.reviews.conn.grant")}
            action={
              status.connected && (
                <Button variant={status.granted ? "ghost" : "primary"} className="shrink-0" loading={busy === "connect"} onClick={() => void connect()}>
                  {t(status.granted ? "web.reviews.conn.grant.again" : "web.reviews.conn.grant.give")}
                </Button>
              )
            }
          >
            {t(status.granted ? "web.reviews.conn.grant.ok" : "web.reviews.conn.grant.missing")}
          </Step>
          <Step state={status.problem ? "waiting" : reached ? "ok" : "missing"} title={t("web.reviews.conn.access")}>
            {status.problem ? t(REVIEW_PROBLEM_TEXT[status.problem]) : t(reached ? "web.reviews.conn.access.ok" : status.lastResult === "failed" ? "web.reviews.last.failed" : "web.reviews.conn.access.unknown")}
          </Step>
          <Step
            state={chosen.length > 0 ? "ok" : "missing"}
            title={t("web.reviews.conn.profile")}
            action={
              status.granted && (
                <Button variant={chosen.length > 0 ? "ghost" : "primary"} className="shrink-0" aria-haspopup="dialog" onClick={() => setDialog("profiles")}>
                  {t(chosen.length > 0 ? "web.reviews.conn.profile.change" : "web.reviews.conn.profile.choose")}
                </Button>
              )
            }
          >
            {chosen.length > 0
              ? t("web.reviews.conn.profile.ok", { nomes: chosen.map((location) => location.title).join(" · "), max: REVIEW_LIMITS.maxLocations })
              : t("web.reviews.conn.profile.missing", { max: REVIEW_LIMITS.maxLocations })}
          </Step>
        </ol>
        <details className="mt-2 text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium underline-offset-2 hover:underline">{t("web.reviews.access.title")}</summary>
          <ol className="list-decimal space-y-1 pl-5 leading-6 text-fg-muted">
            {ACCESS_STEPS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
          <p className="mt-2 leading-6 text-fg-muted">{t("web.reviews.access.workspace")}</p>
        </details>
      </section>

      {status.enabled && (
        <section className="zuri-review-card" aria-labelledby={`${publishId}-publish`}>
          <h2 id={`${publishId}-publish`} className="text-base font-semibold">
            {t("web.reviews.publish.title")}
          </h2>
          <div className="mt-2">
            <Switch label={t("web.reviews.publish.switch")} checked={status.level !== "off"} busy={busy === "publish"} describedBy={`${publishId}-hint`} onChange={(on) => void publish(on)} />
            <p id={`${publishId}-hint`} className="text-sm leading-6 text-fg-muted">
              {t("web.reviews.publish.hint")}
            </p>
          </div>
          <p className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm text-fg-muted">
            {t("web.reviews.publish.how")}
            <Link to="/avaliacoes/ajustes/responder" className={buttonClass("secondary", "shrink-0")}>
              {t("web.reviews.set.reply")}
            </Link>
          </p>
        </section>
      )}

      <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-fg-muted">
        <li>{t("web.reviews.conn.note.secret")}</li>
        <li>{t("web.reviews.conn.note.checks")}</li>
      </ul>
      {status.enabled && (
        <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
          {t("web.reviews.conn.note.off")}
          <Button variant="danger" aria-haspopup="dialog" onClick={() => setDialog("disable")}>
            {t("web.reviews.card.disable")}
          </Button>
        </p>
      )}

      <Dialog open={dialog === "profiles"} onClose={() => setDialog(null)} title={t("web.reviews.card.locations")}>
        {dialog === "profiles" && <Profiles status={status} onSaved={() => setDialog(null)} />}
      </Dialog>
      <Dialog open={dialog === "disable"} onClose={() => setDialog(null)} title={t("web.reviews.card.disableTitle")}>
        <p className="text-sm leading-6 text-fg-muted">{t("web.reviews.card.disableBody")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialog(null)}>
            {t("web.cancel")}
          </Button>
          <Button variant="danger" loading={busy === "disable"} onClick={() => void disable()}>
            {t("web.reviews.card.disable")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** Which profiles Zuri reads, read from Google when the list opens. The first save also asks for the signature every reply ends with. */
function Profiles({ status, onSaved }: { status: ReviewsStatus; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const save = useSave();
  const locations = useQuery({
    // Outside REVIEWS_KEY: a change the live channel brings must not ask Google again.
    queryKey: ["reviews-locations"],
    queryFn: ({ signal }) => api<{ locations: ReviewLocation[] }>("/reviews/locations", { signal }).then((r) => r.locations),
    // Google is asked once per visit; "Look again" asks again.
    staleTime: Number.POSITIVE_INFINITY,
  });
  const before = current(status, t);
  const [chosen, setChosen] = useState<string[]>(before.locations);
  const [signature, setSignature] = useState(before.signature);
  const [saving, setSaving] = useState(false);
  // A first visit has nothing chosen: the only profile, when there is one, comes ticked.
  useEffect(() => {
    if (chosen.length === 0 && locations.data?.length === 1) setChosen([locations.data[0]?.id ?? ""]);
  }, [locations.data, chosen.length]);

  const toggle = (id: string, on: boolean) => setChosen((list) => (on ? [...list, id].slice(0, REVIEW_LIMITS.maxLocations) : list.filter((item) => item !== id)));
  const options = locations.data ?? status.locations;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await save({ ...before, locations: chosen, signature: signature.trim() });
      toast(t("web.reviews.card.saved"));
      onSaved();
    } catch (failure) {
      toast(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)}>
      <p className="text-sm leading-6 text-fg-muted">{t("web.reviews.card.locations.hint", { max: REVIEW_LIMITS.maxLocations })}</p>
      {locations.isPending && !options.length ? (
        <Loading rows={2} />
      ) : locations.isError && !options.length ? (
        <ErrorNotice error={locations.error} onRetry={() => void locations.refetch()} />
      ) : options.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("web.reviews.card.locations.empty")}</p>
      ) : (
        <ul className="max-h-[40dvh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {options.map((location) => {
            const on = chosen.includes(location.id);
            return (
              <li key={location.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                    checked={on}
                    disabled={!on && chosen.length >= REVIEW_LIMITS.maxLocations}
                    onChange={(e) => toggle(location.id, e.target.checked)}
                  />
                  <span className="min-w-0 break-words">{location.title}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <Button type="button" variant="ghost" loading={locations.isFetching} onClick={() => void locations.refetch()}>
        <RefreshCw className="h-4 w-4" aria-hidden />
        {t("web.reviews.card.locations.reload")}
      </Button>
      {/* Every reply ends with it, so turning the reviews on cannot go without one; once on, it lives in "Como responder". */}
      {!status.enabled && (
        <TextField
          label={t("web.reviews.card.signature")}
          hint={t("web.reviews.card.signature.hint")}
          value={signature}
          required
          minLength={REVIEW_LIMITS.signatureMin}
          maxLength={REVIEW_LIMITS.signatureMax}
          onChange={(e) => setSignature(e.target.value)}
        />
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={saving} disabled={chosen.length === 0}>
          {t("web.reviews.card.locations.save")}
        </Button>
      </div>
    </form>
  );
}

/** How Zuri replies: the tone, the signature, what it does with a review, the thank-you templates and the words that never go in. Saved together. */
function ReplyForm({ status }: { status: ReviewsStatus }) {
  const { t } = useI18n();
  const toast = useToast();
  const save = useSave();
  const before = current(status, t);
  const [signature, setSignature] = useState(before.signature);
  const [tone, setTone] = useState<ReviewTone>(before.tone);
  const [templates, setTemplates] = useState<string[]>(before.templates);
  const [banned, setBanned] = useState(before.banned.join(", "));
  const [level, setLevel] = useState<ReviewLevel>(before.level);
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const unlocked = status.level === "auto" || status.trial.approved >= status.trial.needed;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFailures([]);
    try {
      await save({
        locations: before.locations,
        signature: signature.trim(),
        tone,
        templates: templates.map((text) => text.trim()).filter(Boolean),
        banned: banned
          .split(",")
          .map((word) => word.trim())
          .filter(Boolean),
        level,
      });
      toast(t("web.reviews.card.saved"));
    } catch (failure) {
      const list = failure instanceof ApiError && Array.isArray(failure.details.templates) ? (failure.details.templates as { index: number; codes: unknown }[]) : [];
      if (list.length) setFailures(list.map((item) => t("web.reviews.card.template.failed", { n: item.index + 1, reasons: guardTexts(item.codes, t).join("; ") })));
      else toast(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)}>
      <fieldset className="zuri-review-card space-y-3">
        <legend className="float-left w-full text-base font-semibold">{t("web.reviews.how.title")}</legend>
        <p className="clear-both text-sm leading-6 text-fg-muted">{t("web.reviews.how.body")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label={t("web.reviews.card.tone")} value={tone} onChange={(e) => setTone(e.target.value as ReviewTone)}>
            <option value="close">{t("web.reviews.card.tone.close")}</option>
            <option value="formal">{t("web.reviews.card.tone.formal")}</option>
          </SelectField>
          <TextField
            label={t("web.reviews.card.signature")}
            hint={t("web.reviews.card.signature.hint")}
            value={signature}
            required
            minLength={REVIEW_LIMITS.signatureMin}
            maxLength={REVIEW_LIMITS.signatureMax}
            onChange={(e) => setSignature(e.target.value)}
          />
        </div>
        <p className="text-sm leading-6 text-fg-muted">
          {t("web.reviews.how.agent")}{" "}
          <Link to="/configuracoes/ia" className="inline-flex min-h-11 items-center font-semibold text-fg underline underline-offset-2">
            {t("web.reviews.how.agent.link")}
          </Link>
        </p>
      </fieldset>

      <fieldset className="zuri-review-card space-y-3">
        <legend className="float-left w-full text-base font-semibold">{t("web.reviews.rule.title")}</legend>
        <p className="clear-both text-sm leading-6 text-fg-muted">{t("web.reviews.rule.body")}</p>
        <SelectField
          label={t("web.reviews.card.level")}
          hint={unlocked ? t("web.reviews.card.level.hint") : t("web.reviews.card.level.trial", { n: status.trial.approved, needed: status.trial.needed })}
          value={level}
          onChange={(e) => setLevel(e.target.value as ReviewLevel)}
        >
          <option value="approve">{t("web.reviews.card.level.approve")}</option>
          {/* By itself only after the trial; the server refuses it before then too. */}
          <option value="auto" disabled={!unlocked}>
            {t(unlocked ? "web.reviews.card.level.auto" : "web.reviews.card.level.autoLocked")}
          </option>
          <option value="off">{t("web.reviews.card.level.off")}</option>
        </SelectField>
      </fieldset>

      <fieldset className="zuri-review-card space-y-3">
        <legend className="float-left w-full text-base font-semibold">{t("web.reviews.card.templates")}</legend>
        <p className="clear-both text-sm leading-6 text-fg-muted">{t("web.reviews.card.templates.hint")}</p>
        {templates.map((text, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the templates have no id; the position is what the owner edits.
          <div key={index} className="flex items-start gap-2">
            <TextAreaField
              label={t("web.reviews.card.template", { n: index + 1 })}
              className="flex-1"
              value={text}
              required
              minLength={REVIEW_LIMITS.templateMin}
              maxLength={REVIEW_LIMITS.templateMax}
              onChange={(e) => setTemplates((list) => list.map((item, i) => (i === index ? e.target.value : item)))}
            />
            {templates.length > REVIEW_LIMITS.templatesMin && (
              <button
                type="button"
                className="zuri-icon-button mt-7"
                aria-label={t("web.reviews.card.template.remove", { n: index + 1 })}
                title={t("web.reviews.card.template.remove", { n: index + 1 })}
                onClick={() => setTemplates((list) => list.filter((_, i) => i !== index))}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        ))}
        {templates.length < REVIEW_LIMITS.templatesMax && (
          <Button type="button" variant="ghost" onClick={() => setTemplates((list) => [...list, ""])}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("web.reviews.card.template.add")}
          </Button>
        )}
        {failures.length > 0 && (
          <div role="alert" className="rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm">
            <ul className="list-disc pl-5">
              {failures.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      <fieldset className="zuri-review-card space-y-3">
        <legend className="float-left w-full text-base font-semibold">{t("web.reviews.never.title")}</legend>
        <p className="clear-both text-sm leading-6 text-fg-muted">{t("web.reviews.never.body")}</p>
        <TextField label={t("web.reviews.card.banned")} hint={t("web.reviews.card.banned.hint")} value={banned} onChange={(e) => setBanned(e.target.value)} />
      </fieldset>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-sm text-fg-muted">{t("web.reviews.how.save.hint")}</p>
        <Button type="submit" loading={saving}>
          {t("web.reviews.card.save")}
        </Button>
      </div>
    </form>
  );
}
