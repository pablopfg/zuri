# Plano · Textos clicáveis, sugestão de horário, gênero, CPF, etiquetas e e-mail

Situação: esperando o Pablo (protótipo pronto para teste)
Origem: pedidos do Pablo em 14/11/2026, 12:25 e 13:05 (horário de Brasília); escolha do Pablo às 13:12: a Zuri grava no Google só o gênero e o CPF
Dependências: E5f (#348), E5g (#350) e E6a (#351) mescladas; protótipo aprovado antes do código (decisão de 12/11)

## 1. Resumo

Os pedidos viram quatro PRs depois da aprovação do protótipo:

1. **Textos clicáveis** com cara de clicáveis, no jeito do Sinal (refeito às 13:05: o verde sublinhado ficou feio). Ação de texto solta ("Mudar", "Ver em Avaliações", "Ver em tabela") vira um botão discreto: peso 600, cor do texto, fundo bem leve em repouso e o fundo `--hover` do sistema ao passar o mouse, com a seta que anda ou gira. Link no meio da frase continua sublinhado com o traço cinza, que fica na cor do texto no mouse. Linha ou cartão que abre algo acende inteiro. Os controles que não reagiam ao mouse ganham o estado (PR A).
2. **Agenda:** o aviso de horário recusado diz o motivo no título ("Sábado não tem atendimento", "Horário de almoço") e sugere até três horários que **encostam** em consultas já marcadas, para não deixar buracos na semana. A regra fica numa função pura em `packages/shared`, usada pela interface. O servidor continua conferindo cada agendamento como hoje (PR B).
3. **Gênero e CPF do contato:** vêm do Google Contatos. O Pablo muda os dois na ficha e a Zuri **grava no Google primeiro** (escolha das 13:12); a cópia da Zuri só muda quando o Google aceita. O gênero nunca é adivinhado pelo nome. O CPF é conferido pelos dígitos verificadores, com ✓ verde ou ✗ vermelho e o texto ao lado, e um CPF errado no Google aparece com o alerta e o botão "Corrigir". O mesmo campo de CPF serve à chave Pix do tipo CPF. As listas de parentesco e os textos usam a forma certa, e uma ligação que não combina ("Bruno" como "Filha") aparece com aviso e o botão para trocar (PR C).
4. **Etiquetas abaixo do nome:** são as etiquetas do Google Contatos, sem repetir. Saem as duplicações de hoje: a mesma etiqueta no topo e no cartão "Etiquetas", e a observação do nome igual a uma etiqueta (PR C).
5. **Configurações:** sai a lista "Feriados nacionais" de Configurações › Agenda (os feriados continuam fechando a agenda sozinhos). O e-mail aos pacientes perde a linha "Até 100 por dia; hoje saíram 3" (o teto continua valendo, só não aparece), o SMTP ganha a Hostinger já preenchida com "Outro servidor" para o resto, e o Gmail ganha o passo a passo da configuração e a conta que envia (PR D, junto da E6c).

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
  - Contatos por etiqueta, teto de 5.000. Era só leitura (02/11); em 14/11, 13:12, o Pablo escolheu que a Zuri grave no Google só o gênero e o CPF.
  - "Nome Completo / Categoria" guarda só o nome.
  - Homônimos são pessoas diferentes.
  - Um ajuste, um lugar (13/11).
  - Ajuste novo entra primeiro no protótipo (12/11).
  - O backup exclui `zur_contact_*`.
- Migrations: a última na `develop` é a 43 (`agenda_record_contact`). A próxima livre é a **44**; confirmar de novo antes de criar.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Toda ação de texto ("Mudar", "Ver em…", "Ver em tabela") tem forma de botão discreto em repouso e o fundo `--hover` no mouse; link no meio da frase fica sublinhado; todo controle visível muda ao passar o mouse. Contraste ≥ 4,5:1 nos dois temas, sem cor nova fora dos tokens do Sinal. | Pablo (13:05) |
| CA2 | Ao tocar num horário recusado, o título do aviso diz o motivo em até 6 palavras e o texto abaixo traz o detalhe, sem repetir o título. | Pablo |
| CA3 | Os horários sugeridos seguem esta ordem: primeiro o que fecha um intervalo entre duas consultas, depois o que encosta numa consulta, depois a borda do expediente ou do almoço num dia com consultas, depois a borda num dia vazio e por fim o primeiro horário livre. | Pablo |
| CA4 | Nenhuma sugestão cai em horário que o servidor recusaria. O servidor confere de novo ao gravar. Se o horário foi ocupado nesse meio tempo, aparece "Esse horário acabou de ser ocupado" e novas sugestões. | Pablo (segurança) |
| CA5 | O gênero vem do Google e a Zuri não deduz pelo nome. Mudar ou "Não informar" na ficha grava no Google primeiro; se o Google recusar, nada muda e o diálogo diz por quê. | Pablo (13:05 e 13:12) |
| CA8 | O CPF é conferido pelos dígitos verificadores ao digitar: ✓ verde e "CPF válido" com 11 números certos; ✗ vermelho e o motivo com 11 números errados ou todos iguais; com menos de 11, nada até sair do campo, e então "Faltam N números". O símbolo nunca vem sem o texto. | Pablo (13:05) |
| CA9 | Um CPF errado no Google aparece na ficha como "Inválido", com o alerta e o botão "Corrigir"; corrigir grava no Google (campo personalizado "CPF") e na Zuri. | Pablo (13:05 e 13:12) |
| CA10 | A Zuri só muda `genders` e o campo "CPF" de `userDefined` no Google, conferindo a versão (etag) do contato; nenhum outro campo de nenhum contato muda. | Pablo (13:12, segurança) |
| CA11 | Configurações › Agenda não mostra a lista de feriados nacionais; eles continuam fechando a agenda. | Pablo (13:05) |
| CA12 | O e-mail aos pacientes não mostra contagem do dia; o SMTP abre com a Hostinger (smtp.hostinger.com, 465 SSL/TLS ou 587 STARTTLS) e aceita outro servidor; o Gmail mostra os passos de configuração e a conta que envia. | Pablo (13:05) |
| CA6 | As listas de parentesco mostram só as formas que combinam com o gênero. Uma ligação que não combina mostra o aviso e o botão "Trocar para “Filho”". | Pablo |
| CA7 | Abaixo do nome aparecem as etiquetas do Google, cada nome uma vez só (sem diferença por maiúscula, acento ou espaço), sem as etiquetas do sistema e sem repetir a observação do nome. | Pablo |

## 4. Escopo

**Entra:**

- **PR A:** ações de texto como botão discreto (token `--act-bg`), resumos `<summary>` com a seta, sublinhado cinza dos links no meio do texto e o estado de mouse que faltava (cartões de modo do e-mail, "Perguntar à Zuri", interruptores).
- **PR B:**
  - `suggestSlots` em `packages/shared`.
  - Os textos de motivo, com título e detalhe.
  - A lista de sugestões no aviso, no formulário e ao arrastar uma consulta.
  - A marca "Encosta numa consulta" nos horários do formulário.
- **PR C:**
  - Gênero e CPF na sincronização (CPF errado deixa de ser descartado e vem marcado como inválido).
  - Escrita no Google só de `genders` e do campo "CPF", com o escopo `contacts`.
  - As linhas "CPF" e "Gênero" na ficha, os diálogos e o campo de CPF conferido (também na chave Pix).
  - Parentesco pelo gênero.
  - Etiquetas sem duplicação.
- **PR D (com a E6c):** tirar "Feriados nacionais" de `AgendaTab.tsx` e as chaves `web.agendaPrefs.holidays.*`; e-mail sem contagem do dia, SMTP com a Hostinger e o passo a passo do Gmail.

**Fica fora (e onde vai parar):**

- As ligações de família feitas na Zuri (responsável, mensagens que vão para a mãe) ainda não existem no código, só no protótipo. Quando forem feitas, usam `famFits` deste plano. Fica como pendência em `progresso.md`.
- Escrever no Google qualquer outro campo (nome, telefone, etiquetas): não faremos. A escolha do Pablo (13:12) é só gênero e CPF.
- Gênero em textos enviados a pacientes: entra com os modelos de mensagem (E6c/E7), usando a variável deste plano.

## 5. Como funciona para o Pablo

### Fluxo 1 · Textos clicáveis

1. Ações de texto ("Ver em Avaliações", "Abrir agenda", "Trocar para “Filho”", "Ver em tabela") ficam em peso 600, na cor do texto, com um fundo bem leve em repouso, que diz "isto é um controle" também no celular, onde não há mouse.
2. Ao passar o mouse, o fundo fica no cinza `--hover`, o mesmo das linhas de Tarefas e Notas, e a seta anda 2 px (sem animação com "Reduzir movimento"). Os resumos que abrem uma parte da tela têm uma seta que gira ao abrir.
3. Link no meio de uma frase continua sublinhado com o traço cinza do Sinal; no mouse, o traço fica na cor do texto e ganha o fundo leve.
4. Linhas e cartões que abrem algo acendem inteiros. Menu, abas e botões com borda continuam como estão. No teclado, o anel de foco de sempre; no celular, a área de toque continua com 44 px.

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

1. Na ficha, a linha "Gênero" mostra "Masculino" e o botão "Mudar". Sem dado: "Não informado · os textos ficam neutros" e "Definir".
2. "Mudar" abre: Feminino, Masculino e "Não informar" (tira o gênero do contato no Google). O texto do diálogo diz que muda no Google Contatos e na Zuri ao mesmo tempo.
3. "Salvar" mostra "Um momento…" enquanto grava no Google. Se der certo, fecha e avisa "Gênero de Bruno salvo no Google Contatos", com quantas ligações de parentesco deixaram de combinar. Se der errado, o diálogo fica aberto com o motivo (fluxo 5) e nada muda.
4. Ao criar uma ligação, as listas mostram só "Filho", "Irmão" e assim por diante para um contato masculino. Sem gênero, aparecem as duas formas e a dica "Lucas sem gênero definido: as duas formas aparecem. Definir o de Lucas".
5. Uma ligação antiga que não combina mostra, em âmbar: "Bruno está como masculino, mas a ligação diz “Filha”. Trocar para “Filho”".
6. Empresas (nome igual à organização) não têm a linha.

### Fluxo 3b · CPF

1. Na ficha, a linha "CPF" mostra o número com o começo e o fim escondidos ("***.019.375-**"), o símbolo e a palavra: ✓ "Válido" ou ✗ "Inválido". Sem CPF no Google: "Sem CPF no Google Contatos" e "Adicionar".
2. CPF inválido traz, embaixo, em âmbar: "CPF inválido: os dois últimos números não batem com os outros nove. Confira o documento. Corrija aqui: a Zuri grava no Google Contatos." e o botão vira "Corrigir".
3. O diálogo tem o campo de CPF: teclado numérico no celular, pontos e traço postos sozinhos, símbolo dentro do campo à direita e o texto embaixo (lido pelo leitor de tela). "Salvar" só grava um CPF válido; "Tirar o CPF" apaga o campo no Google.
4. O mesmo campo serve à chave Pix quando o tipo é CPF (Configurações › Consultório). Trocar o tipo limpa o símbolo.

### Fluxo 5 · Quando o Google recusa

| Caso | O que o Pablo vê | Nada muda? |
| --- | --- | --- |
| Google fora do ar ou sem resposta em 10 s | "Não deu para salvar no Google Contatos agora. Nada mudou, aqui nem lá. Tente de novo." | sim |
| Conexão sem a permissão de editar (antes de reconectar) | "A conexão com o Google não permite editar contatos. Nada mudou." e o link "Conectar de novo em Integrações" | sim |
| O contato mudou no Google enquanto o diálogo estava aberto (etag velho) | "Este contato mudou no Google enquanto você editava. A Zuri leu a versão nova: confira e salve de novo." | sim |
| Contato saiu das etiquetas escolhidas ou foi apagado no Google | "Este contato não está mais na cópia da Zuri." e a ficha volta à lista | sim |
| Sem internet no navegador | o botão volta e pede "Tentar de novo"; não há fila (decisão de 14/11, 10:37) | sim |

O protótipo simula cada caso com `?falha=google`, `?falha=permissao` e `?falha=conflito`.

### Fluxo 4 · Etiquetas

1. Abaixo do nome vêm as etiquetas do Google, numa linha que quebra, com o nome acessível "Etiquetas do Google Contatos".
2. "Favorito" (o starred do Google) vira a estrela.
3. O cartão "Etiquetas" mais abaixo sai, porque repetia o topo.

### Fluxo 6 · Configurações

1. Configurações › Agenda fica só com "Dias sem expediente". Os feriados nacionais continuam fechando a agenda, o link de remarcar e os envios automáticos.
2. E-mail para pacientes: o texto de cima diz só "Por onde saem a confirmação de consulta e os outros e-mails aos pacientes."
3. "E-mail do domínio (SMTP)": "Envia pelo e-mail com o domínio do consultório, como contato@seuconsultorio.com.br. A Hostinger já vem preenchida."
   - "Onde o e-mail está": Hostinger (padrão) ou Outro servidor.
   - Hostinger: servidor `smtp.hostinger.com` preenchido e travado; porta 465 SSL/TLS (recomendada) ou 587 STARTTLS; usuário é o endereço completo da caixa; "Senha do e-mail" é a mesma do Webmail da Hostinger. Um resumo "Onde achar esses dados na Hostinger" com os quatro passos.
   - Outro servidor: todos os campos livres, com as mesmas travas de hoje (só TLS, sem IP nem rede interna).
4. Gmail: entra pela conta Google, sem senha. Conectado, mostra "Conta que envia" (só leitura) e "Desconectar". O resumo "Como configurar o Gmail" (aberto enquanto não conectou) traz os passos:
   1. No Google Cloud do projeto da Agenda, em APIs e serviços › Biblioteca, ativar a Gmail API.
   2. Em Tela de consentimento OAuth › Escopos, adicionar `…/auth/gmail.send`.
   3. Voltar e tocar em "Conectar o Gmail"; o Google pede só a permissão de envio.
   4. "Enviar teste para você".

   Embaixo, a situação de cada passo (conta conectada, API ativa, permissão aceita) com ✓ ou ○ e o texto.

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
| Não informar | Don't set |
| CPF válido | Valid CPF |
| CPF inválido: os dois últimos números não batem com os outros nove. Confira o documento. | Invalid CPF: the last two digits don't match the other nine. Check the document. |
| CPF inválido: todos os números são iguais. | Invalid CPF: all digits are the same. |
| Faltam {n} números. | {n} digits missing. |
| Corrigir | Fix |
| Não deu para salvar no Google Contatos agora. Nada mudou, aqui nem lá. Tente de novo. | Couldn't save to Google Contacts now. Nothing changed, here or there. Try again. |
| A conexão com o Google não permite editar contatos. Nada mudou. | The Google connection can't edit contacts. Nothing changed. |
| Este contato mudou no Google enquanto você editava. A Zuri leu a versão nova: confira e salve de novo. | This contact changed in Google while you were editing. Zuri read the new version: check and save again. |
| Onde o e-mail está | Where your e-mail is |
| Como configurar o Gmail | How to set up Gmail |
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
| Gênero | `f`, `m` ou vazio; o Google traz `female`, `male`, `unspecified` ou texto livre | texto livre ou `unspecified` vira vazio; a Zuri só grava `female`/`male` ou tira o item | valor fora do enum: rota 400 `validation` |
| CPF | 11 números, dígitos verificadores certos, não todos iguais | 10 e 12 números recusam; 000.000.000-00 recusa | rota 400 `validation`; a tela não deixa salvar |
| CPF no Google | campo personalizado "CPF" primeiro, depois o número depois da palavra "CPF" | um inválido passa a ser guardado, marcado inválido (hoje é descartado) | - |
| Escrita no Google | 1 contato por pedido, em fila (o Google pede mudanças do mesmo usuário em sequência), prazo de 10 s | 20 escritas por minuto por conta, conferidas no GoogleMeter | 429 `rate_limited` com `retryAfter` |
| SMTP Hostinger | `smtp.hostinger.com`, 465 SSL/TLS ou 587 STARTTLS | o servidor vem do servidor da Zuri, não do campo da tela | - |
| Etiquetas abaixo do nome | todas, sem repetir; nome comparado em minúsculas, sem acento e com espaços juntados | - | - |
| Concorrência | duas abas sugerem o mesmo horário: a segunda gravação recebe `clash` do servidor e a tela mostra o aviso de ocupado | - | `error.agendaRule.clash` |

Fuso: tudo em minutos do dia no fuso do dono (`zonedParts`), como `nextFreeSlot`. Horário de verão não existe no fuso padrão desde 2019, mas a função não assume isso: usa os minutos que `zonedParts` devolver.

## 7. Desenho técnico

### Arquivos

| Arquivo | Cria ou muda | Para quê |
| --- | --- | --- |
| `apps/web/src/styles.css` (tokens) e componentes de ação | muda | PR A: `--act-bg`, ação de texto, `<summary>` com seta, sublinhado cinza e os estados de mouse que faltavam |
| `packages/shared/src/agenda-rules.ts` | muda | `suggestSlots()` e `slotReason()` puras, com os níveis (tiers) |
| `packages/shared/test/agenda-rules.test.ts` | muda | casos n-1/n/n+1 e ordem dos níveis |
| `apps/web/src/lib/agenda-rules.ts` | muda | `suggest()` monta a entrada a partir dos eventos lidos |
| `apps/web/src/pages/agenda/AgendaPage.tsx` | muda | aviso com título, detalhe e lista; reconferência antes de usar |
| `apps/agent/src/google/booking.ts` | não muda a regra | continua a conferir; ganha teste de que a sugestão passa nele |
| `apps/agent/src/google/contacts.ts` | muda | `genders` em `PERSON_FIELDS`, `FIELDS_VERSION` 4, gênero e CPF (com `cpfValid`) no `data` e no resumo, rótulos sem repetir |
| `apps/agent/src/google/contact-write.ts` | cria | a única escrita no Google: `genders` e o campo "CPF", com etag |
| `apps/agent/src/google/contact-name.ts` | muda | `findCpf` devolve também o CPF inválido do campo "CPF", marcado |
| `apps/agent/src/google/service.ts` | muda | escopo `contacts` no lugar de `contacts.readonly`; conexão antiga pede para reconectar só ao tentar escrever |
| `packages/shared/src/cpf.ts` | cria | `cpfState()` e `formatCpf()`, usados pela tela, pelo servidor e pela chave Pix (troca as duas cópias de hoje) |
| `packages/shared/src/contacts.ts` e `contacts-schemas.ts` | muda | `gender`, `cpfValid` no resumo; esquemas das rotas novas |
| `apps/web/src/components/CpfField.tsx` | cria | o campo com máscara, símbolo e texto |
| `packages/shared/src/kinship.ts` | cria | papéis por gênero (`ROLE_FORMS`), `fits()` e `otherForm()` |
| `apps/web/src/pages/contacts/ContactCard.tsx` | muda | linhas CPF e Gênero, diálogos, etiquetas sem o cartão repetido |
| `apps/web/src/pages/settings/AgendaTab.tsx` | muda | PR D: sai a lista de feriados nacionais e as chaves `web.agendaPrefs.holidays.*` |
| tela do e-mail aos pacientes (E6c) | muda | PR D: sem contagem do dia, Hostinger, passos do Gmail |
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

- `PATCH /api/contacts/:id/gender` com `{ gender: "f" | "m" | "none" }` e `PATCH /api/contacts/:id/cpf` com `{ cpf: string | null }` (`null` tira o CPF).
  - Esquema Zod `.strict()`, corpo até 1 KB. O CPF passa por `cpfState` no servidor também: só `ok` grava.
  - Exige a sessão, como as outras rotas de contatos, com o CSRF de sempre. Teto de 20 por minuto (GoogleMeter, rotas).
  - Passos no servidor, na ordem:
    1. Acha o contato na cópia pelo id; não achou: 404 `not_found`.
    2. Lê o contato no Google na hora (`people.get` com `personFields=genders,userDefined,metadata`), para ter a versão (etag) e a lista de campos personalizados inteira, não a cópia com o teto de 20.
    3. Muda só o item: o gênero, ou o campo cuja chave é "CPF" (sem diferença de maiúsculas e espaços), mantendo os outros campos personalizados como vieram. Sem campo "CPF", acrescenta um.
    4. `people.updateContact` com `updatePersonFields=genders` ou `userDefined` e o etag lido no passo 2. Nenhum outro valor de `updatePersonFields` existe no código; um teste confere isso.
    5. O Google aceitou: grava a cópia com o que ele devolveu e responde 200 com o resumo novo.
  - Erros: etag velho → 409 `conflict` (a tela relê e mostra o aviso); sem o escopo → 403 `google_scope` (a tela mostra "Conectar de novo"); Google fora do ar ou prazo de 10 s → 502 `google_unavailable`; contato fora das etiquetas escolhidas → 404. Em todos, a cópia não muda.
- `ContactSummary` ganha `gender: "f" | "m" | null` e `cpfValid: boolean | null` (o CPF continua mascarado). `labels` passa a vir sem nome repetido.
- Palavras novas em `ROUTE_WORDS` (`apps/agent/src/log.ts`): `gender` e `cpf`.

### Banco

Sem migration. O Google é a fonte: a Zuri grava lá e atualiza a cópia (`zur_contact_*`, fora do backup, como hoje) com a resposta. Não existe valor do gênero ou do CPF que viva só na Zuri, então não há o que entrar no backup nem o que ficar diferente do Google. A próxima migration livre continua a 44.

### Gênero na sincronização

- `PERSON_FIELDS` ganha `genders`, e `FIELDS_VERSION` sobe para 4. A próxima sincronização relê tudo uma vez, como já acontece quando um campo entra.
- O esquema `googlePersonSchema` ganha `genders: list(z.object({ value: text.optional() }).loose())`. Só `female`/`male` (sem diferença de maiúsculas) viram `f`/`m`; o resto vira vazio.
- `addressMeAs` e o texto livre não são guardados.
- Ao gravar, a Zuri troca o item `genders` inteiro por um só (`female` ou `male`), ou manda a lista vazia para "Não informar". Um texto livre que existia no Google some ao escolher: o diálogo avisa quando havia um.

### A escrita no Google (`contact-write.ts`)

- Escopo: `https://www.googleapis.com/auth/contacts` no lugar de `contacts.readonly`. O Google não tem permissão por campo, então a trava é do código: um só módulo chama `updateContact`, com `updatePersonFields` vindo de uma lista fixa (`genders`, `userDefined`), e o teste falha se aparecer outro campo ou outra chamada de escrita (`deleteContact`, `createContact`, `batch*`, `contactGroups.*` que escrevem).
- Quem já conectou o Google segue lendo normalmente; só a primeira escrita pede para reconectar (o Google mostra a permissão nova). A leitura não para.
- O texto da tela de Integrações › Google muda de "só leitura" para "lê os contatos das etiquetas escolhidas e só muda gênero e CPF quando você pede".
- Mudanças do mesmo dono vão em fila, uma de cada vez, como o Google recomenda para escrita de contatos.
- Nada é escrito sozinho: só o toque em "Salvar" no diálogo. A IA não tem ferramenta para isso.

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

`search_contacts` passa a devolver `gender` só quando ele existe, dentro do bloco `<data>` de sempre. O CPF continua fora do que a IA recebe. A IA não pode mudar gênero nem CPF: não há ferramenta de escrita nova.

### Agendamentos, IA e integrações externas

Nenhum agendamento novo. Mais um campo no pedido de leitura ao Google, que não aumenta a cota usada. Cada "Salvar" faz 2 chamadas ao Google (ler e gravar), dentro do GoogleMeter das rotas. Gmail (E6c): escopo `gmail.send`, o Pablo ativa a Gmail API no projeto dele, como no passo a passo da tela; nada pago.

## 8. Custo e cotas do plano Free

| Recurso | Uso típico | Pior caso | Folga | Fonte |
| --- | --- | --- | --- | --- |
| Leituras do Google | igual a hoje | uma releitura completa ao subir `FIELDS_VERSION` (5 páginas de 1.000) | dentro de `pagesPerWake` 10 | `CONTACT_LIMITS` |
| Chamadas ao Google por "Salvar" | 2 (ler e gravar) | 20 por minuto, teto do GoogleMeter | cota da People API muito acima | `GOOGLE_LIMITS` |
| Escritas no SQLite | 1 por mudança de gênero ou CPF | 5.000 linhas na releitura, só dos contatos cujo `data` mudou | - | P4 |
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
| Mudança de gênero ou CPF por terceiro | Rota com sessão e CSRF, corpo estrito, id validado, teto de 20 por minuto | teste de rota sem sessão (401), com corpo extra (400) e 21ª chamada (429) |
| Escopo `contacts` usado para mais do que o combinado (apagar, mudar nome, telefone ou etiqueta) | Um só módulo escreve; `updatePersonFields` de lista fixa; teste que varre o código por outras chamadas de escrita da People API | teste de repositório + unitário do módulo |
| Apagar sem querer os outros campos personalizados | Lê o contato no Google na hora e manda a lista inteira de volta, mudando só "CPF" | unitário com 25 campos (acima do teto de 20 da cópia) |
| Gravar por cima de uma mudança feita no Google | etag do contato lido na hora; etag velho = 409 e nada muda | unitário com etag diferente |
| CPF em log ou na IA | CPF nunca vai para log, mensagem de erro, `search_contacts` nem fluxo; a tela mostra mascarado | busca no log do teste de rota |
| CPF montado para passar na conferência (injeção, caracteres de controle) | O servidor tira tudo que não é número, exige 11 e confere os dígitos de novo; o que vai ao Google são só os 11 números formatados | unitário com controle, emoji e 100.000 caracteres |
| Token do Google vazado com escopo maior | Continua cifrado (`google-v1`) e só no servidor; o Pablo revoga na conta Google; o aviso da tela de Integrações diz o que a Zuri pode fazer | teste existente do cofre |
| Senha do SMTP | Continua cifrada, nunca volta para a tela; com Hostinger, o servidor vem do código, não do campo, então a tela não consegue apontar a senha para outro lugar sem trocar para "Outro servidor" (que pede a senha de novo) | unitário |

Auditoria: modo orientação, com `differential-review` e `sharp-edges` nas rotas novas e na troca de escopo. A troca de `contacts.readonly` por `contacts` muda a decisão de 02/11 (só leitura): registrar em `decisoes.md` com a escolha do Pablo de 14/11.

## 10. Testes

| CA | Teste | Camada | Arquivo |
| --- | --- | --- | --- |
| CA1 | Contraste nos dois temas (axe); toda ação de texto e `<summary>` muda de fundo no mouse | e2e | `tests/e2e/visual-links.spec.ts` |
| CA2 | Um título para cada código de `appointmentProblem`, sem repetir no detalhe | unitário | `packages/shared/test/agenda-rules.test.ts` |
| CA3 | Ordem dos níveis; empate pela distância; 7 e 8 dias; 3 e 4 sugestões; dia vazio; só reuniões | unitário | idem |
| CA4 | Toda sugestão passa em `appointmentProblem`; ocupada entre o aviso e o toque; duas abas | unitário e e2e | idem e `tests/e2e/agenda.spec.ts` |
| CA5 | `female`, `MALE`, `unspecified`, texto livre, ausente; gravar e "Não informar"; Google fora, sem escopo e etag velho deixam tudo igual | unitário e rota | `apps/agent/test/contact-write.test.ts` |
| CA6 | `fits` e `otherForm` para cada par; aviso e troca na ficha | unitário e e2e | `packages/shared/test/kinship.test.ts` |
| CA7 | "Paciente", "paciente " e "Pacientes" (esta fica); observação igual; starred vira estrela; etiqueta apagada | unitário | `apps/agent/test/contacts.test.ts` |
| CA8 | Válido, dígito trocado, todos iguais, 10, 11 e 12 números, com pontos, com espaço, vazio; máscara ao digitar e ao colar | unitário e e2e | `packages/shared/test/cpf.test.ts`, `tests/e2e/contacts.spec.ts` |
| CA9 | CPF inválido do Google aparece marcado; corrigir grava e a ficha passa a "Válido" | rota e e2e | `apps/agent/test/contact-write.test.ts` |
| CA10 | Só `genders`/`userDefined` em `updatePersonFields`; nenhuma outra escrita na People API; outros campos personalizados preservados | repositório e unitário | `tests/repo/google-write.test.ts` |
| CA11 | Configurações › Agenda sem a lista; feriado continua fechando | e2e | `tests/e2e/settings.spec.ts` |
| CA12 | Sem contagem do dia; Hostinger preenchida e travada; "Outro servidor" livre; passos do Gmail | e2e | idem |

## 11. Entrega

- PR A: `feat(interface): destaque dos textos clicáveis`. Fragmento de changelog, capturas e README sem mudança de área.
- PR B: `feat(agenda): motivo direto e sugestão que encosta nas consultas`.
- PR C: `feat(contatos): gênero e CPF gravados no Google e etiquetas sem repetição`. Sem migration; leva a troca de escopo marcada no PR e no changelog, a linha de Contatos no README e as capturas.
- PR D (junto da E6c): `feat(configuracoes): e-mail com Hostinger e passos do Gmail, sem lista de feriados`.
- Antes do código: o Pablo aprova a versão de teste do protótipo, e ela vai para o protótipo principal.

## 12. Riscos

- A releitura completa ao subir `FIELDS_VERSION` pode levar dois despertares com 5.000 contatos. É esperado e já acontece hoje.
- Quem já conectou o Google precisa reconectar uma vez para gravar. A leitura continua sem isso, e a tela só pede na hora de salvar.
- App OAuth do Pablo em modo "Teste" faz o token de escopo sensível vencer em 7 dias (achado de 02/11). O escopo `contacts` é sensível como o da Agenda: não muda essa situação, que já está no passo a passo de instalação.
- Uma sugestão muito longe do horário tocado pode incomodar. Por isso fica o limite de 7 dias para o horário colado, e o primeiro livre aparece se nada colar.

## 13. Suposições

- O People API devolve `genders[].value` como `female`, `male`, `unspecified` ou texto livre, conforme a referência do recurso `Person` (developers.google.com/people/api/rest/v1/people#gender). Conferir na implementação.
- `people.updateContact` exige o etag da pessoa e recusa um etag velho; o código exato do erro (400 `FAILED_PRECONDITION` ou outro) confere-se na implementação, com teste. Fonte: developers.google.com/people/api/rest/v1/people/updateContact.
- O Google pede que mudanças de contatos do mesmo usuário sejam feitas em sequência (guia "Read and Manage Contacts" da People API).
- Os dados do SMTP da Hostinger (smtp.hostinger.com, 465 SSL ou 587 STARTTLS, usuário = endereço completo) vêm da ajuda da Hostinger; conferir na implementação.
- O Google não deixa duas etiquetas do mesmo dono com o mesmo nome exato, mas deixa nomes que só mudam em maiúscula, acento ou espaço. Por isso a comparação é pelo nome normalizado.

## 14. Entrevista com o Pablo

Nenhuma pergunta bloqueia. O protótipo mostra as escolhas, e o Pablo aprova ou pede ajuste nele:

1. Ordem das sugestões: depois de colar numa consulta, vale mais o mesmo dia do horário tocado ou o dia mais cheio? Hoje o protótipo prefere o mesmo dia e o mais perto.
2. "Não informar" mostra as duas formas de parentesco, como acontece sem dado. Está bom assim?
