import { isMailAddress } from "@zuri/shared";

/**
 * One e-mail as RFC 5322 text (E6c): plain text in UTF-8, the body in base64, every header that can
 * carry the owner's or a patient's words encoded (RFC 2047). Nothing typed reaches a header raw, so a
 * line break can't add a header (the schemas refuse them too: this is the second wall).
 */
export interface MailMessage {
  fromName: string;
  from: string;
  to: string;
  replyTo?: string | undefined;
  subject: string;
  text: string;
  /** The same message as HTML (E7c2), built by the caller with every value escaped; the text stays the fallback. */
  html?: string | undefined;
  /** Milliseconds; the Date header. */
  at: number;
  /** The Message-ID's left part: random, from the caller. */
  id: string;
}

const CRLF = "\r\n";
const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const base64Url = (text: string) =>
  base64(new TextEncoder().encode(text))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const oneLine = (value: string) => value.replace(/[\r\n\t\0]+/g, " ").trim();

/** An encoded word per few characters, so no line goes over 76 and no character is split. */
export function encodeWords(value: string): string {
  const text = oneLine(value);
  if (ASCII_PRINTABLE.test(text) && !text.includes("=?")) return text;
  const chars = [...text];
  const words: string[] = [];
  for (let i = 0; i < chars.length; i += 12) words.push(`=?UTF-8?B?${base64(new TextEncoder().encode(chars.slice(i, i + 12).join("")))}?=`);
  return words.join(`${CRLF} `);
}

/** "Name" <address>, the name quoted when plain and encoded when not. */
function mailbox(name: string, address: string): string {
  const clean = oneLine(name);
  if (!clean) return `<${address}>`;
  const shown = ASCII_PRINTABLE.test(clean) && !/["\\]/.test(clean) && !clean.includes("=?") ? `"${clean}"` : encodeWords(clean);
  return `${shown} <${address}>`;
}

/** An address as the headers carry it: one that isn't a plain address never reaches them (third wall). */
export function plainAddress(value: string): string {
  if (!isMailAddress(value)) throw new Error("not an address");
  return value;
}

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1) || "zuri.invalid";

/** A part's text in base64, in lines of 76. */
const encodedBody = (text: string) =>
  base64(new TextEncoder().encode(text.replace(/\r?\n/g, CRLF)))
    .match(/.{1,76}/g)
    ?.join(CRLF) ?? "";

export function buildMessage(message: MailMessage): string {
  const headers = [
    `From: ${mailbox(message.fromName, plainAddress(message.from))}`,
    `To: <${plainAddress(message.to)}>`,
    ...(message.replyTo ? [`Reply-To: <${plainAddress(message.replyTo)}>`] : []),
    `Subject: ${encodeWords(message.subject)}`,
    `Date: ${new Date(message.at).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${message.id}@${domainOf(message.from)}>`,
    "MIME-Version: 1.0",
  ];
  const part = (type: "plain" | "html", text: string) => `Content-Type: text/${type}; charset=UTF-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${encodedBody(text)}${CRLF}`;
  if (message.html === undefined) return `${headers.join(CRLF)}${CRLF}${part("plain", message.text)}`;
  // Base64 parts never hold "--", so a random boundary can't appear inside them.
  const boundary = `zuri-${message.id.replace(/[^a-z0-9]/gi, "")}`;
  return [
    `${headers.join(CRLF)}${CRLF}Content-Type: multipart/alternative; boundary="${boundary}"${CRLF}${CRLF}`,
    `--${boundary}${CRLF}${part("plain", message.text)}`,
    `--${boundary}${CRLF}${part("html", message.html)}`,
    `--${boundary}--${CRLF}`,
  ].join("");
}
