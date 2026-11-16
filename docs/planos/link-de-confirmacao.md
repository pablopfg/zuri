# Plano · Link de confirmação do paciente (E7)

Situação: aprovado (protótipo v51 em 13/11/2026 01:44 UTC e v52–v56 em 13/11/2026 12:49 UTC; pedidos de 12/11 à noite, 13/11 00:15 itens 6–8, 01:04 itens 3–4, 01:32 item 1 e 03:08). Sem perguntas novas: tudo coberto pelo plano [sons-menu-e-agenda-editavel.md](sons-menu-e-agenda-editavel.md) (seção 11, "Link de confirmação", "Link único, expiração e envio sem duplicar", "Respostas do paciente nas cores", "Link do paciente: erros, caminhos e Cloudflare").

## 1. Resumo

Cada agendamento com tipo (Consulta, Retorno, Avaliação física) ganha um link só dele, `https://<domínio>/c/<token>`, que o paciente abre sem entrar na Zuri para confirmar a presença, cancelar dentro do prazo ou remarcar. A resposta muda a situação e a cor do evento no Google e chega em Avisos.

A E7 é grande e se divide em três PRs, na ordem:

| PR | O que entra | Migration |
| --- | --- | --- |
| **E7a. Link e página** | Token, tabela, página pública com confirmar e cancelar (prazo, expiração, freios, cabeçalhos), "Falar com a equipe" com mensagem pronta, "Confirmação do paciente" nos detalhes do agendamento com Copiar link e Ver como o paciente, aviso ao Pablo, WhatsApp da equipe com senha recente | 45 `zur_appointment_links` |
| **E7b. Remarcar pelo link** | "Preciso remarcar" em 4 passos (8 dias, só dias livres, de 1 em 1 hora, colado a uma consulta ou 2 sorteados, até 2 vezes por consulta), trava única no objeto e releitura do dia, "Esse horário acabou de ser ocupado", sons e transições | 46 (duas colunas em `zur_appointment_links`) |
| **E7c. Envio da confirmação** | Mensagem modelo em Configurações › Consultório (variáveis, prévia, padrão), "Enviar pelo WhatsApp" e "Copiar mensagem" nos detalhes, envio automático pelo Chatwoot na véspera útil pela fila da S19, "Também por e-mail" pelo `MailService.send()` da E6c (assunto, texto e botão editáveis), registro dos envios sem duplicar | a próxima livre (registro dos envios) |

O resto deste plano detalha a E7a. A E7b e a E7c ganham a sua seção "Diferenças" aqui quando começarem.

## 2. Contexto no sistema

- **Base do link curto da S20:** `apps/agent/src/gates/review-link.ts` (formato conferido no Worker, `isPreviewAgent`), `reviewLink()` em `apps/agent/src/index.ts` (antes do Access, cabeçalhos `no-store`, `no-referrer`, `noindex`), `ReviewRequests.open()` em `apps/agent/src/reviews/requests.ts` (contagem por rede em memória, chave da rede com HMAC). A E7 reaproveita o desenho e o freio.
- **Página pública no SPA:** `ApprovePage.tsx` (rota `/aprovar` fora de `RequireSession`, lazy em `apps/web/src/App.tsx`) e as rotas sem sessão de `apps/agent/src/api/approvals.ts`, registradas antes de `requireSession` e depois do CSRF em `apps/agent/src/api/app.ts`. A página do paciente segue o mesmo caminho.
- **Situação = cor:** `EVENT_STATUS_COLOR` em `packages/shared/src/google.ts` (Confirmado 10, Cancelado 11, Reagendado 5). `GoogleCalendar.updateEvent(calendarId, eventId, patch, etag, meter)` em `apps/agent/src/google/service.ts`.
- **Regras da agenda:** `packages/shared/src/agenda-rules.ts` (`frozenDay`, `appointmentProblem`, `nextFreeSlot`) e o tipo do agendamento em `typeLine`/`bindsBooking`. O registro do dia congelado (E5b) vale também para o link: consulta de hoje já não aceita cancelar pelo link (prazo) e só confirma até 1 hora antes.
- **Consultório:** `clinic` em `zur_settings` (`packages/shared/src/clinic.ts`, E6a): nome, endereço, cidade e WhatsApp da equipe, lidos na hora de montar a página.
- **Registro:** `apps/agent/src/log.ts` troca o que não é palavra de rota por `:id`; o token nunca chega aos registros.
- **Protótipo:** `confirmar()`, `cfAsk()`, `cfBox()`, `cfDeadline()`, `cfExpired()` e `cfTeamHref()` em `docs/planos/modelos-frontend/prototipo-interativo.html`.

## 3. Objetivo e critérios de aceite (E7a)

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Um token por agendamento: 128 bits de `crypto.getRandomValues`, 22 caracteres base64url, criado na primeira vez que o Pablo pede o link; pedir de novo devolve o mesmo endereço | "Link único" |
| CA2 | O banco guarda o SHA-256 do token (`UNIQUE`) e o token cifrado (para reenviar); nunca o token em texto. O servidor acha o agendamento só pelo hash | "Lógica e segurança" |
| CA3 | A página mostra o nome do consultório, o primeiro nome, o dia, o horário, o tipo e o local (endereço ou "online"), "Confirmar presença", "Falar com a equipe pelo WhatsApp" e "Cancelar a consulta" com o prazo exato. Nunca celular, e-mail, nome completo, observação ou financeiro | protótipo `confirmar()` |
| CA4 | Confirmar muda a situação para Confirmado (cor 10) no Google; abrindo de novo, "Presença confirmada" e ainda dá para cancelar no prazo | 12/11 22:11 |
| CA5 | Cancelar abre "Cancelar a consulta?" com o foco em "Não, manter a consulta"; só "Sim, cancelar a consulta" cancela. Muda para Cancelado (cor 11), sem apagar o evento, e o link deixa de valer na hora ("Consulta cancelada"; abrindo de novo, "Este link expirou") | 12/11 21:37 e 22:02 |
| CA6 | Prazo para cancelar: o que vier primeiro entre 12 horas antes do início e 23:59 do dia anterior, no fuso do dono, conferido no servidor no `POST`. Fora dele, "O prazo para cancelar por aqui acabou" com o WhatsApp da equipe | 12/11 21:37 |
| CA7 | O link expira 1 hora antes do início e quando a consulta é cancelada (pelo link ou pela Agenda). Expirado não confirma nem cancela | 12/11 22:02 |
| CA8 | Evento movido de dia ou hora: o mesmo link mostra o horário novo e volta a pedir a confirmação | 12/11 |
| CA9 | Formato errado (tamanho, caractere, `/c/`, caminho a mais) dá "Este link não vale mais" sem tocar no banco nem no objeto; parâmetros são ignorados | 03:08 |
| CA10 | Token que não existe, de evento apagado, movido para outra agenda ou que deixou de ser consulta: a mesma página "Este link não vale mais", mesmo código e mesmo corpo. Link revogado (consulta cancelada) ou a menos de 1 h: "Este link expirou", sem os dados da consulta | 03:08 |
| CA11 | Freios por rede: 30 aberturas e 10 respostas a cada 10 minutos; 3 tokens inválidos em 10 minutos bloqueiam a rede por 1 hora na `/c/`; por link, 10 respostas por dia. Acima, 429 e "Tente de novo em alguns minutos" | 12/11 22:11 |
| CA12 | Abrir não muda nada: só o `POST` do botão muda, com ação de lista fixa (`confirm` \| `cancel`), `Origin` da Zuri e resposta idempotente (o segundo toque mostra o estado atual) | 12/11 |
| CA13 | Google fora do ar: "Não deu para carregar agora. Tente de novo em instantes", sem dado; botão que falha não muda nada | 03:08 |
| CA14 | O HTML de `/c/` é o genérico da Zuri (sem nome, data nem consultório), com `X-Robots-Tag: noindex`, `Cache-Control: no-store` e `Referrer-Policy: no-referrer`; o service worker não guarda nada de `/c/`; a página não mostra menu nem link para dentro da Zuri | 03:08 |
| CA15 | Com o Cloudflare Access ligado, o paciente abre o link sem passar pelo Access; o resto da Zuri continua atrás dele | 03:08 ("nada novo na Cloudflare") |
| CA16 | A resposta chega em Avisos ("Ana confirmou pelo link" / "cancelou pelo link") e o sino sobe | 12/11 |
| CA17 | Nos detalhes do agendamento com tipo, "Confirmação do paciente": a situação (Ainda não enviado, Confirmou pelo link, Cancelou pelo link), "Copiar link" e "Ver como o paciente". Agendamento cancelado ou que já passou diz que o link deixou de valer e não oferece o link | protótipo `cfBox()` |
| CA18 | Mudar o WhatsApp da equipe em Configurações › Consultório pede a senha recente e gera aviso de segurança (ele passa a ir para pacientes) | consultorio-dados.md |
| CA19 | pt-BR e en, teclado, leitor de tela, celular, tema escuro, axe, 44 px; menos movimento respeitado | regras da interface |

## 4. Escopo

**Entra (E7a):** a tabela, o token, a rota do dono que dá o link e a situação, as duas rotas públicas (ver e responder), a página `/c/:token`, os cabeçalhos e a passagem pelo Access, o aviso, o bloco nos detalhes do agendamento e a senha recente no WhatsApp da equipe.

**Fica fora:** remarcar (E7b); mensagem modelo, botão do WhatsApp com a mensagem, Chatwoot e e-mail (E7c); a página não toca som de remarcação nem "horário ocupado" (E7b).

## 5. Como funciona para o Pablo

1. Na Agenda, abre um agendamento de consulta. Em "Confirmação do paciente" vê "Ainda não enviado", toca em **Copiar link** e cola no WhatsApp da paciente (o envio pronto chega na E7c). **Ver como o paciente** abre a página numa aba nova.
2. A paciente abre o link no celular: "Olá, Ana! Confirme sua presença na consulta.", o cartão com dia, horário, tipo e endereço e os botões. Toca em **Confirmar presença**: toca o Sino e aparece "Presença confirmada. Até lá, Ana!".
3. Na Zuri, o sino sobe com "Ana confirmou pelo link"; o agendamento fica verde (Confirmado) na Agenda e no Google, e os detalhes dizem "Confirmou pelo link hoje às 10:12".
4. Se a paciente cancelar no prazo, o evento fica vermelho (Cancelado), o horário fica livre e o aviso diz "cancelou pelo link".

Estados da página: carregando (esqueleto), pendente, confirmado, cancelado agora, expirado, fora do prazo de cancelar, link inválido, muitas tentativas (429) e indisponível (Google fora do ar).

### Textos visíveis

Chaves em `packages/shared/i18n/pt-BR-confirm.ts` (`web.confirm.*`) e no `en.ts`, com os textos do protótipo: "Olá, {nome}!", "Confirme sua presença na consulta.", "Confirmar presença", "Presença confirmada.", "Até lá, {nome}!", "Cancelar a consulta", "Cancelar a consulta?", "Não, manter a consulta", "Sim, cancelar a consulta", "Dá para cancelar por aqui até {prazo}.", "O prazo para cancelar por aqui acabou: vai até 12 horas antes e só até o dia anterior. Se não puder vir, fale com a nossa equipe pelo WhatsApp.", "Consulta cancelada", "Este link expirou", "Este link não vale mais", "Falar com a equipe pelo WhatsApp", "Este link é só deste agendamento. Não mostra seu telefone nem outros dados.". A mensagem pronta do WhatsApp da equipe: "Olá! Sou {nome}, tenho consulta marcada para {dia} às {hora} e tenho uma dúvida." (link inválido: "Olá! Tenho uma dúvida sobre a minha consulta.").

## 6. Regras de negócio e limites

- Token: exatamente 22 de `[A-Za-z0-9_-]` (`CONFIRM_LINK_LIMITS.tokenLength`).
- Só agendamento com tipo, com hora e com uma cor que é situação ganha link. Pedir o link de outro evento dá 400 `error.confirmLinkNotAppointment`; numa agenda só de leitura, 409 `error.confirmLinkReadOnly`. Um link já feito cujo evento deixou de ser consulta (dia inteiro, sem tipo, cor fora das quatro) ou cuja agenda passou a só leitura ou fechada responde 404 ao paciente.
- Consulta movida no Google mantendo a cor Confirmado pergunta de novo: a página só mostra "confirmada" quando a resposta do paciente é do mesmo início (ou quando quem confirmou foi o dono). Confirmar de novo grava o início novo sem mudar a cor no Google.
- Google esperando o dono (acesso revogado): 503, "tente de novo". Desconectar o Google apaga os links, como os de avaliação: daí em diante, 404.
- Expira: início − 1 h, ou cor Cancelado, ou `revoked_at`. Cancelado nunca volta a valer (nem se o evento for reaberto).
- Prazo de cancelar: `min(início − 12 h, 23:59 do dia anterior)` no fuso do dono.
- Freios: por rede, 30 aberturas e 10 respostas por janela fixa de 10 minutos; 3 inválidos na mesma janela dão 1 hora de bloqueio (a janela é fixa, como na S20: 2 no fim de uma e 2 no começo da seguinte passam); por link, 10 respostas por dia (no banco). Contagem por rede em memória, como a S20: um estranho não grava nada; reiniciar o objeto só deixa passar algumas tentativas a mais, e 2¹²⁸ tokens tornam o chute inútil.
- Resposta repetida: confirmar o já confirmado ou cancelar o já cancelado devolve o estado atual, sem gravar. Dois toques ao mesmo tempo: o segundo encontra a cor já mudada (412 e releitura) e não grava nem avisa de novo.

## 7. Desenho técnico

### Arquivos

- `packages/shared/src/confirm-link.ts`: limites, formato do token (`CONFIRM_TOKEN`, `confirmLinkToken`), schemas (`confirmViewSchema`, `confirmAnswerSchema`, `confirmLinkRequestSchema`) e os tipos `ConfirmView`, `ConfirmLinkStatus` e `ConfirmLinkMade`. O prazo de cancelar fica no servidor (`ConfirmLinks.cancelUntil`), que é quem decide.
- `apps/agent/src/google/confirm-links.ts`: `ConfirmLinks` com `link(calendarId, eventId)`, `status(...)`, `view(token, network)` e `answer(token, action, network)`; rotas em `apps/agent/src/api/confirm.ts`; passagem pelo Access em `apps/agent/src/gates/confirm-link.ts`.
- `apps/agent/src/api/confirm.ts`: `registerConfirmPublic` (sem sessão, depois do CSRF e antes de `requireSession`, como as aprovações) e `registerConfirmOwner` (rotas do dono).
- `apps/agent/src/index.ts`: `/c/` antes do Access, serve o `index.html` com os cabeçalhos do link; `/api/c/*` e os arquivos com hash de `/assets/` passam pelo Access.
- `apps/web/src/pages/confirm/ConfirmPage.tsx` (fora de `RequireSession`, no mesmo download sob demanda do `/aprovar` para não somar um pedaço ao primeiro carregamento) e `apps/web/src/pages/agenda/ConfirmBox.tsx`, o bloco nos detalhes do agendamento da Agenda.
- O service worker (`apps/web/public/sw.js`) não guarda nada, então nada de `/c/` fica no aparelho do paciente.

### Rotas e contratos

| Rota | Quem | O quê |
| --- | --- | --- |
| `POST /api/c/view` `{ token }` | público (CSRF de mesma origem, freio por rede) | `{ state, clinic, first, start, end, zone, type, online, place, cancelUntil, canCancel, team }`; `state`: `open` \| `confirmed` \| `cancelled` \| `expired`; o link que não vale é 404 |
| `POST /api/c/answer` `{ token, action }` | público (idem) | o mesmo corpo de `view`, depois da resposta |
| `POST /api/google/events/link` `{ calendarId, eventId }` | dono (sessão) | `{ made, answer, answeredAt, answerStart, url }`: cria o token na primeira vez |
| `GET /api/google/events/link?calendarId&eventId` | dono | `{ made, answer, answeredAt, answerStart }` sem criar |

O token vai no corpo, nunca no endereço da API: não aparece em registro de rota nem em cabeçalho. Erros: 400 `VALIDATION_FAILED`, 404 `NOT_FOUND` (mesma resposta para todo token que não vale; revogado responde 200 `expired`), 429 `RATE_LIMITED` com `retryAfter`, 503 `SERVICE_UNAVAILABLE`.

### Banco

Migration 45, `zur_appointment_links`: `id`, `calendar_id`, `event_id` (`UNIQUE (calendar_id, event_id)`), `token_hash` (`UNIQUE`), `token_sealed`, `created_at`, `answer` (`confirmed` \| `cancelled` \| null), `answer_start` (o início a que a resposta se refere: a consulta que mudou de hora pergunta de novo), `answered_at`, `revoked_at`, `answer_day`, `answer_count`. Fora do backup (o token cifrado só vale com a chave desta instalação; um link restaurado em outra seria um link morto).

### Ferramentas do agente

Nenhuma ferramenta nova: o agente não cria nem lê links (o link vai a terceiros).

### Agendamentos, IA e integrações externas

Uma leitura do evento no Google por abertura (`events.get`) e um `PATCH` com etag por resposta, com prazo e `GoogleMeter` próprio (2 por pedido). Sem IA.

## 8. Custo e cotas do plano Free

- Link novo (dono): até 4 escritas (a linha, a chave e os dois índices únicos), uma vez por consulta; pedir de novo só lê.
- Abertura: 1 pedido ao Worker e 1 ao objeto, 1 subrequisição ao Google, 1 linha lida, 0 escritas (token desconhecido: 0 linhas).
- Resposta: 1 `PATCH` no Google (2 se o evento mudou no meio), até 2 linhas lidas e 1 escrita no link, mais o aviso.
- Mudar o WhatsApp da equipe: até 27 escritas (a linha, a atividade, o evento de segurança e o aviso, com os índices). É raro: o dono muda o número uma vez.
- Pior caso (força bruta): o freio corta em 30 aberturas por rede e 10 minutos, e 3 tokens errados tiram a rede por 1 h, sem escrita. Medido em `free-tier-budget.test.ts` (P1).

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Adivinhar tokens | 128 bits, freio por rede, bloqueio após 3 inválidos, mesma resposta para tudo que não vale | rota e unitário, 4º inválido dá 429 |
| Token de A abre ou muda B | busca só pelo hash, o evento vem da linha, nunca do pedido | integração |
| Prévia do WhatsApp confirma | `GET` não muda; só `POST` com ação | e2e e rota |
| `POST` de outro site | CSRF de mesma origem (`Origin`), ação em lista fixa | rota |
| Vazar dado pessoal | só primeiro nome, dia, hora, tipo e local; HTML genérico; `no-referrer`; o service worker não guarda nada | e2e e rota |
| Token nos registros | token no corpo; `/c/<token>` vira `:id` no log | unitário do log |
| Clickjacking | `frame-ancestors 'none'` e `X-Frame-Options: DENY` | e2e de cabeçalhos |
| Trocar o WhatsApp da equipe para desviar pacientes | senha recente e aviso de segurança | rota 14:50/15:00 |

## 10. Testes

- Unitário (`packages/shared/test/confirm-link.test.ts`): formato do token (21, 22, 23 caracteres e caractere fora) e os dois corpos. O prazo de cancelar (09:00 e 20:00, n−1, n e n+1 minuto, dia de 23 h e 25 h num fuso com horário de verão) e a expiração (n−1, n, n+1 minuto) estão no teste de integração.
- Integração (`apps/agent/test/confirm-links.test.ts`): link único, mesmo endereço ao pedir de novo, hash e cifra no banco, token de A não muda B, evento apagado ou em outra agenda, cancelado revoga, idempotência, freios (30/31, 10/11, 3 inválidos e o 4º), 10 respostas por link e dia, Google fora do ar, fuso do dono diferente do aparelho.
- Rota (`auth-password-route.test.ts` na lista `PUBLIC`, senha recente do WhatsApp da equipe), orçamento (`free-tier-budget.test.ts`).
- E2E (`tests/e2e/link-de-confirmacao.spec.ts`): página pendente, confirmar, cancelar com o aviso e o foco, fora do prazo, expirado, inválido, cabeçalhos, detalhes do agendamento com Copiar link, axe e celular (`@mobile`); `a11y.spec.ts` e `csp.spec.ts` com `/c/`.

## 11. Entrega

| PR | Situação |
| --- | --- |
| E7a. Link e página | mesclada (#355) |
| E7b. Remarcar pelo link | mesclada (#356) |
| E7c1. Mensagem modelo e envio pelo WhatsApp | mesclada (#357) |
| E7c2. E-mail de confirmação | mesclada (#358) |
| E7c3a. Confirmação automática pelo Chatwoot | em andamento |
| E7c3b. Também por e-mail, na mesma hora | a fazer |

Cada PR traz changelog, README, capturas lado a lado com o protótipo e o teto do JS inicial (141.200 B, OK do Pablo em 15/11/2026): a página do paciente e o bloco dos detalhes carregam sob demanda.

## 12. Riscos

- **Access e arquivos:** passar `/assets/` pelo Access deixa o código da interface aberto, que já é público no repositório; nenhum dado vem junto.
- **Etag:** o Pablo pode mudar o evento no Google enquanto o paciente toca no botão; o `PATCH` com etag recusa e a Zuri lê de novo uma vez antes de responder.

## 13. Suposições

- Rotas públicas por `POST` com o token no corpo, como `/api/approvals/telegram/*`, em vez de `GET /api/c/:token`: o token fica fora dos endereços e dos registros.
- Freio por rede em memória, como a S20.
- `zur_appointment_links` fora do backup.

## 14. Entrevista com o Pablo

Sem perguntas: tudo coberto pelas decisões de 12/11 e 13/11 citadas acima.

### Perguntas abertas

Nenhuma.

## 15. Diferenças da E7b (remarcar pelo link)

Situação: aprovado com o protótipo (v51 e v52–v56, 13/11/2026). Regras de `sons-menu-e-agenda-editavel.md`: "Remarcar pelo link, pelo próprio paciente" (12/11, 22:37), "2. Remarcar pelo link, revisado" (13/11, 00:15), itens 3 e 4 de 13/11 01:04 e item 1 de 13/11 01:32. Sem perguntas novas ao Pablo.

### Critérios de aceite

- **CA-R1.** "Preciso remarcar" aparece na página com o link valendo, dentro do prazo de cancelar e com menos de 2 remarcações pelo link; fora disso, a página diz para falar com a equipe. O aviso de cancelar oferece "Prefiro remarcar" nas mesmas condições.
- **CA-R2.** Passo 1 mostra só os dias de amanhã até 8 dias à frente que têm pelo menos um horário livre. Sem nenhum, "Combinar pelo WhatsApp" com a mensagem pronta.
- **CA-R3.** Passo 2 mostra só os turnos com horário livre: manhã do início ao almoço, tarde do fim do almoço ao fim. Sem almoço, o turno corta ao meio-dia.
- **CA-R4.** Passo 3 mostra as horas do turno de 1 em 1 hora, a partir do início, que cabem com a duração da consulta.
- **CA-R5.** Passo 4 oferece: num turno com consulta, até 3 horários livres colados antes ou depois de uma consulta, os mais perto da hora escolhida primeiro; sem colado livre, os 2 de menor pontuação do protótipo (minutos até a consulta mais próxima, mais 1,5 vez os minutos até a hora escolhida), em ordem de horário; num turno sem consulta, 2 horários sorteados que não mudam ao recarregar.
- **CA-R6.** Livre quer dizer: dia de atendimento, sem feriado nem dia sem expediente, dentro do horário, fora do almoço, sem encostar em nenhum evento com hora de nenhuma agenda lida (consultas, compromissos e agendas só de leitura), exceto ela mesma e os cancelados.
- **CA-R7.** Escolher pede confirmação ("Remarcar para este horário?", foco em "Voltar"). O servidor refaz a oferta na hora de gravar, sob uma trava única no objeto, lendo o dia de novo: se o horário saiu da oferta, 409 e "Esse horário acabou de ser ocupado", com a lista nova.
- **CA-R8.** Remarcar muda o mesmo evento no Google (início e fim, com etag) e a cor para Reagendado. O link continua o mesmo e mostra "Consulta remarcada" com o horário novo, ainda com cancelar dentro do novo prazo.
- **CA-R9.** O Pablo recebe o aviso "{nome} remarcou pelo link", de {antes} para {depois}. Os detalhes do agendamento mostram "Remarcou pelo link" com o horário de antes.
- **CA-R10.** Até 2 remarcações por consulta pelo link, contadas no banco; a terceira é 409. Só consultas de 15 minutos a 4 horas remarcam pelo link (fora disso, a equipe).
- **CA-R11.** A lista de dias e a oferta passam pelo freio de aberturas da rede; remarcar, pelo de respostas e pelo de 10 por link e dia. Nenhuma resposta traz nome, tipo, quantidade ou horário de outro evento: só dias, turnos e horários livres.
- **CA-R12.** Sons do sistema: Sino ao remarcar, dois tons graves quando o horário acabou de ser ocupado. Transição curta entre os passos, sem animação para quem pede menos movimento.
- **CA-R13.** Celular, tema escuro, teclado, leitor de tela (título de cada passo recebe o foco), 44 px, inglês.

### Rotas e contratos

| Rota | Corpo | Resposta |
| --- | --- | --- |
| `POST /api/c/days` | `{ token }` | `{ length, days: [{ day, turns: [{ turn, from, to, hours }] }] }`, só dias e turnos com vaga; `hours` são as horas do passo 3 |
| `POST /api/c/offer` | `{ token, day, turn, pref }` | `{ slots: [minuto] }`, até 3 |
| `POST /api/c/reschedule` | `{ token, day, turn, pref, start }` | a página (`ConfirmView`) com `state: "rescheduled"`; 409 `error.rescheduleTaken` quando o horário saiu da oferta |

`ConfirmView` ganha `canReschedule`. `ConfirmAnswer` e o estado da página ganham `rescheduled`; `ConfirmLinkStatus` ganha `previousStart`.

### Banco

Migration 46: `zur_appointment_links` ganha `reschedules INTEGER NOT NULL DEFAULT 0` e `previous_start TEXT`. Continua fora do backup.

### Custo

Cada passo lê o Google uma vez por agenda aberta (até 10 chamadas); remarcar lê o evento, a lista do dia, grava e, num 412, lê de novo (até 14). Banco: os passos não escrevem; remarcar escreve 1 linha e o aviso. Sem recurso novo.

### Segurança

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Ver a agenda de outros pela lista | Só dias, turnos e minutos livres; nada de evento | `confirm-links.test.ts` › days/offer |
| Remarcar para um horário que não foi oferecido | O servidor recalcula a oferta e exige o horário nela | › refuses a slot outside the offer |
| Dois pacientes no mesmo horário | Trava única no objeto e releitura do dia antes de gravar | › two reschedules at once |
| Remarcar sem fim | 2 por consulta e 10 respostas por link e dia | › third reschedule |
| Prever o sorteio | Semente HMAC com o segredo do servidor, por link, dia e turno | › draw is stable and needs the secret |

### Suposições

- O sorteio do turno sem consulta é um HMAC do link, do dia e do turno com o segredo do servidor, e não um número guardado: não muda ao recarregar e não grava nada.
- Evento de dia inteiro não ocupa horário (o dia fechado vem de "Dias sem expediente").
- Sem almoço configurado, manhã e tarde se dividem ao meio-dia.

## 16. Diferenças da E7c1 (mensagem modelo e envio pelo WhatsApp)

A E7c ficou grande demais para uma PR e foi dividida em três, na ordem em que uma depende da outra:

| PR | O que entra |
| --- | --- |
| **E7c1** | Mensagem modelo em Configurações › Consultório; "Enviar pelo WhatsApp", "Enviar de novo" e "Copiar mensagem" nos detalhes; registro dos envios (migration 47) |
| **E7c2** | E-mail de confirmação (assunto, texto e botão) em Integrações › E-mail para pacientes; "Enviar por e-mail" nos detalhes, pelo `MailService.send()` da E6c |
| **E7c3** | Envio automático pelo Chatwoot na véspera útil, pela fila da S19, junto com o e-mail; "Como a confirmação sai" completo e "Não foi enviado" |

### Critérios de aceite

- **CA-M1.** Configurações › Consultório ganha "Mensagem de confirmação": o texto, a contagem "N de 1.000", um botão por variável (`{nome}`, `{tipo}`, `{dia}`, `{hora}`, `{local}`, `{link}`, `{prazo}`, `{consultorio}`, `{whatsapp}`) que põe a variável onde está o cursor, a prévia "Como chega" num balão do WhatsApp (com `*texto*` em negrito, montada com nós de texto), "Voltar ao modelo padrão" e "Salvar a mensagem".
- **CA-M2.** O servidor recusa (Zod, 400 com o campo `confirmMessage`) mensagem vazia, com mais de 1.000 caracteres, sem `{link}`, com variável fora da lista, com endereço ou telefone escrito à mão (auditoria E7c1-01) ou com caractere de controle. A tela mostra o erro antes de enviar e diz o nome da variável desconhecida; a contagem é a mesma nos dois lados (texto em NFC).
- **CA-M3.** O modelo padrão é o do protótipo e sai do catálogo no idioma do dono. Guardar "" quer dizer "o padrão"; voltar ao padrão grava "".
- **CA-M4.** Nos detalhes de uma consulta, "Enviar pelo WhatsApp" abre `https://wa.me/<DDI+celular>?text=<mensagem>` numa aba nova, com a mensagem montada no servidor (primeiro nome, tipo, dia, hora, local ou Meet, link, prazo, consultório e WhatsApp da equipe). Sem celular, o botão não aparece e a dica manda copiar.
- **CA-M5.** Tocar em "Enviar pelo WhatsApp" registra o envio: a situação vira "Enviado pelo WhatsApp {quando}. Ainda sem resposta." e o botão vira "Enviar de novo". O registro é por horário: a consulta movida volta a "Ainda não enviado".
- **CA-M6.** "Copiar mensagem" copia o mesmo texto e não registra envio. "Ver como o paciente" continua. Já confirmada: "Já confirmou pelo link: não precisa enviar de novo." sem os botões.
- **CA-M7.** O registro guarda só o link, o horário, o canal e a hora: nem texto, nem telefone. Fica fora do backup, como os links. A mensagem modelo do dono vai no backup (`BACKUP_SETTINGS`) e volta pelas mesmas regras do CA-M2.
- **CA-M9.** Com os dados do consultório em branco, a mensagem não deixa `**`, ": ." nem linhas vazias seguidas: o nome vira "consultório" e o trecho do telefone some. Valor do evento ou do consultório com endereço não entra (auditoria E7c1-02 e 03).
- **CA-M8.** Celular, tema escuro, teclado, leitor de tela, 44 px e inglês, como o resto da Agenda.

### Rotas

| Rota | O que faz |
| --- | --- |
| `POST /api/google/events/link` | Já existia. Passa a devolver também `message`, a mensagem do modelo preenchida para aquele agendamento |
| `POST /api/google/events/link/sent` | `{ calendarId, eventId, channel: "whatsapp" }`: registra o envio para o horário atual. Só com o link já feito; 409 se o agendamento acabou ou foi cancelado |
| `GET /api/google/events/link` | Já existia. Passa a devolver `sentChannel`, `sentAt` e `sentStart`, o último envio |

### Banco

Migration 47 `confirm_sends`: `zur_confirm_sends (link_id, start, channel, sent_at, PRIMARY KEY (link_id, start, channel)) WITHOUT ROWID`. Enviar de novo pelo mesmo canal atualiza `sent_at`. A E7c3 usa a mesma chave (link e horário) para não mandar duas vezes. O modelo fica em `zur_settings`, chave `confirmMessage` (um texto; "" é o padrão).

### Custo

O registro grava uma linha (P4: uma escrita por toque, nada quando o toque se repete no mesmo minuto). O status lê uma linha a mais pelo índice da chave primária. Montar a mensagem não chama a IA e usa a leitura do evento que `link` já fazia.

### Segurança

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Texto do evento ou do consultório quebrando a mensagem | Só as variáveis da lista são trocadas, uma vez, sem reavaliar o resultado: um `{link}` no título do evento continua texto | `confirm-message.test.ts` |
| Injeção na prévia | A prévia monta nós de texto e `<b>`, sem `innerHTML` | e2e da prévia com `<img onerror>` no modelo |
| Abrir outro site pelo botão | O endereço é sempre `https://wa.me/` com o número em dígitos e o texto em `encodeURIComponent`; a aba abre com `opener = null` | `ConfirmBox` e2e |
| Registro de envio de outra consulta | O `POST` só age sobre o link do evento pedido, feito antes | `confirm-links.test.ts` (E7c1) |

### Suposições

- A prévia de Configurações usa um exemplo inventado (Érica, quinta-feira às 14:00) em vez do "próximo agendamento da agenda" do protótipo: ler a agenda do Google só para a prévia custaria uma chamada a cada abertura da tela. O texto embaixo diz "Exemplo".
- "Copiar link" dos detalhes vira "Copiar mensagem", como no protótipo.
- O status mostra o envio mais recente. Se a consulta muda de hora e depois volta à hora antiga, a tela diz "Ainda não enviado" mesmo com um envio antigo para aquela hora; a E7c3 usa a linha da hora certa para não repetir o envio automático.
- Telefone fixo do paciente também ganha o botão do WhatsApp (o `wa.me` abre e o WhatsApp diz se o número não tem conta). Em inglês, a hora segue o formato do idioma ("02:00 PM").


## 17. Diferenças da E7c2 (e-mail de confirmação)

Protótipo: `mailTplSec()` e `mailTplCheck()` (Integrações › E-mail para pacientes) e o botão `data-cf-mail` dos detalhes, aprovados com a v52–v56 (13/11, 12:49 UTC). Sem perguntas ao Pablo.

### Critérios de aceite

- **CA-E1.** Integrações › E-mail para pacientes ganha o cartão "E-mail de confirmação de consulta": assunto (com as variáveis `{nome}`, `{tipo}`, `{dia}`, `{hora}` e `{consultorio}`), texto (com a contagem "N de 2.000" e todas as variáveis menos `{link}`), texto do botão, a prévia "Como chega" (De, Assunto, o texto, o botão e o rodapé), "Voltar ao modelo padrão", "Copiar o texto do WhatsApp" e "Salvar o e-mail".
- **CA-E2.** O servidor recusa (400 com o campo `confirmMail`): assunto vazio, com quebra de linha, acima de 120 caracteres ou com variável fora das cinco; texto vazio, acima de 2.000, com `{link}` ("o link já vai no botão") ou com variável desconhecida; botão vazio ou acima de 30. Nos três, endereço da web ou telefone escrito à mão e caractere de controle (a regra da E7c1-01). A tela mostra o mesmo erro antes de enviar, no campo certo.
- **CA-E3.** O padrão é o do protótipo, no idioma do dono; "" em cada campo quer dizer o padrão, e "Voltar ao modelo padrão" grava os três como "".
- **CA-E4.** Nos detalhes de uma consulta com e-mail do paciente (o campo da E5e), "Enviar por e-mail" manda o e-mail pelo `MailService.send()` da E6c (o mesmo teto de 100 por dia) e registra o envio no canal `email`. A situação vira "Enviado por e-mail {quando}. Ainda sem resposta." e o botão some para aquele horário.
- **CA-E5.** O e-mail sai em texto e em HTML (`multipart/alternative`). No texto, o botão vira "Rótulo: endereço". No HTML, tudo o que vem do dono, do evento e do consultório passa por escape, as quebras viram `<br>` e só o botão é um `<a>` para o link do paciente. Sem imagens nem rastreio.
- **CA-E6.** Sem e-mail no agendamento, o botão não aparece. Sem o e-mail configurado, com o teto do dia batido ou com o servidor recusando, a tela diz que não saiu e aponta para Integrações › E-mail para pacientes; nada é registrado.
- **CA-E7.** Celular, tema escuro, teclado, leitor de tela, 44 px e inglês.

### Rotas

| Rota | O que faz |
| --- | --- |
| `POST /api/google/events/link/mail` | `{ calendarId, eventId }`: faz o link se ainda não existe, monta o e-mail do modelo, manda para o e-mail do agendamento e registra o envio. 409 sem e-mail, com a consulta cancelada ou vencida; 503 quando o e-mail não sai |
| `GET /api/google/events/link` | Passa a devolver `mailedStart`, o horário do último envio por e-mail |

### Banco

Sem migration: o envio usa `zur_confirm_sends` com `channel = 'email'`. O modelo fica em `zur_settings`, chave `confirm_mail` (`{ subject, body, button }`, "" é o padrão), e vai no backup.

### Custo

Um envio lê o evento (1 subrequisição) e manda o e-mail (Gmail: até 2; SMTP: uma conexão), dentro do teto de 100 e-mails por dia da E6c. Grava a contagem do dia e uma linha de registro. Nenhuma IA.

### Segurança

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Sessão roubada mudando o e-mail para mandar os pacientes a outro lugar | Mesma regra da E7c1-01 nos três campos; o link só vai no botão | `confirm-mail.test.ts`, `confirm-links.test.ts` (E7c2) |
| HTML injetado pelo modelo, pelo título do evento ou pelo consultório | Escape de `& < > " '` em tudo; só o botão é marcação, com o endereço do próprio link | `confirm-links.test.ts` (E7c2) |
| Cabeçalho injetado pelo assunto | O assunto é uma linha só (schema) e sai codificado (RFC 2047) pelo `buildMessage` | `mail-smtp.test.ts` |
| E-mail para outro endereço | Só o e-mail guardado no agendamento, validado por `isMailAddress`; a rota não aceita destinatário | `confirm-links.test.ts` (E7c2) |
| Sessão roubada mandando o mesmo e-mail em laço e gastando o teto do dia (SEC-E7c2-04) | Um e-mail por horário: o envio é reservado antes de sair (dois toques ao mesmo tempo mandam um só) e devolvido se falhar; remarcado, vale de novo | `confirm-links.test.ts` (SEC-E7c2-04) |
| Endereço escondido por um caractere invisível no meio (um espaço de largura zero em `golpe.com`) (SEC-E7c2-03) | Os caracteres de formato invisíveis (`\p{Cf}`, menos o que junta emojis) são recusados no modelo do e-mail e na mensagem do WhatsApp | `confirm-mail.test.ts` (SEC-E7c2-03) |

### Suposições

- O e-mail vem só do agendamento (campo da E5e). A cópia de Contatos guarda só o telefone, então "o e-mail do contato" do protótipo fica para quando ela guardar e-mail.
- O cartão não repete "Enviar teste para você": o teste fica no cartão de cima, como já estava. A frase "Está ligado em … Como a confirmação sai" entra com o envio automático (E7c3).
- A prévia usa o mesmo exemplo inventado da E7c1 (Érica).
- "Copiar o texto do WhatsApp" traz a mensagem salva sem a linha do link e sem os asteriscos. Com a mensagem padrão, traz o texto padrão do e-mail, que já é a versão dela para e-mail (assim a tela não carrega o catálogo de Consultório).
- Uma consulta recebe o e-mail uma vez por horário; o servidor recusa o segundo (409) e a tela já esconde o botão.

## 18. Diferenças da E7c3 (confirmação automática na véspera útil)

A E7c3 também ficou grande para uma PR. Ela vira duas, nesta ordem:

| PR | O que entra |
| --- | --- |
| **E7c3a** | A automação "Confirmação de consulta" do CRM ganha código: na véspera útil, no horário escolhido, ela põe na fila de Envios (S19) a mensagem modelo com o link, pela caixa do WhatsApp no Chatwoot. Começa em ensaio de 3 dias úteis, como toda automação que escreve a pacientes. "Como a confirmação sai" em Configurações › Consultório, e a situação do envio automático nos detalhes da consulta |
| **E7c3b** | "Também por e-mail, na mesma hora": o e-mail da E7c2 sai junto, pela mesma automação |

A aprovação vem da decisão de 12/11/2026, 21:37 UTC (a confirmação sai sozinha pelo Chatwoot no último dia útil antes da consulta), que respondeu na prática a P1 de `modulos-crm.md`. Desligada por padrão: nada vai a paciente até o Pablo ligar e o ensaio passar.

### Critérios de aceite (E7c3a)

- **CA-A1.** O catálogo do CRM traz "Confirmação de consulta" (`appointment-confirmation`) com código: credencial do Chatwoot, opção "Horário do envio" (07:00 a 20:00, padrão 07:00), só em dias úteis (sem fim de semana nem feriado nacional), teto de 30 mensagens por dia (P1) e nenhuma chamada de IA.
- **CA-A2.** Recebe a mensagem quem tem, entre amanhã e o fim do próximo dia útil (a consulta de segunda recebe na sexta), um agendamento com tipo, situação Agendado (cor da agenda ou Pavão) ou Reagendado, celular brasileiro válido, numa agenda que a Zuri escreve, com o link ainda valendo e sem resposta pelo link para aquele horário. Quem já recebeu para aquele horário, por qualquer canal, fica de fora.
- **CA-A3.** A mensagem é a mesma do botão do WhatsApp (modelo da E7c1), com o link daquele agendamento. A chave da fila é a agenda, o evento e o horário: a mesma consulta nunca entra duas vezes, e remarcada recebe de novo. A mensagem não sai depois de 1 hora antes da consulta (o link expira): vira "Não saiu" em Envios.
- **CA-A4.** Em ensaio nada sai: a Zuri anota quem receberia, e o CRM mostra as anotações para o Pablo conferir, como nas outras automações. Ao vivo, entra na fila, uma de cada vez, com a espera da credencial.
- **CA-A5.** Nos detalhes da consulta: ligada ao vivo e ainda sem envio, a dica "Sai sozinho pelo Chatwoot em {dia}, às {hora}. Se você enviar antes pelo WhatsApp, o automático não repete."; na fila, "Na fila do Chatwoot"; enviada, "Enviado pelo Chatwoot {quando}. Ainda sem resposta."; se não saiu ou falhou, "Não foi enviado pelo Chatwoot", e os botões de enviar continuam.
- **CA-A6.** Configurações › Consultório ganha "Como a confirmação sai": pelo WhatsApp, por você (sempre disponível), e automático pelo Chatwoot, com a situação (desligado, em ensaio, ligado ou pausado), o horário e "Mudar", que leva a CRM › Automações. Um ajuste, um lugar (regra de 13/11).
- **CA-A7.** Custo: roda a cada 30 minutos só em dia útil e trabalha do horário escolhido até as 21:00, para refazer uma rodada que falhou e pegar quem marcou durante o dia (no máximo 28 leituras da agenda por dia; a chave da fila não deixa repetir); não cria mais links do que o teto do dia.
- **CA-A8.** Celular, tema escuro, teclado, leitor de tela, 44 px e inglês.

### Suposições

- O interruptor, o horário e a credencial ficam em CRM › Automações, onde as automações já ligam, ensaiam e pausam; o Consultório mostra o resumo e leva até lá (regra "um ajuste, um lugar"). O protótipo tinha os controles no Consultório; o Pablo escolheu CRM › Automações em 16/11, às 11:52 UTC.
- Paciente que confirma pelo link, ou envio do Pablo pelo WhatsApp, entre a entrada na fila e a vez dela (minutos) não tira a mensagem da fila nesta PR. O mesmo vale para a consulta cancelada ou remarcada no Google nesse intervalo, que pode durar mais se a fila estiver pausada ou no bloqueio (auditoria SEC-E7c3a-04, baixo, aceito nesta PR); a mensagem vence de qualquer jeito 1 hora antes da consulta.
- Quem pode editar uma agenda compartilhada que a Zuri escreve consegue gravar o celular do paciente num evento pela API do Google (auditoria SEC-E7c3a-05, informativo). As agendas em que a Zuri escreve são escolha do Pablo em Integrações › Google; fica registrado como risco conhecido.
- A automação lê no máximo 250 eventos por agenda e 1.000 no total na véspera; acima disso o resto fica para os botões (o consultório tem bem menos).
- Achados da auditoria corrigidos: SEC-E7c3a-01 (médio; mudar o texto da confirmação com a automação ligada pede senha e alerta, escolha do Pablo em 16/11, às 11:52 UTC), SEC-E7c3a-02 (uma mensagem recusada não para as outras), SEC-E7c3a-03 (só o primeiro nome vai ao Chatwoot) e SEC-E7c3a-06 (links só até o teto do dia).

