import { Star } from "lucide-react";
import { cn } from "../../components/ui.tsx";
import { useI18n } from "../../lib/i18n.tsx";
import { mark } from "./numbers.ts";

/** The rating as five stars with one spoken name; a review without a rating says so. */
export function Stars({ rating }: { rating: number }) {
  const { t } = useI18n();
  if (rating === 0) return <span className="text-xs text-fg-muted">{t("web.reviews.unrated")}</span>;
  return (
    <span role="img" aria-label={t("web.reviews.stars.label", { n: rating })} className="inline-flex shrink-0 gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden className={cn("h-3.5 w-3.5", n <= rating ? "fill-current text-warning" : "text-border-strong")} />
      ))}
    </span>
  );
}

/** The reviewer's round mark: one letter of the first name. Google's photo never reaches the screen. */
export function Mark({ firstName, anonymous, big }: { firstName: string; anonymous: boolean; big?: boolean }) {
  return (
    <span aria-hidden className="zuri-contact-mark" data-big={big ? "" : undefined}>
      {mark(firstName, anonymous)}
    </span>
  );
}
