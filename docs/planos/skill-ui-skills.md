# Avaliação de segurança da skill `ui-skills`

Situação: avaliada, segura com ressalvas
Origem: pedido do Pablo em 09/11/2026 ("avalie a skill https://github.com/ibelick/ui-skills, se for segura, crie 3 novos modelos, seguindo os padrões da skill")
Repositório: `github.com/ibelick/ui-skills`, ramo `main`
Commit avaliado: `97dea9e747ea94d5671ef1468cbb8f9bd5f32542` (07/11/2026, licença MIT)

## 1. Veredito

**Segura para usar como texto, fixada neste commit.** As skills são só instruções em Markdown: nada roda sozinho, não há gancho, não pedem credencial, chave nem serviço pago, e não há instrução contra o dono. O risco está no que fica em volta (a linha de comando `ui-skills` e dois `npx` sem versão), que não foi usado e não deve ser.

Ela **não foi instalada** no repositório. Para os modelos novos ela foi lida de um clone isolado, e nenhum script dela rodou.

## 2. Como foi avaliada

- Clone em pasta isolada fora do repositório do Zuri; nada executado.
- 322 arquivos (4,2 MB). O repositório é o site `ui-skills.com` (Astro, Worker da Cloudflare, migrations) mais a pasta `skills/` com 9 skills e a linha de comando em `bin/`.
- Leitura completa dos 9 `SKILL.md` (1.197 linhas), de `improve-ui/references/plan-template.md`, de `improve-ui/agents/openai.yaml`, de `bin/ui-skills*`, do `package.json` e dos workflows da CI.
- Busca nas skills e na linha de comando por `fetch`, `npx`, `curl`, `http`, `child_process`, `process.env`, `writeFile`, caminhos de credenciais, frases de injeção ("ignore previous", "system prompt", "sem avisar") e caracteres invisíveis (largura zero, controle bidirecional, tags Unicode). Nada suspeito; "token" nas skills é sempre token de design.

## 3. Evidências

| Ponto | O que tem | Risco |
| --- | --- | --- |
| `baseline-ui` | Regras de interface: cores e sombras padrão do Tailwind, animar só `transform`/`opacity` em até 200 ms, sem gradiente nem roxo, um destaque por tela, `text-balance` em títulos, `tabular-nums` em números, `h-dvh`, escala fixa de `z-index`, diálogo de confirmação em ação destrutiva, estado vazio com uma ação, `aria-label` em botão só com ícone. | Nenhum |
| `fixing-accessibility`, `fixing-motion-performance`, `fixing-metadata`, `improve-ui` | Listas de conferência em Markdown. `improve-ui` traz um modelo de plano e um `openai.yaml` só com nome e descrição. | Nenhum |
| `component-canvas`, `create-canvas` | Montam uma página de vitrine de componentes; mandam não mexer no código dos componentes. | Nenhum (não usado) |
| `create-design-md` | Manda rodar `npx @google/design.md` **sem versão fixa**. | Médio se seguido: baixa e roda pacote que pode mudar |
| `ui-skills-root` | Manda usar `npx ui-skills start/list/get`. | Médio se seguido (ver abaixo) |
| `bin/ui-skills.ts` | Linha de comando que baixa a lista e o texto das skills de `www.ui-skills.com` (endereço trocável por `UI_SKILLS_SITE_URL`) e imprime na tela. Não grava arquivo. | Médio: o texto vem do servidor na hora, sem commit fixo, e pode mudar sem aviso |
| Ganchos | Nenhum `hooks` nos `SKILL.md`. | Nenhum |
| CI | Publica o pacote no npm e cria release; não afeta quem só lê as skills. | Nenhum |

## 4. Ressalvas para o Zuri

1. **Use o texto, nunca a linha de comando.** `npx ui-skills` e `ui-skills-root` trazem instruções do servidor na hora, fora do commit fixado. Mesma regra para o `npx @google/design.md` da `create-design-md`.
2. **Componentes acessíveis.** A `baseline-ui` sugere Base UI, Radix ou React Aria. O Zuri tem teto de JS inicial (139.600 B); biblioteca nova só se couber e com o OK do Pablo. Os modelos não pedem nenhuma.
3. **Cores padrão do Tailwind.** O app já usa Tailwind, então as paletas dos modelos novos (zinc, stone, slate, emerald, orange, sky) não custam nada; as fontes ficam as do sistema.
4. **Regras que conflitam com o repositório.** Nenhuma. Onde houver diferença, as regras do Zuri vencem.

## 5. Recomendação

Vale adotar **só a `baseline-ui` e a `fixing-accessibility`**, como texto, no catálogo de `.claude/skills-externas/` fixado em `97dea9e747ea94d5671ef1468cbb8f9bd5f32542`, usadas junto do `frontend-design` em plano de tela. Não instalar `ui-skills-root`, `create-design-md` nem o pacote npm. Isso fica para uma PR própria, se o Pablo quiser.
