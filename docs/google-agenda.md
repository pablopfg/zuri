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

Nas agendas abertas para edição, cada mudança vai para o Google na hora. O
**sinal da sincronização**, ao lado dos botões, diz como está, sempre com
ícone, cor e nome:

| Sinal | Quando | O que fazer |
| --- | --- | --- |
| Sincronizado | Tudo igual ao Google, com a hora da última conferência | Nada |
| Salvando… | Uma mudança está indo para o Google | Esperar |
| Salvo no Google | A última mudança chegou, há menos de um minuto | Nada |
| Atualizando… | A Zuri está lendo o que mudou no Google | Esperar |
| Sem internet | A mudança não chegou; o evento voltou ao que era | Tentar de novo |
| Falha ao salvar | O Google recusou a mudança; o evento voltou ao que era | Ver o evento |
| Mudou no Google | O evento foi mudado lá enquanto você mexia aqui; vale a versão de lá | Ver o evento |
| Em pausa | O Google pediu um intervalo depois de muitas mudanças seguidas | Tentar de novo em 1 minuto |
| Desatualizada | Sem notícias do Google há mais de 15 minutos, ou a última leitura falhou | Atualizar agora |

O sinal abre um painel com a situação de agora, o botão do que fazer, as
últimas cinco mudanças desta visita (com a hora e se chegaram ao Google) e "O
que cada sinal quer dizer", que explica também "Conexão expirou" e "Só
leitura". Nada fica esperando escondido no navegador: sem internet, a mudança
volta e você manda de novo. Se o acesso ao Google se perde no meio da visita, a
Agenda troca a tela por "Conectar de novo".

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
- **Editar** tem os mesmos campos do "Novo evento" (abaixo). O tipo e o local
  formam a primeira linha da observação do evento no Google ("Consulta |
  Consultório" ou "Consulta | Online"), e o tipo aparece no bloco do evento,
  depois da hora.
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
- **O formulário** recusa um horário fechado com um aviso por cima dele, com
  o som de recusa, o motivo e o próximo horário livre. **Usar este horário**
  troca o dia e o início (a duração fica) e leva o cursor a "Criar evento";
  **Corrigir** ou Esc fecham só o aviso e levam o cursor ao campo a corrigir.
  Nada do que foi digitado se perde. Uma consulta antiga que você só renomeia
  ou muda de situação, sem mexer no dia e na hora, salva normalmente.
- **Ver no calendário**, embaixo do dia e das horas, abre o mês. Dia que já
  passou, sem atendimento, feriado, sem expediente ou sem horário livre na
  duração escolhida fica riscado e não responde ao toque; o leitor de tela diz
  o motivo. Escolhido um dia, os horários livres aparecem em botões de meia em
  meia hora, já na duração do formulário. Compromisso pessoal (sem tipo) só
  risca os dias que passaram.
- **Escolher na agenda** (só ao criar, no computador) recolhe o formulário e mostra uma faixa
  "Toque no dia e na hora da consulta". O toque numa hora livre devolve o
  formulário com tudo o que estava digitado e o horário novo; uma hora fechada
  avisa como sempre; **Cancelar** devolve o formulário como estava. Se a
  Agenda estava no mês, ela passa para a semana. No celular o dia é uma lista,
  sem hora para tocar, e o caminho é **Ver no calendário**.
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

- **Novo evento** (ou Ctrl/⌘ K > Novo evento) começa como uma Consulta
  presencial. Os campos, na ordem:
  - **Nome completo do paciente**, que vira o título do evento. A partir de
    duas letras, a Zuri procura em Contatos, sem acento: primeiro os nomes
    que começam com o que você digitou ("carla m" acha "Carla Mendes"); se
    nenhum começa assim, cada palavra pode ser o começo de qualquer palavra
    do nome ("mendes"). Cada pessoa aparece com o celular, a data de
    nascimento e a última consulta, e quem já tem consulta registrada vem
    primeiro. A última opção é sempre **Agendar “nome” sem vínculo**. Setas
    escolhem, Enter vincula e Esc fecha a lista.
  - Vinculada, a consulta mostra "Vinculado a Carla Mendes, nasc. 02/09/1995"
    com o celular e o e-mail de Contatos só para leitura e **Remover
    vínculo**. Para mudar esses dados, edite o contato no Google. Mudar o nome
    desfaz o vínculo. Nada se vincula sozinho: com um só contato do nome, a
    tela mostra "“Carla Mendes” está em Contatos." com **Vincular**.
  - Homônimos: com dois ou mais contatos do mesmo nome, a consulta só é salva
    com o contato certo da lista ou com **É outra pessoa**, que deixa o
    celular obrigatório.
  - **DDI do paciente** (todos os países, Brasil primeiro), **Celular com
    DDD** e **E-mail de contato**, os dois opcionais. O celular toma a forma
    enquanto você digita, "(41) 99999-0000" no Brasil e em blocos de três nos
    outros países; um "+55" colado na frente sai sozinho. A Zuri guarda só os
    dígitos.
  - **Data da consulta** (dd/mm/aaaa), **Hora do início** e **Hora do
    término**, sempre de 00:00 a 23:59, sem AM ou PM, em qualquer idioma do
    aparelho. O término começa 1 h depois do início e acompanha o início
    quando ele muda; outro término mostra a duração e **Voltar para 1 h**.
  - **Tipo do evento**: Consulta, Retorno, Avaliação física, os tipos que a
    agenda já usa, **Outro, digitar** e **Sem tipo (compromisso comum)**, que
    é um compromisso pessoal: tira os campos do paciente, o local e o
    financeiro, e o nome vira **Título**.
  - **Local**: Presencial ou Online. Online pede ao Google uma chamada do
    Google Meet ao salvar; voltar para Presencial tira a chamada, e essa
    mudança não oferece "Desfazer" (o link não volta igual). Presencial leva
    ao campo Local do evento o endereço de Configurações › Consultório
    ("endereço, cidade e estado"), quando a consulta ainda não tem local;
    passar para Online tira esse endereço. Um local escrito à mão no Google
    não é trocado.
  - **Situação** e **Financeiro** (Não pago, o padrão, Pago ou Gratuito).
  - **Observação**, que no Google vem depois da linha do tipo.

  Um campo errado recebe o foco, treme uma vez (parado, se o aparelho pede
  menos movimento) e mostra a mensagem embaixo dele. Ao salvar, o aviso diz
  quem, o dia e a hora ("“Helena Prado” agendado para qua, 18/11 às 14:30."). Evento de dia
  inteiro se cria no Google; aqui ele aparece e se edita.
- Os **detalhes** de uma consulta mostram o tipo, o local (no Online, o link
  do Meet com **Copiar link**, ou "O Google está criando o link da
  chamada…"), o paciente, o financeiro e a observação como está no
  Google. O paciente vinculado aparece com a data de nascimento, o celular, o
  e-mail, **Abrir em Contatos** e a etiqueta **Homônimo** quando outro contato
  tem o mesmo nome. Sem vínculo, aparece "Sem vínculo com Contatos" (ou
  "Pessoa nova, com o mesmo nome de N contatos") com o celular, o e-mail e
  **Vincular**, que abre o formulário com a lista. Quando o contato saiu de
  Contatos, mudou de nome lá ou Contatos está desligado, aparece "O vínculo
  com Contatos não vale mais", e o formulário abre sem vínculo.
- **Agendar** na ficha de um contato abre a Agenda com "Novo evento" pronto: o
  contato já vinculado (mesmo com homônimos, porque foi ele o escolhido) e o
  primeiro horário livre, de meia em meia hora a partir de agora, num dia
  aberto, fora do almoço e sem outro evento no horário, até o fim do mês
  seguinte. Sem horário livre, vem amanhã no começo do expediente. Uma linha
  diz de onde veio o horário e avisa se o contato já tem consulta marcada daqui
  para frente. Contato sem nome no Google não se vincula: o celular e o e-mail
  vêm preenchidos e o nome fica para escrever. **Cancelar** volta para a
  ficha.
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

### Confirmação do paciente

Os detalhes de uma consulta (um evento com tipo, numa agenda em que a Zuri
escreve) têm o quadro **Confirmação do paciente**:

- A linha de cima diz a situação: "Ainda não enviado", "Enviado pelo
  WhatsApp" ou "Enviado por e-mail" (com o dia e a hora, ainda sem resposta), "Confirmou pelo link",
  "Remarcou pelo link" (com o horário de antes) ou "Cancelou pelo link". Uma
  consulta que mudou de hora depois do envio ou da resposta volta a "Ainda não
  enviado": o paciente confirma de novo.
- **Enviar pelo WhatsApp** abre o WhatsApp Web, numa aba nova, com a mensagem
  de Configurações › Consultório já preenchida para o celular do paciente. Você
  confere e envia. Ao tocar, a Zuri registra o envio daquele horário e o botão
  vira **Enviar de novo**. Sem celular na consulta, o botão não aparece.
- **Enviar por e-mail** aparece quando a consulta tem o e-mail do paciente. A
  Zuri manda o e-mail de confirmação de Integrações › E-mail para pacientes
  pela forma de envio salva, com o link no botão, e registra o envio. Depois
  disso o botão some até a consulta mudar de hora, e o servidor recusa um
  segundo e-mail para o mesmo horário. Se o e-mail não sair (sem forma de
  envio, teto do dia, servidor recusando), o aviso diz e nada é registrado.
- **Copiar mensagem** copia o mesmo texto, sem registrar envio, e **Ver como o
  paciente** abre a página numa aba nova. O link nasce no primeiro pedido e é o
  mesmo depois disso, um por consulta.
- Já confirmada, o quadro diz que não precisa enviar de novo.
- Uma consulta cancelada, ou a menos de 1 hora, não tem link para dar.

#### Mensagem de confirmação

Fica em Configurações › Consultório, junto dos dados do consultório. Um botão
por variável põe no texto, onde está o cursor, `{nome}` (primeiro nome do
paciente), `{tipo}`, `{dia}`, `{hora}`, `{local}` (o endereço do consultório, o
link do Google Meet ou o aviso de que ele chega antes), `{link}`, `{prazo}` (até
quando dá para cancelar), `{consultorio}` e `{whatsapp}` (o da equipe). A
prévia mostra como chega no WhatsApp, com `*texto*` em negrito, num exemplo com
dados inventados. A mensagem precisa ter `{link}`, cabe em 1.000 caracteres e só
aceita as variáveis da lista: o servidor recusa o resto. **Voltar ao modelo
padrão** traz o texto do protótipo, no idioma da Zuri.

#### E-mail de confirmação

Fica em Integrações › E-mail para pacientes, logo abaixo da forma de envio.
Tem assunto (até 120 caracteres, uma linha, com `{nome}`, `{tipo}`, `{dia}`,
`{hora}` e `{consultorio}`), texto (até 2.000 caracteres, com todas as
variáveis menos `{link}`) e o texto do botão (até 30). O link do paciente vai
sempre no botão: o texto não aceita `{link}`. O e-mail sai em texto e em HTML
simples, sem imagens; no texto, o botão vira "Confirmar presença: endereço".
Como na mensagem do WhatsApp, os três campos recusam endereço da web e
telefone escritos à mão e caracteres invisíveis. A tela não salva campo em
branco; **Voltar ao modelo padrão** traz o modelo de volta, e **Copiar o texto
do WhatsApp** põe no texto a mensagem de Consultório sem a linha do link e sem
os asteriscos.

A Zuri guarda cada envio (link, horário, canal e hora), sem o texto e sem o
telefone, na tabela `zur_confirm_sends` (migration 47), fora do backup como os
links. O envio automático da véspera usa o mesmo registro para não mandar duas
vezes.

#### Confirmação automática na véspera

É a automação **Confirmação de consulta**, em CRM › Automações. Ela chega
desligada, passa pelo ensaio de 3 dias úteis como as outras e só então envia.
No dia útil antes da consulta, no horário escolhido (07:00 por padrão, entre
07:00 e 20:00, e de novo a cada meia hora até as 21:00 para o que ainda faltar), a Zuri põe na fila de saída a mensagem de Configurações ›
Consultório, com o link, para o celular de cada consulta. Na sexta, vão as
consultas de sábado, domingo e segunda; antes de um feriado, as do feriado e
do dia útil seguinte. A mensagem sai pelo Chatwoot e, se não sair até 1 hora
antes da consulta, não sai mais.

Com a automação em ensaio, ligada ou pausada, mudar a mensagem de confirmação
ou o nome, o endereço ou a cidade do consultório pede a sua senha e gera um
alerta de segurança, porque esse texto sai sem você ver. No Chatwoot, o
contato aparece só com o primeiro nome.

Ficam de fora: consulta cancelada ou já passada, sem celular (no Brasil, só
celular com o 9), em agenda em que a Zuri não escreve, com o link cancelado,
já respondida para aquele horário ou já enviada (pelo WhatsApp, por e-mail ou
pelo próprio automático). No ensaio nada é criado: nem link, nem mensagem.

Nos detalhes da consulta, o quadro diz quando ela sai ("Sai sozinho pelo
Chatwoot em qua., 18 de nov., às 07:00"), que está na fila, que foi enviada
ou que não saiu, e nesse caso pede o envio pelo WhatsApp ou por e-mail.
Configurações › Consultório mostra, no cartão "Como a confirmação sai", se a
automação está desligada, em ensaio, ligada ou pausada, com **Mudar** levando
a CRM › Automações.

O que o paciente vê, sem entrar em nada:

- O nome do consultório (Configurações › Consultório), o primeiro nome dele,
  o dia, a hora, o tipo e o endereço. Numa consulta online, um aviso de que o
  link da chamada chega antes. Nada mais da Zuri: sem menu, sem link para
  dentro.
- **Confirmar presença** pinta a consulta de Confirmado (Manjericão) aqui e no
  Google e manda um aviso com o sino.
- **Cancelar a consulta** pergunta antes, com "Não, manter a consulta" em
  foco. Cancelar pinta de Cancelado (Tomate), nunca apaga o evento, manda o
  aviso e desliga o link para sempre. Dá para cancelar por aqui até 12 horas
  antes e só até 23:59 do dia anterior, o que vier primeiro.
- **Preciso remarcar** (também como "Prefiro remarcar" no aviso de cancelar)
  leva o paciente em 4 passos: o dia, manhã ou tarde, a hora de preferência e
  um dos horários livres. Só aparecem os dias de amanhã até 8 dias à frente com
  horário livre, dentro do horário de atendimento de Configurações › Agenda,
  fora do almoço, dos feriados e dos dias sem expediente. Livre quer dizer sem
  encostar em nenhum evento com hora das agendas lidas, compromissos e agendas
  só de leitura também. Os horários vêm de 1 em 1 hora, com a duração da
  própria consulta. O último passo oferece até 3 horários colados antes ou
  depois de outra consulta, os mais perto da hora escolhida primeiro; sem
  nenhum colado livre, os 2 que somam menos minutos até uma consulta e até a
  hora escolhida (esta pesa 1,5 vez), em ordem de horário; num turno sem
  consulta, 2 sorteados que não mudam ao recarregar. Escolher pede
  confirmação. A Zuri lê o dia de novo na hora de gravar, uma remarcação por
  vez: se o horário acabou de ser ocupado, a página diz e mostra os que
  sobraram. O mesmo evento muda de dia e hora no Google e fica Reagendado
  (Banana); o link continua o mesmo e o aviso com o sino diz de quando para
  quando. Vale até o prazo de cancelar, até 2 vezes por consulta e só para
  consultas de 15 minutos a 4 horas; fora disso, só pela equipe.
- **Falar com a equipe pelo WhatsApp** abre o WhatsApp do consultório com a
  mensagem pronta. Sem dia livre para remarcar, **Combinar pelo WhatsApp**
  abre com a mensagem de quem não achou horário.
- O link vale até 1 hora antes da consulta. Depois disso, ou se a consulta for
  cancelada, a página diz que ele expirou.

Defesas e limites: [seguranca.md](seguranca.md#link-de-confirmação-ctoken).

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
| Registro do dia e última consulta de um contato (migrations 42 e 43) | `zur_agenda_record` com o índice `zur_agenda_record_contact`, `zur_agenda_closed_days`; `apps/agent/src/google/record.ts` |
| Link de confirmação do paciente (migrations 45 e 46) | `zur_appointment_links`; `apps/agent/src/google/confirm-links.ts`, `apps/agent/src/google/reschedule.ts`, `apps/web/src/pages/confirm/Reschedule.tsx`, `apps/agent/src/api/confirm.ts`, `apps/web/src/pages/confirm/ConfirmPage.tsx`, `apps/web/src/pages/agenda/ConfirmBox.tsx` |
| Busca do nome e vínculo com Contatos | `apps/agent/src/google/contacts.ts` (`forBooking`), `apps/web/src/pages/agenda/PatientLink.tsx` |

- Os tokens ficam cifrados com AES-256-GCM, numa chave derivada do
  `MCP_CREDENTIAL_KEY` com um `info` próprio (`google-v1`). Nunca voltam para
  o navegador, para o log nem para o backup.
- Os eventos não ficam guardados aqui: cada leitura vai ao Google.
- O DDI, o celular, o e-mail e o financeiro do paciente viajam com o evento,
  nas propriedades privadas dele no Google (`extendedProperties.private`:
  `zuriCountry`, `zuriPhone`, `zuriEmail`, `zuriPayment`). Quem abre o evento
  no Google não vê esses campos e não há tabela nova na Zuri. Cada valor
  lido volta conferido: um celular fora do formato ou um país desconhecido é
  ignorado. Um campo esvaziado no "Editar" é apagado no Google.
- O vínculo da consulta a um contato fica na mesma lista, em `zuriContact`,
  com o `resourceName` do contato no Google (`people/c123`). Ele não muda
  quando Contatos é desligado e ligado de novo. Com vínculo, o servidor exige
  que o contato esteja na cópia de Contatos e que o título seja o nome dele, e
  apaga `zuriCountry`, `zuriPhone` e `zuriEmail`: os dados são os de
  Contatos. Sem vínculo, um nome que dois ou mais contatos têm precisa do
  celular. Nada se vincula sozinho: só o formulário manda `contact`.
- `GET /api/contacts?for=booking&q=…` é a busca do nome no formulário: só a
  cópia de Contatos, nunca o Google, a partir de duas letras e até 6
  pessoas, com `same` (quantos contatos têm exatamente esse nome). A última
  consulta de cada pessoa sai do registro do dia, pelo índice
  `zur_agenda_record_contact` (migration 43).
- O Meet sai por `conferenceData.createRequest` (`hangoutsMeet`) com
  `conferenceDataVersion=1`. Só um link `https://meet.google.com/xxx-xxxx-xxx`
  vira link na tela.
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
