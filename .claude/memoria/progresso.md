# Progresso das etapas

Passagem de bastão entre conversas. Cada etapa começa numa conversa nova e lê
este arquivo **em vez** do histórico das anteriores. Atualize no mesmo PR da
etapa, antes de mesclar. Mantenha curto (até ~80 linhas): só as 3 últimas
etapas ficam detalhadas; as mais antigas viram uma linha na tabela.

## Modo contínuo

- Situação: ligado
- Avanço: mescla sozinho na `develop`, sem pausa por fase (decisão do Pablo, 30/10/2026)
- Pausado por:

## Etapas

| Etapa | Situação | PR | Resumo em uma linha |
| --- | --- | --- | --- |
| 0 | mesclada (31/10/2026) | #1 | Monorepo, CI, CodeQL, rulesets, Dependabot |
| 1 | mesclada (31/10/2026) | #6 | Worker único, Durable Object `ZuriAgent` e os seis portões |
| 2 | mesclada (31/10/2026) | #7 | Migration 1, configurações (idioma e fuso), erros no idioma do dono, lint de i18n |
| 3 | mesclada (31/10/2026) | #8 | Login, sessões, CSRF, força bruta, Turnstile adaptativo, atividade de acesso |
| 4 | mesclada (31/10/2026) | #9 | 2FA TOTP, códigos de recuperação, desafio em cookie, passkeys reutilizáveis |
| 5 | mesclada (31/10/2026) | #10 | Casca da interface: login com 2FA, guarda de sessão, configurações, PWA (fecha a fase A) |
| 6 | mesclada (31/10/2026) | #12 | Tarefas, notas (Markdown, FTS5), projetos, lixeira de 30 dias, limites por tipo |
| 7 | mesclada (31/10/2026) | #21 | Memória com estados atual/incerta/passada, substituição sem ciclos, fila de revisão, recordação em `<data>` |
| 8 | mesclada (31/10/2026) | #25 | Provedor Workers AI e IA simulada, medição por passo, teto de 9.000 Neurons/dia, aba IA |
| 9 | mesclada (31/10/2026) | #28 | Conversa em SSE, 20 ferramentas com permissão e limite, aprovações e planos, voz, injeção de prompt testada |
| 10 | mesclada (02/11/2026) | #46 | Automações: lembretes, resumo das tarefas e rotinas com IA, alarme único, recuperação após reinício, aprovação das rotinas do chat |
| 11 | mesclada (02/11/2026) | #55, #56, #63, #64 | Central de avisos, Diagnóstico, notificação no aparelho, e-mail e recuperação de senha, prioridade que aprende |
| 12 | mesclada (02/11/2026) | #70 | Fundação do bot do Telegram: cliente da Bot API, webhook com travas, vínculo por código confirmado no app, cartão em Configurações › Avisos |
| 13 | mesclada (02/11/2026) | #73 | Avisos no Telegram: canal da central, discreto com "Texto completo", botões Feito/Adiar/Silenciar/Abrir, grupo opcional com tópicos |
| 14 | mesclada (02/11/2026) | #75 | Conversa e voz no Telegram: conversa do app pelo bot, HTML em blocos, voz até 5 min/5 MB, pergunta antes de baixar arquivo grande, terceiros como `<data>` |
| 15a | mesclada (02/11/2026) | #84 | Trava de leitura do bot com `/destravar` (passkey na página `/aprovar` ou código por e-mail), `/nova_conversa`, 60 comandos/hora |
| 15b | mesclada (02/11/2026) | #89 | Comandos rápidos sem IA (`/hoje`, `/tarefas`, `/nova`, `/feito`, `/lembrar`, `/nota`, `/buscar`, `/memoria`, `/rotinas`, `/avisos`, `/uso`, `/status`, `/backup`), gramática de datas, fotos e documentos viram nota, botão Destravar |
| 16a | mesclada (02/11/2026) | #93 | Aprovações pelo bot: botão **Aprovar** com prévia do servidor, `/aprovar`, confirmação por passkey ou e-mail presa à proposta e ao hash, `TARGET_CHANGED`, alerta `telegram_approved` |
| 16b | mesclada (02/11/2026) | #96 | Comandos de segurança (`/acessos`, `/sessoes`, `/encerrar_sessoes`, `/tokens`, `/pausar_rotinas`, `/bloquear`), modo de bloqueio com a tela **Sair do bloqueio**, rebloqueio que suspende o vínculo, **Confirmar que vi** no app |
| 17 | mesclada (02/11/2026) | #99 | Busca por significado opcional: vetores `bge-m3` em `int8` no SQLite do objeto, fila por gatilhos, preparo no alarme único com tetos diários, busca híbrida na paleta, na recordação, na ferramenta `search` e no `/buscar` |
| 18a | mesclada (03/11/2026) | #105 | Servidores MCP remotos (sem login ou token fixo): fetch protegido contra SSRF, token cifrado, catálogo revisado pelo dono, triagem por turno com `find_tools`, cartão com os dados exatos, tela Configurações › Integrações |
| 18b | mesclada (03/11/2026) | #111 | Login OAuth nos servidores MCP (PKCE, registro dinâmico, botão **Entrar no serviço**), triagem das ferramentas pelo significado, aprovação de chamadas externas pelo bot e pela página `/aprovar` |
| 19 | mesclada (03/11/2026) | #136 | Google Agenda: OAuth próprio do dono, agendas fechada/só ler/ler e editar, 5 ferramentas (apagar e mudar evento com convidados são propostas), `/hoje` com agenda, modelos de rotina, tela **Agenda** (dia, semana, mês) em tempo real por push do Google |
| 19b | mesclada (03/11/2026) | #144 | Google Contatos: cópia só leitura das etiquetas escolhidas (até 5.000, de hora em hora com `syncToken`), tela **Contatos**, avisos de aniversário e datas especiais, `search_contacts` e `get_contact` |
| 19c | mesclada (04/11/2026) | #169 | Avaliações do Google: leitura a cada 15 min (até 3 perfis), triagem fixa pela nota, aviso das negativas no tópico "Avaliações", agente de avaliações sem ferramentas, conferência fixa e segunda leitura, publicação só com aprovação na tela e releitura antes, aba **Avaliações** em Contatos |
| 19d | mesclada (04/11/2026) | #174 | Avaliações do Google publicadas sozinha: nível **Publica sozinha as positivas** depois de 10 aprovações sem edição nas últimas 30 (senha e alerta), só 4 e 5 estrelas aprovadas nas duas conferências, 3 por leitura e 10 por dia, pausa no pico, disjuntor, aba **Publicadas sozinha** |
| 22a | mesclada (03/11/2026) | #153 | Motor de fluxos no alarme único (7 passos de catálogo fechado), conexões com métodos marcados e credencial cifrada, monitor de sites como modelo, aba **Fluxos** em Automações, `/status` com os sites |
| 22b | mesclada (03/11/2026) | #161 | CRM interno na aba **Clientes** de Contatos (funil editável, etiquetas, retorno, aniversário, histórico), avisos do CRM, eventos do n8n assinados com HMAC, 5 ferramentas do CRM, sugestões de fluxo da conversa na aba Fluxos |
| 22c | mesclada (04/11/2026) | #180 | Passos **Ler a agenda**, **Criar evento** (sem convidados, até 10 por execução, chave contra repetição) e **Buscar contatos** (cópia local) nos fluxos; Google simulado segue o dia de São Paulo (#178) |
| 20 | mesclada (04/11/2026) | #184 | Acesso remoto: tokens `zur_pat_` com escopo (só ler, ler e escrever, só eventos), 90 dias, só HMAC no banco, lista fechada de rotas com teste que percorre todas, `POST /api/remote/events` para a central (60/h, 100/dia, metade do canal), cartão em Configurações › Segurança, **Revogar** em `/tokens` |
| 21 | mesclada (09/11/2026) | #194 | ⚠️ Modelos pagos opcionais (Claude e GPT), tudo desligado, teto em US$ opcional e desligado, perfil externo D3–D7 ("Nunca enviar para fora", histórico curto, marcadores), estado das empresas, consumo por período ao vivo |
| 23 | mesclada (09/11/2026) | #200, #211 | Backup manual (**Baixar backup**, **Importar backup**, uso do armazenamento) e ⚠️ backup automático no R2 opcional: cópia diária cifrada com a chave do dono (só a pública no servidor), 7 cópias, restauração no navegador, cópia mensal no Telegram, aviso de 30 dias, `/backup` com a idade |
| 24 | mesclada (09/11/2026) | #215 | Deploy pelo GitHub Actions na `main` (CI inteira de novo, aprovação no ambiente `production`, só o Custom Domain, conferência do `workers.dev` e das prévias pela API, saúde e HTTPS, release da versão) e guia de instalação só pelo navegador |
| 26a | mesclada (09/11/2026) | #221 | Textos revistos pelo glossário (Apagar, Desconectar, Ligar/Desligar, Entrar, Rotina da Zuri), erros com o que fazer, toasts sem ponto, lint de microcopy na CI, inventário `scripts/inventario-de-textos.ts` |
| 26b | mesclada (09/11/2026) | #227 | `Dialog` com X fixo no canto (último no DOM, foco segue no primeiro campo), fim dos "Fechar" em texto, confirmações com Cancelar antes e focado (também as que abrem no lugar), faixa das duas etapas com X "Dispensar por 3 dias" |
| 26c | mesclada (09/11/2026) | #232 | Menu "Mais opções" (`ActionsMenu`) em Automações, Fluxos, Memória e Integrações; Configurações no celular com o título da seção; Avisos na ordem de configurar; Conta sem "Sair deste aparelho"; Dados em duas colunas e Tarefas com abas que rolam no celular; um só "Nova conversa" no computador; confirmações no lugar em `fieldset` com a pergunta |
| 25 | em revisão (09/11/2026) | — | Auditoria final do repositório inteiro (6 médios e 2 baixos corrigidos, nenhum alto), canário em todas as origens (D10), webhook do Telegram com 27 atualizações gravadas, e2e de todas as telas, matriz final em `docs/qa/matriz-final.md`, migration 31 (`zur_messages.local_only`) |

## Últimas etapas (detalhe)

### Etapa 25 · Auditoria final e testes de ponta a ponta
- Entregou: relatório `docs/qa/auditorias/2026-11-09-etapa-25.md`, matriz `docs/qa/matriz-final.md`, `apps/agent/test/telegram-replay.test.ts` (fixture `fixtures/telegram/gravadas.json`), `prompt-canary-origins.test.ts` (D10), CSP em toda rota de `App.tsx`, a11y de Agenda e Contatos.
- Correções: SEC-A13-03 (automação ilegível pausa), SEC-A7-02 (agenda, contatos e Telegram travam ferramentas externas), SEC-A6-05 (trava de contato das avaliações), SEC-A6-06 (resposta e resumo com item local marcados), SEC-A3-02 (token remoto após redefinir a senha), lixeira filtrada no servidor, SEC-A2-06 (busca longa do CRM).
- Migrations: 31 (`zur_messages.local_only`). A próxima livre é a 32.
- Baixos abertos com recomendação no relatório: SEC-A13-04, SEC-A1-02, SEC-A13-05, SEC-A6-07 (backup não leva `local_only`), QA-11 a QA-13, DOC-01.

### Etapa 26a · Textos revistos e lint de microcopy
- Entregou: `scripts/lint-microcopy.ts` (dentro do lint de i18n: glossário, "com sucesso", "Ops", "Por favor", travessão, "...", "!" fora de `web.greeting.*`, nomes de infraestrutura; exceções por chave e regra em `i18n-ignore.json` › `microcopy`, com motivo, e exceção velha falha), `scripts/inventario-de-textos.ts` (inventário completo ou `--mudancas <ref>`), 156 chaves reescritas em pt-BR e en (lista em `docs/qa/revisao-de-textos/26a-catalogo.md`), revisão das 173 chaves `error.*` em `docs/qa/revisao-de-textos/26a-erros.md`, `TELEGRAM_MENU_VERSION` 6 (descrição de `/pausar_rotinas` mudou).
- Migrations: nenhuma. A próxima livre continua a 31.
- Decisões técnicas: conta (Telegram, Google) se **Desconecta**; ligação sem perda de dado (passkey, aparelho, servidor) se **Remove**; "ativa" como adjetivo fica, o verbo vira Ligar; os modelos de resposta das avaliações (voz do negócio do dono) e as instruções de painel da Cloudflare são exceções comentadas.
- 26c (PR em revisão): inventário em `docs/qa/revisao-de-textos/26c-inventario.md` (14 itens). As três mudanças grandes (dividir a aba IA, "Nova memória" em diálogo, lixeira filtrada pelo tipo) foram aprovadas pelo Pablo em 09/11 e entraram na mesma PR (#232).
- 26b (mesclada, #227): `Dialog` com X por padrão, confirmação que repete o verbo e foca Cancelar e faixa dispensável; o menu ⋯ passou para a 26c. Antes, a lista era: tirar os "Fechar" em texto de `MemoryPage.tsx`, `ProjectsDialog.tsx` e `pages/productivity/shared.tsx`. A 26c faz a reorganização que o inventário apontar (mudança grande de navegação é pergunta ao Pablo).

### Etapa 24 · Deploy e guia de instalação
- Entregou: `.github/workflows/deploy.yml` (push na `main` ou à mão: `ci` chama o `ci.yml` inteiro por `workflow_call`, `web` monta a interface sem segredo, `deploy` no ambiente `production` com `npm ci --ignore-scripts`, `release` com `contents: write`), `scripts/deploy/gerar-config.ts` (escreve `apps/agent/wrangler.deploy.json`, ignorado pelo Git, a partir de `ZURI_DOMAIN`, `ZURI_ALERT_EMAIL_TO` e `ZURI_BACKUP_BUCKET`, todos segredos do ambiente `production`, nunca *variables*, que saem em texto puro no log), `scripts/deploy/conferir-producao.ts` (`enderecos`: API `workers/scripts/zuri/subdomain`, falha fechada; `saude`: `/api/health` 200 ou login do Access, `http://` → `https://`; `mascarar`: nome da conta antes do wrangler), `scripts/deploy/publicar-release.ts` (pré-release vira release *Latest*; `releaseNotes(..., published)`). O `build` da CI gera a config com valores de exemplo e roda `wrangler deploy --dry-run`. Docs: `docs/instalacao-cloudflare.md`, `docs/solucao-de-problemas.md`, seção "Deploy" em `docs/seguranca.md`, "Release na `main`" em `docs/agente/versionamento.md`. Plano: `docs/planos/etapa-24-deploy.md`.
- Migrations: nenhuma. A próxima livre continua a 31.
- Decisões técnicas: o Worker `zuri` é criado vazio no painel antes do 1º deploy (o wrangler recusa Worker novo sem os `secrets.required`); `PUBLIC_URL`, Access e Turnstile seguem como segredos do Worker; token sem R2 (o wrangler tolera a falta de permissão e não cria bucket); com o Access, exceções Bypass para `api/telegram/webhook`, `api/google/push` e `api/crm/events/*`, e a conferência aceita o redirecionamento ao login do Access.
- Para as próximas: o Pablo cria o token, o ambiente e o Worker vazio, e abre a PR `develop → main` quando quiser o 1º deploy (a 1.0.0 é decisão dele).

## Exigências de QA (desde 31/10/2026)

- Toda etapa cumpre os "Portões obrigatórios" e as "Exigências por área" de `docs/qa/estrategia-de-testes.md`. A CI tem pisos de cobertura (`npm run test:coverage`) e o check `lighthouse`.

## Esperando o Pablo

<!-- Itens "▶ Antes, você fornece" das próximas etapas e perguntas abertas. -->

- Feito na etapa 8: teto único de 9.000 Neurons/dia. Não trava: busca de tarefas por FTS5. Ver `docs/arquitetura/orcamento-free-tier.md`, "Para o Pablo".
- Toda etapa segue `.claude/rules/performance.md` (P1 a P14) e preenche "Custo no plano Free" no PR.

- ⚠️ Antes do próximo deploy: criar o widget do Turnstile e gravar `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` (docs/configuracao-cloudflare.md); sem eles o login fica fechado.
- Não travam: perguntas abertas da etapa 4 (senha digitada de novo para ligar 2FA/passkey; resolvido: alerta repetido e teto de 30 erros em 24 h), da etapa 3 (acerto não zera falhas).
- Rulesets da `develop` e da `main` conferidos ativos pela API em 31/10/2026.
- Etapas 19c e 19d (avaliações do Google): plano aprovado em 03/11/2026 (`docs/planos/google-business-profile.md`). O Pablo confirmou em 03/11/2026 que ligou as APIs do Business Profile e pediu o "Basic API Access" ao Google.

## Próxima etapa

- Todas as etapas da especificação (0 a 26) estão feitas com a 25. Não há etapa seguinte.
- O que falta é do Pablo: o primeiro deploy (abrir a PR `develop → main`; a 1.0.0 é decisão dele), os segredos e cartões listados na etapa 24, e as decisões abertas (resposta uniforme da rota de recuperação e do webhook, os baixos da auditoria).
- Próxima migration livre: 36 (a 35 é da PR S11 do novo frontend: o índice `zur_reviews_metrics` da visão geral das avaliações; a 34 guarda as configurações do CRM e dos fluxos). Há PRs em paralelo: confira o fim de `MIGRATIONS` na `develop` antes de criar.
- Depois do deploy, para usar um modelo pago: o Pablo cadastra `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` como segredo do Worker.
