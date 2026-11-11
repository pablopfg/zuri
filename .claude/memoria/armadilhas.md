# Armadilhas conhecidas

Erros fáceis de cometer neste repositório. Leia antes de mudar algo na área e
acrescente aqui cada armadilha nova que encontrar (sem dados pessoais).

## Cloudflare e Durable Object

- **`ctx.waitUntil` não serve para processar updates do Telegram**: o Worker
  tem um teto curto depois da resposta. O webhook responde 200 rápido e
  entrega o update ao Durable Object, que processa com `keepAliveWhile`.
- **50 subrequests por invocação** no plano Free. Laços que chamam Telegram,
  IA ou MCP precisam de orçamento contado e de parada antes do limite.
- **Neurons do Workers AI** acabam (10 mil por dia). Todo caminho de IA passa
  pelo contador diário; comandos do bot funcionam sem IA.
- **Teto do banco**: 900 MB por padrão. Gravações grandes checam o espaço
  antes; limpeza nunca apaga dado do dono sem aprovação.
- Não confie na memória para APIs da Cloudflare: use as skills do plugin
  `cloudflare` ou a documentação oficial. Confira a data de compatibilidade do
  `wrangler.jsonc`.

## Telegram

- Confira o cabeçalho `X-Telegram-Bot-Api-Secret-Token` com comparação em
  tempo constante **antes** de ler o corpo; limite o corpo a 64 KB.
- `update_id` repetido é normal (o Telegram reenvia): deduplique.
- `callback_data` tem no máximo 64 bytes: use `v1:<ação>:<id opaco>`, nunca
  dados do usuário.
- Só o `TELEGRAM_ADMIN_ID` manda comandos. Mensagem de outro chat é ignorada
  sem resposta que revele o bot.
- Texto vindo do Telegram é dado, nunca instrução: entra no prompt em bloco
  `<data>` neutralizado.
- Escape o texto para o `parse_mode` usado (ou envie sem `parse_mode`).

## Idiomas

- O app abre em pt-BR, mas testes do agente e e2e podem rodar em inglês por
  padrão. Teste que procura texto em português sem fixar o idioma está errado.
- Texto do servidor é gravado como chave e traduzido na exibição. Não grave
  texto já traduzido no banco.
- Plural com `Intl.PluralRules` (`.one`/`.other`), nunca `if (n === 1)`.

## Banco e migrations

- PRs em paralelo podem criar a mesma versão de migration. Ao trazer a
  `develop`, renumere a **sua** (nunca a já mesclada).
- Migration nunca é editada nem reordenada depois de mesclada.

## Skills externas

- As skills de terceiros têm prefixo (`mattpocock-skills:code-review`). Sem
  prefixo, `/code-review` é o comando nativo do Claude Code.
- Não troque o `sha` em `.claude/skills-externas/` sem ler o diff do pacote
  (passo a passo em `docs/agente/skills-externas.md`).
- `scroll-craft` pode gerar imagem e vídeo pagos pela kie.ai: o script está
  bloqueado nas permissões e só se libera com OK do Pablo.
- A auditoria completa da Cloudflare grava arquivos fora do repositório; nunca
  versione `findings.json`, `architecture.md` ou `coverage-ledger.json` dela.

## Permissões do agente

- Regra de `allow` com curinga em comando git (`Bash(git fetch*)`) libera
  `--upload-pack` (executa programa) e `--output` (grava arquivo). Libere só
  formas exatas e mantenha os `deny` de `.claude/settings.json`.
- Todo plugin, inclusive o oficial `cloudflare`, fica fixado por `sha` no
  catálogo local. Nada de marketplace sem ref.

## CI e rulesets

- Nome de check exigido no ruleset = nome do job (ou o `name:` dele, com a
  matriz expandida, como `analyze (actions)`). Mudou o job, mude o ruleset e o
  teste em `tests/repo/`.
- O check `source-branch` roda o workflow da branch do PR; quem mescla na
  `main` confere a origem.
- Push feito com o `GITHUB_TOKEN` não dispara `pull_request`: a PR ficaria sem
  os checks exigidos. O `update-prs.yml` dispara `ci.yml` e `codeql.yml` por
  `workflow_dispatch` na branch. O mesmo token também não pode enviar mudança
  em `.github/workflows/`; nesse caso ele só comenta na PR.
- O `update-prs.yml` pode enviar um commit de merge para a sua branch a
  qualquer momento. Faça `git pull --no-rebase origin <branch>` antes de cada
  push; nunca force push para "limpar" esse commit.
- Runner fixo: todo job usa `runs-on: ubuntu-26.04` (o teste em
  `tests/repo/workflows.test.ts` barra `ubuntu-latest`). O `ubuntu-latest`
  migra de 24.04 para 26.04 entre 19/10 e 19/11/2026 (actions/runner-images
  #14748) e mostrava um aviso em cada job. Escolhemos 26.04 e não 24.04 porque
  o Playwright 1.64.1 já trata o 26.04 como plataforma oficial (dependências
  do `install --with-deps` próprias) e porque fixar em 24.04 só adiaria a
  troca. No 26.04 o `sudo` é o sudo-rs: evite `sudo -E` (use
  `--preserve-env=VAR`). Se algo quebrar só no 26.04, volte para
  `ubuntu-24.04` na mesma constante do teste.
- O GitHub ignora `merge=union` e drivers do `.gitattributes` no botão de
  merge e no cálculo de conflito. Por isso a resolução de acréscimos fica no
  script, e não no `.gitattributes`.

## Testes

- Teste instável é bug: corrija a causa (relógio falso, espera por condição),
  nunca `retries`, `.skip` ou timeout maior.
- Fixe o relógio e o fuso (`America/Sao_Paulo`) em testes de agenda e
  recorrência; cubra a virada de dia e o horário de verão histórico.
- Dependências com versão exata; confira o `package-lock.json` no diff.

- O mundo de teste (`test/chat-world.ts`) precisa passar o mesmo relógio falso
  a todo serviço que olha a hora (`Productivity`, `AutomationService`...). Na
  etapa 10, o `Productivity` sem `clock` usava a hora real: o teste do resumo
  passou num dia e falhou dois dias depois.
- `fsModuleCache: false` precisa ficar em `apps/agent/vitest.config.ts`. Sem
  ele a cobertura do agente cai abaixo do piso de 99% sem nenhum teste mudar
  (etapa 14).
- Ids de `zur_auth_events` voltam a ser usados depois de apagar linhas num
  teste; a chave de deduplicação dos alertas (`zur_alert_keys`) usa o id, então
  um alerta novo some calado. Limpe as duas tabelas juntas (etapa 15a).
- Alerta de segurança gerado dentro de uma atualização do bot só sai em
  `flushSecurityAlerts`. Sem o hook `afterUpdate` do `TelegramService`, ele
  esperava a próxima requisição do app (etapa 15a).
- Em e2e, `page.goto("/rota#token")` estando já em `/rota` só troca o hash, sem
  recarregar. Passe por `about:blank` antes.

## Agents SDK

- A capability `mcp` do Agents SDK responde ao callback OAuth em
  `capabilityRunner.request`, **antes** do `onRequest` e do portão 5 (Hono).
  Na etapa do MCP, confira que o callback não escapa da autenticação e que
  `successRedirect`/`errorRedirect` nunca vêm de entrada do usuário.
- Use `env.AGENT.getByName(...)` para repassar requisições: `getAgentByName`
  faz uma RPC extra por chamada, e cada uma conta nas requisições de Durable
  Object do plano Free.
- Nenhum código fora de `gates/access.ts` lê cabeçalhos `cf-access-*`; o Worker
  os remove antes do repasse ao Durable Object.

## Logs

- Os invocation logs estão ligados. Antes da etapa 12, confira num log real do
  painel se cabeçalhos como `x-telegram-bot-api-secret-token` aparecem; se
  aparecerem, desligue `invocation_logs` ou torne o segredo rotacionável.

## Segredos no `wrangler dev`

- Com `secrets.required` no `wrangler.jsonc`, o `wrangler dev` só carrega do
  `--env-file`/`.dev.vars` os segredos listados ali. Um segredo opcional (como
  `OWNER_PASSWORD_HASH`) vai por `--var NOME:valor` (veja `playwright.config.ts`).
  Tirar um segredo de `secrets.required` faz ele sumir do servidor do e2e e do
  Lighthouse sem erro nenhum, só o health em 503 até o tempo acabar: passe-o
  por `--var` no mesmo PR (aconteceu com `OWNER_EMAIL` no primeiro acesso).
- "Can't read from request stream after response has been sent" aparece no log
  do `wrangler dev` quando a API recusa um pedido com corpo antes de lê-lo
  (CSRF, sem sessão). Já existia antes da etapa 3, não afeta a resposta e
  cancelar o corpo não resolve. Não é falha de teste.

## Limitador de login

- A contagem global de recusas fica na memória do `LoginLimiter` (carregada uma
  vez por objeto). Em teste, linhas gravadas direto em `zur_login_attempts`
  depois do primeiro uso não são vistas: grave antes, ou use `rebuild()` para
  um serviço novo.
- Leia o estado do banco (`sync`) **antes** de ler a fonte da senha; ler antes
  deixou a senha antiga entrar uma vez depois de uma redefinição (SEC-3-01).

## Concorrência no Durable Object

- Um `await` (WebCrypto, verificação de passkey) deixa outro pedido entrar.
  Contagens que limitam tentativas precisam ser reservadas **antes** do
  `await` e devolvidas depois, e o que foi checado antes (senha, sessão)
  reconferido dentro do `transactionSync` (QA-4-01, CF-4-01, CF-4-02).
- Pedido recusado por limite não pode gravar uma linha a cada vez: dobre na
  atividade (`FOLDED_KINDS`) ou devolva o estado já guardado (SEC-4-01, cota de
  gravações do plano Free).

## Git com subagentes

- Nunca `git add -A`: os auditores deixam testes `tmp-audit-*.test.ts` no
  worktree. Adicione caminhos explícitos.

## SQLite do Durable Object

- Um padrão de `LIKE` ou `GLOB` passa de 50 bytes e a consulta falha (500),
  mas só quando a tabela tem linhas; em teste com tabela vazia passa. Para
  busca literal use `instr(<searchColumn(coluna, q)>, ?)` com `q = foldSearch(texto)`
  (`productivity/search.ts`), como na etapa 6 (CF-6-01).
- `lower()` do SQLite só dobra A–Z: `lower('Água')` continua `Água`, e "água"
  não achava "Água". Por isso `foldedColumn` troca as maiúsculas acentuadas
  latinas antes do `lower()`, mas só quando a busca tem acento: as 30 trocas
  por linha custam cerca de 20 vezes mais CPU numa tabela grande.
- Texto gravado em NFD antes de 31/10/2026 só é achado por busca com acento
  depois de editado (a busca vai em NFC). Navegadores mandam NFC, então é raro.
- O SQLite guarda UTF-8: um surrogate solto vira U+FFFD sem aviso. Os schemas de
  texto recusam surrogate solto e guardam em NFC.
- Sem `ANALYZE`, o planejador prefere um índice `(status, due_at)` a um índice
  parcial e ordena tudo. Confira `EXPLAIN QUERY PLAN` e `rowsRead` com algumas
  mil linhas antes de confiar num índice novo (CF-6-03).
- `packages/shared` é marcado `sideEffects` (só `zod-config.ts` fica) para o
  bundler cortar schemas que a interface não usa. Com isso, a ordem dos
  imports do `index.ts` deixa de valer: todo arquivo que cria schema Zod
  importa `./zod-config.ts` primeiro, senão o Zod testa `new Function` e a
  CSP registra uma violação (`polish.spec.ts`).

## Pacote da interface

- Uma tela nova sob demanda pode fazer o rolldown dividir o pacote inicial em
  pedaços (`ui-*.js`, `useQuery-*.js`), e o JS inicial sobe de 2 a 11 KB sem
  código novo no começo. Na etapa 7, duas coisas fizeram isso: schemas de
  `packages/shared/src/memory.ts` sem `/* @__PURE__ */` (levaram o zod
  clássico para a tela) e `hooks/settings.ts` usado por duas telas sob demanda
  (virou um pedaço comum que o pedaço de entrada importava). Corrigir os dois
  baixou de 151 para 142,4 KB, mas ainda sobram `ui-*.js` e `useQuery-*.js`
  divididos, sem causa achada: uma tela de teste que só importa `cn` de
  `ui.tsx` já divide a develop. As opções do rolldown (`chunkOptimization`,
  `strictExecutionOrder`, `preserveEntrySignatures`, grupos em
  `codeSplitting`) não resolveram. Rode `npm run size` a cada import novo e
  compare a lista de arquivos com a da develop.
- O bundler põe cada módulo inteiro num pedaço só. Um módulo de
  `packages/shared` que o pacote inicial importa (como `settings.ts`, por causa
  de `isTimeZone`) leva para o primeiro carregamento tudo o que uma tela sob
  demanda usar dele ou dos módulos que ele importa. Na etapa 8, isso pôs 0,7 KB
  da aba IA no `ui-*.js`. A saída foi separar: `time-zone.ts` (o que o
  início precisa), `ai-limits.ts` (o mínimo das configurações) e `ai.ts` (o
  resto, só na tela). Também `formatUsd` de `format.ts` entrou no inicial ao
  ser usado só pela aba: formate na própria tela.
- O mesmo vale para módulos que importam o roteador: `RequireSession.tsx`
  (`FullScreen`, `SessionChecking`) traz `react-router` junto. Uma tela sob
  demanda que importava um deles separou o roteador em `components-*.js` e
  subiu o JS inicial em 1,5 KB. As telas de primeiro acesso e de trocar a
  senha desenham o próprio `<main>` e recebem `go` por propriedade.
- Casca do Sinal (S02): três divisões novas do pacote inicial, cada uma com
  1 a 2 kB. Painel sob demanda que chega ao `i18n.tsx` sem usar o
  `react-query` separa `useBaseQuery` (o painel da conta usa `useSession`, que
  já está no início). Módulo sob demanda que importa um módulo inicial com
  ícones (a paleta importando `lib/nav.ts`, o painel importando
  `shell/Panel.tsx`) separa os ícones em pedaços próprios: passe a lista por
  propriedade e deixe a casca desenhar o painel em volta. Listas longas de
  classes repetidas na casca pesam no JS: foram para `.zuri-*` em
  `styles.css`.
- Entrada do Sinal (S03): `components/HumanCheck.tsx` (a verificação de
  segurança) está no pacote inicial, por causa da tela de entrar, e tem
  ícones. As telas sob demanda que a usam (primeiro acesso e recuperação)
  recebem o hook por propriedade (`useHuman`, vindo do `App.tsx`); o import
  direto separou o `ui-*.js` e subiu o JS inicial em 1 kB. `EntryLayout.tsx`
  não importa `ui.tsx`, como o `Logo.tsx`.
- Contagem regressiva com `now` em estado: leia o relógio de novo ao começar
  a pausa (`setNow(Date.now())`). O `now` do primeiro desenho pode ter minutos,
  e a primeira conta saía maior que a pausa (achado pelo relógio falso da S03).
- Widget externo desmontado ainda pode chamar o `callback` (resposta a
  caminho): `TurnstileWidget` ignora tudo depois do `cancelled`. Sem isso, um
  token atrasado desfazia o estado "não passou".
- Medir o JS inicial: só `npm run build` seguido de `npm run size` vale. O
  `vite build` chamado direto em `apps/web` deu uns 28 bytes a menos na S03, e
  a CI mede pelo primeiro. A S03 fechou em 140.891 B, com teto de 140.900 B:
  a S04 começa sem folga nenhuma.
- Contagem regressiva nunca dentro de `role="alert"` ou `status`: o leitor de
  tela repete a cada segundo. O aviso falado é um elemento à parte, com o
  tempo do início (S03, `HumanCheck.tsx`).
- `dialog::backdrop` do `styles.css` fica fora de camada e vence qualquer
  `backdrop:` do Tailwind (que vai em `@layer`). Para mudar o fundo de um
  diálogo, escreva a regra fora de camada, depois da geral.
  Lembrete: um `lazy()` sem uso continua no pacote (a chamada não é pura), então
  para medir tire a declaração inteira, não só o uso.
- `/* @__PURE__ */` deixa o bundler apagar a chamada, mas não os argumentos
  dela. Na etapa 11, `z.partialRecord(z.enum(...), z.array(...).transform(...))`
  em `alerts.ts` (importado por `settings.ts`, que está no pacote inicial)
  deixou os argumentos no pacote e trouxe o Zod clássico para a tela de
  Configurações, com +3,2 kB no JS inicial. A saída foi construir o schema
  dentro de uma função marcada: `/* @__PURE__ */ (() => z.partialRecord(...))()`.
- Tudo o que uma tela sob demanda usa de um módulo do `packages/shared` que o
  pacote inicial também importa vai para o chunk inicial (`i18n-*.js`), mesmo
  que só a tela use. Na 11b, dois tipos novos de evento de acesso em `auth.ts`
  passaram o teto em 0,06 kB. A saída foi mover a atividade de acesso para um
  módulo próprio (`auth-activity.ts`), que só as telas de segurança importam: o
  bundler o pôs num chunk sob demanda e o JS inicial caiu 0,4 kB. Para medir
  em bytes, some o gzip nível 9 dos arquivos do `index.html` (o script de
  orçamento arredonda para 0,1 kB).
- Uma tela sob demanda que importa um módulo do pacote inicial que importa
  `ui.tsx` (o `Logo.tsx` importava `cn`) separou `ui.tsx` em `ui-*.js` e subiu
  o JS inicial em 1,1 KB, mas só junto com outra tela sob demanda (o
  `Greeting`). Por isso o `Logo` não importa nada de `ui.tsx`. Para achar a
  causa: troque o conteúdo da tela por imports isolados e meça cada um.
- Um `import` de `react-router` numa tela sob demanda que ainda não o usava
  (a Memória, ou o componente da paleta) separou o roteador num pedaço próprio
  (`hooks-*.js`) e subiu o JS inicial em 1,5 KB. A paleta recebe o `navigate`
  do `AppShell` por propriedade, e a Memória recebe a busca pedida pela paleta
  por `askMemorySearch` em `lib/palette.ts`, sem o roteador.
- Etapa 10: cada pedaço novo dividido entre telas sob demanda (um ícone usado
  por duas telas, um módulo `lib/` comum, `dates.ts` da shared) põe o nome do
  arquivo na lista de pré-carga do pacote inicial: uns 25 bytes a mais cada.
  Use nas telas novas ícones que só elas usam (ou os que o inicial já tem, como
  `Clock`), e passe pedidos da paleta a uma tela por endereço (`#...`) ou
  evento do `window`, sem módulo comum. Textos do `ptBRCore` usados só por
  telas sob demanda vão para o catálogo da tela (`pt-BR-markdown.ts`,
  `pt-BR-settings.ts`). No `join` do catálogo, passe cada parte como argumento
  próprio: `{ ...a, ...b }` dentro da chamada `/* @__PURE__ */` impediu o
  descarte e levou o catálogo inteiro para o inicial (+11 KB). Meça com 3
  casas (`toFixed(3)` numa cópia do `check-bundle-size.ts`).
- Etapa 17: o `RefreshCw` do cartão da busca semântica também estava na Memória
  e virou pedaço comum (+21 bytes). A PR passou com 1 byte de sobra, e a PR
  automática de versão (0.23.0) estourou o teto só porque o número da versão
  mudou. Antes de abrir a PR, confira o total exato em bytes e deixe pelo menos
  20 bytes de folga. Ícone já usado em outra tela sob demanda conta como
  pedaço novo; troque por um do inicial (`RotateCw`, `Clock`).
- 03/11: a develop chegou a 3 bytes do teto e a PR de versão 0.24.0 estourou.
  A folga voltou (926 bytes) tirando do inicial o que quase nunca aparece: o
  formulário da confirmação de senha (`ReauthDialog.tsx`, o `ConfirmDialog` só
  escuta), o aviso de duas etapas (o `AppShell` só o carrega com o 2FA
  desligado), `shortcutLabel` fora de `lib/palette.ts` (um import do `AppShell`
  levava o módulo inteiro) e os textos das seções e do tema para catálogos sob
  demanda. Deixar a `LoginPage` ou a `NotFoundPage` sob demanda dividiu o
  pacote inicial em vários pedaços (com a `NotFoundPage`, o total ainda subiu
  400 bytes): não é o caminho.
- O axe rodando no meio da animação de entrada (opacidade baixa) acusa
  contraste falso. `expectAccessible` espera as animações finitas terminarem.

## Navegador e CSP

- O Zod testa `new Function("")` na primeira validação para decidir se compila
  validadores rápidos. Com a CSP sem `unsafe-eval`, isso gera uma violação da
  CSP em toda página (o Lighthouse marca em "inspector issues"). O
  `packages/shared` liga `z.config({ jitless: true })` em `zod-config.ts`, que
  todo arquivo com schema importa primeiro (veja acima). `tests/e2e/csp.spec.ts`
  pega a volta.
- Pedido recusado antes de ler o corpo (CSRF, sem sessão) fazia o workerd
  registrar "Can't read from request stream after response has been sent". O
  erro nasce no Worker: o fluxo do corpo repassado ao objeto continua sendo lido
  depois que a resposta saiu. Cancelar o corpo no objeto não resolve, e repassar
  por um fluxo próprio também não (cortar o fluxo derruba a resposta do objeto;
  deixar aberto gera `Uncaught undefined` com corpo em partes). A saída é
  `withBodyRead` (`src/gates/body.ts`): o Worker lê o corpo inteiro antes de
  repassar, com teto por caminho (`bodyLimitFor`: clipe de voz só em
  `/api/transcribe`, o tamanho de uma nota nas demais). Rota nova com limite
  maior que esse precisa subir o teto e o teste de `body-read.test.ts`. O e2e falha se o Worker logar
  `Uncaught` (`tests/e2e/worker-log.ts`). Arquivo de entrada do Worker
  (`src/index.ts`) não pode exportar constante: o workerd recusa subir.
- No `wrangler dev`, corpo de vários MB recusado antes de chegar todo faz o
  ProxyWorker do wrangler registrar "Network connection lost" e responder 500.
  É do servidor de desenvolvimento e já acontecia antes; não é o Worker.

- `response.finished()` do Playwright não termina numa resposta em SSE que o
  navegador lê aos poucos: o teste trava até o tempo limite. Espere o estado da
  tela (o botão Parar sumir, nenhum `[aria-busy=true]`), não o fim da resposta.
- `role="log"` direto num `<ol>` tira a semântica de lista e o axe acusa
  "listitem". Ponha o `role="log"` numa `div` em volta da lista.
- O `request.signal` não avisa o Durable Object quando a aba fecha: sem os
  flags `enable_request_signal` e `request_signal_passthrough`, o sinal nunca
  dispara. O chat descobre a aba fechada pela escrita que falha, e manda um
  `: ping` a cada 5 s para isso valer também nos passos sem texto.
- `test.use({ launchOptions })` não vale dentro de um `describe`: um teste que
  precisa de outro navegador (microfone falso) vai para um arquivo próprio.

## Ambiente de nuvem

- Com o binding `ai` no `wrangler.jsonc`, `wrangler dev` sem `--local` tenta
  abrir uma sessão remota e falha sem `CLOUDFLARE_API_TOKEN`. `npm run dev` e o
  servidor do e2e usam `--local`: o binding fica "not supported" e o agente usa
  a IA simulada (PUBLIC_URL de loopback). O aviso "AI bindings always access
  remote resources" continua: só some com `remote: true`, que faria o
  `wrangler dev` sem `--local` usar a IA da conta (gasta Neurons). Com `--local`
  nada chega à Cloudflare.
- O e2e e o Lighthouse precisam de Node 26 e de
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-*/chrome-linux*/chrome`.
- O Biome lê a pasta `coverage/` se ela existir; ela está fora do lint em
  `biome.json`.
- `String.prototype.trim()` também tira U+FEFF. Um teste de caractere
  invisível com o caractere no fim passa pelo `trim` do schema e não testa
  nada: ponha o caractere no meio do texto.
- Desde os cumprimentos (PR #34) o título do Início é "Bom dia/Boa tarde/Boa
  noite…", não "Olá!": no e2e use `/^(Bom dia|Boa tarde|Boa noite)/`.
- Rebuildar a interface (`npm run build -w @zuri/web`) com o `wrangler dev`
  do e2e no ar faz o servidor responder 404 em tudo até reiniciar: ele perde a
  pasta `apps/web/dist` recriada. Pare o servidor antes de gerar capturas do
  "antes" e suba de novo depois.
- Depois da PR da versão no app (02/11/2026) o JavaScript inicial ficou em
  138.986 bytes, colado no teto de 139 kB. Texto novo no primeiro carregamento
  vai para um `pt-BR-<tela>.ts` com `addMessages` ou tira bytes de outro lugar.
- Constante de `packages/shared` que a interface importa não pode morar num
  módulo que monta esquema Zod (nem que só importe `zod-config.ts` ou `line()`
  de `productivity.ts`): na etapa 18 isso levou 5,9 kB de Zod para o JS
  inicial, mesmo com a tela lazy. Constantes e tipos num arquivo sem Zod
  (`mcp.ts`), esquemas em outro (`mcp-schemas.ts`); confira com
  `node scripts/check-bundle-size.ts` depois do build.
- `new Request(input, init)` consome o corpo de um `Request` passado como
  `input`: num fetch de teste que só lê a URL e repassa `input`/`init`, o
  servidor recebe o corpo vazio. Monte o `Request` uma vez e repasse ele.
- CHECK numa coluna acrescentada por ALTER TABLE em zur_mcp_tools fez cada INSERT do catálogo ler 3 linhas em vez de 1 (free-tier-budget, MCP 100 ferramentas: 436 > 260). Validar o valor no código (03/11/2026, autonomia MCP).
- Animação que começa em `opacity: 0` numa tela inteira tira o texto dela do
  LCP: o Chrome ignora texto pintado transparente e não reconsidera depois.
  No primeiro acesso isso deixou a página sem candidato e o Lighthouse falhava
  com `LanternError: NO_LCP` (nota 0, "failing: none") em parte das execuções.
  O `rise` começa em 0.01 (teste em `apps/web/test/motion.test.ts`); não volte
  para 0 nem crie outra entrada de tela que comece invisível (03/11/2026).
- `<dialog>` modal aberto e fechado num `useEffect` com o conteúdo condicional
  (`{open && …}`): quando o `open` muda num render não urgente (o `useBlocker`
  do React Router roda numa transição), o React tira o conteúdo e só depois
  roda o efeito. Nesse intervalo o modal está aberto e vazio: o Playwright o vê
  como fechado (sem nome), mas a página de trás segue inerte e engole teclas
  (#146, `Ctrl+S` das notas no celular). Abra e feche no `useLayoutEffect`,
  como o `Dialog` de `ui.tsx` (03/11/2026).
- O Google simulado (`dev-google.ts`) dá todos os escopos de uma vez na tela
  de consentimento do e2e: um teste que espera o botão de pedir a permissão
  nova nunca o vê. Cubra a segunda ida ao Google no teste de rota do agente
  (03/11/2026).
- Uma consulta da interface cuja chave começa pela área do canal ao vivo
  (por exemplo `["reviews", …]`) é refeita a cada gravação da área. Se a
  própria rota grava a área ao responder (um upsert que sempre escreve),
  vira um ciclo de refetch. Use chave fora da área para listas que vêm do
  Google e um `WHERE` no `DO UPDATE` que só grava quando algo mudou
  (03/11/2026, etapa 19c).
- A API do Perfil da Empresa responde 429 com `quota_limit_value: "0"`
  enquanto o "Basic API Access" não sai. Não é limite de taxa: tratar como
  sem acesso e tentar de novo em horas, não em segundos (03/11/2026).
- O banco do e2e vale para a execução inteira (um servidor, um worker). Dois
  testes que criam o mesmo título com um rótulo curto colidem (#240: oito
  caracteres com os dígitos trocados por `x` sobravam poucas variações, e
  duas tarefas iguais quebraram o modo estrito). Use `uniqueTag()` de
  `tests/e2e/ui-helpers.ts` e `exact: true` no nome. Um teste e2e com
  muitas telas e axe em cada uma passa perto dos 30 s: divida por grupo de
  telas em vez de subir o timeout (#241) (09/11/2026).
- Uma ação que faz `await` da releitura da lista e só depois limpa o estado
  da tela (`reset()`) fecha o que o dono abriu nesse meio-tempo. No acesso
  remoto, ligar a chave e abrir "Novo token" antes de a lista voltar fechava o
  formulário (#250: o e2e travava no rádio, que tinha sumido). Só limpe o
  estado no fim quando a ação nasceu do próprio formulário ou confirmação, e
  no e2e segure a resposta com `page.route` para provar a ordem (10/11/2026).
- `--repeat-each` acima de 10 no e2e do acesso remoto dá 429 no
  `POST /api/remote/events`: cada repetição usa uma vez o token já revogado, e
  na décima recusa a rede fica bloqueada (proteção contra tentativa de token).
  Não é instabilidade. Repita em lotes de até 8 por subida do servidor
  (10/11/2026).
- `[` sem barra dentro de uma classe de caracteres (`[^\s@[\]]`) num `.regex()` de
  schema de ferramenta: o JavaScript aceita, a API da Anthropic recusa o pedido
  inteiro com 400 ("JSON schema is invalid") e nenhum teste com IA simulada
  percebe. Escreva `\[`. O teste "writes every pattern…" em
  `apps/agent/test/chat-tools.test.ts` confere todas as ferramentas (10/11/2026).
- Um padrão de dado pessoal (`apps/agent/src/ai/external.ts`) que proíbe `.`
  logo depois do valor deixa passar o valor no fim da frase. Proíba só o ponto
  seguido de letra ou número, e teste cada tipo com ponto final (10/11/2026).
- Linha de sistema no fim das respostas anteriores do histórico (`[Tools called
  in that turn: …]`): um modelo real copia a linha na resposta seguinte. Toda
  nota nova posta no histórico do assistente precisa de um filtro na saída
  (`ToolsNoteFilter` em `apps/agent/src/agent/context.ts`) e de uma rodada no
  modelo real (10/11/2026).
- Filtro que roda a cada pedaço do texto do modelo não pode reter sem limite
  nem usar `\s*` solto: milhares de linhas em branco viravam segundos de CPU.
  Retenha no máximo o tamanho do que procura e use quantificador com teto
  (`ToolsNoteFilter`, 10/11/2026).
- Termo com `*` no FTS5 é prefixo: `"gravida"*` casa "gravidade". Em lista
  fixa de termos (`RESTRICTION_QUERY`), palavra inteira vai como frase, sem
  `*`, e frase do dia a dia ("não posso") fica de fora (10/11/2026).
- Início do Sinal (S04): tirar os quatro ícones do `Greeting.tsx` (sob
  demanda) fez o empacotador separar `createLucideIcon` do pacote inicial e o
  JS inicial subir 0,3 kB. Saiu juntando o cumprimento ao `HomeBody.tsx` (um
  `lazy()` só no `HomePage.tsx`). Antes de culpar o código novo, compare a
  lista de pedaços do `dist/assets` com a da `develop`. A coluna do Início e
  o espaço reservado do cumprimento são `.zuri-home*` no `styles.css`; a S04
  fechou em 140.859 B (teto 140.900 B).
- Relógio falso em tela com sessão: um salto de mais de uns 15 minutos sem
  tecla nem toque encerra a sessão por falta de uso (o `SessionGuard` usa o
  mesmo relógio). Dê saltos curtos e use o teclado entre eles (S04,
  `inicio.spec.ts`).
- Item que some de uma consulta ao mudar de estado (tarefa feita sai da lista
  "hoje"): guarde a cópia local até a consulta refeita trazê-lo de volta ao
  desmarcar. Sem isso a linha sumia por um instante e o foco ia embora (S04,
  `DayCard.tsx`).
- `<Dialog>` montado só enquanto aberto (`{aberto && <Dialog open …/>}`): ao
  desmontar, o `<dialog>` some sem `close()` e o navegador não devolve o foco
  a quem abriu. Guarde o `document.activeElement` ao abrir e devolva o foco
  depois de um `flushSync` do fechamento (S05, `ChatPage.tsx`; os testes de
  teclado de `conversa.spec.ts` pegam).
- Script que mata o servidor do e2e procurando "wrangler dev" na linha de
  comando mata também o shell que o chamou se o texto estiver no próprio
  comando. Deixe o texto num arquivo e chame só o arquivo (S05).
- `position: sticky` cria um contexto de empilhamento: um menu `fixed` com
  `z-index` alto dentro de uma caixa sticky fica preso nele e passa por baixo
  dos toasts. Na Memória o painel sobe junto enquanto o menu está aberto
  (`.zuri-memory-panel:has([role="menu"])`). O e2e pegou como clique que nunca
  termina, só com toasts abertos (S06).
- axe `label-content-name-mismatch` compara palavras inteiras: um rótulo
  visível cortado no meio da palavra ("mudan…") não está contido no nome
  acessível com a palavra inteira. Corte rótulo sempre no fim de uma palavra
  (`cut` em `MemoryMap.tsx`, S06).
- Pedaço sob demanda dentro de uma tela que já é sob demanda (o mapa da
  Memória) muda a divisão do primeiro carregamento: conforme o que ele
  importava, o empacotador separava `useBaseQuery`, `createLucideIcon` ou o
  `jsx-runtime` do pacote inicial, sempre com 0,3 a 0,4 kB a mais. Saiu
  importando o mapa direto na tela. Compare a lista de `dist/assets` com a da
  `develop` (S06).
- Desenho que depende de tamanho medido (`ResizeObserver`) só acompanha a
  janela no quadro seguinte. `expectFits` espera dois quadros antes de medir;
  teste novo que troca o tamanho da janela e mede na hora precisa do mesmo
  (S06).
- Dados de e2e ficam no banco entre os testes e entre os projetos (computador
  e celular): uma memória "sem nada em comum" precisa de palavras que nenhum
  outro teste usa, senão a regra das duas palavras em comum liga as duas
  (S06, `memory.spec.ts`).
- Tela sob demanda que passa a importar um módulo comum (o `ActionsMenu` em
  Notas) muda o conjunto de telas daquele pedaço, e o empacotador separa dele
  o que as outras ainda dividem (o ícone de histórico virou
  `rotate-ccw-clock.js`, mais 16 B no pacote inicial pelo nome no mapa de
  importações). O mesmo vale para ícone ou função que só duas telas usam
  (`lib/recents.ts`, `chat/when.ts`, `Folder`). Compare `dist/assets` com a
  `develop` antes de procurar o estouro em outro lugar (S07).
- A navegação do React Router é uma transição: o estado mudado junto com
  `navigate` chega antes do endereço novo. Chave de componente calculada com
  os dois (o editor da nota recém-criada) desmonta e monta de novo nesse
  intervalo e perde o foco. Guarde que o endereço ainda não chegou (S07,
  `born.arrived` em `NotesPage.tsx`).
- Linha de lista que muda de grupo ao ser marcada é montada de novo: estado
  dela (pendente, erro, foco) se perde. Em Tarefas esse estado fica na página
  e o foco segue a tarefa por `data-task` (S07).
- Salvamento automático chega antes da batida de 61 s: aviso de "mudou em
  outro lugar" que dependa só da batida nunca aparece. A conferência tem que
  ser do servidor (`ifUpdatedAt`, 409) (S07).
- No e2e do microfone, parar a gravação antes de 1 s manda um áudio vazio e o
  teste fica instável. Espere "Gravando: 1 s" antes de parar (S07).
- `Button` com largura fixa e padding espreme o ícone (`svg` encolhe em
  flex). Ícone dentro de botão quadrado leva `shrink-0` (S07, microfone).
- Tela sob demanda que importa `hooks/settings.ts` (o `useMutation` dele) ou um
  valor de `packages/shared/src/agenda-prefs.ts` cria um pedaço comum novo e
  estoura o JS inicial. Leia as configurações com `useQuery` e `SETTINGS_KEY`
  de `hooks/session.tsx` e importe do pacote comum só os tipos (S08).
- `npm run size` mede o `dist` que estiver lá: se o build falhou (erro de
  TypeScript), a medida é do build anterior. Confira a saída do build antes de
  ler o tamanho (S08).
- `Dialog` com `key` que muda ao fechar (`key={open ? id : "none"}`) é
  desmontado em vez de fechado, e o navegador não devolve o foco. Troque a
  chave só ao abrir (S08, contador `opening` em `AgendaPage.tsx`).
- No Playwright, `aria-disabled="true"` conta como desabilitado: `click()` no
  rótulo espera para sempre. Use o teclado (foco e Espaço) para provar que o
  controle não muda (S08).
- A barra de uma tela testada só no Pixel 7 (412 px) pode quebrar em 390 px.
  Teste de layout de celular fixa a janela em 390 px com `test.use` em vez de
  pular fora do projeto `mobile` (S08).
- CI sem `--with-deps` (11/11/2026): `npx playwright install --with-deps chromium` caía com código 100 nos jobs `e2e` e `lighthouse` quando o runner `ubuntu-26.04` não resolvia os espelhos do Ubuntu (apt). A imagem já traz as bibliotecas do Chromium; o `--with-deps` só acrescentava nove pacotes de fontes. A CI instala só o navegador (`npx playwright install chromium`). Se um dia faltar biblioteca na imagem, o navegador não abre e o job falha na hora: aí instale só a que faltar, nunca a lista inteira.
