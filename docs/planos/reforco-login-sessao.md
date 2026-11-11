# Plano · Reforço de login e sessão, e fim do acesso por token

Situação: aprovado em 11/11/2026
Origem: pedido do Pablo em 11/11/2026 (máximo de segurança, sem API, proteção contra roubo de sessão e tentativas de login)
Dependências: nenhuma. Parte da `develop` na versão 0.49.0.

## 1. Resumo

A Zuri já tinha limite de tentativas por rede, verificação contra robôs, segunda etapa e sessão curta. Faltavam três coisas. A sessão não conferia de onde era usada, então um cookie copiado valia em qualquer lugar até expirar. O login não tinha teto diário, e uma rede paciente fazia até 288 chutes de senha por dia. E existia uma porta de entrada por token que o Pablo não vai usar. Este plano prende a sessão ao navegador, ao país e à rede, cria o teto de 5 senhas erradas por rede em 24 horas e tira do código o acesso remoto por token.

## 2. Contexto no sistema

- Login e limites: `apps/agent/src/auth/service.ts` e `apps/agent/src/auth/login-limiter.ts` (tabela `zur_login_attempts`, migration 1). 3 erros por rede em 15 minutos; travas de ataque distribuído em 25 e 100 recusas.
- Sessões: `apps/agent/src/auth/sessions.ts` (tabela `zur_sessions`). A sessão guardava `network` e `user_agent`, mas nenhum pedido seguinte os comparava.
- Cookie de aparelho `__Host-zuri_device`: já existia, só para distinguir navegador conhecido de novo.
- Acesso remoto (etapa 20, PR #184): `apps/agent/src/remote/`, `apps/agent/src/api/remote.ts`, `packages/shared/src/remote.ts`, `apps/web/src/components/security/RemoteAccessCard.tsx`, comando `/tokens` em `apps/agent/src/telegram/security.ts`. Desligado por padrão.
- Decisões que valem: login certo não zera a contagem dos 15 minutos (31/10/2026); Turnstile em todo login (31/10/2026); senha digitada de novo para ligar 2FA ou passkey (31/10/2026).
- Documento da área: `docs/seguranca.md` (seções Sessões, Senha recente, Força bruta).

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | A 5ª senha errada de uma rede em 24 h ainda é conferida; a 6ª tentativa recebe 429 com `Retry-After` até a mais antiga das cinco completar um dia, mesmo com a senha certa | Pablo |
| CA2 | Rede com login certo nos últimos 30 dias não entra no teto diário e mantém a regra dos 15 minutos | plano |
| CA3 | O teto é conferido antes de qualquer PBKDF2 e conta tentativas simultâneas antes da checagem lenta | plano |
| CA4 | Pedido com o cookie da sessão sem o cookie de aparelho do navegador que entrou, ou com outro, recebe 401, encerra a sessão e gera alerta | Pablo |
| CA5 | Pedido de outro país encerra a sessão e gera alerta; sem país de um dos lados, não compara | Pablo |
| CA6 | Pedido de outra rede mantém a sessão, registra a mudança uma vez por rede e alerta quando a rede não é do dono | Pablo |
| CA7 | A janela de senha recente só vale na rede em que a senha foi digitada | Pablo |
| CA8 | A 5ª rede de uma sessão funciona; a 6ª encerra a sessão com alerta | plano |
| CA9 | Nenhum pedido com `Authorization` é aceito, nem com sessão válida junto; as rotas `/api/remote` não existem | Pablo |
| CA10 | O bot não tem mais `/tokens`; o menu é reenviado | Pablo |
| CA11 | A migration 34 só acrescenta e mantém as sessões abertas | regra do repositório |

## 4. Escopo

**Entra:** teto diário por rede, sessão presa ao navegador, ao país e à rede, remoção do acesso remoto por token (código, tela, comando do bot, textos, documentação).

**Fica fora (e onde vai parar):**

- Bloqueio da conta inteira por senha errada → não faremos: qualquer pessoa trancaria o dono errando de propósito.
- Apagar as tabelas `zur_remote_*` → não faremos: migrations só acrescentam.
- Recebimento de eventos do n8n pelo CRM (`/api/crm/events`) → thread "Remover integração com o n8n".
- Tela para escolher os números (5 por dia, 5 redes) → só se o Pablo pedir.

## 5. Como funciona para o Pablo

### Fluxo 1 · Senha errada demais

1. Alguém erra a senha 5 vezes em 24 horas numa rede em que o Pablo nunca entrou.
2. A tela de login mostra a espera ("Espere 18:59:59"), como já fazia para os 15 minutos.
3. Em Acessos aparece "Entrada bloqueada" com "limite diário atingido".
4. O Pablo, em casa ou no celular de sempre, entra normalmente.

### Fluxo 2 · Cookie copiado

1. Alguém usa o cookie da sessão em outro navegador ou em outro país.
2. A sessão termina para todos. O Pablo volta para a tela de login.
3. Chega o aviso "Sessão encerrada por segurança" nos canais de alerta e a linha aparece em Acessos.

### Fluxo 3 · Mudou de rede

1. O Pablo sai do Wi-Fi para os dados do celular com a Zuri aberta.
2. Nada muda na tela. Em Acessos aparece "Sessão usada em outra rede".
3. Se a rede é nova para a Zuri, chega o aviso "Sessão usada em uma rede nova".
4. Se ele for fazer algo sensível ali, a Zuri pede a senha, como já faz quando passam 15 minutos.

### Fluxo 4 · Sem acesso por token

O cartão Acesso remoto some de Configurações › Segurança e o `/tokens` some do bot. Não há nada a fazer.

Sem tela nova: nenhum layout muda, só sai um cartão.

### Textos visíveis

| Chave | pt-BR | en | Onde aparece |
| --- | --- | --- | --- |
| `web.activity.kind.session_blocked` | Sessão encerrada por segurança | Session ended for security | Acessos |
| `web.activity.kind.session_network_changed` | Sessão usada em outra rede | Session used on another network | Acessos |
| `web.accessLog.reason.other_browser` | usada em outro navegador | used in another browser | Acessos |
| `web.accessLog.reason.other_country` | usada em outro país | used in another country | Acessos |
| `web.accessLog.reason.too_many_networks` | usada em redes demais | used on too many networks | Acessos |
| `notice.security.session_blocked.*` | Sessão encerrada por segurança (título e corpo) | Session ended for security | Avisos |
| `notice.security.session_network_changed.*` | Sessão usada em uma rede nova (título e corpo) | Session used on a new network | Avisos |

Saem do catálogo: `web.remote.*`, `remote.*`, `telegram.seg.tokens.*`, `telegram.menu.tokens`, `notice.remote.event.title` e os tipos `remote_*` de Acessos e Avisos.

## 6. Regras de negócio e limites

| Regra | Valor | No limite | Erro |
| --- | --- | --- | --- |
| Senhas erradas por rede em 24 h | 5 (`MAX_DAILY_FAILURES_PER_NETWORK`) | a 5ª é conferida; a 6ª tentativa espera | 429 `RATE_LIMITED`, `details.daily: true` |
| Isenção do teto diário | rede com login certo em 30 dias | mantém 3 em 15 min | — |
| Redes por sessão | 5 (`MAX_SESSION_NETWORKS`) | a 5ª funciona; a 6ª encerra | 401 `UNAUTHORIZED` |
| Outro navegador ou país | 0 tolerância | encerra a sessão | 401 `UNAUTHORIZED` |
| Senha recente em outra rede | fechada | pede a senha ali | 403 `RECENT_AUTH_REQUIRED` |
| Pedido com `Authorization` | nunca aceito | — | 401 `UNAUTHORIZED` |

Concorrência: pedidos simultâneos de uma rede nova gravam um evento só (a atualização é condicional); uma sessão encerrada duas vezes alerta uma vez.

## 7. Desenho técnico

### Arquivos

| Arquivo | Cria ou muda | Para quê |
| --- | --- | --- |
| `apps/agent/src/auth/login-limiter.ts` | muda | teto diário numa leitura só junto com a janela de 15 min |
| `apps/agent/src/auth/sessions.ts` | muda | colunas novas, `noteNetwork`, janela de senha por rede |
| `apps/agent/src/auth/service.ts` | muda | `validate` compara a origem (`sameOrigin`); sai o gancho dos tokens |
| `apps/agent/src/api/app.ts`, `apps/agent/src/live/channel.ts` | muda | passam a origem do pedido; recusam `Authorization` |
| `apps/agent/src/index.ts` | muda | o Worker recusa `Authorization` antes do objeto |
| `apps/agent/src/db/migrations.ts` | muda | migration 34 |
| `apps/agent/src/remote/`, `api/remote.ts`, `packages/shared/src/remote.ts`, `RemoteAccessCard.tsx` | apaga | acesso remoto |
| `apps/agent/src/telegram/security.ts`, `service.ts` | muda | sai `/tokens`; `TELEGRAM_MENU_VERSION` 7 |

### Rotas e contratos

Somem `GET/PATCH /api/remote`, `POST/DELETE /api/remote/tokens`, `DELETE /api/remote/tokens/:id` e `POST /api/remote/events`. Nenhuma rota nova. `GET /api/auth/session` passa a responder `recentAuthUntil: null` fora da rede da senha.

### Banco

Migration 34 `session_binding`: `ALTER TABLE zur_sessions ADD COLUMN` para `device` (HMAC do cookie de aparelho), `country`, `networks` (uma por linha) e `confirmed_network`. No máximo 20 linhas na tabela. Nenhuma consulta nova por pedido: os dados vêm na linha da sessão que já era lida.

### Ferramentas do agente

Nenhuma.

### Agendamentos, IA e integrações externas

Nenhum.

## 8. Custo e cotas do plano Free

| Recurso | Uso típico | Pior caso | Folga | Fonte |
| --- | --- | --- | --- | --- |
| Leituras por login | igual (a contagem do dia divide a consulta da janela) | +1 leitura para rede no teto | — | teste "SEC-3-02" de `auth-limits.test.ts` |
| Leituras por pedido com sessão | igual | +1 quando a rede é nova | — | `sessions.ts` |
| Escritas por pedido com sessão | 0 a mais | 1 por rede nova, até 4 por sessão, mais o evento | — | `noteNetwork` |
| JS inicial | menor (sai o cartão, que era carregado sob demanda) | — | — | build |

Nada que gere cobrança.

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Cookie da sessão copiado | sessão presa ao cookie de aparelho | `auth-sessions.test.ts`, `auth-routes.test.ts` |
| Os dois cookies copiados, usados de fora | país e rede; senha recente não acompanha; alerta | `auth-sessions.test.ts` |
| Chute lento de senha | teto diário | `auth-limits.test.ts` |
| Trancar o dono de propósito | redes do dono isentas; sem bloqueio global | `auth-limits.test.ts` |
| Token de acesso vazado | não existe mais token | `auth-password-route.test.ts` |
| Enxurrada de alertas por troca de rede | um evento por rede nova, no máximo 4 por sessão | `auth-sessions.test.ts` |

Limite conhecido: quem copia os dois cookies e usa da mesma rede e país do dono não é distinguido. Ficam os prazos da sessão e a senha nas ações sensíveis. Auditoria: completa (mexe em sessão e login).

## 10. Testes

| CA | Teste | Camada | Arquivo |
| --- | --- | --- | --- |
| CA1 | "lets the 5th wrong password through (n)…" e "opens again the millisecond…" | unitário | `apps/agent/test/auth-limits.test.ts` |
| CA2 | "never locks one of the owner's networks for a day" e "a browser that signed in before gets no exemption" | unitário | idem |
| CA3 | "checks the cap before any PBKDF2, and counts concurrent tries" | unitário | idem |
| CA4 | "a copied session cookie alone opens nothing" e a versão HTTP | unitário e integração | `auth-sessions.test.ts`, `auth-routes.test.ts` |
| CA5 | "another country ends it" | unitário | `auth-sessions.test.ts` |
| CA6 | "another network keeps the session, shows in the access log once…" | unitário | idem |
| CA7 | "the password's 15-minute window holds only on the network it was typed on" e a versão HTTP | unitário e integração | idem, `auth-routes.test.ts` |
| CA8 | "the 5th network still works (n) and the 6th ends the session (n+1)" | unitário | `auth-sessions.test.ts` |
| CA9 | "refuses a request that carries Authorization, even with a live session" | integração | `auth-password-route.test.ts` |
| CA10 | menu do bot sem `tokens` | integração | `telegram-routes.test.ts`, `telegram-lockdown.test.ts` |
| CA11 | "upgrades a database at version 33 to 34" | integração | `migrations.test.ts` |

## 11. Entrega

- **Ordem:** um PR só.
- **Capturas:** Configurações › Segurança sem o cartão Acesso remoto.
- **Docs:** `docs/seguranca.md`, `docs/telegram.md`, `docs/avisos.md`, `docs/backup.md`, `docs/memoria.md`, `docs/ia.md`, `docs/instalacao-cloudflare.md`, `docs/arquitetura/orcamento-free-tier.md`, `docs/especificacao.md`, `README.md`; sai `docs/acesso-remoto.md`.
- **Changelog:** `changelog/nao-lancado/reforco-login-sessao.md`
- **Instalação:** nada novo.
- **Portabilidade:** nenhum binding novo.

## 12. Riscos

| Risco | Chance | Impacto | O que fazemos |
| --- | --- | --- | --- |
| Operadora que troca o IP o tempo todo estoura as 5 redes | baixa | o Pablo entra de novo | redes já vistas não contam de novo; o número é uma constante fácil de subir |
| Viagem ao exterior com a sessão aberta | baixa | sessão encerrada uma vez | entrar de novo no país novo abre sessão normal |
| Outra PR usar a migration 34 antes | média | conflito | renumerar para 35 antes do merge |

## 13. Suposições

- Rede nova não encerra a sessão: encerrar a cada troca de Wi-Fi para 4G deixaria o celular inutilizável.
- O alerta de troca de rede só sai para rede que não é do dono, para não virar ruído.
- A janela de senha recente fica presa à rede em vez de fechar a cada troca: assim IPv4 e IPv6 da mesma linha não derrubam uma ação pela metade.
- O cookie de aparelho não isenta do teto diário: ele pode ter sido copiado.
- Os tipos de evento `remote_*` saem das listas: não há instalação em produção com linhas antigas.

## 14. Entrevista com o Pablo

| Data | Pergunta | Resposta |
| --- | --- | --- |
| 11/11/2026 | O que "não usar API" significa: remover o acesso por token, só manter desligado, ou cortar também Google e Telegram? | Remover o acesso por token |
| 11/11/2026 | Plano com sessão presa ao navegador e à rede, teto diário de 10 e sem bloqueio da conta inteira? | Teto diário de 5 senhas erradas |
