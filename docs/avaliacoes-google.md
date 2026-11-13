# Avaliações do Google

A partir da etapa 19c, a Zuri lê as avaliações do seu Perfil da Empresa no
Google, avisa a equipe das negativas e escreve rascunhos de resposta para você
aprovar. Nada é publicado sem a sua aprovação, a não ser que você libere a
Zuri a publicar sozinha as respostas às avaliações positivas (etapa 19d,
[abaixo](#publicar-sozinha-as-positivas)). Os planos estão em
`docs/planos/google-business-profile.md` e
`docs/planos/etapa-19d-resposta-automatica.md`.

## Para o dono

### Ligar

1. Conecte o Google Agenda primeiro (veja [Google Agenda](google-agenda.md)).
   As avaliações usam a mesma conta, que precisa gerenciar o perfil.
2. Abra **Avaliações › Ajustes** (o cartão **Google Agenda e Contatos**, em
   Integrações, também leva para lá). A parte **Conexão** mostra quatro passos,
   cada um com a situação: conta do Google, permissão para gerenciar o perfil,
   acesso liberado pelo Google e perfil.
3. Em **Permissão para gerenciar o perfil**, toque em **Dar permissão**. Se a
   última senha foi digitada há mais de 15 minutos, a Zuri pede de novo. O
   Google mostra a permissão nova, "gerenciar seu Perfil da Empresa". As
   permissões da agenda e dos contatos continuam como estavam.
4. Em **Perfil**, toque em **Escolher perfil**, marque o perfil (até 3),
   escreva a assinatura e toque em **Salvar perfis**.
5. Em **Como responder** ficam o tom, a assinatura, o que a Zuri faz com cada
   avaliação, os 3 a 5 modelos de agradecimento e as palavras que nunca
   entram. **Salvar avaliações** guarda tudo de uma vez.

O intervalo entre as leituras continua em Configurações › Integrações › Google.

Ao salvar, a Zuri faz a primeira leitura na hora (no máximo uma por minuto;
salvar de novo logo depois deixa a leitura para o alarme). O que já existe no perfil
vira **histórico**: não gera aviso nem rascunho. Só as avaliações que chegam
depois disso entram na fila.

### O que acontece com cada avaliação

A Zuri lê o perfil a cada 10 minutos, pelo mesmo alarme das rotinas, e só o
que mudou desde a leitura anterior. **Conferir agora** faz o mesmo na hora,
no máximo uma vez por minuto. Você escolhe o intervalo no campo **Conferir a
cada (minutos)** do cartão, de 1 a 1.440 (um dia). Abaixo de 5 minutos, a leitura divide a conta do dia com a outra sincronização e com os fluxos ligados: as duas não cabem a cada minuto ao mesmo tempo (1 minuto numa pede 4 ou mais na outra), e a tela avisa quando o intervalo não cabe. Uma leitura sem novidade não
regrava avaliação nenhuma e não faz a tela recarregar. Se o Google só muda a
hora de uma avaliação, com as mesmas estrelas e o mesmo texto, a Zuri guarda a
hora nova e mantém a triagem e o rascunho que já existiam. Se a mudança
incluir um caractere invisível, ela conta como edição e vai para a equipe.

| Avaliação | O que a Zuri faz |
| --- | --- |
| 1 a 3 estrelas, ou sem nota | Avisa a equipe na hora, no tópico "Avaliações" do grupo do Telegram, mesmo com a IA fora do ar. Escreve um rascunho cuidadoso para você revisar, quando dá. Se ninguém resolver em 48 horas, avisa mais uma vez. |
| 4 ou 5 estrelas sem texto | Rascunho com um dos seus modelos, sem gastar IA. |
| 4 ou 5 estrelas com texto | O agente de avaliações lê o texto. Se for só elogio, escreve um rascunho; se achar queixa, assunto de saúde ou outro idioma, a avaliação vai para a equipe. |
| Texto que parece dar ordens, com link, telefone, e-mail ou marcação | Vai para a equipe como "Texto suspeito", e a IA nunca o lê. Você pode responder escrevendo a resposta. |
| Já respondida no Google | Fica como "Respondida no Google". A Zuri nunca responde por cima. |
| Escrita há mais de 14 dias | Histórico. |

As regras da nota são fixas: a IA só consegue deixar uma avaliação mais
cautelosa, nunca menos. Mais de 3 negativas numa leitura viram um aviso só, e
5 negativas ou 10 avaliações novas numa hora geram um alerta de pico.

### A tela Avaliações

**Avaliações** (`/avaliacoes`, no menu; o endereço antigo
`/contatos/avaliacoes` leva para ela) tem quatro partes. No alto ficam o perfil
lido, a hora da última leitura, a contagem para a próxima e dois botões:
**Conferir agora** e **Pausar respostas**.

- **Visão geral**: os números do período (30 dias ao abrir, 6 ou 12 meses, 2
  anos por semestre ou 5 anos por ano): índice de recomendação, nota média,
  respondidas e tempo até responder; e as que precisam de você, com
  **Revisar**. Os gráficos:
  - **Índice de recomendação** por semana, mês, semestre ou ano. A cor da barra
    é a faixa do índice: Excelente (75 a 100), Muito bom (50 a 74), Razoável
    (0 a 49) e Crítico (abaixo de 0). A nota média usa as mesmas faixas: 4,5
    ou mais, 4,0 a 4,4, 3,0 a 3,9 e abaixo de 3.
  - **Avaliações recebidas** em cada período, com a parte que recomenda (5
    estrelas), a neutra (4) e a que não recomenda (1 a 3).
  - **Estrelas**: quantas avaliações de cada nota.
  - Toda cor vem com o nome ou o número, a parte que não recomenda e a faixa
    Crítico são listradas, e cada gráfico tem **Ver em tabela**.
  - **Estatísticas do período**: satisfeitos (4 e 5 estrelas), margem do
    índice (95% de confiança, a partir de 10 avaliações: com poucas ela é larga), tendência do
    índice (a reta de mínimos quadrados pelas barras, a partir de três com
    avaliações), mediana, nota mais comum, desvio padrão e a média de
    avaliações por período, com o de maior movimento. As contas são da tela
    (`apps/web/src/pages/reviews/numbers.ts`), a partir das contagens da rota.
- **Avaliações** (`/avaliacoes/lista`): a lista de um lado e a avaliação
  aberta do outro (em janela estreita, a aberta toma o lugar da lista). Os
  filtros são **Precisa de você**, **Respondidas**, **Publicadas sozinha**
  (quando o nível automático está ligado ou alguma resposta saiu assim) e
  **Todas**, mais o filtro por nota. Cada avaliação mostra só o primeiro nome
  de quem avaliou, as estrelas, o texto como texto puro e o que a Zuri fez.
- **Pedidos** (`/avaliacoes/pedidos`): quem deve receber o link de avaliação.
  Veja "Pedidos de avaliação" abaixo.
- **Ajustes** (`/avaliacoes/ajustes`): **Conexão**, **Como responder** e
  **Pedidos e link**.

Num rascunho você pode:

- editar o texto e tocar em **Aprovar e publicar**. A Zuri confere o texto de
  novo, lê a avaliação no Google e só então publica. Se a avaliação mudou, foi
  removida ou já tem resposta, nada sai e a tela diz o porquê;
- **Escrever de novo**, que conta na cota de IA do dia;
- **Descartar rascunho**;
- **Já resolvi fora da Zuri**, que tira a avaliação da fila sem mandar nada.

Uma aprovação vale para a versão da avaliação que você viu e por 72 horas.
Uma resposta publicada pela Zuri pode ser apagada pela tela, depois de ela
conferir no Google que a resposta ainda é a dela. A resposta de outra pessoa
nunca é apagada.

**Pausar respostas** (no alto da tela, ou `/pausar_rotinas` no Telegram) segura as
publicações. A leitura e os avisos continuam. Retomar é só pelo app.

### Publicar sozinha as positivas

Em **O que a Zuri faz**, a terceira opção é **Publica sozinha as positivas**.
Ela começa bloqueada e libera depois que você aprova **10 rascunhos de
avaliações positivas sem mudar nada**, contados entre as suas 30 últimas
decisões sobre esses rascunhos. Aprovar sem mudar conta a favor; aprovar
editado ou descartar conta contra. A contagem aparece embaixo da opção e
continua mesmo se você desligar as avaliações.

Ligar pede a sua senha (se ela não foi digitada nos últimos 15 minutos) e
manda um alerta de segurança em todos os canais. Só a tela muda esse nível:
a conversa, as rotinas, o bot e qualquer token ficam de fora.

Com o nível ligado, a cada leitura a Zuri publica sozinha, depois de ler a
avaliação no Google de novo:

- só avaliações de 4 ou 5 estrelas, sem queixa, saúde, outro idioma ou texto
  suspeito;
- só quando o rascunho do agente passou pela conferência fixa e pela segunda
  leitura, ou quando é um modelo seu numa avaliação só com nota. Um modelo
  que entrou no lugar de um rascunho reprovado, ou porque a IA não pôde
  escrever, espera você;
- só o que foi proposto depois de você ligar o nível;
- até 3 por leitura e 10 por dia. O resto espera você, como antes.

Nada sai sozinho com as respostas pausadas, no modo de bloqueio ou durante um
pico (5 negativas ou 10 avaliações novas numa hora). No fim de cada leitura
que publicou alguma coisa, um aviso no privado conta quantas saíram. A aba
**Publicadas sozinha** lista essas respostas com **Apagar resposta**.

A Zuri volta sozinha para **Escreve rascunhos para eu aprovar** e avisa você
no privado quando:

- três rascunhos seguidos de avaliações positivas não passam na conferência
  ou na segunda leitura;
- o Google recusa uma resposta;
- uma resposta da Zuri é apagada ou trocada, pela tela ou direto no Google.

Falta de Neurons ou a IA fora do ar não contam como reprovação: nesses casos a
avaliação ganha um modelo seu e espera a sua aprovação.

O motivo aparece no alto de Avaliações até você ligar de novo. Para voltar
a publicar sozinha, escolha a opção outra vez em Ajustes › Como responder
(senha e alerta de novo).

### A conferência de toda resposta

Rascunho da IA, modelo seu ou texto que você escreveu: toda resposta passa por
uma conferência fixa, sem IA, antes de ir para o Google. Ela recusa:

- menos de 40 ou mais de 600 caracteres;
- idioma diferente do da avaliação;
- números, links, e-mails, `@` ou `#`;
- formatação, marcação ou mais de um emoji;
- nomes de pessoas, fora o primeiro nome de quem avaliou;
- cinco palavras seguidas copiadas da avaliação;
- promessas, preços, descontos, reembolso, assunto jurídico, saúde, dieta,
  tratamento, exames, e palavras como "IA", "sistema" ou "prompt", além das
  palavras que você proibir;
- caracteres invisíveis;
- falta da assinatura no fim.

O rascunho da IA ainda passa por uma segunda leitura, que vê só a resposta
(nunca a avaliação) e recusa tom irônico, defensivo ou estranho. Um rascunho
que falha volta como um dos seus modelos, se a avaliação for positiva, ou fica
sem rascunho, se for negativa.

### Desligar

- **Desligar avaliações** (em Ajustes › Conexão) apaga a cópia das avaliações, os rascunhos, o
  histórico e os avisos feitos a partir delas, e para a leitura. A conexão do
  Google continua.
- **Desconectar** o Google também apaga tudo isso, e os pedidos de
  avaliação.

No Google nada muda: as avaliações e as respostas publicadas continuam lá.

### Pedidos de avaliação

Todo dia, no horário de **Quando pedir** (09:00 se você não mudar), a Zuri
olha a agenda e monta a lista de quem teve consulta e ainda não avaliou. Na
primeira vez que você abre **Pedidos**, a lista sai na hora.

- Entra quem teve consulta numa agenda aberta para a Zuri, com o título do
  evento igual ao nome de um contato (só das etiquetas escolhidas em
  Contatos). Se dois contatos têm o mesmo nome, entra só quem tem algo dele no
  evento (telefone, e-mail, CPF ou nascimento). Na dúvida, ninguém.
- O pedido é para 8 dias depois da consulta (de 3 a 30). Sábado, domingo e
  feriado nacional passam para o próximo dia útil.
- Cada pessoa recebe um pedido na vida, mais um lembrete 7 dias depois, se
  ainda não avaliou. O lembrete pode ser desligado.
- Quem já tem avaliação ligada, ou uma avaliação esperando você confirmar,
  fica de fora.
- Em dia útil com alguém para hoje, um aviso diz quantos pedidos estão
  prontos.

A lista tem os grupos **Para enviar hoje**, **Agendados**, **Sem resposta**,
**Já avaliaram** e **Não recebem**. Na pessoa, **Enviar link de avaliação**
confere tudo de novo e abre o seu WhatsApp com a mensagem e um link só dela
(`zuri.exemplo.com.br/a/k7Q2mX9pAB`). Você confere e envia: a Zuri nunca
manda nada sozinha. Tocar de novo nos 10 minutos seguintes abre o mesmo link.

Quem toca no link vai direto para a página de avaliação do perfil no
Google, e a Zuri anota a primeira abertura. A prévia que o WhatsApp ou o
Telegram montam não conta. Um código vale 30 dias; depois disso o link ainda
leva ao Google, sem anotar nada. Código que não existe dá 404, sem dizer mais
nada. A rota não passa pelo Cloudflare Access, já que o paciente não entra
na Zuri.

Em **Ajustes › Pedidos e link**:

- **Link de avaliação**: vem do perfil do Google (`newReviewUri`), com a data
  em que foi lido; **Buscar no perfil** lê de novo. Você pode colar outro, que
  vence o do Google. Só entra `https` de `g.page`, `maps.app.goo.gl`,
  `search.google.com/local/…` ou `www.google.com/maps/…`, sem usuário nem
  porta. Trocar o link pede a senha digitada há pouco e gera um alerta de
  segurança.
- **Mensagem do pedido**: até 500 caracteres, com `{link}` e, se quiser,
  `{primeiro_nome}`.
- **Quando pedir**: os dias depois da consulta, o horário (06:00 a 21:00) e o
  lembrete.

#### Avaliação ligada ao contato

A Zuri liga cada avaliação a um contato pelo nome, para saber quem já
avaliou. O nome inteiro de quem avaliou não é guardado: só duas impressões
HMAC (do nome inteiro e do primeiro com o último).

- Nome inteiro igual ao de um contato só: liga sozinha. Na avaliação aberta,
  **Não é** desfaz.
- Nome igual ao de dois ou mais contatos (um título como "Dra." não conta), ou
  mais de 300 contatos com o mesmo primeiro nome: **nunca liga sozinha**. O cartão
  mostra cada um (final do telefone, e-mail escondido, se recebeu ou abriu o
  link) e espera **É esta** ou **Nenhuma das duas**.
- Só o primeiro e o último nome batem, ou não há nome e um único link foi
  aberto nas 48 horas antes: vira sugestão, com **É essa pessoa** e **Não é**.

A mensagem do pedido só aceita um endereço: o `{link}`. Um texto com `http`,
`www.` ou um domínio (`exemplo.com.br`) não é salvo.

A Visão geral mostra o funil dos pedidos (receberam, abriram e avaliaram)
depois do primeiro envio.

Desconectar o Google apaga os pedidos e os códigos já enviados (eles passam a
dar 404). Desligar só os contatos ou só as avaliações mantém os pedidos:
quem já recebeu o link não recebe de novo.

## Para quem instala

Antes do deploy, o dono confere no projeto do Google Cloud do cliente OAuth:

1. Em **APIs e serviços › Biblioteca**, ligue as três APIs do Perfil da
   Empresa (de graça): **My Business Account Management API**, **My Business
   Business Information API** e **Google My Business API**.
2. Peça o **Basic API Access** do Perfil da Empresa no formulário do Google
   (o projeto começa com cota zero). Enquanto o Google não aprovar, a tela
   mostra "O Google ainda não liberou o acesso" e a Zuri tenta de novo a cada
   6 horas, sem gastar nada.
3. Na tela de consentimento OAuth, acrescente o escopo
   `https://www.googleapis.com/auth/business.manage`.
4. A conta do Google conectada precisa ser proprietária ou administradora do
   perfil.

Os mesmos secrets da agenda servem (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `MCP_CREDENTIAL_KEY`). Nenhum recurso novo da
Cloudflare. O aviso de avaliação nova por Pub/Sub exigiria faturamento no
Google Cloud, então a Zuri lê de 10 em 10 minutos (ou no intervalo que você
escolher).

## Como funciona

- Código em `apps/agent/src/reviews/`: `triage.ts` (regras da nota e do
  texto), `guard.ts` (a conferência fixa), `responder.ts` (o agente de
  avaliações), `service.ts` (leitura, rascunhos, publicação) e `store.ts`
  (o que se apaga ao desligar). Rotas em `apps/agent/src/api/reviews.ts`.
- Conexão: a mesma de `GoogleCalendar` (`apps/agent/src/google/service.ts`),
  com `include_granted_scopes`. `business()` só chama as três APIs do Perfil
  da Empresa.
- Migration 26 (`google_reviews`): `zur_review_settings`, `zur_review_locations`,
  `zur_reviews` e `zur_review_events` (auditoria de 180 dias, só ações e códigos
  da conferência, nunca o texto).
- Migration 41 (`review_requests`, PR S20): o link do perfil e a leitura dos
  nomes em `zur_review_locations`, as impressões do nome em `zur_reviews`,
  `zur_review_matches` e `zur_review_match_candidates` (avaliação ↔ contato),
  `zur_review_requests` (um por pessoa, achada pelo `resourceName` do Google
  quando a cópia dos contatos é refeita), `zur_review_links` (código → pedido),
  as contagens de ligadas e de esperando em `zur_counts` (por gatilho) e a
  mensagem e "Quando pedir" em `zur_review_settings`. As aberturas por rede e
  por minuto ficam só na memória do objeto, nunca no banco. Código em
  `reviews/names.ts`, `matches.ts` e `requests.ts`; o portão de `/a/` em
  `gates/review-link.ts` e `index.ts`.
- Leitura: `orderBy=updateTime desc`, páginas de 50, até 3 páginas por
  leitura (o resto continua no despertar seguinte). Uma marca d'água guarda a
  hora da avaliação mais nova lida, e a leitura olha uma hora para trás dela,
  porque o Google pode listar uma avaliação um pouco depois.
- O agente de avaliações não tem ferramentas, histórico nem memórias. A
  avaliação entra num bloco `<data source="review">` neutralizado e o estilo
  do dono em `<data source="settings">`. A resposta dele é JSON validado por
  Zod; qualquer outra coisa conta como rascunho falho.
- Publicação: a avaliação fica em `sending` numa única instrução (duas abas
  não publicam duas vezes), já com o texto e o hash dele, é lida de novo no
  Google, o bloqueio e a pausa são conferidos de novo, e só então vai o
  `PUT …/reply`. Sem resposta do Google, ou com um `sending` parado há mais de
  5 minutos (o objeto reiniciou no meio), ela fica `uncertain` e a próxima
  leitura confere no Google antes de tudo. O hash diz o que é da Zuri.
- Contadores: o total e cada estado ficam em `zur_counts`, mantidos por
  gatilhos, então a aba e o `/status` não leem a tabela inteira.
- Avisos: categoria "system", sem prioridade que aprende. No Telegram, os
  tipos `reviews.*` vão para o tópico "Avaliações" do grupo; rascunho pronto,
  pico e problema de acesso vão só ao chat privado. No grupo o aviso é
  sempre discreto. O título nunca leva o nome nem o texto; o corpo, no app e
  no privado com o texto completo ligado, leva o primeiro nome e o texto numa
  linha só, que passam pelo `disarm()` do bot.
- No bloqueio nada lê o Google nem publica. Nada da avaliação (nome, texto,
  ids do Google) vai para o log: só contagens e nomes de erro.

### Números da visão geral

`GET /api/reviews/metrics?period=30d|6m|12m|24m|5y` devolve os números que a
tela **Avaliações › Visão geral** mostra. O código está em
`apps/agent/src/reviews/metrics.ts`.

| Campo | O que é |
| --- | --- |
| `period`, `from`, `unit` | O período pedido, o primeiro instante contado (uma meia-noite do dono, em UTC) e se os grupos são semanas (`week`), meses (`month`), semestres (`semester`) ou anos (`year`) |
| `ratings` | Quantas avaliações do período têm 5, 4, 3, 2 e 1 estrela, nessa ordem |
| `buckets` | Um item por semana, mês, semestre ou ano, do mais antigo ao mais novo, com `key` (a segunda-feira `2026-11-09`, o mês `2026-11`, o semestre `2026-S2` ou o ano `2026`), `promoters` (5 estrelas), `neutrals` (4), `detractors` (1 a 3) e `stars` (a soma das estrelas; dividida pelo total, dá a nota média do grupo). Grupo sem avaliação vem com zeros |
| `replied` | Avaliações do período com resposta no Google, de quem for |
| `medianReplyMinutes` | Metade das respostas saiu em até esse tempo, em minutos. `null` quando a Zuri não sabe a hora de nenhuma |
| `requests` | O funil dos pedidos (enviados, abertos, avaliaram). `null` enquanto a Zuri não envia pedidos de avaliação |
| `partial` | `true` quando o período tem mais de 5.000 avaliações e só as mais novas foram contadas |

- **Períodos.** `30d` é hoje e os 29 dias antes, em semanas que começam na
  segunda-feira: são 5 semanas, ou 6 quando hoje é segunda, e a primeira e a
  última aparecem cortadas pelo período.
  `6m` e `12m` são o mês corrente e os 5 ou 11 anteriores. `24m` é o semestre
  corrente (janeiro a junho ou julho a dezembro) e os 3 anteriores. `5y` é o
  ano corrente e os 4 anteriores. O dia e o mês são os
  do fuso do dono, inclusive na troca de horário de verão. Sem `period`, vale
  `30d`; qualquer outro valor, parâmetro a mais ou `period` repetido dá 400
  `VALIDATION_FAILED`.
- **Índice de recomendação.** A rota manda as contagens; a conta é
  `recommendationIndex` de `packages/shared/src/reviews.ts`: % de 5 estrelas
  menos % de 1 a 3 estrelas, de −100 a 100, e `null` sem avaliações. É uma
  estimativa pelas estrelas, não o NPS de 0 a 10.
- **O que entra.** A avaliação conta pelo dia em que foi escrita no Google. As
  importadas como histórico entram; as removidas do Google e as sem estrelas
  não.
- **Tempo até responder.** A resposta publicada pela Zuri usa a hora da
  publicação. A resposta dada direto no Google usa a hora que o Google informa
  na primeira vez que a Zuri a vê; editar a resposta depois não muda essa hora,
  e apagar a resposta tira a avaliação da conta. Respostas que a Zuri copiou
  antes da PR S11 contam em `replied`, mas ficam fora do tempo, porque a hora
  delas não foi guardada.
- **Só números.** Nenhum nome, texto ou id de avaliação sai por essa rota, e
  ela não chama o Google: lê a cópia que a Zuri já tem. Com as avaliações
  desligadas, responde zeros.
- **Migration 35 (`review_metrics`).** Só o índice `zur_reviews_metrics`, pela
  data em que a avaliação foi escrita, com a nota, o estado, a hora da resposta
  e se há resposta. A leitura fica toda no índice e não abre a tabela.

## Limites e custo

| O quê | Limite |
| --- | --- |
| Perfis lidos | até 3 (até 20 listados) |
| Leitura | a cada 10 minutos por padrão (144 por dia; sem novidade, 3 linhas gravadas); o dono escolhe de 1 a 1.440 minutos (`PATCH /api/reviews/interval`, coluna `check_every_min`, migration 33; abaixo de 5, pago pela conta do dia `DAY_BUDGET`, 409 `error.syncSlotsLimit` quando não cabe); "Conferir agora" 1 por minuto |
| Falhas seguidas do Google | espera que dobra de 10 minutos até 6 horas; aviso na quarta |
| Chamadas ao Google por leitura | até 14 |
| Rascunhos com IA | 30 por dia e 1.000 Neurons por dia (dentro dos 9.000 do dono); 3 por despertar |
| Avisos por leitura | 3 avulsos, o resto num aviso só |
| Aprovação | 72 horas, presa à versão vista |
| Publicadas sozinha (19d) | 3 por leitura e 10 por dia, 2 chamadas ao Google cada (releitura e resposta), sem IA a mais |
| Período de experiência (19d) | 10 aprovações sem edição entre as 30 últimas decisões |
| Resposta | 40 a 600 caracteres |
| Auditoria | 180 dias |
| Pedidos de avaliação | um por pessoa e um lembrete; a lista lê a agenda uma vez por dia, com até 12 chamadas ao Google |
| Link pessoal (`/a/<código>`) | 10 caracteres, 30 dias; 30 aberturas por minuto por rede e 300 no total (429), contadas na memória |
| Visão geral (`GET /api/reviews/metrics`) | 30 dias, 6 ou 12 meses, 2 anos por semestre ou 5 anos por ano; até 5.000 avaliações por período, as mais novas |

Medido no teste de orçamento (`apps/agent/test/free-tier-budget.test.ts`),
num perfil com 1.000 avaliações: uma leitura sem novidade faz 1 chamada ao
Google, lê cerca de 170 linhas e grava 5; uma leitura com 5 avaliações novas
grava cerca de 60 linhas. A visão geral lê uma linha do índice por avaliação
do período (59 linhas com 55 avaliações no período e 1.000 mais antigas na
cópia) e não grava nada. Nenhuma mudança no JavaScript da primeira tela: a
área de Avaliações e a seção de Integrações carregam sob demanda.

Pedidos (PR S20), no mesmo teste: a leitura dos nomes das avaliações antigas
pega carona na leitura, uma página a mais por vez até o fim do perfil (com
1.000 avaliações, cerca de 3 horas, uma vez só; cerca de 660 linhas gravadas
por página). Montar a lista de 300 pedidos faz 5 chamadas ao Google, grava
cerca de 1.800 linhas e lê cerca de 10.100, uma vez por dia. Um envio grava
até 12 linhas e uma abertura do link, até 10.
