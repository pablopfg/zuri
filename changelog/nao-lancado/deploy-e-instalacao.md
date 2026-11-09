<!-- versao: minor -->
### Adicionado

- **Deploy pelo GitHub Actions**: cada merge na `main` roda a CI inteira de
  novo no commit dela, espera a sua aprovação no ambiente `production` e
  publica o Worker só no seu domínio (Custom Domain). Também dá para publicar
  de novo à mão, em **Actions › Deploy › Run workflow**.
- Depois de publicar, o deploy confere pela API da Cloudflare que o
  `workers.dev` e as URLs de prévia estão desligados, confere de fora que o
  `workers.dev` não responde, que `http://` leva a `https://` e que a Zuri
  responde em `/api/health`. Se algo falhar, a execução fica vermelha.
- Com o deploy verde, a pré-release da versão vira release, marcada como a
  mais nova, com o changelog em pt-BR.
- O binding `SEND_EMAIL` sai da variável `ZURI_ALERT_EMAIL_TO` e o
  `BACKUP_BUCKET` (R2 ⚠️, opcional) sai de `ZURI_BACKUP_BUCKET`, as duas no
  ambiente `production`; o domínio sai de `ZURI_DOMAIN`.
- `docs/instalacao-cloudflare.md`: instalação do zero só pelo navegador, do
  domínio ao primeiro login, com o token de permissões mínimas, o bot no
  @BotFather e as exceções do Cloudflare Access para o webhook do Telegram, os
  avisos do Google e os eventos do CRM.
- `docs/solucao-de-problemas.md`: como achar no Workers Logs a linha de um erro
  pelo código e pela referência que a aba Diagnóstico mostra, o que fazer em
  cada falha do deploy e como voltar para a versão anterior.

### Segurança

- O token da Cloudflare fica só no ambiente `production`, que aceita só a
  `main`. Os jobs que instalam e rodam o código do projeto não têm segredo, e o
  job do deploy instala sem scripts e sem cache. Domínio, e-mail e bucket são
  mascarados no log público, e toda ação continua fixada por SHA.
- Cada PR gera a configuração do deploy com valores de exemplo e roda
  `wrangler deploy --dry-run`, sem credencial nenhuma.

### Atualização

- Para o primeiro deploy: crie o Worker `zuri` vazio no painel, grave os
  segredos obrigatórios, o token da Cloudflare (Workers Scripts: editar,
  Account Settings: ler, Workers Routes: editar na zona e, com e-mail, Email
  Routing Addresses: ler) e a variável `ZURI_DOMAIN` no ambiente `production`,
  como explica `docs/instalacao-cloudflare.md`. Nenhuma migration.
