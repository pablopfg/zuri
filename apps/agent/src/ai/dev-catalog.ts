import { CHAT_MODELS } from "@zuri/shared";

/**
 * The catalog local development reads instead of Cloudflare's (PR S21): the
 * fixed list at the dated prices, one new model fit for the chat, one that
 * isn't (no tools) and Llama 3.3 70B leaving in 60 days, so the card shows
 * each kind of line. Nothing leaves the machine.
 */
export function developmentCatalog(now: number = Date.now()): unknown[] {
  const usd = (neurons: number) => (neurons * 0.011) / 1_000;
  const leaves = new Date(now + 60 * 86_400_000).toISOString().slice(0, 10);
  const item = (name: string, context: number, input: number, output: number, extra: { property_id: string; value: unknown }[] = []) => ({
    name,
    task: { name: "Text Generation" },
    properties: [
      { property_id: "context_window", value: String(context) },
      { property_id: "function_calling", value: "true" },
      { property_id: "price", value: [{ unit: "per M input tokens", price: usd(input), currency: "USD" }, { unit: "per M output tokens", price: usd(output), currency: "USD" }] },
      ...extra,
    ],
  });
  const fixed = Object.entries(CHAT_MODELS).map(([name, m]) =>
    item(name, m.context, m.input, m.output, name === "@cf/meta/llama-3.3-70b-instruct-fp8-fast" ? [{ property_id: "planned_deprecation_date", value: leaves }] : []),
  );
  return [
    ...fixed,
    item("@cf/google/gemma-3-12b-it", 80_000, 31_371, 50_000),
    { name: "@cf/example/sem-ferramentas", task: { name: "Text Generation" }, properties: [{ property_id: "context_window", value: "8192" }] },
  ];
}
