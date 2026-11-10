# Plano · Módulos do CRM a partir dos fluxos do n8n

Situação: esperando o Pablo (perguntas da seção 14). Nada aqui foi implementado.
Origem: pedido do Pablo em 10/11/2026, 01:23 ("verifique quais são viáveis, a ordem correta e as credenciais").
Dependências: plano da base dos módulos ([modulos.md](modulos.md)) e do envio pelo Chatwoot ([envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md)), os dois na PR #204; nova interface (casca e menu lateral "CRM").

## 1. Resumo

O CRM do consultório tem 33 fluxos no n8n (versão 29.0.0 do repositório de scripts do Pablo, pasta `CRM/`). Li o README, os 33 arquivos de fluxo, as regras de horário, o catálogo de credenciais e as regras de domínio em JavaScript. Comparei cada um com o que a `develop` da Zuri já faz.

O resultado: **7 fluxos já estão cobertos** pela Zuri, **10 viram módulos**, **8 são viáveis com adaptação** e **8 ficam fora**, quase todos porque só existem para cuidar do próprio n8n. Dos módulos que escrevem a pacientes, só o pedido de avaliação está liberado. Os outros (confirmação, aniversário, recaptação, plano liberado, acompanhamento, convite para o canal e "está a caminho?") precisam do "sim" do Pablo, um a um (seção 14).

A entrega fica em **13 PRs**, na ordem da seção 11. As duas primeiras são a base (já planejada na #204) e o conector do Chatwoot com a fila de envio. O pedido de avaliação é o primeiro módulo de verdade e vem logo depois. Nada liga sozinho: todo módulo nasce desligado, passa por um ensaio junto com o n8n e só depois é ligado pelo Pablo.

## 2. Contexto no sistema

### O que a Zuri já tem na develop

| Área | Onde | O que faz hoje |
| --- | --- | --- |
| Google Contatos | `apps/agent/src/google/contacts.ts`, `contacts-store.ts`, migration 23 | Cópia **só de leitura** das etiquetas escolhidas (Paciente e Prospect, por exemplo), com `syncToken`, `etag`, até 10 páginas por despertar e teto de 5.000. Lê nome, apelido, telefones, e-mails, aniversário, datas, empresa, etiquetas, campos personalizados e observações. Telefone em E.164 por `phoneKey` |
| Google Agenda | `apps/agent/src/google/service.ts`, `events.ts`, migration 22 | Leitura em tempo real e criação de evento nos fluxos (22c) |
| Avaliações do Google | `apps/agent/src/reviews/` (`service.ts`, `triage.ts`, `guard.ts`, `responder.ts`), migrations 26 e 27, `docs/avaliacoes-google.md` | Leitura a cada 15 min, agente de avaliações sem ferramentas, guardrails, rascunho com aprovação, automático só nas positivas depois de 10 aprovações, aviso das negativas no tópico "Avaliações" do Telegram |
| Guardrails de IA | migration 30, `docs/planos/guardrails-multiagentes-ia.md` | Regras fixas mais uma segunda leitura por IA, prompt em duas camadas |
| Fluxos | `apps/agent/src/flows/` (`engine.ts`, `connections.ts`, `google-steps.ts`), migration 24 | Catálogo fechado de passos (`FLOW_NODE_TYPES` em `packages/shared/src/flows.ts`), conexões https cifradas (`flows-v1`), só POST, PUT e PATCH |
| CRM interno | `apps/agent/src/crm/`, migration 25 | Eventos do n8n em `/api/crm/events/:key`, assinados com HMAC |
| Alarme e orçamento | `apps/agent/src/agent/wake-budget.ts` | Um alarme só; 44 subrequisições por despertar, num contador único (#159) |
| Telegram | `apps/agent/src/telegram/` | Bot de administração, avisos por tópico no grupo da equipe, aprovações com botão (etapa 16) |
| E-mail ao dono | `apps/agent/src/email/sender.ts` | Envio pelo binding `SEND_EMAIL` do Email Routing, só para o endereço do dono |
| Backup | `apps/agent/src/backup/`, binding R2 | Backup automático (etapa 23); credenciais e cópias de contatos ficam fora |
| Migrations | `apps/agent/src/db/migrations.ts` | Última: 31 (`message_local_only`). **Próxima livre: 32** |

Não existe na develop: calendário de feriados, fila de mensagens a contatos, conector do Chatwoot, recebimento de e-mail (`email()` no Worker) e escrita no Google Contatos.

### Decisões que valem aqui

- 02/11: Google Contatos **só leitura**; a Zuri nunca altera contatos no Google.
- 02/11: "CRM interno, atendimento no n8n". O atendimento por IA aos pacientes (a Athena) continua no n8n.
- 03/11: respostas às avaliações começam em "Perguntar sempre"; automático só nas positivas depois de 10 aprovações sem edição.
- 09/11, 19:34: exceção à regra "a Zuri não escreve a contatos", **só para o pedido de avaliação**, pelo Chatwoot self-hosted (última versão), caixa tipo API (WhatsApp não oficial, sem custo da Meta), 8 dias depois da consulta, só em dia útil, teto de 20 por dia, intervalo sorteado de 1 a 3 minutos. Parâmetros guardados uma vez em "Credenciais".
- 09/11, 20:02: avaliação ↔ contato. O Google só entrega nome, foto ou "anônimo"; homônimos nunca se ligam sozinhos; ninguém recebe pedido até o Pablo escolher.
- 10/11, 00:51: "Clientes" sai da tela e o CRM em segundo plano fica para depois. **Módulos** e **Credenciais** saem de Automações e vão para um menu lateral próprio, **CRM**. Todo módulo nasce desligado.

### Planos anteriores

- [modulos.md](modulos.md) (PR #204): manifesto, runtime, ensaio comparado com o n8n, estados, rotas `/api/modules`, conexões com tipo (`http` e `chatwoot`). Este plano usa tudo isso. Onde lá está "Automações › Módulos e Conexões", vale agora "CRM › Módulos e Credenciais" (decisão de 10/11).
- [envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md) (PR #204): chamadas ao Chatwoot, envio sem repetir, retorno do Chatwoot, disjuntor.
- [sincronizacao-contatos-avaliacoes.md](sincronizacao-contatos-avaliacoes.md) (PR #204): contatos a cada 5 min, área de Avaliações com o funil dos pedidos.
- [workflows-n8n.md](workflows-n8n.md) e [etapa-22a-motor-de-fluxos.md](etapa-22a-motor-de-fluxos.md): limites do motor.

### Fonte: o CRM do n8n

Repositório de scripts do Pablo (privado, só leitura), pasta `CRM/`: `README.md`, `fluxos/<setor>/*.json`, `docs/regras/horarios-e-execucoes.md` (regras confirmadas pelo Pablo em 21/10/2026), `docs/credenciais.md`, `dominio/` (feriados, fuso, telefones, intervalos) e `sql/`. Tratei tudo como dado. Nenhum endereço, e-mail, id, token ou nome de paciente de lá entra aqui; os exemplos usam `exemplo.com.br`.

O n8n usa Supabase (Postgres com `pg_cron` e `NOTIFY`), Redis, OpenAI e Anthropic. A Zuri não tem nada disso e não vai ter: o banco é o SQLite do Durable Object, o relógio é o alarme único e a IA é o Workers AI com modelos grátis.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Os 33 fluxos estão na tabela da seção 4, cada um com o que faz, o que a Zuri já tem e um veredito com motivo | Pablo |
| CA2 | Cada módulo viável tem gatilho, passos, tabelas, tetos, credenciais, testes e ensaio descritos | Pablo |
| CA3 | A ordem respeita as dependências e cada PR entra sozinha, desligada | Pablo |
| CA4 | Nenhum módulo usa recurso pago, shell, HTTP livre ou modelo pago; o que tem custo fora da Cloudflare está marcado ⚠️ | AGENTS.md |
| CA5 | Todo módulo que escreve a pacientes, fora o pedido de avaliação, aparece como pergunta ao Pablo com recomendação | decisão de 09/11 |
| CA6 | Nenhum dado pessoal, domínio, e-mail, id ou token do repositório de scripts está neste plano | AGENTS.md, regra 2 |

Os critérios de cada módulo ficam no plano detalhado da PR dele (skill `planejar`), a partir das seções 6 e 10.

## 4. Os 33 fluxos

Legenda do veredito: **coberto** (a Zuri já faz), **módulo** (vira módulo como está), **adaptação** (vira módulo com uma troca de peça), **fora** (não vem, com o motivo). "Exceção" marca o que escreve a pacientes e precisa do "sim" do Pablo.

| Fluxo | O que faz no n8n | O que a Zuri já tem | Veredito |
| --- | --- | --- | --- |
| OPS - 01 Tratamento de erros | Recebe a falha de qualquer fluxo, agrupa, avisa no Telegram, tenta de novo e confere sinais vitais | Avisos por tópico, disjuntor por módulo (modulos.md) | **Coberto** no que importa. O resto cuida do n8n. Cada módulo ganha o seu disjuntor e o seu "parou de bater o ponto" (seção 6) |
| OPS - 02 Backup dos fluxos | Grava os fluxos do n8n no GitHub e abre PR | O código dos módulos já está no repositório da Zuri; backup R2 dos dados | **Fora**: só existe para o n8n |
| OPS - 03 Restauração | Publica no n8n o backup ou os fluxos do repositório | Deploy pela `main` com aprovação (etapa 24) | **Fora**: só existe para o n8n |
| OPS - 33 Atualização dos nodes | Abre PR quando há node novo no n8n | Dependabot e CI da Zuri | **Fora**: só existe para o n8n |
| CFG - 04 Configuração inicial | Cria no Chatwoot atributos, etiquetas, times, webhook assinado e painel | — | **Adaptação** (dentro da PR 3): a Zuri não pede token de administrador. "Testar credencial" só lê e diz o que falta; o webhook e o atributo `crmBloqueado` são criados à mão pelo Pablo, com o passo a passo na tela |
| CTT - 05 Padronização | Corrige CPF, e-mail e telefone **no Google Contatos** | Cópia só de leitura | **Adaptação**: a Zuri não escreve no Google (decisão de 02/11). Vira uma lista "Contatos para corrigir" com o motivo e o link para abrir no Google. Escrever no Google é a pergunta P8 |
| CTT - 06 Google Contatos → banco | Espelho incremental com `syncToken`, 5 min no expediente | Cópia com `syncToken` e `etag`; 5 min no plano da #204 | **Coberto** |
| CTT - 07 Banco ↔ Chatwoot | Mantém o contato do Chatwoot igual ao do Google, com etiqueta, time e prioridade pelo papel, e espelha o `crmBloqueado` | — | **Módulo** (PR 10). Escreve no Chatwoot do Pablo, não em pacientes. Rótulo nativo do WhatsApp pela fzap fica fora |
| MSG - 08 Fila de envio | Fila única com janela por tipo, intervalo, tentativas, feriados e conversa em andamento | — | **Adaptação** (PR 3): vira a fila de saída da Zuri, no SQLite e no alarme único |
| MSG - 09 Envio pelo Chatwoot | Único ponto de envio: acha contato e conversa, confere conversa em andamento, mostra "digitando", envia com id do job | — | **Adaptação** (PR 3): vira o cliente fixo `conn/chatwoot.ts` |
| IA - 10 Guardrails | Regras fixas mais revisor por IA, falha fechada | Guardrails da migration 30 | **Coberto**. Os posts (PR 11) usam os mesmos |
| IA - 11 Aprovação humana | Aprovado ou Reprovado por e-mail e Telegram, primeira decisão vale | Aprovações na tela e no Telegram (etapa 16) | **Coberto** |
| AGE - 12 Agenda do dia | Espelha a agenda de hoje e identifica o paciente de cada evento | Agenda em tempo real | **Coberto** na leitura. A **identificação do paciente** vira a PR 4 |
| ATD - 13 Confirmação | Confirma a consulta na véspera útil, 07:00 às 07:30 | — | **Módulo, exceção** (PR 7, pergunta P1) |
| ATD - 14 Aniversário | Parabéns no dia, 09:00 às 09:30, até 80 por dia | Aviso de aniversariantes ao dono | **Módulo, exceção** (PR 12, pergunta P4) |
| ATD - 15 Recaptação | Convida quem não volta há 30 ou 60 dias | — | **Módulo, exceção** (PR 12, pergunta P5) |
| PLA - 16 Captura do plano | Lê o e-mail do Webdiet por IMAP e registra o plano enviado | — | **Adaptação** (PR 8): a Zuri não fala IMAP (seria conexão TCP livre). O e-mail é **encaminhado** a um endereço do domínio que o Email Routing entrega ao Worker. Pergunta P7 |
| PLA - 17 Aviso de plano liberado | Avisa o paciente com o link do plano | — | **Módulo, exceção** (PR 8, pergunta P2) |
| PLA - 18 Acompanhamento | Pergunta como está indo, 15 dias depois do plano | — | **Módulo, exceção** (PR 12, pergunta P6) |
| AVA - 19 Pedido de avaliação | Pede a avaliação 24 h depois do plano | — | **Módulo, aprovado** (PR 5), com a regra da Zuri: 8 dias depois da consulta |
| AVA - 20 Coleta | Traz as avaliações para o banco a cada 15 min | Leitura a cada 15 min (10 min no plano da #204) | **Coberto** |
| AVA - 21 Vínculo | Descobre de qual paciente é cada avaliação, pelo nome | — | **Módulo** (PR 6), com a regra de homônimos de 09/11 |
| AVA - 22 Resposta | Responde com texto humano, revisado e aprovado | Rascunho, guardrails, aprovação, automático nas positivas | **Coberto** |
| MKT - 23 Conteúdo do canal | Escreve o post diário do canal do WhatsApp | — | **Fora por ora**: o canal é publicado pela fzap, uma segunda API não oficial. Pergunta P9 |
| MKT - 24 Publicação no canal | Publica o post aprovado no canal pela fzap | — | **Fora por ora**, junto com o MKT - 23 |
| MKT - 25 Convite para o canal | Até 15 convites por dia, uma vez por pessoa | — | **Fora por ora**, junto com o canal; se vier, é exceção (pergunta P9) |
| MKT - 26 Posts do Google | 3 posts por semana com IA, guardrails e aprovação | Mesma conta e escopo `business.manage` das avaliações | **Módulo** (PR 11). Não escreve a pacientes; é texto público no perfil, como as respostas |
| MKT - 27 Publicação no Google | Publica o post aprovado e confere o estado | Idem | **Módulo** (PR 11), junto com o MKT - 26 |
| GES - 28 Painel do dia | Página da agenda de hoje dentro do Chatwoot, com "Chegou" e "Perguntar se está a caminho" | "Seu dia" no Início | **Fora** como painel da recepção: a Zuri é de um dono só, e abrir dados de pacientes para a equipe numa página dentro do Chatwoot é atendimento a terceiros. "Perguntar se está a caminho" é a pergunta P3 |
| GES - 29 Importação financeira | Importa a planilha do Webdiet sem nome nem CPF | — | **Adaptação** (PR 9b, depois): envio de CSV pela tela, com o mesmo cuidado de LGPD. Sem planilha .xlsx (biblioteca nova pesada) |
| GES - 30 Relatórios | Mensal, trimestral e anual por e-mail, pela agenda | E-mail ao dono | **Adaptação** (PR 9): relatório pelo e-mail que já existe, com as contas pela agenda e pelos preços cadastrados |
| GES - 31 Dashboard | Receita, agenda, custos de IA e mensagens | — | **Adaptação** (PR 9): uma aba "Resultados" em CRM, sem página fora da Zuri |
| GES - 32 Custos de IA | Lê a fatura da OpenAI e da Anthropic com chave de administrador | Medidor de Neurons; modelos pagos desligados | **Fora**: a Zuri só usa modelos grátis. Se o Pablo ligar os modelos pagos (21b), o consumo já aparece no medidor |

Contagem: **7 cobertos** (OPS - 01, CTT - 06, IA - 10, IA - 11, AGE - 12, AVA - 20, AVA - 22); **10 módulos**, 4 que não escrevem a pacientes (CTT - 07, AVA - 21, MKT - 26, MKT - 27) e 6 que escrevem: o AVA - 19, já aprovado, e 5 exceções (ATD - 13, ATD - 14, ATD - 15, PLA - 17, PLA - 18); **8 com adaptação** (CFG - 04, CTT - 05, MSG - 08, MSG - 09, PLA - 16, GES - 29, GES - 30, GES - 31); **8 fora** (OPS - 02, OPS - 03, OPS - 33, MKT - 23, MKT - 24, MKT - 25, GES - 28, GES - 32). Total: 33.

### Uma diferença de regra para registrar

No n8n, o pedido de avaliação nasce 24 h depois do **plano alimentar** (o PLA - 16 grava o pedido). Na Zuri, pela decisão de 09/11, nasce 8 dias depois da **consulta**, lida na agenda. Os dois caminhos convivem no ensaio: a comparação com o n8n vai mostrar diferenças de data, e isso é esperado. Quando o PLA - 16 vier (PR 8), a origem do pedido pode trocar para o plano, se o Pablo quiser. Até lá, vale a consulta.

## 5. Como funciona para o Pablo

### Onde fica

Menu lateral **CRM**, com duas partes:

- **Módulos**: a lista de módulos do código. Cada cartão mostra o nome, uma frase do que faz, o estado (Desligado, Em ensaio, Ligado, Pausado), o que falta para ligar ("Precisa da credencial do Chatwoot") e, se escreve a pacientes, o selo "Escreve a pacientes".
- **Credenciais**: as credenciais do Chatwoot (e as que vierem), cadastradas uma vez e escolhidas pelo nome em cada módulo. Mostra o final da chave e quem usa cada uma.

Os estados vazio, carregando e erro, o celular, o tema escuro, o teclado e o leitor de tela seguem a casca da nova interface. Cada tela é desenhada no plano da sua PR.

### Fluxo 1 · Cadastrar o Chatwoot (uma vez)

1. CRM › Credenciais › **Nova credencial** › Chatwoot.
2. Endereço https do Chatwoot, número da conta e a chave do agente "Zuri" (um agente criado no Chatwoot só com acesso à caixa do WhatsApp). Pede a senha se passou de 15 minutos.
3. **Testar**: a Zuri só lê. Mostra as caixas de entrada; o Pablo escolhe a do WhatsApp (tipo API).
4. A tela mostra o endereço do webhook da Zuri e pede para criá-lo no Chatwoot com os eventos `contact_updated`, `message_created` e `message_updated`. O segredo que o Chatwoot mostra ao criar o webhook é colado de volta na Zuri.
5. **Enviar teste para mim**: manda uma mensagem ao próprio número do Pablo, de ponta a ponta, antes de qualquer paciente.

### Fluxo 2 · Ligar um módulo

1. CRM › Módulos › **Ligar**.
2. Escolhe a credencial (por nome) e ajusta as opções do módulo dentro da faixa (limite por dia, horário, dias depois da consulta).
3. Começa **sempre em ensaio**: a Zuri faz as leituras de verdade e troca cada envio por uma anotação ("Enviaria a Ana S."). O n8n continua trabalhando e avisa a Zuri do que fez; a tela mostra "12 iguais, 1 só no n8n, 0 só na Zuri".
4. Com 3 dias úteis sem diferença, aparece **Ligar de verdade** (senha). A tela lembra de desligar o fluxo no n8n no mesmo dia.
5. **Pausar envios**, o modo de bloqueio e `/bloquear` no Telegram param tudo na hora.

### Fluxo 3 · Dia a dia de um módulo que envia

1. No horário, a Zuri monta a lista do dia. Em "Perguntar antes" (o padrão), chega o aviso "3 pedidos de avaliação prontos" na tela e no Telegram.
2. O Pablo tira quem quiser e aprova. A Zuri envia um por vez, no intervalo sorteado.
3. Cada linha mostra: na fila, enviado, adiado (com o motivo), falhou, não quer receber.
4. Quem precisa do Pablo (homônimo, sem telefone, nome que não bate) vai para **Precisa de você**, com o motivo, e não recebe nada.

### Textos visíveis

Os textos de cada tela entram no plano da PR dela, em pt-BR e en, no catálogo (`pt-BR-modulos.ts` e o `en`), passados pela `humanizer:humanizer`. As mensagens que vão aos pacientes são **modelos fixos** que o Pablo edita (com `{primeiro_nome}`, `{link}`, `{data}`, `{hora}`), nunca texto da IA, e dizem como parar de receber.

## 6. Regras de negócio e limites

### Regras comuns a todo módulo que envia

| Regra | Valor | No limite |
| --- | --- | --- |
| Quem pode receber | Contato da cópia do Google com a etiqueta do papel certo, com telefone celular válido, sem "não quer receber" na Zuri e sem `crmBloqueado` no Chatwoot | Fora disso, não entra na fila; vira linha "ignorado" com o motivo |
| `crmBloqueado` | Lido no contato do Chatwoot que a busca por telefone já devolve (sem chamada a mais), espelhado pelo webhook `contact_updated` e conferido de novo logo antes do envio | Bloqueado no meio do caminho: o envio é cancelado, sem gastar tentativa |
| "Não quer receber" | Resposta "sair", "parar", "não quero" numa conversa aberta por um módulo, ou marcação do Pablo | Vale para sempre e para todos os módulos; só o Pablo desfaz |
| Fuso | `America/Sao_Paulo` pelo `Intl` (o mesmo cuidado do `dominio/tempo/fuso.js`), nunca "−3 h" fixo | Se o horário de verão voltar, vale sozinho |
| Dia útil | Segunda a sexta, menos feriados nacionais calculados no código (Páscoa por Meeus/Jones/Butcher, de 1900 a 2199) e os "dias sem expediente" do Pablo | Carnaval e Corpus Christi só entram se o Pablo marcar |
| Janela | Própria de cada tipo (tabela abaixo). O fim é exclusivo: na janela 09:00 às 09:30, a última sai às 09:29 | O que não sair na janela vai para a próxima janela do mesmo tipo |
| Intervalo | Sorteado antes de cada envio, dentro da faixa do tipo | Uma mensagem por despertar do alarme |
| "Digitando" | Mostra "digitando" e espera o **maior** entre o intervalo e o tempo de digitação; os dois nunca se somam | Sem humanização, só o intervalo |
| Conversa em andamento | Se o paciente mandou mensagem hoje a qualquer caixa, o envio é adiado pela política do tipo, sem gastar tentativa | Confirmação espera 10 min e sai até o fim da janela |
| Tentativas | 3, com espera crescente (2, 4 e 8 min) | Na terceira falha: "falhou" e aviso no Telegram |
| Envio incerto | Erro de rede depois do POST: na próxima tentativa, a Zuri lê as mensagens da conversa e procura a marca do job (`content_attributes.zuriJobId`) antes de reenviar | Achou: marca enviado sem mandar de novo |
| Mesmo telefone em dois contatos | Dois contatos com o mesmo telefone (com ou sem o 9º dígito) recebem um envio só por tipo e por dia | — |
| Teto do dia por módulo | Cada módulo tem o seu (tabela abaixo) e todos somam no **teto geral de 60 mensagens por dia** | Passou: o resto fica para a próxima janela |
| Disjuntor | 2 falhas seguidas do Chatwoot, 401 ou 403, resposta fora do formato, 3 "não quero receber" no mesmo dia, teto batido | Pausa o módulo e avisa |
| Bloqueio | Modo de bloqueio ou `/bloquear` | Nada sai |
| Ponto | Cada módulo grava a última execução boa | Ligado e sem bater o ponto há 2 janelas: aviso no Telegram |

### Janelas, intervalos e tetos por tipo

Valores do n8n (`docs/regras/horarios-e-execucoes.md`, confirmados pelo Pablo em 21/10/2026), menos o pedido de avaliação, que segue a decisão de 09/11.

| Tipo | Dias | Janela | Intervalo | Teto/dia | Feriado | Conversa em andamento |
| --- | --- | --- | --- | --- | --- | --- |
| Pedido de avaliação | seg a sex | 09:00 às 18:00 | 1 a 3 min | 20 | não sai | próximo dia útil |
| Confirmação | seg a sáb | 07:00 às 07:30 | 5 a 15 s no n8n; **na Zuri, 30 s a 1 min** (seção 13) | 30 | não sai; a véspera confirma até o próximo dia de envio | espera 10 min; a partir de 07:28 sai |
| Aniversário | todo dia | 09:00 às 09:30 | 30 s a 1 min | 20 | sai | próximo dia, só se ainda for o dia (senão expira) |
| Recaptação | seg a sex | 10:00 às 10:30 | 30 s a 1 min | 10 | não sai | próximo dia útil |
| Plano liberado | seg a sáb | 07:00 às 18:00 | 30 s a 1 min | 20 | sai | 10 min |
| Acompanhamento do plano | seg a sex | 14:00 às 14:30 | 30 s a 1 min | 10 | não sai | próximo dia útil |
| Convite para o canal | seg a sex | 11:00 às 11:30 | 30 s a 1 min | 15 | não sai | próximo dia útil |

Por que intervalos maiores que no n8n: na Zuri, cada envio é um despertar do alarme, e o alarme mínimo prático é de segundos, mas cada `setAlarm` conta uma escrita e cada envio gasta de 4 a 7 subrequisições. Com até 60 mensagens por dia, 30 s a 1 min ainda cabe nas janelas de 30 minutos (30 confirmações × 1 min = 30 min no pior caso, no limite exato da janela). Por isso o teto da confirmação é 30, não 50. Se o Pablo tiver mais de 30 consultas por dia de envio, o teto e o intervalo voltam para a pergunta.

### Chaves únicas (nunca enviar duas vezes)

| Tipo | Chave |
| --- | --- |
| Pedido de avaliação | `avaliacao:<contato>:<tentativa>` (tentativa 1 ou 2, o lembrete) |
| Confirmação | `confirmacao:<evento>:<data da consulta>` |
| Aniversário | `aniversario:<contato>:<ano>` |
| Recaptação | `recaptacao:<contato>:<id do último evento>` |
| Plano liberado | `plano:<contato>:<dia>` |
| Acompanhamento | `acompanhamento:<pedido>:<data do plano>` |
| Convite | `convite:<contato>` e o telefone, para nunca convidar a mesma pessoa duas vezes |

A chave é gravada como "pendente" antes do envio e como "feita" depois, numa transação. Duas abas, dois despertares ou um Worker que reinicia no meio não mandam de novo.

## 7. Desenho técnico

### Fronteiras

- **Base dos módulos** (`apps/agent/src/flows/modules/`): manifesto, registro, runtime, ensaio, estados, disjuntor (modulos.md).
- **Calendário** (`packages/shared/src/business-days.ts`): feriados, dias úteis, janelas e fuso. Puro, sem banco, testável fora do workerd.
- **Fila de saída** (`apps/agent/src/flows/modules/outbox.ts`): a única saída para pacientes. Os módulos só gravam a intenção; quem envia é a fila, como o MSG - 08.
- **Cliente do Chatwoot** (`apps/agent/src/flows/modules/conn/chatwoot.ts`): caminhos fixos, resposta validada com Zod, nada configurável.
- **Identidade do paciente** (`apps/agent/src/flows/modules/identity.ts`): de um evento da agenda ou de um e-mail para um contato da cópia, ou "precisa de você".
- **Módulos** (`apps/agent/src/flows/modules/<id>/manifest.ts` e `run.ts`): decidem quem recebe e o quê. Não chamam a rede diretamente.

Termos novos para `.claude/memoria/glossario.md`: módulo, ensaio, fila de saída, chave única, janela de envio, dia útil, "precisa de você", "não quer receber".

### Chamadas ao Chatwoot (lista fechada)

| Para quê | Chamada |
| --- | --- |
| Testar e listar caixas | `GET /api/v1/accounts/{conta}/inboxes` |
| Achar o contato pelo telefone (devolve `custom_attributes`, com o `crmBloqueado`) | `GET /api/v1/accounts/{conta}/contacts/search?q=<+55…>` |
| Criar o contato | `POST /api/v1/accounts/{conta}/contacts` |
| Atualizar o contato (só PR 10) | `PUT /api/v1/accounts/{conta}/contacts/{id}` |
| Etiquetas do contato (só PR 10) | `GET` e `POST /api/v1/accounts/{conta}/contacts/{id}/labels` |
| Conversas do contato | `GET /api/v1/accounts/{conta}/contacts/{id}/conversations` |
| Abrir conversa | `POST /api/v1/accounts/{conta}/conversations` |
| Ler mensagens (conversa em andamento e envio incerto) | `GET /api/v1/accounts/{conta}/conversations/{id}/messages` |
| Mostrar "digitando" | `POST /api/v1/accounts/{conta}/conversations/{id}/toggle_typing_status` |
| Enviar | `POST /api/v1/accounts/{conta}/conversations/{id}/messages` (`message_type: outgoing`, `private: false`, `content_attributes.zuriJobId`) |
| Time e prioridade da conversa (só PR 10) | `POST …/conversations/{id}/assignments` e `POST …/conversations/{id}/toggle_priority` |

Cada chamada é conferida com a versão do Chatwoot do Pablo no plano da PR 3, pela documentação oficial e pela skill `anthropic-skills:chatwoot-expert`. Nada de `DELETE`.

### Webhook do Chatwoot

Uma correção ao plano do envio: lá está "não achei assinatura dos webhooks". O CTT - 07 em produção confere `X-Chatwoot-Signature` = `sha256=` + hex(HMAC-SHA256(segredo, `X-Chatwoot-Timestamp` + "." + corpo cru)), com janela de 5 minutos e entrega única por `X-Chatwoot-Delivery`. A versão do Chatwoot do Pablo assina. A Zuri faz o mesmo:

- Rota `POST /api/chatwoot/events/:key`, com chave aleatória de 16 bytes no caminho, conferida no Worker antes do Access e do objeto, como `/api/crm/events/:key`.
- Assinatura em tempo constante, carimbo de ±5 min, `X-Chatwoot-Delivery` guardado 24 h contra repetição. Corpo até 64 KB.
- O segredo do webhook fica cifrado na credencial do Chatwoot (`chatwoot-v1`).
- Mesmo assinado, o evento é **sinal**, não ordem: a Zuri confere pela API antes de mudar estado de envio, e o texto do contato só entra como dado num aviso.

### Banco

Números na ordem de merge; o plano de cada PR confere o próximo livre na hora. Hoje é 32.

| Migration | PR | Tabelas e colunas |
| --- | --- | --- |
| 32 `modules` | 1 | `zur_modules`, `zur_module_runs`, `zur_module_effects`, `zur_module_compare`; `kind` e `meta` nas conexões; coluna `modules` em `zur_area_versions` (modulos.md) |
| 33 `business_days` | 2 | `zur_closed_days` (dia, motivo curto); preferências de pontos facultativos em `zur_settings` |
| 34 `outbox` | 3 | `zur_outbox` (chave única, tipo, contato, telefone E.164, texto já montado, janela, disponível em, tentativas, estado, ids do Chatwoot, último erro, motivo); `zur_contact_optout` (telefone, origem, data); `zur_chatwoot_deliveries` (id de entrega, data; poda em 24 h); contador `outbox_day` em `zur_counts` |
| 35 `patient_identity` | 4 | `zur_patient_links` (evento ou e-mail → contato, nível: exato, por dado, por nome; ou "precisa de você"); índice por evento |
| 36 `review_requests` | 5 | `zur_review_requests` (contato, consulta, estado, tentativa, chave, datas, id da conversa) e `zur_review_links` (código aleatório → pedido, primeiro clique) |
| 37 `review_match` | 6 | Colunas de vínculo em `zur_review_requests` e em `zur_reviews` (pedido ligado, nível, motivo) |
| seguintes | 7 em diante | Cada módulo acrescenta só o que precisa (por exemplo, `zur_diet_plans` na PR 8) |

Volume em 1 ano: até 60 linhas por dia na fila (cerca de 22.000 por ano), podadas em 180 dias; pedidos de avaliação, cerca de 5.000 por ano. A consulta mais cara é a reserva do lote da fila, por índice `(estado, disponivel_em)`, que lê só as linhas devidas.

Ficam **fora do backup**: credenciais, segredo do webhook, `zur_outbox` com texto, `zur_chatwoot_deliveries`. Entram: `zur_contact_optout` (é decisão de pessoas que não querem receber e precisa sobreviver a uma restauração) e os estados dos módulos.

### Ferramentas do agente

Nenhuma ferramenta nova. A conversa responde "o que está ligado" e "quantos pedidos saíram hoje" lendo o estado. Pedir "manda a confirmação para a Carla" vira proposta que abre a tela; a IA nunca envia, nunca escreve a mensagem a um paciente e nunca muda a fila.

### Agendamentos, IA e integrações externas

- Tudo no alarme único, depois das rotinas e dos fluxos, dividindo o contador de 44 subrequisições. A fila só agenda o próximo despertar quando há algo devido; fora das janelas, nenhum despertar a mais.
- IA só nos posts do Google (PR 11), pelo `agent.ai()` com modelo grátis e os guardrails da migration 30.
- Google: as permissões que já existem (`calendar`, `contacts.readonly`, `business.manage`). Nenhuma nova, a não ser que o Pablo diga sim à P8.

## 8. Custo e cotas do plano Free

Nenhum recurso novo da Cloudflare. O Email Routing (PR 8) já é usado pelo e-mail ao dono e é grátis.

| Recurso | Uso típico | Pior caso | Folga | Fonte |
| --- | --- | --- | --- | --- |
| Subrequisições por despertar | 4 a 7 por envio | 7 no envio + o que as outras áreas usaram, sempre dentro de 44 | O runtime confere o que sobra e deixa para o próximo despertar | `wake-budget.ts` |
| Subrequisições por dia (envios) | 20 × 6 = 120 | 60 × 7 = 420 | Muito abaixo das 100.000 requisições por dia | orçamento free tier |
| Espelho no Chatwoot (PR 10) | 0 a 10 contatos por dia × 2 a 7 | Carga inicial de 1.000 contatos ≈ 5.000 chamadas, em lotes de até 4 contatos por despertar (cerca de 250 despertares, um dia) | Cabe | idem |
| Linhas escritas | ~200 por dia | ~1.000 por dia | 1% de 100.000 | idem |
| Despertares do alarme | ~60 nas janelas | ~120 | cada `setAlarm` é uma escrita, já contada acima | P8 |
| Neurons | 0 (envios não usam IA) | Posts do Google: 3 por semana × até 2 versões × ~80 Neurons ≈ 70 por semana | Desprezível perto dos 9.000 por dia da Zuri | preço do `glm-4.7-flash` em `orcamento-free-tier.md` |
| JS inicial | 0 (telas lazy) | — | teto 141 kB aprovado em 10/11 | `performance.md` |

⚠️ Fora da Cloudflare: o Chatwoot com caixa de API e WhatsApp não oficial não cobra por mensagem (resposta de 09/11). O custo real é o **risco de bloqueio do número**, que cresce com cada tipo novo de mensagem. Por isso os tetos acima são menores que os do n8n e o teto geral é 60 por dia. A fzap (canal do WhatsApp) é outra API não oficial e fica fora por ora.

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Mensagem em massa por erro de código | Ensaio obrigatório, teto por módulo e teto geral de 60, chave única, disjuntor, "Pausar envios", bloqueio | Integração: lote de 61 envia 60; ensaio não chama nenhum efeito |
| IA escrevendo a paciente | Modelos fixos; a IA não toca na fila nem no texto | Segurança: nenhum caminho do `agent.ai()` chega a `outbox.ts` |
| Injeção por texto de fora (resposta do paciente, e-mail do Webdiet, nome no Google) | Tudo validado com Zod e tratado como dado; nomes limpos (só letras, até 20 caracteres no primeiro nome); nunca entra num prompt sem `<data>` | Unitário com nome malicioso, e-mail com HTML e resposta com instrução |
| Webhook falso do Chatwoot | HMAC com carimbo, entrega única, chave no caminho, corpo limitado; mesmo assim só sinal | Assinatura errada, carimbo velho, entrega repetida, corpo de 65 KB |
| E-mail falso fingindo ser do Webdiet (PR 8) | Aceita só o remetente configurado **e** SPF/DKIM aprovados no cabeçalho de autenticação do Email Routing; link só do domínio do portal do Webdiet, https; nunca segue o link | Remetente trocado, DKIM falho, link para outro domínio |
| Chave do Chatwoot vazada | Cifrada (`chatwoot-v1`), senha para criar e trocar, nunca volta ao navegador nem ao backup; agente "Zuri" no Chatwoot só com acesso à caixa do WhatsApp | Contrato: a resposta da API nunca traz a chave |
| Saída para onde não devia | Só o endereço da credencial, https público, sem redirecionamento, sem rede privada, só os caminhos da lista | Caminho fora da lista recusado; redirecionamento recusado |
| Homônimo recebendo mensagem de outro | Nome sozinho só liga quando é único entre os contatos com o papel; dois iguais vão para "precisa de você" | Unitário com dois "Ana Souza" |
| Dados de pacientes em log | Logs só com contagens e códigos; avisos com primeiro nome e inicial do sobrenome, nunca telefone, CPF ou texto de conversa | Teste de log em cada módulo |
| Link de avaliação rastreável | Código aleatório de 16 bytes, sem dado pessoal, só registra o primeiro clique e redireciona para o endereço fixo do perfil | Código inexistente dá 404 sem dizer por quê; limite de taxa |
| LGPD | Cada mensagem diz de quem é e como parar; "não quer receber" vale para sempre; mensagens de relacionamento só com o "sim" do Pablo, uma a uma | Revisão no plano de cada PR |

Auditoria **completa** (`cloudflare-security-audit:security-audit`) nas PRs 3, 5, 8 e 10, que abrem saída ou entrada nova; orientação nas outras. `docs/seguranca.md` relido em cada uma.

## 10. Testes

Camadas de `docs/qa/estrategia-de-testes.md`, em cada PR:

| O quê | Teste | Camada |
| --- | --- | --- |
| Feriados de 2026 a 2030 (Carnaval, Sexta-feira Santa, Corpus Christi móveis), dia sem expediente, véspera útil do sábado para a segunda | Tabela de casos | unitário |
| Janela com fim exclusivo (09:29 sai, 09:30 não), virada do dia, horário de verão simulado | Relógio falso | unitário |
| Chave única com duas abas, dois despertares e queda entre envio e resposta | Chatwoot falso | integração (workerd) |
| Teto n−1, n, n+1 por módulo e geral | Lotes de 19, 20, 21 e 59, 60, 61 | integração |
| Conversa em andamento por tipo, incluindo o "sai às 07:28" da confirmação | Mensagem recebida hoje | integração |
| 401, 403, 429, 5xx, resposta fora do formato, timeout | Chatwoot falso | integração |
| Ensaio: nenhum efeito sai | Contagem de chamadas de efeito = 0 | segurança |
| Webhook: assinatura, carimbo, repetição, tamanho | — | segurança |
| Orçamento: subrequisições e linhas por despertar | `free-tier-budget.test.ts` | orçamento |
| Telas: ligar, testar, ensaio, ligar de verdade, pausar | — | e2e e axe |

Cada módulo usa dados de exemplo com `exemplo.com.br`, gravados a partir do comportamento do n8n e nunca de uma execução real com pacientes.

## 11. Entrega

Uma PR por linha, cada uma mesclável sozinha e entregue **desligada**. Toda PR passa por `planejar`, testes primeiro, `verificar`, `revisao-qa`, `auditoria-seguranca` e `preparar-pr`.

| PR | O que entra | Fluxos do n8n | Depende de | Precisa do Pablo |
| --- | --- | --- | --- | --- |
| 1 | **Base dos módulos**: manifesto, runtime, ensaio, comparação, estados, rotas, menu CRM com Módulos (vazio) e Credenciais | — | casca da nova interface | — |
| 2 | **Calendário**: feriados, dias úteis, dias sem expediente, janelas e fuso, com a tela de dias sem expediente | regras do MSG - 08 | 1 | Marcar dias sem expediente |
| 3 | **Chatwoot e fila de saída**: credencial com teste e "Enviar teste para mim", webhook assinado, `crmBloqueado` e "não quer receber", fila com janelas, intervalo, digitando, conversa em andamento, tentativas e envio incerto | CFG - 04, MSG - 08, MSG - 09 | 1, 2 | Credencial do Chatwoot e webhook |
| 4 | **Identidade do paciente**: evento da agenda → contato, com a lista "precisa de você" | regra do AGE - 12 e do ATD - 13 | 1 | — |
| 5 | **Pedido de avaliação** (aprovado): 8 dias depois da consulta, 20 por dia, 1 a 3 min, lembrete único, link próprio com o primeiro clique, "Perguntar antes" | AVA - 19 | 3, 4 | Link do perfil no Google |
| 6 | **Vínculo avaliação ↔ pedido**: nome exato e único liga; homônimo, parcial ou sem par vai para "precisa de você" | AVA - 21 | 5 | — |
| 7 | **Confirmação de consulta** | ATD - 13 | 3, 4 | **P1** |
| 8 | **Plano alimentar**: e-mail do Webdiet pelo Email Routing e aviso de plano liberado | PLA - 16, PLA - 17 | 3, 4 | **P2**, **P7** e a regra de encaminhamento |
| 9 | **Resultados**: relatório mensal, trimestral e anual por e-mail e aba "Resultados" em CRM, pela agenda e pelos preços cadastrados | GES - 30, GES - 31 | 4 | Preços por local |
| 9b | **Importação financeira** por CSV, sem nome nem CPF | GES - 29 | 9 | — |
| 10 | **Espelho no Chatwoot**: contato, etiqueta, time e prioridade pelo papel | CTT - 07 | 3 | Times e etiquetas no Chatwoot |
| 11 | **Posts do Google**: 3 por semana, IA grátis, guardrails, aprovação, publicação conferida | MKT - 26, MKT - 27 | 1 | — |
| 12 | **Relacionamento**: aniversário, recaptação, acompanhamento do plano (um módulo por tipo, mesma PR só se forem pequenos) | ATD - 14, ATD - 15, PLA - 18 | 3, 4 (e 8 para o acompanhamento) | **P4**, **P5**, **P6** |
| — | Contatos para corrigir (lista sem escrever no Google) | CTT - 05 | 1 | P8 só se quiser escrita |

Por que esta ordem:

- A fila (3) e a identidade (4) vêm antes de qualquer envio, porque todo módulo que escreve depende das duas.
- O pedido de avaliação (5) é o único já liberado e o que testa a fila de verdade, com volume baixo.
- O vínculo (6) só faz sentido depois que pedidos saem.
- A confirmação (7) e o plano liberado (8) são mensagens que o paciente espera; vêm antes das de relacionamento (12), que aumentam o risco de bloqueio.
- O espelho no Chatwoot (10) não é pré-requisito do envio (a fila acha ou cria o contato sozinha) e é o módulo com mais chamadas; fica depois que a fila estiver estável.

### Lógica passo a passo dos módulos que enviam

**Fila de saída (PR 3), a cada despertar:**

1. Bloqueio ligado, módulo pausado ou disjuntor aberto: sai.
2. Pega a trava da fila (linha com dono e validade de 2 min). Outra execução segurando: sai.
3. Recupera órfãos: "enviando" há mais de 2 min vira "a conferir".
4. Expira vencidos (aniversário de ontem, confirmação depois da consulta).
5. Escolhe **um** job devido cuja janela está aberta agora, por prioridade e `disponivel_em`.
6. Confere de novo: "não quer receber", contato ainda com a etiqueta, teto do dia, dia útil.
7. Busca o contato pelo telefone (com e sem o 9º dígito). Acha: lê o `crmBloqueado`. Não acha: cria.
8. Acha a conversa aberta na caixa do WhatsApp ou cria.
9. Lê as mensagens de hoje: paciente falou com a equipe → adia pela política do tipo. Job "a conferir" → procura o `zuriJobId`; achou, marca enviado.
10. Grava "enviando", mostra "digitando", espera o maior entre o intervalo e a digitação (no próximo despertar, não dentro dele), envia.
11. Sucesso: "enviado" e a chave "feita". Erro: tentativa +1 com espera crescente; erro depois do POST: "a conferir".
12. Solta a trava e agenda o próximo despertar só se houver job devido.

**Pedido de avaliação (PR 5), uma vez por dia útil às 09:00:**

1. Lê na agenda as consultas de 8 dias úteis atrás (a opção vai de 3 a 30).
2. Identifica o paciente de cada uma (PR 4). Sem identificação segura: "precisa de você".
3. Tira quem já avaliou, quem tem pedido aberto, quem tem "não quer receber" e quem já recebeu o pedido nesta rodada.
4. Monta o texto do modelo fixo com o primeiro nome e o link próprio.
5. Em "Perguntar antes", espera a aprovação; com a aprovação, grava na fila com a chave `avaliacao:<contato>:1`.
6. Lembrete: 7 dias úteis depois, se não avaliou e não abriu o link, chave `:2`. Nunca um terceiro.

**Confirmação (PR 7), seg a sáb às 07:00, se P1 = sim:**

1. Lê a agenda de amanhã até o próximo dia de envio (sábado confirma segunda; véspera de feriado confirma até o dia útil seguinte).
2. Identifica o paciente: `googleResourceName` nas propriedades privadas do evento; senão e-mail do convidado, CPF ou telefone na descrição, conferidos com o nome; senão o nome, só se único.
3. Evento que não é de paciente do cadastro (almoço, bloqueio) não conta.
4. Na hora do envio, relê o evento na agenda: cancelado ou movido não sai.

**Plano liberado (PR 8), se P2 e P7 = sim:**

1. O Webdiet manda o aviso para o e-mail do Pablo; uma regra de encaminhamento manda uma cópia para `planos@exemplo.com.br`, que o Email Routing entrega ao Worker.
2. A Zuri confere remetente, SPF e DKIM, extrai o e-mail do paciente, o primeiro nome e o link (só do domínio do portal, https).
3. Acha o contato pelo e-mail **e** o primeiro nome. Não achou: tenta de novo 3 vezes, de 2 em 2 horas, e depois avisa o Pablo só com a hora do e-mail.
4. Um aviso por paciente por dia; se já há um na fila, só troca o link.
5. O e-mail não é guardado. Fica só a data do plano, para o acompanhamento e, se o Pablo quiser, para a origem do pedido de avaliação.

**Vínculo avaliação ↔ pedido (PR 6), a cada avaliação nova:**

1. Normaliza o nome de quem avaliou (minúsculas, sem acento, espaços únicos).
2. Candidatos: pedidos enviados há até 60 dias, sem avaliação ligada, enviados antes da avaliação (folga de 5 min).
3. Um candidato com nome idêntico: liga e marca "avaliou".
4. Dois ou mais idênticos, só primeiro e último nome iguais, ou nenhum: "precisa de você", com iniciais e estrelas. Nunca liga sozinho.
5. Avaliação já ligada: ignora.

### Credenciais e configurações por módulo

Tudo guardado uma vez, cifrado, e reaproveitado pelo nome. Nada no repositório.

| Credencial ou configuração | Onde fica | Quem usa | Como o Pablo consegue |
| --- | --- | --- | --- |
| Chatwoot: endereço https, conta, caixa, chave do agente "Zuri" | CRM › Credenciais (`chatwoot-v1`) | PRs 3, 5, 7, 8, 10, 12 | Criar o agente "Zuri" no Chatwoot com acesso só à caixa do WhatsApp e copiar a chave do perfil dele |
| Segredo do webhook do Chatwoot | Na mesma credencial | PR 3 | Criar o webhook da conta com o endereço que a Zuri mostra; copiar o segredo |
| Atributo `crmBloqueado` no contato do Chatwoot | No Chatwoot | PR 3 | Já existe pelo CFG - 04; se não, criar como atributo de contato do tipo caixa de seleção |
| Google (Agenda, Contatos, Perfil da Empresa) | OAuth que já existe, tokens cifrados (`google-v1`) | PRs 4, 5, 6, 7, 9, 11 | Nada novo |
| Link de avaliação do perfil | Opção do módulo (não é segredo) | PR 5 | Perfil da Empresa › "Pedir avaliações" |
| Telegram | Bot e grupo que já existem | Avisos de todos | Nada novo |
| Encaminhamento do Webdiet | Regra no e-mail do Pablo e rota do Email Routing para o Worker | PR 8 | Passo a passo em `docs/instalacao-cloudflare.md` na PR 8 |
| Remetente do Webdiet | Opção do módulo | PR 8 | O endereço de onde chegam os avisos |
| Preços por local e despesas | CRM › Resultados | PR 9 | Digitar na tela |
| Times e etiquetas de papel | Opção do módulo | PR 10 | Os ids que o CFG - 04 já criou |
| `MCP_CREDENTIAL_KEY` | Worker secret que já existe | Cifra das credenciais | Nada novo |
| GitHub, IMAP, Redis, Supabase, OpenAI, Anthropic, fzap, n8n API | — | Ninguém | Não são usados pela Zuri |

### Ensaio obrigatório antes de ligar

Para cada módulo:

1. Ligar em ensaio. A Zuri roda no horário real e anota o que enviaria.
2. No fluxo correspondente do n8n, acrescentar no fim um nó que manda à Zuri, assinado, a chave do que o n8n fez (sem texto e sem telefone, só a chave e o tipo).
3. A tela compara por chave. Diferença abre o motivo.
4. 3 dias úteis sem diferença: "Ligar de verdade" (senha) e desligar o fluxo no n8n no mesmo dia. A chave única impede que um item já feito pelo n8n saia de novo.
5. O fluxo do n8n fica desligado, não apagado, por 30 dias.

Para o pedido de avaliação, a diferença de regra (8 dias da consulta contra 24 h do plano) faz o ensaio comparar só **quem** recebe numa janela de 10 dias, não o dia.

- **Capturas:** cada PR com tela gera as suas em `docs/capturas/pr/<assunto>/`. Esta PR não tem mudança visível.
- **Docs:** cada PR atualiza `docs/` e o README. Esta acrescenta só o plano.
- **Changelog:** esta PR não muda nada visível (rótulo `sem-changelog`); cada PR de módulo traz o seu fragmento.
- **Instalação:** nada novo nesta PR. A PR 3 acrescenta o passo do webhook do Chatwoot; a PR 8, o do Email Routing.
- **Portabilidade:** nenhum binding novo. O `email()` do Worker (PR 8) troca, fora da Cloudflare, por um encaminhamento para um endereço que a Zuri leia por API; anotar em `portabilidade-vps.md` na PR 8.

## 12. Riscos

| Risco | Chance | Impacto | O que fazemos |
| --- | --- | --- | --- |
| Bloqueio do número do WhatsApp | média | alto | Tetos menores que os do n8n, teto geral de 60, intervalos maiores, só quem já é paciente, relacionamento por último e com "sim" um a um |
| Paciente errado por homônimo | baixa | alto | Nome sozinho só quando único; o resto vai para "precisa de você" |
| Envio duplicado na troca n8n → Zuri | média | médio | Chave única; ensaio; o n8n desligado no mesmo dia |
| Mudança na API do Chatwoot (segue a última versão) | média | médio | Caminhos fixos, resposta validada, disjuntor na primeira resposta estranha |
| Janela curta demais para o volume (confirmação) | média | médio | Teto de 30 e intervalo de 30 s a 1 min; acima disso, pergunta ao Pablo |
| E-mail do Webdiet muda de formato | média | baixo | Extração testada com exemplos; falha vira aviso sem dado pessoal, e o plano não é perdido (o e-mail continua na caixa do Pablo) |
| Orçamento de subrequisições disputado no despertar | baixa | baixo | O runtime confere o que sobra e deixa para o próximo despertar |
| Chatwoot fora do ar | baixa | médio | Tenta de novo, pausa depois de 2 falhas e avisa |

## 13. Suposições

- O Chatwoot tem endereço https público e a mesma caixa de API que o consultório já usa.
- O volume é de consultório: até 30 consultas por dia de envio, algumas dezenas de mensagens por dia.
- A agenda do consultório é a mesma conta Google já ligada à Zuri.
- Os nomes no Google Contatos seguem a regra do n8n (o nome completo é o que o paciente usa para avaliar).
- Intervalos de 30 s a 1 min na Zuri, em vez dos 5 a 25 s do n8n: decisão técnica pelo custo do alarme e pelo risco de bloqueio. O Pablo pode pedir os do n8n; aí o teto da confirmação pode subir.
- O webhook do Chatwoot da versão do Pablo assina como o CTT - 07 confere hoje. Se a versão mudar a assinatura, a PR 3 trata.

## 14. Entrevista com o Pablo

Sem rodada ainda. As três primeiras perguntas (P1 a P3) vão na mensagem da thread; as outras ficam abertas, cada uma com a recomendação, e são feitas quando a PR do módulo chegar.

| Data | Pergunta | Resposta |
| --- | --- | --- |
| 10/11/2026 | P1 a P3 (abaixo) | aguardando |

### Perguntas abertas

Todas as que liberam mensagem a pacientes são exceção à regra de 02/11 e são decididas uma a uma (decisão de 09/11).

1. **P1 · Confirmação de consulta (ATD - 13).** Recomendação: **sim**, depois do pedido de avaliação estar ligado de verdade há 2 semanas. É uma mensagem que o paciente espera e reduz faltas. Teto de 30 por dia; acima disso, revemos o intervalo.
2. **P2 · Aviso de plano alimentar liberado (PLA - 17).** Recomendação: **sim**. O paciente está esperando o link. Depende da P7.
3. **P3 · "Perguntar se está a caminho" (GES - 28).** Recomendação: **não por ora**. Sem o painel da recepção, quem decide perguntar é o Pablo, e isso é atendimento em tempo real, que continua no n8n e no Chatwoot (decisão de 02/11).
4. **P4 · Aniversário (ATD - 14).** Recomendação: **sim, depois**, com teto de 20 por dia, só para quem tem a etiqueta de paciente, e só depois de 30 dias sem bloqueio com as mensagens anteriores.
5. **P5 · Recaptação de inativos (ATD - 15).** Recomendação: **sim, depois**, com teto de 10 por dia e as travas do n8n (agendamento futuro nunca recebe, nada acima de 365 dias, uma a cada 180 dias). É a mensagem com mais cara de propaganda; vem por último.
6. **P6 · Acompanhamento do plano (PLA - 18).** Recomendação: **sim, depois**, junto com a P5. Depende da PR 8 (data do plano).
7. **P7 · Encaminhar os e-mails do Webdiet para um endereço da Zuri.** Recomendação: **sim**. É grátis, não pede senha de e-mail e troca o IMAP (que a Zuri não pode usar sem abrir conexão livre). O Pablo cria a regra de encaminhamento uma vez.
8. **P8 · Escrever no Google Contatos para padronizar CPF, e-mail e telefone (CTT - 05).** Recomendação: **não**. Mantém a decisão de 02/11 (só leitura) e a permissão `contacts.readonly`. A Zuri mostra a lista "Contatos para corrigir" com o link de cada um, e a correção continua no Google ou no n8n.
9. **P9 · Canal do WhatsApp (MKT - 23, 24 e 25).** Recomendação: **fica no n8n por ora**. Precisa de uma segunda API não oficial (fzap), publica todo dia com IA e o convite escreve a pacientes. Revemos depois que os outros módulos estiverem estáveis.
