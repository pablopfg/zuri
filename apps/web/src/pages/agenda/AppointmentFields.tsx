import { COUNTRY_DIAL, HOME_COUNTRY } from "@zuri/shared";
import { type ComponentProps, useEffect, useMemo, useState } from "react";
import { SelectField, TextField } from "../../components/ui.tsx";
import { dateOf, dateText, maskDate, maskTime, timeOf } from "../../lib/agenda-fields.ts";
import { useI18n } from "../../lib/i18n.tsx";

type InputProps = Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & { label: string; error?: string | null; hint?: string };

/**
 * A field that keeps what is typed while it is not a whole value yet, and gives the form the value once
 * it is one ("" until then). A value set from outside (the mini calendar, "Usar este horário") takes
 * the place of what was typed.
 */
function MaskedField({
  value,
  show,
  read,
  mask,
  onValue,
  ...rest
}: InputProps & { value: string; show: (value: string) => string; read: (text: string) => string | null; mask: (text: string) => string; onValue: (value: string) => void }) {
  const [text, setText] = useState(() => show(value));
  useEffect(() => {
    // Only a value that differs from what the text already says: typing never jumps the cursor.
    setText((old) => ((read(old) ?? "") === value ? old : show(value)));
  }, [value, read, show]);
  return (
    <TextField
      {...rest}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      className={rest.className}
      value={text}
      onChange={(e) => {
        const next = mask(e.target.value);
        setText(next);
        onValue(read(next) ?? "");
      }}
    />
  );
}

const sameTime = (value: string) => value;

/** "dd/mm/aaaa", whatever the device's language (12/11/2026): the form keeps the ISO day. */
export function DateField(props: InputProps & { value: string; onValue: (day: string) => void }) {
  const { t } = useI18n();
  return <MaskedField {...props} show={dateText} read={dateOf} mask={maskDate} placeholder={t("web.agenda.form.datePlaceholder")} maxLength={10} />;
}

/** "hh:mm" from 00:00 to 23:59, never AM or PM. `list` names the hours it suggests. */
export function TimeField(props: InputProps & { value: string; onValue: (time: string) => void }) {
  const { t } = useI18n();
  return <MaskedField {...props} show={sameTime} read={timeOf} mask={maskTime} placeholder={t("web.agenda.form.timePlaceholder")} maxLength={5} />;
}

/** Every country, Brazil first and the rest by name in the owner's language, from the browser itself. */
export function CountryField({ value, onChange, disabled }: { value: string; onChange: (code: string) => void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const options = useMemo(() => {
    let name = (code: string) => code;
    try {
      const names = new Intl.DisplayNames([locale], { type: "region" });
      name = (code) => names.of(code) ?? code;
    } catch {
      // An old browser without region names shows the codes.
    }
    return Object.entries(COUNTRY_DIAL)
      .map(([code, dial]) => ({ code, label: `${code} ${name(code)} (${dial})`, name: name(code) }))
      .sort((a, b) => (a.code === HOME_COUNTRY ? -1 : b.code === HOME_COUNTRY ? 1 : a.name.localeCompare(b.name, locale)));
  }, [locale]);
  return (
    <SelectField label={t("web.agenda.form.country")} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.label}
        </option>
      ))}
    </SelectField>
  );
}
