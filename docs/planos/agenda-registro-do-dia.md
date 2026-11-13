# Plano · Feriados, períodos sem expediente e registro do dia (E5b)

Situação: aprovado (protótipo v55 aprovado pelo Pablo em 13/11/2026, 12:49 UTC)
Origem: pedidos do Pablo em 13/11/2026 (10:37 e 10:50 UTC); protótipo `docs/planos/modelos-frontend/prototipo-interativo.html`, Configurações › Agenda e a ficha de um evento de ontem
Dependências: E5a (#329) e a trava do início (#331) mescladas; regras da Agenda na conversa e nos fluxos (#335)

## 1. Resumo

Três mudanças na Agenda, pedidas pelo Pablo e aprovadas no protótipo. Feriado
nacional sempre fecha a agenda, porque ele não atende em feriado: sai o
"Atendo". "Dias sem expediente" passam a aceitar um período (férias, recesso,
viagem), não só dias soltos. E à 0h os eventos do dia que terminou congelam:
a Zuri guarda uma cópia, recusa qualquer mudança neles (tela, conversa, fluxos)
e avisa se alguém mudar o evento direto no Google Agenda depois. O formulário
completo (24 h, Meet, contato, homônimos, financeiro, mini calendário) fica na
E5c e os sinais da sincronização na E5d.

## 2. Contexto no sistema

- Preferências: `AgendaPrefs` em `packages/shared/src/agenda-prefs.ts`, `agendaPrefsSchema` em `packages/shared/src/settings.ts` (registro inválido volta ao padrão sem aviso: campo antigo é lido e descartado, como `allDay`). Hoje `openHolidays: string[]` e `closed: { date, reason }[]`.
- Regra comum: `dayClosure` e `appointmentProblem` em `packages/shared/src/agenda-rules.ts`, usadas pela tela e pelo servidor (`checkBooking` em `apps/agent/src/google/booking.ts`).
- Escritas no Google: `createEvent`, `updateEvent`, `deleteEvent` em `apps/agent/src/google/service.ts`, chamadas por `apps/agent/src/api/google.ts` (rotas), `apps/agent/src/tools/calendar.ts` (conversa, inclusive a proposta de apagar, que pode ser aprovada até 24 h depois) e `apps/agent/src/flows/google-steps.ts` (passo `calendar_create`).
- Leitura: `GET /api/google/events` e a ferramenta `list_calendar_events`.
- Alarme único do objeto: `alarmWork` e o cálculo do próximo despertar em `apps/agent/src/agent/zuri-agent.ts` (padrão `tick()` + `nextDue()`).
- Tela: `apps/web/src/pages/settings/AgendaTab.tsx` (`Holidays`, `ClosedDays`), `apps/web/src/pages/agenda/AgendaPage.tsx`, `apps/web/src/lib/agenda.ts`.
- Decisões: "Consulta que já começou" (13/11, 08:02) e "Feriados, períodos e registro do dia" (13/11, 10:37) em `.claude/memoria/decisoes.md`.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Feriado nacional sempre fecha o dia, na tela e no servidor; Configurações › Agenda lista os próximos 12 feriados em dia de atendimento, sem botão | Pablo 10:37 |
| CA2 | Registro antigo com `openHolidays` continua válido: o campo é lido e descartado, e os outros ajustes ficam | plano |
| CA3 | Dia sem expediente é um período `{ from, to, reason }` de 1 a 90 dias; um dia só tem `from = to` | Pablo 10:37, protótipo v55 |
| CA4 | Período recusado: data inválida, já passado, fim antes do início, mais de 90 dias, além de um ano, sobreposto a outro, mais de 100 períodos | protótipo v55 |
| CA5 | Registro antigo com `{ date, reason }` vira um período de um dia sem perder o motivo | plano |
| CA6 | Ao salvar um período com consultas marcadas dentro, a tela diz quantas precisam ser remarcadas, e elas aparecem em "ficaram fora" | protótipo v55 |
| CA7 | Evento de um dia anterior a hoje (relógio do dono) não muda: criar, editar (inclusive situação), mover para outro dia ou apagar é recusado com `VALIDATION_FAILED` e `problem: "frozen"`, antes de chamar o Google | Pablo 10:37 |
| CA8 | A trava do CA7 vale na rota, nas ferramentas da conversa (inclusive a proposta de apagar aprovada depois da meia-noite) e no passo de fluxo | plano |
| CA9 | À 0h do dono (ou no primeiro despertar depois), a Zuri lê no Google o dia que terminou e guarda a cópia dos eventos das agendas que ela pode editar; leitura parcial não fecha o dia e tenta de novo no próximo despertar | Pablo 10:37 |
| CA10 | Até 7 dias atrasados fecham, um por despertar; nada antes da instalação desta entrega é copiado | plano |
| CA11 | Na Agenda, um dia fechado mostra a cópia guardada; evento que mudou, sumiu ou apareceu no Google depois do fechamento ganha a marca "Mudou no Google depois do fechamento" e gera um aviso uma vez | Pablo 10:37 |
| CA12 | A ficha de um evento congelado mostra "Congelado" e a situação final, sem botões de situação, editar e apagar; arrastar é recusado com som e aviso; "Enviar Pix" continua | Pablo 10:37 e 10:50 |
| CA13 | Hoje continua com a trava do início (#331): até a meia-noite dá para marcar quem veio ou faltou | decisão de 13/11 08:02 |
| CA14 | A cópia entra no backup e nunca é apagada pela Zuri | AGENTS.md regra 5 |

## 4. Escopo

**Entra:** schema e regra em `packages/shared`, trava nas escritas, tabela da cópia (migration 42), fechamento no alarme, leitura com a cópia na rota e na ferramenta de listar, Configurações › Agenda, marcas na Agenda, avisos, i18n, testes, docs.

**Fica fora (e onde vai parar):**

- Formulário de 24 h, Meet, contato, homônimos, financeiro, mini calendário e "Escolher na agenda" → E5c.
- Botão e painel de sincronização → E5d.
- Agendas só de leitura não são copiadas: a Zuri não as muda, então não fazem parte do registro dela.
- Restaurar no Google a versão congelada de um evento mudado lá → não pedido; a Zuri só mostra e avisa.

## 5. Como funciona para o Pablo

### Fluxo 1 · Feriados

1. Abre Configurações › Agenda. Em "Feriados nacionais", vê data, nome e dia da semana dos próximos 12 que caem em dia de atendimento. Não há botão.
2. Na Agenda, o feriado aparece fechado; clicar numa hora dele diz "sex, 20/11 é feriado (Consciência Negra). A agenda não abre em feriado."

### Fluxo 2 · Período sem expediente

1. Em "Dias sem expediente", toca "Adicionar dia ou período". Abre o diálogo com "De", "Até (vazio para um dia só)" e "Motivo (opcional)".
2. Preenche 18/01/2027 a 29/01/2027, "Férias", e toca "Adicionar". O diálogo fecha e a lista mostra "18/01/2027 a 29/01/2027 · Férias · 12 dias" com o botão de tirar.
3. Se havia consultas no período, um aviso diz "De 18/01/2027 até 29/01/2027, 12 dias ficaram sem expediente. 2 consultas marcadas nesse período precisam ser remarcadas." e elas aparecem no cartão "ficaram fora".
4. Erros ficam no diálogo, com foco no campo: data inválida, já passou, fim antes do início, mais de 90 dias, mais de um ano, sobreposto ("Esse período encosta em 24/12/2026 a 03/01/2027, que já está na lista.").
5. "Salvar" grava como hoje (ajuste inteiro). Celular: campos um embaixo do outro; teclado e leitor de tela como no diálogo atual.

### Fluxo 3 · Registro do dia

1. À 0h, sem nada na tela, a Zuri fecha o dia anterior.
2. Na Agenda, ontem aparece com os eventos guardados. Abrir um mostra "Congelado. Situação final: Compareceu. O dia 12/11 fechou à meia-noite, então nada neste evento muda mais. Se alguém mudar no Google Agenda, a Zuri mantém este registro e avisa você." Sem botões de situação, editar e apagar. "Enviar Pix" continua.
3. Arrastar um evento de ontem toca o som de recusa e abre o aviso "Este evento é de um dia que já fechou…".
4. Se alguém mudou o evento no Google, ele aparece como guardado, com a marca "Mudou no Google depois do fechamento"; o sino traz um aviso uma vez.
5. Configurações › Agenda ganha a linha "Registro do dia" com a explicação e "Último fechamento: hoje, 00:00, 7 eventos".

### Textos visíveis

Chaves novas em `pt-BR-settings.ts`, `pt-BR-agenda.ts` (ou o arquivo da Agenda atual) e `en.ts`, com os textos do protótipo v55 passados pela `humanizer`. As chaves de "Atendo" saem do catálogo.

## 6. Regras de negócio e limites

| Regra | Valor | No limite |
| --- | --- | --- |
| Tamanho de um período | 1 a 90 dias | 91: recusa "Um período vai até 90 dias. Para mais, marque em partes." |
| Períodos guardados | até 100 | 101º: recusa (texto atual de `closed.full`) |
| Início do período | de hoje até 1 ano | passado ou além: recusa |
| Motivo | até 40 caracteres | corta no campo (`maxLength`) e o schema recusa acima |
| Dia congelado | todo dia antes de hoje, pelo fuso do dono | qualquer escrita: `VALIDATION_FAILED`, `problem: "frozen"` |
| Fechamento | um dia por despertar, até 7 dias atrás | 8º dia atrás: não copia, registra no log |
| Leitura do dia para a cópia | até 200 eventos, 100 por agenda | página a mais ou agenda pulada: não fecha, tenta no próximo despertar |
| Aviso de mudança no Google | um por evento e por versão (etag) | a mesma versão não avisa de novo |

## 7. Desenho técnico

### Arquivos

- `packages/shared/src/agenda-prefs.ts`, `settings.ts`, `agenda-rules.ts`: `closed` vira períodos; `openHolidays` lido e descartado; `dayClosure` sem exceção de feriado; `frozenDay(day, today)`.
- `apps/agent/src/google/booking.ts`: `checkOpenDay({ before?, after?, timeZone, now })` chamado antes de `checkBooking` em toda escrita.
- `apps/agent/src/google/record.ts` (novo): `AgendaRecord` com `tick()`, `nextDue()`, `apply(events, from, to)` e o aviso.
- `apps/agent/src/api/google.ts`, `tools/calendar.ts`, `flows/google-steps.ts`: a trava; a rota de apagar e o `commitAsync` de apagar leem o evento antes (uma leitura a mais).
- `apps/agent/src/agent/zuri-agent.ts`: o passo no alarme e o `nextDue`.
- `apps/web/src/pages/settings/AgendaTab.tsx`, `apps/web/src/pages/agenda/AgendaPage.tsx`, `apps/web/src/lib/agenda.ts`.

### Rotas e contratos

- `GET /api/google/events`: cada evento de dia fechado vem com `frozen: true` e, quando difere da cópia, `changedAtGoogle: "changed" | "deleted" | "added"`. Evento apagado no Google volta da cópia.
- Escritas: nova recusa `problem: "frozen"` com a mensagem `error.agendaRule.frozen`.

### Banco

Migration 42 (a 41 ficou com a S20, `review_requests`), só acréscimo:

- `zur_agenda_record(day TEXT, calendar_id TEXT, event_id TEXT, etag TEXT, data TEXT NOT NULL, seen_etag TEXT, PRIMARY KEY (day, calendar_id, event_id))`: `data` é o `CalendarEvent` em JSON; `seen_etag` guarda a última versão do Google já avisada.
- `zur_agenda_closed_days(day TEXT PRIMARY KEY, closed_at TEXT NOT NULL, events INTEGER NOT NULL)`.

Entram no backup (não dá para refazer a partir do Google). Nunca apagadas.

### Ferramentas do agente

Nenhuma nova. `create_calendar_event`, `update_calendar_event`, `delete_calendar_event` e `change_shared_calendar_event` recusam dia congelado com a mensagem fixa; `list_calendar_events` usa `apply` para mostrar a cópia.

### Agendamentos, IA e integrações externas

Um passo no alarme único, depois das sincronizações: uma listagem do Google por dia fechado, com o `GoogleMeter` das rotinas. Sem IA.

## 8. Custo e cotas do plano Free

- Fechamento: 1 a 2 subrequisições por dia (lista paginada das agendas editáveis), dentro do teto de 44 por despertar. Pior caso, 7 dias atrasados: 7 despertares de 2.
- Apagar pela rota ou pela proposta: uma leitura a mais no Google por apagar.
- SQLite: cerca de 20 eventos por dia, menos de 1 KB cada: uns 7 MB por ano, longe do limite do objeto.
- JS inicial: Configurações e Agenda são telas lazy; medir com `npm run build -w @zuri/web` contra o teto de 141.000 B.

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Mudar o registro pela tela, conversa, proposta antiga ou fluxo | trava no servidor antes do Google, a partir do evento lido no Google (não do que o cliente diz) | rota, ferramentas e fluxo com dia congelado |
| Cliente mente o dia no corpo da escrita | a rota de editar e a de apagar leem o evento no Google antes | apagar com etag de evento de ontem |
| Texto do evento (título, descrição) com HTML ou instruções | a cópia guarda o `CalendarEvent` já limpo; na conversa entra em `<data>` como hoje | XSS na Agenda e injeção em `list_calendar_events` |
| Cópia apagada ou alterada | nenhuma rota apaga ou muda; backup inclui | teste de rotas percorre `app.routes` |

## 10. Testes

- `packages/shared`: período (1, 90, 91 dias; sobreposição; fim antes do início; registro antigo `{ date }` e `openHolidays`), `dayClosure` em feriado e dentro e fora de período, `frozenDay` no dia de 23 h e 25 h.
- `apps/agent`: trava nas rotas (criar, editar situação, mover, apagar), nas quatro ferramentas e no fluxo; fechamento (dia normal, leitura parcial, 7 e 8 dias atrasados, só agendas editáveis, fuso diferente do servidor); `apply` (mudou, sumiu, apareceu, aviso uma vez por etag); backup com a tabela.
- `tests/e2e`: Configurações › Agenda (feriados sem botão, período válido e os erros, aviso de consultas), ficha congelada e arrastar recusado com relógio falso, axe, celular escuro.
- Prova de que pega: quebrar `frozenDay` e ver a rota passar a aceitar.

## 11. Entrega

Uma PR para a `develop` com capturas de Configurações › Agenda e da ficha congelada (computador e celular, claro e escuro), changelog, `docs/google-agenda.md`, README se a linha da Agenda mudar.

## 12. Riscos

- Evento recorrente: a cópia guarda a ocorrência do dia (o Google lista expandido com `singleEvents`). Conferir no teste.
- Feriado aberto antes desta entrega fecha: consultas nele aparecem em "ficaram fora", nada some.
- Alarme parado mais de 7 dias: os dias antigos não ganham cópia, mas continuam travados para escrita.

## 13. Suposições

- "Dia que terminou" é pelo fuso do dono em Configurações, não do aparelho.
- A cópia guarda só as agendas editáveis (as que a Zuri muda).
- O aviso de mudança no Google é um aviso comum do sino, sem Telegram.

## 14. Entrevista com o Pablo

Sem perguntas: tudo coberto pelas decisões de 13/11/2026 (10:37 e 10:50 UTC) e pelo protótipo v55 aprovado às 12:49 UTC.

### Perguntas abertas

Nenhuma.
