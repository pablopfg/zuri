import { useQuery } from "@tanstack/react-query";
import { LOGIN_OPTIONS_PATH, loginOptionsSchema } from "@zuri/shared";
import { LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { ApiError, api } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { TurnstileWidget } from "./TurnstileWidget.tsx";

/** A wait as the screens say it: minutes and seconds ("14:52"), with hours when it takes them ("23:59:59"). */
export function waitClock(seconds: number): string {
  // Not a number, negative or endless: no wait to show.
  const total = seconds > 0 && seconds < Number.POSITIVE_INFINITY ? Math.ceil(seconds) : 0;
  const two = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return `${hours ? `${hours}:${two(minutes)}` : minutes}:${two(total % 60)}`;
}

/**
 * The security check of the entry screens (sign-in, password recovery, first
 * access): one discreet line above the button, in six states. Checking, done,
 * "confirm it's you" (the box shows), didn't load, didn't pass, and a wait
 * after too many tries. The screens never name the service behind it.
 *
 * The public key comes with the form's options (null in local development
 * without keys: then there is no line); a refusal may carry it too. A token
 * works once: `take` hands it over and asks for the next.
 *
 * The lazy screens get this hook by property (App.tsx), never by import: a lazy
 * module that imports one of the first load with icons makes the bundler split
 * the first load (.claude/memoria/armadilhas.md, "Pacote da interface").
 */
export function useHumanCheck(enabled = true) {
  const { t } = useI18n();
  const options = useQuery({
    queryKey: ["login-options"],
    queryFn: async () => loginOptionsSchema.parse(await api<unknown>(LOGIN_OPTIONS_PATH.replace(/^\/api/, ""))),
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
    retry: 1,
  });
  const [refusedKey, setRefusedKey] = useState<string | null>(null);
  const siteKey = refusedKey ?? options.data?.turnstileSiteKey ?? null;
  // Until the options arrive the form can't know whether the check is on; if they fail, the server's refusal tells.
  const optionsPending = enabled && options.isPending && refusedKey === null;
  const [token, setToken] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [broken, setBroken] = useState(false);
  const [failed, setFailed] = useState(false);
  const [interactive, setInteractive] = useState(false);
  // Counts the tries held back: each one says the line again, out loud too.
  const [nudge, setNudge] = useState(0);
  const sent = useRef(false);
  // The pause as it was first shown: said out loud once, while the line on screen counts down in silence.
  const waitFrom = useRef(0);

  /** A new widget, from the start: no token, no box asked for, nothing held back. */
  const fresh = () => {
    setToken(null);
    setNudge(0);
    setInteractive(false);
    setRound((n) => n + 1);
  };
  const reload = () => {
    setBroken(false);
    setFailed(false);
    fresh();
  };

  return {
    /** The button's text during a pause: "Espere 14:52". */
    wait: (seconds: number) => t("web.login.wait", { time: waitClock(seconds) }),
    /** A try before the check is done is held back: the line says why. */
    hold(): boolean {
      if (!optionsPending && (siteKey === null || token)) return false;
      setNudge((n) => n + 1);
      return true;
    },
    /** The token for this try, if the check is on; the next try gets a new one. */
    take(): string | undefined {
      sent.current = token !== null;
      fresh();
      return token ?? undefined;
    },
    /** Reads a refusal. True when the server refused the check itself: the line says so, in place of the error. */
    refused(err: unknown): boolean {
      if (!(err instanceof ApiError)) return false;
      const key = (err.details as { turnstileSiteKey?: unknown }).turnstileSiteKey;
      // The key the server works with now, if it changed while the screen was open: the next widget uses it.
      const changed = typeof key === "string" && key !== "" && key !== siteKey;
      if (changed) setRefusedKey(key);
      if (err.code === "TURNSTILE_REQUIRED" && sent.current) {
        setFailed(true);
        setToken(null);
        return true;
      }
      if (changed) fresh();
      return false;
    },
    /** The line, and the box under it when a click is needed. `waitSeconds` is the screen's own pause. */
    line(waitSeconds = 0): ReactNode {
      const state =
        waitSeconds > 0
          ? "wait"
          : optionsPending
            ? "checking"
            : siteKey === null
              ? "off"
              : token
                ? "done"
                : failed
                  ? "failed"
                  : broken
                    ? "broken"
                    : interactive
                      ? "ask"
                      : "checking";
      waitFrom.current = waitSeconds > 0 ? Math.max(waitFrom.current, waitSeconds) : 0;
      if (!enabled || state === "off") return null;
      const alert = state === "wait" || state === "failed" || state === "broken";
      // A countdown inside a live region would be read out every second: the wait is announced once, apart.
      const role = state === "wait" ? undefined : alert || nudge > 0 ? "alert" : "status";
      return (
        <div>
          {state === "wait" && (
            <p role="alert" className="sr-only">
              {t("web.login.humanWait", { time: waitClock(waitFrom.current) })}
            </p>
          )}
          <p key={nudge} role={role} className="zuri-human" data-state={state}>
            {state === "checking" ? (
              <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
            ) : alert ? (
              <TriangleAlert aria-hidden />
            ) : (
              <ShieldCheck aria-hidden />
            )}
            <span>
              {state === "wait"
                ? t("web.login.humanWait", { time: waitClock(waitSeconds) })
                : state === "done"
                  ? t("web.login.humanDone")
                  : state === "failed"
                    ? t("web.login.humanFailed")
                    : state === "broken"
                      ? t("web.login.humanBroken")
                      : state === "ask"
                        ? t(nudge > 0 ? "web.login.humanTick" : "web.login.humanHint")
                        : t(nudge > 0 ? "web.login.humanLoading" : "web.login.humanChecking")}
            </span>
            {(state === "failed" || state === "broken") && (
              <button type="button" onClick={reload}>
                {t("web.login.humanRetry")}
              </button>
            )}
          </p>
          {siteKey !== null && !failed && (
            <TurnstileWidget
              key={`${siteKey}-${round}`}
              siteKey={siteKey}
              onToken={(value) => {
                setToken(value);
                if (value) {
                  setBroken(false);
                  setNudge(0);
                }
              }}
              onError={() => setBroken(true)}
              onInteractive={setInteractive}
            />
          )}
        </div>
      );
    },
  };
}

export type UseHumanCheck = typeof useHumanCheck;
