# Plano · Formulário da Agenda: aviso, mini calendário e escolher na agenda (E5c)

Situação: aprovado em 13/11/2026 (protótipo v52, aprovado pelo Pablo às 12:49 UTC)
Origem: pedido do Pablo em 13/11/2026, 02:58 UTC ("alerta sonoro de erro e um pop-up explicativo… um mini calendário ou a possibilidade de clicar na agenda para selecionar o dia e horário")
Dependências: E5a (#329), trava do início (#331), E5b (#340), todas mescladas

## 1. Resumo

Hoje, quando o formulário de consulta recusa um horário, aparece uma linha vermelha no pé do formulário, sem som. Essa linha passa despercebida, como já acontecia ao arrastar antes da E5a. A E5c leva ao formulário o que o protótipo v52 mostra. A recusa vira um aviso com som por cima do formulário, com **Corrigir** e **Usar este horário**. "Ver no calendário" abre um mês em que os dias fechados aparecem riscados e mostra os horários livres em botões. "Escolher na agenda" recolhe o formulário e o devolve preenchido com o dia e a hora tocados. A entrega é só de interface: o servidor já confere as mesmas regras desde a E5a.

## 2. Contexto no sistema

- Formulário: `EventFormDialog` em `apps/web/src/pages/agenda/AgendaPage.tsx`. A recusa de hoje é o estado `rule`, uma linha `role="alert"`, e o foco vai ao campo.
- Regras: `packages/shared/src/agenda-rules.ts` (`appointmentProblem`, `nextFreeSlot`, `dayClosure`) e o lado da tela em `apps/web/src/lib/agenda-rules.ts` (`slotProblem`, `nextFree`, `bookedOn`).
- O som de recusa já existe: `REFUSAL_NOTES` com `play()` de `apps/web/src/lib/sounds.ts`, e só toca com o som de avisos ligado (`settings.sounds.notice`).
- O aviso de hora fechada (`ClosedHourDialog`) é o mesmo texto que o formulário vai usar (`useProblemText`).
- Os eventos são lidos por `useQuery(eventsKey(from, to))` e `/google/events`. A semana e o mês têm cada um a sua chave.
- Decisões: "Um ajuste, um lugar" (`.claude/rules/uma-fonte-por-ajuste.md`): o formulário não ganha campo de horário; ele só lê Configurações › Agenda. "Sem Dia todo" (E5a). "Registro do dia" (E5b): dia anterior a hoje não se escolhe.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Salvar uma consulta num horário recusado abre, por cima do formulário, um aviso (`alertdialog`) com o motivo, o próximo horário livre e o som de recusa. Nada do que foi digitado se perde | Pablo, v52 |
| CA2 | **Corrigir** fecha só o aviso e leva o foco ao campo do problema (dia, início ou duração). Esc faz o mesmo e não fecha o formulário | v52 |
| CA3 | **Usar este horário** preenche o dia e o início com o próximo horário livre, mantém a duração, fecha o aviso e diz a troca para o leitor de tela. Sem horário livre nos dias lidos, o botão não aparece | v52 |
| CA4 | "Ver no calendário" mostra o mês do dia do formulário. Dia passado, dia sem atendimento, feriado, dia sem expediente ou dia sem horário livre na duração escolhida fica riscado, desligado e com o motivo no nome acessível | v52 |
| CA5 | Escolhido um dia, os horários livres do dia aparecem como botões, de 30 em 30 minutos, na duração escolhida. Mudar a duração refaz os botões; tocar num botão preenche o início | v52 |
| CA6 | As setas trocam o mês; o calendário segue a data digitada no formulário; mês sem nenhum dia livre diz isso | v52 |
| CA7 | "Escolher na agenda" (só ao criar, no computador) fecha o formulário guardando o que foi digitado e mostra uma faixa "Toque no dia e na hora da consulta de {nome}" com **Cancelar**. O toque numa hora livre devolve o formulário preenchido; uma hora fechada avisa como sempre e a faixa continua; Cancelar devolve o formulário como estava | v52 |
| CA8 | Editando uma consulta, o próprio horário dela conta como livre, e "Escolher na agenda" não aparece | v52 |
| CA9 | Compromisso pessoal (sem tipo) não é conferido: o calendário só risca os dias passados e não mostra horários | v52 |
| CA10 | Tudo em pt-BR e en, com teclado, leitor de tela, celular e tema escuro, sem violação séria no axe | regras de interface |

## 4. Escopo

**Entra:** o aviso do formulário, o mini calendário com os horários livres, escolher na agenda, textos, testes, documentação e capturas.

**Fica fora (e onde vai parar):**

- Vínculo da consulta a Contatos e homônimos, local com Meet (`conferenceData`), financeiro no evento e "Agendar" na ficha do contato: listados na linha E5 do cronograma, numa entrega própria depois da E5d. Mexem no servidor e no Google, e esta entrega é só de tela.
- Sinais da sincronização: E5d.
- Consultório, cofre e e-mail: E6.

## 5. Como funciona para o Pablo

1. **Recusa ao salvar.** O Pablo preenche uma consulta para 12:30 e toca em "Criar evento". O som de recusa toca e um cartão abre por cima do formulário com o título "Consulta não entra neste horário", o texto "qui, 19/11, às 12:30. No almoço, das 12:00 às 14:00, não entra consulta." e "Próximo horário livre: qui, 19/11, às 14:00.". O foco fica em "Usar este horário".
   - "Usar este horário" troca o dia e o início, fecha o cartão, avisa "Horário trocado para qui, 19/11, às 14:00. Confira e toque em Criar evento." e põe o foco no botão de criar.
   - "Corrigir" ou Esc fecham o cartão, e o foco vai ao campo do problema.
   - Tab fica preso dentro do cartão enquanto ele está aberto.
2. **Ver no calendário.** Logo abaixo do dia e das horas fica a linha "Ver no calendário · Escolher na agenda". O mês abre com o dia do formulário marcado. Os dias que não aceitam consulta aparecem riscados e não respondem ao toque, e o leitor de tela lê "sábado, 21 de novembro: sem atendimento". Embaixo aparece "Horários livres em qui, 19/11, com 1 hora de duração:" com os botões 08:00, 08:30… O botão escolhido fica marcado.
3. **Escolher na agenda.** O formulário fecha e a faixa aparece no pé da tela. Se a Agenda estava no mês, ela passa para a semana. O toque numa hora livre devolve o formulário com tudo o que estava digitado e o dia e a hora novos. Uma hora fechada abre o aviso de sempre ("Consulta não entra neste horário"), sem levar o formulário. Cancelar devolve o formulário como estava.
4. Estados: carregando (o calendário diz "Lendo a agenda deste mês…"), erro (diz que não deu para ler e oferece "Tentar de novo") e mês sem nenhum dia livre ("Nenhum dia livre neste mês. Veja o próximo.").
5. Celular: o calendário ocupa a largura do formulário, com botões de 44 px. No celular a Agenda mostra o dia como lista, sem hora para tocar, então "Escolher na agenda" não aparece: o caminho é "Ver no calendário" (decidido na implementação, 13/11).

## 6. Regras de negócio e limites

- Os horários livres saem de 30 em 30 minutos (`NEW_STEP_MIN`), do início ao fim do expediente, e só se a consulta inteira couber. A conferência é a mesma de "próximo horário livre": almoço, feriado, período sem expediente, hora que já passou e qualquer evento não cancelado no horário.
- O "próximo horário livre" do aviso procura só nos dias que a tela já leu, como o aviso de hora fechada da E5a.
- O calendário lê os eventos do mês mostrado com a mesma chave da visão de mês. Mês já visto não pede de novo (`staleTime` padrão da Agenda).
- Dia anterior a hoje é sempre riscado (registro do dia, E5b).
- As setas vão do mês atual até o mês do limite de agendamento (um ano à frente), para não ler do Google um mês em que nada entra.
- Os horários livres saem só dos eventos do mês do dia do formulário, lidos com sucesso: trocar o mês mostrado não muda os horários, e um mês que falhou não oferece horário.

## 7. Desenho técnico

- `apps/web/src/lib/agenda-rules.ts`: `freeStarts({ prefs, events, day, length, now, timeZone, except })` devolve os minutos de início livres do dia, com a mesma conferência de `nextFree`. Também `dayRefusal(...)`, o motivo de um dia não aceitar consulta (passado, fechado ou sem horário livre).
- `AgendaPage.tsx`:
  - `FormAlert`: o cartão sobre o formulário (`role="alertdialog"`, foco preso, Esc só nele).
  - `MiniCalendar`: o mês, os dias e os horários, com `useQuery(eventsKey(mês))`.
  - Estado `picking` em `AgendaPage`, com o formulário guardado e a faixa. O clique de hora da semana e do dia, quando `picking` está ativo, devolve o formulário em vez de abrir um novo.
- O formulário recebe `initialForm` para voltar com o que estava digitado.
- Nenhum ícone novo: `CalendarDays` e `CalendarClock` já são usados na Agenda. Confirmar no build, porque um ícone novo custa um arquivo no primeiro carregamento (armadilha da E5b).

## 8. Custo e cotas do plano Free

- Sem rota nova, sem migration e sem escrita no banco.
- O calendário pode pedir `/google/events` de um mês ainda não lido: uma chamada ao Google por mês aberto, dentro do medidor das rotas (12 chamadas por pedido). O uso típico é o mês da semana já aberta, que vem do cache.
- JS inicial: a Agenda é carregada sob demanda, então a conta não muda. Medir com `npm run size` (teto 141,1 kB).

## 9. Segurança e privacidade

- Sem superfície nova no servidor. O nome do paciente na faixa sai do campo digitado, renderizado como texto pelo React, nunca como HTML.
- O servidor continua a conferir tudo (E5a e E5b): o formulário só adianta o aviso.

## 10. Testes

- Unitários (`apps/web/src/lib/agenda-rules.test.ts`): `freeStarts` com almoço, último horário, duração maior que o expediente, evento cancelado, o próprio horário de quem está sendo editado e a hora que já passou. `dayRefusal` com passado, fim de semana, feriado, período e dia cheio.
- e2e (`tests/e2e/agenda-formulario.spec.ts`):
  - o aviso com Corrigir, Esc, Usar este horário e o foco preso;
  - o calendário com dias riscados, nomes acessíveis, horários, troca de duração e troca de mês;
  - escolher na agenda: hora livre, hora fechada e Cancelar;
  - editando, sem "Escolher na agenda";
  - celular, axe e inglês.

## 11. Entrega

Uma PR para a `develop`, com fragmento de changelog, README ("O que já funciona", linha do Google) e capturas do formulário com o aviso, o calendário aberto e a faixa de escolher na agenda.

## 12. Riscos

- Som bloqueado antes do primeiro toque na página: o aviso aparece sem som. É o mesmo comportamento da E5a.
- Mês sem leitura do Google (erro ou sem conexão): sem os eventos, o calendário não sabe quais dias estão cheios. Mostra o erro com "Tentar de novo" e não oferece horários.

## 13. Suposições

- Passos de 30 minutos bastam para os horários livres, como o clique na grade da E5a.

## 14. Entrevista com o Pablo

Sem perguntas: tudo coberto pelo protótipo v52, aprovado em 13/11/2026 às 12:49 UTC.
