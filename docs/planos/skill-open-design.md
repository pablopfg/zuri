# Avaliação de segurança do `open-design`

Situação: avaliado; usar só como texto de referência
Origem: pedido do Pablo em 09/11/2026 ("Verifique as skills abaixo e crie 3 novos modelos com cada skill")
Repositório: `github.com/nexu-io/open-design`, ramo `main`
Commit avaliado: `07a86b1041531bfa0bec1006d9c0993985fee560` (09/11/2026, licença Apache 2.0)

## 1. Veredito

**Não é uma skill, é um aplicativo inteiro.** O repositório traz um programa de computador e um serviço local (`od`) que procuram o agente de código instalado na máquina, rodam skills e mostram o resultado numa prévia. Junto vêm 562 skills e 151 sistemas de design em texto.

- **O aplicativo não deve ser instalado.** A instalação roda `postinstall`, o serviço local inicia agentes sozinho e, pelo próprio `PRIVACY.md`, a coleta de uso vem **ligada por padrão**. Ela pode incluir o texto das conversas, e um canal de diagnóstico não desliga nunca nas versões oficiais. Isso bate de frente com a regra "sem telemetria" do Zuri.
- **Os textos podem ser lidos com segurança.** Nos `SKILL.md` e nos sistemas de design não há gancho, instrução contra o dono nem caractere escondido. Os três modelos desta rodada usam só esses textos, lidos de um clone isolado, sem rodar nada.

## 2. Como foi avaliado

- Clone em pasta isolada fora do repositório do Zuri; nenhum script, instalação ou serviço executado.
- 14.266 arquivos (363 MB): `apps/` (programa e serviço), `plugins/`, `skills/` (562 `SKILL.md`), `design-systems/` (151 pacotes com `DESIGN.md`, `tokens.css` e `manifest.json`).
- Leitura de `package.json`, `PRIVACY.md`, dos `SKILL.md` de `login-flow`, `brandkit` e `frontend-skill`, e de `DESIGN.md`/`tokens.css` dos sistemas `agentic`, `spacious`, `refined`, `application`, `sleek`, `paper` e `kami`.
- Varredura automática de todos os `.md`, `.json`, `.css` e `.yaml` de `skills/` e `design-systems/` atrás de ganchos, frases de injeção ("ignore previous instructions", "system prompt", "sem avisar"), caminhos de credenciais, `curl | sh`, `npx` e chaves de API.

## 3. Evidências

| Ponto | O que tem | Risco |
| --- | --- | --- |
| `package.json` | `postinstall` roda `scripts/postinstall.mjs`; o binário `od` sobe o serviço local. | Alto se instalado: código de terceiros rodando na máquina |
| `PRIVACY.md` | Métricas e trechos de conversa enviados por padrão (dá para desligar); diagnóstico sempre ligado nas versões oficiais. | Alto para o Zuri: telemetria |
| Skills de imagem, voz e vídeo (`fal-*`, `venice-*`, `minimax-*`, `hatch-pet`) | Pedem chave de API de serviços pagos. | Alto: custo |
| `web-clone`, `chat-motion-overlay`, `taste-skill` | Mandam rodar `npx skills`, `npx remotion` e `npx shadcn@latest` sem versão fixa. | Médio se seguido |
| Ganchos | Nenhum `hooks` em `SKILL.md`. | Nenhum |
| Injeção e texto escondido | Nenhuma frase de injeção. O único arquivo com marcas bidirecionais é `design-systems/openai/DESIGN-ar.md`, em árabe, onde elas são normais. | Nenhum |
| Sistemas de design com marca | Muitos imitam marcas reais (`apple`, `airbnb`, `stripe`, `spotify`, `tesla`…). | Médio: copiar visual de marca alheia. Não usados |
| Sistemas genéricos (`agentic`, `spacious`, `refined`) | Cores, fontes, espaçamento e regras de composição em texto. | Nenhum |
| `brandkit` | Método para logomarca: inicial com significado, ação do produto, fusão de metáforas, espaço negativo, geometria de construção. Pede gerador de imagem, que não foi usado; o método foi aplicado à mão em SVG. | Nenhum |
| `login-flow` | Rótulo acima do campo, mostrar e ocultar senha, erro embaixo do campo, carregamento no botão, alvo de 44 px. | Nenhum |

## 4. Ressalvas para o Zuri

1. **Não instalar o aplicativo nem o serviço `od`**, nem em máquina de desenvolvimento ligada ao repositório.
2. **Nada de sistema de design com nome de marca.** Só os genéricos.
3. **Skills de geração por IA ficam fora** pela regra do plano gratuito.
4. **Os textos não viram dependência.** Se o Pablo quiser guardar algum, entra fixado por commit em `.claude/skills-externas/`, numa PR própria.

## 5. Como ele entrou nos modelos

- **Agêntico**, do sistema `agentic`: interface de conversa primeiro, poucos controles, tarefas delegadas com resultado claro; fundo azul-noite e destaque azul-céu.
- **Espaçoso**, do sistema `spacious`: muito respiro, grade previsível, creme quente e destaque bronze.
- **Refinado**, do sistema `refined`: serifada nos títulos, paleta discreta de papel e cobre.

Todos seguem as regras do `login-flow` e o método de logomarca do `brandkit`. O detalhe está em [modelos-frontend.md](modelos-frontend.md).

## 6. Recomendação

Usar o `open-design` só como **biblioteca de leitura** fixada neste commit. Se valer guardar algo, o candidato é o texto do `login-flow` e o método de logomarca do `brandkit`, nunca o aplicativo.
