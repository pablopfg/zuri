# Plano · Campos do agendamento (E5e)

Situação: aprovado em 13/11/2026 (protótipo v52–v56, aprovado pelo Pablo às 12:49 UTC). Sem perguntas: tudo coberto pelo protótipo aprovado e pelas decisões de 12/11 e 13/11 de `docs/planos/sons-menu-e-agenda-editavel.md`.
Origem: pedidos do Pablo em 12/11/2026 (itens 1, 2, 3 e 5 de "Ajustes pedidos depois da entrega 3", segunda rodada das 17:32 UTC) e em 13/11/2026 (v52, "Tipo e local separados")
Dependências: E5a (#329), E5b (#340), E5c (#344) e E5d (#345), todas mescladas

## 1. Resumo

O formulário do evento ainda é o da entrega 3: datas e horas do navegador (que mostram AM e PM num aparelho em inglês), "Dura" no lugar do término, o tipo junto do lugar e nenhum dado do paciente. A E5e troca pelo formulário aprovado no protótipo: nome do paciente, DDI, celular e e-mail; data, início e término de 24 h com máscara; tipo e local (Presencial ou Online, com Google Meet); situação e financeiro; observação. Os dados novos viajam com o evento nas propriedades privadas do Google, sem tabela nova. O vínculo a Contatos e os homônimos ficam para a E5f, e "Agendar" na ficha do contato para a E5g.

## 2. Contexto no sistema

- Formulário: `EventFormDialog` em `apps/web/src/pages/agenda/AgendaPage.tsx`; modelo em `apps/web/src/lib/agenda.ts` (`EventForm`, `blankForm`, `formOf`, `formBody`, `changedFields`, `DURATIONS`).
- Detalhes do evento: `EventDialog` no mesmo arquivo.
- Linha do tipo: `typeLine` e `bindsBooking` em `packages/shared/src/agenda-rules.ts`; a ficha do contato lê a mesma linha (`packages/shared/src/contacts.ts`).
- Servidor: `eventBody` e `readEvent` em `apps/agent/src/google/events.ts`; `createEvent` e `updateEvent` em `apps/agent/src/google/service.ts`; schemas `googleEventCreateSchema` e `googleEventUpdateSchema` em `packages/shared/src/google-schemas.ts`; Google simulado em `apps/agent/src/google/dev-google.ts`.
- Registro do dia (E5b): `apps/agent/src/google/record.ts` congela situação, horário, tipo, observação e vínculo.
- Escopo do Google: `calendar.events` já cobre `conferenceData` e `extendedProperties` (plano sons-menu, seção "Tipo e local separados", 13/11).

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Data em "dd/mm/aaaa" e horas em "hh:mm" de 00:00 a 23:59, com máscara (1430 vira 14:30), sem AM e PM em nenhum idioma; o início sugere de 15 em 15 min | Pablo, item 1 |
| CA2 | "Hora do término" no lugar de "Dura": começa 1 h depois e acompanha o início mantendo a duração; mudar o término mostra "Dura 1 h 30. Voltar para 1 h"; término antes do início é recusado | Pablo, item 2 |
| CA3 | Ordem dos campos: nome; DDI, celular e e-mail; data, início e término; tipo, local, situação e financeiro; observação | Pablo, item 3 |
| CA4 | Tipo: Consulta, Retorno, Avaliação física, os tipos que já estão na agenda, "Outro, digitar" e "Sem tipo (compromisso comum)". Local: Presencial ou Online. A primeira linha da observação no Google é sempre "Tipo \| Consultório" ou "Tipo \| Online" | protótipo v52 |
| CA5 | "Sem tipo" vira um compromisso comum: título, data, horário, situação e observação, sem DDI, celular, e-mail, local nem financeiro | Pablo, item 3 |
| CA6 | DDI de todos os países, Brasil primeiro e padrão, nomes em português pelo próprio navegador; guarda o código do país (BR, US, CA) | Pablo, 12/11 17:32 |
| CA7 | Celular formatado ao digitar: Brasil "(41) 99999-0000" (quem cola "+55" perde o 55); outros países em blocos de três. Celular e e-mail são conferidos | Pablo, 12/11 17:32 |
| CA8 | Financeiro: Não pago (padrão), Pago e Gratuito | Pablo, 12/11 17:32 |
| CA9 | Online pede ao Google uma chamada do Meet. Os detalhes mostram "Google Meet · meet.google.com/…" com "Copiar"; enquanto o Google cria, "O Google está criando o link da chamada…"; sem link (Meet desligado na conta), um aviso, e o evento continua salvo | protótipo v52 |
| CA10 | DDI, celular, e-mail e financeiro vão para `extendedProperties.private` do evento: não aparecem no Google Agenda, não pedem tabela nova, e o servidor só aceita a lista fixa de campos, com Zod e limites | plano sons-menu, item 5 |
| CA11 | Os detalhes mostram Tipo, Local, Paciente ("Sem vínculo com Contatos · +55 (41) 99999-0000"), Financeiro e "Observação no Google" com a linha do tipo e a observação | protótipo v52 |
| CA12 | O registro do dia congela também DDI, celular, e-mail e financeiro; "Enviar Pix" fica para a E8 | decisão de 13/11 |
| CA13 | pt-BR e en, teclado, leitor de tela (cada erro diz o campo), celular, tema escuro, axe sem violação séria, alvos de 44 px | regras de interface |

## 4. Escopo

**Entra:** os campos novos do formulário, os detalhes do evento, as propriedades privadas no `POST` e no `PATCH`, o Meet, o Google simulado, textos, testes, documentação e capturas.

**Fica fora (e onde vai parar):**

- Busca em Contatos, "Vincular", homônimos e "É outra pessoa": E5f.
- "Agendar" na ficha do contato (`/agenda?novo=1&contato=<id>`): E5g.
- Endereço do consultório no local Presencial: vem de Configurações › Consultório, que é da E6. Até lá, Presencial escreve "Consultório" na linha do tipo e mantém o local do evento como está.
- "Enviar Pix" e o valor do serviço: E8 (Financeiro).
- Ferramentas do agente e fluxos com os campos novos: seguem com os campos de hoje (issue #328 trata a regra das ferramentas).

## 5. Como funciona para o Pablo

1. "Novo evento" abre o formulário com o nome em foco, DDI Brasil, a data do dia escolhido, início na hora clicada e término 1 h depois, tipo "Consulta", local Presencial, situação Agendado e financeiro Não pago.
2. Ele digita "1430" no início: vira 14:30 e o término vai para 15:30. Muda o término para 16:00: "Dura 1 h 30. Voltar para 1 h".
3. Escolhe Online e salva: o toast diz "“Helena Prado” agendado para qua, 18/11 às 14:30. O Google Meet criou o link da chamada.". Os detalhes mostram o link com "Copiar".
4. "Sem tipo" esconde os campos do paciente, o local e o financeiro; o nome vira "Título".
5. Um erro (data inválida, celular sem DDD, término antes do início) aparece embaixo do formulário, o campo treme e recebe o foco.

## 6. Regras de negócio e limites

- Nome ou título: 1 a `GOOGLE_LIMITS.titleMax` caracteres (já vale hoje).
- DDI: um código da lista fixa de países (duas letras maiúsculas); outro valor é recusado com 400.
- Celular: só dígitos guardados, de 6 a 15 (padrão E.164); no Brasil, DDD mais 8 ou 9 dígitos (10 ou 11 no total).
- E-mail: até 254 caracteres, formato de e-mail.
- Financeiro: `unpaid`, `paid` ou `free`.
- Tipo digitado: até 60 caracteres, sem "|".
- Observação: até `GOOGLE_LIMITS.descriptionMax`, já com a linha do tipo.
- Término no mesmo dia do início e depois dele; até 24 h de duração não se aplica, porque o formulário não cruza a meia-noite (evento de vários dias continua só pelo Google).
- Evento de dia inteiro continua lido e mostrado, mas o formulário novo não cria evento de dia inteiro (a E5a tirou "Dia todo").
- `PATCH` manda só o que mudou; apagar o celular manda o campo vazio, que tira a propriedade no Google.

## 7. Desenho técnico

- `packages/shared/src/google-schemas.ts`: `patient` opcional no `POST` e no `PATCH` (`{ country, phone, email }`, cada um opcional e vazio para apagar), `payment` (`unpaid` | `paid` | `free` | `""`) e `meet` (`boolean`, só no `POST` e no `PATCH` que muda o local). Lista de países em `packages/shared/src/countries.ts` (código do país e de discagem).
- `apps/agent/src/google/events.ts`: `eventBody` escreve `extendedProperties.private` com chaves `zuriCountry`, `zuriPhone`, `zuriEmail` e `zuriPayment`, e `conferenceData.createRequest` (`hangoutsMeet`, `requestId` aleatório) quando `meet` é verdadeiro; `meet: false` manda `conferenceData: null`. `readEvent` lê essas chaves (só os valores que passam no mesmo schema) e `meet` (`{ state: "ready", url }` só com `https://meet.google.com/...`, `"pending"` ou nada).
- `service.ts`: `conferenceDataVersion=1` no `POST` e no `PATCH`.
- `record.ts`: a cópia congelada guarda os campos novos.
- `dev-google.ts`: guarda e devolve `extendedProperties` e cria um link do Meet de mentira.
- Web: `EventForm` ganha `kind`, `place`, `country`, `phone`, `email`, `payment` e `endTime` direto (sai `duration`); máscaras e conferências puras em `apps/web/src/lib/agenda-fields.ts` (com teste); o formulário vai para `apps/web/src/pages/agenda/EventForm.tsx`, saindo do `AgendaPage.tsx`, que passa de 2.300 linhas.

## 8. Custo e cotas do plano Free

- Sem rota nova, sem migration, sem escrita no banco além da cópia do registro do dia, que já existe (o tamanho de cada linha cresce algumas dezenas de bytes).
- Pedidos ao Google: os mesmos. O Meet vem na mesma chamada do `POST` ou do `PATCH`; "criando o link" lê de novo pela leitura normal da Agenda.
- JS inicial: a Agenda é carregada sob demanda e a lista de países fica no pedaço dela. Medir com `npm run size` (teto 141,1 kB).

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Campo extra ou chave inventada nas propriedades privadas | schema estrito; o servidor escreve só as quatro chaves `zuri*` | rota recusa chave fora da lista (400) |
| Texto hostil vindo do Google nas propriedades (evento de outra pessoa) | `readEvent` só aceita valores que passam no schema; o resto some | evento com propriedade inválida volta sem ela |
| Link do Meet falso (`javascript:`, outro domínio) | só `https://meet.google.com/` com código válido vira link | evento com outro endereço não mostra link |
| Dado do paciente visível para convidados | `extendedProperties.private` só aparece na cópia desta agenda | documentado; Zuri nunca convida ninguém |
| Celular e e-mail no log | nada de `console.log`; o log de invocação não leva corpo | revisão |

## 10. Testes

- Unitário (`apps/web/test/agenda-fields.test.ts`): máscaras de data, hora e celular (Brasil e outros, "+55" colado), conferência de data (31/02 recusada), hora (24:00 recusada, 23:59 aceita), celular (9, 10, 11 e 12 dígitos no Brasil; 5, 6, 15 e 16 nos outros), e-mail.
- Unitário (`packages/shared`): schema com cada campo no limite (n−1, n, n+1) e a lista de países.
- Agente (`apps/agent/test/google-events.test.ts` e rotas): `eventBody` com propriedades e Meet, `readEvent` com propriedades válidas e hostis e com Meet pronto, pendente e falso; o registro do dia guarda os campos.
- e2e (`tests/e2e/agenda-campos.spec.ts`): criar consulta Online com celular e ver o Meet nos detalhes; término acompanha o início e "Voltar para 1 h"; "Sem tipo" esconde os campos; erros de data, hora, término e celular; inglês sem AM e PM; celular; axe.
- Os specs da Agenda que usam o formulário (`agenda-arrastar`, `agenda-formulario`, `agenda-travas`) passam a usar os campos novos.

## 11. Entrega

Uma PR para a `develop`, com fragmento de changelog, README ("O que já funciona" da Agenda), `docs/google-agenda.md` e capturas do formulário e dos detalhes (computador e celular, claro e escuro, antes e depois).

## 12. Riscos

- Mudar o formulário quebra testes de entregas anteriores: eles mudam no mesmo PR, sem perder nenhuma verificação.
- Conta do Google Workspace com o Meet desligado: o `POST` grava sem link; a tela avisa.

## 13. Suposições

- Presencial sem endereço até a E6 (seção 4).
- A lista de países segue a do protótipo (`DDI_RAW`), com o mesmo código de discagem.
- O formulário não abre evento de vários dias: quem precisar usa o Google Agenda, como já é hoje para "Dia todo".

## 14. Entrevista com o Pablo

Sem perguntas: tudo coberto pelo protótipo aprovado em 13/11/2026 (v52–v56) e pelas decisões de 12/11.
