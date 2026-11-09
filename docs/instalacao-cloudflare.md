# Instalação na Cloudflare, passo a passo

Este guia leva a Zuri da conta vazia ao primeiro login, **só pelo navegador**:
nenhum terminal, nenhum programa para instalar. Tudo usa o plano gratuito da
Cloudflare e do GitHub. O único item que pede cartão é o backup automático no
R2 (⚠, opcional, parte 5).

Nada real entra no repositório, que é público. Os exemplos usam
`zuri.exemplo.com.br` e `exemplo.com.br`: troque pelo seu domínio só nas telas
da Cloudflare e do GitHub.

## Sumário

- [Como a Zuri roda na sua conta](#como-a-zuri-roda-na-sua-conta)
- [Antes de começar](#antes-de-começar)
- [Parte 1 · Cloudflare: conta, domínio e Worker](#parte-1--cloudflare-conta-domínio-e-worker)
- [Parte 2 · Token do deploy](#parte-2--token-do-deploy)
- [Parte 3 · GitHub: ambiente `production`](#parte-3--github-ambiente-production)
- [Parte 4 · Primeiro deploy e primeiro acesso](#parte-4--primeiro-deploy-e-primeiro-acesso)
- [Parte 5 · Recursos opcionais](#parte-5--recursos-opcionais)
- [Conferência final](#conferência-final)
- [Manutenção](#manutenção)
- [Referência: o que fica em cada lugar](#referência-o-que-fica-em-cada-lugar)

## Como a Zuri roda na sua conta

Um único Worker chamado `zuri` serve a interface e a API, e guarda tudo num
Durable Object com SQLite, na sua conta. Ele atende só no seu domínio
(Custom Domain): o endereço `*.workers.dev` e as URLs de prévia ficam
desligados, e o deploy falha se algum deles estiver ligado.

O deploy é feito pelo GitHub Actions (`.github/workflows/deploy.yml`) a cada
push na `main`, que só recebe a `develop` por PR:

1. roda a CI inteira de novo no commit da `main` (tipos, lint, testes, i18n,
   build, e2e, Lighthouse e `npm audit`, que bloqueia `high` e `critical`);
2. monta a interface, sem segredo nenhum;
3. espera a sua aprovação no ambiente `production`, o único que conhece o token
   da Cloudflare, e publica;
4. confere pela API da Cloudflare que `workers.dev` e as prévias estão
   desligados, que `http://` leva a `https://` e que `/api/health` responde;
5. transforma a pré-release da versão em release, com o changelog em pt-BR.

Os segredos do Worker (senhas, chaves, tokens de serviços) nunca passam pelo
GitHub: você grava no painel da Cloudflare e cada deploy os mantém.

## Antes de começar

- Uma conta no GitHub com o **fork** (ou cópia) do repositório da Zuri, e a
  [configuração do GitHub](configuracao-github.md) feita (branches, rulesets,
  Actions e proteções).
- Um **domínio próprio** que você controla. Ele vai para a Cloudflare na
  parte 1.
- Um **gerenciador de senhas** para gerar e guardar os valores aleatórios.
- O celular com um app autenticador (Google Authenticator, 1Password, Aegis…)
  para a verificação em duas etapas.

## Parte 1 · Cloudflare: conta, domínio e Worker

### 1. Conta

1. Crie a conta em <https://dash.cloudflare.com/sign-up> (plano Free).
2. Em **Perfil > Autenticação**, ligue a **verificação em duas etapas**. A
   conta da Cloudflare guarda tudo da Zuri: proteja-a como o seu e-mail.

### 2. Domínio

1. Em **Visão geral da conta > Adicionar um domínio**, digite
   `exemplo.com.br`, escolha o plano **Free** e siga a tela.
2. No site onde você comprou o domínio, troque os **nameservers** pelos dois
   que a Cloudflare mostrou. Espere o domínio ficar **Ativo** (de minutos a
   algumas horas; a Cloudflare manda um e-mail).
3. Escolha o endereço da Zuri, por exemplo `zuri.exemplo.com.br`. Ele **não
   pode** ter registro DNS ainda: o deploy cria o registro sozinho.

### 3. HTTPS no domínio

O Worker já manda tudo para HTTPS e envia HSTS, mas ligue também as proteções
da zona, que agem antes. No domínio, em **SSL/TLS**:

- **Visão geral > Modo de criptografia:** *Full (strict)*.
- **Certificados de borda > Sempre usar HTTPS:** ligado.
- **Certificados de borda > Versão mínima do TLS:** TLS 1.2.
- **Certificados de borda > TLS 1.3:** ligado.

Não ligue o HSTS da zona com *includeSubDomains* ou *Preload* se outros
subdomínios do seu domínio ainda usam HTTP.

### 4. Criar o Worker `zuri` vazio

O Worker precisa existir antes do primeiro deploy, porque os segredos
obrigatórios são gravados nele e o deploy recusa um Worker novo sem eles.

1. Em **Compute (Workers) > Workers e Pages > Criar > Worker**, escolha
   **Hello World**.
2. Nome: `zuri` (exatamente assim). Clique em **Implantar**.
3. Não ligue domínio nem rota aqui. O primeiro deploy troca esse código pela
   Zuri, liga o domínio próprio e desliga o `workers.dev`.

### 5. Segredos obrigatórios

Em **Workers e Pages > zuri > Configurações > Variáveis e segredos >
Adicionar**, crie cada um com o tipo **Secret** (nunca *Text*: o deploy
apaga variáveis de texto que não estão no código, mas mantém os segredos).

| Nome | O que gravar |
| --- | --- |
| `PUBLIC_URL` | `https://zuri.exemplo.com.br` (só a origem, sem barra no fim) |
| `SESSION_SECRET` | 48 caracteres aleatórios ou mais |
| `PASSWORD_PEPPER` | outros 48 caracteres aleatórios, diferentes do anterior |
| `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` | as chaves do widget (passo 6) |

O `SETUP_CODE` fica para a hora do primeiro acesso (parte 4). Guarde o
`PASSWORD_PEPPER` no gerenciador de senhas: trocá-lo depois apaga a senha e a
verificação em duas etapas. Detalhes e o que acontece quando falta cada um:
[configuracao-cloudflare.md](configuracao-cloudflare.md#segredos-obrigatórios).

### 6. Verificação contra robôs (Turnstile)

Sem ela, o login fica fechado. Siga
[configuracao-cloudflare.md › Criar o widget do Turnstile](configuracao-cloudflare.md#criar-o-widget-do-turnstile):
widget **Managed**, só o host da Zuri, pré-autorização desligada, e as duas
chaves gravadas como **Secret** no passo 5.

## Parte 2 · Token do deploy

O GitHub Actions publica com um token **da conta**, com o mínimo de poder.

1. Em **Gerenciar conta > Tokens de API da conta > Criar token** (token da
   conta, não *User API Tokens*), clique em **Criar token personalizado**.
2. Nome: `zuri-deploy`. Permissões, uma linha cada:

   | Tipo | Permissão | Nível | Para quê |
   | --- | --- | --- | --- |
   | Conta | Workers Scripts | Editar | Publicar o Worker e conferir o `workers.dev` |
   | Conta | Configurações da conta (Account Settings) | Ler | O wrangler lê a conta antes de publicar |
   | Zona | Workers Routes | Editar | Ligar o domínio próprio (Custom Domain) |
   | Conta | Email Routing Addresses | Ler | Só se for usar e-mail (parte 5) |

   Não acrescente R2, KV, D1, Pages, Tail nem DNS. Sem permissão no R2, o
   deploy também não consegue criar um bucket por engano.
3. **Recursos da conta:** *Incluir* → a sua conta.
4. **Recursos da zona:** *Incluir → Zona específica* → `exemplo.com.br`.
5. **Filtro de IP:** vazio (o GitHub Actions usa IPs que mudam).
6. **TTL:** uma data de fim, de 6 a 12 meses. Anote no gerenciador de senhas
   quando renovar.
7. **Continuar para o resumo > Criar token** e copie o token para o
   gerenciador de senhas. Ele aparece uma vez só; não cole em conversa nenhuma.
8. Copie também o **ID da conta**: em **Workers e Pages**, na coluna da
   direita, ou na URL do painel (`dash.cloudflare.com/<id da conta>/…`).

Se o primeiro deploy falhar com erro de permissão ao ligar o domínio
(`Custom Domain`), acrescente **Zona > DNS > Editar**, só nessa zona, e rode
o deploy de novo.

## Parte 3 · GitHub: ambiente `production`

No repositório, em **Settings > Environments > New environment**, nome
`production` (se ainda não existir, veja
[configuracao-github.md](configuracao-github.md#5-ambiente-production)):

- **Deployment branches and tags:** *Selected branches and tags* → só `main`.
- **Required reviewers:** você. Cada deploy espera o seu clique.
- **Prevent self-review:** desligado (senão você não aprova o próprio deploy).

Ainda no ambiente:

**Environment secrets** (nunca em *Repository secrets*):

| Nome | Valor |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | o token da parte 2 |
| `CLOUDFLARE_ACCOUNT_ID` | o ID da conta (32 caracteres) |

**Environment variables:**

| Nome | Obrigatória | Exemplo | Para quê |
| --- | --- | --- | --- |
| `ZURI_DOMAIN` | sim | `zuri.exemplo.com.br` | O domínio próprio, sem `https://` nem barra. O deploy liga só ele e desliga o `workers.dev` |
| `ZURI_ALERT_EMAIL_TO` | não | `voce@exemplo.com.br` | O seu e-mail verificado no Email Routing; gera o binding `SEND_EMAIL`, que só manda para ele |
| `ZURI_BACKUP_BUCKET` | não ⚠ | `zuri-backup` | O nome do bucket R2 do backup; gera o binding `BACKUP_BUCKET` |

O log do Actions é público: o deploy esconde esses três valores (`add-mask`)
antes de imprimir qualquer coisa, e as conferências mostram só códigos HTTP.

## Parte 4 · Primeiro deploy e primeiro acesso

### 7. Publicar

O deploy roda quando a `main` recebe a `develop`.

1. Em **Pull requests > New pull request**, escolha **base: `main`** e
   **compare: `develop`**. Título: `release: primeira versão` (o número 1.0.0
   é decisão sua, veja [versionamento.md](agente/versionamento.md)).
2. Espere todos os checks ficarem verdes e clique em **Create a merge commit**
   (a `main` aceita só merge commit).
3. Em **Actions > Deploy**, abra a execução. Depois da CI, o job `deploy`
   para em **Waiting**: clique em **Review deployments > production >
   Approve and deploy**.
4. O job publica, liga `zuri.exemplo.com.br` como Custom Domain e confere tudo.
   Um certificado novo pode levar alguns minutos: a conferência tenta seis
   vezes, cada vez com mais espera. Se ainda assim falhar, use **Re-run failed
   jobs**.

Para publicar de novo sem mudança de código (depois de trocar um segredo,
por exemplo): **Actions > Deploy > Run workflow**, branch `main`.

### 8. Primeiro acesso

1. Gere um código de 32 a 256 caracteres no gerenciador de senhas e grave como
   segredo `SETUP_CODE` (passo 5). Ele vale 1 hora e uma vez só.
2. Abra `https://zuri.exemplo.com.br`. A tela leva sozinha ao primeiro acesso:
   código, seus dados (e-mail, senha de 15 caracteres ou mais, idioma e fuso) e
   a verificação em duas etapas, que é obrigatória. Guarde os códigos de
   recuperação.
3. **Apague o `SETUP_CODE`** do painel. O Início lembra disso enquanto ele
   existir.

Passo a passo com os detalhes e a recuperação do acesso:
[configuracao-cloudflare.md › Primeiro acesso](configuracao-cloudflare.md#primeiro-acesso-com-o-código-de-instalação).

## Parte 5 · Recursos opcionais

Cada um é independente. Depois de gravar um segredo, faça um deploy (passo 7,
**Run workflow**) para o Worker ler o valor novo.

### Cloudflare Access na frente (recomendado)

Com o Access, ninguém chega nem à tela de login sem passar antes pelo seu
e-mail. É gratuito para até 50 pessoas.

1. Em **Zero Trust**, escolha um nome de equipe (o painel cria
   `<equipe>.cloudflareaccess.com`) e o plano **Free**.
2. **Access > Aplicativos > Adicionar > Self-hosted**: domínio
   `zuri.exemplo.com.br`, caminho vazio, duração da sessão de 24 h. Política
   **Allow** com **Emails** = o seu e-mail. Salve e copie o **AUD** do
   aplicativo (64 caracteres).
3. Três serviços de fora precisam passar sem o login do Access, porque cada um
   se prova de outro jeito, conferido pelo Worker antes de tudo. Para cada
   linha, crie **outro** aplicativo *Self-hosted* com o mesmo domínio, o caminho
   abaixo e uma política **Bypass** com **Everyone**:

   | Caminho | Quem chama | Como o Worker confere |
   | --- | --- | --- |
   | `api/telegram/webhook` | o Telegram (bot) | cabeçalho secreto derivado do `SESSION_SECRET`, só POST, sem cookie |
   | `api/google/push` | o Google (agenda em tempo real) | token do canal derivado do `SESSION_SECRET`, sem cookie |
   | `api/crm/events/*` | o n8n (eventos do CRM) | assinatura HMAC do corpo e do instante |

   O caminho mais específico vence: o resto da Zuri continua atrás do Access.
   Crie só os que você usa. O `/aprovar` do bot **não** ganha exceção.
4. Grave como **Secret** no Worker: `ACCESS_TEAM_DOMAIN`
   (`<equipe>.cloudflareaccess.com`) e `ACCESS_AUD` (o AUD). Os dois ou
   nenhum.
5. Rode o deploy. Numa janela anônima, `https://zuri.exemplo.com.br` deve
   pedir o seu e-mail antes de mostrar a Zuri.

Scripts e o n8n com tokens de acesso remoto também passam pelo Access, com um
*Service Token*: [acesso-remoto.md](acesso-remoto.md).

### Bot do Telegram

1. No Telegram, abra o **@BotFather** e mande `/newbot`. Nome de exibição:
   `Zuri`. Usuário: algo que termine em `bot`, como `zuri_exemplo_bot`. Ele
   responde com o token: copie direto para o gerenciador de senhas.
2. Ainda no BotFather, mande `/setjoingroups`, escolha o bot e **Disable**
   (até você usar o grupo de avisos).
3. Para descobrir o id numérico da sua conta, mande qualquer mensagem ao
   **@userinfobot**.
4. Grave como **Secret** no Worker: `TELEGRAM_BOT_TOKEN` e
   `TELEGRAM_ADMIN_ID`. Rode o deploy.
5. Com o Access ligado, crie a exceção `api/telegram/webhook` (seção acima).
6. Na Zuri, em **Configurações > Avisos**, toque em **Conectar** no cartão do
   Telegram, abra o link no celular e confirme a conta no app. O próprio
   Worker registra o webhook; nada a fazer no GitHub.

Trocou o token, o domínio ou o `SESSION_SECRET`? Toque em **Reconectar**.
Token vazou? `/revoke` no BotFather, grave o novo e reconecte. Mais em
[telegram.md](telegram.md).

### E-mail e "Esqueci minha senha"

1. No domínio, **Email > Email Routing**: ligue e verifique o seu e-mail
   pessoal como **endereço de destino**. Se o domínio já recebe e-mail em
   outro serviço, use um subdomínio para não perder as mensagens.
2. Grave como **Secret** `ALERT_EMAIL_FROM`, um endereço do domínio, como
   `zuri@exemplo.com.br`.
3. No GitHub, crie a variável `ZURI_ALERT_EMAIL_TO` (parte 3) com o e-mail
   verificado e acrescente a permissão **Email Routing Addresses: Ler** ao token.
4. Rode o deploy. Detalhes em
   [configuracao-cloudflare.md › E-mail](configuracao-cloudflare.md#e-mail-opcional).

### Notificação no aparelho

Precisa de um par de chaves VAPID gerado uma vez. Sem terminal: peça a alguém
de confiança para rodar `node scripts/gerar-chaves-vapid.ts`, ou rode no
Codespaces do seu fork (**Code > Codespaces > Create**, de graça nas horas do
plano). Grave `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` como **Secret**.
Detalhes em
[configuracao-cloudflare.md › Notificação no aparelho](configuracao-cloudflare.md#notificação-no-aparelho-opcional).

### Backup automático no R2 ⚠

Usa o R2, que o dono aprovou para o backup. Fica dentro da faixa grátis (10 GB
e 1 milhão de operações por mês; a Zuri faz umas 500), mas ligar o R2 pede um
cartão cadastrado.

1. Em **R2 Object Storage**, ligue o R2 e crie um bucket **privado**, como
   `zuri-backup`. Não ligue acesso público nem domínio para ele.
2. No GitHub, crie a variável `ZURI_BACKUP_BUCKET` com o nome do bucket e rode
   o deploy. Não crie o binding pelo painel: o deploy seguinte o tiraria.
3. Na Zuri, em **Configurações > Dados**, toque em **Criar chave do backup** e
   guarde o arquivo fora da Zuri. A primeira cópia sai na madrugada seguinte.

Se o bucket não existir, o deploy falha (o token não pode criar bucket).
Detalhes em [backup.md](backup.md).

### Serviços externos (MCP) e Google

- **MCP com token ou login:** grave `MCP_CREDENTIAL_KEY` (48 caracteres
  aleatórios) como **Secret**. [mcp.md](mcp.md).
- **Google Agenda, Contatos e Avaliações:** crie o cliente OAuth no Google
  Cloud seguindo [google-agenda.md](google-agenda.md), com o endereço de volta
  `https://zuri.exemplo.com.br/rest/oauth2-credential/callback`, e grave
  `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (mais o `MCP_CREDENTIAL_KEY`).
  Com o Access, crie a exceção `api/google/push`.

### Modelos pagos ⚠

Claude e GPT ficam desligados até você gravar `ANTHROPIC_API_KEY` ou
`OPENAI_API_KEY` e ligar na tela, com a senha. Geram cobrança na empresa do
modelo. [ia.md](ia.md).

### Proteção extra contra enxurrada

Uma regra de rate limiting do WAF (uma é grátis) segura robôs antes do Worker:
[configuracao-cloudflare.md](configuracao-cloudflare.md#proteção-extra-contra-enxurrada-opcional-e-gratuita).

## Conferência final

Cloudflare:

- [ ] Verificação em duas etapas ligada na conta.
- [ ] Domínio **Ativo**, SSL/TLS em *Full (strict)*, *Sempre usar HTTPS* e TLS 1.2 ou mais.
- [ ] **Workers e Pages > zuri > Configurações > Domínios e rotas**: só `zuri.exemplo.com.br`; `workers.dev` e **URLs de prévia** desligados.
- [ ] **Variáveis e segredos**: todos do tipo **Secret**, nenhum *Text*; o `SETUP_CODE` apagado.
- [ ] Nenhum D1, KV ou projeto Pages criado para a Zuri (R2 só se você ligou o backup).
- [ ] Token de API com data de fim anotada.

GitHub:

- [ ] `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` só no ambiente `production`; **Repository secrets** vazio.
- [ ] Ambiente `production` com *Required reviewers* e só a branch `main`.
- [ ] Rulesets `develop` e `main` ativos; secret scanning, push protection, CodeQL e Dependabot ligados.
- [ ] **Deployments** mostra `production` verde, e **Releases** mostra a versão como *Latest*.

Zuri:

- [ ] `http://zuri.exemplo.com.br` leva a `https://`.
- [ ] Login com senha, Turnstile e verificação em duas etapas; senha errada é recusada.
- [ ] **Configurações > Diagnóstico** mostra a versão da release e nenhuma falha.
- [ ] Backup baixado em **Configurações > Dados**.
- [ ] Com Access: uma janela anônima pede o e-mail antes de mostrar a Zuri.
- [ ] Com Telegram, e-mail e notificação no aparelho: o teste de cada canal chegou.

## Manutenção

| Quando | O quê |
| --- | --- |
| A cada release | Baixe o backup antes, se o changelog fala em migration. Aprove o deploy e confira a versão em **Configurações > Diagnóstico**. |
| Deploy ruim | **Workers e Pages > zuri > Implantações**: escolha a versão anterior e **Reverter**. Vale só para o código: migrations do banco não voltam. |
| Antes de o token vencer | Crie o novo, troque o segredo no ambiente `production`, rode o Deploy e só então apague o antigo. |
| Todo mês | **Acessos** na Zuri e a aba **Security** do GitHub (Dependabot, CodeQL e secret scanning). |
| Suspeita de vazamento | Token da Cloudflare: **Tokens de API da conta > Rolar** ou apague. Bot: `/revoke` no BotFather. Tokens remotos: **Revogar** em Acesso remoto. Senha: troque em Configurações > Segurança. |

Quando algo não funciona: [solucao-de-problemas.md](solucao-de-problemas.md).

## Referência: o que fica em cada lugar

**Ambiente `production` do GitHub:** os segredos `CLOUDFLARE_API_TOKEN` e
`CLOUDFLARE_ACCOUNT_ID`, e as variáveis `ZURI_DOMAIN` (obrigatória),
`ZURI_ALERT_EMAIL_TO` e `ZURI_BACKUP_BUCKET`.

**Segredos do Worker na Cloudflare** (sempre **Secret**, nunca no GitHub):

| Nome | Obrigatório | Parte |
| --- | --- | --- |
| `PUBLIC_URL`, `SESSION_SECRET`, `PASSWORD_PEPPER` | sim | 1 |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | sim | 1 |
| `SETUP_CODE` | só no primeiro acesso ou na recuperação | 4 |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | não (os dois ou nenhum) | 5 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_ID` | não | 5 |
| `ALERT_EMAIL_FROM` | não | 5 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | não | 5 |
| `MCP_CREDENTIAL_KEY` | não (MCP com token e Google) | 5 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | não | 5 |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` ⚠ | não | 5 |

O que cada um faz e as regras de formato: [arquitetura.md](arquitetura.md#configuração).
