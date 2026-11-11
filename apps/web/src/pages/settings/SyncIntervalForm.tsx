import type { MessageKey } from "@zuri/shared";
import { type FormEvent, useEffect, useState } from "react";
import { useToast } from "../../components/Toaster.tsx";
import { Button, TextField } from "../../components/ui.tsx";
import { errorMessage } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

/**
 * How often a sync with Google runs by itself, in minutes (the contacts' sync and the reviews' check
 * each have one). The server holds the limits too; here they only keep the field from sending a
 * number it would refuse.
 */
export function SyncIntervalForm({
  label,
  minutes,
  min,
  max,
  nextAt,
  onSave,
}: {
  label: MessageKey;
  minutes: number;
  min: number;
  max: number;
  /** UTC ISO of the next read by itself, when one is planned. */
  nextAt: string | null;
  onSave: (minutes: number) => Promise<void>;
}) {
  const { t, dateTime } = useI18n();
  const toast = useToast();
  const [value, setValue] = useState(String(minutes));
  const [saving, setSaving] = useState(false);
  // What the server holds moved (another tab): start from it again.
  useEffect(() => setValue(String(minutes)), [minutes]);
  const typed = Number(value);
  const valid = /^\d+$/.test(value.trim()) && typed >= min && typed <= max;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await onSave(typed);
      toast(t("web.sync.interval.saved"));
    } catch (failure) {
      toast(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-3 rounded-xl border border-border p-3">
      <TextField
        label={t(label)}
        hint={t("web.sync.interval.hint", { min, max })}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" loading={saving} disabled={!valid || typed === minutes}>
        {t("web.sync.interval.save")}
      </Button>
      {nextAt && Date.parse(nextAt) > Date.now() && (
        <p className="text-xs text-fg-muted" role="status">
          {t("web.sync.interval.next", { when: dateTime(nextAt) })}
        </p>
      )}
    </form>
  );
}
