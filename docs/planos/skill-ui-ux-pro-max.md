# Avaliação de segurança da skill `ui-ux-pro-max`

Situação: avaliada, segura com ressalvas
Origem: pedido do Pablo em 09/11/2026 ("Verifique as skills abaixo e crie 3 novos modelos com cada skill")
Repositório: `github.com/nextlevelbuilder/ui-ux-pro-max-skill`, ramo `main`
Commit avaliado: `4f2dbb67e64969a9a30ab00742f2d55d66ddec2b` (08/11/2026, licença MIT)

## 1. Veredito

**Segura para usar como texto e como busca local, fixada neste commit.** A skill principal (`ui-ux-pro-max`) é um `SKILL.md` com regras de interface e uma busca em Python que só lê arquivos CSV da própria pasta. Não acessa a rede, não pede chave e só grava arquivo quando recebe `--persist`. O risco está nas skills vizinhas do mesmo pacote, que chamam serviços pagos de geração de imagem ou rodam `npx` sem versão. Essas não foram usadas e não devem ser.

Ela **não foi instalada** no repositório. Para os modelos novos ela foi lida de um clone isolado, e a busca rodou com `python3 -I`, fora da pasta da skill, sem `--persist`.

## 2. Como foi avaliada

- Clone em pasta isolada fora do repositório do Zuri.
- 714 arquivos (24 MB): 7 skills em `.claude/skills/` (`ui-ux-pro-max`, `design`, `design-system`, `brand`, `banner-design`, `slides`, `ui-styling`), dados em CSV, a linha de comando `uipro` em `cli/` e configurações de MCP em `stack/`.
- Leitura completa do `SKILL.md` da `ui-ux-pro-max` (217 linhas) e dos imports, aberturas de arquivo e chamadas de sistema de `search.py`, `core.py`, `design_system.py` e `reasoning_contract.py` (3.045 linhas). Antes de rodar, conferi que só usam a biblioteca padrão do Python (`csv`, `re`, `json`, `argparse`, `pathlib`).
- Busca em todo o pacote por `subprocess`, `os.system`, `eval`, `exec`, `fetch`, `urllib`, `requests`, `npx`, `API_KEY`, caminhos de credenciais, frases de injeção ("ignore previous", "system prompt") e caracteres invisíveis (largura zero, controle bidirecional, tags Unicode). Nada disso aparece na `ui-ux-pro-max`, fora dos testes dela.

## 3. Evidências

| Ponto | O que tem | Risco |
| --- | --- | --- |
| `ui-ux-pro-max/SKILL.md` | Regras por prioridade: contraste 4,5:1, alvo de 44 px, foco visível, texto base de 16 px, rótulo visível em formulário, animação curta e com `prefers-reduced-motion`, ícone em SVG e nunca emoji. Diz com todas as letras que o resultado da busca é recomendação e não vence o usuário nem o repositório. | Nenhum |
| `scripts/search.py` e vizinhos | Busca BM25 nos CSV de estilos, paletas, fontes e boas práticas. Só lê arquivos; grava `design-system/<projeto>/MASTER.md` apenas com `--persist`. | Nenhum |
| `design` (logo, ícone, identidade) | `logo/generate.py` e afins leem `GEMINI_API_KEY`, `ATLASCLOUD_API_KEY` e `MUAPI_API_KEY` e mandam o pedido para serviços de imagem. | Alto para o Zuri: custo e dados saindo para terceiros |
| `ui-styling/shadcn_add.py` | Roda `npx shadcn@latest` por `subprocess`. | Médio: pacote sem versão fixa |
| `stack/.mcp.json` | Liga `@playwright/mcp@latest`, `chrome-devtools-mcp@latest` e `shadcn@latest mcp` por `npx -y`. | Médio: servidores sem versão fixa, rodando sozinhos |
| `cli/` (`uipro`) | Baixa a versão mais nova do pacote pela API do GitHub e copia para a pasta de skills. | Médio: troca o texto fora do commit fixado |
| Ganchos | Nenhum `hooks` nos `SKILL.md`. | Nenhum |
| Fontes | A busca de tipografia devolve o endereço do Google Fonts. | Baixo: no app, fonte só como arquivo servido pelo Worker |

## 4. Ressalvas para o Zuri

1. **Só a `ui-ux-pro-max`.** As skills `design`, `brand` e `banner-design` geram imagem por serviço pago; ficam fora pela regra do plano gratuito.
2. **Nada de `npx` sem versão.** Nem o `.mcp.json` do `stack/`, nem o `shadcn_add.py`, nem a linha de comando `uipro`.
3. **Resultado da busca é sugestão.** A paleta que ela devolveu para "assistente de IA" foi roxa; as regras do Zuri (sem roxo, uma cor de destaque, cores do Tailwind) vencem.
4. **Sem `--persist` no repositório.** Se um dia for usada para registrar um sistema de design, o arquivo vai para `docs/` numa PR própria, revisado à mão.

## 5. Como ela entrou nos modelos

As três buscas que rodaram foram `"personal AI assistant productivity calm" --design-system`, `"AI chat assistant private minimal" --design-system` e `"productivity assistant" --domain color`. Delas saíram os três modelos da rodada 4 que levam o nome da skill: estilo Suíço minimalista, Flat de produtividade (verde-azulado com laranja) e Nativo de IA (conversa com o mínimo de moldura). O detalhe de cada um está em [modelos-frontend.md](modelos-frontend.md).

## 6. Recomendação

Vale guardar **só a `ui-ux-pro-max`**, como texto e busca local, no catálogo de `.claude/skills-externas/` fixado em `4f2dbb67e64969a9a30ab00742f2d55d66ddec2b`, para consulta em plano de tela. Não instalar o plugin inteiro, o `.mcp.json`, a linha de comando nem as skills de geração de imagem. Isso fica para uma PR própria, se o Pablo quiser.
