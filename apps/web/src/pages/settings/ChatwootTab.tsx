import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CHATWOOT_OWNER_SWITCHABLE,
  type ChatwootOwnerCheck,
  type ChatwootOwnerCheckResult,
  type ChatwootOwnerCode,
  type ChatwootOwnerEvent,
  type ChatwootOwnerPause,
  type ChatwootOwnerProblem,
  type ChatwootOwnerProfile,
  type ChatwootOwnerStatus,
  type ChatwootOwnerStep,
  type ChatwootOwnerTest,
  CHATWOOT_OWNER_STEPS,
  ptBRChatwoot,
} from "@zuri/shared";
import { CircleAlert, CircleCheck, CircleX, ExternalLink, KeyRound, LoaderCircle, Plug, RefreshCw, ShieldCheck, TriangleAlert, User } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Switch } from "../../components/Switch.tsx";
import { useToast } from "../../components/Toaster.tsx";
import { Button, Card, cn, Dialog, ErrorNotice, Loading, Notice, PasswordField, TextField } from "../../components/ui.tsx";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { addMessages, useI18n } from "../../lib/i18n.tsx";

// The page's texts come with its download (rule P11).
addMessages(ptBRChatwoot);

export const CHATWOOT_OWNER_KEY = ["chatwoot-owner"] as const;

type T = ReturnType<typeof useI18n>["t"];
type Key = Parameters<T>[0];

// One literal key per value, so the i18n lint sees each one.
const STEP_TEXT: Record<ChatwootOwnerStep, { label: Key; hint: Key }> = {
  key: { label: "web.chatwoot.step.key", hint: "web.chatwoot.step.key.hint" },
  inbox: { label: "web.chatwoot.step.inbox", hint: "web.chatwoot.step.inbox.hint" },
  members: { label: "web.chatwoot.step.members", hint: "web.chatwoot.step.members.hint" },
  contact: { label: "web.chatwoot.step.contact", hint: "web.chatwoot.step.contact.hint" },
  code: { label: "web.chatwoot.step.code", hint: "web.chatwoot.step.code.hint" },
  discard: { label: "web.chatwoot.step.discard", hint: "web.chatwoot.step.discard.hint" },
};

const PROBLEM_TEXT: Record<ChatwootOwnerProblem, Key> = {
  origin: "web.chatwoot.problem.origin",
  dns: "web.chatwoot.problem.dns",
  private_address: "web.chatwoot.problem.private_address",
  redirect: "web.chatwoot.problem.redirect",
  timeout: "web.chatwoot.problem.timeout",
  unavailable: "web.chatwoot.problem.unavailable",
  too_large: "web.chatwoot.problem.too_large",
  refused: "web.chatwoot.problem.refused",
  not_admin: "web.chatwoot.problem.not_admin",
  not_found: "web.chatwoot.problem.not_found",
  rejected: "web.chatwoot.problem.rejected",
  bad_answer: "web.chatwoot.problem.bad_answer",
  old_version: "web.chatwoot.problem.old_version",
  calls_limit: "web.chatwoot.problem.calls_limit",
};

const PAUSE_TEXT: Record<Exclude<ChatwootOwnerPause, "owner">, Key> = {
  strangers: "web.chatwoot.paused.strangers",
  signature: "web.chatwoot.paused.signature",
  hmac: "web.chatwoot.paused.hmac",
  inbox: "web.chatwoot.paused.inbox",
  recreate: "web.chatwoot.paused.recreate",
};

const EVENT_TEXT: Record<ChatwootOwnerEvent, Key> = {
  answered: "web.chatwoot.event.answered",
  code: "web.chatwoot.event.code",
  linked: "web.chatwoot.event.linked",
  stranger: "web.chatwoot.event.stranger",
  recreated: "web.chatwoot.event.recreated",
  repaired: "web.chatwoot.event.repaired",
  rotated: "web.chatwoot.event.rotated",
  test: "web.chatwoot.event.test",
  limit: "web.chatwoot.event.limit",
  long: "web.chatwoot.event.long",
  lockdown: "web.chatwoot.event.lockdown",
  locked: "web.chatwoot.event.locked",
  unlocked: "web.chatwoot.event.unlocked",
};

const CHECK_TEXT: Record<ChatwootOwnerCheck, { label: Key; ok: Key; bad: Key | null }> = {
  reach: { label: "web.chatwoot.check.reach", ok: "web.chatwoot.check.reach.ok", bad: null },
  inbox: { label: "web.chatwoot.check.inbox", ok: "web.chatwoot.check.inbox.ok", bad: "web.chatwoot.check.inbox.bad" },
  hmac: { label: "web.chatwoot.check.hmac", ok: "web.chatwoot.check.hmac.ok", bad: "web.chatwoot.check.hmac.bad" },
  conversation: { label: "web.chatwoot.check.conversation", ok: "web.chatwoot.check.conversation.ok", bad: "web.chatwoot.check.conversation.bad" },
  signature: { label: "web.chatwoot.check.signature", ok: "web.chatwoot.check.signature.ok", bad: "web.chatwoot.check.signature.bad" },
  webhook: { label: "web.chatwoot.check.webhook", ok: "web.chatwoot.check.webhook.ok", bad: "web.chatwoot.check.webhook.bad" },
  members: { label: "web.chatwoot.check.members", ok: "web.chatwoot.check.members.ok", bad: "web.chatwoot.check.members.bad" },
  admin: { label: "web.chatwoot.check.admin", ok: "web.chatwoot.check.admin.ok", bad: "web.chatwoot.check.admin.bad" },
  admins: { label: "web.chatwoot.check.admins", ok: "web.chatwoot.check.admins.none", bad: null },
};

const KEYS: { name: Key; can: Key; use: Key; tag: Key; tone: Tone }[] = [
  { name: "web.chatwoot.keys.admin", can: "web.chatwoot.keys.admin.can", use: "web.chatwoot.keys.admin.use", tag: "web.chatwoot.keys.admin.tag", tone: "wait" },
  { name: "web.chatwoot.keys.agent", can: "web.chatwoot.keys.agent.can", use: "web.chatwoot.keys.agent.use", tag: "web.chatwoot.keys.unused", tone: "off" },
  { name: "web.chatwoot.keys.bot", can: "web.chatwoot.keys.bot.can", use: "web.chatwoot.keys.bot.use", tag: "web.chatwoot.keys.unused", tone: "off" },
  { name: "web.chatwoot.keys.platform", can: "web.chatwoot.keys.platform.can", use: "web.chatwoot.keys.platform.use", tag: "web.chatwoot.keys.platform.tag", tone: "bad" },
  { name: "web.chatwoot.keys.public", can: "web.chatwoot.keys.public.can", use: "web.chatwoot.keys.public.use", tag: "web.chatwoot.keys.public.tag", tone: "on" },
];

const RECOVERY: { name: Key; hint: Key; tag: Key; tone: Tone }[] = [
  { name: "web.chatwoot.recovery.gone", hint: "web.chatwoot.recovery.gone.hint", tag: "web.chatwoot.recovery.gone.tag", tone: "on" },
  { name: "web.chatwoot.recovery.inbox", hint: "web.chatwoot.recovery.inbox.hint", tag: "web.chatwoot.repair", tone: "wait" },
  { name: "web.chatwoot.recovery.secrets", hint: "web.chatwoot.recovery.secrets.hint", tag: "web.chatwoot.rotate", tone: "wait" },
  { name: "web.chatwoot.recovery.account", hint: "web.chatwoot.recovery.account.hint", tag: "web.chatwoot.relink", tone: "wait" },
  { name: "web.chatwoot.recovery.phone", hint: "web.chatwoot.recovery.phone.hint", tag: "web.chatwoot.recovery.phone.tag", tone: "off" },
];

type Tone = "on" | "wait" | "off" | "bad";

function Pill({ tone, children }: { tone: Tone; children: string }) {
  const tones = { on: "bg-success-soft", wait: "bg-warning-soft", off: "bg-raised text-fg-muted", bad: "bg-danger-soft" } as const;
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold text-fg", tones[tone])}>{children}</span>;
}

/** Why a call stopped, from the refusal's details; the server's own sentence otherwise. */
function problemText(t: T, error: unknown, accountId?: number): string {
  if (error instanceof ApiError) {
    const problem = error.details.problem;
    if (typeof problem === "string" && problem in PROBLEM_TEXT) {
      return t(PROBLEM_TEXT[problem as ChatwootOwnerProblem], {
        name: typeof error.details.name === "string" ? error.details.name : "",
        account: typeof error.details.accountId === "number" ? error.details.accountId : (accountId ?? ""),
      });
    }
  }
  return errorMessage(error);
}

/**
 * Settings › Chatwoot (docs/planos/zuri-no-chatwoot.md): Zuri makes an inbox of its own in the
 * owner's Chatwoot and answers only the owner's agent account. The administrator's key is typed
 * for each request that uses it and never comes back; the API asks for the password itself.
 * Names and e-mails are the Chatwoot's text: React escapes them.
 */
export function ChatwootTab() {
  const { t } = useI18n();
  const status = useQuery({ queryKey: CHATWOOT_OWNER_KEY, queryFn: ({ signal }) => api<ChatwootOwnerStatus>("/chatwoot/owner", { signal }) });
  // The code comes back only from the call that sent it: kept on screen while this page lives.
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  return (
    <div className="space-y-6">
      {status.isPending && (
        <Card title={t("web.chatwoot.title")}>
          <Loading />
        </Card>
      )}
      {status.isError && (
        <Card title={t("web.chatwoot.title")}>
          <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
        </Card>
      )}
      {status.data && <Main status={status.data} code={code} onCode={setCode} />}
      {status.data?.configured && <Recovery />}
      <Keys />
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return (next?: ChatwootOwnerStatus) => {
    if (next) qc.setQueryData(CHATWOOT_OWNER_KEY, next);
    return qc.invalidateQueries({ queryKey: CHATWOOT_OWNER_KEY });
  };
}

function Main({ status, code, onCode }: { status: ChatwootOwnerStatus; code: { code: string; expiresAt: string } | null; onCode: (code: { code: string; expiresAt: string } | null) => void }) {
  const { t } = useI18n();
  const [setup, setSetup] = useState(false);
  const description = !status.configured
    ? t("web.chatwoot.description.off")
    : status.state === "code"
      ? t("web.chatwoot.description.code")
      : status.state === "confirm"
        ? t("web.chatwoot.description.confirm")
        : t("web.chatwoot.description.on");
  return (
    <Card title={t("web.chatwoot.title")} description={description}>
      {!status.configured ? (
        <div className="space-y-4">
          {!status.credentialsAvailable && <Notice tone="warning">{t("web.chatwoot.noKey")}</Notice>}
          <p className="text-sm font-semibold">{t("web.chatwoot.doesAlone")}</p>
          <Steps done={-1} />
          <p className="flex gap-2 text-sm leading-6 text-fg-muted">
            <ShieldCheck className="mt-1 h-4 w-4 shrink-0" aria-hidden />
            {t("web.chatwoot.safe")}
          </p>
          <Button onClick={() => setSetup(true)} disabled={!status.credentialsAvailable} aria-haspopup="dialog">
            <Plug className="h-4 w-4" aria-hidden />
            {t("web.chatwoot.configure")}
          </Button>
        </div>
      ) : status.state === "code" ? (
        <Waiting status={status} code={code} onCode={onCode} />
      ) : status.state === "confirm" ? (
        <Confirm status={status} onDone={() => onCode(null)} />
      ) : (
        <Linked status={status} onCode={onCode} />
      )}
      {/* Outside the states: the setup turns the status to "code", and the dialog still has the code to show. */}
      <SetupDialog open={setup} onClose={() => setSetup(false)} onCode={onCode} />
    </Card>
  );
}

/** The setup's steps: done up to `done`, the one at `failed` marked, the one after `done` running while `running`. */
function Steps({ done, failed, running }: { done: number; failed?: number; running?: boolean }) {
  const { t } = useI18n();
  return (
    <ol className="space-y-3">
      {CHATWOOT_OWNER_STEPS.map((step, index) => {
        const bad = failed === index;
        const ok = !bad && index <= done;
        const now = running && !bad && index === done + 1;
        const Icon = bad ? CircleX : ok ? CircleCheck : now ? LoaderCircle : null;
        return (
          <li key={step} className="flex gap-3 text-sm">
            {Icon ? (
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", bad ? "text-danger" : ok ? "text-success" : "text-fg-muted", now && "motion-safe:animate-spin")} aria-hidden />
            ) : (
              // A step still to come: an empty ring, as the prototype's clock but lighter.
              <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-border-strong" aria-hidden />
            )}
            <span className="min-w-0">
              <span className="block font-medium">
                {t(STEP_TEXT[step].label)}
                {(bad || ok) && <span className="sr-only">{`: ${t(bad ? "web.chatwoot.notOk" : "web.chatwoot.ok")}`}</span>}
              </span>
              <span className="block leading-6 text-fg-muted">{t(STEP_TEXT[step].hint)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const openLink = (status: ChatwootOwnerStatus) =>
  status.origin && status.accountId ? `${status.origin}/app/accounts/${status.accountId}/${status.inboxId ? `inbox/${status.inboxId}` : "dashboard"}` : null;

function OpenChatwoot({ status }: { status: ChatwootOwnerStatus }) {
  const { t } = useI18n();
  const href = openLink(status);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-strong px-4 text-sm font-semibold hover:bg-raised">
      <ExternalLink className="h-4 w-4" aria-hidden />
      {t("web.chatwoot.openChatwoot")}
    </a>
  );
}

function Waiting({ status, code, onCode }: { status: ChatwootOwnerStatus; code: { code: string; expiresAt: string } | null; onCode: (code: { code: string; expiresAt: string } | null) => void }) {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const refresh = useRefresh();
  const [forget, setForget] = useState(false);
  const again = useMutation({
    mutationFn: () => api<ChatwootOwnerCode>("/chatwoot/owner/code", { method: "POST" }),
    onSuccess: async (result) => {
      onCode({ code: result.code, expiresAt: result.expiresAt });
      await refresh(result.status);
      toast(t("web.chatwoot.newCodeSent"));
    },
  });
  const shown = code && status.codeExpiresAt === code.expiresAt ? code : null;
  return (
    <div className="space-y-4">
      <Pill tone="wait">{t("web.chatwoot.waiting")}</Pill>
      <p className="text-sm leading-6">
        {status.codeExpiresAt === null
          ? t("web.chatwoot.codeGone")
          : shown
            ? t("web.chatwoot.answerCode", { code: shown.code, time: dateTime(shown.expiresAt) })
            : t("web.chatwoot.answerSent", { time: dateTime(status.codeExpiresAt) })}
      </p>
      {again.isError && <p className="text-sm text-danger">{problemText(t, again.error)}</p>}
      <div className="flex flex-wrap gap-2">
        <OpenChatwoot status={status} />
        <Button variant="ghost" onClick={() => again.mutate()} loading={again.isPending}>
          {t("web.chatwoot.newCode")}
        </Button>
        <Button variant="ghost" onClick={() => setForget(true)} aria-haspopup="dialog">
          {t("web.chatwoot.forget")}
        </Button>
      </div>
      <ForgetDialog open={forget} onClose={() => setForget(false)} />
    </div>
  );
}

function Confirm({ status, onDone }: { status: ChatwootOwnerStatus; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const refresh = useRefresh();
  const [forget, setForget] = useState(false);
  const confirm = useMutation({
    mutationFn: () => api<ChatwootOwnerStatus>("/chatwoot/owner/confirm", { method: "POST" }),
    onSuccess: async (next) => {
      onDone();
      await refresh(next);
      toast(t("web.chatwoot.confirmed"));
    },
  });
  return (
    <div className="space-y-4">
      <Pill tone="wait">{t("web.chatwoot.toConfirm")}</Pill>
      {status.candidate && <p className="text-sm leading-6">{t("web.chatwoot.cameFrom", { name: status.candidate.name, id: status.candidate.id })}</p>}
      {confirm.isError && <ErrorNotice error={confirm.error} />}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => confirm.mutate()} loading={confirm.isPending}>
          {t("web.chatwoot.confirm")}
        </Button>
        <Button variant="ghost" onClick={() => setForget(true)} aria-haspopup="dialog">
          {t("web.chatwoot.forget")}
        </Button>
      </div>
      <ForgetDialog open={forget} onClose={() => setForget(false)} />
    </div>
  );
}

type KeyMode = "full" | "rotate" | "repair";

function Linked({ status, onCode }: { status: ChatwootOwnerStatus; onCode: (code: { code: string; expiresAt: string } | null) => void }) {
  const { t, dateTime, plural } = useI18n();
  const toast = useToast();
  const refresh = useRefresh();
  const switchHint = useId();
  const [testing, setTesting] = useState(false);
  const [keyMode, setKeyMode] = useState<KeyMode | null>(null);
  const [forget, setForget] = useState(false);
  const on = status.state === "on";
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api<ChatwootOwnerStatus>("/chatwoot/owner", { method: "PATCH", body: { enabled } }),
    onSuccess: async (next, enabled) => {
      await refresh(next);
      toast(t(enabled ? "web.chatwoot.turnedOn" : "web.chatwoot.turnedOff"));
    },
  });
  const relink = useMutation({
    mutationFn: () => api<ChatwootOwnerCode>("/chatwoot/owner/relink", { method: "POST" }),
    onSuccess: async (result) => {
      onCode({ code: result.code, expiresAt: result.expiresAt });
      await refresh(result.status);
      toast(t("web.chatwoot.relinkSent"));
    },
  });
  const unlock = useMutation({
    mutationFn: () => api<ChatwootOwnerStatus>("/chatwoot/owner/unlock", { method: "POST" }),
    onSuccess: async (next) => {
      await refresh(next);
      toast(t("web.chatwoot.unlocked"));
    },
  });
  const pause = status.pausedBy && status.pausedBy !== "owner" ? status.pausedBy : null;
  const switchable = !pause || CHATWOOT_OWNER_SWITCHABLE.includes(pause);
  const failure = toggle.error ?? relink.error ?? unlock.error;
  const lock = status.readLock;
  return (
    <div className="space-y-5">
      {pause && <Notice tone="warning">{t(PAUSE_TEXT[pause])}</Notice>}
      <div>
        <Switch label={t("web.chatwoot.switch")} checked={on} busy={toggle.isPending || (!on && !switchable)} describedBy={switchHint} onChange={(enabled) => toggle.mutate(enabled)} />
        <p id={switchHint} className="text-sm leading-6 text-fg-muted">
          {on ? t("web.chatwoot.switch.on", { date: dateTime(status.since ?? Date.now()) }) : t("web.chatwoot.switch.off")}
        </p>
      </div>
      <dl className="divide-y divide-border rounded-xl border border-border">
        {status.owner && (
          <Row label={t("web.chatwoot.answersOnly")} pill={<Pill tone="on">{t("web.chatwoot.linked")}</Pill>}>
            {t("web.chatwoot.agentLine", { name: status.owner.name, id: status.owner.id })}
            {status.owner.email && <span className="block break-all">{status.owner.email}</span>}
          </Row>
        )}
        {status.owner && (
          <Row
            label={t("web.chatwoot.lock")}
            pill={<Pill tone={lock.locked ? "wait" : "on"}>{t(lock.locked ? "web.chatwoot.lock.pillLocked" : "web.chatwoot.lock.pillOpen")}</Pill>}
          >
            {lock.locked || !lock.openUntil
              ? t("web.chatwoot.lock.locked", { hours: lock.hours })
              : t("web.chatwoot.lock.open", { when: dateTime(lock.openUntil), hours: lock.hours })}
            {lock.locked && (
              <span className="mt-2 block">
                <Button variant="secondary" onClick={() => unlock.mutate()} loading={unlock.isPending}>
                  <KeyRound className="h-4 w-4" aria-hidden />
                  {t("web.chatwoot.unlock")}
                </Button>
              </span>
            )}
          </Row>
        )}
        <Row label={t("web.chatwoot.members")} pill={<Pill tone="on">{t("web.chatwoot.onlyYou")}</Pill>}>
          {t("web.chatwoot.membersHint")}
        </Row>
        <Row
          label={t("web.chatwoot.alsoSee")}
          pill={status.admins && status.admins.length > 0 ? <Pill tone="wait">{plural("web.chatwoot.admins", status.admins.length)}</Pill> : undefined}
        >
          {status.admins === null
            ? t("web.chatwoot.alsoSeeUnknown")
            : status.admins.length === 0
              ? t("web.chatwoot.alsoSeeNone")
              : t("web.chatwoot.alsoSeeHint", { names: status.admins.join(", ") })}
        </Row>
      </dl>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("web.chatwoot.log")}</h3>
        {status.log.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("web.chatwoot.logEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {status.log.map((entry) => (
              <li key={`${entry.at}-${entry.event}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <time dateTime={entry.at} className="tabular-nums text-fg-muted">
                  {dateTime(entry.at)}
                </time>
                <span className="min-w-0 flex-1">{t(EVENT_TEXT[entry.event])}</span>
                <Pill tone={entry.ok ? "on" : "wait"}>{t(entry.ok ? "web.chatwoot.ok" : "web.chatwoot.notOk")}</Pill>
              </li>
            ))}
          </ul>
        )}
      </div>
      {failure && <p className="text-sm text-danger">{problemText(t, failure)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setTesting(true)} aria-haspopup="dialog">
          <CircleCheck className="h-4 w-4" aria-hidden />
          {t("web.chatwoot.test")}
        </Button>
        <Button variant="ghost" onClick={() => setKeyMode("rotate")} aria-haspopup="dialog">
          <KeyRound className="h-4 w-4" aria-hidden />
          {t("web.chatwoot.rotate")}
        </Button>
        <Button variant="ghost" onClick={() => setKeyMode("repair")} aria-haspopup="dialog">
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t("web.chatwoot.repair")}
        </Button>
        <Button variant="ghost" onClick={() => relink.mutate()} loading={relink.isPending}>
          <User className="h-4 w-4" aria-hidden />
          {t("web.chatwoot.relink")}
        </Button>
        <Button variant="ghost" onClick={() => setForget(true)} aria-haspopup="dialog">
          {t("web.chatwoot.forget")}
        </Button>
      </div>
      <TestDialog
        open={testing}
        onClose={() => setTesting(false)}
        onFull={() => {
          setTesting(false);
          setKeyMode("full");
        }}
        accountId={status.accountId}
      />
      <KeyDialog mode={keyMode} onClose={() => setKeyMode(null)} status={status} />
      <ForgetDialog open={forget} onClose={() => setForget(false)} />
    </div>
  );
}

function Row({ label, pill, children }: { label: string; pill?: React.ReactNode; children: React.ReactNode }) {
  return (
    // dt and dd straight under the row's div, as a description list asks; the pill rides along with the term.
    <div className="p-3">
      <dt className="flex flex-wrap items-start justify-between gap-3 text-sm font-medium">
        <span className="min-w-0 flex-1">{label}</span>
        {pill}
      </dt>
      <dd className="text-sm leading-6 text-fg-muted">{children}</dd>
    </div>
  );
}

function Recovery() {
  const { t } = useI18n();
  return (
    <Card title={t("web.chatwoot.recovery")} description={t("web.chatwoot.recovery.description")}>
      <ul className="divide-y divide-border">
        {RECOVERY.map((item) => (
          <li key={item.name} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0 flex-1 text-sm">
              <span className="block font-medium">{t(item.name)}</span>
              <span className="block leading-6 text-fg-muted">{t(item.hint)}</span>
            </span>
            <Pill tone={item.tone}>{t(item.tag)}</Pill>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Keys() {
  const { t } = useI18n();
  return (
    <Card title={t("web.chatwoot.keys")} description={t("web.chatwoot.keys.description")}>
      {/* A table on a computer; on a phone each key is its own block (no sideways scroll). */}
      <table className="hidden w-full text-left text-sm md:table">
        <thead className="text-fg-muted">
          <tr>
            <th scope="col" className="pb-2 pr-4 font-medium">
              {t("web.chatwoot.keys.col.key")}
            </th>
            <th scope="col" className="pb-2 pr-4 font-medium">
              {t("web.chatwoot.keys.col.can")}
            </th>
            <th scope="col" className="pb-2 font-medium">
              {t("web.chatwoot.keys.col.use")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {KEYS.map((key) => (
            <tr key={key.name} className="align-top">
              <th scope="row" className="py-3 pr-4 font-medium">
                {t(key.name)}
              </th>
              <td className="py-3 pr-4 leading-6 text-fg-muted">{t(key.can)}</td>
              <td className="py-3 leading-6 text-fg-muted">
                <Pill tone={key.tone}>{t(key.tag)}</Pill> {t(key.use)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border md:hidden">
        {KEYS.map((key) => (
          <li key={key.name} className="space-y-1 py-3 text-sm first:pt-0 last:pb-0">
            <p className="flex flex-wrap items-center justify-between gap-2 font-medium">
              {t(key.name)}
              <Pill tone={key.tone}>{t(key.tag)}</Pill>
            </p>
            <p className="leading-6 text-fg-muted">{t(key.can)}</p>
            <p className="leading-6 text-fg-muted">{t(key.use)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- The setup ----------

type Phase =
  | { at: "form" }
  | { at: "isYou"; profile: ChatwootOwnerProfile }
  | { at: "making" }
  | { at: "done"; code: ChatwootOwnerCode; name: string }
  | { at: "stopped"; error: unknown };

function SetupDialog({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: { code: string; expiresAt: string }) => void }) {
  const { t } = useI18n();
  const refresh = useRefresh();
  const [phase, setPhase] = useState<Phase>({ at: "form" });
  const [origin, setOrigin] = useState("");
  const [account, setAccount] = useState("1");
  // The key lives only in this dialog's state and goes when it closes.
  const [adminKey, setAdminKey] = useState("");
  const [fieldError, setFieldError] = useState<{ field: "origin" | "account" | "key"; text: string } | null>(null);
  const close = () => {
    setAdminKey("");
    setPhase({ at: "form" });
    setFieldError(null);
    onClose();
  };
  const input = () => ({ origin: origin.trim().replace(/\/+$/, ""), accountId: Number(account), adminKey: adminKey.trim() });
  const check = useMutation({
    mutationFn: () => api<{ profile: ChatwootOwnerProfile }>("/chatwoot/owner/check", { method: "POST", body: input() }),
    onSuccess: ({ profile }) => setPhase({ at: "isYou", profile }),
  });
  const make = useMutation({
    mutationFn: (profile: ChatwootOwnerProfile) => api<ChatwootOwnerCode>("/chatwoot/owner/setup", { method: "POST", body: { ...input(), ownerId: profile.id } }),
    onMutate: () => setPhase({ at: "making" }),
    onSuccess: async (result, profile) => {
      setAdminKey("");
      onCode({ code: result.code, expiresAt: result.expiresAt });
      setPhase({ at: "done", code: result, name: profile.name });
      await refresh(result.status);
    },
    onError: (error) => setPhase({ at: "stopped", error }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = input();
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value.origin)) return setFieldError({ field: "origin", text: t("web.chatwoot.setup.badOrigin") });
    if (!/^\d{1,9}$/.test(account.trim()) || value.accountId < 1) return setFieldError({ field: "account", text: t("web.chatwoot.setup.badAccount") });
    if (!value.adminKey) return setFieldError({ field: "key", text: t("web.chatwoot.setup.noKey") });
    setFieldError(null);
    check.mutate();
  };

  const title =
    phase.at === "isYou"
      ? t("web.chatwoot.setup.isYou")
      : phase.at === "making"
        ? t("web.chatwoot.setup.making")
        : phase.at === "done"
          ? t("web.chatwoot.setup.done")
          : phase.at === "stopped"
            ? t("web.chatwoot.setup.stopped")
            : t("web.chatwoot.setup.title");

  return (
    <Dialog open={open} onClose={close} title={title}>
      {phase.at === "form" && (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm leading-6 text-fg-muted">{t("web.chatwoot.setup.sub")}</p>
          <TextField
            label={t("web.chatwoot.setup.origin")}
            hint={t("web.chatwoot.setup.originHint")}
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            error={fieldError?.field === "origin" ? fieldError.text : null}
            required
          />
          <TextField
            label={t("web.chatwoot.setup.account")}
            hint={t("web.chatwoot.setup.accountHint")}
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            inputMode="numeric"
            maxLength={9}
            error={fieldError?.field === "account" ? fieldError.text : null}
            required
          />
          <PasswordField
            label={t("web.chatwoot.setup.key")}
            hint={t("web.chatwoot.setup.keyHint")}
            placeholder={t("web.chatwoot.setup.keyPlaceholder")}
            value={adminKey}
            onChange={(event) => setAdminKey(event.target.value)}
            autoComplete="off"
            maxLength={500}
            error={fieldError?.field === "key" ? fieldError.text : null}
            required
          />
          {check.isError && (
            <p role="alert" className="text-sm text-danger">
              {problemText(t, check.error, Number(account))}
            </p>
          )}
          {check.isPending && (
            <p role="status" className="inline-flex items-center gap-2 text-sm text-fg-muted">
              <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
              {t("web.chatwoot.setup.checking")}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {t("web.cancel")}
            </Button>
            <Button type="submit" loading={check.isPending}>
              {t("web.chatwoot.setup.continue")}
            </Button>
          </div>
        </form>
      )}

      {phase.at === "isYou" && (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-fg-muted">{t("web.chatwoot.setup.isYouSub")}</p>
          <div className="flex items-start gap-3 rounded-xl border border-border p-3">
            <User className="mt-0.5 h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="font-semibold break-words">{phase.profile.name}</p>
              <p className="leading-6 break-all text-fg-muted">
                {phase.profile.email
                  ? t("web.chatwoot.setup.who", { email: phase.profile.email, id: phase.profile.id, account: Number(account) })
                  : t("web.chatwoot.setup.whoNoEmail", { id: phase.profile.id, account: Number(account) })}
              </p>
            </div>
          </div>
          <p className="flex gap-2 text-sm leading-6">
            <TriangleAlert className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden />
            {t("web.chatwoot.setup.notYourKey")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {t("web.chatwoot.setup.notMe")}
            </Button>
            <Button onClick={() => make.mutate(phase.profile)} loading={make.isPending}>{t("web.chatwoot.setup.isMe")}</Button>
          </div>
        </div>
      )}

      {phase.at === "making" && (
        <div className="space-y-4" role="status">
          <p className="text-sm leading-6 text-fg-muted">{t("web.chatwoot.setup.makingSub")}</p>
          <Steps done={-1} running />
        </div>
      )}

      {phase.at === "done" && (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-fg-muted">{t("web.chatwoot.setup.doneSub")}</p>
          <Steps done={CHATWOOT_OWNER_STEPS.length - 1} />
          <p className="text-sm font-semibold">{t("web.chatwoot.setup.answer", { code: phase.code.code })}</p>
          {phase.name && <p className="text-sm leading-6 text-fg-muted">{t("web.chatwoot.setup.answerHint", { name: phase.name })}</p>}
          <div className="flex justify-end">
            <Button onClick={close}>{t("web.chatwoot.setup.understood")}</Button>
          </div>
        </div>
      )}

      {phase.at === "stopped" && <Stopped error={phase.error} accountId={Number(account)} onAgain={() => setPhase({ at: "form" })} onClose={close} />}
    </Dialog>
  );
}

function Stopped({ error, accountId, onAgain, onClose }: { error: unknown; accountId: number; onAgain: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const details = error instanceof ApiError ? error.details : {};
  const step = typeof details.step === "string" ? CHATWOOT_OWNER_STEPS.indexOf(details.step as ChatwootOwnerStep) : -1;
  // Only a step that stopped says whether it was undone; a refusal before any step (a limit, a key swapped) made nothing.
  const undone = typeof details.undone === "boolean" ? details.undone : null;
  return (
    <div className="space-y-4">
      {undone !== null && <p className="text-sm leading-6 text-fg-muted">{t(undone ? "web.chatwoot.setup.undone" : "web.chatwoot.setup.notUndone")}</p>}
      {step >= 0 && <Steps done={step - 1} failed={step} />}
      <p role="alert" className="text-sm text-danger">
        {problemText(t, error, accountId)}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("web.cancel")}
        </Button>
        <Button onClick={onAgain}>{t("web.chatwoot.setup.again")}</Button>
      </div>
    </div>
  );
}

// ---------- The test and the key again ----------

function Checks({ test, accountId }: { test: ChatwootOwnerTest; accountId: number | null }) {
  const { t } = useI18n();
  const line = (check: ChatwootOwnerCheckResult): string => {
    const text = CHECK_TEXT[check.check];
    if (check.check === "admins") return check.names && check.names.length > 0 ? t("web.chatwoot.check.admins.some", { names: check.names.join(", ") }) : t(text.ok);
    if (check.ok) return t(text.ok, { account: accountId ?? "" });
    if (check.check === "members" && check.names) return t("web.chatwoot.check.members.bad", { names: check.names.join(", ") });
    if (check.problem && (check.check === "reach" || !text.bad)) return t(PROBLEM_TEXT[check.problem], { name: "", account: accountId ?? "" });
    return text.bad ? t(text.bad) : t("web.chatwoot.notOk");
  };
  return (
    <ol className="space-y-3">
      {test.checks.map((check) => {
        const warn = check.check === "admins" && (check.names?.length ?? 0) > 0;
        const Icon = !check.ok ? CircleX : warn ? CircleAlert : CircleCheck;
        return (
          <li key={check.check} className="flex gap-3 text-sm">
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", !check.ok ? "text-danger" : warn ? "text-warning" : "text-success")} aria-hidden />
            <span className="min-w-0">
              <span className="block font-medium">
                {t(CHECK_TEXT[check.check].label)}
                <span className="sr-only">{`: ${t(check.ok ? "web.chatwoot.ok" : "web.chatwoot.notOk")}`}</span>
              </span>
              <span className="block leading-6 break-words text-fg-muted">{line(check)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function TestResult({ test, full, accountId }: { test: ChatwootOwnerTest; full: boolean; accountId: number | null }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <p role="status" className="text-sm font-semibold">
        {test.ok ? t("web.chatwoot.testOk") : test.paused ? t("web.chatwoot.testPaused") : t("web.chatwoot.testFailed")}
      </p>
      <Checks test={test} accountId={accountId} />
      {!full && <p className="text-sm leading-6 text-fg-muted">{t("web.chatwoot.fullHint")}</p>}
    </div>
  );
}

function TestDialog({ open, onClose, onFull, accountId }: { open: boolean; onClose: () => void; onFull: () => void; accountId: number | null }) {
  const { t } = useI18n();
  const refresh = useRefresh();
  // One test per opening: the dialog asks once, and the answer stays until it closes.
  const test = useQuery({
    // Outside the status's key: refreshing the status inside the test would cancel the test itself.
    queryKey: ["chatwoot-owner-test"],
    queryFn: async () => {
      const result = await api<ChatwootOwnerTest>("/chatwoot/owner/test", { method: "POST" });
      await refresh();
      return result;
    },
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <Dialog open={open} onClose={onClose} title={t("web.chatwoot.testTitle")}>
      {test.isPending && (
        <p role="status" className="inline-flex items-center gap-2 text-sm text-fg-muted">
          <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
          {t("web.chatwoot.testing")}
        </p>
      )}
      {test.isError && <ErrorNotice error={test.error} onRetry={() => void test.refetch()} />}
      {test.data && <TestResult test={test.data} full={false} accountId={accountId} />}
      <div className="flex flex-wrap justify-end gap-2">
        {test.data && (
          <Button variant="secondary" onClick={onFull} aria-haspopup="dialog">
            {t("web.chatwoot.full")}
          </Button>
        )}
        <Button onClick={onClose} disabled={test.isPending}>
          {t("web.chatwoot.done")}
        </Button>
      </div>
    </Dialog>
  );
}

const KEY_TITLE: Record<KeyMode, Key> = { full: "web.chatwoot.fullTitle", rotate: "web.chatwoot.rotate", repair: "web.chatwoot.repair" };
const KEY_WHY: Record<KeyMode, Key> = { full: "web.chatwoot.fullWhy", rotate: "web.chatwoot.rotateWhy", repair: "web.chatwoot.repairWhy" };

/** The administrator's key again, for the full test, new secrets or Repair: this request only. */
function KeyDialog({ mode, onClose, status }: { mode: KeyMode | null; onClose: () => void; status: ChatwootOwnerStatus }) {
  const { t } = useI18n();
  const toast = useToast();
  const refresh = useRefresh();
  const [adminKey, setAdminKey] = useState("");
  const [origin, setOrigin] = useState("");
  const [missing, setMissing] = useState(false);
  const [result, setResult] = useState<ChatwootOwnerTest | null>(null);
  const run = useMutation({
    mutationFn: async (which: KeyMode) => {
      const key = adminKey.trim();
      if (which === "repair") {
        const moved = origin.trim().replace(/\/+$/, "");
        const next = await api<ChatwootOwnerStatus>("/chatwoot/owner/repair", { method: "POST", body: moved && moved !== status.origin ? { adminKey: key, origin: moved } : { adminKey: key } });
        return { which, next };
      }
      const test = await api<ChatwootOwnerTest>(which === "full" ? "/chatwoot/owner/test/full" : "/chatwoot/owner/rotate", { method: "POST", body: { adminKey: key } });
      return { which, test };
    },
    onSuccess: async (answer) => {
      setAdminKey("");
      if ("next" in answer) {
        await refresh(answer.next);
        toast(t("web.chatwoot.repaired"));
        close();
        return;
      }
      setResult(answer.test);
      await refresh();
      if (answer.which === "rotate") toast(t("web.chatwoot.rotated"));
    },
  });
  const close = () => {
    setAdminKey("");
    setOrigin("");
    setMissing(false);
    setResult(null);
    run.reset();
    onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mode) return;
    if (!adminKey.trim()) return setMissing(true);
    setMissing(false);
    run.mutate(mode);
  };
  return (
    <Dialog open={mode !== null} onClose={close} title={mode ? t(KEY_TITLE[mode]) : ""}>
      {mode && result ? (
        <>
          <TestResult test={result} full accountId={status.accountId} />
          <div className="flex justify-end">
            <Button onClick={close}>{t("web.chatwoot.done")}</Button>
          </div>
        </>
      ) : (
        mode && (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <p className="text-sm leading-6 text-fg-muted">{t(KEY_WHY[mode])}</p>
            {mode === "repair" && (
              <TextField
                label={t("web.chatwoot.repairOrigin")}
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
                placeholder={status.origin ?? ""}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
              />
            )}
            <PasswordField
              label={t("web.chatwoot.adminKey")}
              hint={t("web.chatwoot.adminKeyHint")}
              value={adminKey}
              onChange={(event) => setAdminKey(event.target.value)}
              autoComplete="off"
              maxLength={500}
              error={missing ? t("web.chatwoot.adminKeyMissing") : null}
              required
            />
            {run.isPending && mode !== "repair" && (
              <p role="status" className="inline-flex items-center gap-2 text-sm text-fg-muted">
                <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
                {t("web.chatwoot.testing")}
              </p>
            )}
            {run.isError && (
              <p role="alert" className="text-sm text-danger">
                {problemText(t, run.error, status.accountId ?? undefined)}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                {t("web.cancel")}
              </Button>
              <Button type="submit" loading={run.isPending}>
                {t("web.chatwoot.setup.continue")}
              </Button>
            </div>
          </form>
        )
      )}
    </Dialog>
  );
}

function ForgetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const refresh = useRefresh();
  const forget = useMutation({
    mutationFn: () => api("/chatwoot/owner", { method: "DELETE" }),
    onSuccess: async () => {
      onClose();
      await refresh();
      toast(t("web.chatwoot.forgotten"));
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title={t("web.chatwoot.forgetTitle")}>
      <p className="text-sm leading-6 text-fg-muted">{t("web.chatwoot.forgetBody")}</p>
      {forget.isError && <ErrorNotice error={forget.error} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("web.cancel")}
        </Button>
        <Button variant="danger" onClick={() => forget.mutate()} loading={forget.isPending}>
          {t("web.chatwoot.forget")}
        </Button>
      </div>
    </Dialog>
  );
}
