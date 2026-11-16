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
| E7b. Remarcar pelo link | em andamento |
| E7c. Envio da confirmação | a fazer |

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
