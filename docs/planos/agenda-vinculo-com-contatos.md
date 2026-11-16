# Plano · Vínculo do agendamento com Contatos e homônimos (E5f)

Situação: aprovado em 13/11/2026 (protótipo v52–v56, aprovado pelo Pablo às 12:49 UTC). Sem perguntas: tudo coberto pelo protótipo aprovado, pelas decisões de 12/11 (homônimos são pessoas diferentes e nunca se ligam sozinhos) e pelo item 5 de "Ajustes pedidos depois da entrega 3" e o item 4 da v52 de `docs/planos/sons-menu-e-agenda-editavel.md`.
Origem: pedidos do Pablo em 12/11/2026 (item 5, segunda rodada das 17:32 UTC) e em 13/11/2026 (v52, "Homônimos no agendamento")
Dependências: E5e (#347), mesclada

## 1. Resumo

Na E5e, o nome do paciente é só texto: o celular e o e-mail são digitados à mão e nada liga a consulta à pessoa de Contatos. A E5f faz o campo do nome procurar na cópia de Contatos que a Zuri já tem, mostra cada pessoa com o celular, a data de nascimento e a última consulta, e deixa o Pablo vincular a consulta ao contato certo. Nada se vincula sozinho. Com dois ou mais contatos do mesmo nome, o Pablo escolhe o certo ou toca em "É outra pessoa", que pede o celular. O vínculo vai para as propriedades privadas do evento no Google, como os campos da E5e.

## 2. Contexto no sistema

- Formulário e detalhes: `EventFormDialog` e `EventDialog` em `apps/web/src/pages/agenda/AgendaPage.tsx`; campos da E5e em `apps/web/src/pages/agenda/AppointmentFields.tsx`; modelo em `apps/web/src/lib/agenda.ts`.
- Cópia de Contatos: `GoogleContacts` em `apps/agent/src/google/contacts.ts`. `search` já procura por nome sem acento (`searchText`), `sameName` acha os homônimos pelo índice do nome, `summary` devolve celular, e-mail e data de nascimento (`birthdayFull`). A data de nascimento já é guardada: o `FIELDS_VERSION` não sobe.
- Rotas: `GET /api/contacts` e `GET /api/contacts/:id` em `apps/agent/src/api/google.ts`.
- Propriedades privadas do evento (E5e): `privateFields` em `apps/agent/src/google/events.ts`; schemas em `packages/shared/src/google-schemas.ts`.
- Registro do dia (E5b): `apps/agent/src/google/record.ts`, tabela `zur_agenda_record` (dia na chave primária); schema do backup `agendaDay` em `packages/shared/src/backup.ts`.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Com duas letras ou mais no nome, a Zuri procura em Contatos (a cópia, sem chamar o Google), sem acento: primeiro os nomes que começam com o que foi digitado ("carla m" acha "Carla Mendes"); se nenhum começa assim e o texto tem três letras ou mais, cada palavra digitada casa com o começo de uma palavra do nome ("mendes" acha "Carla Mendes"). Até 6 pessoas, só quem tem celular ou e-mail; o nome exato digitado vem primeiro | item 5 |
| CA2 | Cada linha mostra o nome, o celular, a data de nascimento ("sem data de nascimento" quando falta) e a última consulta registrada. Quem já tem consulta registrada vem primeiro, a mais recente antes. A última linha é sempre "Agendar “nome” sem vínculo" | item 5; 17:32 |
| CA3 | Escolher um contato preenche nome, DDI, celular e e-mail só para leitura, com "Vinculado a Carla Mendes, nasc. 02/09/1995" e "Remover vínculo" | item 5 |
| CA4 | Mudar o nome depois de vincular, ou "Remover vínculo", desfaz o vínculo e limpa o celular e o e-mail que vieram do contato | item 5 |
| CA5 | Nome igual ao de um só contato, sem vínculo: "“Paula Régis Amaral” está em Contatos" com "Vincular". Nunca vincula sozinho | item 5 |
| CA6 | Nome igual ao de dois ou mais contatos: "N contatos chamados “nome”…", a lista abre, e salvar sem escolher é recusado embaixo do nome. "É outra pessoa" deixa salvar sem vínculo e torna o celular obrigatório; o servidor recusa o mesmo caso sem celular | v52, item 4 |
| CA7 | O vínculo vai em `extendedProperties.private.zuriContact` (o `resourceName` do contato no Google, que não muda quando Contatos é desligado e ligado de novo). Com vínculo, o servidor exige que o contato exista na cópia e que o título seja o nome dele, e não guarda celular nem e-mail no evento: os dados são os de Contatos | item 5 |
| CA8 | Os detalhes mostram "Vinculado a …, nasc. …" com "Homônimo" quando há outro contato do mesmo nome e "Abrir em Contatos"; sem vínculo, "Sem vínculo com Contatos" com o celular e "Vincular", ou "Pessoa nova, com o mesmo nome de N contatos" | v52, item 4 |
| CA9 | Contato vinculado que saiu da cópia (apagado no Google ou fora das etiquetas): os detalhes dizem "O contato vinculado não está mais em Contatos" e o formulário abre sem vínculo | suposição 1 |
| CA10 | O registro do dia guarda o vínculo, e é dele que sai a "última consulta" | decisão de 13/11 |
| CA11 | Contatos desligado: o nome volta a ser só texto, como na E5e, sem busca nem aviso | item 5 |
| CA12 | pt-BR e en, teclado (setas, Enter, Esc na lista), leitor de tela (combobox com `aria-activedescendant` e quantos resultados), celular, tema escuro, axe, alvos de 44 px | regras de interface |

## 4. Escopo

**Entra:** busca no campo do nome, vínculo, homônimos, "É outra pessoa", detalhes, o vínculo nas propriedades privadas e no registro do dia, conferência no servidor, textos, testes, documentação e capturas.

**Fica fora (e onde vai parar):**

- "Agendar" na ficha do contato: E5g.
- Responsável pelo paciente (mensagens para o pai ou a mãe, "As mensagens vão para…"): entra com as automações de confirmação (E7 em diante).
- Automações que usam o vínculo (confirmação, aniversário, avaliação, Financeiro): cada uma na sua entrega; esta grava o vínculo que elas vão ler.
- Ferramentas do agente e fluxos com o vínculo: seguem como hoje (issue #328).

## 5. Como funciona para o Pablo

1. Ele digita "carla m" no nome. Abre a lista: "Carla Mendes · (41) 99999-0000 · nasc. 02/09/1995 · última consulta em 04/11" e, por último, "Agendar “carla m” sem vínculo".
2. Escolhe Carla Mendes: nome, DDI, celular e e-mail ficam só para leitura com "Vinculado a Carla Mendes, nasc. 02/09/1995" e "Remover vínculo". O foco vai para a data.
3. Digita "Ana Souza", que tem dois contatos: "2 contatos chamados “Ana Souza”. Escolha o certo na lista, pelo telefone e pela data de nascimento, ou toque em “É outra pessoa”." Salvar sem escolher traz o erro embaixo do nome.
4. Toca em "É outra pessoa": o celular passa a ser obrigatório. Salva; os detalhes mostram "Pessoa nova, com o mesmo nome de 2 contatos".
5. Nos detalhes de uma consulta sem vínculo, "Vincular" abre o formulário com a lista já aberta.

## 6. Regras de negócio e limites

- Busca: de 2 a 100 caracteres (`queryMax`); até 8 palavras de até 40 letras cada; a busca por palavra em toda a cópia só de 3 letras em diante; até 6 pessoas, das 200 primeiras achadas; espera 200 ms depois da última tecla; só a cópia local.
- Listas para o banco vão em lotes de 90 valores (`SQL_BATCH`): o SQLite do Durable Object aceita 100 por comando.
- Homônimos: nome igual depois de `searchText`; conta até 20 (`sameName`).
- `zuriContact`: `people/` seguido de 1 a 40 letras, números, `_` ou `-`; outro valor é recusado (400) e, vindo do Google, descartado.
- Com vínculo: o título precisa ser o nome do contato (sem acento e sem diferença de maiúsculas); se não for, 400 `VALIDATION_FAILED`. País, celular e e-mail não vão junto (o servidor apaga as três propriedades).
- Sem vínculo e com 2 ou mais contatos do mesmo nome: o celular é obrigatório no `POST` e no `PATCH` que muda o título, o tipo ou o celular.
- Mudar o nome de uma consulta vinculada pelo `PATCH` sem tirar o vínculo é recusado; tirar o vínculo manda `contact: ""`. Um vínculo cujo contato saiu da cópia (ou com Contatos desligado) conta como nenhum: mudar o nome passa e tira o vínculo no Google. A ferramenta `update_calendar_event` também tira o vínculo quando muda o nome.
- "Sem tipo" (compromisso comum) não tem vínculo; mudar para "Sem tipo" tira o vínculo. O servidor confere isso também.

## 7. Desenho técnico

- `packages/shared/src/google-schemas.ts`: `contact` opcional no `POST` e no `PATCH` (regex de `resourceName`, `""` para tirar). `CONTACT_RESOURCE` em `packages/shared/src/countries.ts`, junto das outras regras do paciente.
- `apps/agent/src/google/events.ts`: `privateFields` lê e escreve `zuriContact`; o evento lido ganha `contact`.
- `apps/agent/src/google/contacts.ts`: `forBooking(query)` (primeiro a faixa do índice do nome com o texto digitado; sem ninguém, o começo de cada palavra em toda a cópia), `homonyms(name)`, `byResource(resourceName)` e `idsOf(resourceNames)`.
- `apps/agent/src/google/record.ts`: `lastVisits(people)` devolve o último dia de cada vínculo nos últimos 400 dias, só das consultas cujo título é o nome do contato, pelo índice `zur_agenda_record_contact` (migration 43, expressão `json_extract` do vínculo, só as linhas com vínculo).
- `apps/agent/src/api/google.ts`: `GET /api/contacts?q=…&for=booking` devolve `{ people, same }`; o `POST` e o `PATCH` de `/google/events` conferem o vínculo e os homônimos antes de chamar o Google. O evento lido leva `contactId` (o id da cópia) quando o vínculo está na cópia e o nome do contato ainda é o título.
- Web: `EventForm` ganha `contact` e `otherPerson`; a busca e a lista em `apps/web/src/pages/agenda/PatientSearch.tsx` (combobox), carregados com a Agenda.

## 8. Custo e cotas do plano Free

- Nenhum pedido novo ao Google: a busca lê só a cópia de Contatos e o registro do dia.
- Banco: o nome digitado desde o começo ("carla m") lê uma faixa do índice do nome (20 linhas, medido em `free-tier-budget.test.ts` com 500 contatos). Só quando nenhum nome começa assim, por exemplo um sobrenome digitado primeiro, a busca percorre a cópia (508 linhas com 500 contatos; 5.000 no máximo). A última consulta sai do índice novo do registro (migration 43): cerca de duas linhas por pessoa achada (319 com 150 pessoas e 20 consultas vinculadas, medido). Com espera de 200 ms entre teclas, 200 buscas num dia ficam abaixo de 100 mil linhas lidas no caso comum, 2% das 5 milhões por dia do plano gratuito.
- Uma migration só de acréscimo (43): o índice `zur_agenda_record_contact` em `zur_agenda_record`, só com as linhas que têm vínculo. Custa uma linha a mais por consulta vinculada que o registro do dia guarda (umas 10 por dia).
- JS inicial: a busca fica no pedaço da Agenda. Medir com `npm run size` (teto 141.100 B).

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Vincular a consulta a um contato que não é o do nome (dados de uma pessoa na consulta de outra) | o servidor exige contato existente e título igual ao nome dele | rota recusa título diferente (400) |
| `zuriContact` hostil vindo do Google (agenda compartilhada) | só o formato de `resourceName` passa; o resto some; contato fora da cópia mostra "não está mais em Contatos" | evento com valor hostil volta sem vínculo |
| Homônimo vinculado sozinho | nenhum caminho vincula sem o toque do Pablo; o servidor só grava o `contact` que veio do formulário | e2e: nome igual a um contato salva sem vínculo |
| Busca usada para listar Contatos inteiro | mínimo de 2 caracteres, até 6 pessoas, sessão exigida (como `GET /api/contacts`) | rota com 1 caractere devolve vazio |
| Celular e e-mail do contato copiados para o Google | com vínculo, as três propriedades do paciente saem do evento, em qualquer `PATCH` | rota com vínculo grava sem `zuriPhone` (SEC-E5f-04) |
| Busca que derruba a rota (500): listas com mais de 100 valores, `LIKE` com mais de 50 bytes | lotes de 90 (`SQL_BATCH`), `instr` no lugar de `LIKE`, 8 palavras de até 40 letras | SEC-E5f-01 e SEC-E5f-03 |
| Vínculo forjado num evento de agenda compartilhada aponta para outro contato | `contactId` e a última consulta só valem com o título igual ao nome do contato | SEC-E5f-05 |
| O agente muda o nome de uma consulta vinculada e o vínculo fica errado | `update_calendar_event` tira o vínculo com o nome novo | SEC-E5f-06 |

## 10. Testes

- Agente (`google-routes.test.ts`): busca por começo de palavra, sem acento, limite de 6, `same` de 0, 1 e 2; `POST` com vínculo válido, vínculo de contato inexistente, título diferente, homônimo sem celular (400) e com celular; `PATCH` que tira o vínculo; `zuriContact` hostil (`google-hardening.test.ts`); `lastVisits` no limite de 400 dias (n−1, n, n+1); backup com o vínculo.
- Unitário (`apps/web/test/agenda-fields.test.ts`): o que desfaz o vínculo.
- e2e (`tests/e2e/agenda-vinculo.spec.ts`): buscar e vincular; mudar o nome desfaz; homônimos e "É outra pessoa"; um só contato com "Vincular"; detalhes com "Homônimo" e "Pessoa nova…"; teclado; inglês; celular; axe.

## 11. Entrega

Uma PR para a `develop`, com fragmento de changelog, README ("O que já funciona" da Agenda), `docs/google-agenda.md`, a decisão "sem internet, a mudança volta e pede Tentar de novo" em `.claude/memoria/decisoes.md` (prometida na E5d) e capturas do formulário com a lista e dos detalhes.

## 12. Riscos

- Mais de 200 contatos com as palavras digitadas: a busca guarda os 200 primeiros por nome e pode deixar alguém de fora; o Pablo digita mais uma letra.
- Um contato que muda de nome no Google continua vinculado, mas o título da consulta fica com o nome antigo até o Pablo editar.

## 13. Suposições

1. O vínculo guarda o `resourceName` do Google, e não o id da cópia, porque o id muda quando Contatos é desligado e ligado de novo.
2. "Clientes do consultório primeiro" (protótipo: etiqueta "Consultório") vira "quem já tem consulta registrada primeiro": as etiquetas do Google são do Pablo e mudam de nome; a consulta registrada é um fato da própria agenda.
3. A "última consulta" vem do registro do dia (E5b) e só conta consultas vinculadas, por isso começa vazia e cresce com o uso.
4. A busca procura em todas as palavras do nome só quando nenhum nome começa com o que foi digitado: assim o caso comum (o nome digitado na ordem) lê poucas linhas do banco. "carla" mostra as Carlas, e "Ana Carla" aparece com "ana c" ou com "carla" quando não houver nenhuma Carla.

## 14. Entrevista com o Pablo

Sem perguntas: tudo coberto pelo protótipo aprovado em 13/11/2026 (v52–v56) e pelas decisões de 12/11.
