---
paths:
  - "apps/agent/src/agent/prompt.ts"
  - "apps/agent/src/agent/prompt-contract.ts"
  - "apps/agent/src/specialists/**"
  - "apps/agent/src/flows/engine.ts"
  - "apps/agent/src/reviews/responder.ts"
  - "packages/shared/src/agents.ts"
---

# Prompts e especialistas

Plano: `docs/planos/guardrails-especialistas-ia.md`. Decisões do Pablo de 04/11/2026 em `.claude/memoria/decisoes.md`.

- Todo prompt sai de `composePrompt`. Especialista novo (chamada de IA sem ferramentas) entra em `apps/agent/src/specialists/` pelo contrato de `contract.ts`: `rules` fixas, `ownerDefault` (camada que o dono pode trocar), entrada só por `dataLine`, saída JSON validada por Zod ou texto com teto, perfil em `AGENT_PROFILES` (`packages/shared/src/agents.ts`). Nunca chame `ai.generate` direto com um prompt montado à mão.
- A camada de segurança (dados como dado, aprovação de ações, datas, idioma, formato JSON) fica em `rules`, nunca em `ownerDefault`. Verificadores têm `ownerPrompt: false`.
- Prompts em inglês. O que o dono escreve entra como `owner_prompt`/`owner_instruction` (classe `owner`): obedecido, mas depois das regras, com `<`/`>` trocados e invisíveis removidos.
- Parâmetros: só `temperature`, `topP` e o teto de tokens chegam ao Workers AI. Não acrescente `seed`, `top_k` nem penalidades.
- Mudou um prompt ou o modelo padrão: atualize o instantâneo (`npx vitest run test/prompt-snapshot.test.ts -u` em `apps/agent`) de propósito, rode `node scripts/avaliar-prompts.ts` na conta do Pablo (ou peça a ele) e ponha o resultado na seção "Prompt" do PR. Sem a rodada, o PR diz que ela ficou pendente.
- Defesa nova contra texto de terceiro: acrescente as frases que ela cobre em `apps/agent/test/injection-corpus.ts`.
