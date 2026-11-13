# Plano · Travas do agendamento na Agenda (E5a)

Situação: implementado (PR desta branch)
Origem: pedido do Pablo em 13/11/2026 (00:44, 01:04 e 01:44 UTC), protótipo v51 aprovado
Dependências: entregas 1 a 4 de `sons-menu-e-agenda-editavel.md` mescladas (#321, #322); encaixe no cronograma do Sinal na seção "Encaixe com o cronograma do frontend Sinal" desse plano

## 1. Resumo

Hoje a Agenda aceita uma consulta em qualquer hora: no almoço, num feriado,
sábado ou por cima de outra. O Pablo aprovou no protótipo as travas: consulta
só nos dias e no horário de atendimento, fora do almoço, de 5 em 5 minutos,
de 15 minutos a 4 horas, de agora a um ano, sem sobrepor outra. A tela explica
e oferece o próximo horário livre; o servidor confere de novo. Configurações ›
Agenda ganha almoço, feriados com "Atendo" e dias sem expediente. É a E5a; o
formulário completo (E5b) e os sinais de sincronização (E5c) vêm depois.

## 2. Contexto no sistema

- Preferências da agenda: `packages/shared/src/agenda-prefs.ts` e `agendaPrefsSchema` em `packages/shared/src/settings.ts`, guardadas em `zur_settings` (chave `agenda`), editadas em `apps/web/src/pages/settings/AgendaTab.tsx`. Um registro inválido volta ao padrão sem aviso, então campo novo entra com `.default()`.
- Feriados: `nationalHoliday` em `packages/shared` (entrega 2, #315).
- Tipo do atendimento: a primeira linha da descrição ("Consulta | Consultório"), lida por `readType` (`apps/agent/src/google/appointments.ts`) e `typeLine` na web. Situação pela cor; Cancelado é a cor 11.
- Tela: `apps/web/src/pages/agenda/AgendaPage.tsx` (grade, arrastar, teclado, formulário), `apps/web/src/lib/agenda.ts`, `lib/agenda-edit.ts`.
- Rotas: `POST` e `PATCH /api/google/events` em `apps/agent/src/api/google.ts`.
- Regra `.claude/rules/uma-fonte-por-ajuste.md`: o horário de atendimento fica só em Configurações › Agenda; o que a agenda mostra e o que o consultório atende é o mesmo dado.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | A regra vale só para consultas: evento com horário, com tipo e não cancelado | Pablo 00:44 |
| CA2 | Recusa, nessa ordem: minutos fora de 5 em 5, menos de 15 min, mais de 4 h, passado, mais de um ano, dia sem atendimento, feriado fechado, dia sem expediente, fora do horário, almoço, outra consulta | Pablo 00:44 e 01:04 |
| CA3 | Clicar numa hora fechada diz o motivo, oferece o próximo horário livre (só entre os dias lidos) e o compromisso pessoal | protótipo v51 |
| CA4 | Arrastar para hora fechada marca o bloco com o motivo curto; ao soltar, nada vai ao Google, som e aviso por cima da tela com o próximo horário livre | protótipo v51; Pablo 03:03 |
| CA5 | O formulário mostra o motivo e foca o campo a corrigir; consulta antiga sem mudança de dia e hora salva | protótipo v51 |
| CA6 | O servidor recusa com `VALIDATION_FAILED` e o motivo antes de chamar o Google, e só lê o dia no Google para a sobreposição | plano |
| CA7 | Configurações › Agenda: almoço de meia em meia hora (ou sem), próximos 12 feriados em dia de atendimento com "Atendo", dias sem expediente com motivo | protótipo v51 |
| CA8 | Consulta já marcada que ficou fora do horário continua, listada no cartão e marcada na Agenda | Pablo 00:44 |
| CA9 | Registro antigo (com `allDay`) continua valendo; eventos de dia inteiro aparecem sempre | plano (novo) |
| CA10 | A tela e o servidor usam a mesma função para dizer o que é consulta (`bindsBooking`) e contam os minutos pelo relógio, também no dia de 23 h e de 25 h | revisão de QA e auditoria |
| CA11 | Se o servidor não consegue ler o dia inteiro (calendário pulado, página a mais), não grava e pede para tentar de novo | auditoria |
| CA12 | Depois que a consulta começa, o dia e a hora travam: puxar o fim ou tirar do Cancelado é "já passou"; título, descrição e situação continuam editáveis | Pablo, 13/11/2026 08:02 UTC ("Nada depois do início") |
| CA13 | Clicar na última meia hora antes do almoço ou do fim do dia abre o formulário com 30 minutos | revisão de QA |

## 4. Escopo

**Entra:** regra comum em `packages/shared`, checagem nas duas rotas de escrita, tela da Agenda, Configurações › Agenda, testes e documentação.

**Fica fora (e onde vai parar):**

- Ferramentas da conversa e fluxos (`create_calendar_event`, `update_calendar_event`, passo `calendar_create`) → issue #328; o agente ainda marca em qualquer hora.
- Duas gravações ao mesmo tempo no mesmo horário (duas abas) ainda passam as duas. Com um dono só é raro; antes do link do paciente (E7) a reserva fica serializada no objeto do agente.
- Formulário com máscara de 24 h, Meet, contato, homônimos e financeiro → E5b.
- Botão e painel de sincronização → E5c.

## 5. Como funciona para o Pablo

### Fluxo 1 · Clicar numa hora fechada

1. Clica em quinta 12:15. Abre "Consulta não entra neste horário": "qui, 19/11, às 12:00. No almoço, das 12:00 às 14:00, não entra consulta."
2. Embaixo, "Próximo horário livre: qui, 19/11, às 15:00." (14:00 já tem consulta) com **Usar o próximo livre**, que abre o formulário nesse horário.
3. **Criar compromisso pessoal** abre o formulário sem tipo na hora clicada. Sem horário livre na semana lida, o botão é **Entendi**.

### Fluxo 2 · Arrastar

1. Enquanto segura, o bloco fica com borda vermelha e o motivo curto ("Almoço", "Feriado", "Ocupado"); o leitor de tela ouve o mesmo.
2. Ao soltar, a consulta volta, toca o som de recusa e abre o mesmo aviso do Fluxo 1: "qui, 19/11, às 12:00. No almoço, das 12:00 às 14:00, não entra consulta. A consulta ficou onde estava.", com o próximo horário livre e **Mover para lá**, ou só **Entendi** quando não há horário livre na semana lida. Antes era uma linha no rodapé; o Pablo pediu o aviso por cima da tela (13/11/2026, 03:03 UTC).

### Fluxo 3 · Configurações › Agenda

1. Almoço "das" e "até" ao lado do horário; a barra desenha o almoço. Mudar o horário reencaixa o almoço.
2. Feriados nacionais: lista com data, nome e **Atendo** (botão de alternar).
3. Dias sem expediente: etiquetas com X e **Adicionar dia**, que abre um diálogo com a data em dd/mm/aaaa e o motivo.
4. Ao salvar, se alguma consulta já marcada ficou fora, aparece a lista com **Abrir a Agenda**.

Celular: os mesmos diálogos; no celular a Agenda muda por **Editar**, então o formulário é quem recusa. Tema escuro e axe sem violações sérias.

### Textos visíveis

Chaves `web.agenda.rule.*`, `web.agenda.closedHour.*`, `web.agenda.closedDay*`, `web.agenda.lunch`, `web.agenda.outsideMark` (`pt-BR-agenda.ts`), `web.agendaPrefs.lunch.*`, `holidays.*`, `closed.*`, `outsideList.*` (`pt-BR-settings.ts`) e `error.agendaRule.*` (`pt-BR-server.ts`), todas também em `en.ts`.

## 6. Regras de negócio e limites

| Regra | Valor | No limite | Erro |
| --- | --- | --- | --- |
| Passo dos minutos | 5 | 14:35 aceita, 14:33 recusa | `step` |
| Duração | 15 a 240 min | 15 e 240 aceitam; 10 e 245 recusam | `short`, `long` |
| Antecedência | hoje (a partir de agora) até 365 dias | hoje + 365 aceita | `past`, `far` |
| Almoço | múltiplos de 30, até 180 min, 30 min de folga do horário | — | schema |
| Dias sem expediente | até 100, motivo até 40 caracteres | 100 aceita, 101 recusa | schema |
| Feriados abertos | até 40, só datas de feriado nacional | — | schema |

## 7. Desenho técnico

### Arquivos

| Arquivo | Cria ou muda | Para quê |
| --- | --- | --- |
| `packages/shared/src/agenda-rules.ts` | cria | `appointmentProblem`, `dayClosure`, `outsideHours`, `nextFreeSlot` |
| `packages/shared/src/agenda-prefs.ts`, `settings.ts` | muda | campos `lunch`, `openHolidays`, `closed`; `allDay` aceito e descartado |
| `apps/agent/src/google/booking.ts` | cria | `checkBooking` antes do Google |
| `apps/agent/src/api/google.ts`, `agent/zuri-agent.ts` | muda | chama `checkBooking` no POST e no PATCH |
| `apps/web/src/lib/agenda-rules.ts` | cria | `slotProblem`, `nextFree`, `bookedOn`, `clock` |
| `apps/web/src/pages/agenda/AgendaPage.tsx` | muda | hora fechada, recusa ao arrastar, formulário, almoço, marcas |
| `apps/web/src/pages/settings/AgendaTab.tsx` | muda | almoço, feriados, dias sem expediente, lista de fora do horário |

### Rotas e contratos

Sem rota nova. `POST` e `PATCH /api/google/events` podem responder 400 `VALIDATION_FAILED` com `details.problem` igual ao código da regra.

### Banco

Sem migration: o registro `agenda` de `zur_settings` ganha campos com padrão.

### Ferramentas do agente

Nenhuma muda nesta entrega (veja Escopo).

### Agendamentos, IA e integrações externas

Uma leitura a mais do Google por gravação de consulta que passa nas regras fixas (os eventos do dia, até 200), com o medidor próprio da rota.

## 8. Custo e cotas do plano Free

| Recurso | Uso típico | Pior caso | Folga | Fonte |
| --- | --- | --- | --- | --- |
| Subrequisições por gravação | 2 (ler o dia num calendário, gravar) | 24: até 10 calendários lidos e a renovação do token no medidor da checagem (12), mais 12 no da gravação | abaixo de 45 (P9) | `GoogleMeter`, `apps/agent/src/google/service.ts` |
| Linhas do banco | 0 a mais (a regra lê as preferências já carregadas) | 0 | — | P1 |
| JS inicial | 140.995 B | — | 5 B | `npm run size` |

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Pedido feito à mão ou aba antiga marca no almoço | servidor confere de novo antes do Google | `google-routes.test.ts`, "the booking rule, checked again by the server" |
| Configuração hostil (almoço fora do horário, 10.000 dias) | schema Zod com tetos | `settings.test.ts` |
| Motivo do dia sem expediente com HTML | texto puro no React, até 40 caracteres | e2e de Configurações |

## 10. Testes

| CA | Teste | Camada | Arquivo |
| --- | --- | --- | --- |
| CA1, CA2 | appointmentProblem | unitário | `packages/shared/test/agenda-rules.test.ts` |
| CA3 | clique no almoço e no feriado | e2e | `tests/e2e/agenda-travas.spec.ts` |
| CA4 | arrastar e Alt + setas | e2e | `tests/e2e/agenda-travas.spec.ts` |
| CA5 | formulário | e2e | `tests/e2e/agenda-travas.spec.ts` |
| CA6 | rotas | integração | `apps/agent/test/google-routes.test.ts` |
| CA7 | Configurações › Agenda | e2e e unitário | `tests/e2e/agenda-travas.spec.ts`, `apps/web/test/agenda-rules.test.ts` |
| CA8 | lista e marca | e2e | `tests/e2e/agenda-travas.spec.ts` |
| CA9 | registro antigo | integração | `apps/agent/test/settings.test.ts` |
| CA10, CA11, CA12 | checagem do servidor | unitário | `apps/agent/test/booking.test.ts` |
| CA12 | consulta que já começou | unitário | `packages/shared/test/agenda-rules.test.ts` |
| CA13 | clique em 11:30 | e2e | `tests/e2e/agenda-travas.spec.ts` |

## 11. Entrega

Uma PR para a `develop`, com capturas da Agenda e de Configurações › Agenda. Depois, E5b e E5c nesta mesma thread.

## 12. Riscos

| Risco | Chance | Impacto | O que fazemos |
| --- | --- | --- | --- |
| Consultas antigas fora do horário travam edições | média | o Pablo não consegue renomear | mudança sem novo dia e hora não é checada |
| Agente ainda marca fora da regra | alta | consulta no almoço pela conversa | issue de acompanhamento |

## 13. Suposições

- "Consulta" é todo evento com tipo; retorno também conta.
- O próximo horário livre olha só a semana (ou o mês) já lida, para não fazer outra leitura ao Google.
- Uma consulta que já começou não muda de dia nem de hora (CA12). A E5a saiu com a exceção de puxar o fim; o Pablo escolheu "Nada depois do início" (13/11/2026, 08:02 UTC) e a exceção saiu na PR seguinte.

## 14. Entrevista com o Pablo

| Data | Pergunta | Resposta |
| --- | --- | --- |
| 13/11/2026 | As regras e as telas do protótipo v51 | aprovadas ("Protótipo aprovado") |
