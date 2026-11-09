/**
 * The text inventory of stage 26 (docs/planos/revisao-de-textos-e-experiencia.md):
 * every catalog key with its kind, pt-BR and en, or only the keys that changed
 * since a git ref, before → after. The output is Markdown in pt-BR, for people.
 *
 * Usage:
 *   node scripts/inventario-de-textos.ts [--saida <file>]              every key
 *   node scripts/inventario-de-textos.ts --mudancas <ref> [--saida <file>]  what changed since <ref>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogs } from "../packages/shared/i18n/index.ts";

type Catalogs = Record<"pt-BR" | "en", Record<string, string>>;

/** What a person meets: guessed from the key's name, the way the catalog names things. */
export function kindOf(key: string): string {
  const last = key.split(".").slice(-2).join(".");
  if (key.startsWith("telegram.")) return "bot";
  if (key.startsWith("error.") || /(^|\.)(failed|problem|invalid|refused)\b/.test(last)) return "erro";
  if (key.startsWith("notice.")) return key.endsWith(".title") ? "aviso (título)" : "aviso";
  if (key.startsWith("web.greeting.")) return "voz da Zuri";
  if (/\.(empty|emptyBody|emptyTitle)\b|\.empty\./.test(key)) return "vazio";
  if (/\.(loading|checking)\b/.test(last)) return "carregando";
  if (/\.(saved|created|deleted|removed|renamed|copied|done|added|updated|restored|disconnected|connected|unlinked|toast)$/.test(key)) return "toast";
  if (/(Title|\.title)$/.test(key)) return "título";
  if (/(Hint|\.hint|description|Body|\.body|lead)$/.test(key)) return "texto";
  if (/(Label|\.label|placeholder|Placeholder)$/.test(key)) return "rótulo";
  return "texto curto";
}

const cell = (text: string | undefined) => (text ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");

export function inventory(sources: Catalogs): string {
  const keys = Object.keys(sources["pt-BR"]).sort();
  const lines = ["| Chave | Tipo | pt-BR | en |", "| --- | --- | --- | --- |"];
  for (const key of keys) lines.push(`| \`${key}\` | ${kindOf(key)} | ${cell(sources["pt-BR"][key])} | ${cell(sources.en[key])} |`);
  return `# Inventário de textos\n\n${keys.length} chaves.\n\n${lines.join("\n")}\n`;
}

export interface Change {
  key: string;
  kind: string;
  before: { pt?: string; en?: string };
  after: { pt?: string; en?: string };
}

/** Keys whose pt-BR or en text differs, plus keys added or removed. */
export function changes(before: Catalogs, after: Catalogs): Change[] {
  const keys = new Set([...Object.keys(before["pt-BR"]), ...Object.keys(after["pt-BR"])]);
  return [...keys]
    .sort()
    .filter((key) => before["pt-BR"][key] !== after["pt-BR"][key] || before.en[key] !== after.en[key])
    .map((key) => ({
      key,
      kind: kindOf(key),
      before: { pt: before["pt-BR"][key], en: before.en[key] },
      after: { pt: after["pt-BR"][key], en: after.en[key] },
    }));
}

export function changesReport(list: Change[], ref: string): string {
  const byKind = new Map<string, number>();
  for (const c of list) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
  const summary = [...byKind].sort((a, b) => b[1] - a[1]).map(([kind, n]) => `${kind}: ${n}`).join(" · ");
  const rows = list.map((c) => {
    const pt = c.before.pt === c.after.pt ? "(igual)" : `${cell(c.before.pt)} → **${cell(c.after.pt)}**`;
    const en = c.before.en === c.after.en ? "(igual)" : `${cell(c.before.en)} → **${cell(c.after.en)}**`;
    return `| \`${c.key}\` | ${c.kind} | ${pt} | ${en} |`;
  });
  return [
    `# Textos revistos desde \`${ref}\``,
    "",
    `${list.length} chaves mudaram (${summary}).`,
    "",
    "| Chave | Tipo | pt-BR (antes → depois) | en (antes → depois) |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** The catalogs as they were at a git ref, read from a throwaway copy of packages/shared/i18n. */
async function catalogsAt(ref: string): Promise<Catalogs> {
  const dir = mkdtempSync(join(tmpdir(), "zuri-inventario-"));
  try {
    const archive = execFileSync("git", ["archive", ref, "packages/shared/i18n"], { cwd: join(import.meta.dirname, ".."), maxBuffer: 64 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-C", dir], { input: archive });
    return (await import(join(dir, "packages/shared/i18n/index.ts"))).catalogs as Catalogs;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const flag = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const ref = flag("--mudancas");
  const output = ref ? changesReport(changes(await catalogsAt(ref), catalogs), ref) : inventory(catalogs);
  const file = flag("--saida");
  if (file) writeFileSync(file, output);
  else process.stdout.write(output);
}
