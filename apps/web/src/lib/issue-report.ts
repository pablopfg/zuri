import { APP_VERSION, type DiagnosticEntry, type DiagnosticSource } from "@zuri/shared";

/**
 * "Relatar no GitHub" in Settings > Diagnóstico (docs/agente/issues.md, the
 * owner's choice of 02/11/2026): a link that opens the repository's "Erro"
 * issue form already filled in, in a new tab. Nothing leaves without the owner
 * reading it and pressing Submit on GitHub; no token, no request from the server.
 *
 * Only what the diagnostics record already keeps goes in the link, and less
 * of it: source, code, error name, route with ids swapped, counts, dates to
 * the minute in UTC, the cf-ray without its data center, the record's id and
 * the version of the system (the newest section of CHANGELOG.md: the build of
 * a tag's own commit still shows the previous one, see docs/agente/versionamento.md).
 * Never anything the owner wrote, and not the deployment's version id (an id
 * of the owner's account that matches no commit). GitHub fills only text
 * fields from the link, so "Onde aconteceu" is left for the owner. The text is
 * in pt-BR whatever the interface language: it goes to the repository's
 * tracker, which is in pt-BR (AGENTS.md).
 */
export const ISSUE_REPOSITORY = "pablopfg/Zuri";
export const ISSUE_TEMPLATE = "erro.yml";

const SOURCE_NAME: Record<DiagnosticSource, string> = {
  api: "servidor",
  ai: "IA",
  automation: "rotinas",
  chat: "conversa",
  interface: "tela",
};

/** 2026-11-02T08:00:12.345Z → 2026-11-02 08:00 UTC. */
const minute = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/** The cf-ray's request id, without the "-GRU" data center that hints where the owner was. */
const rayId = (ref: string) => ref.replace(/-[A-Z]{3}$/, "");

/** The form's fields the link fills, by their ids in erro.yml, in the form's order (the preview shows them so). */
export const ISSUE_FIELDS = ["title", "contexto", "passos", "esperado", "obtido", "codigo"] as const;
export type IssueField = (typeof ISSUE_FIELDS)[number];

/**
 * What each text field of the form will hold for one recorded failure (PR S16 added
 * steps and expected). Steps come from where the failure happened, never from what
 * the owner did or wrote. "Onde aconteceu" and "Impacto" are lists, which GitHub
 * doesn't fill from a link: the preview tells the owner to pick them there.
 */
export function issueReportFields(entry: DiagnosticEntry): Record<IssueField, string> {
  const where = SOURCE_NAME[entry.source];
  const name = entry.errorName !== "Error" ? ` ${entry.errorName}` : "";
  return {
    title: `[erro] ${entry.code}${name} (${where})`,
    contexto: [
      `Falha registrada no Diagnóstico (origem: ${where}).`,
      entry.route ? `Rota: ${entry.route}` : null,
      `Primeira vez: ${minute(entry.firstAt)}`,
      `Última vez: ${minute(entry.lastAt)}`,
      `Versão da Zuri: ${APP_VERSION}`,
    ]
      .filter(Boolean)
      .join("\n"),
    passos: [
      `1. Usar a Zuri na versão ${APP_VERSION}.`,
      `2. Usar a parte de ${where}${entry.route ? ` (rota ${entry.route})` : ""}.`,
      "3. A falha aparece em Configurações › Diagnóstico.",
    ].join("\n"),
    esperado: "A ação termina sem erro e nada aparece no Diagnóstico.",
    obtido: `${entry.code}${name}: ${entry.countToday} hoje, ${entry.countTotal} nos últimos 30 dias.`,
    codigo: [entry.code, entry.errorName !== "Error" ? entry.errorName : null, entry.lastRef ? `cf-ray ${rayId(entry.lastRef)}` : null, `id ${entry.id}`]
      .filter(Boolean)
      .join(" · "),
  };
}

/** The issue form link for one recorded failure: the same fields the preview shows. */
export function issueReportUrl(entry: DiagnosticEntry): string {
  const params = new URLSearchParams({ template: ISSUE_TEMPLATE, ...issueReportFields(entry) });
  return `https://github.com/${ISSUE_REPOSITORY}/issues/new?${params.toString()}`;
}
