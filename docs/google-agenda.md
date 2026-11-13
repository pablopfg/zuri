# Google Agenda

A partir da etapa 19, a Zuri lê e muda eventos do seu Google Agenda. Você
escolhe, agenda por agenda, o que ela pode fazer. O plano está em
`docs/planos/etapa-19-google-agenda.md`.

## Para o dono

### Conectar

1. Em **Configurações > Integrações**, no cartão **Google Agenda**, toque em
   **Conectar com o Google**. Se a última senha foi digitada há mais de 15
   minutos, a Zuri pede de novo.
2. O Google avisa que não verificou o app (é o seu próprio app, veja abaixo).
   Escolha **Avançado > Acessar Zuri** e marque as duas permissões: ver e
   editar eventos, e ver a lista de agendas.
3. Você volta para Integrações com a conta conectada. Um alerta de segurança
   "Google Agenda conectada" entra na central de avisos e em Acessos.

Se faltar uma das permissões, nada é guardado e a Zuri pede para conectar de
novo marcando as duas.

### O que a Zuri pode fazer em cada agenda

Toda agenda começa **Fechada**. Em cada uma você escolhe:

| Opção | O que acontece |
| --- | --- |
| **Fechada** | A Zuri não vê a agenda, nem na tela Agenda. |
| **Só ler** | Os eventos aparecem na tela Agenda, no `/hoje` do bot e nas rotinas, e a Zuri consulta na conversa. Ninguém muda nada por aqui. |
| **Ler e editar** | Além de ler, você cria, muda e apaga eventos na tela Agenda, e a Zuri cria e muda eventos na conversa. Apagar pela conversa sempre vira um cartão para você aprovar. Só aparece onde o Google deixa a sua conta editar. |

Na conversa, o que outras pessoas veem só muda com a sua aprovação: eventos
com convidados, eventos que outra pessoa organiza e eventos de agendas que
são de outra pessoa (em que a sua conta só pode escrever). A Zuri propõe a
mudança e você vê, no cartão, o evento como está no Google e os valores novos,
no app e no bot. Criar evento numa agenda de outra pessoa pela conversa não
vale; isso você faz na tela Agenda. Assim, o texto de um convite não consegue
fazer a Zuri copiar os seus dados para um evento que outra pessoa lê
(decisão de 03/11/2026).

Abrir uma agenda pede a senha recente; fechar nunca pede. Abrir uma para
edição gera o alerta de segurança "Agenda liberada para escrita". Agendas em
que o Google só mostra livre/ocupado ficam sempre fechadas.

**Atualizar lista** lê de novo as agendas da conta (uma nova, uma removida, um
papel que mudou). Se o Google tirar o direito de editar, a agenda volta para
**Só ler** sozinha.

### Tela Agenda

**Agenda**, no menu lateral (ou Ctrl/⌘ K > Agenda), mostra os eventos das
agendas abertas por **dia**, **semana** ou **mês**, no seu fuso. Os botões de
cada agenda, embaixo, escondem ou mostram os eventos dela só na tela.

- **Semana** (no computador): uma grade com o seu horário de trabalho. Cada
  evento fica na altura da hora dele, e os que se sobrepõem dividem a largura.
  O que é de dia inteiro vai numa linha em cima; o que cai antes ou depois do
  horário, nas linhas **Antes** e **Depois**. Uma linha vermelha marca a hora
  de agora.
- **Dia**: a semana numa faixa de sete dias e, embaixo, a lista do dia
  escolhido. No celular a Agenda abre sempre no dia, e "Semana" usa a mesma
  faixa.
- **Mês**: a grade do mês, com todos os eventos.
- "Hoje" é o dia do seu fuso, não o do aparelho. Com a tela aberta à meia-noite,
  a marca de hoje passa para o dia seguinte sozinha; se você estava vendo hoje,
  a tela acompanha.

#### Situação do atendimento

Nas agendas abertas para edição, a **cor do evento no Google** é a situação
dele. São os nomes e os números de cor do próprio Google Agenda:

| Situação | Cor no Google |
| --- | --- |
| Agendado | Pavão (7), ou nenhuma cor |
| Confirmado | Manjericão (10) |
| Reagendado | Banana (5) |
| Cancelado | Tomate (11), com o nome riscado |

- Clique num evento para ver os detalhes e mude a situação com um toque. A cor
  troca no Google na mesma hora, e ninguém recebe aviso.
- Vale nos dois sentidos: mudar a cor no Google Agenda muda a situação aqui.
- Evento sem cor própria conta como Agendado. Outra cor do Google (Uva,
  Tangerina…) aparece com a cor dela, sem situação.
- Em agenda que está como "Só ler", o evento fica com a cor da agenda e não tem
  situação.
- Se o evento mudou no Google enquanto os detalhes estavam abertos, a Zuri não
  grava por cima: avisa, fecha os detalhes e mostra o evento como ficou.

#### Mudar um evento na própria Agenda

Nas agendas abertas para edição, cada mudança vai para o Google na hora. A
linha ao lado dos botões diz como está: "Salvando no Google…", "Salvo no Google
agora" ou "Em dia com o Google".

- **Arrastar** um evento na semana troca o dia e a hora, de 15 em 15 minutos.
  A **borda de baixo** muda a duração (no mínimo 15 minutos). O evento fica
  dentro do horário que está na tela e não passa da meia-noite.
- **Pelo teclado**, com o evento em foco: Alt com as setas muda a hora (para
  cima e para baixo) e o dia (para os lados, entre os dias que estão na tela);
  Alt com Shift e a seta para cima ou para baixo muda a duração. A mudança é
  enviada quando você solta o Alt, e Esc desiste antes disso.
- **No celular** (e na lista do dia) não há arrastar: a mudança é pelo "Editar".
- **Clicar num horário vazio** da semana abre "Novo evento" com o dia e a meia
  hora clicada.
- **Editar** tem os campos Dia, Hora de início, Dura (15 min a 3 horas, ou
  "Outra", que mostra o dia e a hora do fim), Tipo e Situação. O Tipo é a
  primeira linha da descrição do evento no Google ("Consulta | Consultório") e
  a lista traz os tipos que já aparecem nos eventos da tela. O tipo também
  aparece no bloco do evento, depois da hora.
- **Mover marca Reagendado:** mudar o dia ou a hora de um atendimento (evento
  com tipo) que estava Agendado ou Confirmado troca a situação para Reagendado,
  e o aviso diz isso. Mudar só a duração não troca. No "Editar", uma situação
  que você escolher vale mais que essa regra.
- **Desfazer:** depois de cada mudança, o aviso mostra o que mudou e oferece
  "Desfazer" por 8 segundos (Ctrl + Z ou ⌘ + Z faz o mesmo). Desfazer manda a
  mudança contrária para o Google, com a situação de antes.
- **Se não der certo**, o evento volta para onde estava e o aviso diz o motivo.
  Sem conexão, o aviso fica na tela com "Tentar de novo"; nada fica numa fila
  escondida. Se o evento mudou no Google nesse meio tempo, a Zuri não grava por
  cima e lê a semana de novo.
- **Uma mudança por vez:** enquanto uma está sendo salva, a seguinte espera
  (o "Salvar" do formulário aguarda a resposta).
- Mudar só o dia mantém a hora exata do evento. "Desfazer" não aparece quando
  a cor de antes não era uma das quatro situações, porque a Zuri não grava
  outras cores.
- **Evento que se repete:** a mudança vale só para aquele dia, e o aviso diz
  "Só este dia mudou". Mudar a série inteira continua sendo no Google Agenda.
- O aviso também alerta quando o novo horário bate com outro evento.
- Evento de agenda "Só ler" não arrasta, não tem "Editar" e a Zuri avisa que a
  agenda é só para leitura. Evento de dia inteiro ou de mais de um dia não
  arrasta: use o "Editar".

#### Fins de semana e feriados

Sábados e domingos têm um fundo cinza, e os **feriados nacionais** um fundo
âmbar com o nome do feriado: embaixo da data na semana e no mês e numa faixa em
cima da lista do dia. No mês do celular fica só o fundo. Um dia sem expediente
(veja abaixo) aparece como o fim de semana, com o motivo embaixo da data.

Os feriados são calculados pela data, sem consultar nada: 1/1, Sexta-feira
Santa (pela Páscoa de cada ano), 21/4, 1/5, 7/9, 12/10, 2/11, 15/11, 20/11
(desde 2024) e 25/12. Carnaval e Corpus Christi são ponto facultativo e não
entram; feriados estaduais e municipais também não.

#### Regras do agendamento

Valem para **consultas**: eventos com horário cuja descrição começa pelo tipo
("Consulta | Consultório") e que não estão cancelados. Reunião, banco e outros
compromissos sem tipo ficam livres a qualquer hora.

| Regra | Valor |
| --- | --- |
| Minutos | De 5 em 5 (14:30, 14:35) |
| Duração | De 15 minutos a 4 horas |
| Quando | De agora até um ano à frente |
| Dia | Dia de atendimento, sem feriado nacional e sem dia sem expediente; nunca um dia que já fechou |
| Hora | Dentro do horário de atendimento e fora do almoço, nem um minuto a mais |
| Outra consulta | Não pode sobrepor; encostar (10:00 depois de uma que acaba às 10:00) pode |

- **Clicar numa hora fechada** abre "Consulta não entra neste horário", com o
  motivo e o próximo horário livre da semana na tela. **Usar o próximo livre**
  abre o formulário nele; **Criar compromisso pessoal** abre o formulário sem
  tipo, na hora clicada.
- **Arrastar** uma consulta para uma hora fechada pinta o bloco de vermelho com
  o motivo curto ("Almoço", "Feriado", "Ocupado"). Ao soltar, nada vai para o
  Google: a consulta volta para onde estava, toca um som curto (o mesmo
  interruptor dos sons de aviso) e abre o mesmo aviso do clique, com o motivo,
  o próximo horário livre e **Mover para lá**, que leva a consulta para ele com
  a mesma duração. Pelo teclado (Alt e as setas) é igual.
- **O formulário** diz o motivo embaixo dos campos e leva o cursor ao campo a
  corrigir. Uma consulta antiga que você só renomeia ou muda de situação, sem
  mexer no dia e na hora, salva normalmente.
- **Consulta que já começou**: o dia e a hora travam. Puxar o fim ou tirar do
  Cancelado conta como "já passou". O título, a descrição e a situação
  continuam editáveis.
- Clicar na última meia hora antes do almoço ou do fim do dia abre o
  formulário com 30 minutos.
- A Zuri confere tudo de novo no servidor antes de chamar o Google, então outra
  aba aberta ou outro aparelho também não marca consulta no almoço. A conversa
  e os fluxos seguem as mesmas regras: a Zuri não marca nem move consulta fora
  delas e diz o motivo, e propor mudança num evento que outras pessoas veem
  também passa por elas. Reunião sem tipo fica livre, como na tela.

#### Configurações › Agenda

| Opção | O que faz |
| --- | --- |
| **Horário de atendimento** e **Almoço** | As horas em que o consultório atende, de hora em hora (padrão 08:00 até 18:00), e o almoço, de meia em meia hora (padrão 12:00 até 14:00, ou "Sem almoço"). A semana e o dia mostram essas horas, com o almoço riscado; o "Seu dia" do Início usa o mesmo horário. |
| **Ao abrir, mostrar** | Dia, semana ou mês, no computador. |
| **A semana começa** | Domingo ou segunda. |
| **Dias de atendimento** e **Mostrar os dias sem atendimento** | Desligado, a semana mostra só os dias de atendimento. |
| **Feriados nacionais** | Os próximos 12 que caem num dia de atendimento, só para consulta. Todo feriado nacional fecha a agenda sozinho. |
| **Dias sem expediente** | Um dia ou um período (férias, recesso, viagem, feriado da cidade), com **De**, **Até** (vazio para um dia só) em dd/mm/aaaa e motivo opcional. Cada período vai até 90 dias e até um ano à frente, sem encostar em outro; a lista guarda até 100 períodos. Cada dia fecha na agenda e nos agendamentos novos. |
| **Registro do dia** | Só mostra quando foi o último fechamento e com quantos eventos (veja abaixo). |
| **Eventos fora do horário** | Mostrar ou esconder no dia e na semana. Eventos de dia inteiro aparecem sempre. |

#### Registro do dia

Todo dia, à 0h do seu fuso, a Zuri lê no Google o dia que terminou, nas agendas
em **Ler e editar**, e guarda uma cópia dos eventos. Daí em diante esse dia
fica congelado:

- Nada daquele dia muda pela Zuri: criar, editar, mudar a situação, arrastar ou
  apagar é recusado na tela, na conversa e nos fluxos, e o servidor confere de
  novo antes de chamar o Google. Até a meia-noite, o dia de hoje ainda aceita
  marcar quem veio ou faltou.
- A ficha do evento mostra **Congelado** com a situação final, sem os botões de
  situação, **Editar** e **Apagar**. Arrastar toca o som de recusa e avisa.
- A Agenda mostra a cópia. Se alguém mudar, apagar ou criar um evento daquele
  dia direto no Google Agenda, a cópia fica como estava, o bloco ganha a marca
  "Mudou no Google depois do fechamento" e chega um aviso por dia, uma vez para
  cada conjunto de mudanças. O aviso diz o dia, nunca o título.
- Se o Google não responder inteiro, o dia não fecha e a Zuri tenta de novo em
  15 minutos. Um dia perdido (o servidor parado) fecha depois, até 7 dias para
  trás, um por vez. O que veio antes desta versão não é copiado.
- A cópia nunca é apagada e entra na cópia de segurança. Ao importar, um dia já
  fechado aqui fica como está.

Uma consulta já marcada que fica fora do novo horário (ou num dia que fechou)
não some nem muda no Google: o cartão lista as consultas afetadas com **Abrir a
Agenda**, e na Agenda o bloco ganha um triângulo de aviso.

Nada some sem aviso: o que uma opção esconde aparece contado embaixo da
Agenda ("2 eventos fora das 08:00 às 18:00"), com **Mostrar** ao lado. O mês
mostra tudo. As opções ficam guardadas na Zuri e valem em todos os seus
aparelhos; elas não mudam nada no Google.

- **Novo evento** (ou Ctrl/⌘ K > Novo evento): título, agenda, dia e
  horário, tipo (começa como a primeira "Consulta" que a agenda já usa), local
  e descrição. Evento de dia inteiro se cria no Google; aqui ele aparece e se
  edita.
- Toque num evento para ver os detalhes. Em agendas **Ler e editar**, aparecem
  **Editar** e **Apagar** (com confirmação). Em **Só ler**, só os detalhes.
- Se alguém mudou o evento no Google depois que a tela abriu, a Zuri não
  sobrescreve: avisa que o evento mudou e mostra a versão nova.
- Um evento que se repete muda só naquele dia.
- Convidados ficam no Google: a Zuri não convida nem avisa ninguém
  (`sendUpdates=none`).

O que muda no Google (pelo celular, pelo computador, por outra pessoa) aparece
na tela aberta sem recarregar: o Google avisa a Zuri, e a tela lê o período de
novo. Isso precisa do endereço público com HTTPS (`PUBLIC_URL`). Sem ele, ou
se o Google recusar o aviso, a tela lê de novo quando você volta para ela.

A tela mexe só nos eventos. Criar, renomear ou apagar agendas continua no
Google Agenda (decisão de 03/11/2026).

### Na conversa, no bot e nas rotinas

- "O que tenho amanhã?", "Marca dentista sexta às 15h", "Muda a reunião de
  quinta para as 10h": a Zuri usa as ferramentas da agenda nas agendas
  abertas. Apagar vira cartão de aprovação, também pelo bot e pela página
  `/aprovar`. Se o Google falhar na hora de apagar (fora do ar, limite de
  pedidos), o cartão fica como falha e nada é apagado; peça de novo na
  conversa.
- `/hoje` no Telegram ganha o bloco **Agenda** com os eventos do dia. Com o
  Google fora do ar, aparece "Agenda indisponível agora."
- Em **Rotinas > Criar rotina > Rotina da Zuri**, os modelos **Briefing da
  manhã** (todo dia, 07:00) e **Fechamento do dia** (segunda a sexta, 19:00)
  preenchem o texto e o nome. Rotinas só leem a agenda; nunca criam nem mudam.

### Desconectar

**Desconectar** apaga daqui a conta e as agendas, devolve o acesso ao Google e
para os avisos de mudança. Seus eventos continuam no Google Agenda.

Se o Google recusar o acesso (você tirou a permissão na conta Google, trocou a
senha ou o acesso venceu), o cartão mostra **Conectar de novo** e a central
avisa uma vez. Se o acesso voltar e cair de novo, o novo aviso só sai depois
de um dia do anterior.

## Para quem instala: o cliente OAuth do Google

A Zuri usa o seu próprio app do Google, gratuito. Faça uma vez:

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um
   projeto (por exemplo, "Zuri").
2. Em **APIs e serviços > Biblioteca**, ative a **Google Calendar API**.
3. Em **APIs e serviços > Tela de consentimento OAuth**: tipo **Externo**,
   nome do app "Zuri", o seu e-mail de suporte. Em **Escopos**, adicione
   `.../auth/calendar.events` e `.../auth/calendar.calendarlist.readonly`.
   Depois, em **Público-alvo**, **Publicar app** (status **Em produção**). Sem
   publicar, o Google derruba o acesso a cada 7 dias. Não é preciso pedir a
   verificação do Google: o app é só seu, e o aviso "app não verificado"
   aparece só para você.
4. Em **APIs e serviços > Credenciais > Criar credenciais > ID do cliente
   OAuth**: tipo **Aplicativo da Web**. Em **URIs de redirecionamento
   autorizados**, ponha `https://exemplo.com.br/rest/oauth2-credential/callback`
   (troque pelo endereço da sua Zuri, o mesmo de `PUBLIC_URL`, e mantenha o
   resto igual, `callback` sem hífen). A Zuri recebe a volta nesse
   endereço e leva você para **Configurações > Integrações**, onde a conexão
   termina.
5. Grave o ID e a chave secreta como **Secrets** do Worker, em **Workers e
   Pages > zuri > Configurações > Variáveis e segredos**, ou pelo terminal
   dentro de `apps/agent`:
   - `npx wrangler secret put GOOGLE_CLIENT_ID`
   - `npx wrangler secret put GOOGLE_CLIENT_SECRET`
6. O `MCP_CREDENTIAL_KEY` também é preciso (é ele que cifra os tokens do
   Google); veja [configuracao-cloudflare.md](configuracao-cloudflare.md).

Nunca cole o ID, a chave secreta ou um token no chat, num issue ou no
repositório. Sem os três segredos, o cartão diz que o Google ainda não está
configurado e nada mais muda.

A etapa 19b (Google Contatos) vai pedir uma permissão a mais na mesma conexão:
o Google mostra a tela de novo só com o que falta.

As avaliações do Google (etapa 19c) pedem mais três APIs, o escopo
`.../auth/business.manage` e o "Basic API Access" do Perfil da Empresa; o
passo a passo está em [avaliacoes-google.md](avaliacoes-google.md#para-quem-instala).

## Como funciona

| Parte | Onde |
| --- | --- |
| OAuth (PKCE S256, `state` de uso único por 10 min, preso à sessão), tokens, agendas, eventos, canais de push | `apps/agent/src/google/service.ts` |
| Datas dos eventos, limpeza de texto | `apps/agent/src/google/events.ts` |
| Situação pela cor (`EVENT_STATUS_COLOR`, `eventStatus`) e feriados nacionais (`nationalHoliday`) | `packages/shared/src/google.ts`, `packages/shared/src/holidays.ts` |
| Rotas `/api/google/*` e o aviso de push | `apps/agent/src/api/google.ts`, `apps/agent/src/gates/google-push.ts` |
| Ferramentas do agente | `apps/agent/src/tools/calendar.ts` |
| Google simulado (desenvolvimento, e2e e testes) | `apps/agent/src/google/dev-google.ts` |
| Tela Agenda e cartão em Integrações | `apps/web/src/pages/agenda/AgendaPage.tsx`, `apps/web/src/pages/settings/GoogleCard.tsx` |
| Regras de arrastar, duração, "mover marca Reagendado" e desfazer; envio de uma mudança com o aviso | `apps/web/src/lib/agenda-edit.ts`, `apps/web/src/pages/agenda/changes.ts` |
| Banco (migration 22) | `zur_google_account`, `zur_google_calendars` |

- Os tokens ficam cifrados com AES-256-GCM, numa chave derivada do
  `MCP_CREDENTIAL_KEY` com um `info` próprio (`google-v1`). Nunca voltam para
  o navegador, para o log nem para o backup.
- Os eventos não ficam guardados aqui: cada leitura vai ao Google.
- `GET /api/google/events` devolve o `colorId` de cada evento (de "1" a "11",
  ou vazio). `PATCH /api/google/events` aceita `colorId` só com "5", "7", "10",
  "11" ou vazio (tira a cor), sempre com o `etag` que a tela leu.
  `POST /api/google/events` aceita `colorId` com uma das quatro cores, para o
  evento nascer com a situação escolhida no formulário.
- Cada chamada ao Google vai para um endereço fixo, com 10 s de prazo, sem
  seguir redirecionamento e até 1 MB de resposta (uma resposta que não é
  JSON conta como falha). Um turno da conversa faz no máximo 8 chamadas (6
  pelo bot, 4 numa rotina); uma ação da tela, 12; o `/hoje`, 4. Com mais
  agendas abertas do que o teto cobre, a leitura começa pela principal e diz
  quais ficaram de fora, em vez de falhar.
- No modo de bloqueio (`/bloquear`), nenhuma chamada sai para o Google.
- Títulos, locais e descrições dos eventos entram no prompt como dado
  (`<data source="calendar">`), nunca como ordem: quem convida você escreve o
  título.
- O aviso de push chega em `/api/google/push` com um token que é o HMAC do
  `SESSION_SECRET` sobre o id do canal. Sem token certo, a resposta é a mesma
  (200 vazio) e nada acontece.

## Custo

Tudo grátis: a Google Calendar API não cobra, e nenhum recurso novo da
Cloudflare entra. Cada aviso de mudança custa uma requisição ao Worker.
