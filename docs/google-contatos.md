# Google Contatos

A partir da etapa 19b, a Zuri guarda uma cópia, só para leitura, dos seus
contatos do Google que estão nas etiquetas que você escolher. Ela usa essa
cópia para responder na conversa, para a tela **Contatos** e para avisar dos
aniversários e das datas especiais. Ela nunca muda um contato no Google e não
manda mensagem para ninguém. O plano está em `docs/planos/google-contatos.md`.

## Para o dono

### Ligar

1. Conecte o Google Agenda primeiro (veja [Google Agenda](google-agenda.md)).
   Os contatos usam a mesma conta.
2. No cartão **Google Agenda e Contatos**, em **Contatos**, toque em **Ligar
   contatos**. Se a última senha foi digitada há mais de 15 minutos, a Zuri
   pede de novo.
3. O Google mostra a permissão nova, "ver seus contatos". As permissões da
   agenda continuam como estavam.
4. Você volta para Integrações. A Zuri lê as suas etiquetas em instantes, ou
   na hora se você tocar em **Sincronizar agora**.

Se o Google não der a permissão dos contatos, nada é guardado e o cartão pede
para ligar de novo.

### Escolher as etiquetas

Nada é copiado antes de você marcar uma etiqueta. Só aparecem as etiquetas que
você criou no Google Contatos; os grupos do próprio Google ("Meus contatos",
"Com estrela") ficam de fora. Marque as etiquetas e toque em **Salvar
etiquetas**:

- Acrescentar uma etiqueta pede a senha digitada há pouco e faz a próxima
  sincronização ler a lista inteira de novo.
- Tirar uma etiqueta apaga na hora, da cópia, quem só estava nela.
- O teto é de 5.000 contatos copiados. Se as etiquetas passarem disso, a Zuri
  para e pede para você escolher menos.

### Sincronização

A cópia é atualizada a cada 5 minutos, e só com o que mudou desde a última vez
(o Google entrega só as diferenças). Você escolhe esse intervalo no campo
**Sincronizar a cada (minutos)**, de 1 a 1.440 (um dia); o cartão mostra a
hora da próxima leitura. Abaixo de 5 minutos, a leitura divide a conta do dia com a outra sincronização e com os fluxos ligados: as duas não cabem a cada minuto ao mesmo tempo (1 minuto numa pede 4 ou mais na outra), e a tela avisa quando o intervalo não cabe. **Sincronizar agora** faz a mesma coisa
na hora, no máximo uma vez por minuto. Uma mudança feita no Google pode levar
alguns minutos para chegar.

Uma leitura que não acha novidade não regrava contato nenhum e não faz a tela
recarregar: a Zuri guarda só a hora em que conferiu e a hora da próxima. Quando
o Google marca um contato como alterado por algo que a Zuri não guarda (a foto,
um grupo do próprio Google), ela compara o que veio com o que já tem, vê que é
igual e não regrava o contato. A
lista de etiquetas (nomes e contagens) vem do Google uma vez por hora, ao
salvar uma escolha e ao abrir a escolha de etiquetas. Um contato que entra numa
etiqueta criada há pouco faz a Zuri buscar a lista na mesma leitura.

Quando a Zuri passa a guardar um campo novo do Google, a leitura seguinte traz
todos os contatos de novo, uma única vez, em partes. Depois volta a ler só as
diferenças.

Quando o Google falha, a Zuri tenta de novo sozinha, com intervalos que
dobram de 5 minutos até 6 horas. Na quinta falha seguida (pouco mais de uma
hora), um aviso entra na central. Se a permissão for retirada, ou se a People API estiver desligada no
seu projeto do Google Cloud, o cartão diz o que fazer.

### Tela Contatos

No menu lateral (e na paleta Ctrl/⌘K), **Contatos** mostra a lista de um lado
e a ficha do outro. No celular, a ficha toma o lugar da lista e **Contatos**
volta.

- **Lista.** Em ordem de nome, separada por letra, de 50 em 50. Quem não tem
  nome no Google aparece pelo telefone, ou pelo e-mail, no grupo "#", no fim.
  A busca acha pelo nome, apelido, um pedaço do telefone (digitado de qualquer
  jeito, com ou sem DDD e +55) ou o e-mail.
- **Filtrar por etiqueta.** Abre a lista das etiquetas escolhidas, com busca e
  a contagem de cada uma. **Falta alguma? Escolher etiquetas** abre a mesma
  escolha de Configurações > Integrações, já com as etiquetas que o Google tem
  agora; salvar sincroniza na hora.
- **Sincronização.** A linha no alto diz quando foi a última conferência e
  conta o tempo até a próxima. **Sincronizar agora** vale uma vez por minuto.
- **Ficha.** Quatro atalhos: **Perguntar à Zuri** (abre a Conversa com a
  pergunta escrita; você envia), **Ligar**, **WhatsApp** e **E-mail**. O
  WhatsApp só aparece para celular do Brasil; telefone fixo mostra "Sem
  celular". Abaixo, **O que a Zuri sabe** traz até três memórias que citam o
  nome, e **Dados** mostra o que o Google tem, em grupos: nome, telefone,
  e-mail, endereço, aniversário, datas, relações, empresa, site, mensageiro,
  etiquetas, campos personalizados e observações. Os grupos sem nada aparecem
  numa linha só ("Vazio no Google: …"). **Abrir no Google Contatos** leva à
  ficha de lá, onde se muda qualquer coisa.

Cada lista guarda até 10 itens (20 nos campos personalizados) e a ficha diz
quantos o Google tem além disso. Site só vira link se for um endereço `http`
ou `https`. Nome, observações e campos do Google aparecem sempre como texto.

### Avisos

No cartão, em **Avisos**:

| Opção | O que faz |
| --- | --- |
| **Aniversários do dia** | Ligado por padrão. No horário escolhido, um aviso com quem faz aniversário hoje (até 20 nomes e "+N"). |
| **Datas especiais** | Desligado por padrão. Avisa das datas personalizadas dos contatos (por exemplo "Retorno"), no dia ou com até 30 dias de antecedência. |
| **Só datas com este rótulo** | Opcional. Com "Retorno", só as datas com esse rótulo entram no aviso. |
| **Horário dos avisos** | 08:00 por padrão, no seu fuso. |
| **Quando alguém entrar numa etiqueta** | Não fazer nada, me avisar (padrão) ou me avisar e criar uma tarefa para o dia seguinte às 9h. |

Quem faz aniversário em 29 de fevereiro aparece em 28 de fevereiro nos anos
que não são bissextos.

Os avisos saem do mesmo alarme das outras rotinas e não usam IA. Para algo
mais elaborado (uma mensagem sugerida, um resumo da semana), crie uma rotina
com IA em Automações: ela pode usar a ferramenta `search_contacts` com os
aniversários de hoje ou da semana.

### Na conversa e nas rotinas

Com os contatos ligados, a Zuri ganha duas ferramentas de leitura:

- `search_contacts`: busca por nome, apelido, telefone ou e-mail, numa
  etiqueta ou pelos aniversários de hoje ou da semana (até 10 resultados).
- `get_contact`: o contato inteiro, com endereços, sites, relações e nomes de
  usuário em aplicativos de conversa quando o Google tem.

As duas leem a cópia da Zuri, nunca o Google, e o que voltam entra no prompt
como dado (`<data source="contact">`): um nome ou uma observação escrita por
outra pessoa nunca vale como ordem. Nenhuma ferramenta muda contato, escolhe
etiqueta ou liga os contatos.

### Desligar

- **Desligar contatos** apaga a cópia inteira (contatos, etiquetas, datas) e
  os avisos feitos a partir dela, e para a sincronização. As tarefas criadas
  por "Me avisar e criar uma tarefa" ficam, porque são suas. A agenda continua conectada. A permissão de ler os
  contatos continua dada no Google, porque o Google só deixa retirar a
  conexão inteira; para retirar, desconecte o Google.
- **Desconectar** o Google retira a permissão no Google e também apaga a cópia
  dos contatos.

Os contatos continuam no Google em qualquer caso.

## Para quem instala

Nada novo além do cliente OAuth da Agenda:

1. No projeto do Google Cloud do cliente OAuth, em **APIs e serviços >
   Biblioteca**, ligue a **People API** (de graça).
2. Na tela de consentimento OAuth, acrescente o escopo
   `https://www.googleapis.com/auth/contacts.readonly`. Com o app "Em
   produção" sem verificação, o Google mostra o aviso de app não verificado,
   como na Agenda.

Os mesmos secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`MCP_CREDENTIAL_KEY`) servem para os dois.

## Como funciona

- Conexão: a mesma de `GoogleCalendar` (`apps/agent/src/google/service.ts`),
  com `include_granted_scopes=true` e o propósito `contacts` guardado no
  `state` pendente. A coluna `scopes` guarda o que o Google deu; os contatos só
  valem com `contacts.readonly` concedido. Os tokens seguem cifrados com o
  `MCP_CREDENTIAL_KEY`.
- Leitura: `GET people/me/connections` com `personFields` fixo, páginas de
  1.000, até 10 páginas por despertar, e `syncToken` para as diferenças. Token
  vencido (o Google guarda 7 dias, `EXPIRED_SYNC_TOKEN`) recomeça uma vez como
  leitura inteira. As etiquetas vêm de `GET contactGroups`, só
  `USER_CONTACT_GROUP`, uma vez por hora (`CONTACT_LIMITS.labelsEveryMs`).
- Intervalo: o do dono, na coluna `sync_every_min` de `zur_contact_sync`
  (migration 33; padrão 5, de `syncEveryMinMinutes` a `syncEveryMaxMinutes`
  em `CONTACT_LIMITS`), salvo por `PATCH /api/google/contacts/settings` com
  `syncEveryMinutes`. Trocar o intervalo move a próxima leitura para a última
  mais o intervalo novo, nunca para o passado; uma nova tentativa depois de
  falha mantém a hora dela, e a espera entre falhas continua dobrando a partir
  de 5 minutos, qualquer que seja o intervalo. Tudo pelo alarme único. A
  conferência das avaliações nunca divide o despertar com os contatos: se as
  duas vencem juntas, a das avaliações espera 2 min 30 s, ou metade do
  intervalo dos contatos quando ele é menor que 5 minutos (30 s com os
  contatos a cada minuto). Intervalo abaixo de 5 minutos é pago pela conta do
  dia (`DAY_BUDGET`, `apps/agent/src/db/day-slots.ts`): uma leitura pesa 3 e um
  horário de fluxo pesa 2, num total de 5.728; o que não cabe responde 409
  `error.syncSlotsLimit`. Intervalo guardado fora da faixa (linha danificada)
  vale o padrão, nunca o mínimo.
- Campos: `PERSON_FIELDS` e `FIELDS_VERSION` em
  `apps/agent/src/google/contacts.ts`. O `syncToken` do Google vale para um
  conjunto de campos e um contato que não mudou mantém o `etag`; por isso,
  quem acrescentar um campo sobe o `FIELDS_VERSION`, e a leitura seguinte é
  inteira. Ela regrava só o contato cujos dados guardados mudaram. O mesmo
  vale para um `etag` novo em qualquer leitura: nome, dados, chaves de busca
  e etiquetas são comparados com a cópia, e, se forem iguais, só o `etag` é
  gravado (uma linha, sem subir o número da tela). O custo é
  de uma vez: uma chamada ao Google a cada 1.000 contatos, até 10 por
  despertar, e perto de uma linha lida por contato.
- Sem etiqueta escolhida não há contato a ler: a Zuri só pede as etiquetas
  ao Google, uma vez por hora.
- Tela: `GET /api/google/contacts` devolve `nextSyncAt`, `lastResult`
  (`unchanged`, `changed` ou `failed`) e `refreshing` (leitura inteira em
  curso). `POST /api/google/contacts/sync` responde 429 `RATE_LIMITED` com
  `retryAfter` dentro do minuto. `POST /api/google/contacts/labels/refresh`
  traz as etiquetas do Google (a lista guardada serve por um minuto).
- Banco (migration 23): `zur_contact_labels`, `zur_contacts` (com o nome
  normalizado para a busca), `zur_contact_keys` (telefone canônico e e-mail,
  para a busca por pedaço), `zur_contact_memberships`, `zur_contact_dates`
  (mês-dia para os avisos) e `zur_contact_sync` (uma linha: estado, tokens de
  sincronização, escolhas dos avisos). Coluna `contacts` em
  `zur_area_versions`, para a tela atualizar sozinha. A migration 32 acrescenta
  a `zur_contact_sync` as colunas que uma leitura sem novidade grava
  (`checked_at`, `last_result`, `dirty`, `labels_read_at`, `synced_now_at`,
  `fields_version`): elas ficam fora dos gatilhos da área, então o número da
  tela só sobe quando um contato ou uma etiqueta muda.
- Uma sincronização por vez: trava no banco (`running_since`, 10 minutos) e,
  a cada `await`, a Zuri confere se a trava ainda é dela.
- Orçamento de chamadas ao Google por despertar: 14 na sincronização, dentro
  das 50 subrequisições do plano Free.
- Logs: só contagens e o motivo da falha (`contacts_synced`,
  `contacts_ignored`, `contacts_sync_failed`), nunca nome, telefone ou e-mail.
- Backup (etapa 23): as tabelas dos contatos ficam fora, porque a cópia se
  refaz sozinha a partir do Google.
- Modo de bloqueio: nada sai para o Google, a tela e as rotas respondem 423.

## Custo

Tudo de graça. A People API não cobra pela leitura. No plano Free da
Cloudflare (100.000 linhas gravadas por dia no banco do Durable Object):

- uma sincronização que não acha mudança (288 por dia, uma a cada 5 minutos)
  grava 3 linhas e lê umas 22, com 1 chamada ao Google: cerca de 900 linhas
  gravadas por dia, 0,9% da cota. Uma vez por hora ela também busca as
  etiquetas (1 chamada a mais);
- a primeira leitura grava cerca de 11 linhas por contato copiado (contato,
  telefones, e-mails, etiquetas, datas e índices), uma única vez: uns 5.500
  com 500 contatos e uns 55.000 no teto de 5.000. Acrescentar uma etiqueta
  repete a leitura inteira, então no teto evite trocar etiquetas várias vezes
  no mesmo dia;
- cada contato que muda no Google grava cerca de 13 linhas;
- a busca da tela e das ferramentas só lê o banco da Zuri. Uma busca que acha
  pouca coisa percorre a lista inteira (até 5.000 nomes, ou as chaves de
  telefone e e-mail), o que fica bem abaixo da cota de leitura diária. Os números medidos estão no teste
`apps/agent/test/free-tier-budget.test.ts` ("Google contacts").
