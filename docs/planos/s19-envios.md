# Plano · S19 Envios: a fila do Chatwoot e CRM › Envios

- **Tipo:** etapa S19 do [plano do frontend Sinal](implementacao-frontend-sinal.md) (linha P22)
- **Pedido por:** Pablo (plano dos módulos, 10/11/2026; protótipo aprovado em 12/11/2026)
- **Situação:** em implementação

## 1. Resumo

A Zuri ganha a **fila de saída**: o único caminho de uma mensagem até um contato. As automações do CRM só gravam a intenção ("mandar este texto para esta pessoa, com esta chave"); quem envia é a fila, uma mensagem por vez, com a espera da credencial do Chatwoot entre uma e outra. Nada sai duas vezes: a chave é única, a reserva do horário é uma atualização condicional e um envio incerto é conferido na conversa antes de repetir. A parte **CRM › Envios** mostra a situação, o que espera, as regras de falha, o histórico e a linha do tempo de cada envio, com Pausar, Retomar e Tentar de novo.

## 2. Contexto no sistema

| Área | Onde | O que faz hoje |
| --- | --- | --- |
| Automações do CRM | `apps/agent/src/crm/automations/` (S18) | Runtime com `read` e `effect`; nenhuma automação real |
| Credencial do Chatwoot | `apps/agent/src/flows/connections.ts`, `flows/chatwoot.ts` (S17) | Endereço, conta, caixa, esperas em segundos (massa 30–60, uma pessoa 2–5), `fixed()` com prazo de 10 s |
| Alarme único | `agent/zuri-agent.ts` `runAutomations` | Fluxos, depois uma automação por despertar, no mesmo contador de subrequisições |
| Avisos | `alerts/service.ts` | Sino e Telegram |
| Tela | protótipo, CRM › Envios (`envios()`) | Situação, Na fila agora, Se algo der errado, Histórico com período, filtros e detalhe |

Planos de origem: [envios-monitoramento.md](envios-monitoramento.md), [modulos-crm.md](modulos-crm.md) (fila de saída, PR 3), [envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md).

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | A mesma chave nunca entra duas vezes na fila e nunca sai duas vezes | S19 |
| CA2 | Dois despertares juntos: só um ganha a reserva do horário livre (atualização condicional) | S19 |
| CA3 | Envio incerto (sem resposta, 5xx depois do POST) é conferido na conversa antes de repetir; achou, marca enviada | plano dos módulos |
| CA4 | Uma mensagem por vez por credencial, com a espera sorteada da credencial; erro também espera | plano dos módulos |
| CA5 | 3 tentativas (2 e 4 min); na terceira, "Falhou" e aviso | protótipo |
| CA6 | Duas mensagens diferentes seguidas com falha, chave recusada ou resposta fora do formato: a fila para, avisa no sino e no Telegram e só volta com "Retomar envios" | protótipo |
| CA7 | Lenta (média acima de 5 s nas últimas 5): a espera dobra e volta sozinha | protótipo |
| CA8 | Mensagem que perderia a hora não sai e aparece em "Não saíram" | protótipo |
| CA9 | Fila sem andar 15 min com mensagem devida: um aviso por ocorrência | protótipo |
| CA10 | Pausar segura tudo; bloqueio também; o despertar não roda a cada minuto enquanto isso | segurança |
| CA11 | Histórico por período (hoje, 7, 30 dias) e situação, 50 por página, contagens pelo resumo diário; sem texto e sem telefone na resposta | privacidade |
| CA12 | Pausar, retomar e tentar de novo no registro de segurança; retomar depois de parada por falha pede a senha recente | segurança |
| CA13 | No ensaio da automação, nada entra na fila (vira nota "faria") | S18 |
| CA14 | Tela Envios com as quatro situações, vazio, carregando, erro, teclado, leitor de tela, celular, escuro, axe; Credenciais com o resumo e "Abrir Envios" | protótipo |

## 4. Escopo

**Entra:** migration 40, `crm/outbox.ts`, chamadas fixas do Chatwoot (contato, conversa, mensagens), `ctx.send` no runtime das automações, rotas `/api/outbox`, avisos (parada, falhou, sem andar), parte Envios em `/crm/envios`, resumo da fila em Credenciais, base "Fila do Chatwoot" pronta em Automações, docs, testes.

**Fora (vai para quem usa):** webhook assinado do Chatwoot com "entregue" e "não quer receber" (S20, com o pedido de avaliação); "digitando"; adiar quando o paciente está conversando com a equipe (política de cada automação, S20 em diante); linha em Diagnóstico.

## 5. Como funciona para o Pablo

1. **CRM › Envios.** No topo: "Enviando", "Lenta", "Parada desde 10:04" ou "Pausada por você", com a última, a próxima e quantas esperam. Botões Pausar envios, Retomar envios e, na parada, Testar a credencial.
2. **Na fila agora:** quem recebe, a automação e a hora prevista. Confirmação passa na frente de pedido de avaliação.
3. **Histórico:** período e situação. "Ver" abre a linha do tempo. Envio com falha tem "Tentar de novo".
4. **Credenciais:** a linha do Chatwoot mostra quantas esperam e "Abrir Envios".

Textos em `packages/shared/i18n/pt-BR-outbox.ts` e `en`, sem citar infraestrutura, com o humanizer.

## 6. Regras de negócio e limites

`OUTBOX_LIMITS`: 3 tentativas (espera de 2 e 4 min); órfão "enviando" há 2 min vira "a conferir"; lenta acima de 5 s de média nas últimas 5; aviso de fila parada depois de 15 min; teto geral de 60 mensagens novas por dia; texto até 1.000 caracteres; telefone E.164; 50 linhas por página; histórico 180 dias, contagens por dia 400; texto e telefone apagados quando o envio termina (falha: 7 dias, para o "Tentar de novo").

Prioridade: confirmação, plano liberado, aniversário, pedido de avaliação, acompanhamento, recaptação, o resto.

## 7. Desenho técnico

### Rotas

| Rota | O que faz | Proteção |
| --- | --- | --- |
| `GET /api/outbox/status` | Situação, motivo, última, próxima, esperando, a fila de agora (até 20) | Sessão |
| `GET /api/outbox?period=&filter=&cursor=` | Histórico e contagens do período | Sessão |
| `GET /api/outbox/:id` | Linha do tempo | Sessão |
| `POST /api/outbox/pause` | Pausa | Sessão |
| `POST /api/outbox/resume` | Retoma; depois de parada por falha pede a senha recente | Sessão (+ senha) |
| `POST /api/outbox/:id/retry` | Falhou → volta à fila com a mesma chave | Sessão |

Fora de `WHILE_LOCKDOWN`: com o bloqueio nada sai, e a tela mostra "Pausada".

### Arquivos

`packages/shared/src/outbox.ts`, i18n; `apps/agent/src/crm/outbox.ts`, `flows/chatwoot.ts`, `crm/automations/{manifest,service,example}.ts`, `api/outbox.ts`, `agent/zuri-agent.ts`, `db/migrations.ts`; `apps/web/src/pages/crm/OutboxPart.tsx`, `CrmPage.tsx`, `App.tsx`, `FlowsPanel.tsx`.

### Banco

Migration 40 `outbox`, só acréscimo: `zur_outbox` (chave única por automação, texto e telefone só enquanto precisa), `zur_outbox_steps` (linha do tempo, sem texto), `zur_outbox_queues` (por credencial: próximo envio livre, parada, últimas medidas), `zur_outbox_state` (pausa), `zur_outbox_days` (contagens). Gatilhos da área `crm` só na situação. Fora do backup.

### Envio, passo a passo (a cada despertar, depois das automações)

1. Bloqueio ou pausa: sai, e o despertar não volta antes do fim.
2. Órfão "enviando" há 2 min vira "a conferir"; vencidos viram "Não saiu".
3. Escolhe um envio devido da primeira credencial livre, por prioridade e hora.
4. Reserva: grava o próximo horário livre só se ainda for o lido (atualização condicional); depois marca o envio "enviando" só se ele ainda estiver na fila.
5. Acha o contato pelo telefone (com e sem o 9º dígito) ou cria; `crmBloqueado` no contato: não sai. Acha a conversa aberta na caixa ou cria.
6. "A conferir": lê as mensagens da conversa; o mesmo texto depois da reserva = enviada.
7. Envia. Erro antes do POST: tentativa falhou. Sem resposta ou 5xx no POST: "a conferir".

### Ferramentas, IA e integrações

Nenhuma ferramenta e nenhuma IA. Chamadas só pelos caminhos fixos do Chatwoot, pelo `fixed()` da S17, até 8 por despertar (6 chamadas e 2 de DNS).

## 8. Custo e cotas do plano Free

Nenhum recurso novo. Um envio custa até 8 subrequisições e cerca de 12 linhas escritas. Sem nada na fila, o despertar lê poucas linhas a mais. Medido em `free-tier-budget.test.ts`.

## 9. Segurança e privacidade

- Só caminhos fixos; a conta é a da credencial; resposta do Chatwoot validada por Zod.
- A IA não chega à fila: só o runtime das automações grava nela.
- Rotas sem texto e sem telefone; texto e telefone apagados ao terminar; fora do backup.
- Auditoria completa (S19 está na lista).

## 10. Testes

`apps/agent/test/outbox.test.ts` (chave única, reserva condicional com `Promise.all`, incerto, tentativas, disjuntor, lenta, vencida, pausa, bloqueio, sem andar, poda, 9º dígito, `crmBloqueado`), `outbox-routes.test.ts`, `crm-automations` (`ctx.send` no ensaio e de verdade), `migrations`, `free-tier-budget`; e2e `tests/e2e/crm-envios.spec.ts` com axe.

## 11. Entrega

Uma PR para a `develop`.

## 12. Riscos

- JS inicial com 12 B de folga: a parte nova fica no pedaço do CRM; o nome "envios" em `App.tsx` é o único acréscimo.
- Sem o webhook, "Entregue" fica em zero até a S20: a tela diz "Enviada", nunca promete entrega.

## 13. Suposições

- O disjuntor conta mensagens diferentes com falha em seguida, não as tentativas da mesma.

## 14. Entrevista com o Pablo

As três perguntas de [envios-monitoramento.md](envios-monitoramento.md) seguem a recomendação até o Pablo dizer outra coisa:

| Pergunta | Seguida |
| --- | --- |
| Retomar depois de parada por falha pede a senha? | Sim; pausar e retomar uma pausa sua não pedem |
| O que fazer com quem esperava durante a parada? | Ao retomar, sai o que ainda está na hora; o resto vai para "Não saíram" |
| "Lenta" dobra a espera sozinha? | Sim, e volta sozinha |
