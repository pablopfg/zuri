import { CHAT_MODELS, isChatModel } from "@zuri/shared";

/** A Workers AI model's numbers: Neurons per million tokens in and out, and its whole window in tokens. */
export interface ModelRate {
  input: number;
  output: number;
  context: number;
}

/**
 * The rates the catalog gave at its last check (PR S21): the models put on the
 * list, and the fixed ones whose price changed since the dated table. Set by
 * the catalog when the object wakes and after each check; the object is the
 * only one of the account, so one map per isolate is its map.
 */
let fromCatalog: ReadonlyMap<string, ModelRate> = new Map();

export function setCatalogRates(rates: ReadonlyMap<string, ModelRate>): void {
  fromCatalog = rates;
}

/** The model's numbers: the catalog's last ones first, then the dated table; undefined for a model of neither. */
export function modelRate(model: string): ModelRate | undefined {
  return fromCatalog.get(model) ?? (isChatModel(model) ? CHAT_MODELS[model] : undefined);
}
