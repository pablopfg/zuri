# Plano · S21, catálogo de modelos conferido sozinho (P24)

## 1. Resumo

A lista de modelos grátis da Zuri deixa de ser só a tabela datada. Uma vez por dia ela lê o catálogo de modelos de texto do Workers AI pelo binding de IA, mostra o que é novo, o que vai sair e o que mudou de preço, e só põe um modelo novo na lista com um toque do Pablo. Um modelo em uso que sai é trocado no dia pelo padrão, com aviso.

## 2. Contexto no sistema

- Lista fixa e preços: `packages/shared/src/ai-limits.ts` e `ai.ts` (`CHAT_MODELS`, conferidos em 31/10/2026).
- Escolha do modelo: `aiModel` e `aiFallbackModel` em `packages/shared/src/settings.ts`, tela em `apps/web/src/pages/settings/AiTab.tsx` (Configurações › Modelos e limites).
- Estimativa de Neurons: `stepNeurons` em `apps/agent/src/ai/usage.ts`; janela de contexto: `contextBudget` em `apps/agent/src/agent/context.ts`.
- Alarme único: `alarmWork` e `otherDue` em `apps/agent/src/agent/zuri-agent.ts` (regra P8).
- Desenho aprovado: `sinal-refinado-funcionalidades.md`, seção 9b ("Lista de modelos da Cloudflare"), e o cartão "Catálogo de modelos" do protótipo.
- O catálogo real (conferido em 13/11/2026) traz `context_window`, `function_calling`, `price` (US$ por milhão de tokens) e `planned_deprecation_date`. O Qwen3 30B A3B, reserva padrão, sai em 20/11/2026.

## 3. Objetivo e critérios de aceite

| # | Critério | Teste |
| --- | --- | --- |
| CA1 | Modelo novo só entra na lista com um toque ("Pôr na lista") | `model-catalog.test.ts` › Pôr na lista; `model-catalog-routes.test.ts`; e2e `catalogo-de-modelos.spec.ts` |
| CA2 | Só aparece como novo o que aceita ferramentas, tem contexto e preço | `model-catalog.test.ts` › daily check, readItem |
| CA3 | Modelo em uso que vai sair: aviso uma vez; no dia, troca para o padrão e avisa | `model-catalog.test.ts` › a model in use that leaves; rotas › alarme |
| CA4 | Nunca troca para um modelo pago nem para um fora da lista | `model-catalog.test.ts` › never touches a paid model; rotas › PATCH recusado |
| CA5 | Mudança de preço aparece e a estimativa usa o valor novo | `model-catalog.test.ts` › price change |
| CA6 | Dado de fora validado; resposta estranha não apaga nada; prazo de 15 s | `model-catalog.test.ts` › readItem, keeps the list, deadline |
| CA7 | Conferir agora, no máximo uma vez por minuto | `model-catalog.test.ts`, rotas, e2e |
| CA8 | Custo medido no teste de orçamento | `free-tier-budget.test.ts` › catalog of models |

## 4. Escopo

Dentro: conferência diária e manual, cartão do protótipo, escolha dos modelos adicionados, troca automática com aviso, preços do catálogo nas estimativas. Fora: tirar um modelo da lista à mão (não está no protótipo), modelos pagos no catálogo, trocar o reserva padrão do código (decisão do Pablo).

## 5. Como funciona para o Pablo

Em Configurações › Modelos e limites, abaixo dos limites avançados, o cartão "Catálogo de modelos" diz quando foi a última conferência e tem "Conferir agora". Cada linha tem um selo: **Novo** (com "Pôr na lista"), **Vai sair** (com a data) ou **Preço**. Um modelo posto na lista aparece nos dois campos de modelo.

### Textos visíveis

Em `packages/shared/i18n/pt-BR-ai.ts` (tela) e `pt-BR-server.ts` (erros e avisos), com o inglês em `en.ts`.

## 6. Regras de negócio e limites

`MODEL_CATALOG_LIMITS`: contexto mínimo 16.000, até 100 modelos guardados, nova tentativa em 1 h, "Conferir agora" a cada 60 s, prazo de 15 s, aviso de preço por 7 dias, id até 120 caracteres. Preço aceito entre zero e US$ 110 por milhão.

## 7. Desenho técnico

### Arquivos

`apps/agent/src/ai/catalog.ts` (serviço), `catalog-rates.ts` (preços do catálogo para a estimativa), `dev-catalog.ts` (catálogo fixo do ambiente local), `apps/agent/src/api/model-catalog.ts` (rotas), `packages/shared/src/model-catalog.ts` (contrato), `apps/web/src/pages/settings/ModelCatalog.tsx` (cartão).

### Rotas e contratos

`GET /api/ai/catalog`, `POST /api/ai/catalog/check`, `POST /api/ai/catalog/models` (`modelCatalogSchema`, `catalogAddSchema`). `PATCH /api/settings` passa a aceitar um id `@cf/…` que esteja na lista.

### Banco

Sem migration: uma linha de `zur_settings` (`model_catalog`), fora do backup.

### Ferramentas do agente

Nenhuma.

### Agendamentos, IA e integrações externas

Um passo a mais no alarme único, às 06:00 UTC e no dia em que um modelo em uso sai. Uma subrequisição por dia, contada no `WakeBudget`. Nenhum Neuron.

## 8. Custo e cotas do plano Free

Medido: conferência 2 linhas lidas e 2 gravadas, cartão 2 lidas, "Pôr na lista" 5 lidas e 1 gravada. Grava só quando algo mudou (P4).

## 9. Segurança e privacidade

O catálogo é dado de fora: Zod item por item, id por expressão fechada, nome da tela tirado do id, preço com teto. Uma resposta sem nenhum modelo da lista fixa não remove nada. As rotas pedem sessão e CSRF e ficam fechadas no modo de bloqueio. Nada do catálogo entra em prompt.

## 10. Testes

Unitários e de rota no workerd, teste de orçamento, e2e do cartão (computador e celular, axe e 44 px).

## 11. Entrega

Uma PR para a `develop`.

## 12. Riscos

- Catálogo muda de formato: leitura tolerante e "nada removido" sem a lista fixa.
- O reserva padrão sai em 20/11/2026: vira "Nenhum" com aviso; escolher um reserva padrão novo é do Pablo.

## 13. Suposições

- "Troca para o padrão" vale também para o reserva; quando o padrão é o que sai, "Nenhum" respeita "nunca um modelo que você não escolheu".

## 14. Entrevista com o Pablo

Nenhuma pergunta bloqueia. Fica a sugestão de escolher um reserva padrão novo antes de 20/11.
