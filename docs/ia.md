# Provedor de IA e medição de uso

Como o Zuri chama a IA e conta o que ela gasta (etapa 8). A conversa com
ferramentas (etapa 9, [conversa e ferramentas](chat.md)) e a voz passam pelo
mesmo medidor.

## Provedores

| Provedor | Quando | Gasta Neurons |
| --- | --- | --- |
| Workers AI (`apps/agent/src/ai/workers-ai.ts`) | Produção: qualquer `PUBLIC_URL` que não seja loopback | Sim |
| IA simulada (`apps/agent/src/ai/mock.ts`) | Desenvolvimento local (`npm run dev`) e e2e, com `PUBLIC_URL` em `http://127.0.0.1` ou `localhost` | Não |
| Anthropic e OpenAI (`apps/agent/src/ai/paid.ts`) ⚠️ | Só quando o dono escolhe um modelo pago e a chave da empresa está cadastrada (etapa 21) | Não: cobram em US$ na conta do dono na empresa |

- Os dois seguem a mesma interface `AIProvider`: `generate`, `stream` e
  `generateWithTools`.
- O Workers AI usa o AI SDK (`ai` 7.0.137) com o provedor oficial da
  Cloudflare (`workers-ai-provider` 4.0.0). O raciocínio do modelo fica
  desligado (`enable_thinking: false`) nos modelos cujo template tem essa
  chave (GLM 4.7 Flash e Qwen3); os Llama não recebem o campo. As novas
  tentativas do SDK ficam desligadas (`maxRetries: 0`), e a telemetria do SDK
  também.
- Sem o binding `AI` fora do ambiente local, a IA responde `NOT_CONFIGURED`.
- `npm run dev` e os testes e2e rodam o `wrangler dev --local`: o binding de IA
  fica desligado e nada sai para a conta da Cloudflare.
- A IA simulada repete a mensagem e, com `call <ferramenta> {json}`, chama uma
  ferramenta pelo caminho real (limites, validação, aprovações). Os textos
  dela vêm do catálogo de i18n.
- Modelos pagos: veja [Modelos pagos](#modelos-pagos-etapa-21) abaixo. Em
  desenvolvimento local eles são simulados (a IA simulada com o nome do modelo
  pago), sem chave e sem rede.
- A IA simulada também finge um modelo ocupado: uma mensagem que começa com
  `fail ` falha no modelo escolhido antes de responder, e o reserva simulado
  (`mock-fallback`) responde no lugar. Assim a troca aparece em `npm run dev`
  e nos e2e. Nesse modo o disjuntor recomeça a cada vez, para o `fail ` dos
  testes nunca deixar o modelo simulado de lado.

## Modelos pagos (etapa 21)

| Modelo | Empresa | US$ por milhão de tokens (entrada / saída) |
| --- | --- | --- |
| Claude Haiku 5.5 | Anthropic | 0,10 / 0,50 |
| Claude Sonnet 5.5 | Anthropic | 2 / 10 |
| GPT-6 Luna | OpenAI | 0,10 / 0,50 |
| GPT-6.1 Terra | OpenAI | 1 / 5 |

Preços conferidos em 04/11/2026 (`PAID_MODELS` e `PAID_PRICING` em
`packages/shared/src/ai.ts`). O custo é gravado na hora da chamada, então uma
mudança de preço não reescreve o passado.

- Tudo nasce desligado. Um modelo pago só aparece para escolha quando a chave
  da empresa está cadastrada como segredo do Worker (`ANTHROPIC_API_KEY` ou
  `OPENAI_API_KEY`). Sem a chave, `PATCH /api/settings` responde
  `NOT_CONFIGURED`. A chave nunca chega ao navegador nem aos logs, e entra na
  lista de segredos que o prompt nunca carrega.
- Escolher um modelo pago (conversa ou reserva) e mudar o teto em US$ pedem a
  senha recente. A tela mostra antes o aviso do que sai da conta (D7).
- Chamadas pelo AI SDK (`@ai-sdk/anthropic` e `@ai-sdk/openai`, API Responses
  com `store: false`), direto na API de cada empresa, sem AI Gateway. Sem
  `temperature` nem `top_p` (os modelos recentes não aceitam ou ignoram).
  Haiku sem raciocínio; Sonnet com raciocínio só entre ferramentas; OpenAI com
  `reasoningEffort: "none"`.
- O uso vem da própria resposta (tokens de entrada, de saída e de cache) por um
  `fetch` medido, e cada passo é acertado no medidor como os do Workers AI.
- **Teto em US$** (`aiUsdCentsPerDay`, em centavos): 0 é sem teto, o padrão.
  Com valor, a chamada que passaria do teto é recusada antes de sair
  (`AI_LIMIT_REACHED`, `error.aiLimit.usd`); a conta é feita em centavos, sem
  erro de arredondamento. Os modelos grátis não contam nesse teto.
- **Sem crédito** (HTTP 402 ou a mensagem da empresa) e **chave recusada**
  (401/403) tiram a empresa da cadeia até o dono tocar em "Já recarreguei" ou
  "Tentar de novo" (`POST /api/usage/providers/:provider/retry`). O estado fica
  gravado, e a reserva responde enquanto isso.
- **O que vai para fora** (D3 a D5, `apps/agent/src/ai/external.ts`), aplicado
  a cada tentativa que vai para uma empresa de fora, dentro do `MeteredAI`:
  - memória ou nota marcada como "Nunca enviar para fora" (`local_only`) entra
    só como a linha `<data … local="1">`, com o texto trocado; as ferramentas
    também escondem o texto;
  - o histórico vai só com as últimas 8 mensagens, começando por uma do dono;
    `read_note` entrega até 600 caracteres;
  - e-mails, telefones, CPFs, cartões (Luhn), IBANs (mod 97) e chaves de API
    viram marcadores (`[EMAIL_1]`). A tabela vive só na tentativa: a resposta
    mostrada ao dono e os argumentos das ferramentas recebem os valores de
    volta, e o resultado das ferramentas é mascarado de novo antes de voltar ao
    modelo. Um marcador que a tentativa não entregou fica como está.
  - Uma troca para o Workers AI no meio do caminho manda o contexto inteiro, e
    o inverso manda o perfil de fora.

## Modelo reserva e disjuntor

Decisão de 02/11/2026; plano em
[troca de provedores e proteção de dados](planos/troca-de-provedores-e-protecao-de-dados.md),
parte 2. Código em `apps/agent/src/ai/chain.ts` e `apps/agent/src/ai/metered.ts`.

- **O quê.** Configurações > IA tem o campo "Modelo reserva"
  (`aiFallbackModel`): nenhum ou outro modelo da mesma lista grátis. Padrão:
  Qwen3 30B A3B, o mais barato. O reserva igual ao modelo de conversa conta
  como nenhum.
- **Como.** `ProviderChain` guarda o modelo escolhido e o reserva.
  `MeteredAI` tenta um de cada vez, na ordem, e conta cada tentativa com o
  preço do próprio modelo antes de chamar (regra P7). Duas tentativas são dois
  pedidos; a que falhou conta como erro. O prazo de 120 s vale para as duas
  juntas.
- **Quando troca.** Só antes do primeiro evento da resposta (nenhum texto
  mostrado, nenhuma ferramenta rodou) e só por falha do provedor
  (`isSwitchable`): ocupado (`error.aiBusy`), modelo fora
  (`error.aiModelUnavailable`), erro desconhecido ou do servidor
  (`error.aiUnavailable`), tempo esgotado do lado do provedor (HTTP 408,
  códigos 3007 e 3008, lidos como ocupado), ou 20 s sem o primeiro pedaço (`FIRST_CHUNK_MS`,
  só enquanto há reserva; o último modelo da fila tem o prazo inteiro).
- **Quando não troca.** Teto do dono (`AI_LIMIT_REACHED` do medidor), Parar,
  pedido recusado (`error.aiRequestRejected`: HTTP 4xx que não é 429, entrada
  inválida, contexto grande demais), o prazo de 120 s da vez, resposta que já
  começou e qualquer passo depois de uma ferramenta. Nenhuma ferramenta roda
  duas vezes.
- **Disjuntor** (`CircuitBreaker`, um por provedor e modelo, na memória do
  objeto). Três falhas trocáveis em 2 minutos abrem por 60 s: o modelo é
  pulado e o reserva responde direto. Depois disso a próxima chamada real
  testa o modelo; falhou, abre de novo pelo dobro do tempo, até 15 min; deu
  certo, fecha. Sem pings de saúde. Com todos abertos, o escolhido é tentado
  assim mesmo. Uma ferramenta que começou a rodar, mesmo antes de o evento
  dela chegar, impede a troca.
- **Cota da conta.** O 4006 da Cloudflare (cota grátis da conta esgotada) vale
  para todos os modelos do Workers AI: o reserva não é tentado, e nenhuma
  chamada sai até 00:00 UTC. O dia fica em `zur_settings`
  (`ai_quota_exhausted_day`), gravado só quando muda, para um objeto que
  reiniciou não gastar um pedido para descobrir de novo.
- **O que o dono vê.** A resposta do reserva leva "Respondida pelo modelo
  reserva" na conversa, também depois de recarregar (coluna `fallback` de
  `zur_messages`). O texto não cita infraestrutura. O log ganha
  `ai_fallback` com o tipo da falha, nunca o prompt.
- **Ainda não.** Estado de cada modelo na tela e alertas ficam para a aba
  Diagnóstico (etapa 11). Um segundo provedor distinto (Anthropic ou OpenAI)
  é pago ⚠️ e fica para a etapa 21; a cadeia já aceita mais um item.

## Modelos e preços

Conferidos na [tabela de preços do Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/)
em 31/10/2026 e gravados em `packages/shared/src/ai.ts` (`WORKERS_AI_PRICING`).

| Modelo | Uso | Neurons |
| --- | --- | --- |
| `@cf/zai-org/glm-4.7-flash` (padrão) | Conversa | 5.500 por milhão de tokens de entrada, 36.400 de saída |
| `@cf/qwen/qwen3-30b-a3b-fp8` | Conversa | 4.625 / 30.475 |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | Conversa | 24.545 / 77.273 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Conversa | 26.668 / 204.805 |
| `@cf/openai/whisper-large-v3-turbo` | Voz (etapa 9) | 46,63 por minuto de áudio |
| `@cf/baai/bge-m3` | Busca semântica (etapa 17) | 1.075 por milhão de tokens |

1.000 Neurons custam US$ 0,011 no plano pago. No plano gratuito, 10.000
Neurons por dia não são cobrados.

Uma resposta típica (6.000 tokens de contexto, 400 de saída) no modelo padrão
gasta cerca de 48 Neurons: o teto padrão cabe umas 189 delas por dia.

Para trocar um preço: confira a página oficial, mude a tabela e a data
`asOf` no mesmo PR. O preço vale para as chamadas novas; o que já foi contado
não muda.

## Limites diários

| Limite | Padrão | Faixa | Onde muda |
| --- | --- | --- | --- |
| Teto de Neurons (conversa, voz e busca juntas) | 9.000 | 1.000 a 9.000 | Configurações > IA |
| Pedidos à IA (cada chamada ao modelo conta um) | 200 | 1 a 2.000 | Configurações > IA |
| Tamanho máximo da resposta | 1.024 tokens | 256 a 4.096 | Configurações > IA |
| Áudio transcrito | 3.600 s | fixo | — |
| Ações por resposta | 6 | 1 a 20 | Configurações > IA |
| Passos por resposta | 4 | 1 a 10 | Configurações > IA |
| Memória da conversa | 6.000 tokens | 2.000 a 32.000 | Configurações > IA |

- O teto de 9.000 é decisão do Pablo (31/10/2026): fica 1.000 abaixo da cota
  grátis, para sobrar folga a outro uso da conta.
- O teto vale para o Zuri; a cota de 10.000 é da **conta** inteira. Outro
  Worker que use Workers AI na mesma conta gasta da mesma cota sem o Zuri ver.
  No plano Free, a cota esgotada só faz a Cloudflare recusar (4006); numa
  conta Workers Paid, esse outro uso pode ser cobrado.
- Os dias são dias **UTC**, porque a cota da Cloudflare renova às 00:00 UTC
  (21:00 em Brasília). A tela mostra a hora da renovação no fuso do dono.

## Como a medição funciona

1. **Antes da chamada** (`UsageMeter.reserveChat`): o Zuri estima o custo
   máximo (entrada estimada por ~4 caracteres por token, mais a saída máxima),
   confere os pedidos e o teto de Neurons do dia e grava a reserva. Se não
   cabe, responde `429 AI_LIMIT_REACHED` com `details.limit` (`requests`,
   `neurons` ou `audio`), `max`, `resetsAt` e `retryAfter`, antes de mandar
   qualquer coisa.
2. **Durante**: o binding de IA passa por um medidor (`workers-ai-usage.ts`)
   que cria a conta da chamada no instante em que ela começa e lê os tokens que
   a Cloudflare informa, inclusive no meio do stream.
3. **Depois** (`settle`): a reserva vira o gasto de verdade (tokens informados
   pela Cloudflare ou, sem eles, estimados), por passo. Uma chamada com
   ferramentas conta um pedido por passo; o passo seguinte só acontece se a
   reserva dele couber, e essa reserva já inclui o prompt anterior, a resposta
   do passo e os resultados das ferramentas. Se a Cloudflare informar mais do
   que o reservado, o gasto entra inteiro e a próxima chamada que não couber é
   recusada; o excesso fica limitado às chamadas já em andamento, dentro da
   folga de 1.000 Neurons.
4. **Falha ou parada**: a chamada que chegou ao modelo é contada mesmo assim,
   com o que se viu dela. Parar a leitura no meio (botão Parar, aba fechada) ou
   abortar pelo sinal conta como interrompida. Quando a vez termina, de
   qualquer jeito, o sinal da chamada é cancelado e o medidor fecha: nenhuma
   chamada nova ao modelo começa depois. Uma reserva cuja chamada nunca começou
   é devolvida.
5. **Prazo**: cada vez tem até 120 s (`AI_TURN_DEADLINE_MS`). Passou disso, a
   chamada é cancelada, conta como falha e a resposta é
   `503 SERVICE_UNAVAILABLE` com "O modelo demorou demais para responder". O
   relógio é desligado no fim da vez, então nada segura o Durable Object
   (regra P5).

Concorrência: a conferência e a reserva acontecem num único passo síncrono do
Durable Object, que roda um pedaço de JavaScript por vez. N pedidos ao mesmo
tempo nunca passam juntos de um limite.

Uma chamada que a Cloudflare recusa por cota esgotada na conta (código 4006)
vira `AI_LIMIT_REACHED` com `details.limit: "account"`.

## Janela de contexto

Cada modelo tem uma janela de contexto (campo `context` de `CHAT_MODELS` em
`packages/shared/src/ai.ts`). O histórico de uma conversa usa o menor entre a
memória da conversa escolhida pelo dono e a janela do modelo, menos a resposta
máxima, as ferramentas e uma folga de 1.024 tokens. Com modelo reserva, vale a
menor janela dos dois: o reserva recebe o mesmo prompt. O Llama 3.3 70B, com
24.000 tokens, é o mais apertado. Cada resultado de ferramenta é cortado em
8.000 caracteres antes de voltar ao modelo.

## Voz

`POST /api/transcribe` manda o áudio ao Whisper (`whisper-large-v3-turbo`)
pelo medidor (`MeteredAI.transcribe`, `reserveAudio`), e só o modelo recebe o áudio. Um áudio tem até 60 s e
2 MB, um de cada vez. O dia tem 3.600 s. O tempo contado é o maior entre o que
o navegador mediu e o que o tamanho do arquivo indica, então mentir a duração
não ajuda. A reserva acontece antes da chamada e uma recusa da cota responde
`429 AI_LIMIT_REACHED` com `details.limit: "audio"`. Na IA simulada a
transcrição devolve um texto fixo do catálogo.

## Modelo de dados (migrations 7 e 10)

| Tabela | Linha | Para quê |
| --- | --- | --- |
| `zur_usage_daily` | uma por dia UTC | Pedidos, falhas, interrompidas, segundos de áudio, Neurons (reservados + gastos) e US$ estimados |
| `zur_model_usage_daily` | uma por dia, modelo, tipo e cobrável | Chamadas, tokens informados e estimados, segundos de áudio, Neurons e US$ |

- Guardam só contadores: nenhum texto do dono, prompt ou resposta.
- O histórico guarda 90 dias. A primeira chamada de um dia novo apaga o resto.
- Não entram no backup (são medidas, não dados do dono).
- A migration 29 acrescenta `paid_usd` (gasto dos modelos pagos no dia) e
  `ai_fallbacks` (vezes que a reserva assumiu) em `zur_usage_daily`, e
  `local_only` em `zur_memories` e `zur_notes`. A contagem da reserva entra na
  mesma escrita da chamada.
- A migration 10 acrescenta `fallback` (0 ou 1) em `zur_messages`: a resposta
  veio do modelo reserva. Só a marca, sem o nome do modelo; segue a mensagem
  no backup.

## API

`GET /api/usage` (sessão + CSRF): o uso de hoje contra os limites, uma linha
por modelo e os últimos 7 dias. Formato em `usageReportSchema`
(`packages/shared/src/ai.ts`). Os limites mudam por `PATCH /api/settings`
(`aiModel`, `aiRequestsPerDay`, `aiNeuronsPerDay`, `aiMaxOutputTokens`,
`aiUsdCentsPerDay`).

`GET /api/usage/history?days=7|30|90` (sessão + CSRF): o painel de consumo por
período. Uma linha por dia com uso, os modelos do período agrupados no SQL e o
gasto pago por dia e modelo (`usageHistorySchema`). Só números, nunca o que foi
dito. O painel é recarregado pela área `usage` do canal em tempo real; o número
dessa área fica na memória do medidor (sobe a cada escrita dos contadores), sem
linha lida nem escrita a mais.

`POST /memories/:id/local-only` e `POST /notes/:id/local-only`
(`{ "localOnly": true | false }`): liga ou desliga "Nunca enviar para fora", sem
mudar a data da última edição. Ficam fora dos tokens de acesso remoto.

## Custo no plano Free

- Cada chamada lê as três configurações e a linha do dia e grava de 2 a 3
  linhas (reserva e acerto). `GET /api/usage` lê cerca de 10 linhas.
- Medido em `apps/agent/test/free-tier-budget.test.ts`.
