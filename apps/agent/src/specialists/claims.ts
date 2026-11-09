import { fold } from "../reviews/triage.ts";

/**
 * The fixed check of the chat's claims (docs/planos/guardrails-especialistas-ia.md,
 * CA4): no AI. "Never say something was done unless the tool succeeded" is a
 * rule in the prompt; a small model can still answer "Anotei!" without
 * calling anything. When the owner asked for an action, the answer says it
 * was done and no writing tool succeeded in the turn, the answer gets a short
 * notice the owner sees and that is kept with it.
 *
 * Narrow on purpose, so it rarely fires on an honest answer: the owner's
 * message must ask for an action ("anota", "cria", "remind me"), the answer
 * must claim it in the first person or as done ("anotei", "foi criada", "I've
 * saved"), and a negation right before the claim ("não criei") clears it.
 */

/** The owner asks for something to be done (folded: no accents, lower case). */
const ASKS = new RegExp(
  `\\b(?:${[
    // pt-BR imperatives and requests.
    "anot[ae]",
    "cri[ae]",
    "salv[ae]",
    "guard[ae]",
    "agend[ae]",
    "marc[ae]",
    "lembre",
    "lembre-me",
    "me lembr[ae]",
    "adicion[ae]",
    "coloc[ae]",
    "apag[ae]",
    "apague",
    "exclu[ai]",
    "remov[ae]",
    "tir[ae]",
    "envi[ae]",
    "mand[ae]",
    "registr[ae]",
    "atualiz[ae]",
    "mud[ae]",
    "alter[ae]",
    "conclu[ai]",
    "finaliz[ae]",
    "pode (?:anotar|criar|salvar|agendar|marcar|lembrar|adicionar|apagar|excluir|remover|enviar|mandar|registrar|atualizar|mudar|alterar|concluir)",
    "(?:quero|preciso) que (?:voce )?(?:anote|crie|salve|agende|marque|lembre|adicione|apague|exclua|remova|envie|mande|registre|atualize|mude|altere|conclua)",
    // English.
    "note",
    "create",
    "save",
    "add",
    "schedule",
    "remind me",
    "set a reminder",
    "delete",
    "remove",
    "send",
    "update",
    "change",
    "mark",
    "complete",
    "remember",
  ].join("|")})\\b`,
  "u",
);

/** The answer says it was done (folded). */
const CLAIMS = new RegExp(
  `\\b(?:${[
    // pt-BR, first person past and "was done".
    "anotei",
    "criei",
    "salvei",
    "guardei",
    "agendei",
    "marquei",
    "adicionei",
    "coloquei",
    "apaguei",
    "exclui",
    "removi",
    "tirei",
    "enviei",
    "mandei",
    "registrei",
    "atualizei",
    "mudei",
    "alterei",
    "conclui",
    "finalizei",
    "(?:ja )?(?:esta|ficou|foi|foram|estao|ficaram) (?:anotad|criad|salv|guardad|agendad|marcad|adicionad|apagad|excluid|removid|enviad|registrad|atualizad|alterad|concluid)[oa]s?",
    "lembrete (?:criado|definido|agendado|salvo)",
    // English.
    "i(?:'ve| have)? (?:noted|created|saved|added|scheduled|deleted|removed|sent|updated|changed|marked|completed|set)",
    "(?:has|have) been (?:noted|created|saved|added|scheduled|deleted|removed|sent|updated|changed|marked|completed|set)",
    "(?:it's|its|it is) (?:done|saved|scheduled|created)",
  ].join("|")})\\b`,
  "gu",
);

/** A negation in the few words before a claim: "não criei", "ainda não foi criada", "I haven't saved". */
const NEGATION = /\b(?:nao|nunca|sem|not|never|haven't|hasn't|didn't|couldn't|could not|wasn't|weren't|n't)\b[^.!?\n]{0,24}$/u;

/** The owner's message asks for something to be done. */
export function asksForAction(message: string): boolean {
  return ASKS.test(fold(message));
}

/** The answer claims, without a negation right before, that something was done. */
export function claimsDone(answer: string): boolean {
  const text = fold(answer).replace(/[’`]/g, "'");
  for (const match of text.matchAll(CLAIMS)) {
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    if (!NEGATION.test(before)) return true;
  }
  return false;
}

/** What the turn's tools did, as far as the check is concerned. */
export interface TurnWrites {
  /** A tool of Zuri's that writes (or an external call that ran) succeeded. */
  wrote: boolean;
  /** A destructive tool only made a proposal: a deletion claim is still not true. */
  proposed: boolean;
}

const DELETION = /\b(?:apaguei|exclui|removi|tirei|(?:esta|foi|foram|ficou|ficaram) (?:apagad|excluid|removid)[oa]s?|i(?:'ve| have)? (?:deleted|removed)|(?:has|have) been (?:deleted|removed))\b/u;

/**
 * True when the answer must carry the notice: the owner asked, the answer
 * claims it was done, and nothing that writes succeeded (or only a proposal
 * was made and the answer claims a deletion).
 */
export function unverifiedClaim(message: string, answer: string, writes: TurnWrites): boolean {
  if (writes.wrote || !answer.trim() || !asksForAction(message) || !claimsDone(answer)) return false;
  // A proposal made in the turn: "criei a proposta" is true, "apaguei" is not.
  return !writes.proposed || DELETION.test(fold(answer));
}
