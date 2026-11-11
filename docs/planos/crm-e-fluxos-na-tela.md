# Plano · Configurações do CRM e dos fluxos na tela

Situação: implementado. Decisão do Pablo em 11/11/2026 (seção 14): tudo ajustável pela interface, dentro da cota gratuita.
Origem: pedido do Pablo em 11/11/2026, 12:24 (horário de Brasília): "em todo workflow que tiver sincronização no CRM, preciso que haja o botão de configuração do tempo de sincronização no frontend, para que essa e demais configurações não fiquem limitadas ao código".
Dependências: PR #289 (intervalo das sincronizações do Google), já mesclada.

## 1. Resumo

O Pablo quer ajustar pela tela o que hoje está preso no código do CRM e dos fluxos. O levantamento mostrou que o tempo de cada fluxo já é dele (fica no editor do fluxo) e que o CRM não tem sincronização por tempo. Sobraram os valores fixos de uso e as proteções da cota. Todos vão para a tela, e a seção 6 traz a lógica que mantém cada ajuste dentro da cota gratuita. Só não vira configuração o que é limite da própria plataforma ou regra de segurança. Os módulos do CRM, que ainda são plano, ganham a regra de nascer com horário, janela, intervalo e teto ajustáveis.

## 2. Contexto no sistema

O que existe hoje, lido no código:

| O quê | Onde | Tempo | Na tela? |
| --- | --- | --- | --- |
| Fluxos (`apps/agent/src/flows/service.ts`) | CRM › Fluxos, editor | Gatilho por horário: intervalo de 15 min ou mais (60 com IA), diário, semanal, mensal | Já é do dono, fluxo a fluxo |
| Monitor de sites | Um fluxo como os outros | O intervalo do fluxo | Já é |
| CRM, clientes (`apps/agent/src/crm/service.ts`) | Contatos › Clientes | Sem leitura periódica: os clientes chegam por evento assinado do n8n (`apps/agent/src/crm/events.ts`) | Não se aplica |
| Contatos e avaliações do Google | Configurações › Integrações › Google | 1 a 1.440 min | Já é (PR #289); mínimo de 1 min nesta PR, decisão do Pablo de 11/11 16:44 UTC |
| Módulos do CRM (confirmação, pedido de avaliação, aniversário e outros) | `docs/planos/modulos-crm.md` | Janelas e tetos previstos como constantes | Ainda não existem |

Valores fixos no código, um a um:

| Valor | Constante | Na tela | Faixa |
| --- | --- | --- | --- |
| Hora do aviso de aniversários, 9 h | `REMINDER_TIME` em `crm/service.ts` | Sim | `00:00` a `23:59` |
| Avisos de cliente novo por dia, 20 | `CRM_LIMITS.newClientNoticesPerDay` | Sim | 1 a 20 |
| Eventos do n8n por hora, 300 | `CRM_LIMITS.eventsPerHour` | Sim | 10 a 300 |
| Eventos do n8n por dia, 1.000 | `CRM_LIMITS.eventsPerDay` | Sim | 50 a 1.000 |
| Intervalo mínimo dos fluxos, 15 min | `FLOW_LIMITS.minIntervalMinutes` | Sim | 5 a 60 |
| Intervalo mínimo com passo de IA, 60 min | `FLOW_LIMITS.aiMinIntervalMinutes` | Sim | 30 a 1.440 |
| Execuções de fluxos por dia, 500 | `FLOW_LIMITS.runsPerDay` | Sim | 10 a 500 |
| Chamadas por execução, 40 | `FLOW_LIMITS.callsPerRun` | Sim | 5 a 40 |
| Neurons dos fluxos por dia, 3.000 | `FLOW_LIMITS.neuronsPerDay` | Sim | 100 a 3.000 |
| Tentativas depois de falha passageira, 3 | `FLOW_LIMITS.attempts` | Sim | 1 a 3 |
| Falhas seguidas que desligam um fluxo, 5 | `FLOW_LIMITS.failuresToPause` | Sim | 2 a 10 |
| Subrequisições por despertar (20), 10 s e 256 KB por resposta, 20 fluxos, 10 sites | `FLOW_LIMITS` | Não | Limite da plataforma (50 subrequisições por requisição) dividido com agenda e contatos; tamanho do banco |
| Janela da assinatura dos eventos (5 min), memória de ids (7 dias), corpo de 16 KB | `CRM_LIMITS` | Não | Regra de segurança |
| Até 10 avisos de retorno por despertar, 5 nomes por aviso | `CRM_LIMITS` | Não | Tamanho da mensagem e teto de envios por despertar |

Decisões que valem: plano gratuito (regra 1), migrations só de acréscimo (regra 5), textos pelo catálogo (regra 6), intervalo das sincronizações (11/11/2026).

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | O dono salva a hora do aviso de aniversários (`HH:MM`); hora inválida, 400 e nada gravado | Pablo |
| CA2 | Um dia nunca tem dois avisos de aniversário, e nunca perde o dele por causa de uma troca de hora | plano |
| CA3 | O dono salva os avisos de cliente novo por dia, de 1 a 20; 0 e 21, 400 | Pablo |
| CA4 | O dono salva cada número dos fluxos e dos eventos dentro da faixa da tabela da seção 2; n−1 e n+1 de cada faixa, 400 e nada gravado | Pablo |
| CA5 | Nenhum ajuste passa da cota: o que gasta cota tem como máximo o valor fixo de antes; os fluxos ligados cabem em 2.000 horários por dia, e o que não cabe não liga (409) | Pablo |
| CA5b | Mudar um número não mexe no que já roda: fluxo ligado continua, fluxo falhando mantém a conta, e o novo mínimo vale ao salvar ou ligar | plano |
| CA6 | Salvar o mesmo valor não grava nada | Pablo (11/11, não regravar o que não mudou) |
| CA7 | Banco existente continua com os valores de antes depois da migration | regra 5 |
| CA8 | As tabelas recusam número fora da faixa mesmo gravado à mão | plano |
| CA9 | A hora e o número dos avisos vão no backup e voltam; backup antigo não mexe neles | plano |
| CA10 | Telas com campo, faixa, botão desligado quando nada mudou ou o valor é inválido, teclado e leitor de tela, pt-BR e en | padrões |
| CA11 | O plano dos módulos do CRM registra que horário, janela, intervalo e teto são ajustáveis na tela | Pablo |

## 4. Escopo

**Entra:** os onze valores, as telas, a conta de horários por dia, a migration 34, o backup, os testes, a documentação e a regra no plano dos módulos.

**Fica fora:**

- Limites da plataforma e regras de segurança da tabela acima → não são configuração.
- Os módulos do CRM → cada um na sua PR, pela ordem de `modulos-crm.md`, já com a regra nova.
- Configurações em cinco grupos (S16) e a tela própria do CRM (S15) → só mudam o lugar dos cartões.

## 5. Como funciona para o Pablo

### Fluxo 1 · Avisos do CRM

1. Contatos › Clientes, cartão **Avisos do CRM**. Embaixo das três chaves há dois campos: **Hora do aviso de aniversários** e **Avisos de cliente novo por dia** ("De 1 a 20. Passou disso, o cliente só aparece na lista.").
2. **Salvar avisos** fica desligado enquanto nada mudou ou o número está fora da faixa. Salvou: "Avisos salvos".
3. Mudou a hora depois do aviso do dia: vale a partir de amanhã. Mudou para uma hora que já passou, antes do aviso do dia: o de hoje sai na hora antiga.

### Fluxo 2 · Configurações dos fluxos

1. CRM › Fluxos, cartão **Configurações dos fluxos**, entre Conexões e Histórico: "Valem para todos os fluxos, e cada número tem uma faixa que cabe no plano gratuito. O horário de cada fluxo fica no próprio fluxo, em Editar."
2. Sete campos, cada um com a faixa embaixo ("De 5 a 60."), e **Salvar configurações**. Só o que mudou é enviado. Salvou: "Configurações salvas".
3. Embaixo: "Horários por dia dos fluxos ligados: 96 de 2000. Um fluxo que não couber nessa conta não liga."
4. No editor do fluxo, o campo "Minutos entre execuções" passa a seguir o mínimo escolhido ("No mínimo 5. Com um passo de IA, no mínimo 60.").
5. Ligar um fluxo que estoura a conta: "Os fluxos ligados passariam de 2000 horários por dia. Aumente o intervalo deste fluxo ou desligue outro."

### Fluxo 3 · Eventos do n8n

1. Contatos › Clientes, cartão dos eventos: **Eventos aceitos por hora** e **Eventos aceitos por dia**, com a faixa embaixo, e **Salvar limites**.
2. Hora maior que o dia: "O número de eventos por hora não pode passar o do dia."

Estados: os cartões aparecem com a lista (carregando, vazio e erro são os da tela, que não mudam). Celular: os dois campos empilham. Enter no campo salva.

### Textos visíveis

`web.crm.settings.birthdays`, `.newClients` (sem "às 9 h" e "até 20 por dia"), `.birthdayTime`, `.perDay`, `.perDayHint`, `.save`, `.saved`; `web.flows.settings.title`, `.body`, `.failures`, `.runs`, `.range`, `.save`, `.saved`; `web.flows.problem.runs_limit` e `notice.flow.paused.body` sem o número fixo. pt-BR e en.

## 6. Regras de negócio e limites

### A lógica da cota gratuita

O pedido do Pablo foi "tudo ajustável pela interface, porém dentro da cota gratuita". A cota que importa aqui é a do Durable Object no plano Free: 100.000 requisições, 100.000 linhas gravadas e 5 milhões de linhas lidas por dia, 50 subrequisições por requisição e 10.000 Neurons por dia (`docs/arquitetura/orcamento-free-tier.md`, com as fontes). Três regras fecham a conta:

1. **O que gasta cota só desce.** Execuções por dia, chamadas por execução, Neurons, tentativas e eventos do n8n têm como máximo o número que já era fixo e já estava no orçamento. O dono escolhe qualquer valor da faixa, e o pior caso continua sendo o de antes.
2. **Tempo menor é pago por uma conta de horários.** Baixar o intervalo mínimo de 15 para 5 minutos triplicaria os horários agendados se nada mais mudasse (20 fluxos a cada 5 minutos são 5.760 por dia, e cada horário grava linhas mesmo quando a execução é pulada pelo teto do dia). Por isso os fluxos ligados dividem **2.000 horários por dia**: um intervalo de N minutos ocupa ⌈1.440/N⌉, e um horário diário, semanal ou mensal ocupa 1. 2.000 cobre o pior caso de antes (20 fluxos × 96 = 1.920), então nada que já era permitido deixa de caber. Um fluxo a cada 5 minutos ocupa 288: cabem seis, ou um de 5 minutos e dezessete de 15. A conferência é feita ao ligar um fluxo ou ao mudar um fluxo ligado; o que não cabe responde 409 e fica como estava.
3. **O piso de 5 minutos é o ritmo do alarme.** As leituras do Google já acordam o objeto a cada 5 minutos; um fluxo nesse ritmo não cria despertar novo.

4. **Sincronização do Google a partir de 1 minuto, paga pela mesma conta.** O Pablo decidiu (11/11/2026, 16:44 UTC) que o mínimo das duas leituras do Google é 1 minuto. Uma leitura num despertar só dela grava perto de 19 linhas, e um horário de fluxo, 13 em média no pior dia. Por isso há uma conta única do dia (`DAY_BUDGET`): leitura pesa 3, horário de fluxo pesa 2, e o total é o que já existia, 2.000 × 2 + 576 × 3 = 5.728. Com os padrões (5 e 10 minutos) os fluxos continuam com os 2.000 horários. Contatos a cada minuto com avaliações a cada 10 deixam 488 horários para os fluxos. Um minuto numa leitura pede 4 ou mais na outra; as duas a cada minuto não cabem. O dia gasto só em leituras (1.909) grava cerca de 36.300 linhas, abaixo das 37.400 do pior dia de antes. A folga entre as duas leituras, que era fixa em 2 min 30 s, vira metade do intervalo dos contatos quando ele é menor que 5 minutos, para a conferência das avaliações ter sempre um despertar só dela.

Custo medido no teste de orçamento (`apps/agent/test/free-tier-budget.test.ts`): um horário executado grava 17 linhas e um pulado, 12 (o passo do fluxo soma o dele). O pior dia que as configurações permitem, 500 execuções e 1.500 horários pulados, grava cerca de 26.500 linhas, 27% das 100.000 do dia. Antes, com 1.920 horários, eram cerca de 25.500. A diferença de pôr o intervalo na mão do dono é de menos de 1.000 linhas por dia, e o teste falha se a conta passar de um terço da cota.

### Faixas

| Regra | Valor | No limite |
| --- | --- | --- |
| Hora do aviso | `00:00` a `23:59` | Outro formato: `VALIDATION_FAILED` |
| Avisos de cliente novo por dia | 1 a 20, padrão 20 | 0 ou 21: `VALIDATION_FAILED`; passou do número no dia, o cliente só aparece na lista |
| Eventos por hora / por dia | 10 a 300 / 50 a 1.000 | Fora da faixa ou hora maior que o dia: `VALIDATION_FAILED`; passou, 429 com `Retry-After` |
| Intervalo mínimo / com IA | 5 a 60 / 30 a 1.440 min | Fluxo abaixo do mínimo: `VALIDATION_FAILED` com `details.min`; com IA vale o maior dos dois |
| Horários por dia dos fluxos ligados | 2.000 | 2.001: `CONFLICT` (`error.flowSlotsLimit`) |
| Execuções por dia | 10 a 500, padrão 500 | Passou, a execução fica "pulada" com `runs_limit` |
| Chamadas por execução | 5 a 40 | Passou, a execução para com `calls_limit` |
| Neurons por dia | 100 a 3.000 | Passou, a execução é pulada com `ai_limit` |
| Tentativas | 1 a 3 | 1 é sem nova tentativa |
| Falhas seguidas até pausar | 2 a 10, padrão 5 | Chegou, o fluxo desliga e a Zuri avisa |
| Corpo das duas rotas | 1 KB | 400 |
| Um aviso de aniversários por dia | `reminded_day` guarda o dia do último | Troca de hora no mesmo dia começa amanhã |

Mudar um número nunca mexe no que já está rodando: fluxo ligado continua, fluxo pausado continua pausado, e uma execução em andamento termina o despertar com os números com que começou.

## 7. Desenho técnico

- `packages/shared`: `FlowSettings` (sete campos), `FLOW_SETTING_RANGES` (mínimo, máximo e padrão de cada um, a mesma tabela para o schema, o serviço e a tela), `flowSlotsPerDay`, `flowSettingsSchema`, `FlowList.settings` e `counts.slots`; `CrmSettings` com `birthdayTime`, `newClientNoticesPerDay`, `eventsPerHour` e `eventsPerDay`. O schema do fluxo passa a aceitar o piso absoluto (5 min, 30 com IA); o mínimo do dono é conferido no serviço, porque o schema não lê o banco.
- Migration 34 (`crm_flow_settings`): colunas `reminder_time`, `new_client_notices`, `events_per_hour`, `events_per_day` e `reminded_day` em `zur_crm_settings`; tabela `zur_flow_settings` de uma linha. Cada número tem CHECK com a faixa. Nenhuma coluna está nos gatilhos de área.
- `apps/agent/src/crm/service.ts`: `planReminder` usa a hora do dono e o dia do último aviso; `announceNew` usa o número do dono; `eventLimits` dá os tetos dos eventos a `crm/events.ts`.
- `apps/agent/src/flows/service.ts`: `settings()`, `updateSettings()`, `checkInterval()` (ao criar, mudar ou ligar) e a conta de horários em `update()`. `engine.ts` e `google-steps.ts` recebem `callsPerRun` e `attempts` por `deps.limits`.
- Rotas: `PATCH /api/crm/settings` aceita os campos novos; `PATCH /api/flows/settings` é nova, sem senha recente (todo número fica dentro da faixa e nenhum faz dado sair), fechada no modo de bloqueio como as outras.
- Backup: a hora e o número dos avisos entram como opcionais em `crm.settings`. Os tetos de eventos e as configurações dos fluxos não entram, como os próprios fluxos e a chave dos eventos.
- Telas: `apps/web/src/components/NumbersForm.tsx` (números com faixa, salva só o que mudou), usado em `FlowSettingsCard` (`FlowsPanel.tsx`) e no cartão de eventos; `NoticeTimes` em `ClientsPanel.tsx`; `FlowEditor.tsx` segue o mínimo do dono.

## 8. Custo e cotas do plano Free

Nenhum recurso novo. Salvar grava 1 a 3 linhas; salvar o mesmo valor, nenhuma. `settings()` dos fluxos lê uma linha por execução e por fim de execução (até 1.000 leituras a mais num dia de 500 execuções, 0,02% das 5 milhões de linhas lidas por dia). A lógica da seção 6 garante que nenhuma combinação de ajustes passa do pior caso que já estava no orçamento: os tetos só descem e os horários por dia ficam em 2.000.

## 9. Segurança e privacidade

As duas rotas ficam atrás da sessão, do CSRF e da origem do dono, com corpo de 1 KB e schema estrito. Nenhum campo novo aceita texto livre além da hora, conferida por expressão regular ancorada. Os CHECKs do banco repetem as faixas. Nenhuma ferramenta do agente, comando do bot ou token remoto alcança as rotas. Nada novo no log. Como as duas rotas não pedem senha, cada mudança grava no registro de atividade os nomes dos campos alterados (`flow.settings` e `crm.settings`, achado SEC-A1-01 da auditoria), nunca os valores.

## 10. Testes

Unidade (`packages/shared/test`): faixas dos schemas. Agente: `crm-service.test.ts` (hora escolhida, um aviso por dia, dia nunca perdido, mesmo valor sem gravação, hora inválida no banco, número do dono), `crm-events.test.ts` (tetos do dono, n−1 e n), `flows-service.test.ts` (mínimo do dono ao salvar e ao ligar, mínimo com IA, conta de 2.000 horários, chamadas, tentativas, Neurons, execuções do dia, falhas até pausar, mesmo valor, linha ausente), `crm-routes.test.ts`, `flows-routes.test.ts` (n−1 e n+1 de cada faixa, sem senha, 401, 423), `migrations.test.ts` (33 para 34, CHECKs, números de área parados), `backup.test.ts` (ida e volta, backup antigo, valores ruins), `free-tier-budget.test.ts` (custo de um horário). Cada regra nova foi provada quebrando o código e vendo o teste falhar. Navegador: `clientes.spec.ts` e `fluxos.spec.ts`, computador e celular, com axe.

## 11. Entrega

Uma PR para a `develop`, com changelog e capturas das duas telas.

## 12. Riscos

- Outra PR em paralelo usar a migration 34: quem mesclar depois renumera.
- `ClientsPanel.tsx` também é tocado pelas threads de Contatos: o trecho novo é um componente à parte, no fim do cartão.

## 13. Suposições

- "Sincronização no CRM" inclui os módulos planejados; por isso a regra entrou em `modulos-crm.md`.
- As configurações dos fluxos não precisam de senha recente, como os avisos do CRM.
- Subir o intervalo mínimo não desliga fluxos ligados: desligar sozinho seria uma surpresa maior do que deixar rodar o que o dono já tinha ligado.

## 14. Entrevista com o Pablo

| Data | Pergunta | Resposta |
| --- | --- | --- |
| 11/11/2026 | Quais ajustes vão para a tela: só os de uso, com as proteções fixas (recomendado); tudo, inclusive as proteções, em faixas seguras; ou só a regra para os módulos | "Coloque tudo ajustável pela interface, porém, os ajustes dentro da cota gratuita. Elabore a lógica para implementar isso." (12:42) |
