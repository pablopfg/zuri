# Avaliação de segurança da skill `taste-skill`

Situação: avaliada, segura com ressalvas
Origem: pedido do Pablo em 09/11/2026 ("Verifique a seguinte skill… se for segura, use ela para criar 5 novos modelos de frontend")
Repositório: `github.com/Leonxlnx/taste-skill`, ramo `main`
Commit avaliado: `f6b76575f949707b4e3c37cd86cb44b0b98643e8` (07/11/2026, versão 2.5.1, licença MIT)

## 1. Veredito

**Segura para usar fixada neste commit.** Nenhum arquivo executa nada escondido, manda dados para fora, pede credenciais, chave de API ou serviço pago, nem traz instrução para o agente agir contra o dono. As ressalvas da seção 4 são de encaixe com o Zuri, não de segurança.

Ela **não foi instalada** no repositório. Para os modelos de frontend ela foi lida de um clone isolado, e só o script local de sorteio de paletas e fontes (`scripts/start.mjs deal`) rodou, numa pasta temporária fora do repositório, depois de lido.

## 2. Como foi avaliada

- Clone em pasta isolada fora do repositório do Zuri; nenhum script rodou antes de ser lido.
- 1.663 arquivos (41 MB): 963 SVG, 133 JS, 23 MJS, 127 HTML, 84 CSS, 31 Markdown, 133 JSON, imagens (WebP, PNG, JPG), 1 script de shell (`install.sh`) e 1 workflow da CI.
- Leitura completa do `SKILL.md`, do `install.sh`, dos manifestos de plugin (`.claude-plugin/`, `.codex-plugin/`, `.agents/`), do workflow da CI e dos scripts com rede ou processo filho.
- Busca em tudo por: `child_process`, `exec`, `spawn`, `fetch`, `http(s).request`, `WebSocket`, `eval`, `new Function`, `process.env`, caminhos de credenciais (`.ssh`, `.aws`, `token`, `secret`, `api key`), frases de injeção ("ignore previous", "system prompt", "sem avisar"), `curl`, `wget`, `sudo`, `rm -rf`, `npm install`.
- Busca por caracteres invisíveis (largura zero, controle bidirecional, tags Unicode) e por blocos longos de base64.
- SVGs conferidos por `<script>`, `onload`, `onerror`, `foreignObject` e `javascript:`.

## 3. Evidências

| Ponto | O que tem | Risco |
| --- | --- | --- |
| `SKILL.md` | Instruções de design para sites de empresa (página de apresentação). Sem pedido de credencial, dado pessoal, recurso pago ou desvio de regra. | Nenhum |
| Hook no `SKILL.md` | Gancho `Stop` que roda `node scripts/gate.mjs --hook claude` quando o agente vai parar. Só faz algo se existir `.taste-skill/build.json` na pasta; aí confere a página e pode **segurar a parada** com a lista de falhas, no máximo 4 vezes por página e 30 em 6 horas. Grava só em `.taste-skill/`. | Baixo: intrusivo, não malicioso |
| `install.sh` | Cria links simbólicos de `skills/` em `~/.claude/skills` ou `~/.codex/skills`. Não baixa nem executa nada. | Nenhum (não usado) |
| Rede em `scripts/photos.mjs` | Só GET, e só quando chamado: busca e baixa fotos de `commons.wikimedia.org`/`upload.wikimedia.org` e `picsum.photos`; confere o host antes de baixar. | Baixo (não usado) |
| Rede em `scripts/icons.mjs` | Só GET de ícones em `cdn.jsdelivr.net`, em versões e commit fixados; cache na pasta temporária do sistema. | Baixo (não usado) |
| Rede em `assets/components/fx-map/bake.mjs` | Consulta a `overpass-api.de` (OpenStreetMap) para mapas, só quando chamado. | Baixo (não usado) |
| `assets/system.js` | Envia formulário de página só para o `data-endpoint` que o próprio autor da página escreve. | Nenhum |
| Checadores (`gate.mjs`, `consistency.mjs`, `shoot.mjs`, `perf.mjs`, `check.mjs`) | Abrem Chrome sem janela com perfil em pasta temporária, falam com ele por `127.0.0.1` e leem a página local. Encerram o próprio processo. | Baixo (não usado) |
| `start.mjs` (o único que rodou) | Lê `library/palettes.json` e `library/type.json` e imprime paletas e fontes. Grava só `.taste-skill/` na pasta atual. Sem rede, sem processo filho. | Nenhum |
| Fontes | Todas do Google Fonts, por link. | Ver ressalva 3 |
| Caracteres invisíveis | Só um BOM dentro de uma expressão regular de `start.mjs` (para tirar BOM de JSON). | Nenhum |
| Base64 | Só miniaturas WebP (`lqip`) em `assets/photos/photos.json`. | Nenhum |
| SVGs | Nenhum com script ou manipulador de evento. | Nenhum |
| Manifesto `.agents/plugins/marketplace.json` | Aponta para o ramo `main`, sem commit fixo. | Médio se instalado por ele; por isso só fixado por commit |

## 4. Ressalvas para o Zuri

1. **Feita para outra coisa.** A skill mira sites de apresentação ("uma seção por tela", fotos grandes, efeitos de rolagem). O Zuri é um app de trabalho. Valeu para tirar direção visual (paletas por ramo, pares de fontes, regras de contraste, foco e toque de 44 px), não para montar as telas.
2. **O gancho `Stop`.** Se um dia for instalada, ele entra junto com a skill e pode segurar o fim de uma conversa enquanto existir `.taste-skill/build.json`. Nas telas do app ele nunca dispara, mas fica uma peça a mais rodando. Se for adotada, vale bloquear o `gate.mjs` em `permissions.deny`, como foi feito com o `kie.mjs` do `scroll-craft`.
3. **Fontes externas.** O app não pode buscar fonte no Google na hora de abrir (regra de nada de chamada a terceiros e a CSP). Qualquer fonte escolhida entra como arquivo `woff2` servido pelo próprio Worker, fora do JS inicial.
4. **Regra "nunca violeta".** Gosto da skill, não regra do Zuri; os modelos seguiram, porque não atrapalha.

## 5. Recomendação

Não adotar como skill fixa do repositório. O que ela tem de útil para o Zuri (paletas e fontes) já foi aproveitado nos cinco modelos de `docs/planos/modelos-frontend.md`, e o `frontend-design` já cobre o plano de tela. Se o Pablo quiser adotar mesmo assim: catálogo de `.claude/skills-externas/` fixado em `f6b76575f949707b4e3c37cd86cb44b0b98643e8`, com `scripts/gate.mjs` e `scripts/photos.mjs` em `permissions.deny`.
