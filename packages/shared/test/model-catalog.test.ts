import { describe, expect, it } from "vitest";
import { catalogAddSchema, catalogModelName, isCatalogModelId, MODEL_CATALOG_LIMITS, modelCatalogSchema, neuronsPerMillion, settingsUpdateSchema } from "../src/index.ts";

// PR S21: the catalog's contract and the ids the settings may name.

describe("the catalog's model ids", () => {
  it("takes @cf/<author>/<name> and nothing else", () => {
    for (const id of ["@cf/zai-org/glm-4.7-flash", "@cf/google/gemma-3-12b-it", "@cf/a/b"]) expect(isCatalogModelId(id), id).toBe(true);
    for (const id of ["", "@cf/", "@cf/a", "@cf/a/b/c", "@cf/../x", "@cf/A/b", "@hf/a/b", "anthropic/claude-haiku-5-5", " @cf/a/b", "@cf/a/b\n", 42, null]) {
      expect(isCatalogModelId(id), String(id)).toBe(false);
    }
    // n and n+1 characters of each part: 41 of the author, 79 of the name.
    expect(isCatalogModelId(`@cf/${"a".repeat(41)}/${"b".repeat(79)}`)).toBe(true);
    expect(isCatalogModelId(`@cf/${"a".repeat(42)}/b`)).toBe(false);
    expect(isCatalogModelId(`@cf/a/${"b".repeat(80)}`)).toBe(false);
    expect(MODEL_CATALOG_LIMITS.idMaxChars).toBe(`@cf/${"a".repeat(41)}/${"b".repeat(79)}`.length);
  });

  it("lets the settings name one, and the add route only one", () => {
    expect(settingsUpdateSchema.safeParse({ aiModel: "@cf/google/gemma-3-12b-it" }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ aiFallbackModel: "@cf/google/gemma-3-12b-it" }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ aiModel: "https://exemplo.com.br" }).success).toBe(false);
    expect(catalogAddSchema.safeParse({ id: "@cf/google/gemma-3-12b-it" }).success).toBe(true);
    expect(catalogAddSchema.safeParse({ id: "@cf/google/gemma-3-12b-it", more: 1 }).success).toBe(false);
  });
});

describe("the catalog's numbers and names", () => {
  it("turns US$ per million tokens into Neurons at US$ 0.011 per thousand", () => {
    expect(neuronsPerMillion(0.0605)).toBe(5_500);
    expect(neuronsPerMillion(0.011)).toBe(1_000);
    expect(neuronsPerMillion(0)).toBe(0);
  });

  it("names a model by the last part of its id", () => {
    expect(catalogModelName("@cf/google/gemma-3-12b-it")).toBe("gemma-3-12b-it");
    expect(catalogModelName("plain")).toBe("plain");
  });

  it("reads the card's answer strictly", () => {
    const view = { available: true, checkedAt: null, failed: false, listed: [], notices: [] };
    expect(modelCatalogSchema.safeParse(view).success).toBe(true);
    expect(modelCatalogSchema.safeParse({ ...view, extra: 1 }).success).toBe(false);
    const model = { id: "@cf/a/b", label: "b", context: 80_000, input: 1, output: 2, fixed: false };
    expect(modelCatalogSchema.safeParse({ ...view, notices: [{ kind: "new", model, on: null, inUse: false }] }).success).toBe(true);
    expect(modelCatalogSchema.safeParse({ ...view, notices: [{ kind: "gone", model, on: null, inUse: false }] }).success).toBe(false);
  });
});
