# Plano · `main` limpa na primeira release

> Situação: **proposta, aguarda o OK do Pablo.** Nada foi feito na `main`. Este
> plano não apaga, não mescla e não publica nada; ele diz o que fazer quando a
> 1.0.0 for para a `main`.

## 1. Resumo

O Pablo pediu (09/11/2026) que a `main` comece só com o conteúdo da primeira
release: sem o que está hoje nela e sem rascunhos, planos, instruções de
agente e capturas de QA da `develop`. Hoje isso não aconteceria: um PR
`develop → main` levaria tudo, e ainda manteria os arquivos que a `main` já
tem. A proposta é uma **lista do que vai para a `main`** (tudo fora dela fica
só na `develop`) e um **commit de release montado por script**, com a árvore
podada, que entra na `main` por PR com merge commit, como manda o ruleset.

## 2. Contexto no sistema

O que existe hoje e importa para a release (conferido em 09/11/2026):

- **A `main` tem só 2 commits** (`e132254 Initial commit` e `b1fc6fb Create
  README.md`, de 30/10) com os arquivos de partida do projeto:
  `01-instrucoes-do-projeto.md` a `06-modo-continuo.md`, `LEIA-ME.md`,
  `README.md` e a pasta `repositorio-inicial/` (cópia antiga de `.claude/`,
  `AGENTS.md`, especificação etc.). A `develop` nasceu do `Initial commit` e
  nunca recebeu o `b1fc6fb`, então **um merge `develop → main` manteria esses
  arquivos** (o merge só apaga o que um dos lados apagou).
- **A `develop` tem 1.472 arquivos.** Pela lista da seção 6, ficam 735 e saem
  737. O peso cai de 84,6 MB para 10,3 MB; só `docs/capturas/pr/` tem 70 MB.
- **Ruleset da `main`** (`.github/rulesets/main.json`): PR obrigatório, só
  merge commit, sem force-push e sem exclusão, e os checks da CI, CodeQL,
  `merge-order` e `source-branch`.
- **`branch-policy.yml`** (check `source-branch`) só aceita PR para a `main`
  vindo da branch `develop` deste repositório.
- **`deploy.yml`** roda a cada push na `main`: a CI inteira de novo
  (`ci.yml` por `workflow_call`), o build da interface, o deploy com aprovação
  no ambiente `production` e o job `release`.
- **`scripts/deploy/publicar-release.ts`** (job `release`) lê a seção mais nova
  do `CHANGELOG.md` da `main` e exige que a tag `vX.Y.Z` (criada na `develop`
  pelo workflow `Versão`) esteja no histórico da `main`.
- **A 1.0.0 não tem caminho automático:** `scripts/versao.ts` só sobe `minor`
  ou `patch` (`<!-- versao: minor|patch -->`). A tabela de
  `docs/agente/versionamento.md` diz que a 1.0.0 é decisão do Pablo, mas falta
  o marcador.
- A branch padrão do repositório é a `develop`. Issues, Dependabot, modelo de
  PR e agendamentos dos workflows leem a branch padrão, então nada disso
  precisa estar na `main`.

## 3. Objetivo e critérios de aceite

1. Depois da primeira release, a `main` tem só os arquivos da lista da seção 6,
   idênticos aos da tag `v1.0.0`. Nenhum arquivo de hoje da `main` sobra.
2. Nenhum arquivo fora da lista entra na `main`, nem em releases futuras, nem
   se alguém criar uma pasta nova de rascunho na `develop` (lista do que fica,
   não do que sai).
3. A CI inteira passa na árvore podada (no PR da release e no `deploy.yml`).
4. O job `release` publica a release sem mudar de regra (tag no histórico da
   `main`).
5. Todo link relativo do `README.md` e dos documentos que vão para a `main`
   aponta para um arquivo que vai junto.
6. O arquivo "Source code" das releases do GitHub também sai sem os rascunhos.
7. Nada disso precisa de force-push nem de apagar a `main`.

## 4. Escopo

Dentro:

- a lista do que vai para a `main` e o script que monta o commit da release;
- os ajustes na `develop` para a árvore podada passar na CI;
- a troca do check `source-branch` e do ruleset da `main`;
- o marcador da 1.0.0 no versionamento;
- a documentação (`docs/agente/versionamento.md`, `docs/configuracao-github.md`).

Fora:

- mesclar na `main`, criar a release ou fazer deploy (continua sendo do Pablo);
- mudar o fluxo da `develop` (etapas, PRs, versões 0.x, pré-releases);
- reescrever o histórico da `develop` ou apagar qualquer coisa dela.

## 5. Como funciona para o Pablo

### Fluxo 1 · Primeira release (1.0.0)

1. A etapa 25 mescla na `develop` e a PR de ajustes deste plano também.
2. O Pablo dá o OK da 1.0.0. Uma PR para a `develop` com o fragmento
   `<!-- versao: major -->` gera a `v1.0.0` (tag e pré-release, como hoje).
3. O Pablo roda o workflow **Preparar release** (Actions → "Preparar release"
   → Run workflow, com a tag `v1.0.0`). Ele monta a branch `release/v1.0.0` e
   abre a PR `release: v1.0.0` para a `main`. A descrição da PR lista o que
   ficou de fora, por pasta, e quantos arquivos da `main` antiga saem.
4. A CI roda na PR (aprovação em "Approve and run", como nas PRs do bot). O
   check novo `release-content` confere que a árvore é exatamente a da tag
   podada pela lista.
5. O Pablo confere e clica em **Merge** (merge commit). O `deploy.yml` faz o
   resto, com a aprovação no ambiente `production`.

### Fluxo 2 · Releases seguintes

Iguais: nova tag na `develop`, "Preparar release" com a tag, PR, Merge. Não há
conflito nunca, porque o commit da release não é um merge de conteúdo: a árvore
dele é montada direto da tag.

### Textos visíveis

Sem tela nova: tudo acontece no GitHub. Títulos: workflow "Preparar release",
PR `release: vX.Y.Z`, check `release-content`.

## 6. Regras de negócio e limites

### O que vai para a `main` (lista fechada)

Fica em `release/manifesto.txt` na `develop` (um caminho ou pasta por linha).
Tudo que não casa com a lista fica de fora.

| Grupo | Caminhos | Por quê |
| --- | --- | --- |
| Código | `apps/`, `packages/` | O sistema |
| Testes que o deploy roda | `tests/e2e/`, `tests/lighthouse/` | O `deploy.yml` roda a CI inteira na `main` antes de publicar |
| Configuração da build | `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.base.json`, `vitest.config.ts`, `playwright.config.ts`, `playwright.lighthouse.config.ts`, `biome.json`, `i18n-ignore.json`, `.nvmrc`, `.npmrc`, `.editorconfig`, `.gitattributes`, `.gitignore` | `npm ci`, typecheck, lint e testes |
| Scripts que a CI e o deploy usam | `scripts/deploy/`, `scripts/lint-i18n.ts`, `scripts/lint-microcopy.ts`, `scripts/inventario-de-textos.ts`, `scripts/changelog.ts`, `scripts/versao.ts`, `scripts/publicar-versao.ts`, `scripts/readme.ts`, `scripts/atualizar-prs.ts`, `scripts/check-bundle-size.ts`, `scripts/gerar-chaves-vapid.ts` | `npm run lint`, `npm run size`, `publicar-release.ts` (importa `versao.ts` e `atualizar-prs.ts`, que importam os outros) e o guia de instalação (chaves VAPID) |
| Workflows da `main` | `.github/workflows/ci.yml`, `codeql.yml`, `deploy.yml`, `branch-policy.yml`, `.github/ISSUE_TEMPLATE/erro.yml` | CI, CodeQL e deploy; o `erro.yml` é lido por um teste da interface (relato de problema do Diagnóstico) |
| Documentos para quem instala e usa | `README.md`, `LICENSE`, `NOTICE.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/*.md` (menos `docs/especificacao.md`), `docs/arquitetura/`, `docs/assets/zuri-*.svg`, `docs/capturas/*.png` (só as do README, sem subpastas) | Instalação, uso, licença e as capturas do README |

### O que fica só na `develop`

| Sai | Arquivos | Por quê |
| --- | --- | --- |
| `docs/capturas/pr/` | 572 (70 MB) | Capturas das PRs |
| `docs/assets/etapa-05/`, `etapa-06/`, `etapa-07/` | 32 (5 MB) | Capturas de QA das etapas |
| `docs/planos/` | 39 | Planos e rascunhos |
| `docs/agente/`, `docs/agents/` | 8 | Instruções e prompts dos agentes |
| `docs/qa/` | 8 | Estratégia de testes, auditorias e matrizes |
| `docs/especificacao.md` | 1 | Especificação de desenvolvimento |
| `.claude/` | 35 | Regras, skills, subagentes e memória do agente |
| `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` | 3 | Guias de quem desenvolve (a contribuição acontece na `develop`) |
| `changelog/nao-lancado/` | 1 | Fragmentos de versões ainda não escritas |
| `tests/repo/` | 16 | Testes da automação do repositório (workflows, rulesets, versão, README) |
| `.github/workflows/` de manutenção | 6 | `readme.yml`, `update-prs.yml`, `merge-order.yml`, `branches.yml`, `seguir-merge.yml`, `versao.yml`: só rodam na `develop` |
| `.github/rulesets/`, `pull_request_template.md`, `dependabot.yml`, `ISSUE_TEMPLATE/config.yml` | 5 | Configuração do repositório, lida da branch padrão |
| Scripts de desenvolvimento | 11 | Capturas, dados de exemplo, avaliação de prompts, ícones, instalação de skills, merge e limpeza de branches, issue de falha |
| O conteúdo atual da `main` | 49 | `01-…` a `06-…`, `LEIA-ME.md`, `repositorio-inicial/` e o `README.md` antigo |

A conta exata sai do script (`--listar`), não desta tabela.

## 7. Desenho técnico

### Como o commit da release é montado

`scripts/release/montar-main.ts vX.Y.Z`:

1. lê a árvore da tag e mantém só o que casa com `release/manifesto.txt`;
2. grava essa árvore e cria um commit com **dois pais**, a `main` atual e o
   commit da tag (`git commit-tree <árvore> -p origin/main -p <tag>`), com a
   mensagem `release: vX.Y.Z`;
3. empurra para `release/vX.Y.Z` e abre a PR para a `main`.

Assim:

- a árvore da `main` passa a ser só a lista, e o que a `main` tinha antes some
  sem force-push (o commit simplesmente não tem esses arquivos);
- a tag fica no histórico da `main`, e o `publicar-release.ts` funciona sem
  mudar a regra (o commit da release é um merge, então o
  `git log --no-merges tag..HEAD` continua vazio);
- nunca há conflito: a árvore não é resultado de um merge de conteúdo.

O histórico da `main` continua alcançando os commits da `develop` (os rascunhos
aparecem no histórico, não nos arquivos). Como o repositório é público e a
`develop` também, isso não expõe nada novo. Quem quiser histórico limpo, veja a
alternativa B na seção 14.

### Arquivos

| Arquivo | Mudança |
| --- | --- |
| `release/manifesto.txt` | Novo: a lista da seção 6 |
| `scripts/release/montar-main.ts` | Novo: monta a árvore, o commit e a PR; `--listar` mostra o que fica e o que sai sem gravar nada |
| `scripts/release/conferir-release.ts` | Novo: recalcula a árvore podada da tag e compara com a da PR; confere os dois pais e os links relativos dos `.md` que vão juntos |
| `.github/workflows/preparar-release.yml` | Novo: `workflow_dispatch` com a tag; `contents: write` e `pull-requests: write` só nele; não roda código da PR |
| `.github/workflows/branch-policy.yml` | Aceita só `release/v*` deste repositório (não mais `develop`) e ganha o job `release-content` |
| `.github/rulesets/main.json` | Tira `merge-order` (não existe na árvore podada e não faz sentido na `main`), troca `source-branch` por `release-content` |
| `vitest.config.ts` | O projeto `repo` só entra quando `tests/repo/` existe (hoje a árvore podada falha com "No test files found") |
| `scripts/changelog.ts` | Aceita `changelog/nao-lancado/` ausente (hoje dá `ENOENT` no `npm run lint` da árvore podada) |
| `scripts/changelog.ts`, `scripts/versao.ts` | Marcador `<!-- versao: major -->`, aceito uma vez, só para sair de 0.x para 1.0.0 |
| `.gitattributes` | `export-ignore` para o que sai, gerado da lista e conferido por teste: o "Source code (zip)" da release vem da tag, que é da `develop` |
| `ci.yml` (na `develop`) | Job barato `release-dry-run`: monta a árvore podada e roda `npm run typecheck`, `npm run lint` e `npm run build` nela, para nenhum PR quebrar a release sem ninguém ver |
| `README.md` | Já compactado neste PR: links para o que fica só na `develop` usam endereço absoluto |
| `docs/agente/versionamento.md`, `docs/configuracao-github.md` | Fluxo novo da release, o ruleset novo e o que o Pablo reimporta |

### Rotas e contratos

Sem rota nova: só repositório e CI.

### Banco

Sem migration.

### Ferramentas do agente

Sem ferramenta nova. O agente de desenvolvimento continua sem abrir nem mesclar
PR para a `main`.

### Agendamentos, IA e integrações externas

Nenhum. O workflow novo só roda quando o Pablo manda.

## 8. Custo e cotas do plano Free

Zero. GitHub Actions é grátis em repositório público; o job `release-dry-run`
soma uns 3 minutos por PR. Nada muda na Cloudflare.

## 9. Segurança e privacidade

- O `preparar-release.yml` roda só por `workflow_dispatch` (quem tem escrita),
  lê só a tag pedida, confere que ela existe e que é uma release do workflow
  `Versão`, e não executa código do repositório antes de montar a árvore (o
  script é o da `develop`, não o da tag).
- O check `release-content` impede uma PR para a `main` com qualquer arquivo
  fora da lista ou diferente da tag, mesmo vinda de uma branch `release/v*`
  criada à mão.
- O `deploy.yml` não muda: o token da Cloudflare continua só no ambiente
  `production`, com aprovação.
- Remover os rascunhos da `main` não esconde nada: o repositório é público e a
  `develop` guarda tudo. O ganho é a `main` ter só o que vai para produção.

## 10. Testes

- `tests/repo/release.test.ts`: a lista separa os caminhos da seção 6 (n−1, n,
  n+1 em prefixos parecidos, como `docs/capturas/x.png` × `docs/capturas/pr/x.png`
  e `docs/especificacao.md` × `docs/seguranca.md`); um arquivo novo em pasta
  desconhecida fica de fora; o commit tem os dois pais certos; `--listar` não
  grava nada.
- `release-content`: falha com arquivo a mais, arquivo a menos, conteúdo
  diferente da tag, pai errado e branch que não é `release/v*`.
- `.gitattributes`: o teste confere que o `export-ignore` bate com a lista.
- Versão: `<!-- versao: major -->` sai de 0.x para 1.0.0 e é recusado depois.
- Ensaio feito para este plano (09/11/2026, Node 26, árvore podada da
  `develop` em `d1819ba`, com `docs/assets/` inteira): `npm ci`, `npm run typecheck`, `npm run i18n`,
  `npm run build` e `npm run size` passaram; os testes de `shared` e `web`
  passaram depois de manter o `erro.yml`, e os do agente também (114 arquivos, 2.435 testes); `npm run lint` falhou só pela pasta
  `changelog/nao-lancado/` ausente (passou com a pasta vazia); o projeto `repo`
  do Vitest falhou por não ter teste. O e2e e o Lighthouse não rodaram no
  ensaio e vão rodar na própria PR da release.

## 11. Entrega

1. **PR 1 (`develop`)**: lista, scripts, testes, `vitest.config.ts`,
   `changelog.ts`, marcador `major`, `.gitattributes`, `release-dry-run` e
   documentação.
2. **PR 2 (`develop`)**: `preparar-release.yml`, `branch-policy.yml` e
   `rulesets/main.json`. Depois do merge, o Pablo reimporta o ruleset da `main`
   (Settings → Rules → Rulesets → main → Import), como já fez com os outros.
3. **Primeira release**: Fluxo 1 da seção 5.

## 12. Riscos

| Risco | Como fica coberto |
| --- | --- |
| Um arquivo de que o sistema precisa fica de fora | `release-dry-run` em toda PR da `develop` e a CI inteira na PR da release, antes do merge |
| Um rascunho novo entra na `main` | Lista do que fica (não do que sai) e o check `release-content` |
| Link quebrado na `main` | `conferir-release.ts` confere os links relativos dos `.md` que vão juntos; o README usa endereço absoluto para a `develop` |
| A PR da release não roda a CI (criada pelo `GITHUB_TOKEN`) | Como nas PRs do bot: as execuções ficam em "Approve and run"; o workflow tenta aprovar, e o Pablo aprova se não der |
| Ruleset antigo bloqueia a PR (`merge-order`, `source-branch`) | PR 2 troca os checks; a reimportação do ruleset vem antes da primeira release |
| Alguém faz um PR `develop → main` direto | O `branch-policy.yml` novo recusa |
| O "Source code (zip)" da release leva os rascunhos | `export-ignore` |
| O job `release` não acha a tag | A tag é um dos pais do commit da release; teste do script |

## 13. Suposições

- O e2e e o Lighthouse passam na árvore podada como passam na `develop` (eles
  não leem nada do que sai, pela busca nos arquivos; o ensaio não os rodou).
- O `GITHUB_TOKEN` consegue abrir a PR para a `main` ("Allow GitHub Actions to
  create and approve pull requests" já está ligado, porque o workflow `README`
  abre PRs).

## 14. Entrevista com o Pablo

### Perguntas abertas

1. **Histórico da `main`.** Recomendação: **A, commit de release com dois pais**
   (seção 7). A `main` fica só com os arquivos da release, sem force-push e sem
   mudar o job `release`; o histórico ainda mostra os commits da `develop`.
   Alternativa **B, `main` órfã**: um commit por release, sem nenhum histórico
   da `develop` nem os 2 commits de hoje. Custa recriar a `main` uma vez (o
   Pablo libera o ruleset por alguns minutos ou apaga e recria a branch), e o
   `publicar-release.ts` passa a comparar árvores em vez de procurar a tag no
   histórico.
2. **`tests/e2e` e `tests/lighthouse` na `main`.** Recomendação: ficam, porque
   o `deploy.yml` roda a CI inteira antes de publicar. Tirar exigiria uma CI só
   de build na `main`, que é menos segura.
