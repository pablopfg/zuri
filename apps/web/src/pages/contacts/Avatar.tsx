import { useState } from "react";
import { initials } from "./person.ts";

/** Only Google's photo hosts (the ones the CSP lets images from) over https are ever drawn; the server checks it too. */
function photoSrc(photo: string | null): string | null {
  if (!photo) return null;
  try {
    const url = new URL(photo);
    return url.protocol === "https:" && /^lh[3-6]\.googleusercontent\.com$/.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The round mark of a contact: the photo from Google Contacts when there is
 * one, the initials otherwise (and whenever the photo does not load). The
 * image comes straight from Google, with no referrer; Zuri keeps no copy.
 */
export function Avatar({ name, photo, big }: { name: string | null; photo: string | null; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : photoSrc(photo);
  return (
    <span aria-hidden className="zuri-contact-mark" data-big={big ? "" : undefined}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full rounded-full object-cover" onError={() => setFailed(true)} /> : (name && initials(name)) || "?"}
    </span>
  );
}
