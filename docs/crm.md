# CRM interno

A Zuri guarda os seus clientes com a etapa do funil, etiquetas, anotações,
retorno e aniversário. Os clientes entram pela conversa com a Zuri. Ela não
manda mensagem a cliente nenhum.

A Zuri **não recebe eventos do n8n** nem de outro sistema no CRM (decisão do
Pablo de 11/11/2026). O que o n8n fazia vai sendo reescrito como
funcionalidade da própria Zuri. Clientes que chegaram por eventos antes dessa
data continuam guardados.

O plano técnico está em `docs/planos/etapa-22b-crm-interno.md`.

> **Tela em mudança.** A aba **Clientes** saiu de Contatos com o novo visual
> (o endereço antigo, `/contatos/clientes`, leva a Contatos). Até as telas
> próprias do CRM chegarem, os clientes são vistos e mudados pela conversa
> ("quem volta esta semana?", "anote no cadastro da Ana…"). O que esta página descreve da lista, do funil e de **Apagar cliente**
> vale para o servidor e volta à tela com o CRM novo. Os avisos do CRM
> ficam em **Configurações › Avisos**, no grupo **CRM**.

## Para o dono

### Clientes e funil

- **Novo cliente** cadastra nome, telefone, e-mail, aniversário (`AAAA-MM-DD`,
  ou `MM-DD` sem o ano), etapa, etiquetas separadas por vírgula, retorno e
  anotações.
- O funil começa com **Novo, Em conversa, Agendado, Cliente** e **Inativo**.
  **Editar funil** renomeia, reordena, acrescenta e tira etapas (de 2 a 12).
  Os clientes de uma etapa que você tirar vão para a primeira.
- Os botões do funil e dos retornos (atrasados, hoje, próximos 7 dias) filtram
  a lista. A busca acha por nome (sem acento), por qualquer pedaço do telefone
  ou pelo e-mail.
- Cada cliente guarda as 100 entradas mais novas do histórico: anotações,
  mudanças de etapa, etiquetas e retorno.
- Cabem 5.000 clientes, 200 etiquetas diferentes e 20 por cliente.
- **Apagar cliente** leva junto as anotações e o histórico, e não dá para
  desfazer. Só a tela apaga: a conversa nunca apaga um cliente.

### Avisos

Em **Configurações › Avisos**, no grupo **CRM**, você escolhe o que a Zuri
avisa, pelos canais da central de avisos:

- **Retorno**: na hora marcada. Até 10 avisos de uma vez; se vencerem mais, o
  resto vem num aviso só.
- **Aniversários**: na hora que você escolher em **Hora do aviso de
  aniversários** (9 h no seu fuso, se não mexer), com até 5 nomes por aviso.
  Quem faz aniversário em 29 de fevereiro é lembrado no dia 28 nos anos comuns.

Cada dia tem um aviso de aniversários só. Se você mudar a hora depois do aviso
do dia, a hora nova vale a partir de amanhã. Se mudar para uma hora que já
passou, antes do aviso do dia, o de hoje sai na hora antiga e a nova vale a
partir de amanhã.

### Na conversa

Peça, por exemplo, "quem tem retorno atrasado?", "como está o funil?" ou
"passa a Ana para Agendado e marca retorno na sexta". A Zuri:

- busca e mostra clientes, sem telefone e e-mail a menos que você peça;
- cadastra cliente e muda etapa, etiquetas, retorno e anotações **sem pedir
  confirmação** (decisão do Pablo de 03/11/2026);
- nunca apaga cliente, mexe no funil nem fala com cliente.

As rotinas leem o CRM (por exemplo, um resumo do funil toda segunda), mas não
mudam nada.

### Sugestões de fluxo

Quando você pede na conversa um fluxo ("me avisa se o site cair"), a Zuri
deixa uma **sugestão** em **CRM › Fluxos**, na seção **Sugestões da
Zuri**. Nada roda: você toca em **Revisar**, confere e salva com a sua senha.
O fluxo salvo começa **desligado**. Uma sugestão some em 7 dias se você não a
salvar, e cabem 5 de cada vez.

### Automações

**CRM › Automações** (o endereço `/crm`) lista as automações do consultório na
ordem em que chegam à Zuri, cada uma com o que faz e se escreve a contatos.
Elas vêm do código da Zuri, não de um editor: não há botão para criar. Em
cima fica a **Base**, o que todas usam (dias úteis e feriados, envio pelo
Chatwoot, contato de cada consulta), com o que já está pronto.

- **Avisar quando chegar**: o sino de uma automação que ainda não chegou
  manda um aviso quando ela estiver pronta para ligar.
- **Tudo chega desligado.** Para ligar, toque em **Ligar**, escolha a
  credencial (do tipo que ela pede), **Teste a credencial** e ajuste os
  limites. **Salvar e começar o ensaio** pede a sua senha.
- **Ensaio.** A automação roda no horário dela, mas não envia nada: só anota
  o que faria. Em **Acompanhar**, cada dia aparece com o que a Zuri faria;
  marque **Está certo** ou **Tem erro** (com o motivo).
- **Ligar de verdade** pede 3 dias úteis seguidos marcados como certos, ou que
  você marque "Ligar antes de conferir, assumindo o risco", e a sua senha.
- **Pausa sozinha** depois de duas falhas seguidas, quando a credencial é
  recusada ou apagada, ou quando o serviço responde algo fora do esperado.
  Você recebe um aviso. Uma automação que muda o que envia numa atualização
  volta ao ensaio e avisa. **Desligar** e o modo de bloqueio param tudo na hora.
- Cabem 10 automações ligadas (em ensaio, de verdade ou pausadas).

Cada automação declara no código os caminhos que chama, os limites por
execução e por dia e se escreve a contatos. A Zuri confere essa declaração
antes de rodar e recusa chamada fora dela. Nenhuma usa IA ainda.
A chave de cada efeito leva a data ou o id do evento (por exemplo, a
consulta), porque o registro do efeito some em 180 dias: uma chave sem data
poderia sair de novo depois disso.

No meio de uma execução, **Desligar** e o modo de bloqueio valem para o
próximo efeito: o que ainda não saiu não sai. Durante o bloqueio, o horário
de cada automação anda sozinho, sem rodar. Em fim de semana e feriado, uma
automação de dia útil dorme até as 00:01 do próximo dia útil. Só dá para
conferir um dia do ensaio que já terminou e em que ela rodou; um dia passado
sem conferir quebra a sequência. A credencial e os limites só mudam com a
automação desligada. Se o que ela envia muda numa atualização durante o
ensaio, o ensaio recomeça. Uma automação cujo código saiu numa atualização
fica desligada.

### Envios

**CRM › Envios** (`/crm/envios`) é a fila de saída: o único caminho de uma
mensagem até um contato. A automação só grava a intenção ("mandar este texto
para esta pessoa, com esta chave"); quem envia é a fila, pelo Chatwoot, uma
mensagem por vez, com a espera sorteada da credencial entre uma e outra. No
ensaio nada entra na fila: a automação só anota o que faria.

- **Situação**, no topo: **Enviando**, **Lenta**, **Parada desde 10:04**,
  **Pausada por você** ou **Pausada pelo bloqueio**, com a última, a próxima e
  quantas esperam. **Pausar envios** e **Retomar envios** valem na hora.
  Depois de uma parada por falha, **Retomar envios** pede a sua senha e
  **Testar a credencial** confere a chave antes.
- **Na fila agora**: quem recebe, de qual automação e a hora prevista.
  Confirmação de consulta passa na frente de pedido de avaliação (a ordem:
  confirmação, plano liberado, aniversário, pedido de avaliação,
  acompanhamento, recaptação).
- **Histórico** de hoje, 7 ou 30 dias, por situação, 50 por vez. **Ver** abre
  a linha do tempo do envio; um envio que falhou tem **Tentar de novo** (até 7
  dias, com a mesma chave).
- Em **Credenciais**, a linha do Chatwoot mostra quantas esperam e leva a
  **Abrir Envios**.

Nada sai duas vezes. A chave de cada mensagem é única por automação; a vez
de cada credencial é reservada com uma atualização condicional (só um
despertar ganha o horário livre) e o envio só passa a "enviando" se ainda
estava na fila. Quando o Chatwoot não responde depois do envio (sem resposta
ou erro 5xx), a Zuri lê a conversa antes de repetir: se a mesma mensagem já
está lá, marca como enviada.

Quando algo dá errado:

- Uma mensagem que falha é tentada mais duas vezes, 2 e 4 minutos depois. Na
  terceira falha fica **Falhou** e você recebe um aviso.
- Duas mensagens diferentes seguidas com falha, a chave recusada ou uma
  resposta fora do formato param a fila. O aviso vai para o sino e para o
  Telegram, e a fila só volta com **Retomar envios**.
- Com o Chatwoot lento (média acima de 5 s nas últimas 5 respostas) a espera
  dobra e volta ao normal sozinha.
- A mensagem que perderia a hora não sai e aparece em **Não saíram**.
- Fila sem andar por 15 minutos com mensagem na hora: um aviso por ocorrência.
- Contato marcado como bloqueado no Chatwoot (`crmBloqueado`) não recebe. A
  Zuri procura o contato de novo a cada tentativa, então vale mesmo se a
  marca entrou entre uma tentativa e outra.
- Uma mensagem sem hora-limite própria espera no máximo 7 dias. Depois vira
  "Não saiu" e perde o texto e o telefone, mesmo com a fila pausada ou parada.
- Automação pausada ou desligada segura o que já pôs na fila: só sai o que é
  de automação ligada de verdade. O resto espera e, passado o prazo, não sai.
- Um envio que pode ter chegado (sem resposta, erro 5xx ou objeto que parou
  no meio) é conferido na conversa em toda tentativa seguinte, inclusive
  depois de **Tentar de novo**, a partir da hora do primeiro envio.
- Teto geral de 60 mensagens novas por dia e de 1.000 caracteres por
  mensagem; telefone no formato internacional (com e sem o 9º dígito na
  busca do contato).

"Entregue" e "não quer receber" chegam com o webhook do Chatwoot, junto com o
pedido de avaliação: até lá, a tela diz "Enviada" e nunca promete entrega.

## Segurança e privacidade

- O CRM não tem porta para outros sistemas: só a sua sessão e a conversa
  gravam nele. O endereço `/api/crm/events/…` e a chave dos eventos deixaram
  de existir, e nenhum token de acesso remoto alcança `/api/crm`.
- O que está no cadastro e no histórico é dado, nunca instrução: entra no
  prompt só em `<data source="crm">`.
- Nome, telefone, e-mail, anotações e histórico dos clientes nunca vão para os
  logs, nem os de erro.
- Os avisos de retorno levam o nome do cliente e a nota do retorno. Se eles chegam por push no celular, podem aparecer na tela
  bloqueada: desligue esses avisos em **Configurações › Avisos** se os seus clientes
  forem dados sensíveis (por exemplo, de saúde).
- Depois que a conversa lê o CRM, nenhuma ferramenta de serviço externo (MCP)
  roda sem pedir, nem nas mensagens seguintes: um texto plantado por um
  estranho no histórico não manda os seus dados para fora sem você ver.
- A conversa recebe telefone e e-mail só quando você pede.

- Automações: só chamam os caminhos declarados, pela credencial escolhida,
  que nunca chega ao navegador. Cada efeito tem uma chave única, então nada é
  feito duas vezes. O que fica guardado são números e um rótulo curto, nunca
  a mensagem; as execuções somem em 90 dias e os efeitos em 180. As
  automações não entram no backup: depois de restaurar, tudo volta
  desligado.
- Envios: só os caminhos fixos do Chatwoot (contato, conversa, mensagens), na
  conta da credencial, com a resposta conferida. A IA não chega à fila: só o
  código das automações grava nela. O texto e o telefone ficam guardados só
  enquanto o envio precisa deles e somem quando ele termina (um envio que
  falhou guarda os dois por 7 dias, para o "Tentar de novo"). A tela e as
  rotas nunca mostram texto nem telefone. Pausar, retomar e tentar de novo
  ficam no registro de atividade. A fila não entra no backup.

## Custo no plano gratuito

A lista lê o funil e as etiquetas de contadores mantidos pelo banco, não dos
5.000 clientes; uma página da lista lê 50 clientes e as etiquetas deles. O alarme olha o próximo
retorno e o próximo aniversário por índice. Os números ficam conferidos em
`apps/agent/test/free-tier-budget.test.ts`.

As automações rodam no alarme único da Zuri, uma por vez, e o alarme lê só a
próxima pelo índice. Cada execução tem teto de chamadas e de efeitos, e o
teto de chamadas de cada despertar continua valendo.

A fila de envios também roda no alarme, depois das automações: um envio por
despertar, até 8 subrequisições (6 chamadas e 2 consultas de DNS) e 14 linhas
escritas (medidas). Sem lugar no despertar para as 8 chamadas, a fila não
reserva nada e espera o próximo. Pausada, parada ou vazia, ela não faz o alarme voltar a
cada minuto.

## Modelo de dados

Migration 39 (`crm_automations`):

| Tabela | O que guarda |
| --- | --- |
| `zur_crm_automations` | Uma linha por automação que você configurou: estado, opções, credencial, ensaio, aviso de chegada |
| `zur_crm_automation_runs` | Cada execução, só números (90 dias) |
| `zur_crm_automation_effects` | Cada efeito por chave única, com um rótulo curto (180 dias) |
| `zur_crm_automation_days` | A sua conferência de cada dia do ensaio |

Migration 40 (`outbox`):

| Tabela | O que guarda |
| --- | --- |
| `zur_outbox` | Cada mensagem por chave única da automação: situação, tentativas, horários; texto e telefone só enquanto o envio precisa (180 dias) |
| `zur_outbox_steps` | A linha do tempo de cada envio, sem texto |
| `zur_outbox_queues` | Por credencial: o próximo horário livre, a parada e as últimas medidas |
| `zur_outbox_state` | A pausa |
| `zur_outbox_days` | As contagens de cada dia (400 dias) |
