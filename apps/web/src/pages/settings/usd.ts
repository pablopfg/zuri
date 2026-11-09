import { useI18n } from "../../lib/i18n.tsx";

/** US$ as the owner reads it: cents, or down to a hundredth of a cent for the small amounts of a cheap model. */
export function useUsd() {
  const { locale } = useI18n();
  return (value: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 1 ? 4 : 2 }).format(value);
}
