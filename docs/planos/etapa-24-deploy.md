# Plano · Etapa 24 · Deploy e guia de instalação

## 1. Resumo

Deploy do Worker único pelo GitHub Actions a cada push na `main`, com a CI
inteira antes, aprovação do dono no ambiente `production`, só o Custom Domain,
conferência pela API de que `workers.dev` e prévias estão desligados, saúde e
HTTPS, e release da versão. Guia de instalação só pelo navegador e guia de
solução de problemas. Nada é publicado por esta PR: o dono roda o primeiro
deploy quando quiser.

## 2. Contexto no sistema

- `ci.yml` já roda os 8 checks exigidos pelos rulesets; `versao.yml` cria tag e
  pré-release a cada merge na `develop`.
- O `wrangler.jsonc` não tem nada pessoal (`workers_dev: false`,
  `preview_urls: false`, `run_worker_first: true`, `secrets.required`). O
  domínio, o destino do e-mail e o bucket do backup não podem ir para o
  repositório público (regra 2).
- Os segredos do Worker (inclusive `PUBLIC_URL`, Access e Turnstile) já são
  documentados como **Secret** no painel (`docs/configuracao-cloudflare.md`).
- Referência: Talorys `deploy.yml` e `scripts/deploy/render-wrangler-config.mjs`.

## 3. Objetivo e critérios de aceite

| # | Critério (especificação, etapa 24 e "CI/CD") |
| --- | --- |
| C1 | Deploy só em push para a `main` (e à mão na `main`), ambiente `production` só para a `main` |
| C2 | Token e conta da Cloudflare só como segredos do ambiente; nenhum job de PR vê segredo |
| C3 | Os mesmos testes da CI antes do deploy, com `npm audit` bloqueando `high` |
| C4 | O deploy falha se `workers.dev` ou `preview_urls` estiverem ligados com domínio próprio (conferido pela API) |
| C5 | `SEND_EMAIL` com `destination_address` de `ZURI_ALERT_EMAIL_TO`; `BACKUP_BUCKET` de `ZURI_BACKUP_BUCKET` (repasse da 23b) |
| C6 | Actions fixadas por SHA, `permissions` mínimas |
| C7 | Release por tag com changelog em pt-BR |
| C8 | `docs/instalacao-cloudflare.md` só pelo navegador, com @BotFather e Bypass do Access para o webhook |
| C9 | `docs/solucao-de-problemas.md` liga o código do Diagnóstico à linha do Workers Logs |

## 4. Escopo

Dentro: `deploy.yml`, `workflow_call` no `ci.yml` e a conferência da config no
job `build`, três scripts em `scripts/deploy/`, testes em
`tests/repo/deploy.test.ts`, docs. Fora: qualquer deploy ou mudança na conta
(é do Pablo), a 1.0.0 (decisão do Pablo, etapa 25), mudança de código do Worker.

## 5. Como funciona para o Pablo

Uma vez: domínio na Cloudflare, Worker `zuri` vazio, segredos, token, ambiente
`production` com dois segredos e a variável `ZURI_DOMAIN`. Depois, a cada PR
`develop → main` mesclada: aprova o deploy em **Review deployments**. Tudo no
navegador (`docs/instalacao-cloudflare.md`). Sem texto novo na interface.

## 6. Regras e limites

- `ZURI_DOMAIN`: host com 2 rótulos ou mais, sem esquema, porta, caminho,
  curinga ou ponto final; `workers.dev` e `pages.dev` recusados.
- `ZURI_ALERT_EMAIL_TO`: endereço simples. `ZURI_BACKUP_BUCKET`: 3 a 63
  caracteres `[a-z0-9-]`, sem hífen nas pontas nem `--`.
- A config base não pode trazer `routes`, `route`, `send_email` nem
  `r2_buckets`: só as variáveis os definem.
- Saúde: até 6 tentativas (5, 10, 15, 20, 25 s); 200, ou redirecionamento ao
  login do Access (`*.cloudflareaccess.com`) com aviso.

## 7. Desenho técnico

| Arquivo | Papel |
| --- | --- |
| `.github/workflows/deploy.yml` | `ci` (reusa `ci.yml`) → `web` (build sem segredo, artefato) → `deploy` (`production`, máscara, `npm ci --ignore-scripts` sem cache, config, `wrangler deploy`, conferências) → `release` (`contents: write`) |
| `.github/workflows/ci.yml` | `workflow_call`; o `build` gera a config com valores de exemplo e roda `wrangler deploy --dry-run` |
| `scripts/deploy/gerar-config.ts` | `renderDeployConfig` puro + escrita de `apps/agent/wrangler.deploy.json` (ignorado pelo Git) |
| `scripts/deploy/conferir-producao.ts` | `checkAddresses` (API `workers/scripts/zuri/subdomain`, falha fechada; sonda o `workers.dev` com o subdomínio mascarado) e `checkHealth`; `fetch` injetável |
| `scripts/deploy/publicar-release.ts` | `planPublish` puro; `gh release edit --prerelease=false --latest` |
| `scripts/versao.ts`, `scripts/publicar-versao.ts` | `releaseNotes(..., published)`: o `versao.yml` respeita a release publicada |

Sem rota, banco, migration, ferramenta do agente ou agendamento.

## 8. Custo e cotas do plano Free

Nada muda nas cotas da Cloudflare em uso: o deploy é uma chamada à API por
publicação e um `GET /api/health` (1 requisição do Worker, sem Durable Object
quando falta configuração; com tudo pronto, 1 pedido ao objeto). GitHub Actions
é grátis em repositório público. R2 ⚠ só com a variável, já aprovado.

## 9. Segurança e privacidade

Ver "Deploy pelo GitHub Actions" em `docs/seguranca.md`. Pontos: sem
`pull_request` no deploy; jobs com código do projeto sem segredo; token só em
`env` do passo, enviado só a `api.cloudflare.com` (teste); valores da
instalação mascarados antes de qualquer saída; erros sem valores; falha fechada
quando a API não responde claro; token sem R2.

## 10. Testes

`tests/repo/deploy.test.ts` (config: domínio, e-mail, bucket nos limites,
campos proibidos na base, sem valor nas mensagens; conferências com `fetch`
falso: ligado, desligado, API com erro, corpo inválido, token só para a API,
`workers.dev` que ainda responde, saúde com tentativas, 503, Access,
redirecionamentos maliciosos; release; o workflow: gatilhos, ordem, permissões,
ambiente, máscara, `--ignore-scripts`, ausência de `continue-on-error`), mais
`tests/repo/workflows.test.ts` (todas as regras de workflow) e
`tests/repo/versao.test.ts` (notas publicadas).

## 11. Entrega

Uma PR para a `develop`. O primeiro deploy é do Pablo.

## 12. Riscos

- Permissões do token mudam de nome no painel: o guia indica a alternativa
  (DNS: editar) e o erro aparece claro no passo.
- O wrangler recusa Worker novo sem os segredos obrigatórios: o guia cria o
  Worker vazio antes.
- A conferência por fora do `workers.dev` depende de rede: falta de resposta
  conta como desligado; a fonte da verdade é a API.

## 13. Suposições

- `PUBLIC_URL` continua segredo do Worker (sem mudar instalações já feitas); o
  deploy confere que o domínio responde, o que falha se os dois divergirem.
- Nome do Worker fixo `zuri`, o mesmo do `wrangler.jsonc`.

## 14. Entrevista com o Pablo

Nenhuma decisão de produto nova. O que fica com ele: criar a conta, o token, o
ambiente e os segredos, e abrir a PR de release quando quiser.
