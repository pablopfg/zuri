---
name: auditoria-seguranca
description: Auditoria de segurança obrigatória ao terminar qualquer ajuste no Zuri - pentest do próprio sistema (ataca o que mudou, corrige e prova) e revisão independente. Use depois da revisão de QA e antes de abrir ou mesclar o PR, e no passe completo de fim de fase.
---

# Auditoria de segurança ao fim de cada ajuste

Nenhum ajuste está pronto antes desta auditoria. Ela é um pentest do próprio
sistema: o procedimento, os atacantes (T1 a T8), as áreas (A1 a A13), o
catálogo de ataques e a gravidade estão em `docs/qa/pentest.md`. Leia esse
arquivo antes de começar.

Modo: **passe da funcionalidade** em todo PR que muda código que roda;
**passe completo** (todas as áreas, um `auditor-seguranca` por grupo, até 6)
no fim de cada fase, nas etapas abaixo, antes do primeiro deploy e a pedido.
PR só de docs: escreva "Sem superfície nova: pentest dispensado" (os checks `semgrep` e `gitleaks` rodam mesmo assim na CI).

Pentest com o **Strix** (IA, gasta créditos ⚠️): só quando o Pablo autorizar aquela rodada, contra o Zuri local, nunca produção, com `STRIX_TELEMETRY=0` e a chave de teste por variável de ambiente (`docs/qa/varreduras-de-seguranca.md`).

1. **Contexto e superfície.** Leia as "Regras de segurança" e as seções da especificação ligadas ao que mudou, e `git diff origin/develop...HEAD`. Cruze os arquivos com o "Mapa de áreas" e liste o que é novo (rotas, ferramentas, comandos, tabelas, segredos, chamadas de rede, telas).
2. **Atacar.** Para cada item novo, escolha os atacantes que o alcançam e escreva cada ataque plausível como teste (catálogo da área como ponto de partida). Teste vermelho é achado: id `SEC-<área>-<nn>` e gravidade pela tabela do `docs/qa/pentest.md`. Achado crítico, alto ou médio: pare e chame o Pablo, sem publicar o passo a passo (seção "Divulgação").
3. **Revisão independente.** Peça ao subagente `auditor-seguranca` que audite as áreas tocadas (um por área, até 3), passando só o escopo (branch e áreas), nunca as suas conclusões. Confirme no código cada achado dele antes de aceitar.
4. **Cloudflare.** Se tocar Workers, Durable Objects, Workflows, Workers AI, wrangler ou limites, peça também ao `revisor-cloudflare` e use as skills do plugin `cloudflare`.
5. **Skill de auditoria da Cloudflare** (`cloudflare-security-audit:security-audit`):
   - **toda etapa, modo orientação:** aplique as classes de ataque que tocam o diff (em especial `AI-AND-LLM`, `WEB-PROTOCOL-AND-AUTH`, `PROTOCOLS-RPC-AND-MESSAGING`, `RESOURCE-EXHAUSTION-AND-AVAILABILITY` e `CLOUD-AND-DEPLOYMENT`), sem criar arquivos;
   - **etapas 3, 4, 12, 16, 18, 20 e 25, auditoria completa:** peça explicitamente o modo completo, com a pasta de saída fora do repositório (padrão da skill). Leve ao PR só o resumo e os achados confirmados; nada de `findings.json` no repositório.
6. **Skills da Trail of Bits** (fixadas em `.claude/skills-externas/`; quando e como: `docs/qa/varreduras-de-seguranca.md`):
   - **todo PR com código:** `/differential-review:diff-review` sobre `origin/develop...HEAD`, com o relatório numa pasta fora do repositório;
   - **interface nova ou mudada** (rota, schema, configuração, ferramenta do agente, função exportada de `packages/shared`): `sharp-edges` nos arquivos dela;
   - **todo PR com código:** `/insecure-defaults:audit <pasta>` em cada pasta de código que o diff toca; no passe completo, no repositório inteiro.
   Cada achado delas é conferido no código antes de entrar no PR, como os do `auditor-seguranca`.
7. **Comandos nativos.** Rode `/security-review` quando disponível.
8. **Varreduras** (as mesmas da CI, antes do push): `bash scripts/seguranca/semgrep.sh` (Semgrep, `pip install semgrep==1.185.0`) e `bash scripts/seguranca/gitleaks.sh` (Gitleaks, todo o histórico). Nenhum achado aberto: corrija, ou marque falso positivo na linha de cima com `// nosemgrep: <regra> -- <motivo conferível>` (Semgrep) ou com o valor exato de teste em `.gitleaks.toml` (Gitleaks). Chave real achada: revogue primeiro e chame o Pablo. Quando o workflow `SonarQube` rodou no PR, leia o resultado e trate vulnerabilidade ou hotspot confirmado como achado.
9. **Varredura rápida** (lista completa em `docs/qa/pentest.md`):
   - `git diff origin/develop...HEAD | grep -nEi "(api[_-]?key|secret|token|password|senha|bearer)\s*[:=]"` → nenhum valor real;
   - nada de domínio, e-mail ou id real em arquivos versionados;
   - `npm audit --audit-level=high` sem vulnerabilidade nova.
10. **Corrija** cada achado confirmado, com teste que falhava antes (id do achado no nome do teste). Confirme o vermelho quebrando a correção de propósito e desfazendo.
   Controles que precisam de teste sempre que a etapa os toca: CSP sem violação (`csp.spec.ts`), XSS do conteúdo do dono, senha recente, cabeçalhos de IP forjados, corpo acima do limite em fluxo, rotas no teste de `app.routes`.
11. **Teste tudo** com a skill `verificar`.
12. **Registre** no PR (seção "Segurança"): áreas atacadas, atacantes, tentativas com o teste de cada uma, achados com id, gravidade, correção e prova do vermelho, riscos aceitos pelo Pablo. Passe completo: relatório em `docs/qa/auditorias/AAAA-MM-DD-<escopo>.md`. Ataque novo que provou valor entra no catálogo de `docs/qa/pentest.md`. Achado de segurança fora do escopo nunca vira issue pública (seção "Divulgação"): vai ao Pablo na thread. Achado das ferramentas que não é de segurança (bug, qualidade do SonarQube) e fica fora do escopo vira issue pelo modelo `erro`. Correção de vulnerabilidade entra no changelog em `### Segurança`.
