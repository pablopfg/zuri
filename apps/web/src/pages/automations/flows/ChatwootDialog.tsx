import { useQueryClient } from "@tanstack/react-query";
import { CHATWOOT_LIMITS, type ChatwootInbox, chatwootGapsProblem, FLOW_LIMITS, type FlowConnection, type FlowConnectionTest, type FlowGap } from "@zuri/shared";
import { type FormEvent, useId, useState } from "react";
import { useToast } from "../../../components/Toaster.tsx";
import { Button, Dialog, ErrorNotice, SelectField, TextField } from "../../../components/ui.tsx";
import { api, errorMessage } from "../../../lib/api.ts";
import { useI18n } from "../../../lib/i18n.tsx";
import { PROBLEM_LABEL } from "./labels.ts";

const FLOWS_KEY = ["flows"] as const;

/** A number field's text as a whole number, or NaN while it isn't one. */
function whole(value: string): number {
  return /^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
}

/**
 * A Chatwoot credential (PR S17): the address, the account, the key of the
 * "Zuri" agent, the inbox and the two waits. The key goes to the server once
 * and never comes back; a new address or account asks for it again. The inbox
 * is picked from what the saved key sees, so it appears once the credential
 * is saved.
 */
export function ChatwootDialog({ current, onClose }: { current: FlowConnection | null; onClose: () => void }) {
  const { t, plural } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const settings = current?.chatwoot ?? null;
  const [name, setName] = useState(current?.name ?? "");
  const [origin, setOrigin] = useState(current?.origin ?? "");
  const [account, setAccount] = useState(String(settings?.accountId ?? 1));
  const [credential, setCredential] = useState("");
  const [inbox, setInbox] = useState(settings?.inboxId ? String(settings.inboxId) : "");
  const [inboxes, setInboxes] = useState<ChatwootInbox[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookProblem, setLookProblem] = useState<string | null>(null);
  const [bulk, setBulk] = useState({ min: String(settings?.bulkGap.min ?? CHATWOOT_LIMITS.bulkGap.min), max: String(settings?.bulkGap.max ?? CHATWOOT_LIMITS.bulkGap.max) });
  const [one, setOne] = useState({ min: String(settings?.oneGap.min ?? CHATWOOT_LIMITS.oneGap.min), max: String(settings?.oneGap.max ?? CHATWOOT_LIMITS.oneGap.max) });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const statusId = useId();

  const bulkGap: FlowGap = { min: whole(bulk.min), max: whole(bulk.max) };
  const oneGap: FlowGap = { min: whole(one.min), max: whole(one.max) };
  const gapsProblem = chatwootGapsProblem(bulkGap, oneGap);
  const accountId = whole(account);
  const accountOk = Number.isInteger(accountId) && accountId >= 1 && accountId <= CHATWOOT_LIMITS.accountMax;
  // The key belongs to that server and that account: a new one of either needs it typed again.
  const moved = current !== null && (origin.trim() !== current.origin || accountId !== settings?.accountId);
  const keyMissing = credential.trim() === "" && (current === null || moved);
  const ready = name.trim() !== "" && origin.trim() !== "" && accountOk && gapsProblem === null && !keyMissing;

  async function lookUp() {
    if (!current || looking) return;
    setLooking(true);
    setLookProblem(null);
    try {
      const { test } = await api<{ test: FlowConnectionTest }>(`/flows/connections/${current.id}/test`, { method: "POST" });
      if (test.ok && test.inboxes) {
        setInboxes(test.inboxes);
        if (test.inboxes.length === 0) setLookProblem(t("web.flows.chatwoot.noInboxes"));
      } else if (!test.ok) setLookProblem(t(PROBLEM_LABEL[test.problem]));
    } catch (err) {
      setLookProblem(errorMessage(err));
    } finally {
      setLooking(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const key = credential.trim() !== "" ? { credential: credential.trim() } : {};
      if (current) {
        // Only what changed: the waits alone ask for no password.
        const patch: Record<string, unknown> = { ...key };
        if (name.trim() !== current.name) patch.name = name.trim();
        if (origin.trim() !== current.origin) patch.origin = origin.trim();
        if (accountId !== settings?.accountId) patch.accountId = accountId;
        if (bulkGap.min !== settings?.bulkGap.min || bulkGap.max !== settings?.bulkGap.max) patch.bulkGap = bulkGap;
        if (oneGap.min !== settings?.oneGap.min || oneGap.max !== settings?.oneGap.max) patch.oneGap = oneGap;
        const picked = inbox === "" ? null : Number(inbox);
        if (!moved && picked !== (settings?.inboxId ?? null)) patch.inboxId = picked;
        if (Object.keys(patch).length > 0) await api(`/flows/connections/${current.id}`, { method: "PATCH", body: patch });
      } else {
        await api("/flows/connections", { method: "POST", body: { kind: "chatwoot", name: name.trim(), origin: origin.trim(), accountId, bulkGap, oneGap, ...key } });
      }
      await qc.invalidateQueries({ queryKey: FLOWS_KEY });
      toast(t(current ? "web.flows.connections.saved" : "web.flows.connections.created"));
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      // Typed once: whatever happened, the field doesn't keep it.
      setCredential("");
      setSaving(false);
    }
  }

  const options = inboxes ?? (settings?.inboxId ? [{ id: settings.inboxId, name: settings.inboxName ?? String(settings.inboxId), api: true }] : []);
  return (
    <Dialog open onClose={onClose} title={current ? t("web.flows.connection.editTitle") : t("web.flows.chatwoot.newTitle")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm leading-6 text-fg-muted">{t("web.flows.chatwoot.intro")}</p>
        <TextField
          label={t("web.flows.connection.name")}
          placeholder={t("web.flows.chatwoot.namePlaceholder")}
          value={name}
          maxLength={FLOW_LIMITS.name}
          required
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <TextField
            label={t("web.flows.chatwoot.origin")}
            hint={t("web.flows.connection.originHint")}
            type="url"
            inputMode="url"
            spellCheck={false}
            value={origin}
            maxLength={FLOW_LIMITS.siteUrl}
            required
            onChange={(e) => setOrigin(e.target.value)}
          />
          <TextField
            label={t("web.flows.chatwoot.account")}
            inputMode="numeric"
            value={account}
            maxLength={9}
            required
            error={accountOk ? null : t("web.flows.chatwoot.accountError")}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
        <TextField
          label={t("web.flows.chatwoot.key")}
          hint={t(current ? "web.flows.chatwoot.keyKeep" : "web.flows.chatwoot.keyHint")}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={credential}
          maxLength={FLOW_LIMITS.credential}
          required={current === null || moved}
          error={moved && credential.trim() === "" ? t("web.flows.connection.keyAgain") : null}
          onChange={(e) => setCredential(e.target.value)}
        />
        {current ? (
          <div className="space-y-2">
            <SelectField label={t("web.flows.chatwoot.inbox")} hint={t("web.flows.chatwoot.inboxHint")} value={inbox} disabled={moved} onChange={(e) => setInbox(e.target.value)}>
              <option value="">{t("web.flows.chatwoot.inboxNone")}</option>
              {options.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.api ? item.name : t("web.flows.chatwoot.inboxOther", { name: item.name })}
                </option>
              ))}
            </SelectField>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" loading={looking} disabled={moved} onClick={() => void lookUp()} aria-describedby={statusId}>
                {t("web.flows.chatwoot.lookUp")}
              </Button>
              <span id={statusId} role="status" className="text-sm text-fg-muted">
                {lookProblem ?? (inboxes ? plural("web.flows.chatwoot.found", inboxes.length) : "")}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-5 text-fg-muted">{t("web.flows.chatwoot.inboxLater")}</p>
        )}
        <Gap
          legend={t("web.flows.chatwoot.bulkLegend")}
          hint={t("web.flows.chatwoot.bulkHint", { floor: CHATWOOT_LIMITS.bulkGap.floor, ceiling: CHATWOOT_LIMITS.bulkGap.ceiling, min: CHATWOOT_LIMITS.bulkGap.min, max: CHATWOOT_LIMITS.bulkGap.max })}
          value={bulk}
          onChange={setBulk}
          error={gapsProblem === "bulkGap" ? t("web.flows.chatwoot.bulkError") : null}
        />
        <Gap
          legend={t("web.flows.chatwoot.oneLegend")}
          hint={t("web.flows.chatwoot.oneHint", { floor: CHATWOOT_LIMITS.oneGap.floor, ceiling: CHATWOOT_LIMITS.oneGap.ceiling, min: CHATWOOT_LIMITS.oneGap.min, max: CHATWOOT_LIMITS.oneGap.max })}
          value={one}
          onChange={setOne}
          error={gapsProblem === "oneGap" ? t("web.flows.chatwoot.oneError") : null}
        />
        <p className="text-xs leading-5 text-fg-muted">{t("web.flows.chatwoot.passwordNote")}</p>
        {error !== null && <ErrorNotice error={error} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("web.flows.cancel")}
          </Button>
          <Button type="submit" loading={saving} disabled={!ready}>
            {t(current ? "web.flows.connection.save" : "web.flows.connection.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** "De" and "Até" of a wait, in seconds. */
function Gap({
  legend,
  hint,
  value,
  onChange,
  error,
}: {
  legend: string;
  hint: string;
  value: { min: string; max: string };
  onChange: (value: { min: string; max: string }) => void;
  error: string | null;
}) {
  const { t } = useI18n();
  const hintId = useId();
  return (
    <fieldset className="space-y-1.5" aria-describedby={hintId}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid grid-cols-2 gap-4">
        <TextField label={t("web.flows.chatwoot.from")} inputMode="numeric" maxLength={3} value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} />
        <TextField label={t("web.flows.chatwoot.to")} inputMode="numeric" maxLength={3} value={value.max} onChange={(e) => onChange({ ...value, max: e.target.value })} />
      </div>
      <p id={hintId} className="text-xs leading-5 text-fg-muted">
        {hint}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
