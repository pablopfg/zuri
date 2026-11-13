# Varreduras de segurança

Pedido do Pablo (13/11/2026): segurança é prioridade, e estas ferramentas e
skills entram em todo o trabalho, na CI e no fluxo das etapas. Elas se somam ao
que já existia (CodeQL, `npm audit`, Dependabot, o pentest de
[pentest.md](pentest.md) e a skill de auditoria da Cloudflare). Nenhuma delas
substitui o teste que prova a correção.

## O que roda e onde

| Ferramenta | O que procura | Onde roda | Custo |
| --- | --- | --- | --- |
| **Semgrep** (CE, `semgrep/semgrep`) | Padrões inseguros no código: injeção, XSS, regex que trava (ReDoS), segredo no código, workflow do GitHub vulnerável | Check exigido `semgrep` do `ci.yml`, em todo PR e push na `develop`; local com `bash scripts/seguranca/semgrep.sh` | Grátis, sem conta e sem métricas (`--metrics=off`) |
| **Gitleaks** (`gitleaks/gitleaks`) | Chaves, tokens e senhas em **todo o histórico** do Git | Check exigido `gitleaks` do `ci.yml`; local com `bash scripts/seguranca/gitleaks.sh` | Grátis, sem conta |
| **SonarQube Cloud** | Qualidade, bugs, "security hotspots" e cobertura de testes | Workflow `SonarQube` (`.github/workflows/sonarqube.yml`) em todo PR e push na `develop` | Grátis no plano para código aberto (repositório público com licença MIT). ⚠️ Conta no SonarQube Cloud e o segredo `SONAR_TOKEN` |
| **Strix** (`usestrix/strix`) | Pentest com agentes de IA contra o sistema rodando | Só no pentest que o Pablo autorizar, contra o Zuri local | ⚠️ Gasta créditos de IA a cada rodada |
| `trailofbits/differential-review` | Revisão de segurança do diff do PR: histórico, raio de impacto, testes que faltam | Skill `auditoria-seguranca`, em todo PR com código | Só tokens da sessão |
| `trailofbits/sharp-edges` | Interfaces que facilitam o erro (opção perigosa por padrão, parâmetro fácil de trocar) | Skill `auditoria-seguranca`, quando o PR cria ou muda uma API, um schema, uma configuração ou uma ferramenta do agente | Só tokens da sessão |
| `trailofbits/insecure-defaults` | Configuração insegura por padrão: segredo de reserva, credencial padrão, falha aberta, cripto fraca, acesso amplo, depuração exposta | Skill `auditoria-seguranca`: no escopo do diff em todo PR com código e no repositório inteiro no passe completo | Só tokens da sessão (vários subagentes) |
| `cloudflare-security-audit:security-audit` | Auditoria em fases com validação independente | Já existia: modo orientação em toda etapa, completo nas etapas 3, 4, 12, 16, 18, 20 e 25 | Só tokens da sessão |

As três skills da Trail of Bits estão fixadas por commit no catálogo
`.claude/skills-externas/` (veja [skills-externas.md](../agente/skills-externas.md)).
A "Security Audit Skill" da Cloudflare do pedido é a
`cloudflare-security-audit:security-audit`, instalada desde a etapa 0.

## Semgrep

- **Regras:** só as pastas `security` de `javascript`, `typescript`, `generic` e
  `yaml/github-actions`, mais `package_managers/npm`, do repositório
  `semgrep/semgrep-rules` num commit fixado em `scripts/seguranca/semgrep.sh`.
  As regras de estilo e correção das mesmas pastas repetem o que o Biome e o
  TypeScript já conferem. A licença das regras (Semgrep Rules License v1.0)
  permite o uso interno; elas não são copiadas para o repositório.
- **Versão:** a CI roda a imagem `semgrep/semgrep` fixada por digest (1.185.0).
  Local: `pip install semgrep==1.185.0`. O script avisa quando a versão local é
  outra.
- **Pastas fora:** o Semgrep pula sozinho o que o `.gitignore` e o
  `.semgrepignore` padrão deixam de fora (`node_modules`, `dist`, pastas de
  teste).
- **Falso positivo:** marque na linha de cima, com o motivo, e nunca em lote:

  ```ts
  // nosemgrep: detect-non-literal-regexp -- day, month and year are digits, built by readDate
  ```

  O motivo é conferível no código ao lado. "Não é problema" não é motivo.
- **Atualizar as regras:** troque o commit no script num PR próprio, rode o
  script e trate cada achado novo (correção ou marcação com motivo).

## Gitleaks

- Varre todos os commits, não só os do PR: uma chave apagada num commit
  seguinte continua pública no histórico.
- O binário é a release 8.30.0, conferida pelo SHA-256 antes de rodar.
- `.gitleaks.toml` estende as regras padrão e libera só valores **exatos** de
  teste (canários, exemplos das RFCs 6455 e 8291, a chave VAPID de teste
  publicada). Nunca libere por pasta: uma chave real colada num teste tem que
  falhar. Valor de teste novo entra na lista com a origem dele.
- O relatório esconde o segredo (`--redact`).
- **Achou uma chave real:** trate como incidente. Revogue a chave no serviço
  dela primeiro (apagar do Git não basta) e só então avise o Pablo, sem colar o
  valor em lugar nenhum.

## SonarQube Cloud

Escolha do Pablo (13/11/2026): análise pela CI com token, no plano grátis para
código aberto. O workflow `SonarQube` é o único de PR que lê um segredo, e só
no passo da análise. O GitHub não entrega segredos a PRs de fork nem do
Dependabot: nelas o job avisa e termina verde, sem análise.

O que o Pablo faz uma vez, pelo navegador:

1. Em [sonarcloud.io](https://sonarcloud.io), **Log in with GitHub**, crie a
   organização a partir da conta `pablopfg` (plano **Free**) e importe o
   repositório Zuri. Confira que a chave da organização é `pablopfg` e a do
   projeto é `pablopfg_Zuri`; se forem outras, troque em
   `sonar-project.properties`.
2. No projeto: **Administration → Analysis Method**, desligue
   **Automatic Analysis** (as duas juntas falham).
3. Em **My Account → Security**, gere um token só para esta análise e grave no
   GitHub em **Settings → Secrets and variables → Actions → New repository
   secret**, com o nome `SONAR_TOKEN`. Nunca cole o token no chat.

Depois das primeiras análises, o portão de qualidade ("Sonar way") é calibrado
e o check passa a ser exigido nas rulesets numa PR própria. Até lá, o agente lê
o resultado do SonarQube no PR durante a auditoria e trata o que for
segurança (vulnerabilidade ou hotspot confirmado) como achado.

## Strix

Escolha do Pablo (13/11/2026): só no pentest que ele autorizar.

- Nunca na CI e nunca contra produção. O alvo é o Zuri local
  (`npm run dev`, IA simulada, banco descartável) ou a pasta do código.
- Cada rodada pede o OK do Pablo antes, com a estimativa de custo ⚠️. A chave é
  a de teste (`ZURI_TESTE_ANTHROPIC_KEY`, só Haiku 5.5, teto de US$ 5), passada
  por variável de ambiente, nunca em arquivo nem no chat.
- Telemetria desligada (`STRIX_TELEMETRY=0`): o Strix manda eventos para fora
  por padrão.
- Precisa de Docker (a primeira rodada baixa a imagem do sandbox). Os
  resultados ficam em `strix_runs/`, fora do repositório; ao PR vão só os
  achados confirmados, no formato de [pentest.md](pentest.md).

## Ordem no fim de cada ajuste

Na skill `auditoria-seguranca`, depois do pentest da funcionalidade:

1. `bash scripts/seguranca/semgrep.sh` e `bash scripts/seguranca/gitleaks.sh`
   (os mesmos checks da CI, antes do push).
2. `/differential-review:diff-review` sobre `origin/develop...HEAD`, com o
   relatório fora do repositório.
3. `sharp-edges` quando o diff cria ou muda uma interface.
4. `/insecure-defaults:audit` nas pastas que o diff toca; no passe completo, no
   repositório inteiro.
5. Resultado do SonarQube no PR, quando a análise rodou.

Achado confirmado vira correção com teste (id `SEC-<área>-<nn>` no nome).
Achado de segurança fora do escopo nunca vira issue pública (o repositório é
público, veja "Divulgação" em [pentest.md](pentest.md)): vai ao Pablo na
thread. O que não é de segurança (bug, qualidade apontada pelo SonarQube) e
fica fora do escopo vira issue pelo modelo `erro`.

## Primeira rodada (13/11/2026)

- **Gitleaks:** 9 avisos em todo o histórico, todos valores de teste (listados
  em `.gitleaks.toml`). Nenhuma chave real.
- **Semgrep:** 22 avisos. Um real, de gravidade média, corrigido: **SEC-A13-06**, os padrões do
  verificador de contatos (`apps/agent/src/specialists/checker.ts`) recomeçavam
  de cada letra num texto hostil, e 60 mil caracteres de texto de terceiro
  (item de fluxo, resultado de ferramenta) levavam 70 s de CPU. Agora são
  lineares, com teste. Os outros 21 são falsos positivos, marcados linha a
  linha com o motivo.
