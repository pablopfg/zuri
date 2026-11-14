import { useQueryClient } from "@tanstack/react-query";
import { FLOW_LIMITS, type FlowConnection } from "@zuri/shared";
import { type FormEvent, useState } from "react";
import { useToast } from "../../../components/Toaster.tsx";
import { Button, Dialog, ErrorNotice, TextField } from "../../../components/ui.tsx";
import { api } from "../../../lib/api.ts";
import { useI18n } from "../../../lib/i18n.tsx";

const FLOWS_KEY = ["flows"] as const;

/** The address as the server keeps it (lower case, no :443, no trailing slash), so typing it again isn't a move (QA-E6b-06). */
function sameOrigin(value: string): string {
  const typed = value.trim();
  try {
    const url = new URL(typed);
    return url.pathname === "/" && !url.search && !url.hash ? url.origin : typed;
  } catch {
    return typed;
  }
}

/**
 * A fzap credential (E6b, docs/planos/credencial-fzap.md): the instance's https address and its
 * token. The token goes to the server once and never comes back; a new address asks for it again,
 * since it belongs to that instance. "Testar", in the list, reads the session's state.
 */
export function FzapDialog({ current, onClose }: { current: FlowConnection | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(current?.name ?? t("web.flows.fzap.nameDefault"));
  const [origin, setOrigin] = useState(current?.origin ?? "");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const moved = current !== null && sameOrigin(origin) !== current.origin;
  const keyMissing = credential.trim() === "" && (current === null || moved);
  const ready = name.trim() !== "" && origin.trim() !== "" && !keyMissing;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const key = credential.trim() !== "" ? { credential: credential.trim() } : {};
      if (current) {
        const patch: Record<string, unknown> = { ...key };
        if (name.trim() !== current.name) patch.name = name.trim();
        if (moved) patch.origin = origin.trim();
        if (Object.keys(patch).length > 0) await api(`/flows/connections/${current.id}`, { method: "PATCH", body: patch });
      } else {
        await api("/flows/connections", { method: "POST", body: { kind: "fzap", name: name.trim(), origin: origin.trim(), ...key } });
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

  return (
    <Dialog open onClose={onClose} title={current ? t("web.flows.connection.editTitle") : t("web.flows.fzap.newTitle")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm leading-6 text-fg-muted">{t("web.flows.fzap.intro")}</p>
        <TextField label={t("web.flows.connection.name")} value={name} maxLength={FLOW_LIMITS.name} required onChange={(e) => setName(e.target.value)} />
        <TextField
          label={t("web.flows.fzap.origin")}
          hint={t("web.flows.fzap.originHint")}
          type="url"
          inputMode="url"
          spellCheck={false}
          value={origin}
          maxLength={FLOW_LIMITS.siteUrl}
          required
          onChange={(e) => setOrigin(e.target.value)}
        />
        <TextField
          label={t("web.flows.fzap.key")}
          hint={t("web.flows.fzap.keyHint")}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          placeholder={current ? t("web.flows.fzap.keyKeep") : undefined}
          value={credential}
          maxLength={FLOW_LIMITS.credential}
          required={current === null || moved}
          error={moved && credential.trim() === "" ? t("web.flows.fzap.keyAgain") : null}
          onChange={(e) => setCredential(e.target.value)}
        />
        <p className="text-xs leading-5 text-fg-muted">{t("web.flows.fzap.passwordNote")}</p>
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
