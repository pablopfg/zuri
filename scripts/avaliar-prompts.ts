/**
 * Avalia os prompts da Zuri com a IA de verdade, na conta Cloudflare do dono
 * (docs/planos/guardrails-especialistas-ia.md, CA10; decisão de 04/11/2026).
 *
 * Roda os casos fixos de apps/agent/src/specialists/evaluation.ts (datas,
 * idioma, ordem escondida em dado, afirmação sem ferramenta, JSON e
 * verificadores das avaliações, conferência das rotinas, resumo e passo de IA
 * dos fluxos), montados pelo mesmo código do Worker, e imprime o acerto de
 * cada um. Para antes de passar de 300 Neurons na rodada. Fora da CI: a CI não
 * tem, nem deve ter, acesso à IA da conta.
 *
 * Uso:
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/avaliar-prompts.ts [--modelo <id>] [--seco]
 *
 * O token precisa só da permissão "Workers AI" (leitura). `--seco` lista os
 * casos e o custo máximo estimado, sem chamar nada.
 */
import { runnerImport } from "vite";
import type * as Shared from "../packages/shared/src/index.ts";

// The agent's types need the Workers runtime's; the script only needs this much of the module.
interface EvaluationRequest {
  system: string;
  messages: { role: "user"; content: string }[];
  maxTokens: number;
  temperature: number;
}
interface Price {
  input: number;
  output: number;
}
interface EvaluationModule {
  EVALUATION_NEURON_CAP: number;
  evaluationCases(now: Date): { id: string; agent: string; about: string; request: EvaluationRequest; passes(answer: string): boolean }[];
  worstNeurons(request: EvaluationRequest, price: Price): number;
  usedNeurons(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined, request: EvaluationRequest, price: Price): number;
}

const { module: evaluation } = await runnerImport<EvaluationModule>("./apps/agent/src/specialists/evaluation.ts");
const { module: shared } = await runnerImport<typeof Shared>("./packages/shared/src/index.ts");

const args = process.argv.slice(2);
const dry = args.includes("--seco");
const modelIndex = args.indexOf("--modelo");
const model = (modelIndex >= 0 ? args[modelIndex + 1] : undefined) ?? shared.DEFAULT_CHAT_MODEL;
const price = (shared.CHAT_MODELS as Record<string, { input: number; output: number } | undefined>)[model];
if (!price) {
  console.error(`Modelo sem preço publicado: ${model}. Use um destes: ${Object.keys(shared.CHAT_MODELS).join(", ")}`);
  process.exit(2);
}

/** Os modelos com raciocínio que a Zuri desliga (apps/agent/src/ai/workers-ai.ts). */
const THINKING = new Set(["@cf/zai-org/glm-4.7-flash", "@cf/qwen/qwen3-30b-a3b-fp8"]);
const cases = evaluation.evaluationCases(new Date());
const cap = evaluation.EVALUATION_NEURON_CAP;

if (dry) {
  let total = 0;
  for (const item of cases) {
    const worst = evaluation.worstNeurons(item.request, price);
    total += worst;
    console.log(`${item.id.padEnd(26)} ${item.agent.padEnd(14)} até ${worst.toFixed(1)} Neurons · ${item.about}`);
  }
  console.log(`\n${cases.length} casos, até ${total.toFixed(1)} Neurons no pior caso (teto da rodada: ${cap}). Modelo: ${model}.`);
  process.exit(0);
}

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) {
  console.error("Defina CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN (token com a permissão Workers AI). Nada foi chamado.");
  process.exit(2);
}

interface RunResult {
  response?: unknown;
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function run(request: EvaluationRequest): Promise<{ text: string; usage: RunResult["usage"] }> {
  const body = {
    messages: [{ role: "system", content: request.system }, ...request.messages],
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    ...(THINKING.has(model) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await response.json().catch(() => null)) as { success?: boolean; result?: RunResult; errors?: { message?: string }[] } | null;
  if (!response.ok || !json?.success || !json.result) {
    // Só a mensagem de erro da Cloudflare; o token nunca aparece.
    throw new Error(`HTTP ${response.status}: ${json?.errors?.map((error) => error.message).join("; ") ?? "sem resposta"}`);
  }
  const result = json.result;
  const content = typeof result.response === "string" ? result.response : result.choices?.[0]?.message?.content;
  return { text: typeof content === "string" ? content : JSON.stringify(result.response ?? ""), usage: result.usage };
}

let spent = 0;
let passed = 0;
let ran = 0;
for (const [index, item] of cases.entries()) {
  const worst = evaluation.worstNeurons(item.request, price);
  if (spent + worst > cap) {
    console.log(`\nTeto de ${cap} Neurons: ${cases.length - index} caso(s) ficaram de fora nesta rodada.`);
    break;
  }
  try {
    const { text, usage } = await run(item.request);
    const used = evaluation.usedNeurons(usage, item.request, price);
    spent += used;
    ran++;
    const ok = item.passes(text);
    if (ok) passed++;
    console.log(`${ok ? "✓" : "✗"} ${item.id.padEnd(26)} ${used.toFixed(1).padStart(5)} Neurons · ${item.about}`);
    if (!ok) console.log(`    resposta: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
  } catch (error) {
    // Uma chamada que falhou pode ter gastado: conta o pior caso.
    spent += worst;
    ran++;
    console.log(`✗ ${item.id.padEnd(26)} falhou: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${passed} de ${ran} casos certos · ${spent.toFixed(1)} Neurons gastos (teto ${cap}) · modelo ${model}`);
process.exit(passed === ran ? 0 : 1);
