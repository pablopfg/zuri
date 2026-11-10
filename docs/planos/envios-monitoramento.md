# Plano · Envios: acompanhar a fila de mensagens a contatos

- **Tipo:** ajuste (parte da fila de saída, PR 3 do [plano dos módulos](https://github.com/pablopfg/zuri/pull/247))
- **Pedido por:** Pablo, em 10/11/2026
- **Situação:** rascunho, espera as respostas da seção 14

## 1. Resumo

A fila de envio deixa de ser um quadro dentro de Credenciais e ganha uma área própria, **CRM › Envios**. Ali o Pablo vê a situação de agora (enviando, lenta, parada ou pausada), o que espera na fila, o histórico por período e o que aconteceu com cada mensagem. A tela não envia nada: ela lê a fila de saída que o plano dos módulos já descreve e acrescenta o que falta para acompanhar, pausar, retomar e tentar de novo.

## 2. Contexto no sistema

| Área | Onde | O que faz hoje |
| --- | --- | --- |
| Fila de saída | plano dos módulos, PR 3 (`apps/agent/src/flows/modules/outbox.ts`, tabela `zur_outbox`) | Planejada, ainda sem código. Uma mensagem por vez, intervalo da credencial, 3 tentativas, envio incerto conferido antes de repetir, disjuntor |
| Chatwoot | [envio-chatwoot-pela-zuri.md](envio-chatwoot-pela-zuri.md) | Chamadas, retorno assinado (enviada, entregue, falhou), "não quero receber" |
| Avisos | `apps/agent/src/zuri-agent.ts` (notices) e bot do Telegram | Sino e Telegram já recebem avisos dos fluxos |
| Diagnóstico | Configurações › Diagnóstico | Mostra a saúde das integrações |
| Tela | protótipo, CRM › Envios | Situação, fila, regras de falha, histórico com filtro e detalhe de cada envio |

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Envios mostra a situação da fila e a hora da última e da próxima mensagem | Pablo |
| CA2 | O histórico filtra por período (hoje, 7 e 30 dias) e por situação, com contagem | Pablo |
| CA3 | Cada envio abre uma linha do tempo: fila, tentativas, entrega ou motivo da falha | Pablo |
| CA4 | Fila parada avisa no sino e no Telegram e só volta com "Retomar envios" | Pablo |
| CA5 | Chatwoot lento não gera envio em dobro nem duas mensagens ao mesmo tempo | segurança |
| CA6 | O histórico não guarda o texto da mensagem nem o telefone | privacidade |
| CA7 | Pausar e retomar ficam no registro de segurança | segurança |

## 4. Escopo

**Entra:** tela Envios, rotas de leitura, pausar, retomar e tentar de novo, situação "lenta", aviso de fila parada, linha em Diagnóstico, testes e documentação.

**Não entra:** a fila em si e o cliente do Chatwoot (PR 3 dos módulos), editar ou escrever mensagem pela tela, exportar o histórico.

## 5. Como funciona para o Pablo

1. **CRM › Envios.** No topo, a situação: "Enviando", "Lenta", "Parada desde 10:04" ou "Pausada por você", com a última, a próxima e quantas esperam.
2. **Na fila agora.** Quem recebe, qual automação e a hora prevista. Confirmação passa na frente de pedido de avaliação.
3. **Histórico.** Período e situação. Cada linha abre o que aconteceu, passo a passo. Envio com falha tem "Tentar de novo".
4. **Fila parada.** Chega aviso no sino e no Telegram com o motivo. Em Envios, "Testar a credencial" e "Retomar envios".
5. **Credenciais** fica só com um resumo da fila e o botão "Abrir Envios".

Textos no catálogo (`pt-BR-crm.ts` e `en`), sem citar infraestrutura, passados pela `humanizer:humanizer`.

## 6. Regras de negócio e limites

| Regra | Valor | No limite |
| --- | --- | --- |
| Tentativas por mensagem | 3, com espera crescente (plano dos módulos) | Na terceira: "Falhou", aviso e botão "Tentar de novo" |
| Envio incerto | Antes de repetir, a Zuri procura a marca do envio na conversa | Achou: marca como enviada, sem mandar de novo |
| Fila parada (disjuntor) | 2 mensagens seguidas com falha, chave recusada ou resposta fora do formato | Para, avisa e espera "Retomar envios" |
| Tempo de cada chamada | Até 10 s | Passou: conta como tentativa sem resposta |
| Situação "lenta" | Média acima de 5 s nas últimas 5 chamadas | O intervalo entre mensagens dobra até a média voltar |
| Fila sem andar | 15 min com mensagem esperando dentro da janela | Aviso no sino e no Telegram, uma vez por ocorrência |
| Mensagem fora da hora | Confirmação depois do horário da consulta, janela vencida | Não sai; aparece em "Não saíram" com o motivo |
| Pausa manual | "Pausar envios" segura todas as automações que escrevem | Nada sai até "Retomar envios" |
| Histórico | 180 dias (poda do plano dos módulos) | Mais antigo: só as contagens por dia |
| Página do histórico | 50 linhas por vez | "Ver mais antigas" |

## 7. Desenho técnico

### Arquivos

- `apps/agent/src/flows/modules/outbox.ts`: medir o tempo de cada chamada, estado da fila (`running`, `slow`, `stopped`, `paused`) e motivo da parada.
- `apps/agent/src/api/outbox.ts` (novo): rotas da tela.
- `packages/shared`: schemas Zod do filtro e das respostas, constantes (`OUTBOX_MONITOR`: 10 s, 5 s, 15 min, 50 linhas).
- `apps/web`: tela Envios dentro de CRM, carregada sob demanda.

### Rotas e contratos

| Rota | Quem chama | Resposta |
| --- | --- | --- |
| `GET /api/outbox/status` | dono | situação, motivo, última, próxima, quantas esperam |
| `GET /api/outbox?period=&status=&cursor=` | dono | linhas do histórico e contagens do período |
| `GET /api/outbox/:id` | dono | linha do tempo de um envio |
| `POST /api/outbox/pause` e `/resume` | dono | nova situação |
| `POST /api/outbox/:id/retry` | dono | o envio volta para a fila, com a mesma chave única |

Todas atrás da sessão. A tela atualiza pelo `/api/live` que já existe, sem consulta de tempos em tempos.

### Banco

Só acréscimo, na migration da fila (34 no plano dos módulos; conferir na hora): colunas `last_ms` e `stopped_reason` no estado da fila e a tabela `zur_outbox_days` (dia, enviadas, entregues, falhas, não saíram) para as contagens não lerem o histórico inteiro. O histórico mostra nome do contato, automação, horários e situação. Texto e telefone não entram na resposta da rota.

### Ferramentas do agente

Nenhuma. A conversa pode responder "quantas mensagens saíram hoje" lendo as contagens, como o plano dos módulos já prevê.

### Agendamentos, IA e integrações externas

Nenhum despertar novo: a medição acontece no envio que já existe e o aviso de fila parada usa o alarme único. Nenhuma IA.

## 8. Custo e cotas do plano Free

| Item | Uso | Folga |
| --- | --- | --- |
| Linhas lidas ao abrir a tela | Estado (1), contagens (até 30) e 50 linhas do histórico | Desprezível |
| Linhas escritas | 1 a mais por dia (contagem) e 2 colunas no estado | Desprezível |
| Subrequisições | Nenhuma a mais | Igual ao plano dos módulos |
| JS da tela | Parte lazy de CRM | Fora do JS inicial |

Nenhum recurso novo da Cloudflare.

## 9. Segurança e privacidade

| Risco | Proteção | Teste |
| --- | --- | --- |
| Envio em dobro por lentidão | Chave única e conferência do envio incerto antes de repetir | Chatwoot falso que responde depois dos 10 s |
| "Tentar de novo" virar disparo | Mesma chave única, respeita o intervalo, o teto diário e "não quer receber" | Repetir 5 vezes o mesmo envio |
| Retomar sem querer | Retomar depois de parada por falha pede senha recente e entra no registro de segurança | — |
| Dado pessoal no histórico | Sem texto e sem telefone na rota; poda em 180 dias; fora do backup | Resposta da rota sem os campos |
| Modo de bloqueio | Com o bloqueio ligado a fila não envia e a tela mostra "Pausada" | Integração |

## 10. Testes

- Unidade: cálculo da situação (normal, lenta, parada, pausada), contagens por período, linha do tempo.
- Integração no workerd com Chatwoot falso: resposta lenta, sem resposta, 401, duas falhas seguidas, retomar, tentar de novo, mensagem fora da hora.
- Interface (Playwright, com axe): as quatro situações, filtros, detalhe, celular e tema escuro.
- Orçamento: abrir a tela com 180 dias de histórico.

## 11. Entrega

Uma PR logo depois da fila de saída (PR 3 do plano dos módulos), antes do pedido de avaliação (PR 5), para o primeiro ensaio já ter onde acompanhar. Atualiza `docs/`, o changelog, o README e as capturas.

## 12. Riscos

| Risco | Como tratar |
| --- | --- |
| A ponte do WhatsApp não devolver "entregue" | A linha fica em "Enviada"; a tela não promete entrega que não foi confirmada |
| Relógio da próxima mensagem diferente do real | A tela mostra a hora prevista, nunca uma contagem que finge precisão |

## 13. Suposições

- A fila de saída sai como no plano dos módulos (uma fila por credencial, 3 tentativas, disjuntor).
- O disjuntor conta mensagens diferentes com falha em seguida, não as tentativas da mesma mensagem. Conferir com o plano dos módulos antes de codar.

## 14. Entrevista com o Pablo

### Perguntas abertas

1. **Retomar depois de uma parada por falha pede a sua senha?** Recomendação: sim. Pausar e retomar uma pausa sua não pedem.
2. **O que fazer com quem esperava na fila durante a parada?** Recomendação: ao retomar, sai o que ainda está dentro da hora; o resto vai para "Não saíram" com o motivo, sem envio atrasado.
3. **Situação "lenta" dobra o intervalo sozinha?** Recomendação: sim, e volta sozinha quando o Chatwoot normalizar. Assim uma lentidão não vira parada.
