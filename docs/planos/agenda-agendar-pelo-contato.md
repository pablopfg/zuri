# Plano · "Agendar" na ficha do contato (E5g)

Situação: aprovado (protótipo v52–v56, Pablo, 13/11/2026 12:49 UTC). Sem perguntas novas: tudo coberto pelo protótipo e pelas decisões da Agenda de 13/11.

## 1. Resumo

A ficha do contato ganha o botão **Agendar**. Ele abre a Agenda com o formulário de consulta já pronto: o contato vinculado (E5f) e o primeiro horário livre. Se o contato já tem consulta marcada daqui para frente, o formulário avisa, para não marcar duas vezes. Cancelar volta para a ficha. Entrega só de tela, sem rota nova nem migration.

## 2. Contexto no sistema

- Ficha: `apps/web/src/pages/contacts/ContactCard.tsx` (as "portas" Perguntar, Ligar, WhatsApp e E-mail) e `person.ts` (`isNamed`).
- Agenda: `apps/web/src/pages/agenda/AgendaPage.tsx` (estado `Editing`, `EventDialog`, `useMonthEvents`) e `apps/web/src/lib/agenda-rules.ts` (`nextFree`, a mesma regra do clique numa hora fechada).
- Vínculo: `apps/web/src/pages/agenda/PatientLink.tsx` (`LinkedPatient`, `linkedOf`) e o `contact` do formulário (E5f, `docs/planos/agenda-vinculo-com-contatos.md`).
- Próxima consulta do contato: `GET /api/contacts/:id/appointments` (`next`), que a ficha já usa.
- `ContactDetail` (`packages/shared/src/contacts.ts`) ganha `resource`, o `resourceName` que o vínculo grava.
- Decisões: homônimos são pessoas diferentes (12/11); nada depois do início da consulta, feriados fecham, almoço 12h–14h (13/11).

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | A ficha tem **Agendar**, ao lado de **Perguntar à Zuri**, com nome acessível "Agendar com <nome>" | protótipo v52 |
| CA2 | Agendar abre a Agenda, na semana do horário, com "Novo agendamento" no primeiro horário livre: de 30 em 30 min a partir de agora, num dia aberto, dentro do horário da agenda, sem outra consulta no horário, até o fim do mês seguinte. Sem horário livre, amanhã no começo do expediente | protótipo v52 |
| CA3 | Contato com nome: já vem vinculado ("Vinculado a …", celular e e-mail só para leitura), mesmo com homônimos, porque o contato foi escolhido. O foco vai para a data | protótipo v52 |
| CA4 | Contato sem nome no Google: não vincula; o celular e o e-mail vêm preenchidos, o foco vai para o nome, com o aviso "Este contato não tem nome no Google. Escreva o nome completo do paciente." | protótipo v52 |
| CA5 | Uma linha sob o título diz de onde veio e o horário: "Já vem com os dados de <nome> e no primeiro horário livre: <dia> às <hora>. Confira antes de agendar." Com consulta marcada daqui para frente, acrescenta "Atenção: já existe “<tipo>” em <dia> às <hora>." | protótipo v52 |
| CA6 | Cancelar (ou o X, ou Esc) volta para a ficha do mesmo contato, com o foco em Agendar. Agendar fica na Agenda | protótipo v52 |
| CA7 | Sem agenda com edição, ou contato que não está mais na cópia: a Agenda abre normal, com um aviso, sem formulário | plano (novo) |
| CA8 | pt-BR e en, teclado, leitor de tela, celular, tema escuro, axe, 44 px | regras da interface |

## 4. Escopo

**Entra:** o botão na ficha, o endereço `/agenda?agendar=<id do contato>`, o formulário pronto, o aviso da próxima consulta e a volta para a ficha.

**Fica fora:** marcar pela conversa com a Zuri (já existe a ferramenta do agente); endereço do consultório no Presencial (E6).

## 5. Como funciona para o Pablo

1. Na ficha de "Beatriz Novaes Conceição", toca em **Agendar**.
2. A Agenda abre na semana do primeiro horário livre, com "Novo agendamento": Beatriz vinculada, data e hora preenchidas, tipo Consulta, Presencial. A linha de cima diz o horário e, se for o caso, a consulta já marcada.
3. Confere e toca em **Agendar**: o evento é criado como em qualquer agendamento (E5e e E5f). Ou toca em Cancelar e volta para a ficha.
4. No celular é igual; o botão fica na primeira linha das portas.

Estados: carregando (o formulário espera o contato, os dois meses e a próxima consulta, com a Agenda já na tela); erro (aviso "Não deu para abrir o agendamento deste contato." e a Agenda normal).

## 6. Regras de negócio e limites

- Horário: `nextFree` com duração de 60 min, a partir do próximo meio-hora depois de agora, até o último dia do mês seguinte (o que as duas visões de mês já leem). Sem horário, amanhã às `prefs.from`.
- Contato com nome vincula pelo `resource`; o servidor confere o nome como na E5f.
- O endereço `?agendar=` sai da barra depois de usado; recarregar a página não abre de novo.

## 7. Desenho técnico

- `packages/shared/src/contacts.ts`: `ContactDetail.resource`; `apps/agent/src/google/contacts.ts` preenche.
- `ContactCard.tsx`: porta `Link` para `/agenda?agendar=<id>`, ícone já carregado na ficha (`CalendarClock`), sem arquivo novo no primeiro carregamento.
- `AgendaPage.tsx`: lê `agendar` da URL; busca o contato, a próxima consulta e os dois meses (as mesmas chaves do cache da Agenda e do minicalendário); abre `Editing` `new` com `form` pronto e `from: { contactId, person, sub, note }`. O `EventDialog` começa com `picked` = a pessoa, mostra `sub` e a nota, foca a data ou o nome, e ao cancelar navega para `/contatos/<id>` com `state.focus = "agendar"`.
- Função pura `bookingFrom` em `apps/web/src/lib/agenda-rules.ts` (o horário), com teste unitário.

## 8. Custo e cotas do plano Free

- Pedidos ao Google: até duas leituras de mês da agenda (as mesmas da visão de mês, guardadas no cache) e a próxima consulta (`/appointments`, a mesma da ficha, já no cache quando vem da ficha).
- Banco: nenhuma consulta nova.
- JS inicial: nada no primeiro carregamento (a ficha e a Agenda são telas sob demanda). Medir com `npm run size`.

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| `?agendar=` com valor hostil (XSS, caminho) | só um id da cópia (`/^[0-9a-f-]{36}$/`) é usado; o resto é ignorado; o id vai codificado na URL da API | e2e com valor hostil |
| Vincular o contato errado | o vínculo é o `resource` do contato aberto; o servidor confere o nome (E5f) | e2e confere o `contact` enviado |

## 10. Testes

- Unitário (`apps/web/test/agenda-rules.test.ts`): `bookingFrom` com agora antes do expediente, no almoço, depois do expediente, num feriado, com a agenda cheia (n−1, n, n+1 dos horários) e sem horário livre.
- e2e (`tests/e2e/agenda-agendar-contato.spec.ts`): da ficha à Agenda com o contato vinculado e o horário; aviso da próxima consulta; contato sem nome; Cancelar volta para a ficha com o foco; `?agendar=` hostil; celular; inglês; axe.
- Agente: `resource` no `ContactDetail` (`google-contacts-routes.test.ts`).

## 11. Entrega

Uma PR para a `develop`, com changelog, `docs/google-agenda.md`, `docs/contatos.md` (se houver a seção da ficha) e capturas da ficha e do formulário.

## 12. Riscos

- O horário livre usa só o que a Agenda leu dos dois meses; um evento criado no Google depois pode ocupar o horário. O servidor confere de novo ao salvar (E5b).

## 13. Suposições

1. O endereço é `/agenda?agendar=<id>` (o plano E5e citava `?novo=1&contato=`; um parâmetro só basta).
2. A busca do horário vai até o fim do mês seguinte, e não 60 dias como o protótipo, para reaproveitar as leituras de mês já em cache.

## 14. Entrevista com o Pablo

Sem perguntas: o protótipo aprovado em 13/11 define o comportamento.
