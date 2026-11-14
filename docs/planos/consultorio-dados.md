# Plano · Configurações › Consultório (E6a)

Situação: aprovado (protótipo v52–v56, Pablo, 13/11/2026 12:49 UTC). Sem perguntas novas: tudo coberto pelo protótipo, pelo plano `sons-menu-e-agenda-editavel.md` (seções "Dados do consultório num lugar só" e "Um lugar só para dias, horário e almoço") e pela regra `.claude/rules/uma-fonte-por-ajuste.md`.

## 1. Resumo

A E6 do cronograma da Agenda ("Consultório e integrações seguras") é grande demais para uma PR. Ela se divide em três entregas, cada uma com a sua PR:

| Entrega | O que entra |
| --- | --- |
| **E6a (esta)** | Configurações › Consultório com os dados do consultório (nome, WhatsApp da equipe, endereço, cidade e estado) e o resumo do horário de atendimento, que leva a Configurações › Agenda. O endereço vai para o Local do evento no Google nas consultas presenciais |
| E6b | Credencial da fzap no cofre de CRM › Credenciais (tipo novo do cofre da S17: endereço https da instância e token, só escrita, senha para mudar) |
| E6c | E-mail para pacientes em Integrações: Gmail (`gmail.send`) ou SMTP 465/587, nome do remetente, "Responder para" e e-mail de teste |

A mensagem modelo, "Como a confirmação sai" e "Remarcar pelo link" chegam com a E7 (link de confirmação). A chave Pix chega com a E8 ("Enviar Pix").

## 2. Contexto no sistema

- Configurações: `apps/web/src/pages/SettingsPage.tsx` (grupos da S16, `SETTINGS_TABS`, `SECTION`); a seção Chatwoot já é um download à parte (`ChatwootTab.tsx`, `lazy`).
- Ajustes: `packages/shared/src/settings.ts` (`settingsSchema`, `DEFAULT_SETTINGS`) e `apps/agent/src/db/settings.ts` (`STORAGE_KEYS`, uma linha de `zur_settings` por campo mudado, registro em Atividade). A rota `PATCH /api/settings` já existe.
- Horário de atendimento: `agenda` dos ajustes (dias, `from`, `to`, almoço), editado só em Configurações › Agenda (`AgendaTab.tsx`).
- Consulta presencial: a linha do tipo "Consulta | Consultório" (`apps/web/src/lib/agenda-fields.ts`, `placeOf`); o servidor grava o evento em `apps/agent/src/api/google.ts` (`POST` e `PATCH /google/events`, `EventDraft.location`).
- Protótipo: `cfgConsultorio()` em `docs/planos/modelos-frontend/prototipo-interativo.html` (seção "Dados do consultório", campos com `maxlength` 80, 160 e 60, WhatsApp no formato "(41) 3333-0000").

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Configurações ganha o grupo **Consultório** (entre "Seu dia" e "Conexões", como no protótipo), com a seção **Consultório** (`/configuracoes/consultorio`), no computador e na lista do celular | protótipo v52 |
| CA2 | "Dados do consultório": nome (até 80), WhatsApp da equipe (DDD e número, máscara "(41) 3333-0000" ou "(41) 93333-0000"), endereço (até 160) e cidade e estado (até 60), com "Salvar os dados". Tudo opcional; texto de uma linha, sem espaços nas pontas | protótipo v52 |
| CA3 | WhatsApp inválido não salva: "Confira o WhatsApp da equipe: DDD e número, por exemplo (41) 3333-0000." O servidor recusa o mesmo (400) | protótipo v52 |
| CA4 | Uma linha "Horário de atendimento" mostra o resumo do horário de Configurações › Agenda ("Segunda a sexta, das 08:00 às 18:00, almoço das 12:00 às 14:00") e o botão **Mudar**, que abre Configurações › Agenda. Consultório não tem campo de horário | regra "Um ajuste, um lugar" |
| CA5 | Consulta presencial criada pela Agenda, sem local, recebe no Local do evento "endereço, cidade e estado". Mudar para presencial uma consulta sem local faz o mesmo. Mudar para online tira o local quando ele é o endereço do consultório. Sem endereço salvo, nada muda | plano 3b, item "Presencial" |
| CA6 | Salvar registra em Atividade (como os outros ajustes) e mostra "Dados salvos" | padrão de Configurações |
| CA7 | Estados: carregando, erro com "Tentar de novo" e salvo; pt-BR e en; teclado; leitor de tela; celular; tema escuro; axe; 44 px | regras da interface |

## 4. Escopo

**Entra:** o grupo e a seção Consultório, o ajuste `clinic`, o resumo do horário e o endereço no Local da consulta presencial (tela e servidor).

**Fica fora:** a credencial da fzap (E6b), o e-mail aos pacientes (E6c), a mensagem modelo, "Como a confirmação sai" e "Remarcar pelo link" (E7), a chave Pix (E8). A página do link (E7) e o pedido de avaliação (já mesclado, S20) passam a ler `clinic` quando cada um usar o nome ou o endereço.

## 5. Como funciona para o Pablo

1. Em Configurações › Consultório, preenche "Consultório Exemplo", "(41) 3333-0000", "Rua das Flores, 120, sala 304 · Centro" e "Curitiba, PR" e toca em **Salvar os dados**.
2. Vê "Dados salvos". Abaixo, a linha do horário de atendimento, com **Mudar**.
3. Na Agenda, cria uma "Consulta | Consultório": o evento no Google já tem o Local "Rua das Flores, 120, sala 304 · Centro, Curitiba, PR". Nos detalhes, "Consultório" com o endereço embaixo.

Estados: carregando (o indicador das outras seções), erro ao carregar (o aviso de erro padrão, com **Tentar de novo**), salvando (botão ocupado), erro ao salvar (a mensagem do servidor, como nas outras seções).

## 6. Regras de negócio e limites

- `clinic`: `{ name, whatsapp, address, city }`, cada um texto de uma linha sem controle nem separador de linha, aparado. Limites: 80, 160 e 60 caracteres; `whatsapp` guarda só os dígitos: DDD de 11 a 99 sem zero e fixo de 8 dígitos ou celular de 9 começando com 9, ou vazio. n−1, n e n+1 testados.
- O Local é `address` e `city` juntos com ", " (só os que existem), até 240 caracteres contados por caractere. Só vale para consulta com a linha do tipo terminada em "| Consultório"; "Reunião | Diretoria" não é consulta.
- `PATCH` de evento: o Local só muda se a consulta mudou de lugar; um Local escrito no Google à mão nunca é trocado.

## 7. Desenho técnico

- `packages/shared/src/clinic.ts`: `CLINIC_LIMITS`, `clinicSchema`, `DEFAULT_CLINIC`, `clinicLocation(clinic)`. `settingsSchema` ganha `clinic`; `STORAGE_KEYS.clinic = "clinic"`.
- `apps/agent/src/api/google.ts`: `deps().clinic()`; `officePlace(draft, current, clinic)` decide o Local no `POST` e no `PATCH`.
- `apps/web/src/pages/settings/ClinicTab.tsx`, sob demanda (`lazy`, como `ChatwootTab`), com os textos em `packages/shared/i18n/pt-BR-clinic.ts`. Máscara do telefone própria (poucas linhas), sem importar `agenda-fields.ts` (regra P11).
- Resumo do horário: função pura `hoursSummary(prefs, t)` no próprio `ClinicTab.tsx`.

## 8. Custo e cotas do plano Free

- Banco: o `PATCH /api/settings` grava uma linha (`clinic`) e a Atividade, como os outros ajustes; ler é a mesma leitura de `GET /api/settings`. Medida em `free-tier-budget.test.ts`.
- Google: nenhum pedido novo (o Local vai no mesmo `insert`/`patch` do evento).
- JS inicial: a seção é um download à parte; o primeiro carregamento não cresce além do registro do grupo. Medir com o build.

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Texto hostil no nome ou endereço (XSS, quebra de linha, controle) | Zod de uma linha, sem controle; a tela mostra como texto | unitário do schema; e2e com `<script>` |
| Corpo grande | limite do `readJson` da rota de ajustes e os tetos de cada campo | rota |
| Local trocado à força num evento editado no Google | só muda quando o lugar da consulta muda | integração do `PATCH` |

Quando o WhatsApp da equipe chegar aos pacientes (E7), mudá-lo passa a pedir a senha de novo e gera aviso de segurança, como o link de avaliações da S20: uma sessão roubada poderia mandar os pacientes para outro número. Hoje o campo só aparece na tela.

Os dados do consultório não são segredo e não são dado de paciente: entram no backup como os outros ajustes.

## 10. Testes

- `packages/shared/test/clinic.test.ts`: limites n−1, n, n+1, telefone 9, 10, 11 e 12 dígitos, controle e quebra de linha, `clinicLocation`.
- `apps/agent/test/google-events-clinic.test.ts` (ou o arquivo vizinho da E5e): `POST` presencial sem local, com local, online, sem endereço; `PATCH` para presencial, para online com o endereço, para online com outro local, sem mudar o lugar.
- `apps/agent/test/settings*.test.ts`: `clinic` salva, recusa telefone inválido, registra Atividade.
- e2e `tests/e2e/configuracoes-consultorio.spec.ts`: salvar e reabrir; erro do WhatsApp; "Mudar" leva à Agenda; nova consulta presencial manda o Local; celular; inglês; axe.

## 11. Entrega

Uma PR para a `develop`, com changelog, `docs/google-agenda.md` (Local da consulta presencial), README (linha de Configurações) e capturas da seção.

## 12. Riscos

- Um evento presencial criado antes desta entrega fica sem Local; só ganha quando mudar de lugar. Aceitável: o Pablo pode escrever no Google.

## 13. Suposições

1. O grupo do menu de Configurações chama "Consultório", com a seção do mesmo nome (protótipo `CFG`).
2. O Local é preenchido pelo servidor, e não pela tela, para valer igual na Agenda e em quem mais criar consultas pela mesma rota.

## 14. Entrevista com o Pablo

Sem perguntas: o protótipo aprovado em 13/11 define o comportamento.
