# Plano · Guardrails, especialistas e parâmetros da IA

Situação: aprovado em 04/11/2026 (respostas do Pablo ao estudo); PR 1 implementada
Origem: pedido do Pablo em 04/11/2026; estudo `docs/planos/guardrails-multiagentes-ia.md` (PR #170), seções 4 a 9 e 8.1
Dependências: etapa 20 mesclada (#184, migration 28). Nenhuma outra.

## 1. Resumo

A Zuri já tem as defesas principais (blocos `<data>`, contrato do prompt,
ferramentas com permissão), mas cada agente de IA monta o próprio prompt, a
conversa usa a temperatura padrão de cada modelo e "nunca diga que fez sem a
ferramenta" é só regra no prompt. Este plano padroniza todos os especialistas
num contrato único (prompt fixo de segurança + camada do dono, entrada em
`<data>`, saída validada, parâmetros por agente e versão do prompt), põe uma
conferência fixa das afirmações da conversa, um verificador fixo compartilhado,
a segunda leitura por IA nas chamadas externas que as rotinas fazem sozinhas, um
corpus de injeção e o script de avaliação com IA real. Depois, a tela de IA
passa a editar temperatura, `top_p`, máximo de tokens e a camada do dono do
prompt de cada agente, com senha, versões e "voltar". São duas PRs.

## 2. Contexto no sistema

- Prompt da conversa: `apps/agent/src/agent/prompt.ts` (`FIXED_INSTRUCTIONS`, `buildSystemPrompt`, `SUMMARY_SYSTEM`) e o contrato `apps/agent/src/agent/prompt-contract.ts` (`composePrompt`, `ORIGIN_CLASS`).
- Blocos de dado: `apps/agent/src/agent/data.ts` (`dataLine`, `neutralize`).
- Turno e rotinas: `apps/agent/src/agent/runner.ts` (conversa sem temperatura; resumo com 0,2; `scheduled`/`runScheduled`).
- Chamadas externas: `apps/agent/src/tools/registry.ts` (`mcp.mustAsk`, proposta da rotina) e `apps/agent/src/mcp/agent.ts` (`McpTurnTools`).
- Nó de IA dos fluxos: `apps/agent/src/flows/engine.ts` (`AI_SYSTEM` + `Instruction:` por concatenação, 0,2).
- Avaliações: `apps/agent/src/reviews/responder.ts` (rascunho 0,2/320 tokens; segunda leitura 0/120), `reviews/guard.ts` (verificador fixo), `reviews/service.ts`.
- Provedor: `apps/agent/src/ai/provider.ts` (`GenerateRequest`), `ai/workers-ai.ts` (`callOptions` só repassa `temperature`), `ai/mock.ts`, `ai/metered.ts`.
- Tela: `apps/web/src/pages/settings/AiTab.tsx`; senha recente: `auth.requireRecentAuth` + `RECENT_AUTH_REQUIRED` tratado em `apps/web/src/lib/api.ts`; bloqueio: `WHILE_LOCKDOWN` em `apps/agent/src/api/app.ts`.
- Decisões: 31/10/2026 (teto de 9.000 Neurons/dia, só modelos grátis); 03/11/2026 (avaliações, segunda leitura); 04/11/2026 (respostas ao estudo, em `decisoes.md`).

## 3. Objetivo e critérios de aceite

| Nº | Critério | Origem |
| --- | --- | --- |
| CA1 | Todo agente de IA (conversa, resumo, nó de IA, rascunho e segunda leitura das avaliações, conferência das rotinas) tem uma linha na tabela `AGENT_PROFILES` com temperatura, `top_p` e máximo de tokens padrão; a conversa deixa de usar a temperatura padrão do modelo. | estudo 6 |
| CA2 | Os especialistas passam por um contrato único (`specialists/`): prompt montado só por `composePrompt`, entrada só por `dataLine`, sem ferramentas, saída JSON validada por Zod ou texto com teto; fora do formato, falha. | estudo 4, Pablo (4) |
| CA3 | `temperature` e `top_p` chegam ao Workers AI; `seed`, `top_k` e `repetition_penalty` não são mandados. | estudo 6 |
| CA4 | Na conversa, quando o dono pediu uma ação, a resposta diz que fez e nenhuma ferramenta de escrita deu certo no turno, a Zuri acrescenta um aviso curto e guardado na resposta. Sem IA. | estudo 5 |
| CA5 | O verificador fixo (normalização, contato/link, caracteres escondidos, cópia, marcação) sai das avaliações para um módulo compartilhado; as avaliações continuam com o mesmo resultado. | estudo 5 |
| CA6 | O resultado do nó de IA passa pelo verificador fixo: caractere escondido é removido; link, e-mail ou telefone que não estava nos dados lidos nem na instrução faz o passo parar com o problema `ai_check`. | estudo 5 |
| CA7 | Numa rotina, chamada externa que rodaria sozinha passa por conferência fixa dos argumentos (contato, link ou número que não está na instrução nem no que a rotina leu) e pela segunda leitura por IA; reprovou, falhou ou faltou Neuron: vira proposta para o dono aprovar. | Pablo (1) |
| CA8 | Cada prompt tem `PROMPT_VERSION` (hash curto do texto fixo + versão do dono). | estudo 7 |
| CA9 | Corpus de injeção (pt-BR e en, homóglifos, invisíveis, "ignore as instruções", ordens em avaliação, CRM, agenda e MCP) roda na CI contra `dataLine`, verificador fixo, conferência das rotinas e conferência de afirmações; instantâneo dos prompts montados aparece no diff. | estudo 3 e 7 |
| CA10 | `scripts/avaliar-prompts.ts` roda casos fixos com IA real na conta do dono, com teto de 300 Neurons por rodada, e imprime acertos por caso. Fora da CI. | Pablo (3) |
| CA11 | (PR 2) A tela de IA mostra, por agente, temperatura, `top_p`, máximo de tokens e a camada do dono do prompt (persona, tom, tarefa), com o padrão do código e a camada de segurança visível só para leitura. | Pablo (2) |
| CA12 | (PR 2) Salvar pede a senha digitada nos últimos 15 minutos (`RECENT_AUTH_REQUIRED`), é recusado no modo de bloqueio e não existe ferramenta, comando do bot, MCP, fluxo ou token remoto que mude isso. | Pablo (2), estudo 8.1 |
| CA13 | (PR 2) Cada mudança vira versão com data; "Voltar para esta versão" e "Voltar ao padrão"; a versão em uso fica gravada em cada resposta da conversa, rodada de rotina e rascunho de avaliação. | Pablo (2) |
| CA14 | (PR 2) Camada do dono com teto de 2.000 caracteres, sem `<` nem `>`, sem caracteres invisíveis; faixas exatas por parâmetro; canário e corpus rodam também com um prompt do dono plantado. | estudo 8.1 |

## 4. Escopo

**Entra (PR 1, servidor):** CA1 a CA10.

**Entra (PR 2, tela e banco):** CA11 a CA14, migration 30 (a 29 fica com a etapa 21), rotas `/api/ai/agents`.

**Fica fora (e onde vai parar):**

- Segunda leitura por IA na conversa → não faremos (estudo 5: o texto já foi transmitido; dobraria o custo).
- Llama Guard → não faremos (estudo 3).
- `seed`, `top_k`, `repetition_penalty`, `frequency_penalty` → não faremos (o SDK não manda; estudo 6).
- `response_format` (JSON mode) → não faremos agora; só o Llama 3.3 confirma suporte.
- Teste do cache de prefixo (`x-session-affinity`) → precisa de IA real; entra como caso opcional do `avaliar-prompts` e da medição na conta do Pablo.
- Botão "Testar" na tela antes de salvar → depois da PR 2, se o Pablo quiser; o `avaliar-prompts` cobre o teste com IA real.
- Editar o prompt dos verificadores (segunda leitura das avaliações e das rotinas) → fica só leitura: a camada inteira deles é de segurança; dá para ajustar só a temperatura e os tokens (suposição S3).

## 5. Como funciona para o Pablo

### Fluxo 1 · Conversa com afirmação sem ferramenta (PR 1)

1. Pablo escreve "anota que a reunião mudou para sexta".
2. O modelo responde "Anotei!" mas nenhuma ferramenta de escrita deu certo.
3. No fim da resposta aparece, em itálico: "_Não consegui confirmar que isso foi feito. Confira antes de contar com isso._". O aviso fica guardado com a resposta (web e Telegram).

### Fluxo 2 · Rotina que chama serviço externo sozinha (PR 1)

1. A rotina das 8h chama uma ferramenta externa liberada para rodar sozinha.
2. Antes de mandar, a Zuri confere os argumentos (fixo) e faz a segunda leitura (IA, ~7–19 Neurons).
3. Aprovou: roda como hoje. Reprovou: vira proposta na conversa da rotina, com o aviso de sempre ("A rotina deixou 1 chamada esperando você").

### Fluxo 3 · Nó de IA de um fluxo (PR 1)

1. O passo de IA devolve um texto com um link que não estava nos dados.
2. O passo para com "A resposta da IA trouxe um link ou contato que não estava nos dados. Nada foi enviado." na execução do fluxo.

### Fluxo 4 · Ajustar um agente na tela (PR 2)

1. Configurações › IA › cartão **Agentes**: lista conversa, resumo, passo de IA dos fluxos, rascunho de avaliações, segunda leitura das avaliações e conferência das rotinas, cada um com o resumo dos parâmetros e "Padrão" ou "Ajustado".
2. **Ajustar** abre o painel do agente: temperatura (deslizante e número), `top_p` (ou "padrão do modelo"), máximo de tokens, a camada do dono (área de texto com contador) e, recolhidas, as regras fixas (só leitura).
3. **Salvar**: se a senha não foi digitada nos últimos 15 minutos, o diálogo de senha já existente aparece; depois, a versão nova vale na próxima chamada. Aviso "Ajustes salvos. Valem a partir da próxima resposta."
4. **Versões**: lista com data e "Voltar para esta"; **Voltar ao padrão** cria uma versão igual ao código.
5. Estados: carregando (esqueleto), erro (aviso com "Tentar de novo"), bloqueio (botões desligados com o motivo), celular (painel ocupa a largura), escuro, teclado e leitor de tela (rótulos e descrições ligados aos campos).

### Textos visíveis

PR 1 (os da PR 2 ficam no plano da tela, seção 5 desta mesma página, ao implementar):

| Chave | pt-BR | en | Onde aparece |
| --- | --- | --- | --- |
| `chat.claimUnverified` | Não consegui confirmar que isso foi feito. Confira antes de contar com isso. | I couldn't confirm this was done. Check before relying on it. | Fim da resposta da conversa |
| `flows.problem.ai_check` | A resposta da IA trouxe um link ou contato que não estava nos dados. Nada foi enviado. | The AI's answer had a link or contact that wasn't in the data. Nothing was sent. | Execução do fluxo |

## 6. Regras de negócio e limites

| Regra | Valor | No limite | Erro |
| --- | --- | --- | --- |
| Temperatura | 0 a 1,5, passo 0,05 | 1,5 aceita; 1,55 recusa | `VALIDATION_FAILED` |
| `top_p` | 0,1 a 1 ou vazio (padrão do modelo) | 0,1 aceita; 0,09 recusa | `VALIDATION_FAILED` |
| Máximo de tokens | faixa por agente (ex.: resumo 100–600; conversa usa o limite já existente 256–4.096) | idem | `VALIDATION_FAILED` |
| Camada do dono | até 2.000 caracteres, sem `<`/`>`, sem invisíveis | 2.000 aceita; 2.001 recusa | `VALIDATION_FAILED` |
| Versões guardadas por agente | 20 (a mais antiga sai) | a 21ª apaga a 1ª | — |
| Segunda leitura da rotina | 1 por chamada externa automática; teto de 60 Neurons cada | sem Neurons: vira proposta | — |
| Conferência fixa dos argumentos | todo e-mail, link, telefone (≥8 dígitos) ou @ nos argumentos tem de estar na instrução da rotina ou no que ela leu | um ausente: proposta | — |
| Resultado do nó de IA | link, e-mail ou telefone novo | para o passo | `ai_check` |
| Avaliar prompts | teto 300 Neurons por rodada | para no caso seguinte e diz quantos ficaram | — |

## 7. Desenho técnico

### Arquivos

| Arquivo | Cria ou muda | Para quê |
| --- | --- | --- |
| `packages/shared/src/agents.ts` | cria | `AGENT_IDS`, `AGENT_PROFILES` (padrões e faixas), schemas da PR 2 |
| `apps/agent/src/specialists/contract.ts` | cria | `Specialist`, `runSpecialist`, `specialistSystem`, `promptVersion` |
| `apps/agent/src/specialists/checker.ts` | cria | verificador fixo compartilhado (`hiddenChars`, `contactsIn`, `copied`, `markup`) |
| `apps/agent/src/specialists/claims.ts` | cria | conferência de afirmações da conversa |
| `apps/agent/src/specialists/{summary,flow-ai,reviews,routine-check}.ts` | cria | cada especialista no contrato |
| `apps/agent/src/agent/prompt-contract.ts` | muda | origens `specialist_rules`, `owner_prompt`, `owner_instruction` e classe `owner` |
| `apps/agent/src/agent/prompt.ts` | muda | persona separada das regras (vira a camada do dono padrão) |
| `apps/agent/src/agent/runner.ts` | muda | temperatura da conversa, resumo pelo contrato, afirmações, conferência das rotinas |
| `apps/agent/src/tools/registry.ts` | muda | gancho `routineCheck` antes de rodar externa sozinha |
| `apps/agent/src/flows/engine.ts` | muda | nó de IA pelo contrato + verificador |
| `apps/agent/src/reviews/{responder,guard}.ts` | muda | pelo contrato e pelo verificador compartilhado |
| `apps/agent/src/ai/{provider,workers-ai,mock}.ts` | muda | `topP`; o simulado responde JSON aos especialistas que pedem JSON |
| `apps/agent/test/injection-corpus.ts` + testes | cria | corpus e testes |
| `scripts/avaliar-prompts.ts` | cria | casos com IA real, teto 300 Neurons |
| `.claude/rules/prompts.md` | cria | regra da área: mudança de prompt traz o resultado do `avaliar-prompts` |

### Rotas e contratos

PR 1: nenhuma rota nova. PR 2: `GET /api/ai/agents` (perfis, padrão, versão em uso, regras fixas), `PUT /api/ai/agents/:id` (corpo Zod `agentConfigUpdateSchema`, 8 KB, `requireRecentAuth`, fora de `WHILE_LOCKDOWN`, fora dos tokens remotos), `GET /api/ai/agents/:id/versions`, `POST /api/ai/agents/:id/restore` (`{ version }` ou `{ default: true }`).

### Banco

PR 1: nenhum. PR 2: migration 30, `zur_agent_configs (agent TEXT, version INTEGER, temperature REAL, top_p REAL, max_tokens INTEGER, prompt TEXT, created_at INTEGER, PRIMARY KEY (agent, version))` e colunas `prompt_version TEXT` em `zur_messages`, na tabela de execuções das rotinas e em `zur_reviews` (acréscimo). Volume: ≤20 versões × 6 agentes.

### Ferramentas do agente

Nenhuma ferramenta nova; nenhuma ferramenta mexe em prompt ou parâmetro.

### Agendamentos, IA e integrações externas

Segunda leitura da rotina: GLM 4.7 Flash, ~800–3.000 tokens de entrada, até 120 de saída, temperatura 0. Nada novo de fora.

## 8. Custo e cotas do plano Free

| Recurso | Uso típico | Pior caso | Folga | Fonte |
| --- | --- | --- | --- | --- |
| Neurons, conferência das rotinas | ~7–19 por chamada externa automática (≈5 por dia → <100) | 12 chamadas por despertar × 60 = 720 | dentro dos 9.000 | estudo 2 |
| Neurons, conferência de afirmações | 0 | 0 | — | sem IA |
| Neurons, `avaliar-prompts` | ≤300 por rodada, na conta do dono, sob demanda | 300 | — | Pablo (3) |
| JS inicial | 0 (PR 1); PR 2 com o cartão em pedaço lazy | +0 na 1ª tela | teto 139.600 B | `.claude/rules/performance.md` |
| SQLite (PR 2) | 1 leitura por chamada de IA (cache em memória por versão) | — | — | — |

## 9. Segurança e privacidade

| Ameaça | Defesa | Teste |
| --- | --- | --- |
| Texto de terceiro manda a rotina mandar dados para fora | conferência fixa dos argumentos + segunda leitura; reprovado vira proposta | `routine-check.test.ts` com o corpus |
| Segunda leitura enganada pelo próprio argumento | argumentos vão em `<data>`; na dúvida (fora do formato, erro, sem Neurons), reprova | idem |
| Camada do dono vira porta de injeção (sessão roubada) | senha recente, bloqueio, sem ferramenta/bot/MCP/token remoto; sem `<`/`>`/invisíveis; regras fixas depois dela e "não muda as regras" | PR 2: rotas + `prompt-contract.test.ts` |
| Nó de IA inventa link e o passo seguinte manda | verificador fixo do resultado | `flows-engine` |
| Modelo afirma ação que não fez | conferência de afirmações | `claims.test.ts` |
| Prompt muda sem ninguém ver | instantâneo dos prompts no diff + `PROMPT_VERSION` | `prompt-snapshot.test.ts` |
| Vazamento do prompt na tela | a tela só mostra o texto fixo que já está no repositório público; nenhum dado do dono entra | PR 2 |

Nível da auditoria: orientação (não toca autenticação nem segredos na PR 1); PR 2 com rota nova e senha: completa nas rotas.

## 10. Testes

| CA | Teste | Camada | Arquivo |
| --- | --- | --- | --- |
| CA1 | perfis com padrões dentro das faixas; conversa manda temperatura 0,4 | unitário/integração | `packages/shared/test/agents.test.ts`, `apps/agent/test/guardrails.test.ts`, `chat-runner.test.ts` |
| CA2 | especialista com JSON fora do formato falha; texto além do teto é cortado; entrada com marcação fora de `<data>` falha | unitário | `apps/agent/test/guardrails.test.ts` |
| CA3 | `callOptions` repassa `topP`; não repassa outros | unitário | `apps/agent/test/guardrails.test.ts` |
| CA4 | pedido + "Anotei" sem ferramenta → aviso; com ferramenta → sem aviso; negação; cortesia; perguntas sobre o passado | unitário + integração | `apps/agent/test/guardrails.test.ts`, `chat-runner.test.ts` |
| CA5 | testes das avaliações continuam passando | regressão | `apps/agent/test/reviews*.test.ts` |
| CA6 | link novo para o passo; link da instrução passa; invisível removido; prompt pelo contrato | integração | `apps/agent/test/flows-edges.test.ts` |
| CA7 | aprovado roda; reprovado, fora do formato, erro, sem Neurons e contato novo viram proposta; parada não deixa proposta; resposta externa não abona contato | integração | `apps/agent/test/mcp-chat.test.ts` |
| CA8 | versão muda quando o texto muda | unitário | `apps/agent/test/guardrails.test.ts` |
| CA9 | corpus contra cada defesa; instantâneo | segurança | `apps/agent/test/guardrails.test.ts`, `prompt-snapshot.test.ts` |
| CA10 | casos do `avaliar-prompts` distinguem certo de errado; teto; `--seco` rodado à mão | unitário | `apps/agent/test/guardrails.test.ts` |
| CA11–14 | rotas, faixas n−1/n/n+1, senha, bloqueio, versões; e2e + axe da tela | contrato/e2e/a11y | PR 2 |

## 11. Entrega

- **Ordem:** PR 1 (servidor, CA1–CA10) → PR 2 (banco, rotas e tela, CA11–CA14). Cada uma mesclável sozinha.
- **Capturas:** PR 1 sem mudança visível na tela (só o aviso de texto); PR 2 com Configurações › IA › Agentes.
- **Docs:** `docs/ia.md` (agentes, parâmetros, conferências), `docs/seguranca.md` (camadas), `docs/fluxos.md` (`ai_check`), README.
- **Changelog:** `changelog/nao-lancado/guardrails-especialistas-ia.md` (PR 1) e `agentes-na-tela-de-ia.md` (PR 2).
- **Instalação:** nada novo. O `avaliar-prompts` usa o `wrangler` logado do dono.
- **Portabilidade:** nenhum binding novo.

## 12. Riscos

| Risco | Chance | Impacto | O que fazemos |
| --- | --- | --- | --- |
| Temperatura fixa 0,4 muda o tom da conversa | média | baixo | é o meio da faixa dos padrões; o dono ajusta na PR 2; `avaliar-prompts` antes |
| Conferência de afirmações com falso positivo | média | baixo | só com pedido de ação na mensagem e sem negação; aviso é discreto |
| Segunda leitura reprova chamadas legítimas | média | médio | vira proposta (nada se perde); contador no aviso da rotina |
| Teste de rotina existente quebra com a segunda leitura | alta | baixo | simulado responde JSON "ok" aos especialistas que pedem JSON |
| Conferência de contatos com falso positivo (nome de arquivo com final que parece domínio, como `relatorio.app`; número de 7 dígitos) | média | baixo | risco aceito: na rotina vira proposta, no fluxo para o passo com `ai_check`; arquivos comuns (`.pdf`, `.png`…) e datas ISO ficam de fora |

## 13. Suposições

- S1. Temperaturas padrão: conversa 0,4; resumo 0,2; nó de IA 0,2; rascunho de avaliação 0,2; segundas leituras 0. `top_p` vazio (padrão do modelo) em todos.
- S2. A persona da conversa (parágrafo "Personality") vira a camada do dono padrão; as regras, datas e idioma ficam fixos.
- S3. Os verificadores (segundas leituras) têm o prompt só para leitura: tudo neles é segurança. O Pablo pode derrubar no PR.
- S4. "Pede a senha de novo" segue o padrão já usado em MCP, fluxos e Telegram: senha digitada nos últimos 15 minutos (`requireRecentAuth`).
- S5. O aviso da conferência de afirmações fica no texto guardado (sem coluna nova na PR 1); a PR 2 grava a versão do prompt.

## 14. Entrevista com o Pablo

| Data | Pergunta | Resposta |
| --- | --- | --- |
| 04/11/2026 | Segunda leitura por IA nas rotinas com ferramenta externa no automático? | Sim |
| 04/11/2026 | Temperatura e parâmetros ajustáveis na tela de IA? | Sim, e o prompt de cada agente também |
| 04/11/2026 | Rodar `avaliar-prompts` na conta do dono? | Sim, teto 300 Neurons |

### Perguntas abertas

- Nenhuma que bloqueie. S3 fica à vista no PR.
