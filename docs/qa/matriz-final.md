# Matriz de rastreabilidade final (etapa 25)

Cada critério de aceite das etapas 0 a 26 (com 15a/15b, 16a/16b, 18a/18b, 19b, 19c, 19d, 21b, 22a/b/c, 23 e 26a/b/c) ligado ao teste que o prova. Montada pelo QA sênior independente sobre a `develop` em 2e4f09f e atualizada com os testes desta etapa. Relatório da auditoria: [auditorias/2026-11-09-etapa-25.md](auditorias/2026-11-09-etapa-25.md).

Legenda: A = `apps/agent/test/`, W = `apps/web/test/`, S = `packages/shared/test/`, E = `tests/e2e/`, R = `tests/repo/`, L = `tests/lighthouse/`.
Nome do teste = título do `it`/`test` (início literal).

| Etapa | Critério resumido | Arquivo › teste |
| --- | --- | --- |
| 0 | Actions fixadas por SHA | R/workflows.test.ts › "$path pins every action to a full commit SHA" |
| 0 | Nenhum job de PR com segredo | R/workflows.test.ts › "$path gives pull request jobs no secret and no environment" |
| 0 | `permissions: contents: read` / sem escrita em PR | R/workflows.test.ts › "$path grants pull request jobs no write permission beyond CodeQL results"; "runs CI on pull requests, on pushes to develop and when the deploy calls it, with read-only contents" |
| 0 | Um job por check exigido (PR passa por todos) | R/workflows.test.ts › "has one CI job per required check"; R/rulesets.test.ts › "all exist as jobs, so a ruleset never waits on a check that never runs" |
| 0 | npm audit high | R/workflows.test.ts › "audits dependencies for high or critical advisories" |
| 0 | CodeQL | R/workflows.test.ts › "runs CodeQL on pull requests, on pushes to develop and weekly, with the extended queries" |
| 0 | Rulesets (PR obrigatório, sem force-push, checks) | R/rulesets.test.ts › "requires a pull request without human approval"; "blocks deletion and force-push"; "requires every CI check" |
| 0 | main só recebe PR da develop | R/workflows.test.ts › "lets only develop open pull requests into main"; "refuses a fork branch named develop" |
| 0 | Dependabot npm+Actions, develop, cooldown | R/repository.test.ts › "watches npm and GitHub Actions, targeting develop with a cooldown" |
| 0 | TS strict, Node por .nvmrc, versões exatas, LICENSE/NOTICE | R/repository.test.ts › "is strict everywhere"; "pins Node.js 24 or newer in .nvmrc and engines"; "saves exact dependency versions"; "is MIT licensed and credits Talorys" |
| 1 | Host proibido = 403 | A/gates.test.ts › "refuses any host other than the one of PUBLIC_URL with 403 HOST_NOT_ALLOWED"; E/gates.spec.ts › "another host is refused with 403 HOST_NOT_ALLOWED, for pages and the API" |
| 1 | HTTP → HTTPS | A/gates.test.ts › "moves an anonymous GET or HEAD to the same address over HTTPS with 301"; "refuses a plain HTTP request with a body instead of redirecting it" |
| 1 | Cabeçalhos iguais ao `_headers` | A/headers-file.test.ts › "has exactly WEB_HEADERS for every path"; A/gates.test.ts › "puts the interface's headers on pages and the cache rules of _headers"; E/gates.spec.ts › "the interface arrives with the security headers of _headers" |
| 1 | Instância fixa | A/agent.test.ts › "routes every API request to the instance named on the server, whatever the client sends" |
| 1 | Recusa de WebSocket | A/gates.test.ts › "are refused on every path with 403"; A/agent.test.ts › "refuses a WebSocket upgrade that reaches the object without the Worker"; E/gates.spec.ts › "a WebSocket connection is refused" |
| 1 | `GET /api/health` sem dados | A/agent.test.ts › "answers 200 { ok: true } and nothing else"; E/gates.spec.ts › "health answers { ok: true } with the API's headers" |
| 1 | `preview_urls: false`, SQLite DO | A/wrangler-config.test.ts › "never exposes workers.dev or preview URLs"; "declares the agent's Durable Object with SQLite in migration v1" |
| 2 | Migration 1 sob demanda | A/database-on-demand.test.ts › "is created on the first request that needs it, at the latest migration"; "is not touched by the health check" |
| 2 | Teste anti-DROP | A/migrations.test.ts › "never drops, deletes or touches the Agents SDK's tables"; "the anti-DROP check really catches a DROP" |
| 2 | Migrations só de acréscimo / de toda versão anterior | A/migrations.test.ts › "never edits a migration once merged (append a new one instead)"; "upgrades a database at version N to N+1 …" (1→30) |
| 2 | Settings com padrões (fuso, idioma) | A/settings.test.ts › "returns the defaults on a new database"; S/settings.test.ts › "start in pt-BR, in the São Paulo time zone, …" |
| 2 | Mudar idioma muda erros da API | A/settings.test.ts › "answer in pt-BR by default and in English after the owner switches"; E/shell.spec.ts › "changing the language to English changes the interface and the API's errors" |
| 2 | Chave só num idioma falha | S/i18n.test.ts › "has the same keys in every locale"; "has no empty translation"; R/i18n-lint.test.ts › "report a key in one language only and an empty translation" |
| 2 | Lint de literal visível (JSX, title, aria-label, placeholder, AppError) | R/i18n-lint.test.ts › "catches JSX text"; "catches title, aria-label, placeholder and alt"; "catches a message written into new AppError(...)"; "fails with exit code 1 and names the file and line of the planted literal" |
| 2 | Exceções com motivo em i18n-ignore.json | R/i18n-lint.test.ts › "refuses an exception without a reason"; "fails on a stale exception" |
| 3 | Cookie `__Host-` HttpOnly Secure Strict | A/auth-routes.test.ts › "opens a session: __Host- cookie, HttpOnly, Secure, SameSite=Strict, …" |
| 3 | CSRF recusado | A/auth-routes.test.ts › "refuses CSRF on every signed-in route even with a valid session"; A/agent.test.ts › "refuses with 403 CSRF_FAILED, before anything else, …"; E/auth.spec.ts › "refuses a sign-in without the CSRF header or from another origin"; "a cross-site form post from a browser page can't sign in" |
| 3 | 30 min inatividade | A/auth-sessions.test.ts › "ends after 30 minutes without use, even with a tab open (29:59 lives, 30:00 ends)" |
| 3 | 5 min sem aba | A/auth-sessions.test.ts › "ends 5 minutes after the last sign of an open tab (4:59 lives, 5:00 ends)" |
| 3 | 6 h máximo | A/auth-sessions.test.ts › "ends after 6 hours whatever happens (5:59:59.999 lives, 6:00 ends)" |
| 3 | 3 falhas por rede em 15 min (n−1/n/n+1) | A/auth-limits.test.ts › "lets the 1st, 2nd and 3rd wrong password through …, and makes the 4th wait"; "still signs in after 2 failures (n−1)"; "keeps waiting on the 4th and 5th tries (n+1) …" |
| 3 | Verificação antes do PBKDF2 / concorrência | A/auth-limits.test.ts › "checks the limit before any PBKDF2: a blocked network costs no hashing"; "counts concurrent tries before the slow check, so 10 at once still get only 3 guesses" |
| 3 | Turnstile em toda tentativa, falha fechada | A/auth-limits.test.ts › "is asked for on the very first try of a clean network …"; "is asked for again on every try …"; "fails closed when siteverify does not answer …"; A/auth-http-limits.test.ts › "answers 503 SERVICE_UNAVAILABLE when siteverify does not answer (fail closed)" |
| 3 | PBKDF2 100.000 + pepper; formato | S/password.test.ts › "writes pbkdf2$100000$salt$hash and checks it back with the same pepper only" |
| 3 | Política 15+, HIBP falha fechada | S/password.test.ts › "counts characters as a person does: 14 is short, 15 and 256 pass, 257 is long"; A/auth-sessions.test.ts › "refuses a breached password, and refuses when the breach check can't answer (fail closed)" |
| 3 | OWNER_PASSWORD 20+ e troca obrigatória | A/auth-sessions.test.ts › "signs in with the plain secret, then allows only the change until the hash is stored"; "accepts a plain secret of 20 characters and ignores one of 19" |
| 3 | Troca obrigatória bloqueia toda rota | A/auth-password-route.test.ts › "blocks every registered signed-in route but the four allowed, without running it" |
| 3 | Senha fraca atual força troca | A/auth-sessions.test.ts › "forces a change when the password in use fails today's rules" |
| 3 | auth_events 90 dias / 1 ano | A/auth-events.test.ts › "turns detail older than 90 days into daily counts, and drops counts older than a year" |
| 3 | alert_pending para a etapa 11 | A/auth-events.test.ts › "none for the very first sign-in; one for a new browser; …"; A/alerts-watchers.test.ts › "turns each marked event into a critical alert once, …" |
| 3 | Cabeçalhos de IP forjados | A/http-hardening.test.ts › "counts failures by CF-Connecting-IP alone, whatever X-Forwarded-For, X-Real-IP or True-Client-IP say" |
| 3 | Senha recente 15 min | A/auth-sessions.test.ts › "opens at sign-in, closes at 15:00, and confirm opens it again" |
| 4 | Reuso de código TOTP | A/auth-mfa.test.ts › "never takes the same code twice, nor one from an earlier step (code reuse)"; E/two-step.spec.ts › "turns two-step sign-in on, asks for the code after the password, and refuses the same code twice" |
| 4 | Código de recuperação uma vez (só hash) | A/auth-mfa.test.ts › "takes a recovery code once (recovery code reuse), and tells the owner" |
| 4 | Desafio 5 min em cookie `__Host-` | A/auth-mfa.test.ts › "a challenge works until 4:59.999 and is over at 5:00 (expired challenge)"; A/auth-mfa-routes.test.ts › "a right password answers 200 {mfaRequired}, a 5-minute __Host- cookie and no session; …" |
| 4 | 10 erros em 15 min pausam redes desconhecidas | A/auth-mfa.test.ts › "10 wrong codes in 15 minutes pause unknown networks; the owner's own keep trying" |
| 4 | 30 em 24 h suspendem, com alerta | A/auth-mfa.test.ts › "SEC-4-02: a guess that stays under the short pause stops at the daily cap …"; "holds to the last millisecond of the day …" |
| 4 | Cookie de aparelho não dispensa 2FA | A/auth-mfa-routes.test.ts › "a known device cookie never skips the second step" |
| 4 | Passkeys por host; as de outro host marcadas | A/auth-passkeys.test.ts › "are listed as not usable here, never offered, and their answers refused"; "refuses an answer made for another origin or host" |
| 4 | Reuso de resposta de passkey | A/auth-passkeys.test.ts › "an answer is never taken twice (replay), even before it was checked" |
| 4 | Reuso de link (recuperação) | A/auth-recovery.test.ts › "works until 30 minutes, not a moment after, and only the newest link works"; A/recovery-routes.test.ts › "set a new password from the link, end the sessions and refuse the link a second time" |
| 4 | e2e 2FA na interface | E/two-step-ui.spec.ts › "turns two-step sign-in on in Settings and asks for the code at the next sign-in" |
| 5 | e2e login, logout | E/auth.spec.ts › "signs in, reads the session, signs out, and the cookie opens nothing after"; E/shell.spec.ts › "signing out ends the session on the server and in every tab" |
| 5 | e2e expiração | E/shell.spec.ts › "the session ends after the idle limit without use, with the reason on the sign-in"; E/states.spec.ts › "the maximum session time warns without a way to stay, then signs out with the reason"; E/session-background.spec.ts › (3 testes) |
| 5 | Guarda de sessão com `?next=` | E/shell.spec.ts › "a private page sends to the sign-in with ?next= and opens after it"; "an unsafe ?next= opens the home page instead of another site" |
| 5 | PWA instala no Chromium | E/pwa.spec.ts › "Chromium finds nothing that keeps the app from being installed" |
| 5 | `/api/*` com `no-store`; SW não guarda API | E/pwa.spec.ts › "every /api answer says Cache-Control: no-store, success or refusal"; "the service worker never answers an API request: …" |
| 5 | Lighthouse acessibilidade ≥ 90 (hoje ≥ 95) | L/lighthouse.spec.ts (job `lighthouse`) |
| 5 | Configurações com abas | E/shell.spec.ts › "settings has the eight sections, each with its address and content: tabs on a computer, a list on a phone" |
| 5 | Tema claro/escuro | E/states.spec.ts › "the theme choice applies at once and stays after a reload"; E/sidebar.spec.ts › "the account menu switches the theme of this device" |
| 6 | Datas impossíveis (inclusive com fuso) | S/productivity.test.ts › "refuses an impossible deadline, with or without an explicit zone"; A/productivity.test.ts › "refuse impossible dates (explicit zones too) and keep the stored value"; A/productivity-routes.test.ts › "refuses impossible dates, explicit zones included, in the owner's language"; E/productivity.spec.ts › "the API refuses an impossible deadline even with an explicit zone" |
| 6 | e2e criar, editar, concluir, restaurar | E/productivity.spec.ts › "a task: create with a deadline and a project, edit, complete, delete and restore"; "a note: write Markdown, preview it safely, search, delete and restore" |
| 6 | FTS5 em notas, sintaxe digitada | A/productivity.test.ts › "never break on FTS5 syntax typed by the owner: …"; A/productivity-routes.test.ts › "FTS5 syntax typed in still finds what the words say" |
| 6 | LIKE com escape em tarefas; "Água"/"água" | A/productivity.test.ts › "search literally: % and _ are characters, not wildcards"; "search folds accented capitals both ways: …" |
| 6 | Lixeira: restaurar, limpeza 30 dias | A/productivity.test.ts › "restores a task as it was, and only once"; "forgets entries after 30 days, on the next use" |
| 6 | Limites por tipo (n−1/n/n+1) | A/productivity.test.ts › "take exactly the limit and refuse one more with STORAGE_LIMIT_REACHED (n-1, n, n+1)"; A/productivity-routes.test.ts › "takes the 20,000th task and refuses the next one with 507" |
| 6 | Concorrência (restaurar, apagar, criar no último lugar) | A/productivity-routes.test.ts › "two restores of one trash item at once: …"; "two creates for the last place at once: …"; "the same delete twice at once: …" |
| 6 | Consulta hostil | A/productivity-routes.test.ts › "refuses limit=%s"; "takes limit 1 and 500 (the edges) …"; "takes a search of 200 characters and refuses 201" |
| 6 | XSS no Markdown | W/markdown.test.tsx; E/productivity.spec.ts › "a note: write Markdown, preview it safely, …" |
| 7 | Casos de `memory-history.md` | A/memory.test.ts › describe "history of facts (docs/memory-history.md)" (10 testes, ex.: "I sold my Volkswagen and bought a Tesla: …") |
| 7 | Até 2.000 caracteres | A/memory.test.ts › "refuse empty, too long, control characters and unknown fields, naming only the field" |
| 7 | Status atual/incerto/passado | A/memory.test.ts › "mark uncertain, past and current again; the counters follow every change" |
| 7 | Substituição sem ciclos | A/memory.test.ts › "a memory can't replace itself or one of its own replacements, at any depth" |
| 7 | Fila de revisão de conflitos | A/memory.test.ts › "keep both: both stay current"; "replace the older: deleted for good"; "discard the newer: deleted for good" |
| 7 | Perguntas sobre o passado | A/memory-rules.test.ts › describe "questions about the past"; A/memory.test.ts › "a past question brings the versions before what it found, …" |
| 7 | Memória em `<data>` | A/memory-rules.test.ts › "make stored text inert: …"; A/memory.test.ts › "a memory that tries to become an instruction stays data, …" |
| 7 | Tela de Memória (editar, excluir, revisão) | E/memory.spec.ts › "memories: save, duplicate, review a conflict, history, restore, update and delete" |
| 8 | Stream abortado contado | A/ai-provider.test.ts › "still counts a stream aborted by its signal in the middle"; "counts a generate() call the owner stops halfway as aborted" |
| 8 | Limite diário sem estouro concorrente | A/ai-provider.test.ts › "lets exactly the requests left through when many start at once"; "never passes the Neuron cap together, …"; "lets exactly the requests left through when many streams start at once" |
| 8 | Contado antes da chamada (n−1/n/n+1) | A/ai-usage.test.ts › "allows the request that reaches the limit and refuses the next one (n−1, n, n+1)" |
| 8 | Sem novas tentativas do SDK | A/ai-provider.test.ts › "does not retry a busy model (429), …"; "records Cloudflare's own token counts …, with reasoning off and no retries" |
| 8 | Preço datado / Neurons | A/ai-usage.test.ts › "prices a chat step by the dated table, in Neurons and list US$" |
| 9 | Cenários de injeção de prompt | A/chat-runner.test.ts › describe "prompt injection (security scenarios)" (11 testes); A/prompt-canary.test.ts |
| 9 | Nome do agente na 1ª linha | A/chat-runner.test.ts › "opens with the agent's name on one line, which can't add rules of its own" |
| 9 | Registro com permissão e limite por turno | A/chat-tools.test.ts › "has exactly the tools of the specification, each with a strict schema, a permission and a per-turn cap"; "allows exactly the turn's budget of calls (n), refuses n+1, and says so" |
| 9 | Detecção de laço | A/chat-tools.test.ts › "refuses an exact repeat (a loop), but not the same tool with other input"; A/chat-runner.test.ts › "a model stuck in a loop: …" |
| 9 | Sem shell/HTTP/credenciais | A/chat-tools.test.ts › "offers nothing that reaches outside the owner's data: no shell, code, HTTP, credentials or deploy" |
| 9 | Aprovação atômica | A/chat-tools.test.ts › "two approvals at the same time: exactly one runs"; "concurrent confirmations create one set of tasks" |
| 9 | Voz 60 s/clipe | A/chat-routes.test.ts › "accepts 60 s (n) and up to 61 measured, refuses 62 s (n+1), …" |
| 9 | Voz 60 min/dia | A/chat-routes.test.ts › "an hour a day of audio: the clip that would pass it is refused"; A/ai-usage.test.ts › "caps audio at one hour a day, exactly, …" |
| 9 | Voz um por vez | A/chat-routes.test.ts › "one clip at a time: a second one while the first is transcribing is CONFLICT" |
| 9 | SSE ponta a ponta, Parar | A/chat-runner.test.ts › "stopped by the owner: the partial answer is kept as cancelled and its plans withdrawn"; W/chat-stream.test.ts; E/chat.spec.ts |
| 10 | Mínimo de 1 hora | S/automations.test.ts › "repeats at most once an hour: 59 minutes is refused, 60 and 61 are fine, …" |
| 10 | Máximo 50 ativas | A/automations.test.ts › "keeps at most 50 active (n-1, n, n+1); …"; A/automation-tools.test.ts › "at 50 active, tells the model …" |
| 10 | Rotina do chat nasce pendente | A/automations.test.ts › "is born waiting for approval: …"; "from the chat it always waits for approval, …"; E/automations.spec.ts › "a routine Zuri proposes in the chat runs nothing until the owner approves it" |
| 10 | Recorrência no horário de verão | S/automations.test.ts › "across São Paulo's last daylight-saving start (04/11/2018): …"; "across its end (17/02/2019): …"; "in a zone where summer time is still in force (New York, …)" |
| 10 | Dia 31 | S/automations.test.ts › "on day 31 runs on the last day of shorter months, February of a leap year included" |
| 10 | Reconciliação roda uma vez | A/automations.test.ts › "closes a run cut short as interrupted, never runs it again, and does nothing the second time"; "a fresh service over the same database (a new instance) still runs a claimed slot only once"; "two wakes at once … never run the same slot twice" |
| 10 | Perdida < 24 h roda uma vez | A/automations.test.ts › "a run missed by less than a day runs once on recovery; …"; "23 h 59 min late still runs once (n-1 before the day boundary)" |
| 10 | Sentinela NADA | S/automations.test.ts › "is NADA or NOTHING alone, whatever the case, spaces or punctuation around it" |
| 10 | Tela de Automações | E/automations.spec.ts › "a reminder: create with the preview, run now, pause, edit and delete" |
| 11 | Alerta de segurança por todos os canais mesmo desligado | A/alerts.test.ts › "sends a security alert through every channel, critical, even with its category and every route off"; A/telegram-alerts.test.ts › "follows the notice center: …, critical ignores the routes" |
| 11 | Deduplicação | A/alerts.test.ts › "creates the same notice again only after the key's wait, even if the first was deleted" |
| 11 | Limites por canal hora/dia | A/alerts.test.ts › "holds the message past the hour's limit (n-1, n, n+1) …"; "counts the day too, …" |
| 11 | Insistência +15/+60/+75 com relógio falso | A/alerts.test.ts › "tries again at +15 and +60 minutes, through the same channels but not e-mail, and gives up at +75 (fake clock)"; A/telegram-alerts.test.ts › "tries again at +15 min and +60 min with the footer, …" |
| 11 | Prioridade que aprende (1 nível/semana) | A/alerts-learning.test.ts › "waits a full week before a second change" (+12 testes) |
| 11 | Vigias 15 min, resumo 07:30 | A/alerts-watchers.test.ts › "runs once per 15 minutes, …"; "goes out once a local day from its time to 3 hours later, …"; "follows the owner's zone across a daylight-saving change" |
| 11 | Push: 3 aparelhos, 7 dias, passo extra | A/push.test.ts › "keeps three at most, …"; "drops a device only after seven full days …"; A/push-routes.test.ts › "refuse a fourth device"; "add a device only with the password typed recently, and tell the owner" |
| 11 | E-mail 10/dia com 4 para segurança | A/email.test.ts › "sends 6 notices a day and keeps the last 4 for security; the window slides" |
| 11 | Recuperação de senha por e-mail (30 min, 3/rede/15 min, 2FA) | A/auth-recovery.test.ts › "sends a 30-minute link only for the owner's e-mail, …"; "allows 3 requests per network in 15 minutes, …"; "asks for a code with two-step sign-in on; …"; E/recovery.spec.ts (5 testes) |
| 11 | Diagnóstico (200 tipos, 30 dias, 20/h, 5 em 15 min, 20/dia) | A/diagnostics.test.ts › "keeps 200 kinds for 30 days"; "takes 20 interface errors an hour (the 21st is refused) …"; "raises 'repeated' at the 5th failure in 15 minutes (not the 4th), …"; "raises 'repeated' at the 20th failure of a day …" |
| 11 | IA em 80% e 100% | A/alerts-watchers.test.ts › "tells at 80% and 100% of the day's Neurons, once each per UTC day" |
| 11 | Aba Diagnóstico | E/notices.spec.ts › "Settings > Diagnóstico shows a screen's failure by name only, and marks it resolved" |
| 12 | Sem cabeçalho secreto = 403 | A/telegram-routes.test.ts › "answers 403 without the secret header or with a wrong one, before the object"; A/telegram-secret.test.ts › "matches only the exact header" |
| 12 | 64 KB | A/telegram-routes.test.ts › "refuses a body over 64 KB with 413 and takes one of exactly 64 KB" |
| 12 | Conta estranha não grava nada | A/telegram-routes.test.ts › "an account that isn't the owner's writes nothing and gets no answer, even with the right code" |
| 12 | Replays ignorados | A/telegram-routes.test.ts › "handles a repeated update_id once" |
| 12 | Cliente sem redirecionamento, 429 retry_after | A/telegram-client.test.ts › "refuses a redirect instead of following it"; "waits a short 429 once, and leaves a long one to the caller" |
| 12 | Vínculo: código 10 min, 10 errados em 10 min | A/telegram-routes.test.ts › "an expired code no longer links"; "ten wrong codes in ten minutes end the code, …" |
| 12 | Conectar pede senha recente | A/telegram-routes.test.ts › "Connect, Confirm, Unlink, the group and the settings ask for the password typed recently; …" |
| 12 | Menu reaplicado quando a versão muda | A/telegram-routes.test.ts › "is sent again when its version or the language changed, and only after a Connect" |
| 12 | Cartão do Telegram (e2e) | E/telegram.spec.ts › "Settings > Avisos: the owner connects Telegram with a code, confirms the account, sends a test and unlinks" |
| 13 | Link desarmado em todo texto | A/telegram-alerts.test.ts › "shows the text with Texto completo on, and disarms every link in title and text"; "also disarms what only Telegram makes tappable: …"; A/telegram-format.test.ts › "disarms links, commands and mentions" |
| 13 | Só o dono aciona botões no grupo | A/telegram-alerts.test.ts › "only the owner works the buttons in the group: …" |
| 13 | Grupo nunca recebe sozinho alerta de segurança | A/telegram-alerts.test.ts › "sends notices to the group, in the category's topic (created once), and security alerts only to the private chat" |
| 13 | Segundo toque "já tratado" | A/telegram-alerts.test.ts › "Feito marks the notice read, …; a second tap is 'already handled'"; "two taps at once act once" |
| 13 | Som só alta e crítica; discreto | A/telegram-alerts.test.ts › "sends a normal notice discreet, silent, …"; "rings for high and critical, …" |
| 14 | Conversa aparece na lista do app | A/telegram-conversation.test.ts › "becomes a turn of an app conversation marked as Telegram's, …"; E/chat.spec.ts (a11y "conversa pelo Telegram") |
| 14 | Conversa desligada não baixa o áudio | A/telegram-conversation.test.ts › "starts off: … a voice note isn't even looked up (no getFile)"; "turned off after the question, the tap downloads nothing" |
| 14 | Arquivo acima do limite só depois de Processar, na validade | A/telegram-conversation.test.ts › "downloads only after the owner's tap within the 10 minutes, once"; "takes a tap 1 ms before the 10 minutes end, and refuses one at exactly 10 minutes" |
| 14 | 5 min e 5 MB (n/n+1); teto rígido 20 MB | A/telegram-conversation.test.ts › "processes up to 5 min and 5 MB without asking (n), and asks one above (n+1)"; "explains a file over the Bot API's 20 MB without asking (n allowed, n+1 refused)" |
| 14 | Um turno por vez, 3 min, digitando | A/telegram-conversation.test.ts › "answers one turn at a time: …"; "stops at the turn's deadline and says so; …"; "sends typing every 5 s in the first minute only, …" |
| 14 | HTML com escape, blocos 4.096 | A/telegram-format.test.ts › "cuts at 4,096 characters (n stays whole, n+1 splits)"; "escapes <, > and & before anything, …" |
| 15 | Cada comando com teste | A/telegram-commands.test.ts › "/hoje: …"; "/tarefas: …"; "/buscar: …"; "/rotinas …"; "/avisos: …"; "/status unlocked: …"; "/uso, /status and /backup answer while reading is locked"; "/nova with a date: …"; "/feito <nº> …"; "/lembrar <quando> <texto>: …"; "/nota and /memoria save …"; "/ajuda lists the commands"; A/telegram-unlock.test.ts › "/nova_conversa makes the next message start another app conversation" |
| 15 | Comandos não gastam IA | A/telegram-commands.test.ts › "no command reaches the model nor counts a request" |
| 15 | Fotos e documentos (legenda vira nota) | A/telegram-commands.test.ts › "a caption becomes a note with the attachment's line; nothing is downloaded"; "without a caption the bot asks for one; …" |
| 15a | Trava de leitura (12 h) | A/telegram-unlock.test.ts › "locks after the hours without use, not at exactly the hours" |
| 15a | /destravar por passkey e e-mail | A/telegram-unlock.test.ts › "unlocks with the passkey (user verification required), …"; "unlocks for 12 h when it answers the bot's question, …" |
| 15a | 60 comandos/hora | A/telegram-unlock.test.ts › "keeps to 60 commands an hour: the 61st gets one reply, …" |
| 16a | 5 falhas travam por 1 h com alerta | A/telegram-unlock.test.ts › "lock confirming through the bot for an hour, with one alert a day"; A/telegram-approvals.test.ts › "five wrong codes lock approvals through the bot for an hour and raise the alert" |
| 16a | Token /aprovar e código não servem 2× nem a outra proposta | A/telegram-approvals.test.ts › "never lets one proposal's token run another"; "doesn't serve another proposal: …"; "shows the preview, runs the proposal once with the passkey, …" |
| 16a | Prévia vem do banco | A/telegram-approvals.test.ts › "comes after the answer with the preview from the database …"; "names the target as it is stored now, never by the words kept with the proposal" |
| 16a | TARGET_CHANGED | A/telegram-approvals.test.ts › "refuses a target that changed: 409 TARGET_CHANGED, nothing runs, the bot says why" |
| 16b | /bloquear com IA fora do ar | A/telegram-lockdown.test.ts › "works with the AI down and reading locked: sessions end, routines with AI wait, the alert goes out" |
| 16b | Login no bloqueio: 2FA recusado, recuperação aceita | A/auth-lockdown.test.ts › "takes no passkey nor the app's code, costs no try for them, and a recovery code signs in and ends it" |
| 16b | Rebloqueio em 24 h suspende o vínculo | A/telegram-lockdown.test.ts › "a second /bloquear within 24 hours of leaving, from the same link, suspends the link; …"; A/auth-lockdown.test.ts › "is a second lockdown from the same link within 24 hours of leaving; …" |
| 16b | Tokens suspensos voltam ao sair | A/auth-lockdown.test.ts › "suspends them once on entering, and brings them back once on leaving, …"; A/remote-routes.test.ts › "a lockdown suspends the tokens and leaving it brings them back" |
| 16b | Alerta do bot não se reconhece pelo bot | A/telegram-lockdown.test.ts › "are not acknowledged through the bot, and in the app only with the password typed recently"; A/telegram-alerts.test.ts › "a security alert the bot caused gets no buttons …"; E/lockdown.spec.ts › "a security alert the bot caused is confirmed in the app; …" |
| 16b | Comandos de segurança | A/telegram-lockdown.test.ts › "/acessos lists …"; "/sessoes lists …"; "/encerrar_sessoes works …"; "/tokens …"; "works with reading locked and pauses only the routines with AI" |
| 16b | Tela Sair do bloqueio | E/lockdown.spec.ts › "the app opens on Sair do bloqueio, asks for the code and opens again once out"; "without two-step sign-in it is one tap; Não fui eu unlinks Telegram, …" |
| 17 | Desligada = idêntico | A/semantic.test.ts › "creates no table or trigger, calls no model and answers searches exactly as before"; A/semantic-routes.test.ts › "off: answers empty without calling any model" |
| 17 | "carro" acha "automóvel" | A/semantic.test.ts › "creates the tables and triggers, prepares what exists and finds “carro” …"; A/semantic-routes.test.ts › "on: finds “carro” in the memory about an “automóvel”, …"; E/semantic.spec.ts › "on: the palette finds “carro” …" |
| 17 | Lotes de 50, teto diário | A/semantic.test.ts › "prepares in batches of 50, one call each"; "stops at the daily limit of texts and starts again the next UTC day" |
| 17 | Ligar cria as tabelas; reindexar | A/semantic.test.ts › "reindex makes every vector again while the old ones keep answering"; A/semantic-routes.test.ts › "reindex: 409 while off, the full pass again while on" |
| 18a | Fetch protegido (origem, DNS, sem redirect, tamanho) | A/mcp-units.test.ts › "takes only https on a public host, …"; "asks DNS over HTTPS for A and AAAA, with a deadline and no redirect"; "refuses a declared length over the cap without reading it"; A/mcp-routes.test.ts › "refuses a host whose DNS answers a private address, and a redirect" |
| 18a | 35 s | A/mcp-units.test.ts › "keeps a body to 35 s as the spec says (a call to 30 s), and the default deadline is that one"; "cuts a body that trickles past the deadline" |
| 18a | Credencial cifrada | A/mcp-routes.test.ts › "keeps a bearer token sealed: sent to the server, never shown, never stored in the clear" |
| 18a | Ferramentas desligadas por padrão | A/mcp-routes.test.ts › "adds a server, connects it and lists its tools, all off and asking first" |
| 18a | Troca de URL zera confiança e credencial | A/mcp-routes.test.ts › "a new address drops the token and the trust, alerts, and needs the recent password" |
| 18a | Máx. 10 ligadas e 6 oferecidas; find_tools | A/mcp-routes.test.ts › "caps the servers and the tools turned on"; A/mcp-chat.test.ts › "find_tools never takes the offer past six tools"; "offers only what the triage picks, and find_tools brings the rest for the next step" |
| 18a | Sessão fecha no fim do turno | A/mcp-chat.test.ts › "runs a tool set to run without asking, returns its answer as third-party data and closes the session" |
| 18b | OAuth (PKCE, registro dinâmico, state) | A/mcp-oauth.test.ts › "adding a server registers Zuri and prepares a sign-in page with PKCE, …"; "refuses a wrong, forged or expired state …"; "two callbacks at once redeem the code once"; E/integracoes.spec.ts › "signs in to a service with OAuth: …" |
| 19 | OAuth do dono, PKCE, state | A/google-routes.test.ts › "sends the owner to Google with PKCE, …"; "refuses a state used twice, an unknown one and one from another session"; "refuses a state past its 10 minutes" |
| 19 | Agendas fechada/só ler/ler e editar | A/google-routes.test.ts › "opens a calendar only with the password typed recently …"; "refuses writing where Google only lets read, …" |
| 19 | Ferramentas; apagar como proposta | A/calendar-tools.test.ts › "becomes a proposal labelled with Google's event; approving deletes it with its version"; A/google-hardening.test.ts › "an event with guests or organized by someone else changes only through a proposal …" |
| 19 | Rotinas 07:00 e 19:00 | E/automations.spec.ts › "the AI routine templates fill the form: the morning briefing and the end of the day" |
| 19 | /hoje com agenda | A/telegram-commands.test.ts › "/hoje: today's events of the open calendars, …" |
| 19 | Tela Agenda | E/google-agenda.spec.ts › "connects Google, opens calendars, and creates, edits and deletes an event in the Agenda; …"; W/agenda.test.ts |
| 19b | Só contatos das etiquetas escolhidas | A/google-contacts.test.ts › "copies only the contacts of the chosen labels, …"; "with no label chosen copies nothing and never reads the contacts" |
| 19b | syncToken vencido → leitura completa | A/google-contacts.test.ts › "reads everything again when Google says the sync token expired, in the same wake" |
| 19b | Nenhum dado de contato em log | A/google-contacts.test.ts › "skips a contact out of shape, counting it without its content, …" (parcial) |
| 19b | Nenhum dado de contato em backup | A/backup.test.ts › "never carries a Google contact nor a review, whatever is stored (steps 19b and 19c)" |
| 19b | Desconectar revoga e apaga | A/google-contacts.test.ts › "disconnecting Google revokes the token and forgets the copy"; A/google-contacts-routes.test.ts › "turning off forgets the copy; disconnecting Google revokes the access and forgets it too" |
| 19b | Teto 5.000 | A/google-contacts.test.ts › "keeps at most 5,000 contacts: 5,000 fit, the 5,001st stops the sync …" |
| 19b | Ferramentas `search_contacts`/`get_contact` em `<data>` | A/google-contacts.test.ts › "answer 'what is Ana's phone?' as contact data, with a stranger's note inert" |
| 19c | 1–3 estrelas nunca sem o dono | A/reviews-rules.test.ts › "sends 1 to 3 stars and an unrated review to the team, whatever the text"; A/reviews-autonomy.test.ts › "never publishes a negative, a suspicious or a mixed review, …" |
| 19c | Avisa a equipe mesmo sem cota de IA | A/reviews-service.test.ts › "tells the team of a negative review at once, even with the AI down, …"; "stops asking the AI once the day's Neurons are spent" |
| 19c | Avaliação maliciosa não muda comportamento | A/reviews-service.test.ts › "keeps a malicious review's text as data in the prompt, and the agent has no tools"; A/reviews-findings.test.ts › "reaches the agent only inside its one <data> line, …" |
| 19c | Nenhuma resposta duas vezes | A/reviews-service.test.ts › "publishes the approved text after reading the review again"; "two approvals at the same time (the screen and the bot) publish once: …" |
| 19c | Nunca por cima da resposta de outra pessoa | A/reviews-service.test.ts › "never answers over a reply someone made at Google meanwhile"; "marks a review someone already answered at Google, and never drafts it" |
| 19c | Avaliação fora de log | A/reviews-service.test.ts › "never logs a reviewer's name or text" |
| 19c | Avaliação fora de backup | A/backup.test.ts › "never carries a Google contact nor a review, whatever is stored (steps 19b and 19c)" |
| 19c | Tela Avaliações | E/avaliacoes.spec.ts; E/a11y.spec.ts › "the Reviews tab, off, has no serious violation (${scheme})" |
| 19d | Só 4–5 estrelas aprovadas pelo verificador | A/reviews-autonomy.test.ts › "publishes a positive review whose draft passed both checks, …"; "never publishes a negative, a suspicious or a mixed review, …" |
| 19d | Depois do período de experiência (10 sem edição) | A/reviews-autonomy.test.ts › "unlocks at 10 approvals unchanged among the last 30, not at 9, …" |
| 19d | Com senha recente e alerta | A/reviews-routes.test.ts › "unlocks publishing by itself only after the trial, with the password typed recently and a security alert (step 19d)" |
| 19d | Até 10/dia | A/reviews-autonomy.test.ts › "publishes at most 10 a day: the 11th waits for the owner, …"; "starts the day over at midnight in the owner's zone, not in UTC" |
| 19d | Disjuntor volta a "Perguntar sempre" | A/reviews-autonomy.test.ts › "goes back to asking after 3 failed drafts in a row, not after 2 and a good one"; "goes back to asking when Google refuses a reply, …"; "goes back to asking when the owner deletes a reply of Zuri's on the screen" |
| 20 | Token `read` = 403 em toda rota de escrita | A/remote-routes.test.ts › "no token reaches the forbidden areas, read gets 403 on every write, and only the allowed routes run" |
| 20 | Nenhum token alcança rotas proibidas (percorre todas) | A/remote-routes.test.ts › (o mesmo) + "matches the path as it came: encoded, doubled or trailing slashes are refused, …" |
| 20 | 90 dias, só hash | A/remote-routes.test.ts › "turns remote access on with the password typed recently, makes a token shown once and keeps only its HMAC"; "answers 401 to a token that is wrong, malformed, expired or suspended, …" |
| 20 | Eventos 60/h, 100/dia, metade do canal | A/remote-events.test.ts › "takes 60 an hour (n-1, n, n+1) and 100 a day, with Retry-After"; "uses at most half of each channel's limit, …" |
| 20 | Cartão em Segurança | E/acesso-remoto.spec.ts › "turns remote access on, makes an events token shown once, …" |
| 21 | Só modelos com preço conhecido | A/ai-paid.test.ts › "has a dated price for every paid id, …"; A/ai-routes.test.ts › "takes only chat models of the list: no mock, no paid provider, no other text" |
| 21 | Fallback antes de responder | A/ai-fallback.test.ts › "hands a busy model's request to the fallback before anything is shown, …"; "does not switch once the answer has started: no answer twice" |
| 21 | Teto em US$ (opcional) | A/ai-paid.test.ts › "with a ceiling, allows the call that lands exactly on it and refuses the one that would pass it (n−1, n, n+1)"; A/ai-routes.test.ts › "asks for the password again before the US$ ceiling changes, and never for a free model" |
| 21 | Escolher modelo pago pede senha recente | A/ai-routes.test.ts › "asks for the password again before a paid model is picked, as the main or the reserve one, and saves nothing then (n-1, n)"; E/ai-settings.spec.ts › "a paid model: the warning on what leaves comes before the save, …" |
| 21 | D3–D7 (nunca enviar, histórico curto, marcadores) | A/ai-external.test.ts › "empties the text of a line marked local, …"; "sends the last messages only, …"; "hides the values on the way out and gives them back …" |
| 22a | Até 20 fluxos, 20 passos, 40 chamadas, 200 itens, 500/dia, 3.000 Neurons | A/flows-service.test.ts › "keeps at most 20 flows"; S/flows.test.ts › "needs 1 to 20 steps (0, 1, 20, 21)"; A/flows-service.test.ts › "makes 40 calls in a run at most, across wakes"; "stops at 200 items"; "runs 500 times a day at most, …"; "counts the Neurons in the run and stops at the flows' 3,000 of the day" |
| 22a | Intervalo mín. 15 min / 1 h com IA | S/flows.test.ts › "runs at most every 15 minutes (14, 15)"; "runs at most hourly with an AI step (59, 60)"; A/flows-routes.test.ts › "refuses an interval under 15 minutes and a body past 64 KB" |
| 22a | Subrequisições por despertar | A/flows-edges.test.ts › "refuses a call past the wake's subrequests before the DNS check"; A/wake-budget.test.ts |
| 22a | Conexões: senha recente, DELETE proibido, credencial nunca volta | A/flows-routes.test.ts › "adds a connection with the password, tells the owner and never answers the credential"; "refuses a dangerous header, a line break in the credential and DELETE"; A/flows-security.test.ts › "never leave the server: …" |
| 22a | Mudar origem/tipo apaga credencial e alerta | A/flows-security.test.ts › "are dropped when the origin or the kind changes, and on request"; A/flows-routes.test.ts › "changes a connection with the password and tells the owner; …" |
| 22a | Fetch: DNS, sem redirect, 10 s, 256 KB | A/flows-security.test.ts › "never reaches a host whose name points inside a network"; A/flows-service.test.ts › "stops at once on a 4xx, a redirect or a body past 256 KB"; A/flows-edges.test.ts › "hands its time limit to the request, and names it a timeout when it runs out" |
| 22a | Fluxo nasce desligado; ligar com senha | A/flows-service.test.ts › "creates a flow off, …"; A/flows-routes.test.ts › "turns on only with the password, and off without it" |
| 22a | Nenhuma ferramenta/comando/token mexe em fluxos | A/flows-security.test.ts › "no tool of the agent touches flows, …"; "no bot command touches them either"; A/remote-routes.test.ts (percorre as rotas) |
| 22a | Monitor: 10 endereços, sem host próprio, query 200 | A/flows-service.test.ts › "watches 10 sites at most, all monitors together, and never Zuri's own host"; S/flows.test.ts › "limits the query to 200 characters (199, 200, 201)" |
| 22a | Monitor: 64 KB, só status/tempo, 3 tentativas, aviso queda/volta | A/flows-monitor.test.ts › "reads at most 64 KB of a page and stops"; "looks at each site with a plain GET, …, and keeps only status and time"; "tries a failing site 3 times (now, +1 min, +5 min) before it counts as down, then tells the owner once" |
| 22a | 5 falhas desligam e avisam | A/flows-service.test.ts › "turns a flow off after 5 failures in a row and tells the owner" |
| 22a | Bloqueio: nada roda, 423 | A/flows-service.test.ts › "runs nothing during a lockdown: …"; A/flows-routes.test.ts › "answers 423 to every flow route during a lockdown" |
| 22a | IA recebe `<data source="flow">` | A/flows-service.test.ts › "sends the items as data and the owner's instruction as the system's, with no tools" |
| 22a | /status com sites e fluxos | A/flows-monitor.test.ts › "puts the sites and the failing flows in the bot's summary"; A/telegram-commands.test.ts › "/status unlocked: …" |
| 22b | Funil 2 a 12 etapas | S/crm.test.ts › "the funnel: 2 to 12 stages, names up to 40, no two alike in any case" |
| 22b | 5.000 clientes, 200 etiquetas, 20 por cliente | A/crm-service.test.ts › "refuses the 5,001st client and the 201st distinct tag"; "refuses more than 20 tags on one client and an unknown stage" |
| 22b | Histórico 100 | A/crm-service.test.ts › "keeps the newest 100 history lines of a client" |
| 22b | Avisos (10 retornos por despertar, aniversário 9 h, 20 novos/dia) | A/crm-service.test.ts › "tells at most 10 follow-ups in one wake, the rest in one notice"; "tells the day's birthdays at 9 h in the owner's zone, …"; "keeps 9 h across a daylight-saving change, …"; "tells up to 20 new clients from n8n a day, and none while off" |
| 22b | Eventos: HMAC, ±5 min, 16 KB, 300/h 1.000/dia, ids repetidos | A/crm-events.test.ts › "checks the time window at its edges"; "refuses anything but POST, a malformed key and a body over 16 KB"; "holds to 300 an hour and 1,000 a day, with Retry-After"; "applies a repeated event id once" |
| 22b | Ligar/trocar segredo com senha e alerta | A/crm-routes.test.ts › "turns the events on only with the password typed recently, tells the owner, shows the secret once" |
| 22b | Ferramentas: nenhuma apaga/mexe no funil | A/crm-tools.test.ts › "no tool deletes a client, edits the funnel, turns the events on or messages anyone" |
| 22b | `<data source="crm">`, telefone só quando pedido, nada em log | A/crm-tools.test.ts › "finds clients as data, without phone and e-mail unless asked, …"; A/crm-events.test.ts › "never writes a client's name, phone or text to the log, …" |
| 22b | `propose_flow` só sugestão; salvar com senha, nasce desligado | A/crm-tools.test.ts › "is offered only in the chat and leaves only a suggestion"; A/crm-routes.test.ts › "turns a suggestion into a flow only when the owner saves it with the password; it starts off …" |
| 22b | flow_drafts até 5, 7 dias | A/flows-service.test.ts › "keeps the 5 newest (n, n+1: the oldest goes) and each one for 7 days to the millisecond" |
| 22b | Tela Clientes | E/clientes.spec.ts › "adds a client, notes, moves and deletes it on the Clients tab; accessible"; "turns n8n's events on, shows the secret once, and a signed event brings a client" |
| 22c | Ler a agenda (janela −30..+365, 1..31 dias, 500 chars) | S/flows.test.ts › "bounds the read's start (−31, −30, 365, 366) and its days (0, 1, 31, 32)"; A/flows-google.test.ts › "cuts a long description to 500 characters and filters by text" |
| 22c | Criar evento: 10 por execução, sem convidados, chave única, data inválida para antes | A/flows-google.test.ts › "creates 10 events in a run at most, and none when there are more"; "creates one event per item with nobody invited or told, …"; "never makes a second event for the same key, even in another run"; "creates nothing when one item's date isn't a date" |
| 22c | 5 a 1.440 min | S/flows.test.ts › "bounds an event's length (4, 5, 1440, 1441) and needs a calendar" |
| 22c | Buscar contatos só na cópia local | A/flows-google.test.ts › "lists the copy by label or birthday, with no call to Google"; S/flows.test.ts › "bounds a contacts search (0, 1, 100, 101) …" |
| 22c | Nenhum passo muda ou apaga evento | A/flows-google.test.ts › "refuses a calendar open only for reading, and never changes or deletes an event" |
| 22c | Chamadas contam nas 40 e no despertar | A/flows-google.test.ts › "counts every Google call in the wake's one count"; "waits a minute, calling nothing, when the wake has no room for every calendar" |
| 22c | Listas do editor | A/flows-google.test.ts › "lists the open calendars and the chosen labels, and nothing while Google is off"; E/fluxos-google.spec.ts |
| 23 | Backup malicioso recusado inteiro (automação, MCP, 11 MB, 10.001 memórias) | A/backup.test.ts › "refuses ${name}" (describe "a malicious backup is refused whole, writing nothing"); "refuses 10,001 memories and takes 10,000"; "refuses a file over 10 MB before the object reads it, and takes one of exactly 10 MB" |
| 23 | Exportação versionada sem segredos | A/backup.test.ts › "writes the versioned format with the last migration and every section"; "never carries a secret, a session, a credential nor the server's own state" |
| 23 | Importação não confiável (nada ligado) | A/backup.test.ts › "gives every record a new id, marks memories and messages as imported, and turns nothing on" |
| 23 | Backup automático: 7 cópias, cifrado, partes | A/backup-auto.test.ts › "keeps the newest ${BACKUP_COPIES_KEPT}: the 8th copy deletes the 1st"; "uploads one sealed copy that opens with the key …"; "uploads a big copy in parts …" |
| 23 | Cópia mensal no Telegram; aviso 30 dias; /backup | A/backup-auto.test.ts › "sends the month's first copy that works, once a month, only to the owner's chat, …"; "warns once the last backup taken out is more than 30 days old (the 31st day), …"; "answers /backup with the age, the last copy, or why it is off" |
| 23 | Restaurar no navegador com a chave privada | S/backup-file.test.ts › "opens with its key what was sealed, …"; E/backup.spec.ts › "creates the backup key once and restores a sealed copy in the browser; accessible" |
| 24 | Deploy falha com workers_dev/preview_urls ligados | R/deploy.test.ts › "fails when the workers.dev address still serves a page"; "fails closed when the API does not answer"; "deploys the generated config, then fails on workers.dev, previews or an unhealthy version" |
| 24 | Só Custom Domain | R/deploy.test.ts › "serves only the Custom Domain, with workers.dev and preview URLs off" |
| 24 | Ambiente production só na main; token só no job | R/deploy.test.ts › "runs only on a push to main or by hand, never on a pull request"; "gives the Cloudflare secrets only to the deploy job, through the production environment" |
| 26a | Lint de microcopy sem exceção sem comentário | R/microcopy-lint.test.ts › "finds nothing left in the shipped catalogs once the exceptions of i18n-ignore.json apply, …"; "fails on a stale, malformed or unexplained exception" |
| 26a | Glossário, "com sucesso", "!", infraestrutura | R/microcopy-lint.test.ts › "catches the banned phrases in pt-BR"; "catches each word of the glossary's avoid column, …"; "allows one '!' in the greeting only"; "catches infrastructure names on the screens" |
| 26a | Toast sem ponto | R/microcopy-lint.test.ts › "wants a one-sentence toast without a full stop, …" |
| 26a | Inventário | R/inventario-de-textos.test.ts › "has one row per key, …"; "lists the keys whose text changed, was added or was removed, and nothing else" |
| 26b | Diálogo com X no canto, Esc, foco no 1º campo | E/dialogs.spec.ts › "a dialog closes from the X in the corner or with Esc, and opens on its first field"; "the X stays in view while a long dialog scrolls" |
| 26b | Painel com X (avisos, gaveta) | E/notices.spec.ts › "a reminder's run reaches the bell: …" (X no canto); E/sidebar.spec.ts › "on a phone the sidebar is a drawer …" |
| 26b | Toast com X | E/toasts.spec.ts › "a saved setting confirms with a toast that holds while hovered and then leaves" |
| 26b | Confirmação repete o verbo e foca Cancelar | E/backup.spec.ts › "shows the storage use, downloads a backup and imports one with a confirmation; …"; E/chat.spec.ts (confirm, linha 228); E/acesso-remoto.spec.ts › "turns remote access on, …" (no lugar, `group` com a pergunta) |
| 26c | Menu "Mais opções" (⋯) | E/actions-menu.spec.ts › "the row menu floats over the list, keeps Apagar last and answers the keyboard" |
| 26c | IA dividida: "Uso da IA" (/configuracoes/ia) e "Modelos e limites" (/configuracoes/modelos) | E/shell.spec.ts › "settings has the eight sections, …"; E/a11y.spec.ts › "sign-in, home, settings and dialogs have no serious violation (${scheme})" (ia e modelos, claro e escuro); E/csp.spec.ts › "no page breaks the Content Security Policy"; E/ai-settings.spec.ts › "the model and the limits: …"; "the usage card warns near and at the limit, …"; E/shell.spec.ts confere que "Uso de hoje" não está em Modelos e o seletor de modelo não está em Uso da IA |
| 26c | "Nova memória" em diálogo | E/memory.spec.ts › "memories: save, duplicate, …" (abre/cancela o diálogo); "memory: search, empty filter, the conflict review switch and keyboard only" (foco no diálogo) |
| 26c | Lixeira filtrada `?tipo=tarefas`, no topo de Dados, sem Esvaziar, Ver tudo | E/productivity.spec.ts › "a task: create with a deadline and a project, edit, complete, delete and restore" (a11y "lixeira filtrada") |
| 26c | Lixeira filtrada `?tipo=notas`, contagem do próprio tipo, `tipo` desconhecido | E/productivity.spec.ts › "a task: create with a deadline and a project, edit, complete, delete and restore"; A/productivity-routes.test.ts › "counts the trash of one kind when asked by kind: …" |
| 26c | Configurações no celular com o título da seção | E/shell.spec.ts › "settings has the eight sections, …" (ramo celular) |
| 26c | Um só "Nova nota" | E/productivity.spec.ts › "a note: write Markdown, …" |
| 26c | Avisos na ordem de configurar; Conta sem "Sair deste aparelho"; Dados em 2 colunas; abas de Tarefas rolam; um só "Nova conversa" na Conversa | Só capturas da PR #232 (baixo, na lista da auditoria) |
| 26c | Confirmações no lugar em `group` com a pergunta | E/acesso-remoto.spec.ts (revogar); passkey, agenda, cliente e reindexar só nas capturas (baixo, na lista da auditoria) |
| Transv. | Toda rota com sessão bloqueada pela troca de senha | A/auth-password-route.test.ts › "blocks every registered signed-in route but the four allowed, without running it" |
| Transv. | Corpos hostis | A/http-hardening.test.ts (todo); A/body-read.test.ts (todo) |
| Transv. | Sessão em várias abas | E/session-background.spec.ts (3 testes) |
| Transv. | XSS no conteúdo do dono | W/markdown.test.tsx |
| Transv. | Orçamento do plano Free | A/free-tier-budget.test.ts; A/wake-budget.test.ts |
| 25 | Auditoria completa do repositório (A1 a A13), com correção dos altos e médios | ver o relatório; cada correção tem o seu teste `SEC-…` (A/automations, A/mcp-chat, A/reviews-rules, A/chat-external, A/auth-sessions, A/migrations) |
| 25 | E2E de todas as telas | E/csp.spec.ts › "no page breaks the Content Security Policy" (confere que toda rota do `App.tsx` está na lista e abre cada uma); E/a11y.spec.ts › "the Agenda and Contacts screens have no serious violation (${scheme})" e os demais do arquivo |
| 25 | Estados do cartão do Telegram | E/telegram.spec.ts › "Settings > Avisos: the Telegram card says when the bot isn't set up, when the link is suspended and when updates don't arrive" |
| 25 | Webhook do Telegram com atualizações reais gravadas, sem token real | A/telegram-replay.test.ts › "gives every update its outcome, answers 200 to each, and keeps third-party words and the account's ids out of the prompt" (27 atualizações em `fixtures/telegram/gravadas.json`) |
| 25 | D10: canário em todas as origens | A/prompt-canary.test.ts (conversa, rotina, fluxo); A/prompt-canary-origins.test.ts › "lets no credential reach a model from MCP, the calendar, the contacts, the CRM or the remote tokens, on the account's model or an external one"; A/telegram-replay.test.ts (Telegram); A/reviews-findings.test.ts › SEC-A6-03 (avaliações) |
| 25 | Diagnóstico nomeia toda tela | A/diagnostics.test.ts › "keeps only the screen of a path the interface sends: the page, a settings tab, the rest as 'id'" (lê `App.tsx` e `SETTINGS_TABS`) |
