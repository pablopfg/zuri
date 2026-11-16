# Plano · Contatos: família e ficha (E11)

Situação: aprovado em 13/11/2026 (protótipo v51, itens 7 e 10, e ajuste de 12/11 18:45 UTC); E11a mesclada (#365), E11b mesclada (#366), E11c em andamento
Origem: pedido do Pablo, cronograma de [sons-menu-e-agenda-editavel.md](sons-menu-e-agenda-editavel.md) (entrega E11)
Dependências: E5b e E5f (vínculo do agendamento ao contato), mescladas; E7 (envios da confirmação), mesclada

## 1. Resumo

A ficha do contato passa a mostrar só o que está preenchido, os avisos de aniversário saem, e cada contato ganha a família: parentes ligados com o papel de cada lado e, para criança ou quem não usa celular, um responsável que recebe as mensagens do consultório. A entrega é grande para uma PR e vira três, nesta ordem:

| PR | O que entra |
| --- | --- |
| **E11a** | Ficha sem a linha "Vazio no Google"; saem "Aniversários do dia" (Integrações › Contatos) e "Aniversários de clientes" com a hora (Avisos › CRM), na tela e no servidor |
| **E11b** | Cartão "Família" na ficha: "Ligar parente" (parente, papel dele e o papel do outro lado), "Também no grupo familiar", tirar a ligação; tabela nova `zur_contact_family` (migration 48), no backup |
| **E11c** | Responsável: "As mensagens do consultório para Lucas vão para Helena". Confirmação pelo WhatsApp, pelo Chatwoot e por e-mail usam o celular e o e-mail do responsável, e os detalhes do agendamento dizem isso |

## 2. Contexto no sistema

- Ficha: `apps/web/src/pages/contacts/ContactCard.tsx` e `person.ts` (`CARD_GROUPS`, `hasGroup`).
- Avisos de aniversário: `apps/agent/src/google/contacts.ts` (`remind`, `planReminder`, coluna `zur_contact_sync.birthdays`) e `apps/agent/src/crm/service.ts` (`tick`, `nextDue`, colunas `zur_crm_settings.birthdays`, `reminder_time`, `next_reminder`, `reminded_day`); telas `apps/web/src/pages/settings/ContactsSection.tsx` e `CrmNoticesCard.tsx`.
- Backup: `packages/shared/src/backup.ts` (`crm.settings`), `apps/agent/src/backup/export.ts` e `import.ts`.
- Contatos são cópia só leitura do Google (`zur_contacts`, fora do backup); a família é dado do Pablo e entra no backup (E11b).
- Decisões: "Contatos: homônimos são pessoas diferentes" e "Aniversários sem aviso" em `.claude/memoria/decisoes.md`.

## 3. Objetivo e critérios de aceite

### E11a

| Nº | Critério | Origem |
| --- | --- | --- |
| CA-A1 | A ficha do contato não mostra grupo vazio nem a linha "Vazio no Google" | Pablo, 12/11 18:45 |
| CA-A2 | Integrações › Contatos não tem "Aniversários do dia"; o servidor não manda esse aviso nem o planeja, mesmo com a coluna antiga ligada; o aviso de datas especiais continua igual | Pablo, v51 item 7 |
| CA-A3 | Avisos › CRM não tem "Aniversários de clientes" nem a hora do aviso; o servidor não manda esse aviso; o aviso de retorno continua | Pablo, v51 item 7 |
| CA-A4 | A API recusa `birthdays` e `birthdayTime` nos dois ajustes (400); o backup novo não leva esses campos e um backup antigo com eles ainda importa, sem mexer nas colunas antigas | plano |
| CA-A5 | Avisos de aniversário que já estão na central continuam aparecendo com o texto deles | plano |
| CA-A6 | Celular, tema escuro, teclado, leitor de tela, 44 px e inglês nas telas mexidas | padrão |

### E11b

| Nº | Critério | Origem |
| --- | --- | --- |
| CA-B1 | A ficha tem o cartão "Família": vazio com a explicação do protótipo, ou cada parente com o nome (link para a ficha dele) e o papel | v51 item 10 |
| CA-B2 | "Ligar parente" busca pelo nome, só quem tem telefone ou e-mail, mostrando telefone (ou e-mail) e nascimento; não oferece o próprio contato nem quem já está ligado | v51 item 10, decisão dos homônimos |
| CA-B3 | Dois papéis: "Essa pessoa é" e "E {nome} é", com só os pares do protótipo; o servidor recusa par inválido (400), o próprio contato (400), par já ligado de qualquer lado (409) | v51 item 10 |
| CA-B4 | Homônimo ligado aparece com a data de nascimento | decisão dos homônimos |
| CA-B5 | "Também no grupo familiar" lista quem é da família por outra pessoa, até 30 nomes, e conta o resto | v51 item 10 |
| CA-B6 | O X tira a ligação, só uma ligação daquele contato (404 se não for); os contatos não mudam | v51 item 10 |
| CA-B7 | Até 20 parentes por contato e 5.000 ligações (409 no limite, n−1/n/n+1) | plano |
| CA-B8 | A ligação sobrevive à saída do contato das etiquetas ("Fora das etiquetas escolhidas") e ao desligar Contatos; entra no backup, e o restore não sobrescreve um par já ligado | plano |
| CA-B9 | Celular, tema escuro, teclado (Esc fecha, o foco volta a "Ligar parente"), leitor de tela, 44 px, inglês | padrão |

### E11c

| Nº | Critério | Origem |
| --- | --- | --- |
| CA-C1 | "Ligar parente" tem a caixa "As mensagens do consultório para {nome} vão para essa pessoa (criança ou quem não usa o celular)", ligada só quando o parente é mãe, pai, avó, avô, tia, tio, irmã, irmão ou responsável legal; o servidor recusa outro papel com a caixa marcada (400) | v51 item 10 |
| CA-C2 | Um contato tem um responsável só: marcar outro troca o anterior; tirar a ligação tira o responsável | v51 item 10 |
| CA-C3 | O cartão diz "As mensagens do consultório para Lucas vão para Helena." e a linha do parente ganha "· recebe as mensagens" | v51 item 10 |
| CA-C4 | A confirmação de um agendamento vinculado a um contato vai para o celular (brasileiro) e o e-mail do contato, ou do responsável dele, pelo WhatsApp (botão), pelo Chatwoot (automação) e por e-mail (botão e automação); sem vínculo, continua o celular e o e-mail do agendamento | v51 item 10 |
| CA-C5 | Nos detalhes do agendamento, o paciente vinculado mostra "As mensagens vão para Helena (mãe)."; com o responsável fora das etiquetas escolhidas, a Zuri diz isso e não envia nada a ninguém | v51 item 10 |
| CA-C6 | O backup leva o responsável; o restore aceita um por pessoa e só nos papéis da CA-C1 (o resto entra como ligação sem responsável) | SEC-A9-02 |
| CA-C7 | Celular, tema escuro, teclado, leitor de tela, 44 px, inglês | padrão |

## 4. Escopo

**Entra (E11a):** o que está em CA-A1 a CA-A6.

**Fica fora:** a família (E11b) e o responsável (E11c). A automação "Parabéns de aniversário" continua "Em desenvolvimento" no CRM.

## 5. Fluxos

- Ficha: só os grupos com dado aparecem, na ordem de hoje.
- Integrações › Contatos, "Avisos": Datas especiais, rótulo, horário e "Quando alguém entrar numa etiqueta".
- Configurações › Avisos, grupo CRM: só "Quando chegar a hora de um retorno".

## 6. Textos

Nenhum texto novo na E11a; saem `web.contacts.emptyAtGoogle`, `web.contacts.card.birthdays`, `web.crm.settings.birthdays`, `web.crm.settings.birthdayTime`, `web.crm.settings.save` e `web.crm.settings.saved`. As chaves `notice.*.birthdays.*` ficam para os avisos já guardados.

## 7. Limites

Sem limite novo na E11a.

## 8. Custo no plano Free

A E11a só tira trabalho: um aviso diário a menos em cada área e nenhum despertar para ele.

## 9. Segurança

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Backup antigo recusado ou mexendo no que não devia | `birthdays` e `birthdayTime` opcionais e ignorados no import; hora inválida ou campo desconhecido continuam recusados | `backup.test.ts` (E11a) |
| Ajuste removido ainda aceito pela API | Esquemas estritos sem os campos (400) | `crm-routes.test.ts`, `google-contacts-routes.test.ts` (E11a) |

## 10. Testes

`crm-service.test.ts`, `google-contacts.test.ts` (E11a: nada sai com a coluna antiga ligada), rotas, `backup.test.ts`, `contacts-person.test.ts`, e2e `contatos.spec.ts` e `crm-cartoes.spec.ts`.

## 11. Desenho

Sem migration na E11a: as colunas antigas ficam sem leitura (migrations só acrescentam). Os tipos `contacts.birthdays` e `crm.birthdays` saem dos avisos que o servidor gera, mas continuam no catálogo de alertas para os avisos já guardados.

## E11b: textos, limites, custo, segurança e desenho

- **Textos:** os do protótipo ("Família", "Ligar parente", "Nenhum parente ligado…", "Também no grupo familiar: …", "Ligar um parente de {nome}", "Essa pessoa é", "E {nome} é", "Escolha o parente na lista.", "Tirar a ligação com {nome}") e os papéis em pt-BR e en (`web.contacts.family.*`). O aviso de ligação feita é neutro ("Ligação feita: Marcos é pai de Beatriz"), porque o protótipo flexionava no feminino.
- **Limites:** 20 parentes por contato, 5.000 ligações, 30 nomes no grupo (`FAMILY_LIMITS`); corpo até 1 KB.
- **Custo:** a ficha lê cerca de 350 linhas com 20 parentes e mais 19 no grupo; ligar escreve 6 linhas (a linha, dois índices, o número da tela e a contagem). O total vem de `zur_counts` (`contact_family`, por gatilho), e o restore conta uma vez: 5.000 ligações leem cerca de 10 mil linhas (SEC-A11-01; com um `count(*)` por ligação eram 12,5 milhões). Sem chamada ao Google, sem alarme.
- **Segurança:** a ligação usa o id da cópia que o dono escolheu, nunca um nome (homônimos); `relative` e o link conferidos no servidor (404 para id de fora da cópia ou ligação de outro contato); papéis só da lista fechada e em par; o texto do nome é sempre texto.
- **Desenho:** tabela `zur_contact_family` (migration 48), um par por linha com `a < b` pelo `resourceName`, `role_a` o que `a` é para `b`, `responsible` para a E11c (0, 1 = `a` recebe por `b`, 2 = `b` recebe por `a`). Serviço `apps/agent/src/google/family.ts`; tela `apps/web/src/pages/contacts/FamilyCard.tsx`; o grupo é uma busca em largura pelos índices, com até 50 pessoas abertas. A busca do diálogo usa `GET /api/contacts?for=booking`, a mesma do formulário da Agenda (seis pessoas, com telefone, e-mail e nascimento).
- **Testes:** `contact-family.test.ts`, `backup.test.ts` (E11b), `free-tier-budget.test.ts` (família), `shared/contacts-family.test.ts` e o e2e de `contatos.spec.ts` (E11b, computador e celular).

## E11c: textos, limites, custo, segurança e desenho

- **Textos:** os do protótipo (caixa do diálogo, "As mensagens do consultório para {nome} vão para {responsavel}.", "· recebe as mensagens", "As mensagens vão para {nome} ({papel}).") e o aviso do responsável fora das etiquetas, em pt-BR e en.
- **Limites:** um responsável por contato; nada novo na tabela (a coluna `responsible` já existe desde a migration 48).
- **Custo:** a ficha e os detalhes do agendamento leem até 3 linhas a mais (a ligação do responsável e o contato dele); a automação da véspera lê o mesmo por agendamento vinculado, poucos por dia. Marcar o responsável escreve no máximo uma linha a mais (o anterior volta a 0). Sem chamada ao Google.
- **Segurança:** o destino é sempre o que o servidor resolve pelo vínculo do evento no Google e pelas ligações da Zuri, nunca um número vindo da requisição; papel fora da lista com a caixa marcada é recusado; o responsável fora das etiquetas não vira envio para o próprio paciente (criança).
- **Desenho:** `ContactFamilyService.reach(resource)` devolve `{ phone, email, via, gone }` (`ContactReach`); `GET /api/contacts/:id` passa a trazer `reach`; `ConfirmLinks` recebe `reach` nas dependências e usa no botão de e-mail, no e-mail único e na véspera. `whatsappNumber` vai para `packages/shared` para a tela e o servidor usarem a mesma regra.
- **Testes:** `contact-family.test.ts` (E11c), `confirm-links.test.ts` (E11c), `backup.test.ts` (E11c), `free-tier-budget.test.ts`, `shared/contacts-family.test.ts` e o e2e de `contatos.spec.ts` e da Agenda.

## 12. Entrevista com o Pablo

Sem perguntas: tudo coberto pelo protótipo v51 aprovado em 13/11/2026 e pelo ajuste de 12/11, 18:45 UTC.

## 13. Suposições

- A divisão em três PRs é técnica e não muda o que o Pablo vê no fim.
- E11b: o protótipo usa uma lista de seleção com todos os contatos; com até 5.000, a tela usa a busca pelo nome, com o mesmo telefone e nascimento em cada linha.
- E11b: o "X" tira a ligação sem pedir confirmação, como no protótipo; nada se perde, porque os dois contatos ficam e a ligação se refaz em dois toques.
- E11b: um parente fora das etiquetas aparece como "Fora das etiquetas escolhidas" e pode ter a ligação tirada.
- E11b: "Também no grupo familiar" percorre até 50 pessoas; numa família maior que isso, "e mais N" conta só as que achou.
- E11b: a busca do diálogo traz as seis pessoas do formulário da Agenda e tira, na tela, o próprio contato e quem já está ligado. Com muitos nomes parecidos, digitar mais do nome acha o resto.
- E11c (SEC-A9-02): o responsável entra no restore como veio, porque importar um backup já pede a senha digitada nos últimos 15 minutos, a mesma proteção de trocar o celular de um agendamento. O restore só garante um responsável por pessoa e os papéis da CA-C1.
- E11c: o celular do contato usado é o primeiro número brasileiro de celular dele (DDD e nove dígitos começando com 9), a mesma regra do botão WhatsApp da ficha; o e-mail é o primeiro válido. Número de outro país em Contatos não recebe a confirmação automática (no agendamento sem vínculo, continua valendo o DDI digitado).
- E11c: até aqui um agendamento vinculado não guardava celular nem e-mail (E5f, SEC-E5f-04), e a confirmação não saía para ele. A E11c passa a ler os dados de Contatos, como o protótipo (`cfCel`, `cfMail`).
- E11c: o responsável só se escolhe ao ligar o parente, como no protótipo. Para trocar, liga-se outro com a caixa marcada, ou tira-se a ligação e liga-se de novo.

## 14. Perguntas abertas

Nenhuma.
