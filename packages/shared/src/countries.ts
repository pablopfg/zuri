/**
 * The countries of a patient's phone (E5e, 12/11/2026): the two-letter code, which is what is kept
 * (the United States and Canada share +1), and the dialing code. Names come from the browser's own
 * `Intl.DisplayNames`, in the owner's language, so there is no list to translate. Kept compact: the
 * Agenda's form loads it on demand, never the first load (rule P11).
 */
const RAW =
  "AF93 ZA27 AL355 DE49 AD376 AO244 AI1264 AG1268 SA966 DZ213 AR54 AM374 AW297 AU61 AT43 AZ994 BS1242 BH973 BD880 BB1246 BE32 BZ501 BJ229 BM1441 BY375 BO591 BA387 BW267 BR55 BN673 BG359 BF226 BI257 BT975 CV238 CM237 KH855 CA1 QA974 KZ7 TD235 CL56 CN86 CY357 CO57 KM269 CG242 CD243 KP850 KR82 CI225 CR506 HR385 CU53 CW599 DK45 DJ253 DM1767 EG20 SV503 AE971 EC593 ER291 SK421 SI386 ES34 US1 EE372 SZ268 ET251 FJ679 PH63 FI358 FR33 GA241 GM220 GH233 GE995 GI350 GD1473 GR30 GL299 GP590 GU1671 GT502 GY592 GF594 GN224 GQ240 GW245 HT509 HN504 HK852 HU36 YE967 KY1345 CK682 FO298 FK500 MH692 SB677 IN91 ID62 IR98 IQ964 IE353 IS354 IL972 IT39 JM1876 JP81 JO962 KW965 LA856 LS266 LV371 LB961 LR231 LY218 LI423 LT370 LU352 MO853 MK389 MG261 MY60 MW265 MV960 ML223 MT356 MA212 MQ596 MU230 MR222 MX52 MM95 FM691 MZ258 MD373 MC377 MN976 ME382 MS1664 NA264 NR674 NP977 NI505 NE227 NG234 NO47 NC687 NZ64 OM968 NL31 PW680 PS970 PA507 PG675 PK92 PY595 PE51 PF689 PL48 PR1787 PT351 KE254 KG996 GB44 CF236 CZ420 DO1809 RE262 RO40 RW250 RU7 WS685 SM378 LC1758 KN1869 ST239 VC1784 SC248 SN221 SL232 RS381 SG65 SX1721 SY963 SO252 LK94 SD249 SS211 SE46 CH41 SR597 TH66 TW886 TJ992 TZ255 TL670 TG228 TO676 TT1868 TN216 TM993 TR90 TV688 UA380 UG256 UY598 UZ998 VU678 VA379 VE58 VN84 ZM260 ZW263";

/** Each country's code and dialing code ("BR" → "+55"). */
export const COUNTRY_DIAL: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.fromEntries(RAW.split(" ").map((item) => [item.slice(0, 2), `+${item.slice(2)}`])),
);

/** Brazil, the default and the first in every list. */
export const HOME_COUNTRY = "BR";

/** Whether a code is one of the list. */
export function isCountry(code: string): boolean {
  return Object.hasOwn(COUNTRY_DIAL, code);
}

/** Digits a phone keeps: 6 to 15 (E.164); in Brazil, the area code and 8 or 9 digits. */
export function validPhone(country: string, digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  if (country === HOME_COUNTRY) return /^[1-9]{2}9?\d{8}$/.test(digits);
  return digits.length >= 6 && digits.length <= 15;
}

/**
 * A patient's e-mail as the form, the server, the reading of an event and the backup all check it: one
 * rule in the four places, so nothing the screen takes is refused later (QA-E5e-02). It lives here, with
 * the phone's rule, out of the first load.
 */
export const PATIENT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
