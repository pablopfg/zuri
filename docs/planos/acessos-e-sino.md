# Plano · Segurança e avisos: país nos acessos e sino com o que não foi visto (E12)

Situação: aprovado (protótipo v38 e v51, aprovados pelo Pablo em 13/11/2026, 01:44 UTC). Sem perguntas: tudo está no protótipo e no plano [sons-menu-e-agenda-editavel.md](sons-menu-e-agenda-editavel.md) (ajustes de 13/11, 01:32 UTC, item 3, e "Número de avisos não vistos no sino").

A E12 se divide em duas PRs, uma por tela:

- **E12a:** país nos acessos e "Todos os acessos" por dia, com filtros. Migration 49: índice parcial dos acessos de fora do Brasil.
- **E12b:** sino com o número de avisos não vistos. Migration `seen_at` (a próxima livre, 50).

## 1. Resumo

Na Atividade de acesso (Configurações › Segurança) e na tela Acessos, cada linha passa a dizer a cidade aproximada, o **país** com nome e sigla e, quando o acesso veio de fora do Brasil, "fora do Brasil" em destaque. A tela Acessos agrupa por dia (Hoje, Ontem, depois a data) e ganha o filtro "Mostrar: Todos, Atenção, Fora do Brasil", como o diálogo "Todos os acessos" do protótipo. Na E12b, o sino conta os avisos que o Pablo ainda não viu.

## 2. Contexto no sistema

- O registro de acessos já guarda o país: `zur_auth_events.country`, gravado por `apps/agent/src/auth/client.ts` a partir de `request.cf.country` (duas letras). Não precisa de coluna nova, como o item 3 de 13/11 pedia para conferir.
- `GET /api/auth/activity` (`apps/agent/src/api/app.ts`) lê `authActivityQuerySchema` (`packages/shared/src/auth-activity.ts`) e chama `AuthEvents.page` (`apps/agent/src/auth/events.ts`), que filtra por período, grupo, começo do IP e cursor, pelo índice de `at`.
- Interface: `apps/web/src/components/security/ActivityCard.tsx` (cartão em Configurações › Segurança), `apps/web/src/pages/security/AccessLogPage.tsx` (rota `/acessos`, carregada sob demanda) e `apps/web/src/components/security/activity.ts` (`placeText`, `isWarning`).
- Protótipo: `accRow` e `acessosDlg` em `docs/planos/modelos-frontend/prototipo-interativo.html`.
- Avisos (E12b): `zur_notices`, `apps/web/src/components/NoticesPanel.tsx`, canal `/api/live`.

## 3. Objetivo e critérios de aceite

### E12a

- **CA-A1.** Cada acesso, no cartão e na tela Acessos, mostra a cidade e o estado (ou "Cidade desconhecida"), o nome do país no idioma da interface e a sigla em etiqueta. Sem país registrado (desenvolvimento local), mostra "Lugar desconhecido".
- **CA-A2.** Acesso de fora do Brasil ganha "fora do Brasil" em destaque, com cor e texto (não só cor). "XX" vira "País desconhecido" e "T1" vira "Rede Tor", ambos tratados como fora do Brasil.
- **CA-A3.** A tela Acessos agrupa as linhas por dia no fuso do dono, com título por dia: Hoje, Ontem ou a data ("sex., 13/11"). "Carregar mais" continua o mesmo dia quando a página corta no meio dele.
- **CA-A4.** O filtro "Mostrar" tem Todos, Atenção e Fora do Brasil, guardado no endereço (`?mostrar=atencao|fora`). Atenção são as recusas e os bloqueios (os mesmos que o cartão marca com o triângulo). Fora do Brasil são os acessos com país diferente de BR. Junta com Período, Tipo e IP.
- **CA-A5.** O servidor aplica o filtro (`show=attention|abroad`), recusa outro valor com 400 e lê perto do tamanho da página.
- **CA-A6.** A nota do protótipo aparece no pé da lista: de onde vem o país, que a cidade é aproximada e que tudo sai depois de 90 dias.
- **CA-A7.** Celular, tema escuro, teclado, leitor de tela (cada dia é uma seção com nome), 44 px, inglês.

### E12b

- **CA-B1.** O sino mostra o número de avisos não vistos (até "99+"); o leitor de tela lê "Avisos: 3 não vistos"; o título da aba ganha "(3)".
- **CA-B2.** Um aviso conta como visto quando aparece no painel aberto por 0,6 s com mais da metade na tela. Abrir e fechar na hora não conta. "Marcar como lidos" também marca como vistos.
- **CA-B3.** `POST /api/notices/seen` recebe até 50 ids (Zod), grava `seen_at` só onde ainda está vazio e devolve o número novo. Ver num aparelho zera o sino nos outros pelo canal ao vivo.
- **CA-B4.** Migration nova de acréscimo com `seen_at`, avisos antigos contam como vistos (não acendem o sino depois do deploy).
- **CA-B5.** `navigator.setAppBadge` com o mesmo número, onde o navegador deixar.

## 4. Escopo

Entra: o descrito acima. Fica fora:

- Contagem por filtro ("Todos 6, Atenção 2") que o protótipo mostra nos botões: pede `count(*)` sobre o registro de 90 dias a cada abertura, o que a regra P2 proíbe. Os botões ficam sem número (diferença registrada abaixo).
- A tela Acessos continua uma página (`/acessos`), não um diálogo: já tem Período, Tipo e IP, que o diálogo do protótipo não tem, e o endereço guarda os filtros. "Ver todos os acessos" do cartão continua levando a ela.

## 5. Como funciona para o Pablo

1. Configurações › Segurança › Atividade de acesso: cada linha diz, por exemplo, "Curitiba, PR · **Brasil** BR" ou "Cidade desconhecida · **Portugal** PT · fora do Brasil".
2. "Ver todos os acessos" abre Acessos. Os filtros ficam em cima; logo abaixo, "Mostrar: Todos | Atenção | Fora do Brasil".
3. A lista vem em blocos por dia. No computador, cada dia é uma tabela; no celular, cartões.
4. Sem resultado no filtro: "Nenhum acesso com esses filtros", com "Limpar filtros".

### Textos visíveis (E12a)

| Chave | pt-BR | en |
| --- | --- | --- |
| `web.activity.cityUnknown` | Cidade desconhecida | Unknown city |
| `web.activity.placeUnknown` | Lugar desconhecido | Unknown place |
| `web.activity.countryUnknown` | País desconhecido | Unknown country |
| `web.activity.tor` | Rede Tor | Tor network |
| `web.activity.abroad` | fora do Brasil | outside Brazil |
| `web.accessLog.show` | Mostrar | Show |
| `web.accessLog.show.all` | Todos | All |
| `web.accessLog.show.attention` | Atenção | Needs attention |
| `web.accessLog.show.abroad` | Fora do Brasil | Outside Brazil |
| `web.accessLog.today` | Hoje | Today |
| `web.accessLog.yesterday` | Ontem | Yesterday |
| `web.accessLog.note` | O país vem da rede de quem acessou e a cidade é aproximada. O IPv6 aparece quando a conexão chega por ele. O detalhe de cada acesso sai do registro depois de 90 dias. | The country comes from the visitor's network and the city is approximate. IPv6 shows when the connection uses it. Each access's detail leaves the log after 90 days. |

A nota diz "o detalhe" e não "tudo": o resumo por dia, tipo e país fica um ano (`AUTH_EVENT_SUMMARY_DAYS`).

## 6. Regras de negócio e limites

- Brasil é o país de casa (o consultório do Pablo). "Fora do Brasil" é `country` diferente de `BR` e não vazio.
- Atenção: `AUTH_ATTENTION_KINDS` em `packages/shared`, os grupos failure, blocked e robot mais `credentials_reset`. O cartão e o servidor usam a mesma lista.
- `show` aceita só `attention` e `abroad`; outro valor é 400 `VALIDATION_FAILED` com o campo `show`.
- A página continua com 50 linhas (`AUTH_ACTIVITY_LIMIT`) e o cursor de antes.

## 7. Desenho técnico

### Arquivos

- `packages/shared/src/auth-activity.ts`: `AUTH_ATTENTION_KINDS`, `HOME_COUNTRY = "BR"`, `show` no schema.
- `apps/agent/src/auth/events.ts`: `page` cruza os tipos com Atenção e filtra o país.
- `apps/web/src/components/security/activity.ts`: `isWarning` lê a lista do shared; `placeParts` devolve cidade, país, sigla e se é fora.
- `apps/web/src/components/security/Place.tsx` (novo): a linha do lugar, usada pelo cartão e pela tela.
- `apps/web/src/pages/security/AccessLogPage.tsx`: "Mostrar", grupos por dia, nota.
- Textos em `packages/shared/i18n/pt-BR-security.ts` e `en.ts`.

### Rotas e contratos

`GET /api/auth/activity?show=attention|abroad` (opcional). Resposta igual.

E12b: `POST /api/notices/seen` com `{ ids }` (1 a 50 uuids diferentes, `noticeSeenSchema`) devolve `{ unseen }`. A sessão e o heartbeat trazem `unseenNotices` no lugar de `unreadNotices`; `GET /api/notices` traz `unseen` e cada aviso, `seen`.

### Banco

Migration 49 (`auth_events_abroad`): `CREATE INDEX zur_auth_events_abroad ON zur_auth_events (at) WHERE country <> '' AND country <> 'BR'`. A consulta repete esse `WHERE` com os mesmos literais, para o SQLite usar o índice parcial. Sem ele, um dono que só entra do Brasil faria o filtro andar o registro inteiro (até 50.000 linhas) para dizer que não há nada (SEC-E12a-01). Só as linhas de fora pagam a escrita do índice (regra P4).

Migration 50 (`notices_seen`, E12b): coluna `seen_at` em `zur_notices`, preenchida com `coalesce(read_at, created_at)` nos avisos que já existem (CA-B4), e o contador `notices_unseen` em `zur_counts`, mantido por três gatilhos (aviso novo, visto, apagado). Assim o sino lê uma linha, nunca um `count(*)` (regra P2).

### Ferramentas do agente

Nenhuma muda.

### Agendamentos, IA e integrações externas

Nenhum.

## 8. Custo e cotas do plano Free

| Rota | Antes | Depois |
| --- | --- | --- |
| `GET /api/auth/activity` | até 51 linhas sem filtro | igual; Atenção e 1 em 10 de fora: até 160 e 600 linhas; nenhum de fora em 3.000: 2 linhas (medido), teto 10 |

JS inicial: nada no primeiro carregamento (a tela e o cartão já são sob demanda).

| Rota (E12b) | Antes | Depois |
| --- | --- | --- |
| `POST /api/notices/seen` | não existia | 50 ids com 500 avisos guardados: 252 linhas lidas e 100 escritas (medido); o mesmo lote de novo: 103 lidas, 0 escritas |
| Sessão e heartbeat | uma linha do contador `notices_unread` | uma linha do contador `notices_unseen` |
| Aviso novo | linha, índices e 2 contadores | mais 1 contador (o gatilho do não visto) |

JS inicial (E12b): 141.288 B de 141.300. O título da aba e o ícone do app ficam em `lib/sounds.ts`, que carrega depois da primeira tela.

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Valor estranho em `show` entra no SQL | enum Zod; o SQL só recebe `?` | `auth-activity` 400 |
| País gravado com texto estranho vira texto na tela | `text(cf.country, 2)` já corta; a tela só usa `Intl.DisplayNames` com duas letras maiúsculas | unitário de `placeParts` |
| Filtro que lê o registro todo (SEC-E12a-01) | índice parcial dos acessos de fora (migration 49) | `free-tier-budget` › SEC-E12a-01; `migrations` 48 → 49 com o plano da consulta |
| Corpo grande ou repetido em `/notices/seen` (E12b) | Zod com 1 a 50 uuids diferentes, corpo até 4 KB, SQL só com `?` | `notices-routes` (validação) |
| "Visto" parando a insistência de um alerta (E12b) | visto só muda o número do sino; lido, a insistência e as entregas seguem como antes | `notices-routes` (lido continua `null`) |

## 10. Testes

- shared: schema aceita `attention` e `abroad`, recusa outro; `AUTH_ATTENTION_KINDS` sem tipo repetido e todos do catálogo.
- agent: `page` com `show=attention` e `abroad`, junto com grupo e cursor; 400; orçamento.
- web: `placeParts` (BR, PT, XX, T1, vazio, sem cidade); grupos por dia no fuso.
- e2e `acessos.spec.ts`: país e "fora do Brasil" no cartão e na tela, "Mostrar" pelo endereço, título do dia, axe, 44 px, celular.

## 11. Entrega

E12a e E12b em PRs separadas para a `develop`, cada uma com changelog, README, capturas e as revisões de QA e segurança.

### Diferenças da E12a

- Os botões de "Mostrar" não têm o número de cada filtro (regra P2).
- "Todos os acessos" continua uma página, com os filtros de Período, Tipo e IP que já existiam.
- A situação "Certo/Atenção" do protótipo já existe como a etiqueta colorida do tipo, com o triângulo nas recusas.

### Diferenças da E12b

- Em outro aparelho aberto, o sino muda no próximo heartbeat (até 1 minuto), não pelo canal ao vivo: o canal só leva o número das áreas, e pôr os avisos nele custaria uma escrita a mais por aviso visto.
- "Feito" e "Adiar" pelo Telegram, e-mail ou notificação do aparelho não marcam como visto, porque o aviso não apareceu no app.
- O tempo de 0,6 s só corre com a aba à mostra (`document.hidden`), achado da auditoria: um painel esquecido aberto numa aba escondida não tira alertas novos do sino. Com a aba à mostra e a tela apagada, o navegador não tem como saber.
- O nome do sino para o leitor de tela é "Avisos não vistos: 3" (sem o número: "Abrir avisos"), que cabe numa chave só e lê igual com "99+".

## 12. Riscos

- O filtro de IP continua andando pelo índice de `at` até achar a página (já era assim antes da E12a).
- Uma sigla que a borda não manda hoje (fora de duas letras maiúsculas ou dígitos) aparece como "País desconhecido" e conta como fora do Brasil, igual ao servidor.

### Revisão de QA e auditoria (16/11/2026)

- SEC-E12a-01 (baixo): "Fora do Brasil" lia o registro todo quando nada veio de fora. Corrigido com o índice parcial, com teste de orçamento.
- QA: os dias agora têm teste unitário (`dayKey`, `dayBefore`, `byDay`, com os dias de 23 e 25 h) e o e2e roda num aparelho em Tóquio, com um acesso às 23:30 do dono que fica em "Ontem". O 400 de `show` confere o nome do campo. O título do dia usa `scope="rowgroup"`. A tela e o servidor contam igual o que é de fora.

## 13. Suposições

- "Fora do Brasil" usa a sigla BR fixa: o Zuri é de um dono só, no Brasil.
- XX e T1 contam como fora do Brasil, porque não há como dizer que vieram daqui.

## 14. Entrevista com o Pablo

Sem perguntas: tudo coberto pelo protótipo aprovado em 13/11/2026.

### Perguntas abertas

Nenhuma.
