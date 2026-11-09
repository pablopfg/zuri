import { describe, expect, it } from "vitest";
import { catalogs } from "../../packages/shared/i18n/index.ts";
import { IGNORE_FILE } from "../../scripts/lint-i18n.ts";
import { applyMicrocopyExceptions, microcopyFindings, reportMicrocopy } from "../../scripts/lint-microcopy.ts";
import { readJson } from "./helpers.ts";

type Sources = Parameters<typeof microcopyFindings>[0];
const pt = (texts: Record<string, string>) => microcopyFindings({ "pt-BR": texts, en: {} } as Sources).map((f) => `${f.key} ${f.rule}`);
const en = (texts: Record<string, string>) => microcopyFindings({ "pt-BR": {}, en: texts } as Sources).map((f) => `${f.key} ${f.rule}`);

describe("microcopyFindings", () => {
  it("catches the banned phrases in pt-BR", () => {
    expect(
      pt({
        a: "Tarefa criada com sucesso",
        b: "Ops, não deu",
        c: "Por favor, confira",
        d: "Salvo — pode sair",
        e: "Carregando...",
      }),
    ).toEqual(["a com-sucesso", "b ops", "c por-favor", "d travessao", "e reticencias"]);
  });

  it("catches each word of the glossary's avoid column, with accents and in any case", () => {
    const avoid = [
      "Excluir tarefa",
      "Exclua as antigas",
      "Item excluído",
      "Deletar",
      "Fazer login",
      "Logins",
      "Deslogar",
      "Tente novamente",
      "Ativar avisos",
      "Desativada",
      "Habilitar",
      "Desvincular",
      "Visualizar",
      "Ajustes",
      "Preferências",
      "Abrir o chat",
      "Rotinas com IA",
      "Algo deu errado",
      "Erro!",
      "Tentando novamente",
      "Gerar token",
      "Cadastrar",
      "Alterar evento",
      "Modificar",
      "Incluir",
      "Inserir",
      "Rejeitar",
      "Grupo vinculado",
    ];
    const found = pt(Object.fromEntries(avoid.map((text, i) => [`k${i}`, text])));
    expect(found.filter((f) => f.endsWith("glossario")).map((f) => f.split(" ")[0])).toEqual(avoid.map((_, i) => `k${i}`));
  });

  it("does not flag a word that only contains an avoided one, nor the adjective forms", () => {
    expect(
      pt({
        a: "Automações ativas",
        b: "Nenhuma rotina ativa",
        c: "Chatice à parte",
        d: "Inclusão de ajuste fino",
        e: "Rotina da Zuri",
        f: "Tentar de novo",
        g: "Carregando…",
        h: "Entrar",
      }),
    ).toEqual([]);
  });

  it("wants a one-sentence toast without a full stop, and lets two sentences keep theirs", () => {
    expect(
      pt({
        "web.chat.deleted": "Conversa apagada.",
        "web.memory.saved": "Memória guardada",
        "web.password.changed.toast": "Senha trocada. As outras sessões saíram.",
        "web.notes.hint": "Uma dica comum.",
      }),
    ).toEqual(["web.chat.deleted ponto-final"]);
  });

  it("allows one '!' in the greeting only", () => {
    expect(pt({ "web.greeting.morning": "Bom dia, Ana!", "web.home.empty": "Nada para hoje. Aproveite!" })).toEqual(["web.home.empty exclamacao"]);
    expect(pt({ "web.greeting.morning": "Bom dia!!" })).toEqual(["web.greeting.morning exclamacao"]);
  });

  it("catches infrastructure names on the screens", () => {
    expect(pt({ a: "O Worker caiu", b: "Falhou o Turnstile", c: "Banco SQLite", d: "Rodou no cron", e: "Durable Object cheio", f: "a Cloudflare não respondeu" })).toEqual([
      "a infraestrutura",
      "b infraestrutura",
      "c infraestrutura",
      "d infraestrutura",
      "e infraestrutura",
      "f infraestrutura",
    ]);
  });

  it("checks English on its own words", () => {
    expect(
      en({
        a: "Saved successfully",
        b: "Oops",
        c: "Please try again",
        d: "Enable alerts",
        e: "Unlink Telegram",
        f: "AI routines",
        g: "Something went wrong",
        h: "Done!",
        i: "Wait — no",
      }),
    ).toEqual(["a com-sucesso", "b ops", "c por-favor", "d glossario", "e glossario", "f glossario", "g glossario", "i travessao", "h exclamacao"].sort((x, y) => x.localeCompare(y)));
    // The pt-BR rules don't apply to English: "chat" and "login" are plain English there.
    expect(en({ a: "Chat with Zuri", b: "Sign in" })).toEqual([]);
  });

  it("finds nothing left in the shipped catalogs once the exceptions of i18n-ignore.json apply, and something without them", () => {
    const shipped = microcopyFindings(catalogs);
    expect(shipped.map((f) => f.key)).toContain("web.shell.removeSetupCode");
    expect(applyMicrocopyExceptions(shipped, readJson(IGNORE_FILE).microcopy, IGNORE_FILE)).toEqual({ findings: [], problems: [] });
  });
});

describe("applyMicrocopyExceptions", () => {
  const findings = microcopyFindings({ "pt-BR": { a: "O Worker", b: "Excluir" }, en: { a: "The Worker" } } as Sources);

  it("drops the findings of an exception in both languages, and keeps the rest", () => {
    const result = applyMicrocopyExceptions(findings, [{ key: "a", rule: "infraestrutura", reason: "Instrução de configuração no painel." }], "x.json");
    expect(result.problems).toEqual([]);
    expect(result.findings.map((f) => `${f.locale} ${f.key}`)).toEqual(["pt-BR b"]);
  });

  it("fails on a stale, malformed or unexplained exception", () => {
    const stale = applyMicrocopyExceptions(findings, [{ key: "z", rule: "glossario", reason: "Não corresponde a nada aqui." }], "x.json");
    expect(stale.problems.join("\n")).toContain("não corresponde a nada");
    expect(applyMicrocopyExceptions(findings, [{ key: "a", rule: "infraestrutura", reason: "curto" }], "x.json").problems.join("\n")).toContain("precisa de");
    expect(applyMicrocopyExceptions(findings, [{ key: "a", rule: "inventada", reason: "Uma regra que não existe." }], "x.json").problems.join("\n")).toContain("precisa de");
    expect(applyMicrocopyExceptions(findings, { key: "a" }, "x.json").problems).toEqual(['x.json: "microcopy" precisa ser uma lista']);
  });

  it("reports the language, the key, the rule and what to write instead", () => {
    expect(reportMicrocopy(findings.slice(1, 2))).toEqual(['pt-BR: "b" fora das regras de texto (glossario): "Excluir" → Apagar']);
  });
});
