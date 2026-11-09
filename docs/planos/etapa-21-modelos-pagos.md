# Plano · Etapa 21b · Modelos pagos e painel de consumo ⚠️

> Etapa 21 da especificação, parte paga (21b). A parte grátis (21a: cadeia,
> disjuntor, modelo reserva do Workers AI, D1 e D2) já está na `develop` desde
> 02/11/2026. Aprovada pelo Pablo em 04/11/2026; pode gerar cobrança quando ele
> criar uma chave e escolher um modelo pago.

## 1. Resumo

A Zuri passa a aceitar modelos da Anthropic (Claude) e da OpenAI (GPT) como
modelo principal ou como reserva. Tudo nasce desligado: sem chave cadastrada
como segredo do Worker, os modelos pagos nem aparecem como escolha válida, e
escolher um deles pede a senha de novo depois de um aviso do que sai da conta.
O gasto em US$ é medido por chamada, com teto diário **opcional** (desligado
por padrão, valor livre). A aba IA ganha um painel de consumo com gráficos por
período, modelos mais usados e atualização em tempo real.

## 2. Contexto no sistema

- `apps/agent/src/ai/`: `MeteredAI` (medidor e troca de provedor), `ProviderChain`
  e `CircuitBreaker` (`chain.ts`), `UsageMeter` (`usage.ts`), `WorkersAIProvider`
  e `MockAIProvider`. Todo acesso à IA passa por `ZuriAgent.ai()`.
- Plano de origem: `docs/planos/troca-de-provedores-e-protecao-de-dados.md`
  (partes 2 e 3, itens D3 a D7) e `docs/planos/ai-gateway-hyperdrive-vectorize.md`.
- Uso guardado em `zur_usage_daily` (dia) e `zur_model_usage_daily` (dia × modelo
  × tipo), 90 dias (P13). A aba IA (`apps/web/src/pages/settings/AiTab.tsx`) mostra
  só o dia de hoje e 7 barras de Neurons.
- Tempo real: canal `/api/live` com números por área (`zur_area_versions`).
- Em paralelo, a thread de guardrails mexe em `prompt.ts`, `runner.ts`,
  `specialists/` e acrescenta `topP`/`json` ao `GenerateRequest`; usa a migration 30.

## 3. Objetivo e critérios de aceite

| # | Critério |
| --- | --- |
| CA1 | Só modelos com preço conhecido e datado: Claude Haiku 5.5, Claude Sonnet 5.5, GPT-6 Luna e GPT-6.1 Terra. |
| CA2 | Sem a chave do provedor (Worker secret) o modelo pago é recusado (`NOT_CONFIGURED`) e a tela mostra como configurar. Nada pago fica ligado por padrão. |
| CA3 | Escolher modelo pago (principal ou reserva) ou mudar o teto em US$ pede senha recente; a tela mostra antes o aviso D7. |
| CA4 | Cada chamada paga é contada antes (estimativa) e acertada depois com os tokens que o provedor informou; o custo em US$ entra no dia e no modelo. |
| CA5 | Teto diário em US$ opcional, desligado por padrão; ligado, recusa a chamada cuja estimativa passaria dele (`AI_LIMIT_REACHED`, `limit: "usd"`), zera às 00:00 UTC. |
| CA6 | Falha do provedor antes de responder troca para o reserva (regras da 21a). Sem crédito ou chave recusada abre o disjuntor até o dono confirmar na tela. Recusa por conteúdo não troca. |
| CA7 | D3: memória e nota marcadas "Nunca enviar para fora" não chegam a provedor pago (prompt e ferramentas). |
| CA8 | D4: para provedor externo, histórico mais curto, notas em trecho, convidados de eventos fora. |
| CA9 | D5: e-mail, telefone, CPF, cartão (Luhn), chave Pix, IBAN e chaves de API viram marcadores antes de sair e voltam no texto mostrado e nos argumentos das ferramentas. |
| CA10 | D6: OpenAI com `store: false`; tabela de provedores com treino, retenção e data da conferência. Sem AI Gateway. |
| CA11 | Painel de consumo: período (7, 30, 90 dias), gasto em US$ e Neurons por dia, modelos mais usados, totais, média e projeção do mês, falhas; atualiza sozinho quando há uso novo. |
| CA12 | Textos em pt-BR e en pelo catálogo; telas acessíveis (axe), claro/escuro, celular. |

## 4. Escopo

Entra: provedores Anthropic e OpenAI pelo AI SDK (`@ai-sdk/anthropic` 4.0.92 e
`@ai-sdk/openai` 4.0.105, na mesma versão de `@ai-sdk/provider-utils` do `ai`
7.0.157), D3 a D7, teto em US$, estado dos provedores, painel de consumo.

Fica fora: AI Gateway (decisão abaixo), cache de prompt da Anthropic, transcrição
e embeddings pagos (D8 mantém embeddings no Workers AI), aviso por Telegram de
falta de crédito (fica na tela e no Diagnóstico; issue de melhoria).

## 5. Como funciona para o Pablo

### Fluxo 1 · Ligar um modelo pago

1. Cria `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` como segredo do Worker.
2. Em Configurações > IA, o modelo pago aparece liberado na lista (os sem chave
   aparecem com "precisa da chave").
3. Ao escolher, um aviso diz o que vai para a empresa, o que fica de fora e por
   quanto tempo ela guarda. Ele confirma, salva e digita a senha se ela não foi
   digitada nos últimos 15 minutos.

### Fluxo 2 · Ver o consumo

Configurações > IA > Consumo: escolhe 7, 30 ou 90 dias; vê cartões de total
(US$ pago, Neurons, pedidos, falhas), barras por dia (US$ ou Neurons), a lista
dos modelos mais usados com a parte de cada um e a projeção do mês. Com a tela
aberta, cada resposta nova da Zuri atualiza os números.

### Fluxo 3 · Sem crédito

O provedor recusa por falta de saldo: a Zuri responde pelo reserva (se houver),
o cartão do provedor diz "sem crédito" e oferece "Já recarreguei", que volta a
tentar.

### Textos visíveis

Todos no catálogo (`ptBRAi` e `en`), passados pelo humanizer. Sem citar
infraestrutura.

## 6. Regras de negócio e limites

- Preços em US$ por milhão de tokens, datados em 04/11/2026: Haiku 5.5 0,10/0,50;
  Sonnet 5.5 2/10; GPT-6 Luna 0,10/0,50; GPT-6.1 Terra 1/5. O custo é gravado na
  hora da chamada (preço novo não reescreve o passado).
- Teto: `aiUsdCentsPerDay`, 0 = sem teto (padrão, decisão do Pablo de 04/11/2026),
  de 1 a 1.000.000 centavos quando ligado. Conta só o gasto pago.
- Chamadas pagas contam nos pedidos por dia e não nos Neurons.
- Modelos pagos não recebem `temperature`/`top_p` (os modelos 5.5 e GPT-6 recusam
  valores fora do padrão). Raciocínio desligado ou mínimo (Haiku `disabled`,
  Sonnet `between_tools`, OpenAI `reasoningEffort: "none"`): raciocínio é saída paga.
- Perfil externo: últimas 8 mensagens do histórico, notas cortadas em 600
  caracteres, sem lista de convidados.

## 7. Desenho técnico

### Arquivos

- `packages/shared/src/ai-limits.ts`: ids pagos e faixa do teto (no primeiro bundle, só ids).
- `packages/shared/src/ai.ts`: `PAID_MODELS`, `PAID_PROVIDERS` (D6), `paidUsd()`,
  esquemas do relatório e do histórico.
- `apps/agent/src/ai/paid.ts`: `PaidProvider` (Anthropic/OpenAI) com medidor por
  `fetch` (uma medição por pedido, tokens lidos do SSE).
- `apps/agent/src/ai/external.ts`: perfil externo (D3/D4) e pseudonimização (D5).
- `metered.ts`, `usage.ts`, `chain.ts`, `index.ts`, `provider.ts`: provedores pagos,
  US$, crédito e chave recusada.
- Web: `AiTab.tsx` (escolha com aviso, teto, provedores) e `UsageCharts.tsx` (lazy).

### Rotas e contratos

- `GET /api/usage` ganha `today.paidUsd`, `limits.usdCentsPerDay` e `providers[]`.
- `GET /api/usage/history?days=7|30|90`: dias e modelos do período (só números).
- `POST /api/usage/providers/:provider/retry`: limpa "sem crédito"/"chave recusada"; senha recente.
- `PATCH /api/settings`: modelo pago ou teto pedem senha recente; pago sem chave → `NOT_CONFIGURED`.
- Rotas novas ficam fora dos tokens remotos (não entram em `remote/allowlist.ts`).

### Banco

Migration 29 `paid_models`: `zur_usage_daily.paid_usd` e `ai_fallbacks`,
`zur_memories.local_only` e `zur_notes.local_only`. Sem gatilho: a versão da
área `usage` fica na memória do medidor (base aleatória + escritas), para não
custar uma leitura a mais em cada pedido. Entra no backup (sem segredo).

### Agendamentos, IA e integrações externas

Chamadas a `api.anthropic.com` e `api.openai.com` só pelo SDK, sem novas
tentativas (`maxRetries: 0`), dentro do prazo de 120 s e do limite de subrequisições.

## 8. Custo e cotas do plano Free

⚠️ Gera cobrança na Anthropic/OpenAI quando o dono escolhe um modelo pago.
Workers/DO: nenhuma escrita a mais (a versão do uso fica na memória); o histórico lê no máximo 90
linhas de dia e um agregado por modelo (índice por dia já existe). Sem cron novo,
sem polling: o painel atualiza pelo canal `/api/live`. JS inicial sem mudança
(gráficos num pedaço lazy).

## 9. Segurança e privacidade

- Chaves como Worker secrets; nunca na tela, no log, no prompt (entram na rede de
  segredos do `MeteredAI`) nem no backup.
- D3 a D7 como acima. Erro do provedor sem a mensagem (pode citar o prompt).
- AI Gateway não usado: o registro guardaria as conversas; a Zuri já mede e troca.
- Ferramentas rodam localmente com os valores repostos e passam por Zod.

## 10. Testes

Unitários/integração (workerd): preços e custo, teto em US$ (n−1, n, n+1),
desligado = sem teto, `PaidProvider` com `fetch` simulado (texto, ferramentas,
uso no SSE, 402/401/429/400, recusa), disjuntor de crédito, pseudonimização (ida,
volta, marcador partido entre pedaços, marcador inventado), D3/D4, rotas novas
(contrato, senha recente, `NOT_CONFIGURED`), migration 29, histórico.
E2E: painel com período e tempo real, escolha de modelo pago com aviso, axe.

## 11. Entrega

Um PR para a `develop` com ⚠️ no título do changelog, `docs/ia.md` (seção Modelos pagos),
README, decisões, capturas da aba IA.

## 12. Riscos

- Ids e preços mudam: tabela datada e teste que exige preço para todo id.
- Pseudonimização imperfeita (texto livre): documentado em "O que isso não resolve".

## 13. Suposições

- Anthropic e OpenAI não treinam com dados da API por padrão e guardam até 30
  dias (conferido em 04/11/2026).

## 14. Entrevista com o Pablo

- 04/11/2026: aprovou a 21b com os dois provedores desligados, sem AI Gateway.
- 04/11/2026: pediu o painel de consumo com gráficos nesta etapa.
- 04/11/2026: teto em US$ opcional e desligado por padrão, com valor livre.

### Perguntas abertas

Nenhuma.
