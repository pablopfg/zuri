import type { startAuthentication as startAuthenticationFn } from "@simplewebauthn/browser";
import { mfaRequiredSchema, type SessionState, sessionStateSchema } from "@zuri/shared";
import { Fingerprint, LockKeyhole, Mail } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { EntryLayout } from "../components/EntryLayout.tsx";
import { useHumanCheck } from "../components/HumanCheck.tsx";
import { SessionChecking } from "../components/RequireSession.tsx";
import { Button, Notice, PasswordField, TextField, useDocumentTitle } from "../components/ui.tsx";
import { useSession } from "../hooks/session.tsx";
import { useSetupStatus } from "../hooks/setup.ts";
import { ApiError, api, errorMessage } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { FIRST_ACCESS_PATH, RECOVERY_PATH, safeNext } from "../lib/next.ts";

type Step = { kind: "password" } | { kind: "code"; passkey: boolean; recovery: boolean };

/** The details a refusal of the sign-in may carry. */
interface SignInDetails {
  retryAfter?: number;
  mfa?: "retry" | "expired";
  attemptsLeft?: number;
}

export function LoginPage() {
  const { t } = useI18n();
  const { session, loading, ended, signedIn } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));

  const [step, setStep] = useState<Step>({ kind: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The button never locks on an empty field: a try marks what is missing, right under it.
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  // Asked only while signed out; the form shows meanwhile (an owner signs in far more often than a first access).
  const setup = useSetupStatus(!loading && !session);
  // The security check, on every try (components/HumanCheck.tsx).
  const human = useHumanCheck();
  const [spoken, setSpoken] = useState({ text: "", n: 0 });
  // Kept from when the screen opened, so the message doesn't vanish on the first keystroke.
  const [endedReason] = useState(ended);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  useDocumentTitle(t("web.login.submit"));

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  // Fetched as soon as the code step offers a passkey, so the tap doesn't wait on the download
  // (Safari may drop the tap's permission to open the prompt if the gap grows).
  const offersPasskey = step.kind === "code" && step.passkey;
  useEffect(() => {
    if (offersPasskey) void import("@simplewebauthn/browser").catch(() => {});
  }, [offersPasskey]);
  const waitSeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  // An address needs its three parts; the server has the last word on the rest.
  const emailWrong = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const emailProblem = t(email.trim() ? "web.login.emailInvalid" : "web.login.emailRequired");
  const emailError = attempted && step.kind === "password" && emailWrong ? emailProblem : null;
  const passwordMissing = attempted && step.kind === "password" && !password;
  const codeMissing = attempted && step.kind === "code" && !code.trim();

  if (loading) return <SessionChecking />;
  if (session) return <Navigate to={next} replace />;
  // A new installation has no owner yet: its first access comes before any sign-in.
  if (setup.data?.setup) return <Navigate to={FIRST_ACCESS_PATH} replace />;

  const finish = (state: SessionState) => {
    signedIn(state);
    navigate(next, { replace: true });
  };

  function refused(err: unknown) {
    // A check the server refused, or a pause: the line above the button says it, with what to do.
    const paused = err instanceof ApiError && err.code === "RATE_LIMITED" && typeof (err.details as SignInDetails).retryAfter === "number";
    if (paused) {
      // The clock is read again here: the last reading may be as old as the screen.
      setNow(Date.now());
      setRetryAt(Date.now() + ((err.details as SignInDetails).retryAfter as number) * 1000);
    }
    setError(human.refused(err) || (paused && step.kind === "password") ? null : errorMessage(err));
  }

  /** Says a blocked try out loud: a new node each time, so a screen reader repeats it. */
  function announce(message: string) {
    setSpoken((last) => ({ text: message, n: last.n + 1 }));
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (pending || waitSeconds > 0) return;
    if (emailWrong || !password) {
      setAttempted(true);
      setError(null);
      announce(emailWrong ? emailProblem : t("web.login.passwordRequired"));
      // After the render, so the field already carries its message when it takes the focus.
      requestAnimationFrame(() => (emailWrong ? emailRef : passwordRef).current?.focus());
      return;
    }
    setAttempted(false);
    setSpoken((last) => ({ text: "", n: last.n }));
    // The security check comes first: its own line, right above the button, turns into the alert.
    if (human.hold()) return;
    setPending(true);
    setError(null);
    const token = human.take();
    try {
      const answer = await api<unknown>("/auth/login", {
        method: "POST",
        body: { email: email.trim(), password, ...(token ? { turnstileToken: token } : {}) },
      });
      setPassword("");
      const mfa = mfaRequiredSchema.safeParse(answer);
      if (mfa.success) {
        setStep({ kind: "code", passkey: mfa.data.passkey, recovery: false });
        setCode("");
        return;
      }
      finish(sessionStateSchema.parse(answer));
    } catch (err) {
      setPassword("");
      refused(err);
      passwordRef.current?.focus();
    } finally {
      setPending(false);
    }
  }

  /** A failed second step: back to the password once the challenge is over, else try again here. */
  function secondStepFailed(err: unknown) {
    setError(errorMessage(err));
    if (err instanceof ApiError && (err.details as SignInDetails).mfa === "expired") {
      setAttempted(false);
      setSpoken((last) => ({ text: "", n: last.n }));
      setStep({ kind: "password" });
      requestAnimationFrame(() => passwordRef.current?.focus());
      return;
    }
    if (err instanceof ApiError && err.code === "RATE_LIMITED") refused(err);
    codeRef.current?.focus();
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!code.trim()) {
      setAttempted(true);
      announce(t("web.login.codeRequired"));
      requestAnimationFrame(() => codeRef.current?.focus());
      return;
    }
    setAttempted(false);
    setSpoken((last) => ({ text: "", n: last.n }));
    setPending(true);
    setError(null);
    try {
      finish(sessionStateSchema.parse(await api<unknown>("/auth/mfa", { method: "POST", body: { code: code.trim() } })));
    } catch (err) {
      setCode("");
      secondStepFailed(err);
    } finally {
      setPending(false);
    }
  }

  async function signInWithPasskey() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // Loaded on the tap: most sign-ins never use a passkey, so the first screen stays lighter.
      const [{ startAuthentication }, { options }] = await Promise.all([
        import("@simplewebauthn/browser"),
        api<{ options: Parameters<typeof startAuthenticationFn>[0]["optionsJSON"] }>("/auth/mfa/passkey/options", { method: "POST" }),
      ]);
      const response = await startAuthentication({ optionsJSON: options });
      finish(sessionStateSchema.parse(await api<unknown>("/auth/mfa/passkey", { method: "POST", body: { response } })));
    } catch (err) {
      // Closing the browser's prompt isn't a wrong answer: the code is still there to use.
      if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) setError(t("web.login.passkeyCancelled"));
      else secondStepFailed(err);
    } finally {
      setPending(false);
    }
  }

  const errorLine = error && (
    <p id="login-error" role="alert" className="text-sm text-danger">
      {error}
    </p>
  );

  return (
    <EntryLayout working={pending}>
      {pending && <div aria-hidden className="zuri-progress" />}
        {step.kind === "password" ? (
          <form onSubmit={submitPassword} noValidate aria-describedby={error ? "login-error" : undefined}>
            <div>
              <h1>{t("web.login.submit")}</h1>
              <p>{t("web.login.welcome")}</p>
            </div>
            {endedReason && !error && <Notice>{endedReason === "idle" ? t("web.login.endedIdle") : t("web.login.ended")}</Notice>}
            <TextField
              label={t("web.login.email")}
              ref={emailRef}
              type="email"
              autoComplete="username"
              autoFocus
              required
              maxLength={254}
              icon={<Mail aria-hidden />}
              error={emailError}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <PasswordField
              ref={passwordRef}
              label={t("web.login.password")}
              autoComplete="current-password"
              required
              maxLength={1024}
              icon={<LockKeyhole aria-hidden />}
              error={passwordMissing ? t("web.login.passwordRequired") : null}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aside={
                <a
                  href={RECOVERY_PATH}
                  onClick={(e) => {
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    navigate(RECOVERY_PATH);
                  }}
                  className="zuri-entry-link"
                >
                  {t("web.login.forgot")}
                </a>
              }
            />
            {human.line(waitSeconds)}
            <Button type="submit" className="min-h-12 w-full" loading={pending} disabled={waitSeconds > 0}>
              {waitSeconds > 0 ? human.wait(waitSeconds) : t(pending ? "web.login.pending" : "web.login.submit")}
            </Button>
            {errorLine}
          </form>
        ) : (
          <form onSubmit={submitCode} noValidate>
            <div>
              <h1>{t("web.login.codeTitle")}</h1>
              <p>{step.recovery ? t("web.login.recoveryHint") : t("web.login.codeHint")}</p>
            </div>
            <TextField
              ref={codeRef}
              key={step.recovery ? "recovery" : "totp"}
              label={step.recovery ? t("web.login.recoveryCode") : t("web.login.code")}
              autoComplete="one-time-code"
              inputMode={step.recovery ? "text" : "numeric"}
              autoCapitalize="characters"
              maxLength={step.recovery ? 40 : 8}
              autoFocus
              error={codeMissing ? t("web.login.codeRequired") : null}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" className="min-h-12 w-full" loading={pending}>
              {t("web.login.verify")}
            </Button>
            {step.passkey && (
              <Button variant="secondary" className="w-full" disabled={pending} onClick={() => void signInWithPasskey()}>
                <Fingerprint className="h-4 w-4" aria-hidden />
                {t("web.login.signInWithPasskey")}
              </Button>
            )}
            {errorLine}
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <button
                type="button"
                className="min-h-11 font-medium text-fg-muted hover:text-fg"
                onClick={() => {
                  setStep({ kind: "password" });
                  setError(null);
                  setAttempted(false);
                  setSpoken((last) => ({ text: "", n: last.n }));
                }}
              >
                {t("web.login.back")}
              </button>
              <button
                type="button"
                className="min-h-11 font-medium text-accent-text underline-offset-4 hover:underline"
                onClick={() => {
                  setStep({ ...step, recovery: !step.recovery });
                  setCode("");
                  setError(null);
                  setAttempted(false);
                  setSpoken((last) => ({ text: "", n: last.n }));
                }}
              >
                {step.recovery ? t("web.login.useApp") : t("web.login.useRecovery")}
              </button>
            </div>
          </form>
        )}
        {spoken.text && (
          <span key={spoken.n} role="alert" className="sr-only">
            {spoken.text}
          </span>
        )}
    </EntryLayout>
  );
}
