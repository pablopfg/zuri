import { type FormEvent, useEffect, useState } from "react";
import { errorMessage } from "../lib/api.ts";
import { useToast } from "./Toaster.tsx";
import { Button, TextField } from "./ui.tsx";

export interface NumberField<K extends string> {
  key: K;
  label: string;
  hint: string;
  min: number;
  max: number;
}

/**
 * Whole numbers the owner sets together, each inside its limits. The server holds the limits too; here
 * they only keep the form from sending a number it would refuse. Nothing changed or a number outside
 * its limits: nothing to save.
 */
export function NumbersForm<K extends string>({
  fields,
  values,
  saveLabel,
  savedLabel,
  onSave,
}: {
  fields: readonly NumberField<K>[];
  values: Record<K, number>;
  saveLabel: string;
  savedLabel: string;
  /** Only the numbers that changed. */
  onSave: (changed: Partial<Record<K, number>>) => Promise<void>;
}) {
  const toast = useToast();
  const text = () => Object.fromEntries(fields.map((field) => [field.key, String(values[field.key])])) as Record<K, string>;
  const [typed, setTyped] = useState(text);
  const [saving, setSaving] = useState(false);
  // What the server holds moved (another tab, or this save): start from it again.
  const held = fields.map((field) => values[field.key]).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `held` is the values, as one string.
  useEffect(() => setTyped(text()), [held]);
  const valid = fields.every((field) => /^\d+$/.test(typed[field.key].trim()) && Number(typed[field.key]) >= field.min && Number(typed[field.key]) <= field.max);
  const changed = Object.fromEntries(fields.filter((field) => Number(typed[field.key]) !== values[field.key]).map((field) => [field.key, Number(typed[field.key])])) as Partial<Record<K, number>>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await onSave(changed);
      toast(savedLabel);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <TextField
            key={field.key}
            label={field.label}
            hint={field.hint}
            type="number"
            inputMode="numeric"
            min={field.min}
            max={field.max}
            step={1}
            required
            value={typed[field.key]}
            onChange={(e) => setTyped((now) => ({ ...now, [field.key]: e.target.value }))}
          />
        ))}
      </div>
      <Button type="submit" loading={saving} disabled={!valid || Object.keys(changed).length === 0}>
        {saveLabel}
      </Button>
    </form>
  );
}
