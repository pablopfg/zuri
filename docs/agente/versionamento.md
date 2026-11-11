# Versões, changelog e pré-releases

Uma versão do Zuri sai a cada 10 PRs mescladas na `develop` e reúne todas elas.
Ninguém precisa lembrar de subir número, editar o `CHANGELOG.md` ou criar tag:
o workflow [`versao.yml`](../../.github/workflows/versao.yml) conta os merges
e faz isso quando o décimo entra. Decisões do Pablo de 02/11/2026 (versões
automáticas) e de 11/11/2026 (só a cada 10 merges, em vez de uma por merge),
em `.claude/memoria/decisoes.md`.

## Quando sai uma versão

- Contam os merges da linha principal da `develop` depois da última versão.
  Com squash, cada PR mesclada é um merge. Os merges do próprio workflow
  (`chore(release):`) e os do workflow `README` não contam.
- Com menos de 10 esperando, o workflow roda e não muda nada: sem tag, sem
  pré-release, sem PR. Os arquivos de `changelog/nao-lancado/` ficam onde estão.
- Com 10 ou mais, sai **uma** versão com todos os que esperam, com a tag e a
  pré-release no commit do último deles.
- Para fechar a versão antes (por exemplo, antes de mandar a `develop` para a
  `main`): **Actions > Versão > Run workflow**, marcando **Criar a versão
  agora**. Ela sai com os merges que estiverem esperando, mesmo que seja um só.
  Confira que o run terminou e que a PR `chore(release):` abriu: o GitHub guarda
  só um run do workflow na fila, e um merge que entre nesse meio tempo troca o
  seu pedido por um run comum, que não fecha a versão. Se isso acontecer, rode
  de novo.
- O número 10 é a constante `MERGES_PER_VERSION` de `scripts/versao.ts`.
  `node scripts/versao.ts` mostra quantos merges esperam.

## Numeração

[SemVer](https://semver.org/lang/pt-BR/) para software em desenvolvimento:

| Merges da versão | Sobe | Exemplo |
| --- | --- | --- |
| Pelo menos um conclui uma etapa ou subetapa da especificação (11a, 19b, 22c…) | o número do meio | 0.17.4 → 0.18.0 |
| Nenhum conclui etapa (ajustes, correções, docs, CI, dependências) | o último | 0.18.0 → 0.18.1 |
| Primeiro lançamento na `main` | o primeiro, uma vez, com o OK do Pablo | 0.x.y → 1.0.0 |

Enquanto o primeiro número for 0, tudo é desenvolvimento. A 1.0.0 é decisão do
Pablo, junto com o primeiro release para a `main` (etapa 25); o workflow nunca
gera um número maior que 0.x sozinho.

A versão é a mesma em todos estes lugares (o `npm run lint` roda
`node scripts/versao.ts --conferir` e falha se um deles divergir; um teste em
`tests/repo/versao.test.ts` confere o mesmo):

- a seção mais nova do [`CHANGELOG.md`](../../CHANGELOG.md), que é a fonte;
- `packages/shared/src/version.ts` (`APP_VERSION`), escrito pelo script a
  partir dela e mostrado na interface: no pé do menu lateral, no pé da lista de
  Configurações no celular, em Configurações > Diagnóstico ("Versão da Zuri") e
  no formulário de "Relatar no GitHub";
- o campo `version` do `package.json` da raiz e de cada workspace
  (`packages/shared`, `apps/agent`, `apps/web`, lidos do campo `workspaces`);
- o `package-lock.json`: o `version` do topo, de `packages[""]` e de cada
  workspace;
- a tag `vX.Y.Z` no commit do último merge da versão, com a pré-release do GitHub (a partir da
  0.15.5; veja "Histórico").

Os outros arquivos não guardam versão: o `wrangler.jsonc` não tem esse campo
(cada deploy ganha o seu código, mostrado no Diagnóstico ao lado da versão), o
`manifest.webmanifest` também não, e o service worker não guarda cache, então
não tem número para trocar. Arquivo novo que passe a guardar a versão entra em `versionFiles` de
`scripts/versao.ts`, com teste.

Se algo ficar fora de sincronia (por exemplo, depois de resolver um conflito na
mão), `node scripts/versao.ts --sincronizar` escreve a versão do `CHANGELOG.md`
em todos os arquivos.

Esses arquivos só mudam quando a PR `chore(release):` mescla, minutos depois de
a versão sair. Por isso o build do commit marcado com `vX.Y.Z` ainda mostra a versão
anterior; o build da `develop` depois da PR de versão mostra a certa. Um deploy
sempre parte da `develop` (ou da `main`) em dia, nunca de uma tag solta.

Os pacotes continuam privados (`"private": true`) e nada vai para o npm: o
número nos `package.json` serve só para que todo arquivo diga a mesma versão
(pedido do Pablo de 02/11/2026).

## O que cada PR faz

Escreve a sua parte do changelog num arquivo novo
`changelog/nao-lancado/<assunto>.md`, como sempre (grupos `### Adicionado`,
`### Alterado`, `### Corrigido`, `### Segurança` e `### Atualização`, itens
`- `). A PR que conclui uma etapa ou subetapa põe esta linha no topo do arquivo:

```markdown
<!-- versao: minor -->
### Adicionado

- …
```

Basta um arquivo com a linha entre os merges da versão para ela subir o número
do meio; sem nenhum, sobe o último. Não existe `major`: a 1.0.0 é do
Pablo. Confira o arquivo com `node scripts/changelog.ts`, que mostra o tipo de
cada um.

PR sem mudança visível (CI, docs internas, dependências) pode ficar sem arquivo
(rótulo `sem-changelog`): ela conta para os 10 do mesmo jeito e aparece no
título da versão, que lista as PRs reunidas ("Reúne 10 mudanças (#290, #291,
…)"). Se nenhuma PR da versão trouxer arquivo, a seção fica com a linha "Sem
mudança visível". Versão de um merge só (fechada à mão com "Criar a versão
agora") leva o título da própria PR.

Nunca edite o `CHANGELOG.md`, o `version.ts` nem o `version` dos `package.json` e do `package-lock.json` à mão. "## [Não lançado]" fica
sempre vazio; o teste do repositório falha se alguém escrever ali.

## O que acontece depois do merge

1. O merge na `develop` dispara o workflow **Versão** (também roda de hora em
   hora e por `workflow_dispatch`).
2. `scripts/publicar-versao.ts` lê o `CHANGELOG.md` e acha os merges da
   `develop` depois da versão mais nova (só a linha principal, `--first-parent`).
   Com menos de 10 (e sem "Criar a versão agora"), o run termina aqui. Com 10
   ou mais, eles formam uma versão, com os arquivos que acrescentaram em
   `changelog/nao-lancado/` juntos numa seção só (`scripts/versao.ts`).
3. A versão sem tag ganha a tag `vX.Y.Z` no commit do último merge (por `git push`:
   a API de releases recusa ao `GITHUB_TOKEN` criar tag num commit cujos
   workflows diferem dos da `develop`) e uma
   **pré-release** no GitHub, com o título só "vX.Y.Z" (pedido do Pablo) e as
   notas da seção no formato de "Notas da pré-release", abaixo.
   Pré-release que já existe com outro título ou com as notas num formato
   antigo é reescrita no run seguinte, com o mesmo conteúdo; a tag não muda.
   Pré-release nunca vira "Latest" e não publica nada: não é deploy.
4. A branch `chore/versao` é refeita a partir da `develop` com as seções novas
   no `CHANGELOG.md`, os arquivos de `changelog/nao-lancado/` apagados e a
   versão nova no `version.ts`, nos `package.json` e no `package-lock.json`. Uma única PR `chore(release): versão X` fica aberta com
   ela, com o rótulo `sem-atualizacao-automatica` (o Update PRs não mexe nela)
   e auto-merge por squash. A CI que o push do bot dispara é aprovada pelo
   próprio workflow, como no Update PRs.
5. Se outra PR entrar antes de ela mesclar, o próximo run refaz a branch a
   partir da `develop`. A versão continua fechada no commit da tag: a PR nova
   já conta para a versão seguinte e o arquivo de changelog dela fica. Quando a PR de versão mescla, o merge dela não vira versão
   (título `chore(release):`), e o `CHANGELOG.md` fica em dia. A branch
   `chore/versao` é apagada em até 10 minutos pelo workflow `Branches`
   (`scripts/limpar-branches.ts`): o "Automatically delete head branches" do
   GitHub não apaga a branch de uma PR mesclada por auto-merge do
   `GITHUB_TOKEN`. Se ela fechar sem mesclar ("Nada a versionar"), o próprio
   workflow de versão apaga a branch.
6. A PR do workflow `README` (`docs(readme): atualiza o estado das etapas
   (automático)`, `.claude/rules/readme.md`) também não vira versão: muda só o
   mapa das etapas e as contagens do `README.md`.

Cada seção traz:

```markdown
## [0.17.0] - 2026-11-02

Mesclada às 09:20 (UTC-3) · commit [`d61079a`](…/commit/…) · Reúne 10 mudanças (#64, #65, …, #73)

### Adicionado
…
```

As versões de antes de 11/11/2026 (uma por merge) e as de um merge só trazem
também "· PR [#73](…)" e o título da PR. A data e a hora são as do último merge da versão no fuso `America/Sao_Paulo`; o deslocamento
(`UTC-3`) é lido do fuso, não fixado. No pé do arquivo ficam os links de cada
versão para a pré-release e de "Não lançado" para a comparação com a `develop`.

## Notas da pré-release

Todas as pré-releases seguem o mesmo formato (`releaseNotes` em
`scripts/versao.ts`):

```markdown
## Adiciona os comandos administrativos do bot e a gramática de datas

| Mesclada em | Pull request | Commit |
| :-- | :-- | :-- |
| 02/11/2026 às 15:49 (UTC-3) | [#89](…/pull/89) | [`e7546bf`](…/commit/…) |

### ✨ Adicionado
…
### 🔒 Segurança
…

---

**Histórico completo:** [`v0.19.0...v0.20.0`](…/compare/v0.19.0...v0.20.0)

Pré-release de desenvolvimento da `develop`, não é deploy. Todas as versões estão no [CHANGELOG.md](…).
```

- Os grupos ganham um ícone fixo, sempre na mesma ordem: ✨ Adicionado,
  🔄 Alterado, 🐛 Corrigido, 🔒 Segurança, ⬆️ Atualização. O `CHANGELOG.md`
  fica com os títulos sem ícone.
- Numa versão que reúne várias PRs, a coluna "Pull request" diz "sem PR" e os
  números ficam no título.
- "Histórico completo" compara a versão com a anterior. A 0.15.5 compara com
  o commit da 0.15.4, que não tem tag (veja "Histórico", abaixo).
- Mudou o formato: o próximo run do workflow reescreve as notas de todas as
  pré-releases que estiverem diferentes. Edição feita à mão nas notas também
  volta ao formato, então corrija o fragmento ou a seção, não a pré-release.

## Release na `main`

A pré-release é da `develop` e não é deploy. Quando a `develop` vai para a
`main` (PR `develop → main`, mesclado pelo Pablo com merge commit), o workflow
[`deploy.yml`](../../.github/workflows/deploy.yml) publica na Cloudflare e, só
se o deploy e as conferências passarem, o job `release` roda
`scripts/deploy/publicar-release.ts`:

- antes de abrir a PR `develop → main`, feche a versão com **Actions > Versão >
  Run workflow > Criar a versão agora** e espere a PR `chore(release):`
  mesclar, para nenhum merge ir para a `main` sem versão;
- a versão é a seção mais nova do `CHANGELOG.md` da `main`;
- a tag `vX.Y.Z` já existe (criada aqui, na `develop`) e precisa estar no
  histórico da `main`; sem ela, o job falha e não cria nem move tag nenhuma;
- se a `main` tem merges depois da tag que não são `chore(release)` nem o do
  README (a `develop` foi para a `main` com merges esperando versão, ou antes
  de a PR `chore(release)` mesclar), o job falha em vez de publicar uma versão antiga como *Latest*;
- a pré-release vira release, marcada como *Latest*, com as mesmas notas em
  pt-BR e a última linha trocada para "Versão publicada pela `main`.". O
  `versao.yml` conhece as duas formas e não desfaz a troca.

A 1.0.0 continua sendo decisão do Pablo, no primeiro release para a `main`.

## Garantias

- O workflow só roda na `develop`, com `GITHUB_TOKEN` (sem custo, sem segredo
  novo) e permissões de escrever tags, releases, a própria branch e a própria
  PR. Nunca empurra para `develop` ou `main` e nunca apaga tag; de uma
  pré-release que já existe, só acerta o título para "vX.Y.Z" e as notas
  para o formato atual, com o mesmo conteúdo.
- "Criar a versão agora" é uma caixa do próprio workflow (`workflow_dispatch`),
  que só quem tem escrita no repositório roda. O valor chega ao script por
  variável de ambiente e só o texto exato `true` vale; nada mais muda no run.
- O número de uma versão com tag fica congelado: se um fragmento for
  corrigido depois (por exemplo, o marcador `minor` esquecido), aquela versão
  mantém o número, os merges até a tag continuam nela e os seguintes contam
  para a próxima. As notas acompanham
  a seção do `CHANGELOG.md`: uma correção nela chega à pré-release no run seguinte.
- Depois que a versão ganha a tag, o texto dela é o dos arquivos naquele
  commit. Até a PR `chore(release):` mesclar, uma PR nova não acrescenta item a
  um arquivo de `changelog/nao-lancado/` que já existia: a mudança se perderia
  quando o arquivo for apagado. Cada PR cria o seu arquivo.
- Tag que já aponta para outro commit para o workflow antes de mexer na PR de
  versão, em vez de ser movida, e ele abre a issue padrão de falha
  (`docs/agente/issues.md`).
- Sem mudança desde o último run, a branch `chore/versao` não é empurrada de
  novo, para a CI dela não recomeçar a cada hora.
- O `Branches` roda no mesmo push da `develop` e pode apagar a `chore/versao`
  antiga no meio do run de versão. Por isso o workflow lê a branch com um único
  `git fetch`: se ela sumiu, conta como inexistente e cria a branch e a PR de
  novo. Qualquer outra falha do fetch (rede, permissão) para o run.
- Esquecer o marcador numa branch `feat/etapa-*` falha o `npm run lint`
  (`node scripts/changelog.ts`) na CI da própria PR.
- Fragmento fora do formato, `CHANGELOG.md` editado à mão ou a seção mais nova
  apontando para um commit fora da `develop` também param o workflow.
- A rotina de merge e as threads tratam a PR `chore(release):` como qualquer
  outra: ela não muda código, só `CHANGELOG.md`, `changelog/` e as linhas de
  versão. O check `merge-order` nunca a segura nem deixa que ela segure outra
  PR (uma atualização de dependência também muda o `package.json`).

## Quando algo dá errado

| Sinal | Causa provável | O que fazer |
| --- | --- | --- |
| Issue "[falha automática] Versão" com "GitHub Actions is not permitted to create or approve pull requests" | a opção do repositório está desligada | Pablo liga **Settings > Actions > General > Allow GitHub Actions to create and approve pull requests** e roda o workflow de novo |
| "tag vX.Y.Z could not be created", "release vX.Y.Z not created" ou "release vX.Y.Z not updated" | o GitHub recusou a tag ou a pré-release ao `GITHUB_TOKEN` | o resto do run segue (a PR de versão abre); veja a linha recusada no log e rode o workflow de novo |
| "vX.Y.Z points to …" | alguém criou a tag na mão | apague a tag errada (Pablo) ou corrija a seção, e rode de novo |
| A PR `chore(release):` parada com checks esperando | a aprovação da CI do bot falhou | aprove as execuções na aba Actions ou rode o workflow de novo |
| `node scripts/versao.ts` mostra versões pendentes há mais de uma hora | o workflow não rodou | abra Actions > Versão > Run workflow |
| Dez merges entraram e nenhuma versão saiu | algum é `chore(release):` ou do `README`, que não contam | `node scripts/versao.ts` diz quantos esperam; para não esperar, rode com "Criar a versão agora" |

Localmente: `node scripts/versao.ts` mostra o que falta escrever e quantos
merges esperam (`--agora` mostra a versão que sairia já). Ele lê as tags do seu
clone, então rode `git fetch --tags` antes.
`node scripts/versao.ts --notas 0.17.0` mostra as notas de uma versão.

## Histórico

O `CHANGELOG.md` foi refeito em 02/11/2026 a partir das 69 PRs mescladas na
`develop` até a #73: cada item do changelog antigo e de `changelog/nao-lancado/`
voltou para a PR que o escreveu, as etapas 0 a 13 subiram o número do meio e o
resto o último.

Até a 0.49.4 (11/11/2026) cada merge era uma versão; essas seções, tags e
pré-releases ficam como estão.

As tags e pré-releases começam na **0.15.5** (#68), constante
`FIRST_TAGGED_VERSION` de `scripts/versao.ts`. O GitHub não deixa o
`GITHUB_TOKEN` criar uma tag num commit cujos arquivos de `.github/workflows/`
diferem dos da `develop` ("refusing to allow a GitHub App to create or update
workflow … without `workflows` permission"), e todas as versões antes da #68
estão nesse caso. Elas ficam só no `CHANGELOG.md`, com o commit e a PR de cada
uma. Daqui em diante isso não se repete: o workflow cria a tag logo depois do
merge, quando os workflows do commit ainda são os da `develop`.
