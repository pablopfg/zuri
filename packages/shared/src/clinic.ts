// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";

/**
 * The office's details (E6a, Configurações › Consultório): one place for the whole system. The
 * confirmation page, the messages to patients and the in-person appointment's location read
 * from here, so changing it here changes it everywhere (rule "Um ajuste, um lugar").
 */
export const CLINIC_LIMITS = { name: 80, address: 160, city: 60, location: 240 } as const;

/** What a line of the office never needs: control and format characters, line and paragraph separators (QA-E6a-02), and angle brackets a model could read as a tag. */
const NOT_IN_LINE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}<>‹›＜＞﹤﹥〈〉⟨⟩]/u;

const tidy = (value: string) => value.normalize("NFC").replace(/[ \t]+/g, " ").trim();

const line = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform(tidy)
    .refine((value) => [...value].length <= max && !NOT_IN_LINE.test(value));

/**
 * The team's WhatsApp, as its digits: an area code (11 to 99, no zero) and a landline of 8 digits or a
 * mobile of 9 that starts with 9; or none (QA-E6a-08).
 */
export const CLINIC_PHONE = /^([1-9][1-9](?:\d{8}|9\d{8}))?$/;

export const clinicSchema = /* @__PURE__ */ z
  .object({
    name: line(CLINIC_LIMITS.name),
    whatsapp: z.string().regex(CLINIC_PHONE),
    address: line(CLINIC_LIMITS.address),
    city: line(CLINIC_LIMITS.city),
  })
  .strict();

export type Clinic = z.infer<typeof clinicSchema>;

export const DEFAULT_CLINIC: Clinic = /* @__PURE__ */ Object.freeze({ name: "", whatsapp: "", address: "", city: "" });

/** Where an in-person appointment happens, as the event's location at Google: "address, city"; "" with no address. */
export function clinicLocation(clinic: Clinic): string {
  if (clinic.address === "") return "";
  // By code points (SEC-E6a-01): a cut never splits an emoji into half a character.
  return [...[clinic.address, clinic.city].filter(Boolean).join(", ")].slice(0, CLINIC_LIMITS.location).join("");
}
