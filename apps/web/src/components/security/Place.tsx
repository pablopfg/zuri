import type { AuthActivityEvent } from "@zuri/shared";
import { MapPin } from "lucide-react";
import { useI18n } from "../../lib/i18n.tsx";
import { cn } from "../ui.tsx";
import { placeParts } from "./activity.ts";

/**
 * Where an access came from (E12a): "Curitiba, PR · Brasil BR", the country in
 * bold with its code, and "outside Brazil" in words when it isn't home, so the
 * warning never rests on color alone. The activity card and the access log
 * show the same line.
 */
export function Place({ event, className }: { event: Pick<AuthActivityEvent, "city" | "region" | "country">; className?: string }) {
  const { t, locale } = useI18n();
  const { city, country, code, abroad } = placeParts(event, locale, t);
  return (
    <span className={cn("flex items-start gap-1.5", className)}>
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">
        {country ? (
          <>
            {city || t("web.activity.cityUnknown")}
            {" · "}
            {/* The name and its code stay together when the line wraps. */}
            <span className="whitespace-nowrap">
              <b className={cn("font-semibold", abroad ? "text-warning" : "text-fg")}>{country}</b>{" "}
              <span className="rounded border border-border bg-raised px-1.5 align-[1px] font-mono text-xs leading-4 text-fg-muted">{code}</span>
            </span>
            {abroad && (
              <>
                {" · "}
                <span className="font-semibold text-warning">{t("web.activity.abroad")}</span>
              </>
            )}
          </>
        ) : (
          city || t("web.activity.placeUnknown")
        )}
      </span>
    </span>
  );
}
