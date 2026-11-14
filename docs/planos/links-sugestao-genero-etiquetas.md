# Plano · Textos clicáveis, sugestão de horário, gênero do contato e etiquetas

Situação: esperando o Pablo (protótipo pronto para teste)
Origem: pedido do Pablo em 14/11/2026, 12:25 (horário de Brasília)
Dependências: E5f (#348), E5g (#350) e E6a (#351) mescladas; protótipo aprovado antes do código (decisão de 12/11)

## 1. Resumo

Quatro pedidos, que viram três PRs depois da aprovação do protótipo:

1. **Textos clicáveis** com cara de link: cor de destaque, sublinhado e reação ao passar o mouse e ao foco. Só interface (PR A).
2. **Agenda:** o aviso de horário recusado diz o motivo no título ("Sábado não tem atendimento", "Horário de almoço") e sugere até três horários que **encostam** em consultas já marcadas, para não deixar buracos na semana. A regra fica numa função pura em `packages/shared`, usada pela interface. O servidor continua conferindo cada agendamento como hoje (PR B).
3. **Gênero do contato:** vem do Google Contatos (campo `genders`), pode ser mudado na Zuri e nunca é adivinhado pelo nome. As listas de parentesco e os textos usam a forma certa, e uma ligação que não combina ("Bruno" como "Filha") aparece com aviso e o botão para trocar (PR C).
4. **Etiquetas abaixo do nome:** são as etiquetas do Google Contatos, sem repetir. Saem as duplicações de hoje: a mesma etiqueta no topo e no cartão "Etiquetas", e a observação do nome igual a uma etiqueta (PR C).

## 2. Contexto no sistema

- Protótipo: `docs/planos/modelos-frontend/prototipo-interativo.html`, versão de teste publicada à parte. O protótipo principal só muda depois da aprovação.
- Agenda:
  - Regras: `packages/shared/src/agenda-rules.ts` (`appointmentProblem`, `nextFreeSlot`, `AGENDA_RULES`).
  - Tela: `apps/web/src/lib/agenda-rules.ts` (`nextFree`) e `apps/web/src/pages/agenda/AgendaPage.tsx` (linhas 471, 509, 519 e 2204).
  - Servidor: `apps/agent/src/google/booking.ts` confere as regras fixas e depois o choque com o calendário (linhas 159 a 175).
- Contatos:
  - Sincronização: `apps/agent/src/google/contacts.ts` (`PERSON_FIELDS` na linha 58, `FIELDS_VERSION = 3` na 64, `SYSTEM_GROUPS` na 66, `summary()` na 1080).
  - Esquemas: `packages/shared/src/contacts-schemas.ts` e os tipos em `contacts.ts`.
  - Ficha: `apps/web/src/pages/contacts/ContactCard.tsx`, com as etiquetas no topo (linha 134) e de novo no cartão "labels" (linha 429).
- Decisões que valem aqui:
  - Contatos só leitura por etiqueta, teto de 5.000.
  - "Nome Completo / Categoria" guarda só o nome.
  - Homônimos são pessoas diferentes.
  - Um ajuste, um lugar (13/11).
  - Ajuste novo entra primeiro no protótipo (12/11).
  - O backup exclui `zur_contact_*`.
- Migrations: a última na `develop` é a 43 (`agenda_record_contact`). A próxima livre é a **44**; confirmar de novo antes de criar.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Todo texto que leva a algum lugar (link, "Ver em…", "Mudar", "Definir") tem a cor de destaque e o sublinhado, nos dois temas, com contraste ≥ 4,5:1. Texto comum nunca recebe esse estilo. | Pablo |
| CA2 | Ao tocar num horário recusado, o título do aviso diz o motivo em até 6 palavras e o texto abaixo traz o detalhe, sem repetir o título. | Pablo |
| CA3 | Os horários sugeridos seguem esta ordem: primeiro o que fecha um intervalo entre duas consultas, depois o que encosta numa consulta, depois a borda do expediente ou do almoço num dia com consultas, depois a borda num dia vazio e por fim o primeiro horário livre. | Pablo |
| CA4 | Nenhuma sugestão cai em horário que o servidor recusaria. O servidor confere de novo ao gravar. Se o horário foi ocupado nesse meio tempo, aparece "Esse horário acabou de ser ocupado" e novas sugestões. | Pablo (segurança) |
| CA5 | O gênero vem do Google, a Zuri não deduz pelo nome e o Pablo pode mudar ou escolher "Não informar". | Pablo |
| CA6 | As listas de parentesco mostram só as formas que combinam com o gênero. Uma ligação que não combina mostra o aviso e o botão "Trocar para “Filho”". | Pablo |
| CA7 | Abaixo do nome aparecem as etiquetas do Google, cada nome uma vez só (sem diferença por maiúscula, acento ou espaço), sem as etiquetas do sistema e sem repetir a observação do nome. | Pablo |

## 4. Escopo

**Entra:**

- **PR A:** estilo de link na interface (tokens `--link`, `--link-line`, `--link-bg`).
- **PR B:**
  - `suggestSlots` em `packages/shared`.
  - Os textos de motivo, com título e detalhe.
  - A lista de sugestões no aviso, no formulário e ao arrastar uma consulta.
  - A marca "Encosta numa consulta" nos horários do formulário.
- **PR C:**
  - Gênero na sincronização e o ajuste da Zuri, com a migration 44.
  - A linha "Gênero" na ficha.
  - Parentesco pelo gênero.
  - Etiquetas sem duplicação.

**Fica fora (e onde vai parar):**

- As ligações de família feitas na Zuri (responsável, mensagens que vão para a mãe) ainda não existem no código, só no protótipo. Quando forem feitas, usam `famFits` deste plano. Fica como pendência em `progresso.md`.
- Mudar o gênero no Google: não faremos, porque Contatos é só leitura.
- Gênero em textos enviados a pacientes: entra com os modelos de mensagem (E6c/E7), usando a variável deste plano.

## 5. Como funciona para o Pablo

### Fluxo 1 · Textos clicáveis

1. Links no meio do texto e botões de texto ("Ver em Avaliações", "Mudar", "Definir") aparecem em verde, sublinhados.
2. Ao passar o mouse, o sublinhado fica cheio e ganha um fundo leve. No teclado, o anel de foco de sempre. No celular, a área de toque continua com 44 px.
3. Links do menu, abas e botões com borda não mudam.

### Fluxo 2 · Horário recusado na Agenda

1. O Pablo toca no sábado às 10:00. Aparece o aviso **"Sábado não tem atendimento"**, com o detalhe "A agenda atende de segunda a sexta. Dá para mudar em Configurações › Agenda."
2. Abaixo vem "Horários que mantêm a agenda sem buracos", com até 3 opções. A primeira tem a etiqueta "Recomendado" e recebe o foco. Cada opção diz o porquê ("Logo depois da consulta das 09:00").
3. Ao tocar numa opção, a Zuri confere de novo se ela continua livre. Se não estiver, o aviso volta com "Esse horário acabou de ser ocupado" e a lista refeita.
4. Sem horário nos próximos 60 dias, aparece "Nenhum horário livre nos próximos 60 dias", com o link para Configurações › Agenda.
5. No formulário, os horários que encostam numa consulta ganham a marca verde "Encosta numa consulta: deixa a agenda sem buracos".
6. Os outros títulos possíveis:
   - Use minutos de 5 em 5
   - Consulta curta demais
   - Consulta longa demais
   - Esse horário já passou
   - Data a mais de um ano
   - Feriado: {nome}
   - Sem expediente: {motivo}
   - Fora do horário de atendimento
   - Horário de almoço
   - Horário já ocupado

Estados:

- **Carregando:** a lista só aparece com a semana já lida.
- **Erro ao ler a agenda:** sem sugestões, com "Não deu para conferir a agenda. Tente de novo."
- **Leitor de tela:** o título é o nome do diálogo, e cada opção é um botão com o horário e o porquê.

### Fluxo 3 · Gênero do contato

1. Na ficha, a linha "Gênero" mostra "Masculino · do Google Contatos" e o botão "Mudar". Sem dado: "Não informado" e "Definir".
2. "Mudar" abre as opções:
   - "Como no Google Contatos (Masculino)"
   - Feminino
   - Masculino
   - Não informar
3. Ao salvar, o aviso diz quantas ligações de parentesco deixaram de combinar.
4. Ao criar uma ligação, as listas mostram só "Filho", "Irmão" e assim por diante para um contato masculino. Sem gênero, aparecem as duas formas e a dica "Lucas sem gênero definido: as duas formas aparecem. Definir o de Lucas".
5. Uma ligação antiga que não combina mostra, em âmbar: "Bruno está como masculino, mas a ligação diz “Filha”. Trocar para “Filho”".
6. Empresas (nome igual à organização) não têm a linha.

### Fluxo 4 · Etiquetas

1. Abaixo do nome vêm as etiquetas do Google, numa linha que quebra, com o nome acessível "Etiquetas do Google Contatos".
2. "Favorito" (o starred do Google) vira a estrela.
3. O cartão "Etiquetas" mais abaixo sai, porque repetia o topo.

### Textos visíveis

Vão para `pt-BR-agenda.ts`/`pt-BR-contacts.ts` e o `en` correspondente, com as chaves definidas no PR. Os principais:

| pt-BR | en |
| --- | --- |
| Horários que mantêm a agenda sem buracos | Times that keep the schedule without gaps |
| Recomendado | Recommended |
| Fecha o intervalo entre as consultas das {a} e das {b} | Closes the gap between the {a} and {b} appointments |
| Logo depois da consulta das {hora} | Right after the {time} appointment |
| Logo antes da consulta das {hora} | Right before the {time} appointment |
| Esse horário acabou de ser ocupado | This time was just taken |
| Nenhum horário livre nos próximos 60 dias | No free time in the next 60 days |
| Encosta numa consulta: deixa a agenda sem buracos | Next to an appointment: keeps the schedule without gaps |
| Gênero | Gender |
| Como no Google Contatos ({valor}) | As in Google Contacts ({value}) |
| Não informar | Don't set |
| {nome} está como {gênero}, mas a ligação diz “{papel}”. | {name} is set as {gender}, but the link says “{role}”. |
| Trocar para “{papel}” | Change to “{role}” |

## 6. Regras de negócio e limites

| Regra | Valor | No limite | Erro |
| --- | --- | --- | --- |
| Dias olhados para sugestão colada | 7 dias com atendimento a partir do dia tocado | O 8º dia não entra; se nada colar, cai no primeiro livre em 60 dias | sem erro, lista vazia com o texto |
| Sugestões mostradas | 3 | a 4ª não aparece | - |
| Horários candidatos | grade de 30 min, mais o fim de cada consulta, o início menos a duração, e as bordas do expediente e do almoço | só minutos múltiplos de 5 | - |
| Compromisso pessoal (reunião) | ocupa o horário, mas não conta como consulta para "encostar" | - | - |
| Duração inválida (< 15 ou > 240 min) | sem sugestões; o título diz "Consulta curta/longa demais" | 15 e 240 aceitam | `agenda.rule.short`/`long` |
| Dia congelado (eventos do dia congelam à 0h) | não sugere o dia de hoje se ele estiver congelado | - | servidor recusa com o código de hoje |
| Gênero | `f`, `m` ou vazio; o Google traz `female`, `male`, `unspecified` ou texto livre | texto livre ou `unspecified` vira vazio | valor fora do enum: rota 400 `validation` |
| Etiquetas abaixo do nome | todas, sem repetir; nome comparado em minúsculas, sem acento e com espaços juntados | - | - |
| Concorrência | duas abas sugerem o mesmo horário: a segunda gravação recebe `clash` do servidor e a tela mostra o aviso de ocupado | - | `error.agendaRule.clash` |

Fuso: tudo em minutos do dia no fuso do dono (`zonedParts`), como `nextFreeSlot`. Horário de verão não existe no fuso padrão desde 2019, mas a função não assume isso: usa os minutos que `zonedParts` devolver.

## 7. Desenho técnico

### Arquivos

| Arquivo | Cria ou muda | Para quê |
| --- | --- | --- |
| `apps/web/src/styles.css` (tokens) e componentes de link | muda | PR A: `--link*`, `.link`, sublinhado e hover |
| `packages/shared/src/agenda-rules.ts` | muda | `suggestSlots()` e `slotReason()` puras, com os níveis (tiers) |
| `packages/shared/test/agenda-rules.test.ts` | muda | casos n-1/n/n+1 e ordem dos níveis |
| `apps/web/src/lib/agenda-rules.ts` | muda | `suggest()` monta a entrada a partir dos eventos lidos |
| `apps/web/src/pages/agenda/AgendaPage.tsx` | muda | aviso com título, detalhe e lista; reconferência antes de usar |
| `apps/agent/src/google/booking.ts` | não muda a regra | continua a conferir; ganha teste de que a sugestão passa nele |
| `apps/agent/src/google/contacts.ts` | muda | `genders` em `PERSON_FIELDS`, `FIELDS_VERSION` 4, gênero no `data` e no resumo, rótulos sem repetir |
| `packages/shared/src/contacts.ts` e `contacts-schemas.ts` | muda | `ContactGender`, `gender`/`genderSource` no resumo, esquema da rota |
| `apps/agent/src/db/migrations.ts` | muda | migration 44 `contact_gender` |
| `packages/shared/src/kinship.ts` | cria | papéis por gênero (`ROLE_FORMS`), `fits()` e `otherForm()` |
| `apps/web/src/pages/contacts/ContactCard.tsx` | muda | linha Gênero, diálogo, etiquetas sem o cartão repetido |
| `packages/shared/i18n/pt-BR-agenda.ts`, `pt-BR-contacts.ts` e `en` | muda | textos |

### A regra de sugestão (`suggestSlots`)

Função pura, sem relógio próprio. Recebe `today`, `nowMinute`, `hours`, `length`, `days` e `bookedOn(day)`, que devolve `{ start, end, kind: "appointment" | "busy" }`. O `kind` usa `isAppointment`, já existente.

1. Para cada dia, de `day` até 7 dias com atendimento, monta os candidatos e descarta os que `appointmentProblem` recusa. Assim, nada que o servidor recusaria entra na lista.
2. Classifica cada candidato:
   - nível 0: fecha um intervalo entre duas consultas;
   - nível 1: encosta numa consulta;
   - nível 2: borda num dia com consultas;
   - nível 3: borda num dia vazio;
   - nível 4: o resto, pelo menor espaço até uma consulta.
3. Ordena por nível, depois pela distância ao horário tocado. No mesmo dia conta a diferença em minutos; nos dias seguintes, `dia × 1440 + diferença / 10`.
4. Devolve as 3 primeiras. Sem nenhuma, devolve `nextFreeSlot` em 60 dias com o nível 5, ou nada.
5. Teto de trabalho: 7 dias × (≈ 20 da grade + 4 por consulta) candidatos, cada um conferido contra as consultas do dia. São menos de 5.000 comparações, sem efeito na CPU da tela.

A tela nunca grava sozinha. A sugestão só preenche o formulário, e o servidor confere de novo (`booking.ts`). Se a leitura da agenda falhou, a tela não sugere nada: fecha para o lado seguro.

### Rotas e contratos

- `PATCH /api/contacts/:id/gender` com corpo `{ gender: "f" | "m" | "none" | "google" }`. `google` apaga o ajuste da Zuri.
  - Esquema Zod `.strict()`, corpo até 1 KB.
  - Exige a sessão, como as outras rotas de contatos, com o CSRF de sempre.
  - Respostas: 404 `not_found` para um id que não existe na cópia; 400 `validation` para um valor fora da lista.
- `ContactSummary` ganha `gender: "f" | "m" | null` e `genderSource: "google" | "zuri" | null`. `labels` passa a vir sem nome repetido.
- Palavra nova em `ROUTE_WORDS` (`apps/agent/src/log.ts`): `gender`.

### Banco

Migration 44 (`.claude/rules/migrations.md`, só acréscimo):

```sql
CREATE TABLE zur_person_gender (
  resource TEXT PRIMARY KEY,           -- "people/c1", estável no Google
  gender TEXT NOT NULL CHECK (gender IN ('f', 'm', 'none')),
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
```

- Chave pelo `resource`, não pelo id da cópia. Assim, a escolha do Pablo sobrevive a desligar e religar os contatos, que refaz a cópia.
- O prefixo não é `zur_contact_`. O backup exclui `zur_contact_*`, que é cópia do Google, mas esta tabela é dado do Pablo e entra no backup.
- Volume: no máximo uma linha por contato (5.000). Cada escolha grava uma linha.
- O gênero do Google fica no `data` do contato, que já é gravado só quando muda.

### Gênero na sincronização

- `PERSON_FIELDS` ganha `genders`, e `FIELDS_VERSION` sobe para 4. A próxima sincronização relê tudo uma vez, como já acontece quando um campo entra.
- O esquema `googlePersonSchema` ganha `genders: list(z.object({ value: text.optional() }).loose())`. Só `female`/`male` (sem diferença de maiúsculas) viram `f`/`m`; o resto vira vazio.
- `addressMeAs` e o texto livre não são guardados.

### Parentesco (`kinship.ts`)

- Pares fixos de formas:
  - Mãe/Pai, Filha/Filho, Irmã/Irmão, Avó/Avô, Neta/Neto, Tia/Tio, Sobrinha/Sobrinho, Prima/Primo, Esposa/Marido.
  - Neutros: Cônjuge, Responsável legal.
- `fits(papel, gênero)`: um papel neutro sempre combina; sem gênero, tudo combina.
- `otherForm(papel)` só troca para a forma que combina.
- As relações que vêm do Google (`relations`) são texto do Google e aparecem como estão. O aviso de "não combina" vale para as ligações feitas na Zuri, quando elas existirem.
- Textos da Zuri que falam do contato usam frases neutras ("As mensagens para Bruno vão para Carla") ou chaves com variantes `.f`, `.m` e `.n`. A neutra é o padrão quando não há gênero.

### Etiquetas

- Os rótulos de `summary()` passam por um conjunto pelo nome normalizado (`normalize("NFD")`, sem acento, minúsculas e espaços juntados), e fica a primeira grafia em ordem alfabética.
- Os grupos do sistema (`SYSTEM_GROUPS`) continuam fora. O `starred` vira um booleano `starred` no resumo, mostrado como estrela.
- Um rótulo igual à observação do nome ("Paciente" em "Ana Souza / Paciente") não se repete: fica só a observação.
- O cartão "labels" de `ContactCard.tsx` sai. Os textos sem uso saem do catálogo, porque o lint de i18n acusa chave sem uso.
- Etiqueta renomeada no Google: o nome novo chega na próxima leitura das etiquetas (no máximo 1 h, ou na hora ao abrir o seletor). Uma etiqueta que aparece numa ligação e ainda não está na lista adianta essa leitura, uma vez por sincronização.
- Etiqueta apagada no Google: some na próxima sincronização. Enquanto isso, um id sem nome não aparece (já é assim: `labelNames.get(...) ?? ""` e `filter(Boolean)`).

### Ferramentas do agente

`search_contacts` passa a devolver `gender` só quando ele existe, dentro do bloco `<data>` de sempre. A IA não recebe a origem (Google ou Zuri) e não pode mudar o gênero: não há ferramenta de escrita nova.

### Agendamentos, IA e integrações externas

Nenhum agendamento novo. Mais um campo no pedido ao Google, que não aumenta a cota usada: o pedido é o mesmo, com um campo a mais.

## 8. Custo e cotas do plano Free

| Recurso | Uso típico | Pior caso | Folga | Fonte |
| --- | --- | --- | --- | --- |
| Leituras do Google | igual a hoje | uma releitura completa ao subir `FIELDS_VERSION` (5 páginas de 1.000) | dentro de `pagesPerWake` 10 | `CONTACT_LIMITS` |
| Escritas no SQLite | 1 por mudança de gênero | 5.000 linhas na releitura, só dos contatos cujo `data` mudou | - | P4 |
| JS inicial | 0 B (Agenda e Contatos são telas sob demanda) | `kinship.ts` só na ficha | teto 141.100 B | P11 |
| Neurons | 0 | 0 | - | - |

Nenhum recurso pago.

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Gênero adivinhado errado e mostrado como fato | Nada é deduzido pelo nome; sem dado, fica "Não informado" | unitário: nome "Bruno" sem `genders` dá `null` |
| Valor estranho vindo do Google (texto livre, injeção) | Só `female`/`male` viram valor; o resto é descartado, sem guardar o texto | esquema com 100.000 caracteres e controle |
| Dado pessoal em log | O gênero nunca vai para log nem para mensagem de erro | busca no log do teste de rota |
| Injeção de prompt por etiqueta ou relação | Continua dentro de `<data>` neutralizado | teste existente de `search_contacts` |
| Sugestão de horário inválido gravada | A tela não grava; o servidor confere tudo de novo, com choque e dia congelado | teste: cada sugestão passa por `appointmentProblem` |
| Corrida entre duas abas | Reconferência antes de preencher, e `clash` no servidor | e2e com dois contextos |
| Mudança de gênero por terceiro | Rota com sessão e CSRF, corpo estrito, id validado | teste de rota sem sessão (401) e com corpo extra (400) |
| Backup | O ajuste da Zuri entra no backup (é dado do Pablo); a cópia do Google continua fora | teste do backup |

Auditoria: modo orientação, com `differential-review` e `sharp-edges` na rota nova.

## 10. Testes

| CA | Teste | Camada | Arquivo |
| --- | --- | --- | --- |
| CA1 | Contraste do link nos dois temas (axe) e só em `a`/`.linkbtn` | e2e | `tests/e2e/visual-links.spec.ts` |
| CA2 | Um título para cada código de `appointmentProblem`, sem repetir no detalhe | unitário | `packages/shared/test/agenda-rules.test.ts` |
| CA3 | Ordem dos níveis; empate pela distância; 7 e 8 dias; 3 e 4 sugestões; dia vazio; só reuniões | unitário | idem |
| CA4 | Toda sugestão passa em `appointmentProblem`; ocupada entre o aviso e o toque; duas abas | unitário e e2e | idem e `tests/e2e/agenda.spec.ts` |
| CA5 | `female`, `MALE`, `unspecified`, texto livre, ausente; ajuste e volta para o Google | unitário e rota | `apps/agent/test/contacts.test.ts` |
| CA6 | `fits` e `otherForm` para cada par; aviso e troca na ficha | unitário e e2e | `packages/shared/test/kinship.test.ts` |
| CA7 | "Paciente", "paciente " e "Pacientes" (esta fica); observação igual; starred vira estrela; etiqueta apagada | unitário | `apps/agent/test/contacts.test.ts` |

## 11. Entrega

- PR A: `feat(interface): destaque dos textos clicáveis`. Fragmento de changelog, capturas e README sem mudança de área.
- PR B: `feat(agenda): motivo direto e sugestão que encosta nas consultas`.
- PR C: `feat(contatos): gênero do contato e etiquetas sem repetição`. Leva a migration 44, a linha de Contatos no README e as capturas.
- Antes do código: o Pablo aprova a versão de teste do protótipo, e ela vai para o protótipo principal.

## 12. Riscos

- A releitura completa ao subir `FIELDS_VERSION` pode levar dois despertares com 5.000 contatos. É esperado e já acontece hoje.
- Uma sugestão muito longe do horário tocado pode incomodar. Por isso fica o limite de 7 dias para o horário colado, e o primeiro livre aparece se nada colar.

## 13. Suposições

- O People API devolve `genders[].value` como `female`, `male`, `unspecified` ou texto livre, conforme a referência do recurso `Person` (developers.google.com/people/api/rest/v1/people#gender). Conferir na implementação.
- O Google não deixa duas etiquetas do mesmo dono com o mesmo nome exato, mas deixa nomes que só mudam em maiúscula, acento ou espaço. Por isso a comparação é pelo nome normalizado.

## 14. Entrevista com o Pablo

Nenhuma pergunta bloqueia. O protótipo mostra as escolhas, e o Pablo aprova ou pede ajuste nele:

1. Ordem das sugestões: depois de colar numa consulta, vale mais o mesmo dia do horário tocado ou o dia mais cheio? Hoje o protótipo prefere o mesmo dia e o mais perto.
2. "Não informar" mostra as duas formas de parentesco, como acontece sem dado. Está bom assim?
