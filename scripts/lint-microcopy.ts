/**
 * The microcopy lint, run inside the i18n lint (scripts/lint-i18n.ts). It reads
 * every catalog text and fails on the writing rules of
 * docs/planos/revisao-de-textos-e-experiencia.md (stage 26): the glossary's
 * "avoid" words, "com sucesso", "Ops", "Por favor", the em dash, three dots
 * instead of the ellipsis, "!" outside the greeting, infrastructure names on
 * the screens of use, and a full stop closing a one-sentence toast.
 *
 * Exceptions live in i18n-ignore.json under "microcopy", one per key and rule,
 * each with its reason; an exception that no longer matches also fails.
 */
import type { Locale } from "../packages/shared/i18n/index.ts";
import { kindOf } from "./inventario-de-textos.ts";

export type MicrocopyRule =
  | "travessao"
  | "reticencias"
  | "com-sucesso"
  | "ops"
  | "por-favor"
  | "exclamacao"
  | "glossario"
  | "infraestrutura"
  | "ponto-final";

export interface MicrocopyFinding {
  locale: Locale;
  key: string;
  rule: MicrocopyRule;
  /** What matched, and what to write instead when there is a standard word. */
  detail: string;
}

export interface MicrocopyException {
  key: string;
  rule: MicrocopyRule;
  reason: string;
}

/** A whole word, letters with accents included: \b only knows ASCII. */
const word = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "iu");

interface Check {
  rule: MicrocopyRule;
  pattern: RegExp;
  /** The standard word, for the report. */
  use?: string;
}

/** Both languages. */
const COMMON: Check[] = [
  { rule: "travessao", pattern: /—/u, use: "ponto, vírgula ou dois-pontos" },
  { rule: "reticencias", pattern: /\.\.\./u, use: "…" },
  {
    rule: "infraestrutura",
    pattern: word("workers?|durable objects?|turnstile|cron|sqlite|cloudflare"),
    use: "o que a pessoa vê, sem o nome da peça (exceção comentada só em instrução de configuração e na aba IA)",
  },
];

/** pt-BR: the glossary's "Evitar" column and the banned phrases. */
const PT_BR: Check[] = [
  { rule: "com-sucesso", pattern: /com sucesso/iu, use: "só o particípio: \"Tarefa criada\"" },
  { rule: "ops", pattern: word("ops|opa"), use: "o que houve e o que fazer" },
  { rule: "por-favor", pattern: /por favor/iu, use: "o pedido direto" },
  { rule: "glossario", pattern: word("exclu(ir|a|i|iu|ído|ída|ídos|ídas|são)|delet(ar|e|ado|ada|ados|adas)"), use: "Apagar" },
  { rule: "glossario", pattern: word("log(ar|ou|ado|ada|in|ins|out)|deslog\\p{L}*"), use: "Entrar / Sair / entrada" },
  { rule: "glossario", pattern: /tent\p{L}* novamente/iu, use: "Tentar de novo" },
  { rule: "glossario", pattern: word("gerar|gere"), use: "Criar" },
  { rule: "glossario", pattern: word("cadastrar|cadastre"), use: "Adicionar (item de lista) ou Criar (algo que se configura)" },
  { rule: "glossario", pattern: word("alterar|altere|modificar|modifique"), use: "Editar / Mudar" },
  { rule: "glossario", pattern: word("incluir|inclua|inserir|insira"), use: "Adicionar" },
  { rule: "glossario", pattern: word("rejeit\\p{L}*"), use: "Recusar" },
  { rule: "glossario", pattern: word("(des)?ativ(ar|e|ou|ado|ada|ados|adas|ando)|(des)?habilit\\p{L}*"), use: "Ligar / Desligar" },
  { rule: "glossario", pattern: word("(des)?vincul\\p{L}*"), use: "Conectar / Desconectar (conta) ou Remover (ligação)" },
  { rule: "glossario", pattern: word("visualiz\\p{L}*"), use: "Ver / Prévia" },
  { rule: "glossario", pattern: word("ajustes|preferências"), use: "Configurações" },
  { rule: "glossario", pattern: word("chat"), use: "Conversa" },
  { rule: "glossario", pattern: /rotinas? com IA/iu, use: "Rotina da Zuri" },
  { rule: "glossario", pattern: /algo deu errado|falha inesperada|clique aqui/iu, use: "o que houve e o que fazer" },
  { rule: "glossario", pattern: word("erro!"), use: "o que houve e o que fazer" },
];

/** English follows the meaning of the pt-BR rules. */
const EN: Check[] = [
  { rule: "com-sucesso", pattern: word("successfully"), use: "the participle alone: \"Task created\"" },
  { rule: "ops", pattern: word("oops|whoops"), use: "what happened and what to do" },
  { rule: "por-favor", pattern: word("please"), use: "the plain request" },
  { rule: "glossario", pattern: word("(en|dis)abl(e|ed|es|ing)"), use: "Turn on / Turn off" },
  { rule: "glossario", pattern: word("unlink(s|ed|ing)?"), use: "Disconnect" },
  { rule: "glossario", pattern: /AI routines?/iu, use: "Zuri routine" },
  { rule: "glossario", pattern: /something went wrong|click here/iu, use: "what happened and what to do" },
];

/** Where "!" belongs: Zuri greeting the owner by the hour (rule 8 of the plan). */
export const EXCLAMATION_ALLOWED = /^web\.greeting\./;

export function microcopyFindings(sources: Record<Locale, Record<string, string>>): MicrocopyFinding[] {
  const findings: MicrocopyFinding[] = [];
  for (const [locale, catalog] of Object.entries(sources) as [Locale, Record<string, string>][]) {
    const checks = [...COMMON, ...(locale === "pt-BR" ? PT_BR : EN)];
    for (const [key, text] of Object.entries(catalog)) {
      for (const check of checks) {
        const match = check.pattern.exec(text);
        if (match) findings.push({ locale, key, rule: check.rule, detail: `"${match[0].trim()}" → ${check.use}` });
      }
      // Rule 4: a toast is a participle, no full stop unless it holds two sentences.
      if (kindOf(key) === "toast" && text.endsWith(".") && !/[.?]\s/.test(text)) {
        findings.push({ locale, key, rule: "ponto-final", detail: "toast de uma frase sem ponto final: \"Tarefa criada\"" });
      }
      const bangs = text.split("!").length - 1;
      if (bangs > 1 || (bangs === 1 && !EXCLAMATION_ALLOWED.test(key))) {
        findings.push({ locale, key, rule: "exclamacao", detail: "\"!\" só no cumprimento da Zuri, e um por texto" });
      }
    }
  }
  return findings;
}

const RULES = new Set<MicrocopyRule>(["travessao", "reticencias", "com-sucesso", "ops", "por-favor", "exclamacao", "glossario", "infraestrutura", "ponto-final"]);

/**
 * Drops the findings an exception covers (an exception covers its key and rule in
 * both languages) and reports malformed or stale exceptions.
 */
export function applyMicrocopyExceptions(
  findings: MicrocopyFinding[],
  exceptions: unknown,
  file: string,
): { findings: MicrocopyFinding[]; problems: string[] } {
  const problems: string[] = [];
  if (exceptions !== undefined && !Array.isArray(exceptions)) {
    return { findings, problems: [`${file}: "microcopy" precisa ser uma lista`] };
  }
  const entries = (exceptions ?? []) as MicrocopyException[];
  for (const entry of entries) {
    if (typeof entry?.key !== "string" || !RULES.has(entry?.rule) || typeof entry?.reason !== "string" || entry.reason.trim().length < 10) {
      problems.push(`${file}: toda exceção de microcopy precisa de "key", "rule" válida e um "reason" que explique o porquê: ${JSON.stringify(entry)}`);
    }
  }
  const used = new Set<MicrocopyException>();
  const kept = findings.filter((finding) => {
    const entry = entries.find((e) => e?.key === finding.key && e?.rule === finding.rule);
    if (entry) used.add(entry);
    return !entry;
  });
  for (const entry of entries) {
    if (!used.has(entry)) problems.push(`${file}: a exceção de microcopy não corresponde a nada (remova-a): ${JSON.stringify(entry)}`);
  }
  return { findings: kept, problems };
}

export function reportMicrocopy(findings: MicrocopyFinding[]): string[] {
  return findings.map((f) => `${f.locale}: "${f.key}" fora das regras de texto (${f.rule}): ${f.detail}`);
}
