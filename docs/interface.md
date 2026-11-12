# Interface web

A interface da Zuri é um app React servido pelo próprio Worker (binding
`ASSETS`), com React Router, TanStack Query e Tailwind. Ela passa pelos mesmos
portões da API e não guarda segredo nenhum: o bundle só conhece o caminho
`/api`.

## Endereços

| Caminho | Tela | Sessão |
| --- | --- | --- |
| `/entrar` | Login (senha, depois código ou passkey quando a verificação em duas etapas está ligada) | não |
| `/` | Início (o chat chega na etapa 9) | sim |
| `/tarefas` | Tarefas: visões por prazo, filtro por projeto, busca, nova tarefa, edição, conclusão, projetos | sim |
| `/notas` | Notas: lista com busca em texto completo (ao lado do editor em telas largas) | sim |
| `/notas/nova`, `/notas/:id` | Editor de nota em Markdown, com visualização | sim |
| `/configuracoes/:aba` | Configurações: `conta`, `seguranca`, `ia`, `avisos`, `integracoes`, `dados` (lixeira) | sim |
| qualquer outro | Página não encontrada, dentro do app | sim |

Sem sessão, toda página privada leva a `/entrar?next=<caminho>`. Depois do
login o app abre o `next`, mas só se for um caminho deste app: URL absoluta,
`//host`, barra invertida, caractere de controle ou o próprio `/entrar` voltam
para o início (`apps/web/src/lib/next.ts`).

## Sessão no navegador

- **Nada privado aparece antes da resposta do servidor.** `RequireSession`
  pergunta `GET /api/auth/session`; enquanto isso, só o logo e "Conferindo a
  sua sessão…".
- **Uso real.** Clique, tecla, toque ou roda do mouse marcam uso (só a hora).
  Pedidos feitos até 10 s depois levam `x-zuri-activity: 1`; atualizações em
  segundo plano não mantêm a sessão viva.
- **Sinal de aba aberta.** Uma aba por navegador (Web Locks) manda
  `POST /api/auth/heartbeat` a cada minuto.
- **Aviso e saída.** Dois minutos antes do fim por falta de uso aparece um
  aviso com contagem e o botão "Continuar conectado". No fim, todas as abas
  saem juntas (BroadcastChannel) e o login explica o motivo. O prazo conta
  pelo relógio do servidor convertido para o do aparelho, então um relógio
  errado no celular não encerra nem prolonga a sessão.
- **Aba que volta do segundo plano.** Se a contagem da própria aba acabou
  enquanto ela estava escondida (ou há menos de 5 s na frente), ela trava só a
  si mesma e pergunta ao servidor, sem encerrar a sessão das outras abas. Se o
  servidor diz que a sessão segue aberta, a última atividade que ele conhece
  passa a ser o ponto de partida da contagem da aba, que volta para a página.
  Um sinal de presença que já estava a caminho não reabre uma aba travada nem
  uma sessão encerrada.
- **401 em qualquer pedido** (sessão encerrada pelo servidor, cookie apagado)
  limpa os dados da memória e leva ao login com `?next=`.
- **Senha recente.** Quando a API responde `RECENT_AUTH_REQUIRED`, um diálogo
  pede a senha (ou o código do aplicativo, com a verificação ligada) e repete a
  ação uma vez.
- **Senha digitada agora.** Ligar a verificação em duas etapas e criar uma
  passkey abrem antes o diálogo "confirme que é você" (`PasswordNowDialog`),
  que só aceita a senha. Campo vazio é marcado sem pedido ao servidor; senha
  errada mostra a mensagem no campo, esvazia e devolve o foco; Esc ou Cancelar
  fecham sem começar nada.
- **401.** Só `UNAUTHORIZED` encerra a sessão na interface. Um
  `INVALID_CREDENTIALS` (senha ou código errado num diálogo) fica no diálogo.
- **Troca de senha obrigatória.** Com `passwordChangeRequired`, a única tela é
  a de troca de senha, igual ao que o servidor permite.

## PWA

`manifest.webmanifest`, ícones (192, 512, maskable 512 e o do iOS) e um
service worker (`public/sw.js`) que **não guarda nada em cache e não tem
handler de `fetch`**: toda página e toda resposta da API vêm da rede. Assim um
aparelho compartilhado ou desconectado nunca mostra dado privado de um cache.
Um teste unitário confere o arquivo e um e2e confere no Chromium que o app é
instalável e que, offline, a API falha em vez de responder do cache. Toda
resposta de `/api/*` sai com `Cache-Control: no-store`, e o cliente pede com
`cache: "no-store"`.

## Casca depois do login

A casca do Sinal (aprovada pelo Pablo em 10/11/2026; plano em
`docs/planos/implementacao-frontend-sinal.md`, PR S02). Só o conteúdo rola: os
menus nunca saem da tela.

- **Uma lista só de lugares, por áreas** (`apps/web/src/lib/nav.ts`, proposta
  A aprovada pelo Pablo em 12/11/2026): Início e Conversa; em **Meu dia**,
  Tarefas, Agenda e Notas; em **Relacionamento**, Contatos, Avaliações e CRM;
  em **Assistente**, Memória e Rotinas. A área **Consultório** (Gestão do
  consultório) entra entre Meu dia e Relacionamento junto com a primeira tela
  dela: área sem tela não aparece. O menu lateral, o menu de
  baixo, a folha "Mais" e a paleta (Ctrl/⌘ K) leem essa lista, então um lugar
  novo aparece em todos com o mesmo nome e o mesmo ícone.
- **Computador:** menu lateral de altura total (`shell/Sidebar.tsx`). No topo,
  a marca, o sino e o botão de recolher. Abaixo, "Nova conversa" (também com
  Ctrl/⌘ ⇧ O) e a busca. No meio, os lugares nas áreas. No pé, a conta.
  Recolhido, o menu vira uma coluna só de ícones. Cada ícone mostra o nome ao
  lado ao passar o mouse ou focar pelo teclado (Esc esconde); o nome continua
  no controle para leitores de tela, e o Tab percorre tudo na mesma ordem. A
  escolha fica em `localStorage` (`zuri.sidebar`), só neste navegador, e as
  outras abas acompanham.
- **Grupos que recolhem:** os títulos das áreas (**Meu dia**, **Relacionamento**
  e **Assistente**) são botões. Um clique (ou Enter/Espaço) recolhe o grupo, outro exibe; a seta ao
  lado mostra o estado e o leitor de tela anuncia "recolhido" ou "expandido".
  Com o grupo recolhido, a tela em que você está continua aparecendo, sozinha,
  para você não perder onde está. Os lugares recolhidos saem também do caminho
  do Tab. Início e Conversa não têm título e ficam sempre à vista. No menu só
  de ícones todos os lugares aparecem, e a escolha volta quando o menu abre de
  novo. No celular nada recolhe: a folha "Mais" mostra os lugares que não
  cabem no menu de baixo com os mesmos títulos das áreas, e Configurações em
  "Sistema". A escolha fica em `localStorage` (`zuri.sidebar.groups`), só neste
  navegador, e as outras abas acompanham. A animação é curta e some para quem
  pede menos movimento ao sistema. A aparência das partes do menu fica em
  `styles.css` (`.zuri-menu …`), para não pesar no primeiro carregamento.
- **Celular:** barra de cima com a marca, a busca, o sino e a conta; ela some
  enquanto o conteúdo desce e volta ao subir ou ao trocar de lugar. Embaixo, o
  menu com Início, Conversa, Tarefas, Agenda e **Mais**, que abre uma folha com
  os outros lugares e Configurações.
- **Conta e avisos:** abrem num painel ao lado do menu no computador e numa
  folha que sobe de baixo no celular (`shell/Panel.tsx`, um `<dialog>` modal:
  o foco fica dentro, e Esc, o X, um toque fora ou escolher um item fecham e
  devolvem o foco). A conta leva a Conta e perfil, Segurança, Avisos e
  Configurações, mostra a linha **Versão**, o tema deste aparelho e Sair.
- **Endereços:** Rotinas em `/rotinas`, CRM em `/crm` (`/crm/fluxos` e
  `/crm/credenciais`) e Avaliações em `/avaliacoes`. Os endereços antigos
  (`/automacoes`, `/automacoes/fluxos`, `/automacoes/conexoes` e
  `/contatos/avaliacoes`) levam para os novos para sempre, com o que vinha
  depois deles (`packages/shared/src/pages.ts`); aviso guardado com endereço
  antigo sai com o novo. Um teste percorre todo endereço que o servidor
  escreve (`tests/e2e/rotas.spec.ts`).
- **CRM:** duas partes, cada uma no seu endereço: Fluxos (`/crm` e
  `/crm/fluxos`) e Credenciais (`/crm/credenciais`), com a contagem ao lado do
  nome e o botão do cabeçalho criando o que a parte aberta lista. Automações e
  Envios só aparecem quando o servidor deles chegar. Os avisos do CRM ficam em
  Configurações › Avisos.
- **Carregamento:** `Loading` mostra linhas cinzas no formato de uma lista,
  com um brilho suave; `ScreenLoading` soma uma linha verde fina no topo
  enquanto uma tela sob demanda baixa. Nada aparece nos primeiros 300 ms (uma
  animação de duração zero com atraso, só CSS, em `styles.css`), e com
  "reduzir movimento" o brilho e a linha ficam parados. O leitor de tela ouve
  "Carregando…" uma vez. Na conversa, o balão "A Zuri está pensando" leva a
  marca com a luz pulsando.
- **Páginas:** começam com `PageHeader` (título, uma linha de contexto e ações
  à direita), numa coluna de até 5xl. No celular, ações só de ícone ficam ao
  lado do título; as largas descem para a linha de baixo. Dentro de uma seção
  das Configurações, no celular, o título é o da seção, com "Todas as
  configurações" acima. São nove seções: Conta, Segurança, Uso da IA, Modelos
  e limites, Agenda, Avisos, Integrações, Dados e Diagnóstico.
- **Lixeira:** o botão de Tarefas e o de Notas abrem Configurações › Dados com
  `?tipo=tarefas` ou `?tipo=notas`: só aquele tipo, "Voltar para…" e "Ver
  tudo". "Esvaziar a lixeira" aparece só sem filtro.
- **Menu "Mais opções" (⋯):** numa linha com ações demais, só a principal fica
  à vista (pausar, editar, ver ferramentas); o resto vai para o
  `ActionsMenu` (`components/ActionsMenu.tsx`). O botão se chama "Mais opções
  para “nome”" (nomes longos cortados em 60 caracteres); abrir foca o
  primeiro item, as setas, Home e End andam, Esc fecha e devolve o foco ao
  botão, e um toque fora ou Tab só fecham. A lista flutua sobre a página (não
  é cortada por listas com `overflow-hidden`), abre para cima quando falta
  espaço embaixo e fica acima dos toasts. Enquanto a ação da linha roda, o
  botão gira e diz que está ocupado (`aria-busy`). Apagar e Remover vêm por
  último, depois de uma linha, em vermelho. Uma marca liga/desliga (como
  "Nunca enviar para fora") é um item marcável, com o estado lido em voz alta.
- **Lembrete de 2FA:** enquanto a verificação em duas etapas estiver
  desligada, uma faixa acima do conteúdo chama para ligar. O X ("Dispensar
  por 3 dias") esconde por 3 dias, só neste navegador; nas Configurações ela
  não aparece.
- **Diálogos:** o `Dialog` da casa traz o título à esquerda e o X ("Fechar",
  44 px) no canto superior direito, fixos no topo enquanto o diálogo rola.
  Nenhum diálogo tem "Fechar" em texto no pé. O X vem por último no DOM: abrir
  foca o primeiro campo ou o "Cancelar". Esc fecha.
- **Confirmações:** título em pergunta, a frase do efeito, "Cancelar" antes do
  botão que repete o verbo (perigoso em vermelho), e o foco começa no
  "Cancelar", também nas confirmações que abrem no lugar, sem diálogo. Essas
  ficam num `fieldset` ligado à pergunta, para o leitor de tela dizer a
  pergunta junto com os botões.
- **Início:** numa coluna estreita, o dia por extenso e o cumprimento, um
  campo "Escreva para a Zuri" (abre uma conversa nova com o texto, que vai uma
  vez só pelo `state` da navegação; Enter envia, Shift+Enter quebra a linha),
  três ideias para começar, "Seu dia" e "Próximos dias". Tudo isso vem sob
  demanda, num pedaço só (`pages/home/HomeBody.tsx`, `pt-BR-home.ts`).
- **Seu dia:** as tarefas de hoje, os eventos do Google Agenda (quando
  conectado) e as rotinas do dia numa lista só, em volta da linha de agora
  (`lib/day.ts`, `pages/home/DayCard.tsx`). Mostra o horário de trabalho de
  Configurações › Agenda (08:00 às 18:00 até o dono mudar); o resto fica atrás
  de "N fora das 08:00 às 18:00 · Mostrar". O que já passou e não pede nada vai para a
  cortina "N já passaram", fechada até alguém abrir. Tarefa que passou da
  hora, tarefa atrasada de outros dias (as três mais antigas, com "Mais N em
  Tarefas") e rotina esperando aprovação ficam em cima, com o contador "N
  pendentes". O evento em andamento ganha "Agora". Marcar uma tarefa salva na
  hora e a leva para a cortina como "Feito"; desmarcar desfaz. A lista se
  refaz a cada 30 segundos só com o relógio do navegador, sem chamar a API, e
  devolve o foco à linha em que ele estava; se a linha foi para trás da
  cortina fechada, o foco vai para o botão da cortina.
- **Cumprimento no Início:** no lugar do `PageHeader`, a Zuri cumprimenta pelo
  horário do fuso das configurações (nunca o do aparelho): bom dia das 5h às
  12h, boa tarde até 18h e boa noite depois, com frases próprias de madrugada.
  Usa o nome de Configurações > Conta (`ownerName`, até 40 caracteres) quando
  existe. A frase de baixo, na voz dela, fica fixa durante o período e muda a
  cada dia sem repetir a do dia anterior (`apps/web/src/lib/greeting.ts`). O
  componente e as frases (`pt-BR-greeting.ts`) carregam sob demanda; um
  espaço do mesmo tamanho segura o lugar para a página não pular. O
  cumprimento vira sozinho na troca de período (relógio que olha de novo a
  cada hora, no máximo) e ao voltar para a aba.

## Identidade visual

Opção "Sinal", escolhida pelo Pablo: um "i" claro sobre um quadrado cor de
tinta (`#0b0f19`), com o pingo do i como uma luz verde (`#22c55e`). O verde
quer dizer "trabalhando" na interface toda, por isso é o único destaque. O
`Logo` aceita `working`, que faz a luz pulsar (só com movimento permitido); a
tela "Conferindo a sua sessão" já usa. O desenho passou no recorte redondo do
avatar do Telegram, no favicon de 16 px e em uma cor só (ícone de notificação).

Todas as cores da interface são variáveis em `apps/web/src/styles.css`; trocar
a identidade é trocar esse bloco, o `Logo.tsx`, o `public/favicon.svg` e gerar
os ícones de novo com `node scripts/gerar-icones.ts`.

### Sinal refinado (cores, fonte e cantos)

O acabamento aprovado pelo Pablo em 10/11/2026 (protótipo em
`docs/planos/modelos-frontend/`, plano em
`docs/planos/implementacao-frontend-sinal.md`):

- **Cores:** neutros em zinco e o verde como única cor de ação. No tema claro
  o fundo da página é cinza claro (`#f1f1f3`) e os cartões são brancos, para
  cada bloco se destacar; no escuro o fundo é `#0c0c0e`, sem preto puro. A
  borda de campos e controles tem contraste de 4,8:1 sobre o cartão no claro
  (4,3:1 sobre a página).
- **Fonte:** Figtree, um arquivo variável para todos os pesos
  (`apps/web/src/fonts/`, licença SIL OFL junto). Ela sai do próprio endereço
  da Zuri, com cache longo; nenhum serviço de fontes é chamado. Enquanto não
  carrega, aparece a fonte do sistema.
- **Cantos:** 8 px em controles pequenos, 10 px em botões e campos, 14 px em
  cartões e 20 px em diálogos (`--radius-lg` a `--radius-3xl`).
- **O que não mudou:** a marca. O quadrado do logo, o favicon, os ícones do
  aplicativo instalado e o manifesto seguem na tinta `#0b0f19`.
- **Telas fora do app:** entrar, criar uma senha nova, primeiro acesso,
  segundo passo, troca de senha, bloqueio, a confirmação do bot (`/aprovar`)
  e "Esta tela parou" usam a mesma moldura (`components/EntryLayout.tsx`). No
  computador, o lado da marca fica à esquerda, escuro nos dois temas, com o
  sinal verde e a frase "Sua agenda, suas tarefas e seus lembretes, em
  ordem."; no celular fica só a marca em cima do conteúdo. O verde aparece
  só no botão principal.
- **Verificação de segurança:** uma linha discreta acima do botão, em seis
  estados (conferindo, concluída, pedir clique, não carregou, não passou e
  espera, com a contagem em minutos e segundos também no botão). Aparece em
  Entrar, em "Criar uma senha nova" e no código do primeiro acesso
  (`components/HumanCheck.tsx`). A tela nunca cita o serviço por trás.
- **Tema:** a escolha mostra só os três ícones (como o sistema, claro e
  escuro); o nome de cada um fica para o leitor de tela e na dica do ponteiro.

Fora do app, a mesma identidade aparece no logo `docs/assets/zuri-logo.svg` e
nos banners do README (`docs/assets/zuri-banner-claro.svg` e
`zuri-banner-escuro.svg`), que seguem o tema do GitHub de quem lê.

## Acessibilidade

- WCAG 2.1 AA: contraste de pelo menos 4,5:1 nos dois temas, foco visível em
  todo controle, alvo de toque de 44 px, link "Pular para o conteúdo".
- Diálogos usam `<dialog>` nativo (foco preso, Esc fecha, fundo inerte).
- Campos com `<label>`; erros com `role="alert"` e ligados ao campo por
  `aria-describedby`; carregamentos com `role="status"`.
- O axe roda em todas as telas, nos temas claro e escuro, no computador e no
  celular (`tests/e2e/a11y.spec.ts`). O Lighthouse de acessibilidade fica no
  PR de cada etapa que muda telas.

## Tema e idioma

O tema (como o sistema, claro ou escuro) é escolha do aparelho e fica no
`localStorage`. O idioma e o fuso vêm das configurações da conta; antes do
login, o app usa o último idioma visto neste navegador ou o do próprio
navegador (pt-BR quando não reconhece).

## Capturas de tela

`node scripts/capturas-da-interface.ts <pasta> [--exemplos] [tela=/rota ...]`
tira as capturas das telas pedidas (sem pares, a de entrar e o início), nos
temas claro e escuro, no celular e no computador. `--exemplos` enche a base
com os dados de exemplo de `scripts/dados-de-exemplo.ts`. Precisa do servidor
dos e2e rodando numa base vazia. Todo PR que cria ou muda uma tela usa esse
script e mostra as imagens na descrição: veja `.claude/rules/capturas.md`.
