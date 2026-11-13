# Plano · S20 Pedido de avaliação com um toque e link pessoal

- **Tipo:** etapa S20 do [plano do frontend Sinal](implementacao-frontend-sinal.md) (linha P23)
- **Pedido por:** Pablo (opção A de 09/11, link pessoal de 10/11, protótipo aprovado em 12/11/2026)
- **Situação:** em implementação

## 1. Resumo

A Zuri monta, todo dia, a lista de quem deve receber o pedido de avaliação: quem teve consulta há 8 dias (passando para o próximo dia útil), nunca avaliou e não tem avaliação esperando a sua escolha. Em **Avaliações › Pedidos**, "Enviar link de avaliação" abre o WhatsApp com a mensagem e um link só daquela pessoa (`zuri.exemplo.com.br/a/k7Q2mX9p`); você confere e envia. Quem toca no link é levado à página de avaliação do perfil no Google, e a Zuri anota a abertura. As avaliações passam a ser ligadas aos contatos pelo nome, com a regra dos homônimos: nome igual a dois contatos nunca liga sozinho.

É o caminho que o protótipo aprovado mostra como padrão ("Quem envia: Eu, com um toque no WhatsApp"). O envio pela própria Zuri, pelo Chatwoot e pela fila da S19, fica para a **S20b** (seção 11).

## 2. Contexto no sistema

| Área | Onde | O que faz hoje |
| --- | --- | --- |
| Avaliações | `apps/agent/src/reviews/service.ts`, tabelas `zur_reviews`, `zur_review_locations` | Lê as avaliações; guarda só o primeiro nome de quem avaliou |
| Perfis | `listLocations()` com `readMask: "name,title"` | Nome do perfil vem do Google |
| Contatos | `apps/agent/src/google/contacts.ts` (`search_name`, `sameName`, `identity`) | Cópia só de leitura, busca exata pelo nome no índice |
| Consultas | `apps/agent/src/google/appointments.ts` (`readAppointment`, `titleNames`, `carries`) | Título do evento = nome completo; separa homônimos pelo telefone, e-mail, CPF e nascimento |
| Feriados | `packages/shared/src/holidays.ts` | Feriados nacionais pelo código |
| Rotas públicas | `apps/agent/src/index.ts` | Portões antes do objeto (Telegram, Google, Chatwoot do dono) |
| Tela | `apps/web/src/pages/reviews/` | Visão geral, Avaliações, Ajustes (Conexão, Como responder); funil escondido enquanto `requests` é `null` |

De onde vem cada dado da tela (regra "um ajuste, um lugar"): link, mensagem e "Quando pedir" só em Avaliações › Ajustes › Pedidos e link; feriados nacionais do código; consultas da agenda do Google (leitura); contatos da cópia do Google.

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | A Zuri busca o link de avaliação do perfil (`metadata.newReviewUri`) e mostra de onde veio e quando | link-de-avaliacao CA1 |
| CA2 | O link colado à mão vence o do Google; só entra https do Google (`g.page`, `search.google.com`, `www.google.com`, `maps.app.goo.gl`), sem usuário, sem porta, até 300 caracteres; salvar pede a senha recente | CA2 |
| CA3 | Sem link válido, nenhum pedido pode ser enviado e a tela diz o que falta | CA3 |
| CA4 | `/a/<código>` leva só ao link guardado; o destino nunca vem do endereço pedido | CA4 |
| CA5 | A primeira abertura é anotada, uma vez por pedido; prévia de WhatsApp, Telegram, Facebook e afins e `HEAD` não contam | CA5 |
| CA6 | Código errado: 404 sem dizer nada; vencido (30 dias): leva ao Google sem anotar; mais de 30 por minuto da mesma rede: 429 | CA6 |
| CA7 | Funciona com o modo de bloqueio e sem Cloudflare Access para quem toca | link-de-avaliacao §7 |
| CA8 | Avaliação com nome inteiro igual a um único contato, sem outro de primeiro e último nome iguais: liga sozinha; dá para desfazer | 8.1b |
| CA9 | Nome igual a dois ou mais contatos: **nunca liga sozinho**; mostra os candidatos, marca o mais provável e espera "É esta" ou "Nenhuma das duas" | 8.1b, critério da S20 |
| CA10 | Só primeiro e último nome, ou nenhum nome com um único link aberto nas 48 h antes: sugestão "É ele" / "Não é" | 8.1b |
| CA11 | Quem tem avaliação ligada ou para confirmar não recebe pedido | 8.1, 8.3 |
| CA12 | O nome inteiro de quem avaliou não é guardado: só duas impressões HMAC (nome inteiro; primeiro e último) | 8.1 |
| CA13 | A lista sai da agenda: consulta que já aconteceu, título com o nome de um contato só (homônimo só com prova no evento), pedido no 8º dia (3 a 30) ou no próximo dia útil | 8.2 |
| CA14 | Um pedido por pessoa na vida; um lembrete só, 7 dias depois, em dia útil, se não avaliou (desligável) | 8.2 |
| CA15 | "Enviar link de avaliação" confere tudo de novo no servidor; dois toques (duas abas) não criam dois envios; reabrir nos 10 minutos seguintes devolve o mesmo link | 8.3 |
| CA16 | A mensagem é do dono, até 500 caracteres, precisa de `{link}`; `{primeiro_nome}` só letras, até 20 | link-de-avaliacao §6 |
| CA17 | Às 09:00 (ajustável) de dia útil, um aviso diz quantos pedidos estão prontos | 8.2 |
| CA18 | A Visão geral mostra o funil (receberam, abriram, avaliaram) quando já houve pedido | S11 |
| CA19 | Telas com vazio, carregando, erro, teclado, leitor de tela, celular, escuro e axe | padrão |

## 4. Escopo

**Entra:** migration 41, link do perfil (Google e manual), rota `/a/:código`, impressões do nome e vínculo avaliação ↔ contato (com a leitura das avaliações antigas para calcular as impressões), lista dos pedidos pela agenda, envio com um toque pelo WhatsApp, lembrete, aviso das 09:00, funil nas métricas, Avaliações › Pedidos, Ajustes › Pedidos e link, a ligação na avaliação aberta, docs e testes.

**Fica para a S20b:** "Quem envia: a automação Pedido de avaliação" (pelo Chatwoot e pela fila da S19), o webhook assinado do Chatwoot ("entregue", "não quer receber", SAIR), a aprovação pelo Telegram e o cartão "Avaliação no Google" na ficha do contato.

## 5. Como funciona para o Pablo

1. Ajustes › **Pedidos e link**: o link já vem do perfil ("Puxado do perfil … em …"); "Buscar no perfil" lê de novo; "Abrir para conferir" abre a página. A mensagem e "Quando pedir" ficam logo abaixo.
2. Às 09:00 de dia útil: "3 pedidos de avaliação prontos para hoje".
3. Avaliações › **Pedidos**: grupos "Para enviar hoje", "Agendados", "Sem resposta", "Já avaliaram" e "Não recebem". Na pessoa, "Enviar link de avaliação" abre o WhatsApp com tudo pronto.
4. Avaliação aberta: "Ligada ao contato …", o cartão dos homônimos ou a sugestão.

Textos novos em `packages/shared/i18n/pt-BR-reviews.ts` e `en`, sem citar infraestrutura, com o humanizer.

## 6. Regras de negócio e limites (`REVIEW_REQUEST_LIMITS`)

| Regra | Valor |
| --- | --- |
| Dias depois da consulta | 8 (3 a 30); sábado, domingo e feriado nacional passam para o próximo dia útil |
| Hora do aviso | 09:00 (06:00 a 21:00) |
| Lembrete | 7 dias depois do envio, no próximo dia útil, se não avaliou; um só |
| Janela lida na agenda | Consultas dos últimos `dias + 21` dias |
| Pedido não enviado | Some 30 dias depois do dia previsto |
| Código | 10 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789` (cerca de 57 bits), `crypto.getRandomValues`, sorteia de novo na colisão |
| Validade do código | 30 dias; códigos vencidos há mais de 60 dias são apagados |
| Abertura | Só a primeira; prévia e `HEAD` não contam |
| Limite da rota `/a/` | 30 por minuto por rede (IP como HMAC, apagado em 2 minutos) |
| Mensagem | Até 500 caracteres, com `{link}` |
| Reabrir o WhatsApp | O mesmo link por 10 minutos depois do toque |

## 7. Desenho técnico

### Rotas

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /a/:code` | qualquer pessoa | No Worker: formato conferido, sem Access, só o código, o tipo do pedido (prévia ou não) e a rede seguem ao objeto. 302 para o link guardado; 200 vazio para prévia e `HEAD`; 404; 429 |
| `GET /api/reviews/requests` | dono | Lista dos pedidos, contagens e o resumo das ligações |
| `GET /api/reviews/requests/settings` | dono | Link (Google, manual, de onde veio, quando), endereço curto, mensagem, "Quando pedir" |
| `PUT /api/reviews/requests/link` | dono, senha recente | Grava ou limpa o link manual |
| `POST /api/reviews/requests/link/refresh` | dono | Lê de novo os perfis no Google (uma vez por minuto) |
| `PATCH /api/reviews/requests/settings` | dono | Mensagem e "Quando pedir" |
| `POST /api/reviews/requests/:id/send` | dono | Confere e devolve o telefone e o texto com o link pessoal |
| `POST /api/reviews/:id/match` | dono | "É esta", "É ele", "Nenhuma", "Não é" ou desfazer |

### Arquivos

`packages/shared/src/reviews.ts` e `reviews-schemas.ts` (contratos, limites, validação do link), i18n; `apps/agent/src/reviews/link.ts` (validação, código, prévia), `names.ts` (normalização e impressões), `matches.ts` (vínculo), `requests.ts` (lista, envio, lembrete, aviso), `service.ts` (perfis com `metadata`, impressões ao guardar, leitura das antigas), `metrics.ts` (funil), `api/reviews.ts`, `index.ts` (portão de `/a/`), `agent/zuri-agent.ts` (alarme, aviso), `db/migrations.ts`; `apps/web/src/pages/reviews/RequestsPart.tsx`, `RequestSettings.tsx`, `ReviewList.tsx`, `Overview.tsx`, `ReviewSettings.tsx`, `ReviewsPage.tsx`, `numbers.ts`.

### Banco (migration 41 `review_requests`, só acréscimo)

- `zur_review_locations`: `review_uri`, `review_uri_manual`, `review_uri_at`, `names_token`, `names_done`.
- `zur_reviews`: `name_fp`, `short_fp` (HMAC-SHA256 com `PASSWORD_PEPPER`, prefixo `zuri:review-name:v1:`), com índices.
- `zur_review_matches` (avaliação → contato, tipo `auto`, `confirmed`, `twins`, `guess`, `none`, candidatos) e `zur_review_match_candidates` (contato → avaliação esperando, para a fila em uma leitura de índice).
- `zur_review_requests` (um por contato: consulta, dia previsto, envio, tentativas, lembrete, abertura), `zur_review_links` (código → pedido, validade, abertura), `zur_review_link_hits` (contador por minuto).
- `zur_review_settings`: mensagem, dias, hora, lembrete, dia da última montagem e do último aviso.
- Fora do backup: `zur_review_links`, `zur_review_link_hits`, as impressões. Os pedidos e as ligações entram (são decisões do dono); conferir em `backup.ts`.

### Agendamentos, IA e integrações

Sem IA e sem ferramenta nova. A montagem da lista roda no alarme único uma vez por dia, na hora do aviso, depois das avaliações; lê a agenda com até 12 chamadas ao Google. A leitura das avaliações antigas para as impressões pega carona na conferência das avaliações: uma página por conferência, até acabar. A rota `/a/` custa uma requisição ao objeto por toque.

## 8. Custo e cotas do plano Free

Nenhum recurso novo. Requisições: uma por toque no link. Google: uma montagem por dia (até 12 chamadas) e uma página a mais por conferência só até as impressões antigas acabarem. Linhas: por pedido, cerca de 5 (criar, enviar, código, abertura, lembrete); por toque no link, 2 (contador e abertura). Medido em `free-tier-budget.test.ts`. JS inicial: nenhuma linha nova fora da tela de Avaliações (sob demanda).

## 9. Segurança e privacidade

| Risco | Proteção | Teste |
| --- | --- | --- |
| Redirecionamento aberto | Destino só do banco, que só aceita hosts do Google com https | `?next=`, host parecido, `http`, usuário e senha, porta, espaços |
| Adivinhar códigos | 57 bits, 30 por minuto por rede, 404 igual | 31 pedidos seguidos |
| Vazar quem é a pessoa | Código sorteado, resposta sem corpo além do 302 | Resposta sem nome |
| Prévia contar | Lista de agentes de prévia e `HEAD` | Um por agente |
| Pedir a quem já avaliou | Homônimo nunca liga sozinho, "na dúvida, ninguém recebe", conferência de novo no toque | Dois "Ana Souza", avaliação nova entre a lista e o toque |
| Nome de quem avaliou no banco | Só impressões HMAC com a chave fora do banco e do backup | Banco sem o nome inteiro |
| Texto do link ou da mensagem virar HTML | Zod, `URL`, texto puro, `wa.me` montado com `encodeURIComponent` | Campo com script e quebras |
| Toque duplicado | Atualização condicional da tentativa | Dois envios em paralelo |

Auditoria **completa** (S20 está na lista da seção 9 do plano do Sinal).

## 10. Testes

Unidade: link (hosts e bordas), código, prévia, normalização e impressões, dia útil e lembrete, mensagem. Integração no workerd: perfis com e sem `metadata`, link manual vencendo o do Google, `/a/` certo, vencido, errado, prévia, `HEAD`, limite, bloqueio; vínculo com nome único, homônimos, primeiro e último, anônimo com link aberto, desfazer; montagem pela agenda com homônimos e prova no evento; envio, toque duplicado, reabrir; aviso; métricas; orçamento. E2e com axe: Pedidos, envio (abre o WhatsApp), Ajustes › Pedidos e link, avaliação com homônimos, celular e escuro.

## 11. Entrega

Esta PR (S20) e, depois, a **S20b**: automação "Pedido de avaliação" pela fila do Chatwoot, webhook assinado ("entregue", "não quer receber"), aprovação pelo Telegram e o cartão na ficha do contato.

## 12. Riscos

- O Google não entregar `newReviewUri`: campo manual e aviso (CA2, CA3).
- O WhatsApp abrir no navegador sem o aplicativo: o `wa.me` cuida disso; o pedido conta como enviado no toque, e o dono vê "Enviado" na hora.
- JS inicial no teto: tudo novo fica na tela de Avaliações; `App.tsx` não muda.

## 13. Suposições

- `metadata.newReviewUri` vem na listagem dos perfis com `readMask` `name,title,metadata`.
- Com mais de um perfil escolhido, vale o link do primeiro (o pedido não sabe em qual unidade foi a consulta).

## 14. Entrevista com o Pablo

As três perguntas de [link-de-avaliacao.md](link-de-avaliacao.md) seguem o protótipo aprovado e a recomendação até o Pablo dizer outra coisa:

| Pergunta | Seguida |
| --- | --- |
| Campo do link travado ou editável? | Editável; o do Google é o padrão e apagar o manual volta a ele |
| Endereço curto fora do ar: mandar o link do Google direto? | Não; a mensagem sempre leva o endereço curto |
| Botão "Copiar" ao lado do link? | Não, o protótipo não tem; "Abrir para conferir" basta |
