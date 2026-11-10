import { useQuery } from "@tanstack/react-query";
import {
  type MessageKey,
  PASSWORD_MIN_LENGTH,
  ptBRSetup,
  RECOVERY_LIMITS,
  type RecoveryLink,
  recoveryLinkSchema,
  recoveryStatusSchema,
} from "@zuri/shared";
import { KeyRound, LockKeyhole, Mail } from "lucide-react";
import { type FormEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { EntryLayout } from "../../components/EntryLayout.tsx";
import type { UseHumanCheck } from "../../components/HumanCheck.tsx";
import { Logo } from "../../components/Logo.tsx";
import { Button, buttonClass, ErrorNotice, Notice, PasswordField, Loading, TextField, useDocumentTitle } from "../../components/ui.tsx";
import { useSession } from "../../hooks/session.tsx";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";
import { FIRST_ACCESS_PATH, HOME_PATH, LOGIN_PATH, RECOVERY_PATH } from "../../lib/next.ts";

addMessages(ptBRSetup);

type Step =
  | { kind: "request" }
  | { kind: "sent" }
  | { kind: "checking"; token: string }
  | { kind: "link"; token: string; link: RecoveryLink }
  | { kind: "bad" }
  | { kind: "done" };

interface RefusalDetails {
  retryAfter?: number;
  fields?: string[];
}

/** The token travels in the link's fragment, so it never reaches a server log. */
function readToken(): string | null {
  return /^#([A-Za-z0-9_-]{43})$/.exec(window.location.hash)?.[1] ?? null;
}

/**
 * Password recovery by e-mail, at /recuperar-senha (step 11c). Without a token
 * it asks for the link; with one (from the e-mail) it sets the new password,
 * with a code when two-step sign-in is on. The server holds every rule.
 */
export function RecoveryPage({ go, useHuman }: { go: (path: string) => void; useHuman: UseHumanCheck }) {
  const { t } = useI18n();
  const { session, loading, retry } = useSession();
  const [step, setStep] = useState<Step>(() => {
    const token = readToken();
    return token ? { kind: "checking", token } : { kind: "request" };
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [checkError, setCheckError] = useState<unknown>(null);

  // Read, then taken off the address bar and the history (an effect: a pure first render reads it twice in development).
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, "", RECOVERY_PATH);
    // A link pasted into this same tab changes only the fragment: no new page load, so it is read here.
    const pasted = () => {
      const token = readToken();
      window.history.replaceState(window.history.state, "", RECOVERY_PATH);
      if (!token) return;
      setError(null);
      setCheckError(null);
      setStep({ kind: "checking", token });
    };
    window.addEventListener("hashchange", pasted);
    return () => window.removeEventListener("hashchange", pasted);
  }, []);

  const status = useQuery({
    queryKey: ["recovery-status"],
    queryFn: async () => recoveryStatusSchema.parse(await api<unknown>("/auth/recover")),
    enabled: step.kind === "request",
    retry: 1,
  });
  // The security check, as on the sign-in form: only the request for a link needs it.
  const human = useHuman(step.kind === "request");

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useDocumentTitle(t(step.kind === "link" || step.kind === "checking" ? "web.recovery.linkTitle" : "web.recovery.title"));

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const waitSeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;

  // Signed in and nothing to do here: back to the app. A link from the e-mail still opens.
  useEffect(() => {
    if (session && step.kind === "request") go(HOME_PATH);
  }, [session, step.kind, go]);

  // The link is checked as the page opens, and again on each "try again" (a new step object).
  const checking = step.kind === "checking" ? step : null;
  useEffect(() => {
    if (!checking) return;
    const { token } = checking;
    let live = true;
    api<unknown>("/auth/recover/check", { method: "POST", body: { token } })
      .then((answer) => live && setStep({ kind: "link", token, link: recoveryLinkSchema.parse(answer) }))
      .catch((err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && (err.code === "RECOVERY_EXPIRED" || err.code === "VALIDATION_FAILED")) setStep({ kind: "bad" });
        else setCheckError(err);
      });
    return () => {
      live = false;
    };
  }, [checking]);

  // A new step takes the focus to its title, so a screen reader hears where it is.
  const stepKind = step.kind;
  useEffect(() => {
    if (stepKind !== "request" && stepKind !== "checking") headingRef.current?.focus();
  }, [stepKind]);

  if (loading) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-6 p-6">
        <Logo className="h-12 w-12" working />
        <Loading label={t("web.session.checking")} />
      </main>
    );
  }

  /** A plain link, moved inside the app without reloading it. */
  function follow(e: MouseEvent<HTMLAnchorElement>, path: string) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(path);
  }

  function refused(err: unknown) {
    // A check the server refused, or a pause while asking for the link: the line above the button says it.
    const paused = err instanceof ApiError && err.code === "RATE_LIMITED" && typeof (err.details as RefusalDetails).retryAfter === "number";
    if (paused) {
      // The clock is read again here: the last reading may be as old as the screen.
      setNow(Date.now());
      setRetryAt(Date.now() + ((err.details as RefusalDetails).retryAfter as number) * 1000);
    }
    setError(human.refused(err) || (paused && step.kind === "request") ? null : errorMessage(err));
  }

  async function submitRequest(e: FormEvent) {
    e.preventDefault();
    if (pending || waitSeconds > 0) return;
    if (!email.trim()) {
      setAttempted(true);
      setError(null);
      emailRef.current?.focus();
      return;
    }
    setAttempted(false);
    if (human.hold()) return;
    setPending(true);
    setError(null);
    const token = human.take();
    try {
      await api("/auth/recover/request", { method: "POST", body: { email: email.trim(), ...(token ? { turnstileToken: token } : {}) } });
      setStep({ kind: "sent" });
    } catch (err) {
      refused(err);
      emailRef.current?.focus();
    } finally {
      setPending(false);
    }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (pending || waitSeconds > 0 || step.kind !== "link") return;
    const codeMissing = step.link.secondStep && !code.trim();
    if (!password || password !== repeat || codeMissing) {
      setAttempted(true);
      setError(null);
      (!password ? passwordRef : password !== repeat ? repeatRef : codeRef).current?.focus();
      return;
    }
    setAttempted(false);
    setPending(true);
    setError(null);
    setPasswordError(null);
    try {
      await api("/auth/recover/confirm", {
        method: "POST",
        body: { token: step.token, password, ...(step.link.secondStep ? { totp: code.trim() } : {}) },
      });
      setPassword("");
      setRepeat("");
      setCode("");
      setStep({ kind: "done" });
      // Every session ended, this browser's too: the app learns it now, not at the next click.
      if (session) retry();
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as RefusalDetails) : {};
      if (err instanceof ApiError && err.code === "RECOVERY_EXPIRED") {
        setPassword("");
        setRepeat("");
        setCode("");
        setStep({ kind: "bad" });
        return;
      }
      if (details.fields?.includes("password")) {
        setPassword("");
        setRepeat("");
        setPasswordError(errorMessage(err));
        requestAnimationFrame(() => passwordRef.current?.focus());
        return;
      }
      // A wrong code (or a pause after too many): the passwords stay typed, the code goes.
      setCode("");
      refused(err);
      requestAnimationFrame(() => (step.link.secondStep ? codeRef : passwordRef).current?.focus());
    } finally {
      setPending(false);
    }
  }

  const minutes = RECOVERY_LIMITS.ttlMs / 60_000;
  const mismatch = repeat.length > 0 && password !== repeat ? t("web.setup.mismatch") : null;
  const errorLine = error && (
    <p id="recovery-error" role="alert" className="text-sm text-danger">
      {error}
    </p>
  );
  const linkClass = buttonClass("primary", "min-h-12 w-full");
  const heading = (key: MessageKey) => (
    <h1 ref={headingRef} tabIndex={-1}>
      {t(key)}
    </h1>
  );

  return (
    <EntryLayout working={pending || step.kind === "checking"}>
      {step.kind === "request" && (
        <div>
          <h1>{t("web.recovery.title")}</h1>
          <p>{t("web.recovery.lead")}</p>
        </div>
      )}
      <div className="grid gap-5">
          {step.kind === "request" ? (
            status.isError ? (
              <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
            ) : status.isPending ? (
              <Loading />
            ) : !status.data.available ? (
              <div className="space-y-4">
                <Notice tone="warning">{t("web.recovery.unavailable")}</Notice>
                <a href={FIRST_ACCESS_PATH} onClick={(e) => follow(e, FIRST_ACCESS_PATH)} className={linkClass}>
                  {t("web.recovery.useSetupCode")}
                </a>
              </div>
            ) : (
              <form onSubmit={submitRequest} noValidate aria-describedby={error ? "recovery-error" : undefined}>
                <TextField
                  ref={emailRef}
                  label={t("web.setup.email")}
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  required
                  maxLength={254}
                  icon={<Mail aria-hidden />}
                  error={attempted && !email.trim() ? t("web.setup.emailRequired") : null}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {human.line(waitSeconds)}
                <Button type="submit" className="min-h-12 w-full" loading={pending} disabled={waitSeconds > 0}>
                  {waitSeconds > 0 ? human.wait(waitSeconds) : t("web.recovery.send")}
                </Button>
                {errorLine}
              </form>
            )
          ) : step.kind === "sent" ? (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text" aria-hidden>
                <Mail className="h-5 w-5" />
              </span>
              <div>
                {heading("web.recovery.sentTitle")}
                <p>{t("web.recovery.sentBody", { minutes })}</p>
              </div>
              <a href={LOGIN_PATH} onClick={(e) => follow(e, LOGIN_PATH)} className={buttonClass("secondary", "min-h-12 w-full")}>
                {t("web.setup.backToLogin")}
              </a>
              <p className="text-center">
                <button type="button" className="zuri-entry-link" onClick={() => setStep({ kind: "request" })}>
                  {t("web.recovery.askAgain")}
                </button>
              </p>
            </>
          ) : step.kind === "checking" ? (
            checkError ? (
              <ErrorNotice
                error={checkError}
                onRetry={() => {
                  setCheckError(null);
                  setStep({ kind: "checking", token: step.token });
                }}
              />
            ) : (
              <Loading label={t("web.recovery.checking")} />
            )
          ) : step.kind === "link" ? (
            <form onSubmit={submitPassword} noValidate aria-describedby={error ? "recovery-error" : undefined}>
              <div>
                {heading("web.recovery.linkTitle")}
                <p>{t("web.recovery.linkLead")}</p>
              </div>
              <PasswordField
                ref={passwordRef}
                label={t("web.setup.newPassword")}
                hint={t("web.password.rules", { min: PASSWORD_MIN_LENGTH })}
                autoComplete="new-password"
                required
                maxLength={1024}
                icon={<LockKeyhole aria-hidden />}
                error={attempted && !password ? t("web.setup.passwordRequired") : passwordError}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(null);
                }}
              />
              <PasswordField
                ref={repeatRef}
                label={t("web.setup.passwordRepeat")}
                autoComplete="new-password"
                required
                maxLength={1024}
                icon={<LockKeyhole aria-hidden />}
                error={mismatch ?? (attempted && password && !repeat ? t("web.setup.mismatch") : null)}
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
              {step.link.secondStep && (
                <TextField
                  ref={codeRef}
                  label={t("web.recovery.code")}
                  hint={t("web.recovery.codeHint")}
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={40}
                  icon={<KeyRound aria-hidden />}
                  error={attempted && password && password === repeat && !code.trim() ? t("web.recovery.codeRequired") : null}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
              <Button type="submit" className="min-h-12 w-full" loading={pending} disabled={waitSeconds > 0}>
                {waitSeconds > 0 ? human.wait(waitSeconds) : t("web.recovery.save")}
              </Button>
              {errorLine}
            </form>
          ) : step.kind === "bad" ? (
            <div className="space-y-4">
              {heading("web.recovery.badTitle")}
              <Notice tone="warning">{t("web.recovery.badBody")}</Notice>
              <Button
                className="min-h-12 w-full"
                onClick={() => {
                  setError(null);
                  setStep({ kind: "request" });
                }}
              >
                {t("web.recovery.askAgain")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {heading("web.setup.recoveredTitle")}
              <Notice tone="success">{t("web.setup.recoveredBody")}</Notice>
              <a href={LOGIN_PATH} onClick={(e) => follow(e, LOGIN_PATH)} className={linkClass}>
                {t("web.setup.goToLogin")}
              </a>
            </div>
          )}
      </div>
      {step.kind !== "done" && step.kind !== "sent" && (
        <p className="text-center">
          <a href={LOGIN_PATH} onClick={(e) => follow(e, LOGIN_PATH)} className="zuri-entry-link">
            {t("web.setup.backToLogin")}
          </a>
        </p>
      )}
    </EntryLayout>
  );
}
