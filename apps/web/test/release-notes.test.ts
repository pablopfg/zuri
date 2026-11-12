import { describe, expect, it } from "vitest";
import { firstSentence, plainText, RELEASE_NOTES_MAX, releaseNotes } from "../src/lib/release-notes.ts";

const CHANGELOG = `# Changelog

## [Não lançado]

- Not released yet.

## [0.50.0] - 2026-11-12

Mesclada às 08:11 (UTC-3) · commit [\`57ad75f\`](https://github.com/x) · Reúne 10 mudanças

### Adicionado

- Avaliações ganhou **área própria**, em três partes. Visão geral mostra os números.
- A versão 0.x continua com \`npm run size\` e [o guia](docs/guia.md).
  - A nested line is not an item.

### Corrigido

- <img src=x onerror=alert(1)>Texto com marcação.

## [0.49.6] - 2026-11-11

- Older item.
`;

describe("release notes for Sobre a Zuri (PR S16)", () => {
  it("reads the newest numbered version only, its top-level items as plain first sentences", () => {
    expect(releaseNotes(CHANGELOG)).toEqual({
      version: "0.50.0",
      items: ["Avaliações ganhou área própria, em três partes.", "A versão 0.x continua com npm run size e o guia.", "Texto com marcação."],
    });
  });

  it("never passes markup or Markdown to the screen", () => {
    expect(plainText("**negrito** _itálico_ [link](https://exemplo.com.br) `code` <script>x</script>")).toBe("negrito itálico link code x");
  });

  it("stops at the cap and cuts a long sentence at a word", () => {
    const many = `## [1.2.3] - 2026-01-01\n${Array.from({ length: 10 }, (_, i) => `- Item ${i}.`).join("\n")}`;
    expect(releaseNotes(many)?.items).toHaveLength(RELEASE_NOTES_MAX);
    const long = firstSentence(`${"palavra ".repeat(40)}fim.`);
    expect(long.length).toBeLessThanOrEqual(161);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/\s…$/);
  });

  it("gives nothing when there is no numbered version yet", () => {
    expect(releaseNotes("# Changelog\n\n## [Não lançado]\n\n- Soon.")).toBeNull();
  });
});
