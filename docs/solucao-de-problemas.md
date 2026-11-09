# Solução de problemas

O que fazer quando o deploy falha ou a Zuri mostra um erro. Os passos são todos
pelo navegador. Instalação do zero: [instalacao-cloudflare.md](instalacao-cloudflare.md).

## Achar no Workers Logs a linha de um erro

A aba **Configurações > Diagnóstico** guarda cada tipo de falha dos últimos 30
dias com o **código**, a **origem**, a **rota** e a **referência** da última
vez. A referência é o `cf-ray` do pedido (16 caracteres hexadecimais, às
vezes seguidos do data center, como `-GRU`). O servidor escreve cada linha de
log com os mesmos campos, então dá para ir de um ao outro.

1. Na Zuri, abra **Configurações > Diagnóstico** e anote, da falha que
   interessa, o **código** (por exemplo `INTERNAL_ERROR`) e a **referência**.
2. No painel da Cloudflare, abra **Workers e Pages > zuri > Logs** (a aba de
   observabilidade do Worker).
3. Escolha o período: o Workers Logs do plano Free guarda **3 dias**. Uma
   falha mais antiga só está no Diagnóstico.
4. Filtre de um destes jeitos:
   - pela referência: campo `requestId` **contém** os 16 primeiros caracteres
     (sem o `-GRU`), que é o mesmo pedido;
   - pelo código: campo `code` **igual** ao código, para ver todas as vezes;
   - pelo tipo: campo `event` (como `unhandled_error`, `tool_failed`,
     `telegram_send_failed`), para ver uma parte da Zuri.
5. Abra a linha. Ela tem só `level`, `event`, `code`, `route` (método e
   caminho, com ids trocados por `:id`), `requestId`, `error` (o **nome** do
   erro, nunca a mensagem) e, quando cabe, `secrets` (nomes de configurações
   que faltam), `tool`, `kind` e `count`. Nada do que você escreveu, nem e-mail,
   IP, token ou senha, entra no log: isso é conferido por teste.

A versão publicada aparece no Diagnóstico ("Versão da Zuri" e o "Código da
publicação"). Quando uma falha aparece pela primeira vez numa versão nova, a
central de avisos avisa: ela começou no último deploy. Veja [Voltar para a versão anterior](#voltar-para-a-versão-anterior).

Para relatar o problema, use **Relatar no GitHub** no próprio Diagnóstico: ele
abre o formulário já preenchido, e você confere antes de enviar.

## O deploy falhou

Abra **Actions > Deploy**, a execução vermelha, e o passo que falhou. O log é
público: ele mostra só códigos HTTP e nomes, e o domínio, o e-mail e o bucket
aparecem como `***`.

| Passo e mensagem | Causa provável | O que fazer |
| --- | --- | --- |
| Um job de `ci` | Um teste, o lint ou o `npm audit` falhou no commit da `main` | Corrija na `develop` por PR e mande para a `main` de novo. `npm audit` falha com alerta `high` ou `critical` numa dependência: atualize a dependência |
| *Write the deploy config*: `ZURI_DOMAIN is required` | Segredo faltando, criado como *variable* ou fora do ambiente | Crie em **Settings > Environments > production > Environment secrets** |
| *Write the deploy config*: `must be written without blanks around` | Espaço antes ou depois, ou letra maiúscula no domínio | Grave o valor de novo, exato e em minúsculas |
| *Write the deploy config*: `must be the host alone` | `https://`, barra, porta ou um endereço `workers.dev` | Só o host: `zuri.exemplo.com.br` |
| *Write the deploy config*: `ZURI_ALERT_EMAIL_TO` ou `ZURI_BACKUP_BUCKET` | Valor com espaço ou formato errado | E-mail simples; bucket com 3 a 63 letras minúsculas, números e hífens |
| *Deploy to Cloudflare*: `must be secrets of the production environment` | Segredo do GitHub faltando ou em *Repository secrets* | Grave `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` no ambiente `production` |
| *Deploy*: `Authentication error` ou código `10000` | Token errado, vencido ou sem permissão | Refaça o token ([instalação, parte 2](instalacao-cloudflare.md#parte-2--token-do-deploy)) e troque o segredo |
| *Deploy*: `The following required secrets have not been set` | O Worker `zuri` não existe, ou falta `SESSION_SECRET` ou `PASSWORD_PEPPER` | Crie o Worker vazio e grave os segredos ([instalação, passos 4 e 5](instalacao-cloudflare.md#4-criar-o-worker-zuri-vazio)) |
| *Deploy*: erro de permissão no Custom Domain | Falta permissão na zona | Acrescente **Zona > Workers Routes: Editar** e, se preciso, **Zona > DNS: Editar**, só nessa zona |
| *Deploy*: `Unable to fetch bindings, routes, or services metadata` | Depois de gravar um segredo no painel, o wrangler relê a config do Worker e uma leitura falhou | Use **Re-run failed jobs**; se repetir, confira as permissões do token |
| *Deploy*: erro de permissão no binding de e-mail | O token não lê os endereços do Email Routing | Acrescente **Conta > Email Routing Addresses: Ler** ao token |
| *Deploy*: bucket não encontrado | `ZURI_BACKUP_BUCKET` aponta para um bucket que não existe | Crie o bucket no R2 com esse nome, ou apague o segredo |
| *Check workers.dev…*: `workers.dev is on` ou `preview URLs are on` | Ligados pelo painel | **zuri > Configurações > Domínios e rotas**: desligue os dois e rode o Deploy |
| *Check workers.dev…*: `could not read the workers.dev setting` | O token não lê o Worker | Confira **Workers Scripts: Editar** na conta certa |
| *Check workers.dev…*: `still answers` | O `workers.dev` ainda serve o Worker | Desligue em **Domínios e rotas** e rode de novo |
| *Check HTTPS…*: `503: a Worker secret is missing` | Segredo faltando, curto ou mal formado | Veja [Erro 503](#erro-503-ou-falta-configurar) abaixo |
| *Check HTTPS…*: `/api/health did not answer 200` com HTTP 403 | `PUBLIC_URL` com outro host que não o `ZURI_DOMAIN`, ou o Access sem as variáveis certas | Veja [Erro 403](#erro-403-em-toda-página) |
| *Publish the release*: `version … is not written yet` | A `develop` foi para a `main` antes de a PR `chore(release)` mesclar | Espere a PR `chore(release)` mesclar na `develop`, mande para a `main` de novo e rode o Deploy |
| *Check HTTPS…*: `HTTP no answer` ou `525`/`526` | Certificado do domínio novo ainda sendo emitido, ou SSL fora de *Full (strict)* | Espere alguns minutos e use **Re-run failed jobs** |
| *Check HTTPS…*: `http:// must redirect to https://` | *Sempre usar HTTPS* desligado e algo na frente do Worker | Ligue **SSL/TLS > Certificados de borda > Sempre usar HTTPS** |
| *Publish the release*: `tag … is missing` | A `develop` mandada para a `main` ainda não tinha a versão | Espere o workflow **Versão** na `develop` terminar, mescle a PR `chore(release)` e mande de novo |
| O job `deploy` fica em *Waiting* | Ele espera a sua aprovação | **Review deployments > production > Approve and deploy** |

## A Zuri não abre

### Erro 503 ou "falta configurar"

1. Abra `https://zuri.exemplo.com.br/api/health` no navegador.
2. Em **Workers e Pages > zuri > Logs**, filtre `event` igual a
   `not_configured`. O campo `secrets` lista os **nomes** do que falta ou está
   errado (nunca os valores). As chaves do Turnstile aparecem primeiro: corrija
   e abra o `/api/health` de novo.
3. Grave ou corrija o segredo em **Variáveis e segredos** (sempre **Secret**).
   Regras de cada um: [arquitetura.md](arquitetura.md#configuração).

`PUBLIC_URL` ausente ou mal formado deixa até a interface em 503, sem log.

### Erro 403 em toda página

Duas causas:

- O endereço aberto não é o de `PUBLIC_URL` (código `HOST_NOT_ALLOWED`). A
  Zuri responde só no host dele: abra exatamente `https://zuri.exemplo.com.br`,
  e confira que o `PUBLIC_URL` tem o mesmo host do `ZURI_DOMAIN`.
- `ACCESS_TEAM_DOMAIN` e `ACCESS_AUD` gravados mas o Access ainda não
  funcionando (aplicativo apagado, AUD de outro aplicativo): o Worker recusa
  tudo. Confira o AUD em **Zero Trust > Access > Aplicativos**, ou apague os dois
segredos e rode o deploy até o Access estar pronto.

### O bot do Telegram não responde

- Com o Access ligado, falta a exceção `api/telegram/webhook`
  ([instalação, parte 5](instalacao-cloudflare.md#cloudflare-access-na-frente-recomendado)).
- Depois de trocar o token, o domínio ou o `SESSION_SECRET`, toque em
  **Reconectar** em **Configurações > Avisos**.
- No Workers Logs, filtre `event` igual a `telegram_update_failed` ou
  `telegram_send_failed`.

### Login fechado pela verificação contra robôs

As chaves do Turnstile faltam, são as de teste (recusadas em produção) ou o
host do widget não é o da Zuri. Veja
[configuracao-cloudflare.md › Turnstile](configuracao-cloudflare.md#criar-o-widget-do-turnstile).

### Todos foram desconectados e a verificação em duas etapas sumiu

O `PASSWORD_PEPPER` foi trocado. É a redefinição completa: grave um
`SETUP_CODE` novo e recupere o acesso
([configuracao-cloudflare.md › Recuperar o acesso](configuracao-cloudflare.md#recuperar-o-acesso)).

## Voltar para a versão anterior

1. **Workers e Pages > zuri > Implantações**: escolha a versão anterior e
   **Reverter**. É imediato.
2. Vale só para o código. Migrations do banco não voltam; uma versão antiga
   continua lendo o banco porque as migrations só acrescentam.
3. Corrija na `develop` por PR e mande para a `main`. O próximo deploy volta a
   publicar a versão nova.
